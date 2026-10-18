import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';

const OUT = '/private/tmp/claude-501/-Users-sanjaykoripelli-Desktop-Congressional-App-Challenge/d3c29160-7320-4c23-a6de-bcf2db65266c/scratchpad/audit/shots-ui';
const VIDEO = '/Users/sanjaykoripelli/Desktop/Congressional App Challenge/PocketRehab/tests/fixtures/video/jumping-jacks-burpees.y4m';
const BASE = 'http://localhost:4173/';
fs.mkdirSync(OUT, { recursive: true });
const which = process.argv[2] ?? 'all';
const log = [];

const browser = await chromium.launch({
  args: ['--mute-audio', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${VIDEO}`],
});

const profiles = {
  d: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  m: { ...devices['Pixel 7'] },
};

async function ctx(p) {
  const c = await browser.newContext({ ...profiles[p], permissions: ['camera'] });
  const page = await c.newPage();
  page.on('pageerror', (e) => log.push(`[${p}] pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`[${p}] console.${m.type()} ${m.text().slice(0, 300)}`); });
  return { c, page };
}

async function shot(page, p, name, full = true) {
  await page.waitForTimeout(400);
  const ov = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > w + 1) && getComputedStyle(el).position !== 'fixed') bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`);
    }
    return { sw: document.documentElement.scrollWidth, w, bad: bad.slice(0, 5) };
  });
  if (ov.sw > ov.w + 1 || ov.bad.length) log.push(`[${p}] OVERFLOW ${name} scrollWidth=${ov.sw} vw=${ov.w} ${ov.bad.join(' | ')}`);
  await page.screenshot({ path: `${OUT}/${p}-${name}.png`, fullPage: full });
}

async function onboarding(p) {
  const { c, page } = await ctx(p);
  await page.goto(BASE);
  await page.waitForSelector('h1');
  await shot(page, p, 'ob01-welcome');
  // error state on step 0
  await page.getByRole('button', { name: 'Get started' }).click();
  await shot(page, p, 'ob01b-welcome-error', false);
  await page.getByLabel(/I understand that PocketRehab/).check();
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await shot(page, p, 'ob02-about-error');
  await page.fill('#name', 'Sam');
  await page.getByLabel('A longer-term condition').check();
  await page.getByLabel('Knee').check();
  await shot(page, p, 'ob02-about');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel(/Yes, I have instructions/).check();
  await shot(page, p, 'ob03-plan-yes');
  await page.getByLabel(/Not yet/).check();
  await shot(page, p, 'ob03-plan-notyet');
  await page.getByRole('button', { name: 'Continue' }).click();
  await shot(page, p, 'ob04-restrictions');
  await page.getByRole('button', { name: 'Continue' }).click();
  await shot(page, p, 'ob05-feel');
  await page.getByRole('button', { name: 'Continue' }).click();
  await shot(page, p, 'ob06-schedule');
  await page.getByRole('button', { name: 'Continue' }).click();
  await shot(page, p, 'ob07-coaching');
  await page.getByRole('button', { name: 'Continue' }).click();
  await shot(page, p, 'ob08-privacy');
  await page.getByRole('button', { name: 'Continue' }).click();
  await shot(page, p, 'ob09-camera');
  const camBtn = page.getByRole('button', { name: /camera/i }).first();
  if (await camBtn.count()) {
    await camBtn.click().catch(() => {});
    await page.waitForTimeout(9000);
    await shot(page, p, 'ob09b-camera-on', false);
  }
  await page.getByRole('button', { name: 'Continue' }).click();
  await shot(page, p, 'ob10-review');
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await page.waitForTimeout(1500);
  await shot(page, p, 'fresh-home');
  for (const [r, n] of [['#/progress', 'fresh-progress'], ['#/progress/history', 'fresh-history'], ['#/plan', 'fresh-plan'], ['#/progress/report', 'fresh-report']]) {
    await page.goto(BASE + r); await page.waitForTimeout(1200); await shot(page, p, n);
  }
  await c.close();
}

async function demo(p) {
  const { c, page } = await ctx(p);
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Explore the demo profile' }).click();
  await page.waitForURL(/#\/$/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await shot(page, p, 'home');
  await shot(page, p, 'home-fold', false);
  const routes = [
    ['#/plan', 'plan'], ['#/plan/schedule', 'plan-schedule'], ['#/plan/equipment', 'plan-equipment'], ['#/plan/history', 'plan-history'], ['#/plan/edit', 'plan-edit'],
  ];
  for (const [r, n] of routes) { await page.goto(BASE + r); await page.waitForTimeout(1000); await shot(page, p, n); }
  await page.goto(BASE + '#/plan'); await page.waitForTimeout(800);
  await page.locator('a[href*="plan/exercise/"]').first().click(); await page.waitForTimeout(1500);
  await shot(page, p, 'exercise-detail');
  await page.goto(BASE + '#/session'); await page.waitForTimeout(1000); await shot(page, p, 'session-list');
  await page.locator('li', { hasText: 'Arm raise' }).first().locator('a[href*="session/"]').click();
  await page.waitForTimeout(1500);
  await shot(page, p, 'session-intro');
  await page.getByRole('button', { name: /Simulated demo/ }).click();
  await page.waitForTimeout(800);
  await shot(page, p, 'pre-checkin');
  await page.getByLabel('Worse', { exact: true }).first().check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(800);
  await shot(page, p, 'safety-stop');
  await page.getByLabel(/My clinician’s instructions say/).check();
  await page.getByRole('button', { name: 'Continue as my clinician instructed' }).click();
  await page.waitForTimeout(1500);
  await shot(page, p, 'live-countdown', false);
  await page.waitForTimeout(5000);
  await shot(page, p, 'live-active-1', false);
  await shot(page, p, 'live-active-1-full', true);
  await page.waitForTimeout(4000);
  await shot(page, p, 'live-active-2', false);
  // wait for post check-in
  let restShot = false;
  for (let i = 0; i < 150; i++) {
    if (await page.getByRole('button', { name: 'Save and see summary' }).count()) break;
    const nxt = page.getByRole('button', { name: 'Start next set now' });
    if (await nxt.count()) {
      if (!restShot) { await shot(page, p, 'live-rest', false); restShot = true; }
      await nxt.click().catch(() => {});
    }
    if (i === 20) await shot(page, p, 'live-active-3', false);
    await page.waitForTimeout(1000);
  }
  if (!(await page.getByRole('button', { name: 'Save and see summary' }).count())) log.push(`[${p}] post-checkin never appeared`);
  await shot(page, p, 'post-checkin');
  await page.getByRole('button', { name: 'Save and see summary' }).click().catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, p, 'summary');
  const routes2 = [
    ['#/progress', 'progress'], ['#/progress/history', 'progress-history'], ['#/progress/compare', 'progress-compare'], ['#/progress/week', 'progress-week'], ['#/progress/report', 'progress-report'],
    ['#/checkin', 'checkin'], ['#/settings', 'settings'], ['#/settings/about', 'about'], ['#/nope', 'notfound'],
  ];
  for (const [r, n] of routes2) { await page.goto(BASE + r); await page.waitForTimeout(1500); await shot(page, p, n); }
  await page.goto(BASE + '#/progress/history'); await page.waitForTimeout(1000);
  await page.locator('a[href*="progress/session/"]').nth(1).click(); await page.waitForTimeout(1500);
  await shot(page, p, 'session-detail');
  await c.close();
}

async function cameraSetup(p) {
  const { c, page } = await ctx(p);
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Explore the demo profile' }).click();
  await page.waitForTimeout(2500);
  await page.goto(BASE + '#/session'); await page.waitForTimeout(1000);
  await page.locator('li', { hasText: 'Arm raise' }).first().locator('a[href*="session/"]').click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /Use my camera/ }).click();
  await page.getByRole('button', { name: /Skip check-in/ }).click();
  await page.waitForTimeout(1000);
  await shot(page, p, 'cam-setup-0', false);
  const turnOn = page.getByRole('button', { name: /Turn on|camera/i }).first();
  await turnOn.click().catch(() => {});
  await page.waitForTimeout(15000);
  await shot(page, p, 'cam-setup-1', false);
  await shot(page, p, 'cam-setup-1-full', true);
  const anyway = page.getByRole('button', { name: /Start anyway/ });
  if (await anyway.count()) { await anyway.click(); }
  else await page.getByRole('button', { name: 'Start exercise' }).click().catch(() => {});
  await page.waitForTimeout(12000);
  await shot(page, p, 'cam-live-1', false);
  await page.waitForTimeout(8000);
  await shot(page, p, 'cam-live-2', false);
  await c.close();
}

try {
  for (const p of ['d', 'm']) {
    if (which === 'onboarding') await onboarding(p).catch((e) => log.push(`[${p}] onboarding FAIL ${e.message.split('\n')[0]}`));
    if (which === 'all' || which === 'demo') await demo(p).catch((e) => log.push(`[${p}] demo FAIL ${e.message.split('\n')[0]}`));
    if (which === 'demo2' && p === 'm') await demo(p).catch((e) => log.push(`[${p}] demo FAIL ${e.message.split('\n')[0]}`));
    if (which === 'camera') await cameraSetup(p).catch((e) => log.push(`[${p}] camera FAIL ${e.message.split('\n')[0]}`));
  }
} finally {
  await browser.close();
  fs.writeFileSync(`${OUT}/log-${which}.txt`, log.join('\n'));
  console.log(log.join('\n'));
}
