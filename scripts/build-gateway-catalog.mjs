#!/usr/bin/env node
// Build the gateway model catalog (lib/gateway/catalog/catalog.json).
//
//   node scripts/build-gateway-catalog.mjs              rebuild from lib/gateway/catalog/sources
//   node scripts/build-gateway-catalog.mjs --check      exit 1 when catalog.json is stale
//   node scripts/build-gateway-catalog.mjs --verbose    also list mapping notes that were not turned into ops
//   node scripts/build-gateway-catalog.mjs --import DIR refresh sources/ from a research folder
//                                                       (map-*.json + fal schema dumps), then rebuild
//
// Inputs (all in the repo, so the build is reproducible):
//   sources/maps/*.json      per-model studio→fal mappings (research output, vendor name scrubbed)
//   sources/fal-schemas.json fal input/output schemas, normalised to a compact form
//   sources/fal-listing.json fal model listing (status/category) for endpoints without a saved schema
//   sources/overrides.json   hand-reviewed structured transforms, endpoint variants and tool entries
//   sources/fal-schemas-extra.json  schemas captured after the research import (same normalised form)
//   sources/fal-thumbnails.json     fal model metadata thumbnail_url per endpoint (picker thumbnails)
//
// Rules: an entry is enabled only when it maps to a fal endpoint, the mapping
// confidence is high|medium, every endpoint it can route to has a saved input
// schema, and no fixed parameter still needs operator configuration.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_DIR = path.join(ROOT, 'lib', 'gateway', 'catalog');
const SOURCES_DIR = path.join(CATALOG_DIR, 'sources');
const MAPS_DIR = path.join(SOURCES_DIR, 'maps');
const SCHEMAS_FILE = path.join(SOURCES_DIR, 'fal-schemas.json');
const LISTING_FILE = path.join(SOURCES_DIR, 'fal-listing.json');
const OVERRIDES_FILE = path.join(SOURCES_DIR, 'overrides.json');
const EXTRA_SCHEMAS_FILE = path.join(SOURCES_DIR, 'fal-schemas-extra.json');
const THUMBNAILS_FILE = path.join(SOURCES_DIR, 'fal-thumbnails.json');
// Server-owned fal endpoints behind catalog `steps` (lib/gateway/pipelines/catalog-steps.js).
const STEP_ENDPOINTS = {
    last_frame: 'fal-ai/ffmpeg-api/extract-frame',
    merge_source: 'fal-ai/ffmpeg-api/merge-videos',
    upscale: 'fal-ai/seedvr/upscale/video',
};
const THUMBNAIL_URL = /^https:\/\/(?:[a-z0-9-]+\.)*(?:fal\.media|fal\.ai|fal\.run|storage\.googleapis\.com)\/[^\s"'<>]+$/i;
const OUT_FILE = path.join(CATALOG_DIR, 'catalog.json');

const MAP_ORDER = ['t2i', 'i2i', 't2v', 'i2v-a', 'i2v-b', 'v2v-lipsync-recast-motion-audio'];
const LIST_ORDER = ['t2iModels', 'i2iModels', 't2vModels', 'i2vModels', 'v2vModels', 'lipsyncModels', 'recastModels', 'motionControlModels', 'audioModels'];
const LIST_KIND = {
    t2iModels: 'image', i2iModels: 'image', t2vModels: 'video', i2vModels: 'video', v2vModels: 'video',
    lipsyncModels: 'lipsync', recastModels: 'video', motionControlModels: 'video', audioModels: 'audio',
};
// Pricing category (SPEC §2): motion control is priced by generated duration.
const LIST_CATEGORY = {
    t2iModels: 't2i', i2iModels: 'i2i', t2vModels: 't2v', i2vModels: 'i2v', v2vModels: 'v2v',
    lipsyncModels: 'lipsync', recastModels: 'v2v', motionControlModels: 'i2v', audioModels: 'audio',
};
const LIST_FAL_CATEGORIES = {
    t2iModels: ['text-to-image'],
    i2iModels: ['image-to-image'],
    t2vModels: ['text-to-video'],
    i2vModels: ['image-to-video', 'reference-to-video'],
    v2vModels: ['video-to-video'],
    lipsyncModels: ['audio-to-video', 'video-to-video', 'image-to-video'],
    recastModels: ['video-to-video'],
    motionControlModels: ['video-to-video', 'reference-to-video'],
    audioModels: ['text-to-audio', 'text-to-speech', 'audio-to-audio', 'speech-to-speech'],
};
const PRICING = {
    t2i: { usd: 0.04, per: 'image' }, i2i: { usd: 0.04, per: 'image' },
    t2v: { usd: 0.4, per: '5s' }, i2v: { usd: 0.4, per: '5s' },
    v2v: { usd: 0.5, per: 'call' }, lipsync: { usd: 0.3, per: 'call' },
    audio: { usd: 0.05, per: 'call' }, tool: { usd: 0.02, per: 'call' },
};
const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1, none: 0 };
// fal inputs the browser must never control (safety switches, data-URI mode).
// end_user_id is fal's abuse-attribution field: the server may set it, the browser may not.
const NEVER_ALLOW = /^(sync_mode|enable_safety_checker|enable_safety_checks|enable_output_safety_checker|safety_tolerance|safety_checker|webhook_url|return_byteplus_urls|end_user_id)$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/* ─────────────────────────── helpers ─────────────────────────── */

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value, indent = 1) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, indent)}\n`);
}

function sortObject(object) {
    return Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function hasOwn(object, key) {
    return object !== null && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key);
}

// The research used the previous vendor's name throughout; the repo must not.
function scrubText(text) {
    return String(text)
        .replace(/https?:\/\/(?:api|cdn)\.muapi\.ai\S*/gi, 'the legacy API')
        .replace(/(?:api|cdn)\.muapi\.ai/gi, 'the legacy API')
        .replace(/muapi\.js/gi, 'studio client')
        .replace(/muapi/gi, (match) => (match[0] === 'M' ? 'Legacy' : 'legacy'));
}

const KEY_RENAMES = { muapi_id: 'model_id', muapi_endpoint: 'key' };

function scrub(value) {
    if (typeof value === 'string') return scrubText(value);
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, child] of Object.entries(value)) out[KEY_RENAMES[key] || scrubText(key)] = scrub(child);
        return out;
    }
    return value;
}

function shortNote(text, limit = 220) {
    const clean = scrubText(String(text || '')).replace(/\s+/g, ' ').trim();
    if (clean.length <= limit) return clean;
    return `${clean.slice(0, limit - 1).replace(/\s+\S*$/, '')}…`;
}

/* ─────────────────────── schema normalisation ─────────────────────── */

function resolveRef(node, schemas, seen = new Set()) {
    let current = node || {};
    while (current && current.$ref) {
        const name = current.$ref.split('/').pop();
        if (seen.has(name)) break;
        seen.add(name);
        const { $ref, ...rest } = current;
        current = { ...(schemas[name] || {}), ...rest };
    }
    if (current && Array.isArray(current.allOf) && current.allOf.length === 1) {
        const { allOf, ...rest } = current;
        current = { ...resolveRef(allOf[0], schemas, seen), ...rest };
    }
    return current || {};
}

function inferType(node) {
    if (node.type) return node.type;
    if (Array.isArray(node.enum) && node.enum.length) {
        const sample = node.enum.find((value) => value !== null);
        if (typeof sample === 'number') return Number.isInteger(sample) ? 'integer' : 'number';
        if (typeof sample === 'boolean') return 'boolean';
        return 'string';
    }
    if (node.const !== undefined) return typeof node.const === 'number' ? 'number' : 'string';
    if (node.properties) return 'object';
    return 'any';
}

function normaliseOpenapiField(node0, schemas, depth = 0) {
    const node = resolveRef(node0, schemas);
    const field = {};
    const types = new Set();
    const absorb = (branch0) => {
        const branch = resolveRef(branch0, schemas);
        const alternatives = branch.anyOf || branch.oneOf;
        if (alternatives) { alternatives.forEach(absorb); return; }
        const type = inferType(branch);
        for (const single of Array.isArray(type) ? type : [type]) {
            if (single === 'null') field.nullable = true;
            else types.add(single);
        }
        if (Array.isArray(branch.enum)) {
            field.enum = [...new Set([...(field.enum || []), ...branch.enum.filter((value) => value !== null)])];
        }
        if (branch.const !== undefined) field.enum = [...new Set([...(field.enum || []), branch.const])];
        // Union branches widen the accepted range (anyOf [min 2..10] | [max 0] → 0..10).
        const widen = (key, value, pick) => {
            if (typeof value !== 'number') return;
            field[key] = field[key] === undefined ? value : pick(field[key], value);
        };
        widen('min', branch.minimum, Math.min);
        widen('min', typeof branch.exclusiveMinimum === 'number' ? branch.exclusiveMinimum : undefined, Math.min);
        widen('max', branch.maximum, Math.max);
        widen('max', typeof branch.exclusiveMaximum === 'number' ? branch.exclusiveMaximum : undefined, Math.max);
        if (type === 'array') {
            if (branch.items && depth < 2) field.items = normaliseOpenapiField(branch.items, schemas, depth + 1);
            widen('max_items', branch.maxItems, Math.max);
            widen('min_items', branch.minItems, Math.min);
        }
        if (type === 'object' && branch.properties) field.props = Object.keys(branch.properties);
    };
    absorb(node);
    if (node.default !== undefined) field.default = node.default;
    field.type = [...types].join('|') || 'any';
    if (field.enum && field.enum.length === 0) delete field.enum;
    return orderField(field);
}

function orderField(field) {
    const ordered = { type: field.type };
    for (const key of ['nullable', 'enum', 'default', 'min', 'max', 'items', 'min_items', 'max_items', 'props']) {
        if (field[key] !== undefined) ordered[key] = field[key];
    }
    return ordered;
}

function normaliseOpenapiDoc(doc) {
    const api = doc.openapi;
    const schemas = api?.components?.schemas || {};
    const paths = api?.paths || {};
    const post = Object.entries(paths).find(([route, ops]) => ops.post && !route.includes('/requests/'));
    if (!post) return null;
    const inputRef = post[1].post?.requestBody?.content?.['application/json']?.schema;
    const input = resolveRef(inputRef, schemas);
    const result = Object.entries(paths).find(([route, ops]) => /\/requests\/\{request_id\}$/.test(route) && ops.get);
    const outputRef = result?.[1].get?.responses?.['200']?.content?.['application/json']?.schema;
    const output = resolveRef(outputRef, schemas);
    const fields = {};
    for (const [name, node] of Object.entries(input.properties || {})) fields[name] = normaliseOpenapiField(node, schemas);
    const outputs = {};
    for (const [name, node] of Object.entries(output.properties || {})) {
        const normalised = normaliseOpenapiField(node, schemas);
        outputs[name] = normalised.type === 'array' && normalised.items ? `array<${normalised.items.type}>` : normalised.type;
    }
    return {
        category: doc.metadata?.category || api?.info?.['x-fal-metadata']?.category || null,
        status: doc.metadata?.status || null,
        post_path: post[0],
        required: (input.required || []).filter((name) => hasOwn(fields, name)),
        input: fields,
        output: outputs,
    };
}

function normaliseCompactField(node) {
    const types = String(node.type || 'any').split('|');
    const field = { type: [...new Set(types.filter((type) => type !== 'null'))].join('|') || 'any' };
    if (types.includes('null')) field.nullable = true;
    if (Array.isArray(node.enum)) field.enum = node.enum.filter((value) => value !== null);
    if (node.default !== undefined) field.default = node.default;
    if (node.minimum !== undefined) field.min = node.minimum;
    if (node.maximum !== undefined) field.max = node.maximum;
    if (node.items !== undefined) {
        field.items = typeof node.items === 'string' ? { type: node.items } : normaliseCompactField(node.items);
        if (node.item_props) field.items.props = node.item_props;
    }
    if (node.minItems !== undefined) field.min_items = node.minItems;
    if (node.maxItems !== undefined) field.max_items = node.maxItems;
    if (node.props) field.props = node.props;
    return orderField(field);
}

function normaliseCompactDoc(doc) {
    const fields = {};
    for (const [name, node] of Object.entries(doc.input || {})) fields[name] = normaliseCompactField(node);
    const outputs = {};
    for (const [name, node] of Object.entries(doc.output || {})) {
        const type = String(node.type || 'any');
        outputs[name] = type === 'array' && node.items ? `array<${node.items}>` : type;
    }
    return {
        category: doc.category || null,
        status: doc.status || null,
        post_path: doc.post_path || null,
        required: (doc.required || []).filter((name) => hasOwn(fields, name)),
        input: fields,
        output: outputs,
    };
}

/* ───────────────────────────── import ───────────────────────────── */

function walkJson(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            if (name !== 'node_modules' && !name.startsWith('.')) walkJson(full, out);
        } else if (name.endsWith('.json') && stat.size < 8 * 1024 * 1024) {
            out.push(full);
        }
    }
    return out;
}

function modelsOf(doc) {
    if (Array.isArray(doc)) return doc;
    if (doc && typeof doc.rawHtml === 'string') {
        try { return modelsOf(JSON.parse(doc.rawHtml)); } catch { return []; }
    }
    if (doc && Array.isArray(doc.models)) return doc.models;
    return [];
}

function importResearch(dir) {
    const research = path.resolve(dir);
    const mapFiles = fs.readdirSync(research).filter((name) => /^map-.+\.json$/.test(name));
    if (mapFiles.length === 0) throw new Error(`No map-*.json files in ${research}`);
    fs.rmSync(MAPS_DIR, { recursive: true, force: true });
    for (const name of mapFiles) {
        const rows = scrub(readJson(path.join(research, name)));
        writeJson(path.join(MAPS_DIR, name.replace(/^map-/, '')), rows, 2);
    }

    const schemas = {};
    const listing = {};
    const rank = { openapi: 2, compact: 1 };
    const seenRank = {};
    const remember = (id, schema, kind) => {
        if (!id || !schema) return;
        if ((seenRank[id] || 0) >= rank[kind]) return;
        schemas[id] = schema;
        seenRank[id] = rank[kind];
    };
    for (const file of walkJson(research)) {
        if (/\/map-[^/]+\.json$/.test(file)) continue;
        let doc;
        try { doc = readJson(file); } catch { continue; }
        if (doc && doc.endpoint_id && doc.openapi) {
            remember(doc.endpoint_id, normaliseOpenapiDoc(doc), 'openapi');
            if (doc.metadata) listing[doc.endpoint_id] = [doc.metadata.status || null, doc.metadata.category || null];
            continue;
        }
        if (doc && doc.endpoint_id && doc.input && doc.post_path) {
            remember(doc.endpoint_id, normaliseCompactDoc(doc), 'compact');
            listing[doc.endpoint_id] = listing[doc.endpoint_id] || [doc.status || null, doc.category || null];
            continue;
        }
        for (const model of modelsOf(doc)) {
            if (!model || typeof model.endpoint_id !== 'string') continue;
            if (model.metadata) listing[model.endpoint_id] = [model.metadata.status || null, model.metadata.category || null];
            if (model.openapi) remember(model.endpoint_id, normaliseOpenapiDoc(model), 'openapi');
        }
        // { "<endpoint>": "active" } style listings
        if (doc && !Array.isArray(doc) && !doc.rawHtml && !doc.models && Object.keys(doc).length > 20
            && Object.entries(doc).every(([id, status]) => id.includes('/') && typeof status === 'string')) {
            for (const [id, status] of Object.entries(doc)) listing[id] = listing[id] || [status, null];
        }
    }
    writeJson(SCHEMAS_FILE, scrub(sortObject(schemas)), 1);
    writeJson(LISTING_FILE, scrub(sortObject(listing)), 0);
    console.log(`imported ${mapFiles.length} map files, ${Object.keys(schemas).length} fal schemas, ${Object.keys(listing).length} listed endpoints`);
}

/* ───────────────────── value-transform parsing ───────────────────── */

function parseTarget(target) {
    const text = String(target ?? '').trim();
    if (IDENT.test(text)) return { kind: 'field', field: text };
    if (/endpoint|^\(route\)|^\(mode\)|^\(drop\)$/i.test(text)) return { kind: 'endpoint', text };
    let match = /^([A-Za-z_]+)\.(width|height)$/.exec(text);
    if (match) return { kind: 'size', field: match[1] };
    match = /^([A-Za-z_]+)((?:\.[A-Za-z_]+|\[\d+\]\.[A-Za-z_]+)+)$/.exec(text);
    if (match) return { kind: 'nested', path: text, root: match[1] };
    match = /^([A-Za-z_]+)\s*\+\s*([A-Za-z_]+)$/.exec(text);
    if (match) return { kind: 'split', fields: [match[1], match[2]] };
    // "image_url (images_list[0])", "image_urls (-> reference-to-video)"
    match = /^([A-Za-z_]+)\s+\(([^()]*)\)\s*$/.exec(text);
    if (match && !/\broute\b/.test(match[2])) return { kind: 'field', field: match[1], first: /\[0\]/.test(match[2]), note: text };
    return { kind: 'unknown', text };
}

function stripQuotes(text) {
    return String(text).trim().replace(/^['"`]|['"`]$/g, '').trim();
}

