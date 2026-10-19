import { expect, type Page } from '@playwright/test';

/** Where the app under test is served (specs that open their own browser need it too). */
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
export const PASSWORD = 'correct horse battery';

/** Creates a local account from the first-run screen and lands in onboarding. */
export async function createAccount(page: Page, opts: { name?: string; password?: string } = {}) {
  const heading = page.getByRole('heading', { name: /Set up PocketRehab|Add an account/ });
  if (!(await heading.isVisible())) await page.goto('/');
  await expect(heading).toBeVisible();
  await page.getByLabel('Account name').fill(opts.name ?? 'Jordan');
  await page.getByLabel('Email', { exact: true }).fill(`${(opts.name ?? 'Jordan').toLowerCase().replace(/[^a-z0-9]+/g, '.')}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(opts.password ?? PASSWORD);
  await page.getByLabel('Type it again').fill(opts.password ?? PASSWORD);
  await page.getByLabel(/I understand that if I forget this password/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Rehab done right.' })).toBeVisible({ timeout: 20_000 });
}

/** Unlocks the account the sign-in screen offers (after a reload, a lock or auto-lock). */
export async function unlock(page: Page, password = PASSWORD) {
  await expect(page.getByRole('heading', { name: /^Welcome back, / })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: /^Welcome back, / })).toHaveCount(0, { timeout: 20_000 });
}

/** Creates an account, then completes onboarding with a clinician plan of one short exercise (1 set × 3 reps, no rest). */
export async function onboardWithPlan(page: Page, opts: { name?: string; reps?: number } = {}) {
  await createAccount(page, { name: opts.name });
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByText('Please confirm you’ve read this')).toBeVisible();
  await page.getByLabel(/I understand that PocketRehab supports/).check();
  await page.getByRole('button', { name: 'Get started' }).click();

  await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Enter the name you’d like PocketRehab to use')).toBeVisible();
  await page.getByLabel('What should we call you?').fill(opts.name ?? 'Jordan');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Your exercise plan' })).toBeVisible();
  await page.getByLabel(/Yes, I have instructions/).check();
  await page.getByRole('button', { name: /Arm raise to the side/ }).click();
  await page.getByRole('spinbutton', { name: 'Sets', exact: true }).fill('1');
  await page.getByRole('spinbutton', { name: 'Reps per set' }).fill(String(opts.reps ?? 3));
  await page.getByRole('spinbutton', { name: 'Rest between sets' }).fill('0');
  await page.getByLabel(/Who gave or approved/).fill('Dr. Test, PT');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Restrictions and notes' })).toBeVisible();
  await page.getByLabel(/Restrictions or precautions/).fill('No weights above shoulder height.');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip' }).click(); // baseline
  await expect(page.getByRole('heading', { name: 'When do you plan to exercise?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Coaching and accessibility' })).toBeVisible();
  // Keep tests quiet and deterministic.
  await page.getByRole('switch', { name: 'Spoken coaching' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Privacy and your camera' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Test your camera' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('heading', { name: 'Review and confirm' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`, ${opts.name ?? 'Jordan'}$`) })).toBeVisible();
}

export async function loadDemoProfile(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^Explore the demo/ }).click();
  await expect(page.getByText('Demo profile.', { exact: false }).first()).toBeVisible();
  // The sample history is written after the profile; wait until the home plot shows it.
  await expect(page.getByText('Reliable measurement').first()).toBeVisible();
}
