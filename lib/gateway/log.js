// One structured JSON line per gateway event. Only the whitelisted fields are
// ever written: never prompts, payloads, keys, cookies, access codes or raw
// upstream bodies (fal/OpenRouter error text can echo user input).

const FIELDS = ['event', 'route', 'provider', 'endpoint', 'method', 'status', 'ms', 'req_id', 'code', 'error_type', 'kind', 'usd'];

export function logGateway(fields = {}, level) {
    if (process.env.AQUORA_LOG_LEVEL === 'silent') return;
    try {
        const line = { ts: new Date().toISOString() };
        const status = Number(fields.status);
        line.level = level || (fields.code && status >= 500 ? 'error' : (status >= 400 ? 'warn' : 'info'));
        for (const key of FIELDS) {
            const value = fields[key];
            if (value === undefined || value === null) continue;
            if (typeof value === 'number') line[key] = Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null;
            else line[key] = String(value).slice(0, 120);
        }
        (line.level === 'error' ? console.error : console.log)(JSON.stringify(line));
    } catch {
        // logging must never break a request
    }
}
