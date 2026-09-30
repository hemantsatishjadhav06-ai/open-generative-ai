import test from 'node:test';
import assert from 'node:assert/strict';
import { postAgentTurn } from '../../Open-Poe-AI/packages/agents/src/utils/api.js';

test('first agent turn posts immediately once without a conversation route handoff', async () => {
  const calls = [];
  const post = async (url, body) => {
    calls.push({ url, body });
    return { data: { conversation_id: body.conversation_id, request_id: 'signed-job' } };
  };
  const result = await postAgentTurn('creative-brief', { message: 'Explain a brief', attachments: [{ url: 'reference.png' }] }, { post });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/agents/by-slug/creative-brief/chat');
  assert.match(calls[0].body.conversation_id, /^[0-9a-f-]{36}$/);
  assert.equal(calls[0].body.message, 'Explain a brief');
  assert.deepEqual(calls[0].body.attachments, [{ url: 'reference.png' }]);
  assert.equal(result.data.conversation_id, calls[0].body.conversation_id);
  assert.equal(result.data.request_id, 'signed-job');
});

test('follow-up turn posts into the existing conversation and HTTP failure is not replayed', async () => {
  const calls = [];
  const failure = new Error('provider unavailable');
  await assert.rejects(postAgentTurn('creative-brief', { message: 'More detail', conversationId: 'existing-conversation' }, {
    post: async (url, body) => { calls.push({ url, body }); throw failure; },
  }), (error) => error === failure);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.conversation_id, 'existing-conversation');
});
