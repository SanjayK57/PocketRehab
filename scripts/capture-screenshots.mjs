// Captures README screenshots from a running dev server (npm run dev) using the demo profile.
// Usage: node scripts/capture-screenshots.mjs [baseUrl]
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
mkdirSync('docs/screenshots', { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`${base}/#/welcome`);
await page.screenshot({ path: 'docs/screenshots/welcome.png' });
await page.getByRole('button', { name: 'Explore the demo profile' }).click();
await page.getByText('Reliable measurement').first().waitFor();
await page.waitForTimeout(600);
await page.screenshot({ path: 'docs/screenshots/home.png' });
await page.goto(`${base}/#/progress`);
await page.getByRole('heading', { name: 'Movement fingerprint' }).waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: 'docs/screenshots/progress.png', fullPage: true });
await page.goto(`${base}/#/plan`);
await page.waitForTimeout(400);
await page.screenshot({ path: 'docs/screenshots/plan.png' });
await page.goto(`${base}/#/progress/report`);
await page.getByRole('heading', { name: 'PocketRehab progress report' }).waitFor();
await page.screenshot({ path: 'docs/screenshots/report.png' });
// Simulated live session
await page.goto(`${base}/#/session/demo-shoulder-abduction`);
await page.getByRole('button', { name: /Simulated demo/ }).click();
await page.getByRole('button', { name: 'Skip check-in' }).click();
await page.waitForTimeout(9000);
await page.screenshot({ path: 'docs/screenshots/live-session.png' });
// Mobile
const mctx = await browser.newContext({ ...devices['Pixel 7'] });
const m = await mctx.newPage();
await m.goto(`${base}/#/welcome`);
await m.getByRole('button', { name: 'Explore the demo profile' }).click();
await m.getByText('Reliable measurement').first().waitFor();
await m.waitForTimeout(600);
await m.screenshot({ path: 'docs/screenshots/mobile-home.png' });
await browser.close();
console.log('screenshots saved to docs/screenshots');
