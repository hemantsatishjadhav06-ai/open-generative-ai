import { test, expect, signIn, localApi, mockState, capturePreview } from './fixtures.mjs';

test('video validates required input, generates a local clip and restores draft/history', async ({ page, request }) => {
  await signIn(page, undefined, '/studio/video');
  const before = await mockState(request);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
  expect((await mockState(request)).counters.submit).toBe(before.counters.submit);
  const prompt = 'QA video: a slow cinematic ocean shot';
  await page.getByLabel('Video prompt', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.locator('main video').first()).toBeVisible();
  await expect(page.locator('main video').first()).toHaveAttribute('src', /__qa-fixtures\/media\/sample\.mp4/);
  await expect.poll(async () => (await mockState(request)).counters.submit).toBe(before.counters.submit + 1);
  await expect.poll(() => page.evaluate(() => Object.values(localStorage).some((raw) => raw.includes('QA video: a slow cinematic ocean shot')))).toBe(true);
  await page.reload();
  await expect(page.getByLabel('Video prompt', { exact: true })).toHaveValue(prompt);
  await expect(page.locator('main video').first()).toBeVisible();
});

test('audio model selection validates a required prompt, generates playable audio and persists it', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, undefined, '/studio/audio');
  await page.getByRole('button', { name: 'Minimax Voice Clone', exact: true }).click();
  await page.getByRole('button', { name: /^MM Audio V2/ }).click();
  const before = await mockState(request);
  await page.getByRole('button', { name: 'Generate Track', exact: true }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('required field');
  expect((await mockState(request)).counters.submit).toBe(before.counters.submit);
  await page.getByLabel('Prompt', { exact: true }).fill('QA audio: gentle ocean waves and calm ambience');
  await page.getByRole('button', { name: 'Generate Track', exact: true }).click();
  await expect(page.locator('main audio')).toHaveAttribute('src', /__qa-fixtures\/media\/sample\.mp3/);
  await page.getByRole('button', { name: 'Play', exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  const playerBox = await page.getByRole('button', { name: 'Play', exact: true }).boundingBox();
  expect(playerBox.y).toBeGreaterThanOrEqual(0);
  expect(playerBox.y + playerBox.height).toBeLessThanOrEqual(844);
  await capturePreview(page, 'audio-mobile');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Object.values(localStorage).some((raw) => raw.includes('QA audio: gentle ocean waves and calm ambience')))).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'MM Audio V2', exact: true })).toBeVisible();
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('QA audio: gentle ocean waves and calm ambience');
  await expect(page.getByText('QA audio: gentle ocean waves and calm ambience', { exact: true }).first()).toBeVisible();
});

test('agent is created, edited, chats through the local LLM, persists the conversation and deletes', async ({ page }) => {
  const chatPosts = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/agents\/by-slug\/[^/]+\/chat$/.test(new URL(request.url()).pathname)) {
      chatPosts.push(request.postDataJSON());
    }
  });
  await signIn(page, undefined, '/studio/agents');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/create$/);
  await expect(page.getByRole('button', { name: 'Create agent', exact: true })).toBeDisabled();
  await page.getByLabel('What should your assistant be able to do and be knowledgeable in?').fill('A QA assistant that explains creative briefs clearly.');
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/edit\/[^/]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1);
  await page.locator('input[name="name"]').fill('QA Creative Brief Assistant');
  await page.locator('textarea[name="system_prompt"]').fill('You explain creative briefs in simple language.');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect.poll(async () => (await localApi(page, `/api/agents/by-slug/${id}`)).body.name).toBe('QA Creative Brief Assistant');
  await page.getByRole('link', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'QA Creative Brief Assistant', exact: true })).toBeVisible();
  await page.getByLabel('Message', { exact: true }).fill('QA chat: explain a creative brief');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Mock reply: QA chat: explain a creative brief', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/agents/${id}/[^/]+$`));
  const conversationUrl = page.url();
  await page.getByLabel('Message', { exact: true }).fill('QA chat: give a short example');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Mock reply: QA chat: give a short example', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(conversationUrl);
  expect(chatPosts).toHaveLength(2);
  expect(chatPosts[0].conversation_id).toMatch(/^[a-zA-Z0-9-]+$/);
  expect(chatPosts[0].conversation_id).toBe(chatPosts[1].conversation_id);
  await page.reload();
  await expect(page.getByText('Mock reply: QA chat: explain a creative brief', { exact: true })).toBeVisible();
  await expect(page.getByText('Mock reply: QA chat: give a short example', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(conversationUrl);
  await page.goto(`/agents/edit/${id}`);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete agent', exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/agents$/);
  expect((await localApi(page, `/api/agents/by-slug/${id}`)).status).toBe(404);
});

test('workflow create, rename, local image run, reload and delete form one persistent journey', async ({ page }) => {
  await signIn(page, undefined, '/studio/workflows');
  await page.getByRole('button', { name: 'Create workflow', exact: true }).click();
  await expect(page).toHaveURL(/\/workflow\/[^/]+\/builder$/);
  const id = new URL(page.url()).pathname.split('/')[2];
  // Seed a small deterministic graph through the real API; visual canvas
  // authoring has its own smoke test, while this checks execution end to end.
  const saved = await localApi(page, '/api/workflow/create', {
    method: 'POST',
    body: {
      workflow_id: id,
      name: 'QA image workflow',
      edges: [],
      data: { nodes: [{
        id: 'image1', category: 'image', model: 'flux-2-dev',
        input_params: { prompt: 'QA workflow: a quiet mountain', width: 1024, height: 768, make_output: true },
        params: {}, position: { x: 0, y: 0 },
      }] },
    },
  });
  expect(saved.status).toBe(200);
  await page.goto('/studio/workflows');
  await page.getByRole('tab', { name: 'My workflows', exact: true }).click();
  await page.getByRole('button', { name: 'Options for QA image workflow', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Workflow name', { exact: true }).fill('QA image workflow renamed');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByRole('button', { name: 'QA image workflow renamed', exact: true })).toBeVisible();
  await page.goto(`/workflow/${id}/playground`);
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await expect(page.locator('main img[alt="image1"]')).toBeVisible();
  const definition = await localApi(page, `/api/workflow/get-workflow-def/${id}`);
  expect(definition.body.run_id).toBeTruthy();
  expect(definition.body.run_history.image1).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Run workflow', exact: true })).toBeVisible();
  await page.goto('/studio/workflows');
  await page.getByRole('tab', { name: 'My workflows', exact: true }).click();
  await page.getByRole('button', { name: 'Options for QA image workflow renamed', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'QA image workflow renamed', exact: true })).toHaveCount(0);
  expect((await localApi(page, `/api/workflow/get-workflow-def/${id}`)).status).toBe(404);
});