// All "A -> B" pairs (plus embedded JSON dictionaries) in a note.
function parsePairs(text) {
    const pairs = [];
    for (const match of String(text).matchAll(/\{[^{}]*"[^{}]*\}/g)) {
        try {
            const object = JSON.parse(match[0]);
            for (const [from, to] of Object.entries(object)) {
                if (typeof to === 'string' || typeof to === 'number' || typeof to === 'boolean') pairs.push([from, String(to)]);
            }
        } catch { /* not JSON */ }
    }
    const quoted = /(['"])([^'"]{1,60})\1\s*(?:->|→|=>)\s*(?:(['"])([^'"]{1,60})\3|([A-Za-z0-9_.:\-]+))/g;
    for (const match of String(text).matchAll(quoted)) pairs.push([match[2], match[4] ?? match[5]]);
    const bare = /(?:^|[\s,;(|/])(-?[A-Za-z0-9_.:\-]+)\s*(?:->|→|=>)\s*(?:(['"])([^'"]{1,60})\2|([A-Za-z0-9_.:\-]+))/g;
    for (const match of String(text).matchAll(bare)) pairs.push([match[1], match[3] ?? match[4]]);
    const colon = /(?:^|[\s,{])(true|false)\s*:\s*(['"])([^'"]+)\2/gi;
    for (const match of String(text).matchAll(colon)) pairs.push([match[1].toLowerCase(), match[3]]);
    return pairs.map(([from, to]) => [stripQuotes(from), stripQuotes(to)]).filter(([from, to]) => from && to);
}

function acceptPairValue(value, field) {
    if (!field) return undefined;
    const types = String(field.type).split('|');
    if (/^omit$/i.test(value)) return { omit: true };
    if (Array.isArray(field.enum)) {
        if (field.enum.includes(value)) return { value };
        const numeric = Number(value);
        if (Number.isFinite(numeric) && field.enum.includes(numeric)) return { value: numeric };
        return undefined;
    }
    if (types.includes('boolean') && /^(true|false)$/i.test(value)) return { value: value.toLowerCase() === 'true' };
    if ((types.includes('integer') || types.includes('number')) && /^-?\d+(\.\d+)?$/.test(value)) return { value: Number(value) };
    return undefined;
}

function numberWithUnit(text) {
    const match = /^(\d+(?:\.\d+)?)\s*(mp)?$/i.exec(String(text).trim());
    if (!match) return null;
    const value = Number(match[1]);
    return match[2] ? Math.round(value * 1024 * 1024) : value;
}

// aspect_ratio (+ tier) → image_size / video_size op from the free-text note.
function deriveSizeOp(field, sources, text, spec) {
    const op = { op: 'aspect_to_image_size', field, from: 'aspect_ratio' };
    const enumValues = spec.enum || [];
    const tierFrom = sources.find((source) => source !== 'aspect_ratio');
    if (tierFrom) op.tier_from = tierFrom;
    op.multiple = /multiples? of 32/i.test(text) ? 32 : 16;

    const presets = {};
    for (const [from, to] of parsePairs(text)) {
        if (!/^\d+:\d+$/.test(from)) continue;
        if (enumValues.includes(to)) presets[from] = to;
        else if (/^\d+x\d+$/.test(to) && !tierFrom) {
            const [width, height] = to.split('x').map(Number);
            presets[from] = { width, height };
        }
    }
    for (const match of text.matchAll(/(\d+:\d+)\s*->\s*\{\s*(\d+)\s*,\s*(\d+)\s*\}/g)) {
        presets[match[1]] = { width: Number(match[2]), height: Number(match[3]) };
    }
    if (Object.keys(presets).length) op.presets = presets;

    const area = /area|²|\bMP\b|≈\d+MP/i.test(text);
    op.measure = area ? 'area' : 'long_edge';
    const tiers = {};
    if (tierFrom) {
        // "1K=1024", "480p=864x480"
        for (const match of text.matchAll(/\b(\d+(?:\.\d+)?[kKpP])\s*=\s*(\d+)(?:x(\d+))?/g)) {
            tiers[match[1]] = match[3] ? Math.max(Number(match[2]), Number(match[3])) : Number(match[2]);
        }
        // "1k≈1MP (1024²)", "basic≈2K area 2048²", "1K≈1024²", "2k≈4MP"
        for (const match of text.matchAll(/\b([A-Za-z0-9]+)\s*≈\s*([^,;)]*)/g)) {
            const body = match[2];
            const squared = /(\d+)²/.exec(body) || /(\d+)²/.exec(text.slice(match.index + match[0].length, match.index + match[0].length + 12));
            if (squared) tiers[match[1]] = Number(squared[1]) ** 2;
            else {
                const mp = /(\d+(?:\.\d+)?)\s*MP/i.exec(body);
                if (mp) tiers[match[1]] = numberWithUnit(`${mp[1]}MP`);
            }
        }
        // "long edge 1024 (1k) / 2048 (2k)"
        for (const match of text.matchAll(/(\d{3,4})\s*\((\d[kK])\)/g)) tiers[match[2]] = Number(match[1]);
        // "'basic' -> 2K-class, 'high' -> 4K-class ... (2048 or 4096)"
        const classes = [...text.matchAll(/'([a-z]+)'\s*->\s*(\d)K-class/gi)];
        if (classes.length) {
            for (const match of classes) tiers[match[1]] = Number(match[2]) * 1024;
        }
        // "resolution(1K|2K) ... (long edge 1024|2048)"
        const labels = /\((\d[kK](?:\|\d[kK])+)\)/.exec(text);
        const edges = /long edge (\d{3,4}(?:\|\d{3,4})+)/.exec(text);
        if (labels && edges) {
            const names = labels[1].split('|');
            const values = edges[1].split('|').map(Number);
            names.forEach((name, index) => { if (values[index] && !tiers[name]) tiers[name] = values[index]; });
        }
        if (Object.keys(tiers).length) op.tiers = tiers;
    }
    if (!Object.keys(tiers).length && !area) op.base = 1024;
    if (!Object.keys(tiers).length && area) op.base = 1024 * 1024;
    if (/~\s*1MP|at ~1MP/i.test(text)) { op.measure = 'area'; op.base = 1024 * 1024; }

    const autos = {};
    const autoList = [...text.matchAll(/'(auto_\d[kK])'/g)].map((match) => match[1]).filter((value) => enumValues.includes(value));
    if (autoList.length && op.tiers) {
        const tierNames = Object.keys(op.tiers);
        autoList.forEach((value, index) => { if (tierNames[index]) autos[tierNames[index]] = value; });
        autos.default = autoList[0];
    } else if (/'auto'\s*->\s*'auto'|missing\s*->\s*'auto'|or 'auto'/i.test(text) && enumValues.includes('auto')) {
        autos.default = 'auto';
    }
    if (Object.keys(autos).length) op.auto = autos;
    const cap = /<=\s*(\d{4,5})/.exec(text);
    if (cap) op.max = Number(cap[1]);
    return op;
}

function framesOp(text, from, field) {
    let match = /round\(duration\*(\d+)\/(\d+)\)\*(\d+)\+1/.exec(text);
    if (match) return { op: 'duration_to_frames', field, from, fps: Number(match[1]), multiple: Number(match[2]), add: 1 };
    match = /duration\s*\*\s*(\d+)\s*\+\s*1/.exec(text);
    if (match) return { op: 'duration_to_frames', field, from, fps: Number(match[1]), add: 1 };
    const map = {};
    for (const pair of text.matchAll(/(?<![>\d])(?:duration\s+)?(\d+)\s*->\s*(\d+)/g)) map[pair[1]] = Number(pair[2]);
    if (Object.keys(map).length) return { op: 'duration_to_frames', field, from, fps: 16, add: 1, map };
    return null;
}

/* ─────────────────────────── entry build ─────────────────────────── */

function mergeMaps(base, patch) {
    const out = { ...(base || {}) };
    for (const [key, value] of Object.entries(patch || {})) {
        if (value === null) delete out[key];
        else out[key] = value;
    }
    return out;
}

function deriveInputSpec({ pm, vt, fixedParams, dropParams, schema, override }) {
    const fields = schema.input || {};
    const has = (name) => hasOwn(fields, name);
    const rename = {};
    const ops = [];
    const unparsed = [];
    const drop = new Set();
    const sizeSources = {};
    const reverse = {};
    const placeholders = [];

    for (const [source, target] of Object.entries(pm)) {
        const parsed = parseTarget(target);
        switch (parsed.kind) {
            case 'field': {
                if ((parsed.field === 'image_size' || parsed.field === 'video_size') && source !== parsed.field) {
                    (sizeSources[parsed.field] ||= []).push(source);
                    break;
                }
                if (!has(parsed.field)) {
                    unparsed.push(`param ${source} → ${target}: not a fal input`);
                    if (source !== parsed.field) drop.add(source);
                    break;
                }
                (reverse[parsed.field] ||= []).push(source);
                if (source !== parsed.field) rename[source] = parsed.field;
                if (parsed.first && !String(fields[parsed.field].type).includes('array')) {
                    ops.push({ op: 'first_of_array', field: parsed.field });
                }
                break;
            }
            case 'size':
                (sizeSources[parsed.field] ||= []).push(source);
                break;
            case 'nested':
                if (has(parsed.root)) ops.push({ op: 'rename_nested', from: source, to: parsed.path });
                else unparsed.push(`param ${source} → ${target}: not a fal input`);
                break;
            case 'split': {
                const targets = parsed.fields.filter(has);
                if (targets.length) ops.push({ op: 'split_array', from: source, to: targets });
                else unparsed.push(`param ${source} → ${target}: not a fal input`);
                break;
            }
            case 'endpoint':
                drop.add(source);
                break;
            default:
                unparsed.push(`param ${source} → ${target}`);
        }
    }

    for (const [field, sources] of Object.entries(sizeSources)) {
        if (!has(field)) { unparsed.push(`${sources.join('+')} → ${field}: not a fal input`); continue; }
        const text = String(vt[field] || '');
        if (sources.includes('width') || sources.includes('height')) {
            const op = { op: 'dims_to_image_size', field, from: ['width', 'height'] };
            const cap = /<=\s*(\d{4,5})/.exec(text);
            if (cap) op.max = Number(cap[1]);
            ops.push(op);
        } else if (sources.includes('aspect_ratio')) {
            ops.push(deriveSizeOp(field, sources, text, fields[field]));
        } else {
            // resolution only (size follows the input image): let fal default.
            sources.forEach((source) => drop.add(source));
        }
    }

    for (const [key, raw] of Object.entries(vt)) {
        if (key === 'image_size' || key === 'video_size') continue;
        const text = String(raw);
        let target = has(key) ? key : null;
        if (!target && typeof pm[key] === 'string' && has(pm[key])) target = pm[key];
        if (!target && key === 'seed' && !has('seed')) { drop.add('seed'); continue; }
        const sourceKeys = target ? (reverse[target] || []).filter((source) => source !== target) : [];
        const from = sourceKeys[0];
        const spec = target ? fields[target] : null;
        let handled = false;

        if (target === 'seed' || /-1\b.*omit|omit.*-1/i.test(text) && target) {
            ops.push({ op: 'omit_if_negative', field: target || 'seed' });
            handled = true;
        }
        if (target === 'num_frames' && /duration/.test(text)) {
            const op = framesOp(text, from || 'duration', 'num_frames');
            if (op) {
                if (Number.isFinite(spec?.min)) op.min = spec.min;
                if (Number.isFinite(spec?.max)) op.max = spec.max;
                if (from) delete rename[from];
                ops.push(op);
                handled = true;
            }
        }
        const framesHandled = target === 'num_frames' && handled;
        if (target && /(^|\W)(uppercase|upper-case)(\W|$)/i.test(text)) { ops.push({ op: 'uppercase', field: target }); handled = true; }
        if (target && /(^|\W)lowercase(\W|$)/i.test(text)) { ops.push({ op: 'lowercase', field: target }); handled = true; }
        if (target === 'prompt' && /default|neutral|empty/i.test(text) && fields.prompt) {
            const quoted = /'([^']{3,80})'/.exec(text) || /"([^"]{3,80})"/.exec(text);
            const value = quoted && !/^(\.|none)$/.test(quoted[1]) ? quoted[1] : null;
            if (value) { ops.push({ op: 'default_if_empty', field: 'prompt', value }); handled = true; }
            else if (/fal default '\.'/.test(text)) handled = true;
            else if (/send '' when/.test(text)) handled = true;
        }
        if (target === 'prompt' && /@Image|@Video|@Audio/.test(text)) {
            ops.push({ op: 'capitalize_ref_tokens', field: 'prompt' });
            handled = true;
        }

        if (target && spec && target !== 'seed' && !framesHandled) {
            const map = {};
            const omit = [];
            let identity = 0;
            for (const [a, b] of parsePairs(text)) {
                if (target === 'duration' && /^\d+-\d+$/.test(a)) continue;
                const accepted = acceptPairValue(b, spec);
                if (!accepted) continue;
                if (accepted.omit) omit.push(a);
                else if (String(accepted.value) !== a || typeof accepted.value !== 'string') map[a] = accepted.value;
                else identity += 1;
            }
            if (identity && !Object.keys(map).length && !omit.length) handled = true;
            // "true -> 'high', false -> 'standard'" style maps keep boolean keys.
            if (Object.keys(map).length) {
                const op = { op: 'map_values', field: target, map };
                if (from) { op.from = from; delete rename[from]; }
                ops.push(op);
                handled = true;
            }
            if (omit.length) {
                ops.push({ op: 'omit_if', field: target, values: omit });
                handled = true;
            }
        }

        if (target && /->\s*string|int\s*->\s*"|to string|->\s*'\d|->\s*"\d/i.test(text) && String(spec?.type).includes('string')) {
            ops.push({ op: 'to_string', field: target });
            if (spec?.enum) ops.push({ op: 'snap_enum', field: target });
            handled = true;
        } else if (target && /->\s*(int|number)|number seconds|string\/number -> number/i.test(text)) {
            ops.push({ op: String(spec?.type).includes('integer') ? 'to_int' : 'to_number', field: target });
            handled = true;
        }
        if (target && /\bclamp\b/i.test(text) && (spec?.min !== undefined || spec?.max !== undefined)) {
            ops.push({ op: 'clamp', field: target });
            handled = true;
        }
        if (target && /images_list\[0\]|\[0\]\s*$|^\s*images_list\[0\]/.test(text) && !String(spec?.type).includes('array')) {
            if (!ops.some((op) => op.op === 'split_array' && op.to.includes(target))) {
                ops.push({ op: 'first_of_array', field: target });
            }
            handled = true;
        }
        if (target && String(spec?.type).includes('array') && /->\s*\[|\(string\)\s*->/.test(text)) {
            ops.push({ op: 'wrap_array', field: target });
            handled = true;
        }
        // "default to 'image' when absent", "default Legacy '9:16'", "else a generic '…'"
        if (target && spec && target !== 'prompt') {
            const match = /(?:default(?:s)?(?: to| Legacy)?|else a generic)\s+'([^']{1,80})'/i.exec(text);
            if (match) {
                const accepted = Array.isArray(spec.enum)
                    ? acceptPairValue(match[1], spec)
                    : (String(spec.type).includes('string') ? { value: match[1] } : undefined);
                if (accepted && !accepted.omit) {
                    ops.push({ op: 'default_if_empty', field: target, value: accepted.value });
                    handled = true;
                }
            }
        }
        // Range-only notes ("int 1-4", "1-4 (fal 1-9)") are enforced by validation.
        if (!handled && /^\s*(int\s+)?\d+(\.\d+)?\s*[-|]\s*\d+/.test(text)) handled = true;
        // "images_list (max 7)" / "audio_files (<=3)" / "string[] <=30": a rename note plus an item cap.
        if (target && String(spec?.type).includes('array')) {
            const leading = /^\s*([A-Za-z_]+)/.exec(text)?.[1];
            if ((leading && sourceKeys.includes(leading)) || /^\s*(string\[\]|array)/.test(text)) {
                const cap = /(?:<=\s*|max\s+)(\d+)/.exec(text);
                if (cap && spec.max_items === undefined) ops.push({ op: 'slice_array', field: target, max: Number(cap[1]) });
                handled = true;
            }
        }
        if (!handled && /identical|same (item )?shape/i.test(text)) handled = true;
        if (!handled && target && /nearest/i.test(text) && spec?.enum) { ops.push({ op: 'snap_enum', field: target }); handled = true; }
        if (!handled && target && sourceKeys.some((source) => new RegExp(`\\b${source}\\b`).test(text))
            && (text.match(/->/g) || []).length <= 1) handled = true;
        if (!handled && target && /^\s*required on fal\s*$/i.test(text)) handled = true;
        if (!handled && /^\s*(pass[- ]?through|passthrough|pass through|identical|same|bool(ean)? pass|array pass|string\[\] pass|int(eger)? pass|int \d+(-\d+)? pass|\d.*pass[- ]?through|optional|boolean passthrough|string\s*$)/i.test(text)) {
            handled = true;
        }
        if (!handled && /pass[- ]?through|passthrough|pass through/i.test(text) && !/->/.test(text)) handled = true;
        if (!handled) unparsed.push(`${key}: ${shortNote(text, 160)}`);
    }

    // The studios send seed -1 for "random"; fal wants the field omitted.
    if (has('seed') && !ops.some((op) => op.op === 'omit_if_negative' && op.field === 'seed')) {
        ops.push({ op: 'omit_if_negative', field: 'seed' });
    }

    // Aspect-like enums: studio 'auto'/'adaptive' either maps onto the fal
    // spelling or is omitted so fal infers the frame from the input media.
    for (const [name, spec] of Object.entries(fields)) {
        if (!Array.isArray(spec.enum) || !spec.enum.some((value) => /^\d+:\d+$/.test(String(value)))) continue;
        const values = spec.enum.map(String);
        const aliases = {};
        if (values.includes('auto') && !values.includes('adaptive')) aliases.adaptive = 'auto';
        if (values.includes('adaptive') && !values.includes('auto')) aliases.auto = 'adaptive';
        if (values.includes('auto') && !values.includes('match_input')) aliases.match_input = 'auto';
        if (Object.keys(aliases).length) ops.push({ op: 'map_values', field: name, map: aliases });
        const missing = ['auto', 'adaptive', 'match_input'].filter((value) => !values.includes(value) && !aliases[value]);
        if (missing.length && !(schema.required || []).includes(name)) ops.push({ op: 'omit_if', field: name, values: missing });
    }

    const fixed = {};
    for (const [key, value] of Object.entries(fixedParams || {})) {
        const root = String(key).split(/[.[]/)[0];
        if (typeof value === 'string' && /^<.*>$/.test(value.trim())) { placeholders.push(key); continue; }
        if (!has(root)) { unparsed.push(`fixed ${key}: not a fal input`); continue; }
        fixed[key] = value;
    }
    for (const raw of dropParams || []) {
        const name = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(String(raw))?.[1];
        if (name && !hasOwn(pm, name)) drop.add(name);
    }

    // Override-level edits.
    if (override.rename) Object.assign(rename, override.rename);
    for (const name of override.drop || []) drop.add(name);
    for (const name of override.keep || []) drop.delete(name);
    Object.assign(fixed, override.fixed || {});
    for (const [key, value] of Object.entries(override.fixed || {})) if (value === null) delete fixed[key];
    const transforms = [
        ...(override.transforms_before || []),
        ...(override.replace_transforms ? [] : ops),
        ...(override.transforms || []),
    ];

    const fixedRoots = new Set(Object.keys(fixed).map((key) => key.split(/[.[]/)[0]));
    const allowed = Object.keys(fields).filter((name) => (!NEVER_ALLOW.test(name) || fixedRoots.has(name)) && !(override.deny || []).includes(name));
    const required = (schema.required || []).filter((name) => allowed.includes(name));
    const types = {};
    const enums = {};
    const ranges = {};
    const items = {};
    for (const name of allowed) {
        const spec = fields[name];
        types[name] = spec.type;
        if (Array.isArray(spec.enum) && spec.enum.length) enums[name] = spec.enum;
        if (spec.min !== undefined || spec.max !== undefined) ranges[name] = [spec.min ?? null, spec.max ?? null];
        if (spec.items) {
            const item = { type: spec.items.type };
            if (Array.isArray(spec.items.enum)) item.enum = spec.items.enum;
            if (spec.max_items !== undefined) item.max_items = spec.max_items;
            items[name] = item;
        }
    }
    const acknowledged = override.reviewed === true ? [] : unparsed.filter((note) => !(override.reviewed || []).some((prefix) => note.startsWith(prefix)));
    return {
        spec: {
            rename: sortObject(rename),
            drop: [...drop].sort(),
            transforms,
            fixed,
            allowed,
            required,
            types,
            enums,
            ranges,
            items,
        },
        unparsed: acknowledged,
        placeholders,
    };
}

function outputPathFor(mapPath, schema) {
    const text = String(mapPath || '');
    const match = /([a-z_]+(?:\[\])?\.url|[a-z_]+_url)/i.exec(text);
    if (match) return match[1];
    const output = schema?.output || {};
    if (output.images) return 'images[].url';
    if (output.image) return 'image.url';
    if (output.video) return 'video.url';
    if (output.videos) return 'videos[].url';
    if (output.audio) return 'audio.url';
    if (output.audio_file) return 'audio_file.url';
    if (output.audio_url) return 'audio_url';
    return null;
}

function outputKindOf(outputPath, kind) {
    if (/^images?\b/.test(outputPath || '')) return 'image';
    if (/^videos?\b/.test(outputPath || '')) return 'video';
    if (/^audio/.test(outputPath || '')) return 'audio';
    return kind === 'image' ? 'image' : kind === 'audio' ? 'audio' : 'video';
}

// Endpoint variants, most specific first: explicit override variants, the
// map's own `routing` (1 image vs several), and an optional tier macro
// (e.g. quality 'basic' → the /fast/ sibling of every route).
function variantPlan(row, override, defaultFal) {
    let explicit = override.variants ? [...override.variants] : [];
    if (!override.variants && Array.isArray(row.routing) && override.routing !== false) {
        const imagesKey = ['images_list', 'image_urls', 'reference_images'].find((name) => hasOwn(row.param_map, name)) || 'images_list';
        for (const route of row.routing) {
            const text = String(route.when || '');
            let when = null;
            if (/exactly 1|^\s*1 image|\b1 image\b/i.test(text)) when = { field: imagesKey, max_items: 1 };
            const range = /(\d+)\s*-\s*(\d+)\s*images/i.exec(text);
            if (!when && range) when = { field: imagesKey, min_items: Number(range[1]) };
            if (!when || route.fal_endpoint === defaultFal) continue;
            explicit.push({ when, fal: route.fal_endpoint, param_map: route.param_map_overrides || {} });
        }
    }
    const tier = override.tier_variant;
    if (!tier) return explicit;
    const [from, to] = tier.replace;
    const bases = [...explicit, { when: null, fal: defaultFal }];
    const tiered = bases.map((base) => ({
        ...base,
        when: [...(base.when ? (Array.isArray(base.when) ? base.when : [base.when]) : []), tier.when],
        fal: base.fal.replace(from, to),
        param_map: { ...(base.param_map || {}), ...(tier.param_map || {}) },
    }));
    return [...tiered, ...explicit];
}

// The default route may carry its own param overrides in the map's routing.
function defaultRouteParamMap(row, defaultFal) {
    const route = (row.routing || []).find((candidate) => candidate.fal_endpoint === defaultFal);
    return route?.param_map_overrides || {};
}

function scorePrimary(row, key, schemas) {
    const category = schemas[row.fal_endpoint]?.category;
    return [
        row.model_id === key ? 1 : 0,
        category && (LIST_FAL_CATEGORIES[row.list] || []).includes(category) ? 1 : 0,
        CONFIDENCE_RANK[row.confidence] ?? 0,
        -row._order,
    ];
}

function compareScores(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
    return 0;
}

function build() {
    const mapFiles = fs.readdirSync(MAPS_DIR).filter((name) => name.endsWith('.json'))
        .sort((a, b) => MAP_ORDER.indexOf(a.replace(/\.json$/, '')) - MAP_ORDER.indexOf(b.replace(/\.json$/, '')));
    const rows = [];
    for (const name of mapFiles) {
        for (const row of readJson(path.join(MAPS_DIR, name))) rows.push({ ...row, _order: rows.length, _file: name });
    }
    const schemas = readJson(SCHEMAS_FILE);
    const listing = fs.existsSync(LISTING_FILE) ? readJson(LISTING_FILE) : {};
    const extraSchemas = fs.existsSync(EXTRA_SCHEMAS_FILE) ? readJson(EXTRA_SCHEMAS_FILE).schemas || {} : {};
    for (const [id, schema] of Object.entries(extraSchemas)) {
        schemas[id] = schema;
        listing[id] = [schema.status || 'unlisted', schema.category || null];
    }
    const thumbnails = fs.existsSync(THUMBNAILS_FILE) ? readJson(THUMBNAILS_FILE).thumbnails || {} : {};
    const overridesDoc = fs.existsSync(OVERRIDES_FILE) ? readJson(OVERRIDES_FILE) : {};
    const overrides = overridesDoc.entries || {};
    for (const extra of overridesDoc.extra || []) rows.push({ ...extra, _order: rows.length, _file: 'overrides.json' });

    const groups = new Map();
    for (const row of rows) {
        if (!groups.has(row.key)) groups.set(row.key, []);
        groups.get(row.key).push(row);
    }
    const unknownOverrides = Object.keys(overrides).filter((key) => !groups.has(key));
    if (unknownOverrides.length) throw new Error(`overrides.json references unknown keys: ${unknownOverrides.join(', ')}`);

    const entries = [];
    const report = { unparsed: {}, variantsMissing: [] };
    for (const [key, group] of groups) {
        const ranked = [...group].sort((a, b) => compareScores(scorePrimary(a, key, schemas), scorePrimary(b, key, schemas)));
        const primary = ranked[0];
        const override = overrides[key] || {};
        const siblings = ranked.filter((row) => row !== primary && row.fal_endpoint === primary.fal_endpoint);
        let pm = {};
        let vt = {};
        for (const row of [...siblings].reverse()) { pm = { ...pm, ...(row.param_map || {}) }; vt = { ...vt, ...(row.value_transforms || {}) }; }
        const fal = hasOwn(override, 'fal') ? override.fal : primary.fal_endpoint;
        pm = mergeMaps(mergeMaps({ ...pm, ...(primary.param_map || {}) }, defaultRouteParamMap(primary, fal)), override.param_map);
        vt = mergeMaps({ ...vt, ...(primary.value_transforms || {}) }, override.value_transforms);
        const lists = LIST_ORDER.filter((list) => group.some((row) => row.list === list));
        const list = override.list || primary.list;
        const confidence = override.confidence || primary.confidence;
        const kind = override.kind || LIST_KIND[list] || 'tool';
        const category = override.category || (kind === 'tool' ? 'tool' : LIST_CATEGORY[list]);
        const schema = fal ? schemas[fal] : null;

        const entry = {
            key,
            name: scrubText(override.name || primary.name || key),
            list,
            lists,
            models: [...new Set(group.map((row) => row.model_id).filter(Boolean))],
            fal: fal || null,
            confidence,
            kind,
            category,
            enabled: false,
        };
        if (primary.fallback_endpoint) entry.fallback = primary.fallback_endpoint;

        const reasons = [];
        if (!fal) reasons.push(`no fal equivalent: ${shortNote(override.reason || primary.notes)}`);
        else if (!(confidence === 'high' || confidence === 'medium')) reasons.push(`${confidence} confidence mapping: ${shortNote(override.reason || primary.notes)}`);
        if (fal && !schema) {
            const listed = listing[fal];
            reasons.push(`fal input schema for ${fal} was not captured${listed ? ` (listed by fal as ${listed[0] || 'unknown'})` : ''}`);
        }
        if (override.disable) reasons.push(override.disable);

        if (schema) {
            const derived = deriveInputSpec({
                pm, vt,
                fixedParams: mergeMaps(primary.fixed_params, null),
                dropParams: primary.drop_params,
                schema,
                override,
            });
            entry.input = derived.spec;
            if (derived.placeholders.length) reasons.push(`needs operator configuration: ${derived.placeholders.join(', ')}`);
            if (derived.unparsed.length) report.unparsed[key] = derived.unparsed;

            const variants = [];
            for (const variant of variantPlan(primary, override, fal)) {
                const variantSchema = schemas[variant.fal];
                if (!variantSchema) {
                    report.variantsMissing.push(`${key} → ${variant.fal}`);
                    reasons.push(`fal input schema for variant ${variant.fal} was not captured`);
                    continue;
                }
                const derivedVariant = deriveInputSpec({
                    pm: mergeMaps(pm, variant.param_map),
                    vt: mergeMaps(vt, variant.value_transforms),
                    fixedParams: mergeMaps(primary.fixed_params, variant.fixed_params),
                    dropParams: primary.drop_params,
                    schema: variantSchema,
                    override: {
                        ...override,
                        reviewed: true,
                        transforms: [...(variant.inherit_transforms === false ? [] : override.transforms || []), ...(variant.transforms || [])],
                        fixed: { ...(override.fixed || {}), ...(variant.fixed || {}) },
                        drop: [...(override.drop || []), ...(variant.drop || [])],
                        rename: { ...(override.rename || {}), ...(variant.rename || {}) },
                    },
                });
                const built = { when: variant.when, fal: variant.fal, input: derivedVariant.spec };
                if (variant.output) built.output = variant.output;
                variants.push(built);
            }
            if (variants.length) entry.variants = variants;
        }
        if (override.resolve) entry.resolve = override.resolve;
        if (override.steps) {
            entry.steps = override.steps;
            for (const step of [...(override.steps.before || []), ...(override.steps.after || [])]) {
                const stepFal = STEP_ENDPOINTS[step?.op];
                if (!stepFal) reasons.push(`unknown step ${step?.op}`);
                else if (!schemas[stepFal]) reasons.push(`fal input schema for step ${stepFal} was not captured`);
            }
        }
        if (override.served_by) entry.served_by = scrubText(override.served_by);
        const status = fal ? (schemas[fal]?.status || listing[fal]?.[0] || null) : null;
        if (status && status !== 'active') entry.fal_status = status;
        const thumbnail = fal ? thumbnails[fal] : null;
        if (typeof thumbnail === 'string' && THUMBNAIL_URL.test(thumbnail)) entry.thumbnail = thumbnail;
        const unsupported = group.filter((row) => row !== primary && row.model_id
            && (!(row.confidence === 'high' || row.confidence === 'medium') || !row.fal_endpoint)).map((row) => row.model_id);
        if (unsupported.length) entry.unsupported_models = [...new Set(unsupported)];

        entry.output = override.output || outputPathFor(primary.output_path, schema);
        entry.output_kind = outputKindOf(entry.output, kind);
        entry.pricing = override.pricing || PRICING[category] || PRICING.tool;
        const defaults = {};
        const durationDefault = schema?.input?.duration?.default;
        if (durationDefault !== undefined && durationDefault !== 'auto') defaults.duration = durationDefault;
        if (schema?.input?.num_images?.default !== undefined) defaults.num_images = schema.input.num_images.default;
        if (Object.keys(defaults).length) entry.defaults = defaults;
        entry.est_usd = estimate(entry.pricing, defaults);

        entry.enabled = reasons.length === 0 && Boolean(entry.input);
        if (!entry.enabled) entry.reason = reasons.join('; ') || 'not available';
        entries.push(entry);
    }

    entries.sort((a, b) => LIST_ORDER.indexOf(a.list) - LIST_ORDER.indexOf(b.list) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const summary = {};
    for (const entry of entries) {
        for (const list of entry.lists) {
            summary[list] ||= { enabled: 0, disabled: 0 };
            summary[list][entry.enabled ? 'enabled' : 'disabled'] += 1;
        }
    }
    const catalog = {
        version: 1,
        generated_by: 'scripts/build-gateway-catalog.mjs',
        counts: {
            entries: entries.length,
            enabled: entries.filter((entry) => entry.enabled).length,
            disabled: entries.filter((entry) => !entry.enabled).length,
            by_list: summary,
        },
        entries,
    };
    // One entry per line: small enough to ship, still diffable per model.
    const head = JSON.stringify({ ...catalog, entries: [] }).replace(/"entries":\[\]\}$/, '"entries":[\n');
    const text = `${head}${entries.map((entry) => JSON.stringify(entry)).join(',\n')}\n]}\n`;
    JSON.parse(text);
    if (/muapi/i.test(text)) throw new Error('catalog.json would contain the legacy vendor name; scrub the sources');
    return { catalog, text, report };
}

function estimate(pricing, defaults) {
    if (pricing.per === '5s') {
        const seconds = Number.parseFloat(defaults.duration) || 5;
        return Math.round(pricing.usd * (seconds / 5) * 10000) / 10000;
    }
    if (pricing.per === 'image') return Math.round(pricing.usd * (Number(defaults.num_images) || 1) * 10000) / 10000;
    return pricing.usd;
}

/* ───────────────────────────── main ───────────────────────────── */

function main() {
    const argv = process.argv.slice(2);
    const importIndex = argv.indexOf('--import');
    if (importIndex !== -1) {
        const dir = argv[importIndex + 1];
        if (!dir) throw new Error('--import needs a directory');
        importResearch(dir);
    }
    const { catalog, text, report } = build();
    if (argv.includes('--check')) {
        const current = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : '';
        if (current !== text) {
            console.error('lib/gateway/catalog/catalog.json is stale — run: node scripts/build-gateway-catalog.mjs');
            process.exit(1);
        }
        console.log('catalog.json is up to date');
        return;
    }
    fs.writeFileSync(OUT_FILE, text);
    const { counts } = catalog;
    console.log(`catalog.json: ${counts.entries} entries (${counts.enabled} enabled, ${counts.disabled} disabled)`);
    for (const [list, count] of Object.entries(counts.by_list)) console.log(`  ${list.padEnd(20)} enabled ${String(count.enabled).padStart(3)}  disabled ${String(count.disabled).padStart(3)}`);
    const pending = Object.entries(report.unparsed).filter(([key]) => catalog.entries.find((entry) => entry.key === key.split(' ⇒ ')[0])?.enabled);
    if (pending.length) {
        console.log(`  ${pending.length} enabled entries carry mapping notes not expressed as ops${argv.includes('--verbose') ? ':' : ' (--verbose to list)'}`);
        if (argv.includes('--verbose')) for (const [key, notes] of pending) console.log(`   - ${key}\n       ${notes.join('\n       ')}`);
    }
}

main();
