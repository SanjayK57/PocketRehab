import { chromium, expect, test } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { onboardWithPlan } from './helpers';

/**
 * Real computer vision on a real person, with no physical camera:
 * Chromium plays an openly licensed clip ("Jumping jacks and burpees" by Taco fleur,
 * CC BY-SA 4.0, Wikimedia Commons) as its camera. The actual MediaPipe model runs
 * in the page. Fetch the clip first with: sh scripts/fetch-test-video.sh
 *
 * This checks detection, the setup checks, live angle measurement and the
 * quality states on real footage. Jumping jacks are fast and are not a rehab
 * movement, so the rep counter is expected to reject many of them as too fast;
 * the numbers are recorded honestly in docs/evaluation/real-video-run.json.
 */
const video = resolve('tests/fixtures/video/jumping-jacks-burpees.y4m');

test('real person via fake camera: detection, setup checks, live measurement', async () => {
  test.skip(!existsSync(video), 'Run sh scripts/fetch-test-video.sh to download the test clip');
  test.setTimeout(240_000);
  const browser = await chromium.launch({
    args: ['--mute-audio', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  });
  const context = await browser.newContext({ permissions: ['camera'], baseURL: 'http://localhost:4173', viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await onboardWithPlan(page, { reps: 50 });
  await page.goto('/#/session');
  await page.getByRole('main').getByRole('link', { name: 'Start', exact: true }).first().click();
  await page.getByRole('button', { name: /Use my camera/ }).click();
  await page.getByRole('button', { name: 'Skip check-in' }).click();
  await page.getByRole('button', { name: 'Turn on camera' }).click();
  await expect(page.getByText(/Tracking at \d+ frames\/s/)).toBeVisible({ timeout: 90_000 });

  // The model must find the person and see that they face the camera.
  await expect(page.getByText('A person is in view: OK')).toBeAttached({ timeout: 30_000 });
  await expect(page.getByText('Facing the camera: OK')).toBeAttached({ timeout: 30_000 });
  const fpsText = (await page.getByText(/Tracking at \d+ frames\/s/).textContent()) ?? '';

  mkdirSync('docs/screenshots', { recursive: true });
  await page.locator('.aspect-\\[4\\/3\\]').first().screenshot({ path: 'docs/screenshots/real-person-setup.png' });

  // Start (the person bends for burpees, so checks may not all hold at once).
  const startBtn = page.getByRole('button', { name: 'Start exercise' });
  if (await startBtn.isEnabled().catch(() => false)) await startBtn.click();
  else await page.getByRole('button', { name: /Start anyway/ }).click();

  await page.waitForTimeout(25_000);
  await page.locator('.aspect-\\[4\\/3\\]').first().screenshot({ path: 'docs/screenshots/real-person-live.png' });
  const angleLabel = page.getByText('Arm angle', { exact: true });
  const angleText = (await angleLabel.isVisible()) ? ((await angleLabel.locator('..').textContent({ timeout: 2000 })) ?? '') : 'session already finished';

  if (!(await page.getByRole('heading', { name: 'Session complete' }).isVisible())) {
    await page.keyboard.press('Escape'); // keyboard shortcut for "End"
    await page.getByRole('button', { name: 'End and save' }).click();
  }
  await page.getByRole('button', { name: 'Skip check-in' }).click();
  await expect(page.getByRole('heading', { name: /Arm raise to the side: (ended early|completed)/ })).toBeVisible();
  const reliableText = (await page.getByText(/of frames had reliable tracking/).textContent()) ?? '';
  const repsText = (await page.getByText('Repetitions counted').locator('..').textContent()) ?? '';
  const notCountedText = (await page.getByText('Movements not counted').locator('..').textContent()) ?? '';

  mkdirSync('docs/evaluation', { recursive: true });
  writeFileSync(
    'docs/evaluation/real-video-run.json',
    JSON.stringify({ clip: 'Jumping jacks and burpees (Taco fleur, CC BY-SA 4.0), first 20 s looped, 480x360 @ 15 fps', ranAt: new Date().toISOString(), fpsText, angleText, reliableText, repsText, notCountedText, pageErrors: errors }, null, 2),
  );
  expect(reliableText).toMatch(/\d+%/);
  expect(errors).toEqual([]);
  await browser.close();
});
