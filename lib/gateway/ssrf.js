// SSRF protection (port of reelty src/lib/net/ssrf.ts, no extra deps).
//
// - assertPublicMediaUrl(url): for media URLs the browser hands us that we
//   pass on to fal as model inputs. http(s) only, no credentials, and the
//   host must not resolve to a private / loopback / link-local / metadata
//   range. fal's own CDN and the configured upstream hosts are trusted.
// - safeFetch(url, init): for any fetch the SERVER makes of a user-supplied
//   URL (clipping, re-hosting). Validation happens at connect time through a
//   validating DNS lookup (closes the DNS-rebinding gap) and on every
//   redirect hop.

import dnsPromises from 'node:dns/promises';
import { lookup as dnsLookupCb } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Readable } from 'node:stream';
import { trustedMediaHosts } from './config.js';
import { GatewayError } from './errors.js';

export function privateIpv4(address) {
    const parts = String(address).split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true; // loopback
    if (a === 0) return true; // "this" network
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 protocol assignments + 192.0.2.0/24 docs
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast / reserved
    return false;
}

// IPv6 text (any notation, incl. an embedded dotted IPv4 tail) → 8 16-bit
// words, or null when it doesn't parse.
export function ipv6Words(address) {
    let value = String(address || '').toLowerCase().split('%')[0].replace(/^\[|\]$/g, '');
    if (!value.includes(':')) return null;
    if (value.includes('.')) {
        const cut = value.lastIndexOf(':');
        const v4 = value.slice(cut + 1).split('.').map((n) => (/^\d{1,3}$/.test(n) ? Number(n) : NaN));
        if (v4.length !== 4 || v4.some((n) => !(n >= 0 && n <= 255))) return null;
        value = `${value.slice(0, cut + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
    }
    const halves = value.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - head.length - tail.length;
    if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
    const words = [...head, ...Array(missing).fill('0'), ...tail].map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
    return words.length === 8 && words.every((w) => Number.isInteger(w)) ? words : null;
}

// Blocks every IPv6 range that is not plain global unicast, or that can
// wrap an IPv4 address (whatever the notation: ::7f00:1 is ::127.0.0.1).
export function privateIpv6(address) {
    const w = ipv6Words(address);
    if (!w) return true;
    const zeros = (from, to) => w.slice(from, to).every((x) => x === 0);
    if (zeros(0, 5) && w[5] === 0xffff) {
        // IPv4-mapped ::ffff:a.b.c.d → check the IPv4 address.
        return privateIpv4(`${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`);
    }
    if (zeros(0, 6)) return true; // ::/96: unspecified, loopback, IPv4-compatible (deprecated)
    if (zeros(0, 4) && w[4] === 0xffff && w[5] === 0) return true; // ::ffff:0:0:0/96 (SIIT)
    if ((w[0] & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
    if ((w[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
    if ((w[0] & 0xffc0) === 0xfec0) return true; // site-local fec0::/10 (deprecated)
    if ((w[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
    if (w[0] === 0x0100 && zeros(1, 4)) return true; // discard-only 100::/64
    if (w[0] === 0x2001 && w[1] < 0x0200) return true; // 2001::/23 IETF assignments incl. Teredo 2001::/32
    if (w[0] === 0x2001 && w[1] === 0x0db8) return true; // documentation 2001:db8::/32
    if (w[0] === 0x2002) return true; // 6to4 2002::/16 (wraps an IPv4)
    if (w[0] === 0x0064 && w[1] === 0xff9b) return true; // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
    if (w[0] === 0x3fff && w[1] < 0x1000) return true; // documentation 3fff::/20
    if (w[0] < 0x2000 || w[0] > 0x3fff) return true; // outside global unicast 2000::/3
    return false;
}

export function isPrivateAddress(address, family) {
    const fam = family === 6 || family === 'IPv6' ? 6 : (family === 4 || family === 'IPv4' ? 4 : net.isIP(address));
    return fam === 6 ? privateIpv6(address) : privateIpv4(address);
}

const BLOCKED_NAMES = new Set(['localhost', '0.0.0.0', 'ip6-localhost', 'ip6-loopback', 'metadata.google.internal', 'metadata']);
// fal's public CDN: generated outputs and uploads live here.
const TRUSTED_SUFFIXES = ['.fal.media'];
const TRUSTED_EXACT = new Set(['fal.media']);

function isTrustedHost(host) {
    const h = host.toLowerCase().replace(/\.$/, '');
    if (TRUSTED_EXACT.has(h)) return true;
    if (TRUSTED_SUFFIXES.some((suffix) => h.endsWith(suffix) && h.length > suffix.length)) return true;
    return trustedMediaHosts().has(h);
}

function bare(hostname) {
    return String(hostname || '').replace(/^\[|\]$/g, '');
}

function reject(message, field) {
    return new GatewayError(400, 'invalid_url', message, { field });
}

// Syntactic checks shared by both entry points. Returns the parsed URL.
export function parsePublicUrl(raw, field) {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 4096) throw reject('A media URL is missing or too long.', field);
    let url;
    try {
        url = new URL(raw.trim());
    } catch {
        throw reject('That media URL is not valid.', field);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw reject('Only http(s) media URLs are allowed.', field);
    if (url.username || url.password) throw reject('Media URLs must not contain credentials.', field);
    const host = bare(url.hostname).toLowerCase();
    if (!host) throw reject('That media URL has no host.', field);
    return { url, host };
}

const dnsCache = () => {
    const key = Symbol.for('aquora.gateway.dnsCache');
    if (!globalThis[key]) globalThis[key] = new Map();
    return globalThis[key];
};

async function resolveAll(host) {
    const cache = dnsCache();
    const hit = cache.get(host);
    if (hit && hit.until > Date.now()) return hit.records;
    const records = await dnsPromises.lookup(host, { all: true, verbatim: true });
    if (cache.size > 2000) cache.clear();
    cache.set(host, { records, until: Date.now() + 5 * 60_000 });
    return records;
}

// Validates a URL for a server-side fetch or for handing to fal. Throws a
// 400 GatewayError when it is not a public http(s) destination.
export async function assertPublicMediaUrl(raw, { field } = {}) {
    const { url, host } = parsePublicUrl(raw, field);
    if (isTrustedHost(host)) return url;
    if (BLOCKED_NAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
        throw reject('Private hosts are not allowed.', field);
    }
    const literal = net.isIP(host);
    let records;
    if (literal) {
        records = [{ address: host, family: literal }];
    } else {
        try {
            records = await resolveAll(host);
        } catch {
            throw reject("That media URL's host could not be found.", field);
        }
    }
    if (!records.length) throw reject("That media URL's host could not be found.", field);
    for (const record of records) {
        if (isPrivateAddress(record.address, record.family)) throw reject('URLs that point to a private network are not allowed.', field);
    }
    return url;
}

export const assertFetchAllowed = (raw) => assertPublicMediaUrl(raw);

// DNS lookup that refuses private answers; used as the socket's lookup so the
// address actually connected to is the one validated.
export function validatingLookup(hostname, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    const trusted = isTrustedHost(bare(hostname));
    dnsLookupCb(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err);
        const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options?.family || 4 }];
        if (!trusted) {
            for (const record of list) {
                if (isPrivateAddress(record.address, record.family)) {
                    return callback(Object.assign(new Error('SSRF: refused connection to private address'), { code: 'ESSRF' }));
                }
            }
        }
        if (options?.all) return callback(null, list);
        return callback(null, list[0].address, list[0].family);
    });
}

function requestOnce(url, { method = 'GET', headers = {}, body, signal, timeoutMs = 60_000 }) {
    return new Promise((resolve, reject) => {
        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.request(url, { method, headers, lookup: validatingLookup, signal, timeout: timeoutMs }, (res) => {
            const responseHeaders = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
                if (Array.isArray(value)) value.forEach((v) => responseHeaders.append(key, v));
                else if (value !== undefined) responseHeaders.set(key, String(value));
            }
            const status = res.statusCode || 502;
            const nullBody = status === 204 || status === 304 || method === 'HEAD';
            if (nullBody) res.resume();
            resolve(new Response(nullBody ? null : Readable.toWeb(res), { status, statusText: res.statusMessage, headers: responseHeaders }));
        });
        req.on('timeout', () => req.destroy(Object.assign(new Error('Request timed out'), { name: 'TimeoutError' })));
        req.on('error', reject);
        if (body !== undefined && body !== null) req.end(body);
        else req.end();
    });
}

// fetch()-like helper for user-supplied URLs: validates each hop, connects
// through the validating lookup and follows at most `maxHops` redirects.
export async function safeFetch(rawUrl, init = {}, maxHops = 5) {
    let current = rawUrl;
    for (let hop = 0; hop <= maxHops; hop++) {
        const url = await assertPublicMediaUrl(current);
        const response = await requestOnce(url, init);
        if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
            await response.body?.cancel?.();
            current = new URL(response.headers.get('location'), url).toString();
            continue;
        }
        return response;
    }
    throw reject('Too many redirects.');
}

// Downloads a user-supplied URL into a Buffer with a hard size cap.
export async function safeDownload(rawUrl, { maxBytes = 200 * 1024 * 1024, timeoutMs = 120_000, signal } = {}) {
    const response = await safeFetch(rawUrl, { timeoutMs, signal });
    if (!response.ok) throw new GatewayError(400, 'download_failed', `Couldn't download that file (HTTP ${response.status}).`);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel?.();
        throw new GatewayError(413, 'payload_too_large', 'That file is too large.');
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
        total += chunk.byteLength;
        if (total > maxBytes) throw new GatewayError(413, 'payload_too_large', 'That file is too large.');
        chunks.push(Buffer.from(chunk));
    }
    return { buffer: Buffer.concat(chunks), contentType: response.headers.get('content-type') || 'application/octet-stream' };
}
