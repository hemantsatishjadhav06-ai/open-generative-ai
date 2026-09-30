import { test, expect, signIn } from './fixtures.mjs';

const studios = [
  ['image', 'Create your first image'],
  ['layers', /Layer Decomposition|Layers|Edit your image/i],
  ['video', 'Create your first video'],
  ['audio', 'Create your first audio'],
  ['clipping', /AI CLIPPING STUDIO/i],
  ['motion-control', /MOTION CONTROL STUDIO/i],
  ['lipsync', /LIP SYNC STUDIO/i],
  ['body-swap', /BODY SWAP STUDIO/i],
  ['cinema', /CINEMA STUDIO/i],
  ['marketing', /MARKETING STUDIO/i],
  ['workflows', 'Workflows'],
  ['agents', 'Agents'],
  ['design-agent', /Design Agent|Design Studio|design|canvas/i],
  ['ai-influencer', /AI INFLUENCER|Builder|influencer/i],
  ['reelty', /Reelty/i],
];

for (const [id, content] of studios) {
  test(`the ${id} studio deep link renders without a client exception`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await signIn(page, undefined, `/studio/${id}`);
    if (id === 'reelty') {
      // The external Reelty app is deliberately blocked. Verify safe handoff.
      const handoff = page.getByRole('link', { name: /^Open Reelty/ }).first();
      await expect(handoff).toBeVisible();
      await expect(handoff).toHaveAttribute('href', /^https:\/\/web-production-0e433\.up\.railway\.app\//);
    } else {
      const workspace = page.locator('#workspace-content');
      if (id === 'design-agent') {
        await expect(workspace.getByRole('heading', { name: 'New canvas', exact: true })).toBeVisible();
        await expect(workspace.getByRole('textbox', { name: 'Message the design agent', exact: true })).toBeVisible();
        await expect(page.getByRole('main')).toHaveCount(1);
      }
      await expect(workspace).toContainText(content);
      await expect(workspace.getByRole('button').first()).toBeVisible();
    }
    expect(errors, `${id}: ${errors.join('\n')}`).toEqual([]);
  });
}

test('mobile image/video workflows keep navigation and Generate reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const prompt = page.getByPlaceholder('Describe the image you want to create');
  await expect(prompt).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await page.getByRole('button', { name: 'Toggle navigation menu' }).click();
  await page.getByRole('button', { name: 'Video', exact: true }).click();
  await page.getByRole('link', { name: 'Video Studio', exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/video$/);
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
});

test('workflow and agent list failures offer a retry and recover', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/workflow/get-template-workflows', (route) => route.fulfill({ status: 503, json: { message: 'Temporary failure' } }));
  await page.goto('/studio/workflows');
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
  await page.unroute('**/api/workflow/get-template-workflows');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
  await page.route('**/api/agents/templates/agents', (route) => route.fulfill({ status: 503, json: { message: 'Temporary failure' } }));
  await page.goto('/studio/agents');
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
  await page.unroute('**/api/agents/templates/agents');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
});

test('Chinese deep links retain the requested studio and localized sign-in', async ({ page }) => {
  await page.goto('/zh/studio/video');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('#aquora-access-code')).toBeVisible();
  await page.locator('#aquora-access-code').fill('qa-workspace-alpha-2026');
  await page.locator('form button[type="submit"]').click();
  await expect(page.locator('#aquora-access-code')).toHaveCount(0);
  await expect(page).toHaveURL(/\/zh\/studio\/video$/);
  await expect(page.getByRole('heading').first()).toBeVisible();
});
