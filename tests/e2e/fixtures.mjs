import { test as base, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ACCESS_CODE = 'qa-workspace-alpha-2026';
export const OTHER_ACCESS_CODE = 'qa-workspace-bravo-2026';
export const MOCK_ORIGIN = 'http://127.0.0.1:4017';

// Production CSP permits fal's HTTPS media CDN, while the offline upstream
// emits localhost HTTP assets. Rehost only those fixture URLs in responses;
// submission, authorization, polling and database writes run unchanged.
function fixtureUrls(value) {
  if (typeof value === 'string' && value.startsWith(`${MOCK_ORIGIN}/`)) {
    return value.replace(MOCK_ORIGIN, 'https://fal.media/__qa-fixtures');
  }
  if (Array.isArray(value)) return value.map(fixtureUrls);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fixtureUrls(item)]));
  return value;
}

export const test = base.extend({
  page: async ({ page }, runFixture, testInfo) => {
    // Model one trusted local proxy and a distinct client per test. Requests
    // within a test keep the same IP, so validation and rate limits stay real.
    const address = createHash('sha256').update(`${testInfo.testId}:${testInfo.retry}`).digest();
    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `198.18.${address[0]}.${address[1]}` });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://fal.media' && url.pathname.startsWith('/__qa-fixtures/')) {
        const response = await page.request.get(`${MOCK_ORIGIN}${url.pathname.slice('/__qa-fixtures'.length)}`);
        return route.fulfill({ response });
      }
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return route.abort('blockedbyclient');
      if (/^\/api\/v1\/predictions\/[^/]+\/result$/.test(url.pathname) || /^\/api\/workflow\/run\/[^/]+\/api-outputs$/.test(url.pathname)) {
        const response = await route.fetch();
        let json;
        try { json = await response.json(); } catch { return route.fulfill({ response }); }
        return route.fulfill({ response, json: fixtureUrls(json) });
      }
      return route.continue();
    });
    await runFixture(page);
  },
});

export { expect };

export async function capturePreview(page, name, fullPage = false) {
  if (process.env.E2E_CAPTURE_PREVIEWS !== 'true') return;
  const directory = path.resolve('docs/audit-preview');
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage });
}

export async function signIn(page, code = ACCESS_CODE, destination = '/studio/image') {
  await page.goto('/studio/image');
  await page.getByLabel('Access code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Access code', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  if (destination !== '/studio/image') {
    await page.goto(destination);
    await expect(page.locator('#aquora-access-code')).toHaveCount(0);
  }
}

export async function localApi(page, path, { method = 'GET', body } = {}) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }, { path, method, body });
}

export async function signOut(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Access code', { exact: true })).toBeVisible();
}

export async function mockState(request) {
  const response = await request.get(`${MOCK_ORIGIN}/__mock/state`);
  return response.json();
}
