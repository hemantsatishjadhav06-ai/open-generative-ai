// Structured transform ops for the gateway catalog.
//
// Every op is a pure function over a mutable "working" object (the studio
// payload after renames). Ops are declared in catalog.json as
// `{ op, field, ...args }` and applied in order by applyTransforms().
// They never throw on odd input: an op that cannot apply leaves the value as
// is, and validation (index.js) decides whether the result is acceptable.

const RATIO_RE = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/;
const NUMERIC_RE = /^\s*(-?\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i;

export function isBlank(value) {
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function hasOwn(object, key) {
    return object !== null && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key);
}

// `a.b`, `a[0].b` → ['a', 'b'] / ['a', 0, 'b']
export function parsePath(path) {
    const parts = [];
    for (const segment of String(path).split('.')) {
        const match = /^([^[\]]+)((?:\[\d+\])*)$/.exec(segment);
        if (!match) return [String(path)];
        parts.push(match[1]);
        for (const index of match[2].matchAll(/\[(\d+)\]/g)) parts.push(Number(index[1]));
    }
    return parts;
}

export function setPath(target, path, value) {
    const parts = parsePath(path);
    let node = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        const nextIsIndex = typeof parts[i + 1] === 'number';
        if (node[key] === undefined || node[key] === null || typeof node[key] !== 'object') {
            node[key] = nextIsIndex ? [] : {};
        }
        node = node[key];
    }
    node[parts[parts.length - 1]] = value;
    return target;
}

export function getPath(source, path) {
    let node = source;
    for (const key of parsePath(path)) {
        if (node === null || node === undefined) return undefined;
        node = node[key];
    }
    return node;
}

export function parseRatio(value) {
    const match = RATIO_RE.exec(String(value ?? ''));
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!(width > 0) || !(height > 0)) return null;
    return { width, height, value: width / height };
}

// '5' → {n:5,unit:''}, '720p' → {n:720,unit:'p'}, '8s' → {n:8,unit:'s'},
// '2K' → {n:2,unit:'k'}, 5 → {n:5,unit:''}
export function parseNumeric(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return { n: value, unit: '' };
    if (typeof value !== 'string') return null;
    const match = NUMERIC_RE.exec(value);
    if (!match) return null;
    return { n: Number(match[1]), unit: match[2].toLowerCase() };
}

function toFiniteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean') return null;
    const parsed = parseNumeric(value);
    return parsed ? parsed.n : null;
}

function roundTo(value, multiple) {
    const step = Number(multiple) > 0 ? Number(multiple) : 1;
    // Exact halves round down so a 720-line frame stays within 720 (1280x704).
    return Math.max(step, Math.round(value / step - 1e-9) * step);
}

const VIDEO_UNITS = new Set(['k', 'p']);
const K_LINES = { 0.5: 540, 1: 1080, 2: 1440, 4: 2160, 8: 4320 };

function toLines(parsed) {
    if (parsed.unit !== 'k') return parsed;
    return { n: K_LINES[parsed.n] ?? Math.round(parsed.n * 1080), unit: 'p' };
}

// Snap `value` onto one of `values`:
//   exact → case-insensitive → alias → nearest aspect ratio → nearest number
//   with the same unit (ties round up). Returns undefined when nothing fits.
export function snapToEnum(value, values, aliases = {}) {
    if (!Array.isArray(values) || values.length === 0) return value;
    if (values.includes(value)) return value;
    const text = String(value);
    const folded = values.find((candidate) => String(candidate).toLowerCase() === text.toLowerCase());
    if (folded !== undefined) return folded;
    for (const [from, to] of Object.entries(aliases || {})) {
        if (from.toLowerCase() === text.toLowerCase() && values.includes(to)) return to;
    }
    // Stringly-typed enums of numbers ('5', '10') accept numeric input.
    if (typeof value === 'number' && values.includes(String(value))) return String(value);
    if (typeof value === 'string' && values.includes(Number(value))) return Number(value);

    const ratio = parseRatio(value);
    if (ratio) {
        let best;
        let bestDistance = Infinity;
        for (const candidate of values) {
            const candidateRatio = parseRatio(candidate);
            if (!candidateRatio) continue;
            const distance = Math.abs(Math.log(candidateRatio.value) - Math.log(ratio.value));
            if (distance < bestDistance - 1e-9) {
                best = candidate;
                bestDistance = distance;
            }
        }
        return best;
    }

    const numeric = parseNumeric(value);
    if (numeric) {
        let best;
        let bestDistance = Infinity;
        let bestNumber = -Infinity;
        for (const candidate of values) {
            let candidateNumeric = parseNumeric(candidate);
            if (!candidateNumeric) continue;
            let own = numeric;
            if (candidateNumeric.unit !== own.unit && VIDEO_UNITS.has(candidateNumeric.unit) && VIDEO_UNITS.has(own.unit)) {
                // '4k' vs '2160p': compare as vertical lines.
                own = toLines(own);
                candidateNumeric = toLines(candidateNumeric);
            }
            if (candidateNumeric.unit !== own.unit && !(own.unit === '' || candidateNumeric.unit === '')) continue;
            const distance = Math.abs(candidateNumeric.n - own.n);
            // Ties round up (5 between '4s' and '6s' → '6s').
            if (distance < bestDistance - 1e-9 || (Math.abs(distance - bestDistance) <= 1e-9 && candidateNumeric.n > bestNumber)) {
                best = candidate;
                bestDistance = distance;
                bestNumber = candidateNumeric.n;
            }
        }
        return best;
    }
    return undefined;
}

