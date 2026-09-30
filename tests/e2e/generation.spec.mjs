import { test, expect, signIn, signOut, OTHER_ACCESS_CODE, mockState } from './fixtures.mjs';

test('image rejects an empty prompt without submitting a paid job', async ({ page, request }) => {
  await signIn(page);
  const before = await mockState(request);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('Please enter a prompt');
  const after = await mockState(request);
  expect(after.counters.submit).toBe(before.counters.submit);
});

test('image submits once, polls successfully and preserves draft/history across refresh', async ({ page, request }) => {
  await signIn(page);
  const before = await mockState(request);
  const prompt = 'QA regression: calm modern creative workspace';
  await page.getByPlaceholder('Describe the image you want to create').fill(prompt);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('button', { name: /Generating/ })).toBeDisabled();
  await expect(page.getByAltText(prompt.slice(0, 30), { exact: true }).first()).toBeVisible();
  await expect.poll(async () => (await mockState(request)).counters.submit).toBe(before.counters.submit + 1);
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate((savedPrompt) => Object.values(localStorage).some((raw) => {
    try { return JSON.parse(raw)?.localHistory?.some((entry) => entry.prompt === savedPrompt && entry.url); }
    catch { return false; }
  }), prompt)).toBe(true);
  await page.reload();
  await expect(page.getByPlaceholder('Describe the image you want to create')).toHaveValue(prompt);
  await expect(page.getByAltText(prompt.slice(0, 30), { exact: true }).first()).toBeVisible();
  await signOut(page);
  await page.getByLabel('Access code', { exact: true }).fill(OTHER_ACCESS_CODE);
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByPlaceholder('Describe the image you want to create')).toHaveValue('');
  await expect(page.getByAltText(prompt.slice(0, 30), { exact: true })).toHaveCount(0);
});

test('provider rejection displays a safe error and the next image attempt works', async ({ page }) => {
  await signIn(page);
  const prompt = page.getByPlaceholder('Describe the image you want to create');
  await prompt.fill('QA regression FAIL_SUBMIT_422');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).not.toContainText('mock-fal-key');
  await prompt.fill('QA regression safe retry');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByAltText('QA regression safe retry', { exact: true }).first()).toBeVisible();
});

test('budget error does not leave image generation stuck', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/v1/*', (route) => route.request().method() === 'POST' && !['/api/v1/estimate', '/api/v1/upload_file'].includes(new URL(route.request().url()).pathname)
    ? route.fulfill({ status: 402, json: { error: 'budget_exceeded', message: "Today's AI budget is used up. It resets at 00:00 UTC." } })
    : route.continue());
  await page.getByPlaceholder('Describe the image you want to create').fill('QA regression budget');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(/budget is used up/);
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
});
