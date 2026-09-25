// The pipeline registry loads lib/gateway/pipelines/<file>.js on first use;
// 'ai-clipping' lives in clipping.js, which must not be reachable as its own
// pipeline name.
import test from 'node:test';
import assert from 'node:assert/strict';

import { getPipeline, loadPipeline, unregister } from '../../lib/gateway/pipelines/index.js';

test('ai-clipping loads from clipping.js; the file name is not a pipeline name', async () => {
    unregister('ai-clipping');
    const def = await loadPipeline('ai-clipping');
    assert.ok(def, 'ai-clipping resolves');
    assert.equal(def.name, 'ai-clipping');
    assert.equal(typeof def.run, 'function');
    assert.equal(typeof def.validate, 'function');
    assert.equal(await loadPipeline('clipping'), null);
    assert.equal(getPipeline('clipping'), null);
});

test('unknown and invalid pipeline names resolve to null', async () => {
    assert.equal(await loadPipeline('no-such-pipeline'), null);
    assert.equal(await loadPipeline('index'), null);
    assert.equal(await loadPipeline('../router'), null);
    assert.equal(await loadPipeline('Ai-Clipping'), null);
});