function toBool(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const text = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(text)) return true;
        if (['false', '0', 'no', 'off'].includes(text)) return false;
    }
    return undefined;
}

function lookup(map, value) {
    if (!map || isBlank(value) && value !== '') return { found: false };
    const key = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (hasOwn(map, key)) return { found: true, value: map[key] };
    const folded = Object.keys(map).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (folded !== undefined) return { found: true, value: map[folded] };
    return { found: false };
}

function sizeFromRatio(ratio, size, measure, multiple, bounds = {}) {
    let width;
    let height;
    if (measure === 'area') {
        width = Math.sqrt(size * ratio);
        height = width / ratio;
    } else if (measure === 'short_edge') {
        if (ratio >= 1) { height = size; width = size * ratio; } else { width = size; height = size / ratio; }
    } else {
        if (ratio >= 1) { width = size; height = size / ratio; } else { height = size; width = size * ratio; }
    }
    const clampSide = (side) => {
        let value = roundTo(side, multiple);
        if (Number.isFinite(bounds.min)) value = Math.max(bounds.min, value);
        if (Number.isFinite(bounds.max)) value = Math.min(bounds.max, value);
        return value;
    };
    return { width: clampSide(width), height: clampSide(height) };
}

function consume(work, from, field) {
    if (from && from !== field) delete work[from];
}

