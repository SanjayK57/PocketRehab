import { chromium, expect, test } from '@playwright/test';
import { onboardWithPlan } from './helpers';

/**
 * Camera behaviour in a real browser.
 * - Permission denied: the app explains it and offers simulated/manual fallbacks.
 * - Fake camera: Chromium's synthetic camera (a test pattern, no person) proves the
 *   real camera → MediaPipe WebAssembly pipeline starts on-device and that the
 *   setup checks correctly refuse to treat "no person" as a usable measurement.
 */

test('camera permission denied shows an honest fallback', async ({ page, context }) => {
  await context.clearPermissions();
  await onboardWithPlan(page);
  await page.goto('/#/session');
  await page.getByRole('main').getByRole('link', { name: 'Start', exact: true }).first().click();
  await page.getByRole('button', { name: /Use my camera/ }).click();
  await page.getByRole('button', { name: 'Skip check-in' }).click();
  // Deny the permission prompt.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await page.getByRole('button', { name: 'Turn on camera' }).click();
  await expect(page.getByText('Camera permission was not granted')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use simulated demo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log without camera' }).first().click();
  await expect(page.getByRole('heading', { name: 'Log your session' })).toBeVisible();
});

test('fake camera: on-device pose model loads and setup refuses an empty scene', async () => {
  test.setTimeout(180_000);
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ permissions: ['camera'], baseURL: 'http://localhost:4173', viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  // Record every camera stream the page opens so we can check they are all stopped afterwards.
  await context.addInitScript(() => {
    const w = window as unknown as { __streams: MediaStream[] };
    w.__streams = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await original(c);
      w.__streams.push(s);
      return s;
    };
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await onboardWithPlan(page);
  await page.goto('/#/session');
  await page.getByRole('main').getByRole('link', { name: 'Start', exact: true }).first().click();
  await page.getByRole('button', { name: /Use my camera/ }).click();
  await page.getByRole('button', { name: 'Skip check-in' }).click();
  await page.getByRole('button', { name: 'Turn on camera' }).click();
  // The real model runs: the stats line appears once frames are processed.
  await expect(page.getByText(/Tracking at \d+ frames\/s/)).toBeVisible({ timeout: 90_000 });
  // No person in Chromium's test pattern, so setup must not report ready.
  await expect(page.getByRole('button', { name: 'Waiting for all checks…' })).toBeDisabled();
  await expect(page.getByText('A person is in view')).toBeVisible();
  // Leaving stops the camera (no lingering tracks).
  await page.getByRole('link', { name: 'All exercises' }).click();
  await expect(page.getByRole('heading', { name: 'Start a session' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) => s.getTracks()).map((t) => t.readyState)))
    .toEqual(['ended']);
  expect(errors).toEqual([]);
  await browser.close();
});
