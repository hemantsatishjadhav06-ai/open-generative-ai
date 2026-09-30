import test from 'node:test';
import assert from 'node:assert/strict';
import { isTerminalGenerationError, pendingJobsKey, readPendingJobs, writePendingJobs, persistGenerationResult } from '../src/usePendingGeneration.js';

const makeStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};

test('pending jobs require an authenticated workspace key and never cross workspaces', () => {
  const storage = makeStorage();
  const job = { requestId: 'signed-token', model: 'model', prompt: 'A landscape' };
  assert.equal(pendingJobsKey(null), null);
  assert.equal(pendingJobsKey('hg_image_studio_persistent'), null);
  assert.equal(writePendingJobs('hg_image_studio_persistent', [job], storage), false);
  assert.equal(writePendingJobs('image:ws-one', [job], storage), true);
  assert.deepEqual(readPendingJobs('image:ws-one', storage), [job]);
  assert.deepEqual(readPendingJobs('image:ws-two', storage), []);
  writePendingJobs('image:ws-one', [], storage);
  assert.deepEqual(readPendingJobs('image:ws-one', storage), []);
});

test('network/auth interruptions retain pending jobs while terminal provider failures clear them', () => {
  for (const error of [new Error('network'), { status: 401 }, { status: 429 }, { status: 503 }, { requestId: 'token' }]) {
    assert.equal(isTerminalGenerationError(error), false);
  }
  for (const error of [{ status: 400 }, { status: 403 }, { status: 404 }, { status: 410 }, { generationResult: { status: 'failed' } }, { generationResult: { status: 'cancelled' } }]) {
    assert.equal(isTerminalGenerationError(error), true);
  }
});

test('completed media becomes durable before pending removal without deleting the draft', () => {
  const storage = makeStorage();
  storage.setItem('video:ws-one', JSON.stringify({ prompt: 'Existing brief', selectedModel: 'draft-model', localHistory: [{ id: 'older', url: 'older-url' }] }));
  const entry = { id: 'token', url: 'new-url', model: 'actual-model' };
  persistGenerationResult('video:ws-one', entry, 'localHistory', { canvasUrl: entry.url, showCanvas: true }, storage);
  persistGenerationResult('video:ws-one', entry, 'localHistory', { canvasUrl: entry.url, showCanvas: true }, storage);
  const saved = JSON.parse(storage.getItem('video:ws-one'));
  assert.equal(saved.prompt, 'Existing brief');
  assert.equal(saved.selectedModel, 'draft-model');
  assert.equal(saved.canvasUrl, 'new-url');
  assert.equal(saved.showCanvas, true);
  assert.deepEqual(saved.localHistory, [entry, { id: 'older', url: 'older-url' }]);
});

test('malformed or inaccessible local persistence does not break the studio', () => {
  const storage = makeStorage();
  storage.setItem('image:ws-one:pending-v1', '{broken');
  assert.deepEqual(readPendingJobs('image:ws-one', storage), []);
  const unavailable = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(readPendingJobs('image:ws-one', unavailable), []);
  assert.equal(writePendingJobs('image:ws-one', [{ requestId: 'token', model: 'model' }], unavailable), false);
});
