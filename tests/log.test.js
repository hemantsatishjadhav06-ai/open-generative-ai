const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../lib/log.js');

function capture(fn) {
    const lines = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (l) => lines.push(l);
    console.error = (l) => lines.push(l);
    try { fn(); } finally { console.log = origLog; console.error = origErr; }
    return lines;
}

test('logProxy prints exactly one JSON line with the expected fields', async () => {
    const { logProxy } = await load();
    const lines = capture(() => logProxy({ route: 'workflow/run', method: 'POST', status: 502, ms: 12.4, reqId: 'r1' }));
    assert.equal(lines.length, 1);
    const line = JSON.parse(lines[0]);
    assert.deepEqual(Object.keys(line).sort(), ['level', 'method', 'ms', 'req_id', 'route', 'ts', 'upstream_status'].sort());
    assert.equal(line.level, 'error');
    assert.equal(line.ms, 12);
});

test('logProxy never logs keys or bodies, even if a caller passes them', async () => {
    const { logProxy } = await load();
    const lines = capture(() => logProxy({ route: 'app', method: 'GET', status: 200, ms: 1, reqId: 'r2', apiKey: 'sk-secret', headers: { 'x-api-key': 'sk-secret' }, body: 'prompt text' }));
    assert.equal(lines.length, 1);
    assert.ok(!lines[0].includes('sk-secret'));
    assert.ok(!lines[0].includes('x-api-key'));
    assert.ok(!lines[0].includes('prompt text'));
});

test('newReqId returns a non-empty string', async () => {
    const { newReqId } = await load();
    assert.equal(typeof newReqId(), 'string');
    assert.ok(newReqId().length > 0);
});
