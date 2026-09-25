// Workflows API (/api/workflow/*) against the local mock upstream and the
// real catalog: node schemas, templates, CRUD, full runs executed as a DAG
// (placeholders resolved server-side, steps on fal / OpenRouter), single-step
// runs, the Playground API, failures, cancel, the architect and workspace
// isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyMockEnv, startMockUpstream } from '../../scripts/mock-upstream.mjs';
import { setCatalogForTesting, getCatalog } from '../../lib/gateway/catalogLoader.js';
import { budgetStatus, flushLedger, resetLimits } from '../../lib/gateway/limits.js';
import { resetJobs } from '../../lib/gateway/jobs.js';
import { OPEN_WORKSPACE } from '../../lib/gateway/session.js';
import * as store from '../../lib/gateway/store.js';
import { handleWorkflow } from '../../lib/gateway/workflows/api.js';
import { planWorkflow } from '../../lib/gateway/workflows/executor.js';
import { deriveParams, resolvePlaceholders, topoOrder } from '../../lib/gateway/workflows/graph.js';
import { sanitizeDraft } from '../../lib/gateway/workflows/architect.js';
import { resetSchemaCache } from '../../lib/gateway/workflows/schemas.js';
import { getTemplate, templateIds } from '../../lib/gateway/workflows/templates.js';

import * as workflowRoute from '../../app/api/workflow/[[...path]]/route.js';
import * as submitRoute from '../../app/api/v1/[...path]/route.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-workflows-'));
Object.assign(process.env, {
    AQUORA_DATA_DIR: dataDir,
    AQUORA_SESSION_SECRET: 'workflows-test-secret-'.padEnd(48, 'w'),
    AQUORA_LOG_LEVEL: 'silent',
    FAL_POLL_INTERVAL_MS: '10',
});
delete process.env.AQUORA_ACCESS_CODES;
delete process.env.AQUORA_SESSION_DAILY_BUDGET_USD;
delete process.env.NODE_ENV;
setCatalogForTesting(null);

let mock;
test.before(async () => {
    mock = await startMockUpstream({ port: 0, pollsToComplete: 1 });
    applyMockEnv(mock);
    resetSchemaCache();
});
test.after(async () => {
    resetJobs();
    await flushLedger();
    await mock.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});
test.beforeEach(() => resetLimits());

const ORIGIN = 'http://localhost:3000';
const HEADERS = { host: 'localhost:3000', origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };

