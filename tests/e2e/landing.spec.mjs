import { test, expect, signIn, capturePreview as preview } from './fixtures.mjs';

test('desktop landing explains access, offers the real tools and opens the workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your ideas. One creative workspace.');
  await expect(page.getByText('Workspace access is managed by your administrator. No installation required.')).toBeVisible();
  await expect(page.getByText(/Available models and tools depend on your workspace configuration/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the studio', exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await preview(page, 'landing-desktop', true);
  await page.getByRole('link', { name: 'Open the studio', exact: true }).first().click();
  await expect(page.getByLabel('Access code', { exact: true })).toBeVisible();
});

test('mobile landing and image workspace fit the screen and retain their primary actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await preview(page, 'landing-mobile', true);
  await signIn(page);
  await expect(page.getByLabel('Image prompt', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await preview(page, 'image-mobile');
});

test('desktop studio has a named workspace landmark and a clear starting point', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  await expect(page.getByRole('main', { name: 'Image Studio', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create your first image', exact: true })).toBeVisible();
  await expect(page.getByLabel('Image prompt', { exact: true })).toBeVisible();
  await preview(page, 'image-desktop');
});