export const OPS = {
    // Move a value to a nested path, e.g. voice_id → voice_setting.voice_id.
    rename_nested(work, { from, to }) {
        if (!hasOwn(work, from)) return;
        const value = work[from];
        delete work[from];
        if (isBlank(value)) return;
        setPath(work, to, value);
    },

    to_string(work, { field }) {
        const value = work[field];
        if (typeof value === 'number' || typeof value === 'boolean') work[field] = String(value);
    },

    to_int(work, { field }) {
        const value = work[field];
        if (typeof value === 'number' && Number.isFinite(value)) { work[field] = Math.round(value); return; }
        const number = toFiniteNumber(value);
        if (number !== null) work[field] = Math.round(number);
    },

    to_number(work, { field }) {
        const number = toFiniteNumber(work[field]);
        if (number !== null) work[field] = number;
    },

    to_bool(work, { field }) {
        const value = toBool(work[field]);
        if (value !== undefined) work[field] = value;
    },

    // args.values defaults to the entry's enum for the field (ctx.enums).
    snap_enum(work, { field, values, aliases, on_miss = 'keep' }, ctx) {
        if (!hasOwn(work, field) || isBlank(work[field])) return;
        const candidates = values || ctx?.enums?.[field];
        if (!candidates) return;
        const snapped = snapToEnum(work[field], candidates, aliases);
        if (snapped !== undefined) work[field] = snapped;
        else if (on_miss === 'omit') delete work[field];
    },

    clamp(work, { field, min, max }, ctx) {
        if (!hasOwn(work, field)) return;
        const number = toFiniteNumber(work[field]);
        if (number === null) return;
        const range = ctx?.ranges?.[field] || [];
        const low = Number.isFinite(min) ? min : range[0];
        const high = Number.isFinite(max) ? max : range[1];
        let value = number;
        if (Number.isFinite(low)) value = Math.max(low, value);
        if (Number.isFinite(high)) value = Math.min(high, value);
        work[field] = value;
    },

    wrap_array(work, { field, from }) {
        const source = from || field;
        if (!hasOwn(work, source)) return;
        const value = work[source];
        consume(work, from, field);
        if (isBlank(value)) { delete work[field]; return; }
        work[field] = Array.isArray(value) ? value.filter((item) => !isBlank(item)) : [value];
        if (work[field].length === 0) delete work[field];
    },

    first_of_array(work, { field, from }) {
        const source = from || field;
        if (!hasOwn(work, source)) return;
        const value = work[source];
        consume(work, from, field);
        const first = Array.isArray(value) ? value.find((item) => !isBlank(item)) : value;
        if (isBlank(first)) delete work[field];
        else work[field] = first;
    },

    slice_array(work, { field, max }) {
        if (Array.isArray(work[field]) && Number.isFinite(max)) work[field] = work[field].slice(0, max);
    },

    // images_list → image_url + end_image_url (to[i] = list[i]).
    split_array(work, { from, to }) {
        if (!hasOwn(work, from)) return;
        const value = work[from];
        delete work[from];
        const list = (Array.isArray(value) ? value : [value]).filter((item) => !isBlank(item));
        (to || []).forEach((target, index) => {
            if (index < list.length && isBlank(work[target])) work[target] = list[index];
        });
    },

    omit_if_negative(work, { field }) {
        if (!hasOwn(work, field)) return;
        const value = work[field];
        if (isBlank(value)) { delete work[field]; return; }
        const number = toFiniteNumber(value);
        if (number !== null && number < 0) delete work[field];
    },

    omit_if(work, { field, values = [] }) {
        if (!hasOwn(work, field)) return;
        const text = String(work[field]).toLowerCase();
        if (values.some((candidate) => String(candidate).toLowerCase() === text)) delete work[field];
    },

    lowercase(work, { field }) {
        if (typeof work[field] === 'string') work[field] = work[field].toLowerCase();
    },

    uppercase(work, { field }) {
        if (typeof work[field] === 'string') work[field] = work[field].toUpperCase();
    },

    // Replace values through a lookup table. With `from`, the source key is
    // read (and removed) and the mapped value is written to `field`.
    // `field` may be a nested path such as audio_setting.format.
    map_values(work, { field, from, map, default: fallback, keep_unmapped = true }) {
        const source = from || field;
        const nested = /[.[]/.test(source);
        const present = nested ? getPath(work, source) !== undefined : hasOwn(work, source);
        const write = (value) => (/[.[]/.test(field) ? setPath(work, field, value) : (work[field] = value));
        const remove = () => {
            if (!/[.[]/.test(field)) { delete work[field]; return; }
            const parts = parsePath(field);
            const parent = getPath(work, parts.slice(0, -1).join('.'));
            if (parent && typeof parent === 'object') delete parent[parts[parts.length - 1]];
        };
        if (!present) {
            if (fallback !== undefined && (nested ? getPath(work, field) === undefined : !hasOwn(work, field))) write(fallback);
            return;
        }
        const value = nested ? getPath(work, source) : work[source];
        consume(work, from, field);
        const hit = lookup(map, value);
        if (hit.found) {
            if (hit.value === null) remove();
            else write(hit.value);
        } else if (fallback !== undefined) {
            write(fallback);
        } else if (keep_unmapped) {
            if (isBlank(value)) remove();
            else write(value);
        } else if (from && from !== field) {
            // unmapped value of a different source key: leave the target unset
        } else {
            remove();
        }
    },

    // aspect_ratio (+ optional tier such as resolution '2K' or quality 'high')
    // → fal image_size: a preset string for known ratios, else {width,height}.
    aspect_to_image_size(work, args) {
        const {
            field = 'image_size',
            from = 'aspect_ratio',
            presets,
            tier_from: tierFrom,
            tiers,
            auto,
            base,
            measure = 'long_edge',
            multiple = 16,
            min,
            max,
        } = args;
        const rawRatio = work[from];
        const tierValue = tierFrom ? work[tierFrom] : undefined;
        consume(work, from, field);
        if (tierFrom && tierFrom !== field) delete work[tierFrom];
        const tierHit = tierValue !== undefined ? lookup(tiers, tierValue) : { found: false };
        const ratio = parseRatio(rawRatio);
        if (!ratio) {
            const autoHit = lookup(auto, tierValue ?? 'default');
            if (autoHit.found) work[field] = autoHit.value;
            else if (auto && hasOwn(auto, 'default')) work[field] = auto.default;
            return;
        }
        const ratioKey = `${ratio.width}:${ratio.height}`;
        if (presets && hasOwn(presets, ratioKey) && !tierHit.found) {
            work[field] = presets[ratioKey];
            return;
        }
        // No tier sent: use the base size, else the first (smallest) tier.
        const fallbackTier = tiers && Object.keys(tiers).length ? Object.values(tiers)[0] : undefined;
        const size = tierHit.found ? Number(tierHit.value) : Number(base ?? fallbackTier);
        if (!(size > 0)) {
            if (presets && hasOwn(presets, ratioKey)) work[field] = presets[ratioKey];
            return;
        }
        work[field] = sizeFromRatio(ratio.value, size, measure, multiple, { min, max });
    },

    // width + height → image_size {width,height}
    dims_to_image_size(work, { field = 'image_size', from = ['width', 'height'], multiple = 1, min, max }) {
        const [widthKey, heightKey] = from;
        const width = toFiniteNumber(work[widthKey]);
        const height = toFiniteNumber(work[heightKey]);
        if (widthKey !== field) delete work[widthKey];
        if (heightKey !== field) delete work[heightKey];
        if (width === null || height === null || width <= 0 || height <= 0) return;
        const side = (value) => {
            let result = multiple > 1 ? roundTo(value, multiple) : Math.round(value);
            if (Number.isFinite(min)) result = Math.max(min, result);
            if (Number.isFinite(max)) result = Math.min(max, result);
            return result;
        };
        work[field] = { width: side(width), height: side(height) };
    },

    // duration (seconds) → num_frames = round(d*fps/multiple)*multiple + add
    duration_to_frames(work, { field = 'num_frames', from = 'duration', fps, add = 1, multiple = 1, min, max, map }) {
        if (!hasOwn(work, from)) return;
        const seconds = toFiniteNumber(work[from]);
        consume(work, from, field);
        if (seconds === null || seconds <= 0) return;
        const hit = lookup(map, seconds);
        let frames = hit.found ? Number(hit.value) : Math.round((seconds * fps) / multiple) * multiple + add;
        if (Number.isFinite(min)) frames = Math.max(min, frames);
        if (Number.isFinite(max)) frames = Math.min(max, frames);
        work[field] = frames;
    },

    default_if_empty(work, { field, value }) {
        if (isBlank(work[field])) work[field] = value;
    },

    copy(work, { field, from }) {
        if (hasOwn(work, from) && !isBlank(work[from]) && isBlank(work[field])) {
            work[field] = Array.isArray(work[from]) ? [...work[from]] : work[from];
        }
    },

    // Studio prompts reference inputs as @image1/@video2/@audio1; fal models
    // document them as @Image1/@Video2/@Audio1.
    capitalize_ref_tokens(work, { field = 'prompt' }) {
        if (typeof work[field] !== 'string') return;
        work[field] = work[field].replace(/@(image|video|audio)(\d+)/gi,
            (_, kind, index) => `@${kind[0].toUpperCase()}${kind.slice(1).toLowerCase()}${index}`);
    },

    // Concatenate several array/string fields into one array (order kept).
    concat_arrays(work, { field, from = [], max }) {
        const merged = [];
        for (const source of from) {
            if (!hasOwn(work, source)) continue;
            const value = work[source];
            if (source !== field) delete work[source];
            for (const item of Array.isArray(value) ? value : [value]) {
                if (!isBlank(item) && !merged.includes(item)) merged.push(item);
            }
        }
        if (merged.length === 0) return;
        work[field] = Number.isFinite(max) ? merged.slice(0, max) : merged;
    },

    // [{text, voice_id}] → [{text, voice}]; `alias` props are squashed to \w+.
    remap_items(work, { field, from, props = {}, alias = [], max }) {
        const source = from || field;
        if (!Array.isArray(work[source])) return;
        const list = work[source];
        consume(work, from, field);
        const mapped = [];
        for (const item of list) {
            if (!item || typeof item !== 'object') continue;
            const next = {};
            for (const [target, key] of Object.entries(props)) {
                let value = item[key];
                if (isBlank(value)) continue;
                if (alias.includes(target)) value = String(value).replace(/\W+/g, '');
                next[target] = value;
            }
            if (Object.keys(next).length > 0) mapped.push(next);
        }
        if (mapped.length === 0) { delete work[field]; return; }
        work[field] = Number.isFinite(max) ? mapped.slice(0, max) : mapped;
    },

    // [{speaker_id:'Speaker 1', text:'Hi'}] → "Speaker1: Hi" lines.
    join_items(work, { field, from, template = '{text}', separator = '\n', alias = [] }) {
        const source = from || field;
        if (!Array.isArray(work[source])) return;
        const list = work[source];
        consume(work, from, field);
        const lines = [];
        for (const item of list) {
            if (typeof item === 'string') { if (item.trim()) lines.push(item.trim()); continue; }
            if (!item || typeof item !== 'object') continue;
            let complete = true;
            const line = template.replace(/\{(\w+)\}/g, (_, key) => {
                const value = item[key];
                if (isBlank(value)) { complete = false; return ''; }
                return alias.includes(key) ? String(value).replace(/\W+/g, '') : String(value);
            }).trim();
            if (complete && line) lines.push(line);
        }
        if (lines.length > 0) work[field] = lines.join(separator);
    },

    // A one-item list becomes a scalar elsewhere, e.g. a single TTS speaker
    // [{voice:'Puck'}] → voice:'Puck' (multi-speaker mode needs two or more).
    unwrap_single(work, { field, to, prop }) {
        const list = work[field];
        if (!Array.isArray(list) || list.length !== 1) return;
        const value = prop ? list[0]?.[prop] : list[0];
        delete work[field];
        if (!isBlank(value) && isBlank(work[to])) work[to] = value;
    },

    // Several free-text fields → one (e.g. scene + context → style_instructions).
    concat_text(work, { field, from = [], separator = ' ' }) {
        const parts = [];
        for (const source of from) {
            if (!hasOwn(work, source)) continue;
            const value = work[source];
            if (source !== field) delete work[source];
            if (typeof value === 'string' && value.trim()) parts.push(value.trim());
        }
        if (parts.length > 0) work[field] = parts.join(separator);
    },

    // Build [{path, scale}] from flat lora_url / lora_weight style keys. The
    // item is dropped unless every `required` prop is present.
    to_object_array(work, { field, props = {}, required = [], numeric = [] }) {
        const item = {};
        for (const [prop, source] of Object.entries(props)) {
            if (!hasOwn(work, source)) continue;
            const value = work[source];
            delete work[source];
            if (isBlank(value)) continue;
            if (numeric.includes(prop)) {
                const number = toFiniteNumber(value);
                if (number !== null) item[prop] = number;
            } else {
                item[prop] = value;
            }
        }
        if (Object.keys(item).length === 0 || required.some((prop) => isBlank(item[prop]))) return;
        work[field] = [item];
    },

    drop(work, { field }) {
        delete work[field];
    },
};

export const OP_NAMES = Object.freeze(Object.keys(OPS));

export function applyTransforms(transforms, work, ctx = {}) {
    for (const step of transforms || []) {
        const op = OPS[step?.op];
        if (!op) {
            const error = new Error(`Unknown catalog transform op: ${step?.op}`);
            error.status = 500;
            throw error;
        }
        op(work, step, ctx);
    }
    return work;
}

// Variant selection (`when` clauses are evaluated against the raw payload).
export function matchesWhen(when, payload) {
    if (!when) return true;
    const clauses = Array.isArray(when) ? when : [when];
    return clauses.every((clause) => {
        const value = payload?.[clause.field];
        if (hasOwn(clause, 'equals')) {
            if (isBlank(value)) return false;
            return String(value).toLowerCase() === String(clause.equals).toLowerCase();
        }
        if (Array.isArray(clause.in)) {
            if (isBlank(value)) return false;
            return clause.in.some((candidate) => String(candidate).toLowerCase() === String(value).toLowerCase());
        }
        if (hasOwn(clause, 'present')) return clause.present ? !isBlank(value) && !(Array.isArray(value) && value.length === 0) : isBlank(value);
        const count = Array.isArray(value) ? value.filter((item) => !isBlank(item)).length : (isBlank(value) ? 0 : 1);
        if (Number.isFinite(clause.min_items) && count < clause.min_items) return false;
        if (Number.isFinite(clause.max_items) && count > clause.max_items) return false;
        return Number.isFinite(clause.min_items) || Number.isFinite(clause.max_items);
    });
}
