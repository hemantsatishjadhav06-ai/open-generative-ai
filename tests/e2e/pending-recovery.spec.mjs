import { test, expect, signIn, signOut, ACCESS_CODE, OTHER_ACCESS_CODE, mockState } from './fixtures.mjs';

for (const studio of ['image', 'video', 'audio']) {
  test(`${studio} resumes the same unfinished generation after a browser refresh`, async ({ page, request }) => {
    await signIn(page, undefined, `/studio/${studio}`);
    if (studio === 'audio') {
      await page.getByRole('button', { name: 'Minimax Voice Clone', exact: true }).click();
      await page.getByRole('button', { name: /^MM Audio V2/ }).click();
    }
    const before = await mockState(request);
    let releaseResult = false;
    let polled = 0;
    await page.route('**/api/v1/predictions/*/result', (route) => {
      polled += 1;
      return releaseResult
        ? route.fallback()
        : route.fulfill({ status: 200, json: { status: 'processing', is_complete: false } });
    });
    const prompt = `QA pending ${studio}: an ocean at sunrise`;
    const label = studio === 'image' ? 'Image prompt' : studio === 'video' ? 'Video prompt' : 'Prompt';
    await page.getByLabel(label, { exact: true }).fill(prompt);
    await page.getByRole('button', { name: studio === 'audio' ? 'Generate Track' : 'Generate', exact: true }).click();
    await expect.poll(() => polled).toBeGreaterThan(0);
    const pollsBeforeRefresh = polled;
    await page.reload();
    await expect.poll(() => polled).toBeGreaterThan(pollsBeforeRefresh);
    await expect(page.getByRole('button', { name: /Generating/ })).toBeDisabled();
    releaseResult = true;
    if (studio === 'image') {
      await expect(page.getByAltText(prompt.slice(0, 30), { exact: true }).first()).toBeVisible();
    } else if (studio === 'video') {
      await expect(page.locator('main video').first()).toHaveAttribute('src', /__qa-fixtures\/media\/sample\.mp4/);
    } else {
      await expect(page.locator('main audio')).toHaveAttribute('src', /__qa-fixtures\/media\/sample\.mp3/);
    }
    expect((await mockState(request)).counters.submit).toBe(before.counters.submit + 1);
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(prompt);
    await expect.poll(() => page.evaluate(() => Object.entries(localStorage).some(([key, raw]) => key.endsWith(':pending-v1') && JSON.parse(raw).length > 0))).toBe(false);
    // A second immediate refresh must keep the newly recovered output.
    await page.reload();
    if (studio === 'image') {
      await expect(page.getByAltText(prompt.slice(0, 30), { exact: true }).first()).toBeVisible();
    } else if (studio === 'video') {
      await expect(page.locator('main video').first()).toHaveAttribute('src', /__qa-fixtures\/media\/sample\.mp4/);
    } else {
      await expect(page.locator('main audio')).toHaveAttribute('src', /__qa-fixtures\/media\/sample\.mp3/);
    }
    expect((await mockState(request)).counters.submit).toBe(before.counters.submit + 1);
  });
}

test('an unfinished image stays private to its workspace and a transient poll error is retried', async ({ page, request }) => {
  await signIn(page);
  const before = await mockState(request);
  let releaseResult = false;
  let polled = 0;
  let injectTransientError = true;
  await page.route('**/api/v1/predictions/*/result', (route) => {
    polled += 1;
    if (injectTransientError) {
      injectTransientError = false;
      return route.fulfill({ status: 503, json: { message: 'Temporary poll outage' } });
    }
    return releaseResult
      ? route.fallback()
      : route.fulfill({ status: 200, json: { status: 'processing', is_complete: false } });
  });
  const prompt = 'QA private pending image at sunrise';
  await page.getByLabel('Image prompt', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect.poll(() => polled).toBeGreaterThan(1);
  expect(await page.evaluate(() => Object.entries(localStorage).some(([key, raw]) => key.endsWith(':pending-v1') && JSON.parse(raw).length > 0))).toBe(true);
  await signOut(page);
  await page.getByLabel('Access code', { exact: true }).fill(OTHER_ACCESS_CODE);
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.getByLabel('Image prompt', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
  expect((await mockState(request)).counters.submit).toBe(before.counters.submit + 1);
});

test('a stale unfinished token clears after signing back into the same workspace without resubmitting', async ({ page, request }) => {
  await signIn(page);
  const before = await mockState(request);
  let polled = 0;
  await page.route('**/api/v1/predictions/*/result', (route) => {
    polled += 1;
    return route.fulfill({ status: 200, json: { status: 'processing', is_complete: false } });
  });
  await page.getByLabel('Image prompt', { exact: true }).fill('QA stale pending token');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect.poll(() => polled).toBeGreaterThan(0);
  await signOut(page);
  await page.unroute('**/api/v1/predictions/*/result');
  await page.getByLabel('Access code', { exact: true }).fill(ACCESS_CODE);
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => Object.entries(localStorage).some(([key, raw]) => key.endsWith(':pending-v1') && JSON.parse(raw).length > 0))).toBe(false);
  expect((await mockState(request)).counters.submit).toBe(before.counters.submit + 1);
});
