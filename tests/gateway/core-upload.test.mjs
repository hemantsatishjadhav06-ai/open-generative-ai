// Gateway core: upload policy (blocked types, magic bytes, size caps), the
// edge body-size guard and the src/ re-export.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAX_UPLOAD_REQUEST_BYTES, UPLOAD_LIMITS, checkUpload, isBlockedFileType, sniffMediaType } from '../../lib/uploadPolicy.js';
import { isBlockedFileType as reexported } from '../../src/lib/uploadProxyTarget.js';
import { MAX_JSON_BODY_BYTES, bodyTooLarge, maxBodyBytes } from '../../lib/proxyGuards.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'media');
const fixture = (name) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));
const MB = 1024 * 1024;

test('fixtures are sniffed as what they are', () => {
    assert.deepEqual(sniffMediaType(fixture('sample.png')), { mime: 'image/png', kind: 'image' });
    assert.deepEqual(sniffMediaType(fixture('sample.jpg')), { mime: 'image/jpeg', kind: 'image' });
    assert.deepEqual(sniffMediaType(fixture('sample.mp4')), { mime: 'video/mp4', kind: 'video' });
    assert.deepEqual(sniffMediaType(fixture('sample.mp3')), { mime: 'audio/mpeg', kind: 'audio' });
    assert.deepEqual(sniffMediaType(fixture('sample.wav')), { mime: 'audio/wav', kind: 'audio' });
});

test('other common formats by magic bytes', () => {
    const bytes = (...b) => new Uint8Array(b);
    const text = (s) => new TextEncoder().encode(s);
    assert.equal(sniffMediaType(text('GIF89a......')).mime, 'image/gif');
    assert.equal(sniffMediaType(text('RIFF\0\0\0\0WEBPVP8 ')).mime, 'image/webp');
    assert.equal(sniffMediaType(text('\0\0\0\x18ftypheic\0\0\0\0')).mime, 'image/heic');
    assert.equal(sniffMediaType(text('\0\0\0\x18ftypqt  \0\0\0\0')).mime, 'video/quicktime');
    assert.equal(sniffMediaType(text('\0\0\0\x18ftypM4A \0\0\0\0')).mime, 'audio/mp4');
    assert.equal(sniffMediaType(bytes(0x1a, 0x45, 0xdf, 0xa3, ...text('....webm'))).mime, 'video/webm');
    assert.equal(sniffMediaType(text('OggS\0\x02')).mime, 'audio/ogg');
    assert.equal(sniffMediaType(text('fLaC\0\0\0\x22')).mime, 'audio/flac');
    assert.equal(sniffMediaType(bytes(0xff, 0xfb, 0x90, 0x64)).mime, 'audio/mpeg');
    assert.equal(sniffMediaType(bytes(0xff, 0xf1, 0x50, 0x80)).mime, 'audio/aac');
});

test('HTML, SVG, scripts, PDFs and executables are not media', () => {
    const text = (s) => new TextEncoder().encode(s);
    assert.equal(sniffMediaType(text('<!doctype html><html>')), null);
    assert.equal(sniffMediaType(text('<svg xmlns="http://www.w3.org/2000/svg">')), null);
    assert.equal(sniffMediaType(text('%PDF-1.7\n')), null);
    assert.equal(sniffMediaType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00])), null, 'MZ executable');
    assert.equal(sniffMediaType(new Uint8Array([0x7f, 0x45, 0x4c, 0x46])), null, 'ELF');
    assert.equal(sniffMediaType(new Uint8Array([])), null);
});

test('isBlockedFileType blocks active content by extension or MIME (and src/ re-exports it)', () => {
    assert.equal(reexported, isBlockedFileType);
    assert.equal(isBlockedFileType('a.svg'), true);
    assert.equal(isBlockedFileType('x', 'text/html; charset=utf-8'), true);
    assert.equal(isBlockedFileType('A.JS'), true);
    assert.equal(isBlockedFileType('a.png', 'image/svg+xml'), true);
    assert.equal(isBlockedFileType('run.exe'), true);
    assert.equal(isBlockedFileType('a.png', 'image/png'), false);
    assert.equal(isBlockedFileType('noext'), false);
    assert.equal(isBlockedFileType('', ''), false);
});