async function call(handler, { method = 'GET', url, body, cookie, params, headers = {} }) {
    const request = new Request(`${ORIGIN}${url}`, {
        method,
        headers: { ...HEADERS, ...headers, ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await handler(request, { params: Promise.resolve(params) });
    const setCookie = response.headers.get('set-cookie');
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, cookie: setCookie ? setCookie.split(';')[0] : cookie };
}

let cookie;
async function wf(method, subpath, { body, headers } = {}) {
    const segments = subpath.split('/').filter(Boolean);
    const res = await call(workflowRoute[method], { method, url: `/api/workflow/${segments.join('/')}`, body, cookie, headers, params: { path: segments } });
    if (res.cookie) cookie = res.cookie;
    return res;
}

async function untilRun(runId, done = (body) => body.status !== 'processing', max = 600) {
    for (let i = 0; i < max; i++) {
        const res = await wf('GET', `run/${runId}/status`);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        if (done(res.body)) return res.body;
        await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error('run did not finish');
}

const MEDIA = () => `${mock.url}/media`;

function textNode(id, prompt, position = { x: 0, y: 0 }) {
    return { id, category: 'text', model: 'text-passthrough', input_params: { prompt }, output_params: { outputs: [] }, params: {}, position };
}

// text1 ──prompt──▶ image1 (FLUX.2 Dev) ──image_url──▶ video1 (Seedance Lite I2V)
//   └───────────────────prompt───────────────────────▲
function threeStepWorkflow(name = 'Three steps') {
    return {
        workflow_id: null,
        name,
        category: 'Test',
        edges: [
            { id: 'a', source: 'text1', target: 'image1', sourceHandle: 'textOutput', targetHandle: 'imageInput', style: { stroke: '#fff' } },
            { id: 'b', source: 'image1', target: 'video1', sourceHandle: 'imageOutput', targetHandle: 'videoInput2' },
            { id: 'c', source: 'text1', target: 'video1', sourceHandle: 'textOutput', targetHandle: 'videoInput' },
        ],
        data: {
            nodes: [
                textNode('text1', 'a lighthouse at dawn'),
                { id: 'image1', category: 'image', model: 'flux-2-dev', input_params: { width: 1024, height: 768 }, params: {}, position: { x: 300, y: 0 } },
                { id: 'video1', category: 'video', model: 'seedance-lite-i2v', input_params: { duration: 5, resolution: '720p', make_output: true }, params: {}, position: { x: 600, y: 0 } },
            ],
        },
    };
}

function falInputsFor(endpointPart) {
    return [...mock.state.jobs.values()].filter((job) => job.endpoint.includes(endpointPart)).map((job) => job.input);
}

test('graph helpers: params from connections, placeholder resolution, order and loops', () => {
    const props = { prompt: {}, images_list: { default: [] }, image_url: {}, duration: { default: 5 } };
    const node = { id: 'video1', category: 'video', input_params: { prompt: 'typed', duration: 8, stray: 'x' } };
    const edges = [
        { source: 'text1', target: 'video1', targetHandle: 'videoInput' },
        { source: 'image1', target: 'video1', targetHandle: 'videoInput6' },
        { source: 'image2', target: 'video1', targetHandle: 'videoInput6' },
        { source: 'image1', target: 'video1', targetHandle: 'videoInput2' },
        { source: 'audio1', target: 'video1', targetHandle: 'videoInput5' }, // no audio_url field: ignored
    ];
    assert.deepEqual(deriveParams(node, edges, props), {
        prompt: '{{ text1.outputs[0].value }}',
        images_list: ['{{ image1.outputs[0].value }}', '{{ image2.outputs[0].value }}'],
        image_url: '{{ image1.outputs[0].value }}',
        duration: 8,
    });
    const combiner = deriveParams({ id: 'vidConcat1', category: 'utility', input_params: {} }, [{ source: 'video1', target: 'vidConcat1', targetHandle: 'videoInput7' }], { videos_list: {} });
    assert.deepEqual(combiner, { videos_list: ['{{ video1.outputs[0].value }}'] });

    const outputs = new Map([['text1', [{ type: 'text', value: 'a cat' }]], ['image1', [{ type: 'image_url', value: 'https://v3.fal.media/a.png' }, { type: 'image_url', value: 'https://v3.fal.media/b.png' }]]]);
    assert.equal(resolvePlaceholders('{{ image1.outputs[1].value }}', outputs), 'https://v3.fal.media/b.png');
    assert.equal(resolvePlaceholders('Draw {{ text1.outputs[0].value }} in space', outputs), 'Draw a cat in space');
    assert.deepEqual(resolvePlaceholders({ list: ['{{ image1.outputs[0].value }}'] }, outputs), { list: ['https://v3.fal.media/a.png'] });
    assert.throws(() => resolvePlaceholders('{{ text9.outputs[0].value }}', outputs), (e) => e.code === 'missing_input');

    assert.deepEqual(topoOrder(['c', 'b', 'a'], new Map([['c', ['b']], ['b', ['a']], ['a', []]])), ['a', 'b', 'c']);
    assert.throws(() => topoOrder(['a', 'b'], new Map([['a', ['b']], ['b', ['a']]])), (e) => e.code === 'workflow_cycle');
});

test('architect drafts are checked against the node schemas', async () => {
    const schemas = (await wf('GET', 'x/node-schemas')).body;
    const draft = {
        nodes: [
            { id: 'prompt', category: 'text', model: 'text-passthrough', params: { prompt: 'a red fox' } },
            { id: 'img', category: 'image', model: 'nano-banana-pro', params: { prompt: 'will be connected', aspect_ratio: '16:9', image_url: 'javascript:alert(1)' } },
            { id: 'vid', category: 'video', model: 'flux-2-dev', params: {} },
            { id: 'bad', category: 'api', model: 'wavespeed', params: { api_key: 'x' } },
        ],
        edges: [
            { source: 'prompt', target: 'img', field: 'prompt' },
            { source: 'img', target: 'vid', field: 'prompt' },
            { source: 'img', target: 'ghost', field: 'image_url' },
        ],
    };
    const { nodes, edges } = sanitizeDraft(draft, schemas);
    assert.deepEqual(nodes.map((n) => `${n.id}:${n.model}`), ['text1:text-passthrough', 'image1:nano-banana-pro', 'video1:video-passthrough']);
    assert.equal(nodes[1].params.prompt, undefined, 'a connected field is left to the connection');
    assert.equal(nodes[1].params.image_url, undefined, 'links from the model are dropped');
    assert.deepEqual(edges.map((e) => `${e.source}.${e.sourceHandle}->${e.target}.${e.targetHandle}`), ['text1.textOutput->image1.imageInput']);
    assert.ok(nodes[1].position.x > nodes[0].position.x);
});

test('node schemas come from the enabled catalog in the builder format, with text + utility models and no API nodes', async () => {
    const res = await wf('GET', 'new/node-schemas');
    assert.equal(res.status, 200);
    const { categories, features } = res.body;
    assert.deepEqual(Object.keys(categories).sort(), ['audio', 'image', 'text', 'utility', 'video']);
    assert.equal(categories.api, undefined);
    assert.deepEqual(features, { text: true, architect: true });
    for (const id of ['text-passthrough', 'llm-fast', 'llm-smart', 'llm-vision']) assert.ok(categories.text.models[id], id);
    assert.ok(categories.utility.models['prompt-concatenator']);
    assert.ok(categories.utility.models['video-combiner']);
    const catalog = await getCatalog();
    let count = 0;
    for (const category of ['image', 'video', 'audio']) {
        for (const [id, model] of Object.entries(categories[category].models)) {
            const props = model.input_schema?.schemas?.input_data?.properties;
            assert.ok(props && typeof props === 'object', `${id} has properties`);
            if (id.endsWith('-passthrough')) continue;
            count += 1;
            const entry = catalog.getEntry(id);
            assert.ok(entry?.enabled, `${id} is an enabled catalog key`);
            for (const [key, prop] of Object.entries(props)) {
                assert.ok(!(typeof prop.default === 'string' && /^\w+:\/\//.test(prop.default)), `${id}.${key} default is not a link`);
                for (const example of prop.examples || []) assert.ok(!(typeof example === 'string' && /^\w+:\/\//.test(example)), `${id}.${key} example is not a link`);
            }
            for (const key of model.input_schema.schemas.input_data.required) assert.ok(key in props, `${id} required ${key} is a property`);
        }
    }
    assert.ok(count > 300, `many catalog models (${count})`);
    // Handles the builder connects to use the studio's field names.
    assert.equal(categories.image.models['wan2.5-image-edit'].input_schema.schemas.input_data.properties.images_list.field, 'images_list');
    assert.equal(categories.video.models['seedance-lite-i2v'].input_schema.schemas.input_data.properties.image_url.field, 'image');
    assert.equal(categories.video.models['sync-lipsync'].input_schema.schemas.input_data.properties.audio_url.field, 'audio');
    assert.equal(categories.image.models['ai-background-remover'].group, 'tools');
    // Suno has no fal equivalent: it is not offered.
    assert.equal(categories.audio.models['suno-create-music'], undefined);
    const api = await wf('GET', 'new/api-node-schemas');
    assert.deepEqual(api.body, { api_node_schemas: {} });
});

test('templates: list, open read-only, and every template plans against the real catalog', async () => {
    const list = await wf('GET', 'get-template-workflows');
    assert.equal(list.status, 200);
    assert.ok(list.body.length >= 5);
    assert.ok(list.body.every((t) => t.id && t.name && t.thumbnail === null));
    const zh = await wf('GET', 'get-template-workflows', { headers: { referer: `${ORIGIN}/zh/studio/workflows` } });
    assert.notEqual(zh.body[0].name, list.body[0].name, 'template names follow the page locale');

    const def = await wf('GET', 'get-workflow-def/tpl-image-editor');
    assert.equal(def.status, 200);
    assert.equal(def.body.is_owner, false);
    assert.equal(def.body.is_published, false);
    assert.equal(def.body.show_temp_button, false);
    assert.equal(def.body.data.nodes.length, 4);
    assert.ok(!JSON.stringify(def.body).match(/cloudfront|cdn\.m/i));

    const catalog = await getCatalog();
    for (const id of templateIds()) {
        const template = getTemplate(id);
        const plan = await planWorkflow(template, {});
        for (const item of plan.items) {
            if (item.kind.kind !== 'catalog') continue;
            const params = resolvePlaceholders(item.params, new Map(plan.items.map((other) => [other.id, [{ type: 'x', value: other.category === 'text' ? 'a prompt' : `https://media.example.com/${other.id}.${other.category === 'audio' ? 'mp3' : other.category === 'video' ? 'mp4' : 'png'}` }]])));
            const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null && v !== ''));
            const built = catalog.buildFalInput(catalog.getEntry(item.model), clean);
            assert.ok(built.input, `${id}/${item.id} builds a fal input`);
        }
    }
});

test('CRUD: create, list, rename, recategorise, read, and delete a workspace workflow', async () => {
    const created = await wf('POST', 'create', {
        body: {
            workflow_id: null,
            name: '  My   flow ',
            category: 'Promo',
            edges: [{ id: 'x', source: 'text1', target: 'ghost', sourceHandle: 'textOutput', targetHandle: 'imageInput' }],
            data: {
                nodes: [
                    textNode('text1', 'hello'),
                    { id: 'api1', category: 'api', model: 'wavespeed', input_params: { api_key: 'secret' } },
                    { id: 'bad id!', category: 'image', model: 'flux-2-dev' },
                ],
            },
        },
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const id = created.body.workflow_id;
    assert.match(id, /^[A-Za-z0-9][A-Za-z0-9_-]+$/);

    const def = await wf('GET', `get-workflow-def/${id}`);
    assert.equal(def.body.name, 'My flow');
    assert.equal(def.body.is_owner, true);
    assert.deepEqual(def.body.data.nodes.map((n) => n.id), ['text1'], 'API and invalid nodes are dropped');
    assert.deepEqual(def.body.edges, [], 'edges to missing nodes are dropped');
    assert.ok(!JSON.stringify(def.body).includes('secret'));

    const list = await wf('GET', 'get-workflow-defs');
    assert.ok(list.body.some((w) => w.id === id && w.name === 'My flow' && w.category === 'Promo'));

    assert.equal((await wf('POST', `update-name/${id}`, { body: { name: 'Renamed' } })).body.name, 'Renamed');
    assert.equal((await wf('POST', `update-category/${id}`, { body: { category: 'Ads' } })).body.category, 'Ads');
    // Saving again with the id updates in place.
    const saved = await wf('POST', 'create', { body: { workflow_id: id, name: 'Renamed', category: 'Ads', edges: [], data: { nodes: [textNode('text1', 'changed')] } } });
    assert.equal(saved.body.workflow_id, id);
    assert.equal((await wf('GET', `get-workflow-def/${id}`)).body.data.nodes[0].input_params.prompt, 'changed');
    // A template id is never overwritten: saving it makes a copy.
    const copy = await wf('POST', 'create', { body: { workflow_id: 'tpl-voiceover', source_workflow_id: 'tpl-voiceover', name: 'Copy', edges: [], data: { nodes: [] } } });
    assert.notEqual(copy.body.workflow_id, 'tpl-voiceover');
    assert.equal((await wf('GET', `get-workflow-def/${copy.body.workflow_id}`)).body.data.nodes.length, 2, 'empty duplicate copies the source steps');

    assert.equal((await wf('POST', 'update-name/tpl-voiceover', { body: { name: 'x' } })).status, 404, 'templates are read-only');
    assert.equal((await wf('DELETE', `delete-workflow-def/${id}`)).body.deleted, true);
    assert.equal((await wf('GET', `get-workflow-def/${id}`)).status, 404);
    assert.equal((await wf('GET', 'get-workflow-def/..%2Fetc')).status, 404);
    assert.equal((await wf('POST', `workflow/${copy.body.workflow_id}/publish`, { body: { publish: true } })).status, 404);
    assert.deepEqual((await wf('GET', 'get-published-workflows')).body, []);
});

test('Run All executes the DAG in order, resolves placeholders and reports per-step results', async () => {
    const before = (await budgetStatus(OPEN_WORKSPACE)).spentUsd;
    const { body: { workflow_id: id } } = await wf('POST', 'create', { body: threeStepWorkflow() });
    const start = await wf('POST', `${id}/run`, { body: { cost: '0.5' } });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    const runId = start.body.run_id;
    assert.ok(runId.startsWith(`${id}.`));

    const done = await untilRun(runId, (body) => Object.values(body.nodes).every((runs) => ['succeeded', 'failed', 'skipped'].includes(runs[0].status)));
    for (const nodeId of ['text1', 'image1', 'video1']) {
        assert.equal(done.nodes[nodeId][0].status, 'succeeded', `${nodeId}: ${JSON.stringify(done.nodes[nodeId][0])}`);
        assert.ok(done.nodes[nodeId][0].node_run_id.startsWith(`${runId}.`));
    }
    assert.deepEqual(done.nodes.text1[0].result.outputs, [{ type: 'text', value: 'a lighthouse at dawn' }]);
    assert.deepEqual(done.nodes.image1[0].result.outputs, [{ type: 'image_url', value: `${MEDIA()}/sample.png` }]);
    assert.deepEqual(done.nodes.video1[0].result.outputs, [{ type: 'video_url', value: `${MEDIA()}/sample.mp4` }]);

    // The server resolved the connections into the fal inputs.
    const image = falInputsFor('fal-ai/flux-2').at(-1);
    assert.equal(image.prompt, 'a lighthouse at dawn');
    assert.deepEqual(image.image_size, { width: 1024, height: 768 });
    const video = falInputsFor('seedance/v1/lite/image-to-video').at(-1);
    assert.equal(video.image_url, `${MEDIA()}/sample.png`);
    assert.equal(video.prompt, 'a lighthouse at dawn');

    // Every step has settled; the run itself is marked final right after.
    await untilRun(runId);
    const outputs = await wf('GET', `run/${runId}/api-outputs`);
    assert.equal(outputs.body.status, 'completed');
    assert.deepEqual(outputs.body.outputs, [{ id: 'video1', type: 'video_url', value: `${MEDIA()}/sample.mp4` }], 'marked output step');

    // History is visible when the builder reopens the workflow.
    const def = await wf('GET', `get-workflow-def/${id}`);
    assert.equal(def.body.run_id, runId);
    assert.equal(def.body.run_history.video1.length, 1);
    assert.equal(def.body.run_history.text1, undefined, 'input steps are not listed as history');
    const spent = (await budgetStatus(OPEN_WORKSPACE)).spentUsd - before;
    assert.ok(spent > 0.04, `image + video were charged (${spent})`);
});

test('a single step re-runs inside the last run, joins the history, and can be deleted from it', async () => {
    const { body: { workflow_id: id } } = await wf('POST', 'create', { body: threeStepWorkflow('Single step') });
    const runId = (await wf('POST', `${id}/run`, { body: {} })).body.run_id;
    await untilRun(runId, (body) => body.status !== 'processing');

    const again = await wf('POST', `${id}/node/image1/run`, {
        body: { run_id: runId, model: 'flux-2-dev', params: { prompt: 'a red fox', width: 512, height: 512 }, cost: 0.04, node_id: 'AI Image' },
    });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.run_id, runId);
    const done = await untilRun(runId, (body) => body.nodes.image1.at(-1).status !== 'processing');
    assert.equal(done.nodes.image1.length, 2);
    assert.equal(done.nodes.image1.at(-1).status, 'succeeded');
    assert.equal(falInputsFor('fal-ai/flux-2').at(-1).prompt, 'a red fox');

    // Without a run the step starts one of its own.
    const fresh = await wf('POST', `${id}/node/image1/run`, { body: { run_id: null, params: { prompt: 'a blue whale' } } });
    assert.notEqual(fresh.body.run_id, runId);
    await untilRun(fresh.body.run_id, (body) => body.nodes.image1.at(-1).status !== 'processing');

    const history = (await wf('GET', `get-workflow-def/${id}`)).body.run_history.image1;
    assert.equal(history.length, 3);
    const removed = await wf('DELETE', `node-run/${history[0].node_run_id}`);
    assert.equal(removed.body.deleted, true);
    assert.equal((await wf('GET', `get-workflow-def/${id}`)).body.run_history.image1.length, 2);
    assert.equal((await wf('DELETE', `node-run/${history[0].node_run_id}`)).status, 404);
    assert.equal((await wf('POST', `${id}/node/nope/run`, { body: {} })).status, 404);
});

test('the Playground runs a template with typed inputs (api-inputs → api-execute → api-outputs)', async () => {
    const inputs = await wf('GET', 'tpl-voiceover/api-inputs');
    assert.equal(inputs.status, 200);
    assert.deepEqual(Object.keys(inputs.body.input_data.properties), ['text1']);
    assert.ok(inputs.body.input_data.properties.text1.default.length > 10);

    const start = await wf('POST', 'tpl-voiceover/api-execute', { body: { inputs: { text1: { prompt: 'Hello from the playground' } } } });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    let result;
    for (let i = 0; i < 400; i++) {
        result = (await wf('GET', `run/${start.body.run_id}/api-outputs`)).body;
        if (result.status !== 'processing') break;
        await new Promise((r) => setTimeout(r, 15));
    }
    assert.equal(result.status, 'completed', JSON.stringify(result));
    assert.deepEqual(result.outputs, [{ id: 'audio1', type: 'audio_url', value: `${MEDIA()}/sample.mp3` }]);
    assert.equal(falInputsFor('minimax/speech-2.6-hd').at(-1).prompt, 'Hello from the playground');

    // Media inputs must be uploaded first; a template image step is empty.
    const caption = await wf('POST', 'tpl-image-caption/api-execute', { body: { inputs: { text2: 'Describe it' } } });
    const failed = await untilRun(caption.body.run_id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.nodes.image1[0].status, 'failed');
    assert.match(failed.nodes.image1[0].error, /Add a file/);
    assert.equal(failed.nodes.text1[0].status, 'skipped');
    const out = (await wf('GET', `run/${caption.body.run_id}/api-outputs`)).body;
    assert.equal(out.status, 'failed');
    assert.match(out.error, /image1/);
});

test('text steps run on OpenRouter and feed later steps; vision gets image parts', async () => {
    const { body: { workflow_id: id } } = await wf('POST', 'create', {
        body: {
            name: 'LLM chain',
            edges: [
                { id: 'a', source: 'text1', target: 'text2', sourceHandle: 'textOutput', targetHandle: 'textInput' },
                { id: 'b', source: 'text2', target: 'concat1', sourceHandle: 'textOutput', targetHandle: 'concatInput' },
                { id: 'c', source: 'text1', target: 'concat1', sourceHandle: 'textOutput', targetHandle: 'concatInput' },
                { id: 'd', source: 'concat1', target: 'image1', sourceHandle: 'concatOutput', targetHandle: 'imageInput' },
                { id: 'e', source: 'image1', target: 'text3', sourceHandle: 'imageOutput', targetHandle: 'textInput2' },
            ],
            data: {
                nodes: [
                    textNode('text1', 'neon koi'),
                    { id: 'text2', category: 'text', model: 'llm-fast', input_params: { system_prompt: 'Be brief.' } },
                    { id: 'concat1', category: 'utility', model: 'prompt-concatenator', input_params: {} },
                    { id: 'image1', category: 'image', model: 'flux-2-dev', input_params: {} },
                    { id: 'text3', category: 'text', model: 'llm-vision', input_params: { prompt: 'Describe the image', make_output: true } },
                ],
            },
        },
    });
    const runId = (await wf('POST', `${id}/run`, { body: {} })).body.run_id;
    const done = await untilRun(runId);
    assert.equal(done.status, 'completed', JSON.stringify(done));
    assert.equal(done.nodes.text2[0].result.outputs[0].value, 'Mock reply: neon koi');
    assert.equal(done.nodes.concat1[0].result.outputs[0].value, 'Mock reply: neon koi neon koi');
    assert.equal(falInputsFor('fal-ai/flux-2').at(-1).prompt, 'Mock reply: neon koi neon koi');
    // The vision prompt is text + an image part (the mock echoes the text).
    assert.equal(done.nodes.text3[0].result.outputs[0].value, 'Mock reply: Describe the image');
    const outputs = (await wf('GET', `run/${runId}/api-outputs`)).body.outputs;
    assert.deepEqual(outputs, [{ id: 'text3', type: 'text', value: 'Mock reply: Describe the image' }]);
});

test('a failing step stops the run with friendly copy, skips what depends on it and refunds it', async () => {
    const body = threeStepWorkflow('Failing');
    body.data.nodes[0].input_params.prompt = 'FAIL_POLICY please';
    const { body: { workflow_id: id } } = await wf('POST', 'create', { body });
    const before = (await budgetStatus(OPEN_WORKSPACE)).spentUsd;
    const runId = (await wf('POST', `${id}/run`, { body: {} })).body.run_id;
    const done = await untilRun(runId);
    assert.equal(done.status, 'failed');
    assert.equal(done.nodes.text1[0].status, 'succeeded');
    assert.equal(done.nodes.image1[0].status, 'failed');
    assert.match(done.nodes.image1[0].result.outputs[0].value.error, /safety filter/);
    assert.equal(done.nodes.video1[0].status, 'skipped');
    const spent = (await budgetStatus(OPEN_WORKSPACE)).spentUsd - before;
    assert.ok(Math.abs(spent) < 1e-6, `failed step refunded (${spent})`);
});

test('invalid graphs are rejected before anything runs', async () => {
    const loop = await wf('POST', 'create', {
        body: {
            name: 'Loop',
            edges: [
                { id: 'a', source: 'image1', target: 'image2', sourceHandle: 'imageOutput', targetHandle: 'imageInput2' },
                { id: 'b', source: 'image2', target: 'image1', sourceHandle: 'imageOutput', targetHandle: 'imageInput2' },
            ],
            data: { nodes: [
                { id: 'image1', category: 'image', model: 'wan2.5-image-edit', input_params: { prompt: 'x' } },
                { id: 'image2', category: 'image', model: 'wan2.5-image-edit', input_params: { prompt: 'y' } },
            ] },
        },
    });
    const cycle = await wf('POST', `${loop.body.workflow_id}/run`, { body: {} });
    assert.equal(cycle.status, 400);
    assert.equal(cycle.body.error, 'workflow_cycle');

    const disabled = await wf('POST', 'create', { body: { name: 'Disabled', edges: [], data: { nodes: [{ id: 'audio1', category: 'audio', model: 'suno-create-music', input_params: { prompt: 'x' } }] } } });
    const res = await wf('POST', `${disabled.body.workflow_id}/run`, { body: {} });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'model_unavailable');
    assert.equal(res.body.field, 'audio1');

    const wrongCategory = await wf('POST', 'create', { body: { name: 'Wrong', edges: [], data: { nodes: [{ id: 'video1', category: 'video', model: 'flux-2-dev', input_params: { prompt: 'x' } }] } } });
    assert.equal((await wf('POST', `${wrongCategory.body.workflow_id}/run`, { body: {} })).body.error, 'model_unavailable');

    const empty = await wf('POST', 'create', { body: { name: 'Empty', edges: [], data: { nodes: [] } } });
    assert.equal((await wf('POST', `${empty.body.workflow_id}/run`, { body: {} })).body.error, 'empty_workflow');

    // A private-network link is refused when the step runs.
    const priv = await wf('POST', 'create', { body: { name: 'Private', edges: [], data: { nodes: [{ id: 'image1', category: 'image', model: 'image-passthrough', input_params: { image_url: 'http://169.254.169.254/latest/meta-data' } }] } } });
    const run = await untilRun((await wf('POST', `${priv.body.workflow_id}/run`, { body: {} })).body.run_id);
    assert.equal(run.nodes.image1[0].status, 'failed');
    assert.match(run.nodes.image1[0].error, /private/i);
});

test('a run can be stopped', async () => {
    mock.state.options.pollsToComplete = 400;
    try {
        const { body: { workflow_id: id } } = await wf('POST', 'create', { body: threeStepWorkflow('Stoppable') });
        const runId = (await wf('POST', `${id}/run`, { body: {} })).body.run_id;
        await untilRun(runId, (body) => body.nodes.image1[0].status === 'processing' && !body.nodes.image1[0].queued);
        const stop = await wf('POST', `run/${runId}/cancel`, { body: {} });
        assert.equal(stop.body.cancelled, true);
        const done = await untilRun(runId, (body) => body.status !== 'processing' && body.nodes.image1[0].status !== 'processing');
        assert.equal(done.status, 'cancelled');
        assert.equal(done.nodes.image1[0].status, 'cancelled');
        assert.equal(done.nodes.video1[0].status, 'cancelled');
        assert.equal((await wf('GET', `run/${runId}/api-outputs`)).body.status, 'failed', 'a stopped run ends the Playground poll');
    } finally {
        mock.state.options.pollsToComplete = 1;
    }
});

test('the architect drafts a runnable workflow from a prompt', async () => {
    const start = await wf('POST', 'architect', { body: { prompt: 'Make a product photo and animate it', workflow_id: null, history: [{ role: 'agent', content: 'Hi!' }] } });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    assert.equal(start.body.status, 'processing');
    let result;
    for (let i = 0; i < 300; i++) {
        result = await wf('GET', `poll-architect/${start.body.request_id}/result`);
        if (result.body.status !== 'processing') break;
        await new Promise((r) => setTimeout(r, 15));
    }
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'completed', JSON.stringify(result.body));
    const { nodes, edges } = result.body.workflow;
    assert.ok(nodes.length >= 1);
    const schemas = (await wf('GET', 'x/node-schemas')).body;
    for (const node of nodes) {
        assert.ok(schemas.categories[node.category].models[node.model], `${node.model} is a ${node.category} model`);
        assert.match(node.id, /^(text|image|video|audio|concat|vidConcat)\d+$/);
        assert.ok(Number.isFinite(node.position.x) && Number.isFinite(node.position.y));
    }
    for (const edge of edges) assert.ok(nodes.some((n) => n.id === edge.source) && nodes.some((n) => n.id === edge.target));
    // Another session can't read the job.
    const other = await call(workflowRoute.GET, { url: `/api/workflow/poll-architect/${start.body.request_id}/result`, params: { path: ['poll-architect', start.body.request_id, 'result'] } });
    assert.equal(other.status, 404);
    // Architect jobs can't be started through the generic submit route.
    const direct = await call(submitRoute.POST, { method: 'POST', url: '/api/v1/workflow-architect', body: { prompt: 'x' }, cookie, params: { path: ['workflow-architect'] } });
    assert.equal(direct.status, 404);
    const directRun = await call(submitRoute.POST, { method: 'POST', url: '/api/v1/workflow-run', body: {}, cookie, params: { path: ['workflow-run'] } });
    assert.equal(directRun.status, 404);
});

test('a run left unfinished by a restart reads as interrupted', async () => {
    const { body: { workflow_id: id } } = await wf('POST', 'create', { body: threeStepWorkflow('Restarted') });
    const ws = store.forWorkspace(OPEN_WORKSPACE);
    const runKey = 'restartedRun0001';
    await ws.put(`wfruns/${id}`, runKey, {
        id: runKey,
        run_id: `${id}.${runKey}`,
        workflow_id: id,
        kind: 'full',
        status: 'processing',
        job_id: 'jobThatIsGone01',
        nodes: { text1: [{ node_run_id: `${id}.${runKey}.0`, status: 'processing', model: 'text-passthrough' }], image1: [{ node_run_id: `${id}.${runKey}.1`, status: 'pending', model: 'flux-2-dev' }] },
        output_nodes: ['image1'],
        outputs: [],
        created_at: new Date().toISOString(),
    });
    const status = (await wf('GET', `run/${id}.${runKey}/status`)).body;
    assert.equal(status.status, 'failed');
    assert.equal(status.nodes.text1[0].status, 'failed');
    assert.match(status.nodes.image1[0].error, /interrupted/);
    assert.match((await wf('GET', `run/${id}.${runKey}/api-outputs`)).body.error, /interrupted/);
});

test('workspaces are isolated and unsafe requests are refused', async () => {
    const { body: { workflow_id: id } } = await wf('POST', 'create', { body: threeStepWorkflow('Mine') });
    const runId = (await wf('POST', `${id}/run`, { body: {} })).body.run_id;
    await untilRun(runId);
    const stranger = { sid: 'stranger-session', cid: 'other-workspace' };
    const as = (method, subpath) => handleWorkflow(new Request(`${ORIGIN}/api/workflow/${subpath}`, { method, headers: HEADERS }), { params: { path: subpath.split('/') }, session: stranger, ip: '10.0.0.9' })
        .then(async (response) => response).catch((error) => ({ status: error.status }));
    assert.equal((await as('GET', `get-workflow-def/${id}`)).status, 404);
    assert.equal((await as('GET', `run/${runId}/status`)).status, 404);
    assert.equal((await as('DELETE', `delete-workflow-def/${id}`)).status, 404);

    const cross = await call(workflowRoute.POST, { method: 'POST', url: '/api/workflow/create', body: threeStepWorkflow(), cookie, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, params: { path: ['create'] } });
    assert.equal(cross.status, 403);
    assert.equal((await wf('GET', 'run/not-a-run/status')).status, 404);
    assert.equal((await wf('GET', 'cloudfront-signed-url')).status, 404);
});
