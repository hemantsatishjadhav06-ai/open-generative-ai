// Tiny JSON document store under AQUORA_DATA_DIR (a Railway volume in
// production). One file per document: <dir>/<collection>/<id>.json, written
// atomically (tmp file + rename). Writes to the same document are serialised
// in-process. If the directory cannot be written at all the store falls back
// to memory (health then reports storage 'ephemeral').
//
// Collections are namespaced per workspace with forWorkspace(cid): everyone
// signed in with the same access code shares that workspace.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from './config.js';
import { GatewayError } from './errors.js';
import { shared } from './state.js';

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function checkName(kind, value) {
    if (typeof value !== 'string' || !NAME.test(value) || value.includes('..')) {
        throw new GatewayError(400, 'invalid_id', `Invalid ${kind}.`, { field: kind });
    }
    return value;
}

// A collection may be nested with '/' (e.g. ws/<cid>/agents); each segment
// is validated separately.
function checkCollection(col) {
    if (typeof col !== 'string' || !col) throw new GatewayError(400, 'invalid_id', 'Invalid collection.', { field: 'collection' });
    const segments = col.split('/');
    if (segments.length > 4) throw new GatewayError(400, 'invalid_id', 'Invalid collection.', { field: 'collection' });
    segments.forEach((segment) => checkName('collection', segment));
    return segments;
}

function state() {
    return shared('store', () => ({ root: null, mode: null, memory: new Map(), locks: new Map() }));
}

async function resolveRoot() {
    const s = state();
    const wanted = dataDir();
    if (s.root === wanted && s.mode) return s;
    s.root = wanted;
    try {
        await fs.mkdir(wanted, { recursive: true });
        const probe = path.join(wanted, `.probe-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
        await fs.writeFile(probe, 'ok');
        await fs.rm(probe, { force: true });
        s.mode = 'disk';
    } catch {
        s.mode = 'memory';
    }
    return s;
}

export async function storeMode() {
    return (await resolveRoot()).mode;
}

function fileFor(root, segments, id) {
    return path.join(root, ...segments, `${id}.json`);
}

function memKey(segments, id) {
    return `${segments.join('/')}\u0000${id}`;
}

// Per-document promise chain so read-modify-write sequences don't interleave.
async function withLock(key, fn) {
    const locks = state().locks;
    const previous = locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const chained = previous.then(() => current);
    locks.set(key, chained);
    try {
        await previous;
        return await fn();
    } finally {
        release();
        if (locks.get(key) === chained) locks.delete(key);
    }
}

export async function get(col, id) {
    const segments = checkCollection(col);
    checkName('id', id);
    const s = await resolveRoot();
    if (s.mode === 'memory') {
        const doc = s.memory.get(memKey(segments, id));
        return doc ? structuredClone(doc) : null;
    }
    try {
        const text = await fs.readFile(fileFor(s.root, segments, id), 'utf8');
        return JSON.parse(text);
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        if (error instanceof SyntaxError) return null;
        throw error;
    }
}

async function writeDoc(s, segments, id, doc) {
    if (s.mode === 'memory') {
        s.memory.set(memKey(segments, id), structuredClone(doc));
        return;
    }
    const file = fileFor(s.root, segments, id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(doc));
    await fs.rename(tmp, file);
}

export async function put(col, id, doc) {
    const segments = checkCollection(col);
    checkName('id', id);
    if (doc === undefined) throw new Error('store.put needs a document');
    const s = await resolveRoot();
    await withLock(memKey(segments, id), () => writeDoc(s, segments, id, doc));
    return doc;
}

// Atomic read-modify-write: fn(current|null) → next document (or undefined to
// leave it unchanged).
export async function update(col, id, fn) {
    const segments = checkCollection(col);
    checkName('id', id);
    const s = await resolveRoot();
    return withLock(memKey(segments, id), async () => {
        const current = await get(col, id);
        const next = await fn(current);
        if (next === undefined) return current;
        await writeDoc(s, segments, id, next);
        return next;
    });
}

export async function del(col, id) {
    const segments = checkCollection(col);
    checkName('id', id);
    const s = await resolveRoot();
    await withLock(memKey(segments, id), async () => {
        if (s.mode === 'memory') {
            s.memory.delete(memKey(segments, id));
            return;
        }
        await fs.rm(fileFor(s.root, segments, id), { force: true });
    });
    return true;
}

// list(col, {prefix, filter, limit}) → documents (unordered unless `sort`).
export async function list(col, { prefix, filter, limit = 1000, sort } = {}) {
    const segments = checkCollection(col);
    const s = await resolveRoot();
    let ids;
    if (s.mode === 'memory') {
        const head = `${segments.join('/')}\u0000`;
        ids = [...s.memory.keys()].filter((key) => key.startsWith(head)).map((key) => key.slice(head.length));
    } else {
        try {
            ids = (await fs.readdir(path.join(s.root, ...segments)))
                .filter((name) => name.endsWith('.json'))
                .map((name) => name.slice(0, -5));
        } catch (error) {
            if (error?.code === 'ENOENT') return [];
            throw error;
        }
    }
    if (prefix) ids = ids.filter((id) => id.startsWith(prefix));
    const docs = [];
    for (const id of ids) {
        if (!NAME.test(id)) continue;
        const doc = await get(col, id);
        if (doc === null) continue;
        if (filter && !filter(doc, id)) continue;
        docs.push(doc);
    }
    if (typeof sort === 'function') docs.sort(sort);
    return docs.slice(0, Math.max(0, limit));
}

// Workspace-scoped view: collections live under ws/<cid>/<col>.
export function forWorkspace(cid) {
    checkName('workspace', cid);
    const scoped = (col) => `ws/${cid}/${col}`;
    return {
        workspace: cid,
        get: (col, id) => get(scoped(col), id),
        put: (col, id, doc) => put(scoped(col), id, doc),
        update: (col, id, fn) => update(scoped(col), id, fn),
        del: (col, id) => del(scoped(col), id),
        list: (col, options) => list(scoped(col), options),
    };
}

export function newDocId() {
    return crypto.randomBytes(12).toString('base64url').replace(/^[_-]/, 'a');
}
