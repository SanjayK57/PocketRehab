import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loadDemoProfile, onboardWithPlan } from './helpers';

test.describe('core user journey', () => {
  test('onboarding → simulated session → persistence → progress → report → schedule → delete', async ({ page }) => {
    await onboardWithPlan(page, { name: 'Jordan', reps: 3 });

    // New user: no fabricated progress.
    await expect(page.getByText('No measurements yet.')).toBeVisible();

    // Plan view shows the clinician-entered plan and restrictions.
    await page.getByRole('link', { name: 'My Plan' }).first().click();
    await expect(page.getByText('approved by Dr. Test, PT', { exact: false })).toBeVisible();
    await expect(page.getByText('No weights above shoulder height.')).toBeVisible();
    await page.getByRole('link', { name: /Arm raise to the side/ }).click();
    await expect(page.getByRole('heading', { name: 'How it’s measured' })).toBeVisible();

    // Start a simulated session.
    await page.getByRole('link', { name: 'Start this exercise' }).click();
    await page.getByRole('button', { name: /Simulated demo/ }).click();
    await expect(page.getByRole('heading', { name: 'Quick check before you start' })).toBeVisible();
    await page.getByLabel('About the same').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Simulated demo · not your camera')).toBeVisible();

    // Three counted repetitions end the session (1 set × 3 reps).
    await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible({ timeout: 60_000 });
    await page.getByLabel('About right').check();
    await page.getByRole('button', { name: 'Save and see summary' }).click();
    await expect(page.getByRole('heading', { name: /Arm raise to the side: completed/ })).toBeVisible();
    await expect(page.getByText('Simulated demo session.', { exact: false })).toBeVisible();
    await expect(page.getByText('3 of 3')).toBeVisible();

    // Persistence across reload.
    await page.reload();
    await page.goto('/#/progress/history');
    await expect(page.getByRole('main').getByText('Simulated demo', { exact: true }).first()).toBeVisible();

    // Simulated data is not shown as the user's progress.
    await page.goto('/#/progress');
    await expect(page.getByRole('heading', { name: 'No sessions yet' })).toBeVisible();

    // Report export produces a real PDF.
    await page.goto('/#/progress/report');
    await expect(page.getByRole('heading', { name: 'PocketRehab progress report' })).toBeVisible();
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
    expect(pdf.suggestedFilename()).toMatch(/^pocketrehab-report-.*\.pdf$/);
    const pdfPath = await pdf.path();
    expect(readFileSync(pdfPath).subarray(0, 5).toString()).toBe('%PDF-');

    // Schedule: export a calendar file and reschedule.
    await page.goto('/#/plan/schedule');
    const [ics] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download calendar file' }).click()]);
    const icsText = readFileSync(await ics.path(), 'utf8');
    expect(icsText).toContain('BEGIN:VCALENDAR');
    expect(icsText).toContain('BEGIN:VEVENT');
    const reschedule = page.getByRole('button', { name: 'Reschedule' }).first();
    if (await reschedule.isVisible()) {
      await reschedule.click();
      await expect(page.getByText('Move this session to:')).toBeVisible();
      await page.getByRole('button', { name: 'Cancel' }).click();
    }

    // Change a preference.
    await page.goto('/#/settings');
    await page.getByLabel('Largest').check();
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-text-scale', '150');

    // Delete the session.
    await page.goto('/#/progress/history');
    await page.getByRole('link', { name: /Arm raise to the side/ }).first().click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete session' }).click();
    await expect(page.getByText('Session deleted from this device.')).toBeVisible();

    // Clear all data returns to onboarding.
    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'Delete my profile and all data' }).click();
    await page.getByRole('button', { name: 'Delete all data' }).click();
    await expect(page.getByRole('heading', { name: 'Rehab done right.' })).toBeVisible();
  });

  test('pre-session warning sign blocks the session with no way to continue', async ({ page }) => {
    await onboardWithPlan(page);
    await page.goto('/#/session');
    await page.getByRole('main').getByRole('link', { name: 'Start', exact: true }).first().click();
    await page.getByRole('button', { name: /Log without camera/ }).click();
    await page.getByLabel('Trouble breathing').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Stop and get help now' })).toBeVisible();
    await expect(page.getByText(/call 911/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue as my clinician instructed/ })).toHaveCount(0);
  });

  test('worsening symptoms require explicit acknowledgement before continuing', async ({ page }) => {
    await onboardWithPlan(page);
    await page.goto('/#/session');
    await page.getByRole('main').getByRole('link', { name: 'Start', exact: true }).first().click();
    await page.getByRole('button', { name: /Log without camera/ }).click();
    await page.getByLabel('Worse').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Check with your care team first' })).toBeVisible();
    const cont = page.getByRole('button', { name: 'Continue as my clinician instructed' });
    await expect(cont).toBeDisabled();
    await page.getByLabel(/My clinician’s instructions say I can continue/).check();
    await cont.click();
    await expect(page.getByRole('heading', { name: 'Log your session' })).toBeVisible();
    await page.getByLabel(/Repetitions completed/).fill('3');
    await page.getByRole('button', { name: 'Save session' }).click();
    await page.getByRole('button', { name: 'Skip check-in' }).click();
    await expect(page.getByText('Logged without the camera.', { exact: false })).toBeVisible();
  });

  test('an interrupted session is kept and flagged after a reload', async ({ page }) => {
    await onboardWithPlan(page, { reps: 20 });
    await page.goto('/#/session');
    await page.getByRole('main').getByRole('link', { name: 'Start', exact: true }).first().click();
    await page.getByRole('button', { name: /Simulated demo/ }).click();
    await page.getByRole('button', { name: 'Skip check-in' }).click();
    await expect(page.getByText('Simulated demo · not your camera')).toBeVisible();
    await page.waitForTimeout(9000);
    await page.reload();
    await expect(page.getByText('Your last session was interrupted', { exact: false })).toBeVisible();
    await page.getByRole('link', { name: 'Review it' }).click();
    await expect(page.getByText('interrupted').first()).toBeVisible();
  });

  test('demo profile: charts from stored data, comparison warnings, weekly summary, removal', async ({ page }) => {
    await loadDemoProfile(page);
    await expect(page.getByText('Reliable measurement').first()).toBeVisible();
    await page.goto('/#/progress');
    await expect(page.getByRole('heading', { name: 'Movement fingerprint' })).toBeVisible();
    await page.getByRole('button', { name: 'Show as table' }).first().click();
    await expect(page.getByRole('columnheader', { name: 'Peak (median)' })).toBeVisible();
    await page.goto('/#/progress/compare');
    await expect(page.getByText(/not established its measurement error/)).toBeVisible();
    await page.goto('/#/progress/week');
    await expect(page.getByRole('heading', { name: 'Limitations' })).toBeVisible();
    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { name: 'What this device supports' })).toBeVisible();
    await expect(page.getByText('Local data storage (IndexedDB)')).toBeVisible();
    await page.getByRole('button', { name: 'Remove demo data' }).click();
    await expect(page.getByRole('heading', { name: 'Rehab done right.' })).toBeVisible();
  });

  test('plan update creates a new version with history', async ({ page }) => {
    await onboardWithPlan(page);
    await page.goto('/#/plan/edit');
    await page.getByRole('spinbutton', { name: 'Reps per set' }).fill('5');
    await page.getByLabel(/Short note for the plan history/).fill('PT increased reps');
    await page.getByRole('button', { name: 'Save as version 2' }).click();
    await expect(page.getByText('Confirm that these values come from your clinician’s instructions.')).toBeVisible();
    await page.getByLabel(/These exercises and values come from my clinician/).check();
    await page.getByRole('button', { name: 'Save as version 2' }).click();
    await expect(page).toHaveURL(/#\/plan$/);
    await expect(page.getByText('version 2', { exact: false }).first()).toBeVisible();
    await page.goto('/#/plan/history');
    await expect(page.getByText('reps 3 → 5', { exact: false })).toBeVisible();
    await expect(page.getByText('“PT increased reps”')).toBeVisible();
  });
});
