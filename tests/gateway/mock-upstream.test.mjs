// The local mock upstream (scripts/mock-upstream.mjs) behaves like the parts
// of fal.ai and OpenRouter the gateway uses.
import test from 'node:test';
import assert from 'node:assert/strict';

import { familyOf, startMockUpstream } from '../../scripts/mock-upstream.mjs';

let mock;
const FAL = { Authorization: 'Key mock-key', 'Content-Type': 'application/json' };
const OR = { Authorization: 'Bearer mock-key', 'Content-Type': 'application/json' };

test.before(async () => {
    mock = await startMockUpstream({ port: 0, pollsToComplete: 2 });
});
test.after(() => mock.close());

async function submit(endpoint, input) {
    const res = await fetch(`${mock.env.FAL_QUEUE_BASE}/${endpoint}`, { method: 'POST', headers: FAL, body: JSON.stringify(input) });
    return { status: res.status, body: await res.json() };
}
const getJson = async (url, headers = FAL) => {
    const res = await fetch(url, { headers });
    return { status: res.status, body: await res.json() };
};

test('queue: submit returns owner/alias URLs; status goes IN_QUEUE → IN_PROGRESS → COMPLETED', async () => {
    const { status, body } = await submit('fal-ai/flux/dev/image-to-image', { prompt: 'a cat', num_images: 2 });
    assert.equal(status, 200);
    assert.ok(body.request_id);
    assert.equal(body.status_url, `${mock.url}/fal-queue/fal-ai/flux/requests/${body.request_id}/status`, 'sub-path dropped like real fal');
    assert.equal(body.response_url, `${mock.url}/fal-queue/fal-ai/flux/requests/${body.request_id}`);
    assert.equal((await getJson(`${body.status_url}?logs=1`)).body.status, 'IN_QUEUE');
    // The result is not ready yet.
    assert.equal((await getJson(body.response_url)).status, 400);
    assert.equal((await getJson(body.status_url)).body.status, 'IN_PROGRESS');
    assert.equal((await getJson(body.status_url)).body.status, 'COMPLETED');
    const result = await getJson(body.response_url);
    assert.equal(result.status, 200);
    assert.equal(result.body.images.length, 2);
    assert.match(result.body.images[0].url, /\/media\/sample\.png$/);
    const media = await fetch(result.body.images[0].url);
    assert.equal(media.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await media.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
});

test('result shape follows the endpoint family', async () => {
    assert.equal(familyOf('fal-ai/flux/dev'), 'images');
    assert.equal(familyOf('fal-ai/birefnet/v2'), 'image');
    assert.equal(familyOf('fal-ai/bytedance/seedance/v1/pro/image-to-video'), 'video');
    assert.equal(familyOf('fal-ai/seedvr/upscale/video'), 'video');
    assert.equal(familyOf('fal-ai/wan-25-preview/text-to-image'), 'images');
    assert.equal(familyOf('fal-ai/wan-25-preview/image-to-image'), 'images');
    assert.equal(familyOf('fal-ai/wan-25-preview/text-to-video'), 'video');
    assert.equal(familyOf('fal-ai/seedvr/upscale/image'), 'image');
    assert.equal(familyOf('fal-ai/sync-lipsync/v2'), 'video');
    assert.equal(familyOf('fal-ai/stable-audio'), 'audio_file');
    assert.equal(familyOf('fal-ai/minimax/speech-2.8-hd'), 'audio');
    assert.equal(familyOf('fal-ai/wizper'), 'transcript');
    const run = async (endpoint) => (await (await fetch(`${mock.env.FAL_RUN_BASE}/${endpoint}`, { method: 'POST', headers: FAL, body: '{}' })).json());
    assert.match((await run('fal-ai/kling-video/v2/master/image-to-video')).video.url, /sample\.mp4$/);
    assert.match((await run('fal-ai/stable-audio')).audio_file.url, /sample\.mp3$/);
    assert.match((await run('xai/tts/v1')).audio.url, /sample\.mp3$/);
    assert.match((await run('fal-ai/birefnet')).image.url, /sample\.png$/);
    assert.ok(Array.isArray((await run('fal-ai/whisper')).chunks));
});

test('FAIL_POLICY → COMPLETED with error; FAIL_422 → 422 on the result; FAIL_SUBMIT_422 → 422 on submit', async () => {
    const policy = (await submit('fal-ai/flux/dev', { prompt: 'FAIL_POLICY please' })).body;
    for (let i = 0; i < 2; i++) await getJson(policy.status_url);
    const done = (await getJson(policy.status_url)).body;
    assert.equal(done.status, 'COMPLETED');
    assert.equal(done.error_type, 'content_policy_violation');

    const invalid = (await submit('fal-ai/flux/dev', { prompt: 'FAIL_422' })).body;
    for (let i = 0; i < 3; i++) await getJson(invalid.status_url);
    const result = await getJson(invalid.response_url);
    assert.equal(result.status, 422);
    assert.equal(result.body.detail[0].type, 'value_error');

    const rejected = await submit('fal-ai/flux/dev', { prompt: 'FAIL_SUBMIT_422' });
    assert.equal(rejected.status, 422);
    assert.equal(rejected.body.detail[0].type, 'content_policy_violation');
});

test('cancel: queued jobs are cancelled (then report client_cancelled); finished jobs answer 400', async () => {
    const job = (await submit('fal-ai/flux/dev', { prompt: 'x' })).body;
    const cancel = await fetch(job.cancel_url, { method: 'PUT', headers: FAL });
    assert.equal(cancel.status, 202);
    assert.equal((await cancel.json()).status, 'CANCELLATION_REQUESTED');
    const status = (await getJson(job.status_url)).body;
    assert.equal(status.status, 'COMPLETED');
    assert.equal(status.error_type, 'client_cancelled');
    const again = await fetch(job.cancel_url, { method: 'PUT', headers: FAL });
    assert.equal(again.status, 400);
    assert.equal((await fetch(`${mock.env.FAL_QUEUE_BASE}/fal-ai/flux/requests/nope/cancel`, { method: 'PUT', headers: FAL })).status, 404);
});

test('fal auth: missing key 401, "bad-key" 401', async () => {
    assert.equal((await fetch(`${mock.env.FAL_QUEUE_BASE}/fal-ai/flux/dev`, { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await fetch(`${mock.env.FAL_QUEUE_BASE}/fal-ai/flux/dev`, { method: 'POST', headers: { Authorization: 'Bearer x' }, body: '{}' })).status, 401, 'fal wants "Key", not "Bearer"');
    assert.equal((await fetch(`${mock.env.FAL_QUEUE_BASE}/fal-ai/flux/dev`, { method: 'POST', headers: { Authorization: 'Key bad-key' }, body: '{}' })).status, 401);
});

test('storage: initiate + unauthenticated PUT, then the file is served back', async () => {
    const init = await fetch(`${mock.env.FAL_REST_BASE}/storage/upload/initiate?storage_type=fal-cdn-v3`, {
        method: 'POST', headers: FAL, body: JSON.stringify({ content_type: 'image/png', file_name: 'ref.png' }),
    });
    const { upload_url: uploadUrl, file_url: fileUrl } = await init.json();
    assert.match(fileUrl, /\/files\/[0-9a-f]+\/ref\.png$/);
    const leaked = await fetch(uploadUrl, { method: 'PUT', headers: { Authorization: 'Key mock-key', 'Content-Type': 'image/png' }, body: 'x' });
    assert.equal(leaked.status, 400, 'presigned PUT must not carry the key');
    assert.equal((await fetch(fileUrl)).status, 404, 'not served before the PUT');
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: Buffer.from('pngbytes') });
    assert.equal(put.status, 200);
    const served = await fetch(fileUrl);
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.equal(await served.text(), 'pngbytes');
    const wrongType = await fetch(`${mock.env.FAL_REST_BASE}/storage/upload/initiate?storage_type=gcs`, { method: 'POST', headers: FAL, body: '{"content_type":"a/b","file_name":"x"}' });
    assert.equal(wrongType.status, 400);
});

test('pricing: unit prices per endpoint family', async () => {
    const { body } = await getJson(`${mock.env.FAL_API_BASE}/v1/models/pricing?endpoint_id=fal-ai/flux/dev&endpoint_id=fal-ai/wan-i2v`);
    assert.deepEqual(body.prices.map((p) => [p.endpoint_id, p.unit, p.unit_price]), [['fal-ai/flux/dev', 'image', 0.03], ['fal-ai/wan-i2v', 'second', 0.1]]);
});

test('OpenRouter: JSON reply, schema-shaped JSON, tool calls, SSE, models, errors', async () => {
    const chat = (body, headers = OR) => fetch(`${mock.env.OPENROUTER_BASE_URL}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
    const plain = await (await chat({ model: 'openai/gpt-6-luna', messages: [{ role: 'user', content: 'hello there' }] })).json();
    assert.equal(plain.choices[0].message.content, 'Mock reply: hello there');
    assert.equal(plain.usage.cost, 0.0001);

    const schema = { type: 'object', properties: { title: { type: 'string' }, score: { type: 'number', minimum: 0, maximum: 1 }, tags: { type: 'array', items: { type: 'string' } } }, required: ['title', 'score', 'tags'] };
    const structured = await (await chat({ model: 'm', messages: [{ role: 'user', content: 'x' }], response_format: { type: 'json_schema', json_schema: { name: 'plan', schema } } })).json();
    const parsed = JSON.parse(structured.choices[0].message.content);
    assert.equal(typeof parsed.title, 'string');
    assert.equal(parsed.score, 0.5);
    assert.equal(parsed.tags.length, 1);

    const tools = [{ type: 'function', function: { name: 'generate_image', parameters: { type: 'object', properties: { prompt: { type: 'string' }, aspect_ratio: { type: 'string', enum: ['1:1', '16:9'] } }, required: ['prompt'] } } }];
    const withTool = await (await chat({ model: 'm', tools, messages: [{ role: 'user', content: 'please use a tool to draw a cat' }] })).json();
    const call = withTool.choices[0].message.tool_calls[0];
    assert.equal(withTool.choices[0].finish_reason, 'tool_calls');
    assert.equal(call.function.name, 'generate_image');
    assert.deepEqual(JSON.parse(call.function.arguments), { prompt: 'mock prompt', aspect_ratio: '1:1' });
    const noTool = await (await chat({ model: 'm', tools, messages: [{ role: 'user', content: 'just chat' }] })).json();
    assert.equal(noTool.choices[0].message.tool_calls, undefined);

    const stream = await chat({ model: 'm', stream: true, messages: [{ role: 'user', content: 'stream me' }] });
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    const text = await stream.text();
    assert.match(text, /^: OPENROUTER PROCESSING/);
    assert.match(text, /data: \[DONE\]\n\n$/);
    const content = text.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6))).map((c) => c.choices[0].delta.content || '').join('');
    assert.equal(content, 'Mock reply: stream me');
    assert.match(text, /"usage":\{/);

    assert.equal((await chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] }, { 'Content-Type': 'application/json' })).status, 401);
    assert.equal((await chat({ model: 'm', messages: [{ role: 'user', content: 'FAIL_LLM_500' }] })).status, 500);
    assert.equal((await chat({ model: 'm', messages: [] })).status, 400);
    const models = await getJson(`${mock.env.OPENROUTER_BASE_URL}/models`, OR);
    assert.ok(models.body.data.some((m) => m.id === 'openai/gpt-6-luna'));
});

test('test hooks: state and reset', async () => {
    const state = await getJson(`${mock.url}/__mock/state`);
    assert.ok(state.body.counters.submit > 0);
    await fetch(`${mock.url}/__mock/reset`, { method: 'POST' });
    assert.equal((await getJson(`${mock.url}/__mock/state`)).body.counters.submit, 0);
    assert.equal((await fetch(`${mock.url}/nothing`)).status, 404);
});
