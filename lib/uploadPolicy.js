// Upload policy for POST /api/v1/upload_file: which files may be uploaded,
// how big they may be, and what they really are (magic-byte sniffing, so a
// renamed HTML/SVG/executable never reaches the CDN as an "image").

const BLOCKED_EXTENSIONS = new Set([
    'html', 'htm', 'xhtml', 'svg', 'svgz', 'php', 'phtml', 'php3', 'php4', 'php5', 'phps',
    'exe', 'bat', 'cmd', 'sh', 'bash', 'js', 'mjs', 'cjs', 'cgi', 'pl', 'py', 'jar', 'vbs', 'scr', 'msi',
    'com', 'dll', 'ps1', 'apk', 'app', 'dmg', 'hta', 'xml', 'swf',
]);

const BLOCKED_MIME_TYPES = new Set([
    'text/html',
    'image/svg+xml',
    'application/xhtml+xml',
    'application/xml',
    'text/xml',
    'application/x-httpd-php',
    'application/x-msdownload',
    'application/x-executable',
    'application/x-sh',
    'application/x-shellscript',
    'application/javascript',
    'text/javascript',
    'application/x-shockwave-flash',
]);

export function isBlockedFileType(filename = '', contentType = '') {
    if (contentType) {
        const normalizedMime = String(contentType).toLowerCase().split(';')[0].trim();
        if (BLOCKED_MIME_TYPES.has(normalizedMime)) {
            return true;
        }
    }
    if (filename) {
        const parts = String(filename).toLowerCase().split('.');
        if (parts.length > 1) {
            const ext = parts[parts.length - 1].trim();
            if (BLOCKED_EXTENSIONS.has(ext)) {
                return true;
            }
        }
    }
    return false;
}

const MB = 1024 * 1024;

// Size caps per media kind.
export const UPLOAD_LIMITS = {
    image: 25 * MB,
    audio: 50 * MB,
    video: 200 * MB,
};

// Largest request the upload route accepts (video cap + multipart overhead).
export const MAX_UPLOAD_REQUEST_BYTES = UPLOAD_LIMITS.video + 2 * MB;

const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));

// Identifies a media file from its first bytes → {mime, kind} | null.
export function sniffMediaType(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
    if (bytes.length < 4) return null;
    const b = bytes;
    // Images
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', kind: 'image' };
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', kind: 'image' };
    if (ascii(b, 0, 4) === 'GIF8') return { mime: 'image/gif', kind: 'image' };
    if (ascii(b, 0, 4) === 'RIFF' && b.length >= 12 && ascii(b, 8, 12) === 'WEBP') return { mime: 'image/webp', kind: 'image' };
    if (b[0] === 0x42 && b[1] === 0x4d && b.length >= 26) return { mime: 'image/bmp', kind: 'image' };
    if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)) {
        return { mime: 'image/tiff', kind: 'image' };
    }
    // ISO BMFF (mp4 / mov / m4a / heic / avif) — "ftyp" at offset 4
    if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
        const brand = ascii(b, 8, 12).toLowerCase();
        if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return { mime: 'image/heic', kind: 'image' };
        if (brand === 'avif' || brand === 'avis') return { mime: 'image/avif', kind: 'image' };
        if (brand.startsWith('m4a') || brand === 'm4b ' || brand === 'f4a ') return { mime: 'audio/mp4', kind: 'audio' };
        if (brand === 'qt  ') return { mime: 'video/quicktime', kind: 'video' };
        return { mime: 'video/mp4', kind: 'video' };
    }
    // Matroska / WebM
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
        const head = ascii(b, 0, Math.min(b.length, 64));
        return head.includes('webm') ? { mime: 'video/webm', kind: 'video' } : { mime: 'video/x-matroska', kind: 'video' };
    }
    if (ascii(b, 0, 4) === 'RIFF' && b.length >= 12) {
        const form = ascii(b, 8, 12);
        if (form === 'WAVE') return { mime: 'audio/wav', kind: 'audio' };
        if (form === 'AVI ') return { mime: 'video/x-msvideo', kind: 'video' };
    }
    // Audio
    if (ascii(b, 0, 3) === 'ID3') return { mime: 'audio/mpeg', kind: 'audio' };
    if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) {
        // MPEG audio frame sync; layer bits 00 = reserved. 0xFFF1/0xFFF9 = AAC ADTS.
        if ((b[1] & 0xf6) === 0xf0) return { mime: 'audio/aac', kind: 'audio' };
        if ((b[1] & 0x06) !== 0) return { mime: 'audio/mpeg', kind: 'audio' };
    }
    if (ascii(b, 0, 4) === 'OggS') return { mime: 'audio/ogg', kind: 'audio' };
    if (ascii(b, 0, 4) === 'fLaC') return { mime: 'audio/flac', kind: 'audio' };
    // MPEG-TS / MPEG-PS video
    if (b[0] === 0x47 && b.length >= 189 && b[188] === 0x47) return { mime: 'video/mp2t', kind: 'video' };
    if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0xba) return { mime: 'video/mpeg', kind: 'video' };
    return null;
}

