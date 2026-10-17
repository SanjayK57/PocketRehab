import { expect, test } from '@playwright/test';
import { loadDemoProfile } from './helpers';

test('navigation works at this viewport and nothing overflows horizontally', async ({ page }) => {
  await loadDemoProfile(page);
  for (const path of ['/#/', '/#/plan', '/#/session', '/#/progress', '/#/settings', '/#/plan/schedule', '/#/progress/report']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
  const width = page.viewportSize()?.width ?? 0;
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  if (width < 1024) {
    await expect(nav.last()).toBeVisible();
    await nav.last().getByRole('link', { name: 'Progress' }).click();
    await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();
  } else {
    await expect(nav.first()).toBeVisible();
  }
});

test('keyboard: skip link and tab order reach the main content and navigation', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'keyboard check runs on desktop and tablet');
  await loadDemoProfile(page);
  await page.goto('/#/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  const focusedInMain = await page.evaluate(() => document.activeElement?.id === 'main' || !!document.activeElement?.closest('#main'));
  expect(focusedInMain).toBe(true);
});
