import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, createAccount, onboardWithPlan, unlock } from './helpers';

/** The raw rows of every account database, as stored on disk. */
function storedRows(page: Page) {
  return page.evaluate(async () => {
    const out: unknown[] = [];
    for (const info of await indexedDB.databases()) {
      if (!info.name?.startsWith('pocketrehab-account-')) continue;
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(info.name as string);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      for (const store of ['profile', 'planVersions']) {
        const rows = await new Promise<unknown[]>((res) => {
          const r = db.transaction(store).objectStore(store).getAll();
          r.onsuccess = () => res(r.result as unknown[]);
        });
        out.push(...rows.map((row) => ({ keys: Object.keys(row as object).sort(), text: JSON.stringify(row) })));
      }
      db.close();
    }
    return out as Array<{ keys: string[]; text: string }>;
  });
}

async function accountMenu(page: Page, name: string, item: string) {
  await page.getByRole('button', { name: new RegExp(`^${name}.*Encrypted locally`) }).click();
  await page.getByRole('menuitem', { name: new RegExp(item) }).click();
}

test('accounts: encrypted at rest, lock, wrong password, separate accounts, password change, delete', async ({ page }) => {
  await onboardWithPlan(page, { name: 'Jordan' });

  // On disk, records are ciphertext: no name, no restrictions text, only key + iv + ct.
  const rows = await storedRows(page);
  expect(rows.length).toBeGreaterThanOrEqual(2);
  for (const r of rows) {
    expect(r.keys.filter((k) => k !== 'id' && k !== 'version')).toEqual(['ct', 'iv']);
    expect(r.text).not.toContain('Jordan');
    expect(r.text).not.toContain('shoulder height');
  }

  // Lock from the account menu; a wrong password is refused, the right one opens it.
  await accountMenu(page, 'Jordan', 'Lock now');
  await expect(page.getByRole('heading', { name: 'Welcome back, Jordan' })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('not my password');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('That password doesn’t match this account.')).toBeVisible();
  await unlock(page);
  await expect(page.getByRole('heading', { name: /, Jordan$/ })).toBeVisible();

  // A second account on the same device starts empty (its own onboarding).
  await accountMenu(page, 'Jordan', 'Switch account');
  await expect(page.getByRole('heading', { name: 'Who’s exercising?' })).toBeVisible();
  await page.getByRole('button', { name: /Add an account/ }).click();
  await createAccount(page, { name: 'Sam', password: 'another long passphrase' });

  // Back to Jordan: change the password, lock, and only the new one works.
  await page.goto('/#/');
  await page.reload();
  await page.getByRole('button', { name: 'Use another account' }).click();
  await page.getByRole('button', { name: /^Jordan/ }).click();
  await unlock(page);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Change password' }).click();
  await page.getByLabel('Current password').fill(PASSWORD);
  await page.getByLabel('New password', { exact: true }).fill('a brand new passphrase');
  await page.getByLabel('Type the new password again').fill('a brand new passphrase');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText(/Password changed/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Lock now' }).click();
  await unlock(page, 'a brand new passphrase');

  // Deleting the account removes it from this device; Sam's account remains.
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Delete account…' }).click();
  await page.getByLabel('Enter your password to confirm').fill('a brand new passphrase');
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Who’s exercising?' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Sam/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Jordan/ })).toHaveCount(0);
});

test('own measurements: manual entry and CSV import with preview, labelled by source', async ({ page }) => {
  await onboardWithPlan(page);
  await page.goto('/#/progress/measurements');
  await expect(page.getByRole('heading', { name: 'Add a reading' })).toBeVisible();
  await page.getByLabel('What was measured').fill('Shoulder raise to the side');
  await page.getByLabel(/^Value/).fill('92');
  await page.getByLabel(/Measured by/).fill('Clinic goniometer');
  await page.getByRole('button', { name: 'Save reading' }).click();
  await expect(page.getByText('Reading saved.')).toBeVisible();
  await expect(page.getByText('Clinic goniometer').first()).toBeVisible();

  const csv = 'date,measure,value,unit\n2026-10-01,Pain at rest,3,/10\n2026-10-02,Pain at rest,eleven,/10\n';
  await page.getByLabel('Choose a measurements file').setInputFiles({ name: 'clinic-notes.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('1 reading ready')).toBeVisible();
  await expect(page.getByText('1 skipped')).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 reading' }).click();
  await expect(page.getByRole('heading', { name: 'Pain at rest' })).toBeVisible();
  await expect(page.getByText('clinic-notes').first()).toBeVisible();
});

test('auto-lock: locks after inactivity, but never during a session', async ({ page }) => {
  await page.clock.install();
  await onboardWithPlan(page);
  await page.goto('/#/session');
  await page.getByRole('main').getByRole('link', { name: 'Start', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /Simulated demo/ })).toBeVisible();
  await page.clock.fastForward('20:00');
  await page.clock.runFor(16_000);
  await expect(page.getByRole('heading', { name: /^Welcome back, / })).toHaveCount(0);
  await page.goto('/#/');
  await page.clock.fastForward('16:00');
  await page.clock.runFor(16_000);
  await expect(page.getByRole('heading', { name: 'Welcome back, Jordan' })).toBeVisible();
  await expect(page.getByText(/Locked after 15 minutes without activity/)).toBeVisible();
});
