import { expect, type Page } from '@playwright/test';

/** Completes onboarding with a clinician plan of one short exercise (1 set × 3 reps, no rest). */
export async function onboardWithPlan(page: Page, opts: { name?: string; reps?: number } = {}) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Rehab done right.' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Explore the demo profile' }).click();
  await expect(page.getByText('Demo profile.', { exact: false }).first()).toBeVisible();
  // The sample history is written after the profile; wait until the home plot shows it.
  await expect(page.getByText('Reliable measurement').first()).toBeVisible();
}
