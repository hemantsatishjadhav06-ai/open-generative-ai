import { test, expect, signIn, mockState } from './fixtures.mjs';

test('failed model discovery blocks generation and offers a safe retry', async ({ page, request }) => {
  const before = await mockState(request);
  await page.route('**/api/v1/models/available', route => route.fulfill({ status: 503, json: { error: 'temporary_failure' } }));
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Models could not be loaded' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toHaveCount(0);
  await page.unroute('**/api/v1/models/available');
  await page.getByRole('button', { name: 'Retry loading models' }).click();
  await expect(page.getByLabel('Image prompt', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeVisible();
  const after = await mockState(request);
  expect(after.counters.submit).toBe(before.counters.submit);
});

test('slow model discovery shows a loading state without unverified pickers', async ({ page }) => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/v1/models/available', async route => { await held; await route.continue(); });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Preparing your studio…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toHaveCount(0);
  release();
  await expect(page.getByLabel('Image prompt', { exact: true })).toBeVisible();
});
