import { test, expect, signIn, signOut, ACCESS_CODE } from './fixtures.mjs';
import { createHmac } from 'node:crypto';

test('access code validates empty/invalid inputs and never stores the credential', async ({ page }) => {
  await page.goto('/studio');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('Enter your access code first');
  await expect(page.getByLabel('Access code', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Access code', { exact: true }).fill('invalid-qa-code');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText("isn't valid");
  await page.getByLabel('Access code', { exact: true }).fill(ACCESS_CODE);
  await page.getByRole('button', { name: 'Show code' }).click();
  await expect(page.getByLabel('Access code', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  const cookie = (await page.context().cookies()).find((item) => item.name === 'aquora_session');
  expect(cookie?.httpOnly).toBe(true);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(ACCESS_CODE);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
});

test('settings dialog closes with Escape and returns keyboard focus', async ({ page }) => {
  await signIn(page);
  const trigger = page.getByRole('button', { name: 'Settings', exact: true });
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('a failed logout keeps the authenticated workspace and explains retry', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/session', (route) => route.request().method() === 'DELETE'
    ? route.fulfill({ status: 503, json: { message: 'Temporary logout failure' } })
    : route.continue());
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText("Couldn't sign out");
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Access code', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/session');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Access code', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Access code', { exact: true })).toBeVisible();
});

test('expired session requires authentication again without a blank screen', async ({ page }) => {
  await signIn(page);
  const cookie = (await page.context().cookies()).find((item) => item.name === 'aquora_session');
  const payload = JSON.parse(Buffer.from(cookie.value.split('.')[0], 'base64url').toString());
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now - 60, exp: now - 1 })).toString('base64url');
  const signature = createHmac('sha256', 'local-e2e-secret-never-for-production-2026').update(body).digest('base64url');
  // The browser still sends this cookie. The real gateway must reject its
  // valid signature because the session payload has expired.
  await page.context().addCookies([{ ...cookie, value: `${body}.${signature}`, expires: -1 }]);
  await page.reload();
  await expect(page.getByLabel('Access code', { exact: true })).toBeVisible();
  await page.getByLabel('Access code', { exact: true }).fill(ACCESS_CODE);
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByPlaceholder('Describe the image you want to create')).toBeVisible();
  await signOut(page);
});

test('studio navigation tracks browser back/forward and refresh', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Video', exact: true }).click();
  await page.getByRole('link', { name: 'Video Studio', exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/video$/);
  await expect(page.getByRole('heading', { name: 'Create your first video', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/studio\/image$/);
  await expect(page.getByPlaceholder('Describe the image you want to create')).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Create your first video', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Create your first video', exact: true })).toBeVisible();
});

test('invalid studio URL is 404 and retired/deep-link aliases redirect', async ({ page }) => {
  const invalid = await page.goto('/studio/definitely-not-a-tool');
  expect(invalid.status()).toBe(404);
  await expect(page.getByRole('heading', { name: "This page doesn't exist" })).toBeVisible();
  for (const legacy of ['/studio/apps', '/studio/vibe-motion', '/assistant']) {
    await page.goto(legacy);
    await expect(page).toHaveURL(/\/studio$/);
  }
  await page.goto('/agents');
  await expect(page).toHaveURL(/\/studio\/agents$/);
  await page.goto('/workflow');
  await expect(page).toHaveURL(/\/studio\/workflows$/);
});

test('deployment setup state shows a notice and can recover', async ({ page }) => {
  await page.route('**/api/session', (route) => route.fulfill({ status: 200, json: { authenticated: false, gate: 'setup_required' } }));
  await page.goto('/studio');
  await expect(page.getByRole('heading', { name: 'Workspace unavailable' })).toBeVisible();
  await page.unroute('**/api/session');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByLabel('Access code', { exact: true })).toBeVisible();
});

test('session outage shows a retry notice and can recover', async ({ page }) => {
  await page.route('**/api/session', (route) => route.fulfill({ status: 503, json: { message: 'Temporary outage' } }));
  await page.goto('/studio');
  await expect(page.getByRole('heading', { name: "Couldn't reach Aquora" })).toBeVisible();
  await page.unroute('**/api/session');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByLabel('Access code', { exact: true })).toBeVisible();
});
