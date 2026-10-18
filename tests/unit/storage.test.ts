import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import { accountDbName, deleteDatabase, getDb, LEGACY_DB_NAME } from '@/lib/storage/db';
import {
  AccountError,
  accountRetryAt,
  availableName,
  changePassword,
  createAccount,
  createEncryptedBackup,
  deleteAccount,
  getAccountState,
  listAccounts,
  lockAccount,
  openDemoAccount,
  openEncryptedBackup,
  retryDelayMs,
  signOut,
  unlockAccount,
} from '@/lib/storage/accounts';
import {
  addPlanVersion,
  clearAllData,
  deleteMeasurement,
  deleteSession,
  exportAllData,
  getCurrentPlan,
  getProfile,
  importAllData,
  listCheckIns,
  listMeasurements,
  listPlanVersions,
  listSessions,
  recoverInterruptedSessions,
  removeDemoData,
  saveCheckIn,
  saveMeasurements,
  saveProfile,
  saveSession,
  storageHealth,
} from '@/lib/storage/repositories';
import { parseCsv, parseMeasurementFile } from '@/features/measurements/importMeasurements';
import type { Measurement } from '@/lib/validation/schemas';
import { makeCheckIn, makePlan, makeProfile, makeSession } from '../fixtures/factories';

// Real accounts use 1,000,000 PBKDF2 rounds; tests use the backup format's floor to stay fast.
vi.mock('@/lib/crypto/vault', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/crypto/vault')>()), KDF_ITERATIONS: 100_000 }));

const PW = 'correct horse battery';

async function wipe() {
  await signOut();
  for (const d of await indexedDB.databases()) if (d.name) await deleteDatabase(d.name);
}

async function freshAccount(name = 'Test') {
  await createAccount(name, PW);
  return getAccountState().account!;
}

function measurement(overrides: Partial<Measurement> = {}): Measurement {
  return { id: `m_${Math.random()}`, timestamp: Date.UTC(2026, 9, 1), kind: 'angle', label: 'Knee flexion', value: 95, unit: '°', side: 'right', exerciseId: null, source: 'manual', sourceLabel: 'Clinic goniometer', note: '', createdAt: Date.UTC(2026, 9, 1), ...overrides };
}

describe('accounts', () => {
  beforeEach(wipe);

  it('uses at least 600,000 PBKDF2 rounds in the shipped build', async () => {
    const real = await vi.importActual<typeof import('@/lib/crypto/vault')>('@/lib/crypto/vault');
    expect(real.KDF_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it('stores records encrypted: no plaintext on disk, key-bound ciphertext', async () => {
    const acct = await freshAccount();
    await saveProfile(makeProfile({ displayName: 'Secret Name' }));
    const raw = await openDB(accountDbName(acct.id));
    const row = (await raw.get('profile', 'me')) as Record<string, unknown>;
    raw.close();
    expect(Object.keys(row).sort()).toEqual(['ct', 'id', 'iv']);
    expect(JSON.stringify(row)).not.toContain('Secret');
    // A ciphertext moved under another key fails its AAD check and is skipped, not trusted.
    const db = await getDb();
    await db.put('sessions', { ...row, id: 'moved' } as never);
    const before = storageHealth.invalidRecords;
    expect(await listSessions()).toHaveLength(0);
    expect(storageHealth.invalidRecords).toBe(before + 1);
  });

  it('locks: the key leaves memory and storage refuses reads until the password is entered', async () => {
    const acct = await freshAccount();
    await saveProfile(makeProfile());
    await lockAccount();
    expect(getAccountState().account).toBeNull();
    await expect(getProfile()).rejects.toMatchObject({ kind: 'locked' });
    await unlockAccount(acct.id, PW);
    expect((await getProfile())?.displayName).toBe('Test User');
  });

  it('counts wrong passwords persistently and then makes the next try wait', async () => {
    const acct = await freshAccount();
    await signOut();
    for (let i = 0; i < 4; i++) await expect(unlockAccount(acct.id, 'wrong password')).rejects.toMatchObject({ kind: 'wrong-password' });
    expect(await accountRetryAt(acct.id)).toBeGreaterThan(Date.now());
    await expect(unlockAccount(acct.id, PW)).rejects.toMatchObject({ kind: 'throttled' });
    expect(retryDelayMs(3)).toBe(0);
    expect(retryDelayMs(4)).toBe(5_000);
    expect(retryDelayMs(40)).toBe(15 * 60_000);
  });

  it('changes the password by re-wrapping the key; data stays readable', async () => {
    const acct = await freshAccount();
    await saveSession(makeSession());
    await changePassword(PW, 'a brand new passphrase');
    await signOut();
    await expect(unlockAccount(acct.id, PW)).rejects.toBeInstanceOf(AccountError);
    await unlockAccount(acct.id, 'a brand new passphrase');
    expect(await listSessions()).toHaveLength(1);
  });

  it('keeps accounts separate and deletes one with all of its data', async () => {
    await freshAccount('Ana');
    await saveProfile(makeProfile({ displayName: 'Ana' }));
    await createAccount('Ben', PW);
    expect(await getProfile()).toBeNull();
    await expect(createAccount('ana', PW)).rejects.toMatchObject({ kind: 'invalid' });
    await deleteAccount(PW);
    expect((await listAccounts()).map((a) => a.name)).toEqual(['Ana']);
    const keep = accountDbName((await listAccounts())[0]!.id);
    expect((await indexedDB.databases()).filter((d) => d.name?.startsWith('pocketrehab-account-')).map((d) => d.name)).toEqual([keep]);
  });

  it('moves unencrypted pre-accounts data into the first account and deletes the original', async () => {
    const legacy = await openDB(LEGACY_DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore('profile', { keyPath: 'id' });
        db.createObjectStore('sessions', { keyPath: 'id' });
      },
    });
    await legacy.put('profile', makeProfile({ displayName: 'Old Me' }));
    await legacy.put('sessions', makeSession());
    await legacy.put('sessions', { id: 'junk' });
    legacy.close();
    const result = await createAccount('Me', PW);
    expect(result).toEqual({ migrated: true, migrationError: null });
    expect((await getProfile())?.displayName).toBe('Old Me');
    expect(await listSessions()).toHaveLength(1);
    expect((await indexedDB.databases()).some((d) => d.name === LEGACY_DB_NAME)).toBe(false);
  });

  it('encrypted backups open only with the password, on a fresh account', async () => {
    await freshAccount('Ana');
    await saveProfile(makeProfile({ displayName: 'Ana' }));
    await saveMeasurements([measurement()]);
    const backup = await createEncryptedBackup(await exportAllData());
    expect(JSON.stringify(backup)).not.toContain('Ana');
    await expect(openEncryptedBackup(backup, 'nope nope nope')).rejects.toMatchObject({ kind: 'wrong-password' });
    await expect(openEncryptedBackup({ ...backup, ct: backup.ct.replace(/^.{4}/, 'AAAA') }, PW)).rejects.toMatchObject({ kind: 'invalid' });
    await expect(openEncryptedBackup({ ...backup, kdf: { ...backup.kdf, iterations: 1e9 } }, PW)).rejects.toMatchObject({ kind: 'invalid' });
    const opened = await openEncryptedBackup(JSON.parse(JSON.stringify(backup)), PW);
    expect(opened.name).toBe('Ana');
    await createAccount(await availableName(opened.name), PW, () => importAllData(opened.bundle));
    expect(getAccountState().account?.name).toBe('Ana 2');
    expect((await getProfile())?.displayName).toBe('Ana');
    expect(await listMeasurements()).toHaveLength(1);
  });

  it('opens the password-less demo account; removing demo data removes the whole demo account', async () => {
    await openDemoAccount(() => saveProfile(makeProfile({ isDemo: true })).then(() => undefined));
    expect(getAccountState().account?.kind).toBe('guest');
    expect((await getProfile())?.isDemo).toBe(true);
    await removeDemoData();
    expect(getAccountState().account).toBeNull();
    expect(await listAccounts()).toHaveLength(0);
  });

  it('removes a half-made account when restoring into it fails', async () => {
    await expect(createAccount('Broken', PW, () => importAllData({ app: 'Other' }))).rejects.toThrow();
    expect(await listAccounts()).toHaveLength(0);
    expect(getAccountState().account).toBeNull();
  });
});

describe('repositories (inside an account)', () => {
  beforeEach(async () => {
    await wipe();
    await freshAccount();
  });

  it('saves and reads back a profile, plan and session', async () => {
    await saveProfile(makeProfile());
    const { version: _v, createdAt: _c, ...plan } = makePlan();
    await addPlanVersion(plan);
    await saveSession(makeSession());
    expect((await getProfile())?.displayName).toBe('Test User');
    expect((await getCurrentPlan())?.version).toBe(1);
    expect(await listSessions()).toHaveLength(1);
  });

  it('keeps every plan version (history is append-only)', async () => {
    const { version: _v, createdAt: _c, ...plan } = makePlan();
    await addPlanVersion(plan);
    await addPlanVersion({ ...plan, changeSummary: 'Reps changed', changeSource: 'clinician-update' });
    expect((await listPlanVersions()).map((p) => p.version)).toEqual([1, 2]);
  });

  it('rejects invalid data on write', async () => {
    await expect(saveProfile({ ...makeProfile(), displayName: '' })).rejects.toThrow(/Could not save your profile/);
    await expect(saveMeasurements([measurement({ kind: 'pain', value: 11, unit: '/10' })])).rejects.toThrow(/Could not save/);
  });

  it('skips corrupted records on read instead of crashing', async () => {
    await saveSession(makeSession());
    await (await getDb()).put('sessions', { id: 'broken', iv: new Uint8Array(12), ct: new ArrayBuffer(32) });
    const before = storageHealth.invalidRecords;
    expect(await listSessions()).toHaveLength(1);
    expect(storageHealth.invalidRecords).toBe(before + 1);
  });

  it('deletes a session together with its check-ins', async () => {
    const s = makeSession();
    await saveSession(s);
    await saveCheckIn(makeCheckIn({ sessionId: s.id }));
    await saveCheckIn(makeCheckIn({ sessionId: null }));
    await deleteSession(s.id);
    expect(await listSessions()).toHaveLength(0);
    expect(await listCheckIns()).toHaveLength(1);
  });

  it('marks sessions left in progress as interrupted without changing their reps', async () => {
    const s = makeSession({ status: 'in-progress', endedAt: null });
    await saveSession(s);
    expect(await recoverInterruptedSessions()).toHaveLength(1);
    const [saved] = await listSessions();
    expect(saved?.status).toBe('interrupted');
    expect(saved?.reps).toHaveLength(s.reps.length);
  });

  it('exports, clears and re-imports all data, including measurements', async () => {
    await saveProfile(makeProfile());
    await saveSession(makeSession());
    await saveMeasurements([measurement()]);
    const bundle = await exportAllData();
    await clearAllData();
    expect(await getProfile()).toBeNull();
    await importAllData(JSON.parse(JSON.stringify(bundle)));
    expect((await getProfile())?.displayName).toBe('Test User');
    expect(await listSessions()).toHaveLength(1);
    expect(await listMeasurements()).toHaveLength(1);
  });

  it('imports backups made before measurements existed', async () => {
    await saveProfile(makeProfile());
    const { measurements: _m, ...old } = await exportAllData();
    await importAllData(JSON.parse(JSON.stringify(old)));
    expect(await getProfile()).not.toBeNull();
  });

  it('refuses hostile or invalid backups and leaves data untouched', async () => {
    await saveProfile(makeProfile());
    const good = JSON.parse(JSON.stringify(await exportAllData())) as Record<string, unknown>;
    await expect(importAllData({ app: 'Other' })).rejects.toThrow();
    await expect(importAllData(JSON.parse(JSON.stringify(good).replace('"profile":{', '"profile":{"__proto__":{"isAdmin":true},')))).rejects.toThrow(/unexpected field/);
    await expect(importAllData({ ...good, schemaVersion: 999 })).rejects.toThrow(/newer version/);
    expect((await getProfile())?.displayName).toBe('Test User');
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  it('removing demo data wipes a demo profile completely', async () => {
    await saveProfile(makeProfile({ isDemo: true }));
    await saveSession(makeSession({ isDemoData: true, mode: 'simulated' }));
    await removeDemoData();
    expect(await getProfile()).toBeNull();
    expect(await listSessions()).toHaveLength(0);
  });

  it('saves, lists and deletes your own measurements', async () => {
    const [a] = await saveMeasurements([measurement({ value: 90 }), measurement({ value: 100, timestamp: Date.UTC(2026, 9, 8) })]);
    expect((await listMeasurements()).map((m) => m.value)).toEqual([100, 90]);
    await deleteMeasurement(a!.id);
    expect(await listMeasurements()).toHaveLength(1);
  });
});

describe('measurement import', () => {
  const now = Date.UTC(2026, 9, 18);

  it('reads quoted CSV with any common delimiter', () => {
    expect(parseCsv('a;b\r\n"x;1";"say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x;1', 'say "hi"'],
    ]);
  });

  it('previews valid rows and explains every skipped one', () => {
    const csv = ['Date,Measure,Value,Unit,Side,Source', '2026-10-01,Knee flexion,95°,,right,Clinic goniometer', '10/08/2026,Pain at rest,4/10,,,', '2026-02-31,Knee flexion,90,deg,,', '2026-10-02,Knee flexion,lots,deg,,', '2026-10-02,Pain,12,/10,,', '2030-01-01,Knee flexion,90,deg,,'].join('\n');
    const p = parseMeasurementFile(csv, 'clinic.csv', [], now);
    expect(p.valid.map((m) => [m.kind, m.value, m.unit, m.side, m.sourceLabel])).toEqual([
      ['angle', 95, '°', 'right', 'Clinic goniometer'],
      ['pain', 4, '/10', null, 'clinic'],
    ]);
    expect(p.problems.map((x) => x.line)).toEqual([4, 5, 6, 7]);
    expect(p.problems[2]?.error).toMatch(/outside 0 to 10/);
  });

  it('reads JSON lists, flags duplicates and never trusts unknown keys', () => {
    const existing = [measurement({ timestamp: new Date(2026, 9, 1, 12).getTime(), value: 95, label: 'Knee flexion' })];
    const json = '{"measurements":[{"date":"2026-10-01","measure":"Knee flexion","value":95,"unit":"deg"},{"date":"2026-10-03","measure":"Hold","value":20,"unit":"s","__proto__":{"polluted":true}},"nope"]}';
    const p = parseMeasurementFile(json, 'export.json', existing, now);
    expect(p.valid).toHaveLength(1);
    expect(p.valid[0]).toMatchObject({ kind: 'hold', value: 20, source: 'import' });
    expect(p.problems.map((x) => x.error)).toEqual(['Already in your measurements.', 'Not a reading.']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects a CSV without a header naming measure and value', () => {
    expect(parseMeasurementFile('1,2,3', 'x.csv', [], now).problems[0]?.line).toBe(1);
  });
});