function declaredKind(contentType) {
    const top = String(contentType || '').toLowerCase().split('/')[0];
    return top === 'image' || top === 'audio' || top === 'video' ? top : null;
}

// Decides whether an upload is allowed.
// → {ok:true, mime, kind} | {ok:false, status, error, message}
export function checkUpload({ name = '', type = '', size = 0, head }) {
    if (isBlockedFileType(name, type)) {
        return { ok: false, status: 415, error: 'blocked_file_type', message: "That file type isn't allowed. Upload an image, audio or video file." };
    }
    if (!Number.isFinite(size) || size <= 0) {
        return { ok: false, status: 400, error: 'empty_file', message: 'The file is empty.' };
    }
    const sniffed = sniffMediaType(head);
    if (!sniffed) {
        return { ok: false, status: 415, error: 'unsupported_file_type', message: "That file doesn't look like an image, audio or video file." };
    }
    const declared = declaredKind(type);
    // A declared image that is really audio/video (or vice versa) is refused;
    // browsers label some audio as video/mp4 or webm, which is allowed.
    const audioVideo = new Set(['audio', 'video']);
    if (declared && declared !== sniffed.kind && !(audioVideo.has(declared) && audioVideo.has(sniffed.kind))) {
        return { ok: false, status: 415, error: 'mismatched_file_type', message: "The file's contents don't match its type." };
    }
    const limit = UPLOAD_LIMITS[sniffed.kind];
    if (size > limit) {
        return { ok: false, status: 413, error: 'file_too_large', message: `That ${sniffed.kind} is too large (max ${Math.round(limit / MB)} MB).` };
    }
    return { ok: true, mime: sniffed.mime, kind: sniffed.kind };
}

// Playback length in seconds read from the file itself, or null when the
// container doesn't say (used to price and cap work that scales with length,
// e.g. transcription). ISO BMFF (mp4/mov/m4a): the `mvhd` box; WAV: data
// size ÷ byte rate.
export function mediaDurationSeconds(input) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input || []);
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
        // Scan for the mvhd box (moov may sit at the start or the end).
        const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
        for (let i = buf.indexOf('mvhd', 4); i !== -1 && i + 24 <= b.length; i = buf.indexOf('mvhd', i + 4)) {
            const version = b[i + 4];
            let timescale;
            let duration;
            if (version === 1 && i + 36 <= b.length) {
                timescale = view.getUint32(i + 24);
                duration = Number(view.getBigUint64(i + 28));
            } else if (version === 0) {
                timescale = view.getUint32(i + 16);
                duration = view.getUint32(i + 20);
            } else {
                continue;
            }
            if (timescale > 0 && duration > 0 && duration !== 0xffffffff) return duration / timescale;
        }
        return null;
    }
    if (b.length >= 44 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE') {
        let byteRate = 0;
        for (let i = 12; i + 8 <= b.length;) {
            const id = ascii(b, i, i + 4);
            const size = view.getUint32(i + 4, true);
            if (id === 'fmt ' && i + 20 <= b.length) byteRate = view.getUint32(i + 16, true);
            if (id === 'data' && byteRate > 0) return size / byteRate;
            i += 8 + size + (size % 2);
        }
    }
    return null;
}