test('checkUpload: accepts real media, uses the sniffed MIME', () => {
    const png = fixture('sample.png');
    assert.deepEqual(checkUpload({ name: 'ref.png', type: 'image/png', size: png.length, head: png }), { ok: true, mime: 'image/png', kind: 'image' });
    // A nameless Blob with no type (canvas export) is identified by content.
    assert.deepEqual(checkUpload({ name: '', type: '', size: png.length, head: png }), { ok: true, mime: 'image/png', kind: 'image' });
    // A mislabelled-but-harmless type is corrected (jpeg bytes named .png).
    const jpg = fixture('sample.jpg');
    assert.equal(checkUpload({ name: 'x.png', type: 'image/png', size: jpg.length, head: jpg }).mime, 'image/jpeg');
    // Browsers label some audio as video/*; audio and video may swap.
    const mp3 = fixture('sample.mp3');
    assert.equal(checkUpload({ name: 'voice.webm', type: 'video/webm', size: mp3.length, head: mp3 }).ok, true);
});

test('checkUpload: refuses blocked, disguised, empty, mismatched and oversized files', () => {
    const png = fixture('sample.png');
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    assert.equal(checkUpload({ name: 'x.html', type: 'text/html', size: 10, head: html }).error, 'blocked_file_type');
    assert.equal(checkUpload({ name: 'x.png', type: 'image/png', size: html.length, head: html }).error, 'unsupported_file_type', 'HTML renamed to .png');
    assert.equal(checkUpload({ name: 'x.png', type: 'image/png', size: 0, head: png }).error, 'empty_file');
    const mp4 = fixture('sample.mp4');
    assert.equal(checkUpload({ name: 'x.png', type: 'image/png', size: mp4.length, head: mp4 }).error, 'mismatched_file_type');
    const tooBig = checkUpload({ name: 'x.png', type: 'image/png', size: UPLOAD_LIMITS.image + 1, head: png });
    assert.equal(tooBig.ok, false);
    assert.equal(tooBig.status, 413);
    assert.match(tooBig.message, /max 25 MB/);
    assert.equal(checkUpload({ name: 'a.mp3', type: 'audio/mpeg', size: 51 * MB, head: fixture('sample.mp3') }).status, 413);
    assert.equal(checkUpload({ name: 'a.mp4', type: 'video/mp4', size: 199 * MB, head: mp4 }).ok, true);
    assert.equal(checkUpload({ name: 'a.mp4', type: 'video/mp4', size: 201 * MB, head: mp4 }).status, 413);
});

test('caps: image 25 MB, audio 50 MB, video 200 MB', () => {
    assert.deepEqual(UPLOAD_LIMITS, { image: 25 * MB, audio: 50 * MB, video: 200 * MB });
    assert.ok(MAX_UPLOAD_REQUEST_BYTES > UPLOAD_LIMITS.video);
});

test('edge body guard: the upload route allows 200 MB videos, JSON routes stay small', () => {
    const h = (n) => new Headers({ 'content-length': String(n) });
    assert.equal(bodyTooLarge(new Headers({})), false, 'unknown length passes (routes cap while reading)');
    assert.equal(bodyTooLarge(h(150 * MB), '/api/v1/upload_file'), false);
    assert.equal(bodyTooLarge(h(203 * MB), '/api/v1/upload_file'), true);
    assert.equal(bodyTooLarge(h(21 * MB), '/api/v1/flux-dev-image'), true);
    assert.equal(bodyTooLarge(h(1 * MB), '/api/llm/chat'), false);
    assert.equal(maxBodyBytes('/api/session'), MAX_JSON_BODY_BYTES);
    // Callers that pass no pathname get the largest legitimate cap.
    assert.equal(bodyTooLarge(h(150 * MB)), false);
    assert.equal(bodyTooLarge(h(250 * MB)), true);
});
