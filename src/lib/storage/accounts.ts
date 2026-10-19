import { openDB, wrap, type DBSchema, type IDBPDatabase } from 'idb';
import { z } from 'zod';
import { KDF_ITERATIONS, SALT_BYTES, aad, deriveKek, fromBase64, generateDataKey, generateDeviceKey, openJson, randomBytes, toBase64, unwrapDataKey, wrapDataKey, type Bytes, type WrappedKey } from '@/lib/crypto/vault';
import { checkInSchema, frictionReportSchema, planSchema, profileSchema, scheduleOverrideSchema, sessionSchema } from '@/lib/validation/schemas';
import { KEY_PATHS, LEGACY_DB_NAME, StorageError, accountDbName, deleteDatabase, describeError, onAccountDbClosedElsewhere, sealWithAccountKey, setUnlocked, settle, writeRecords, type StoreName, type WriteOp } from './db';

/**
 * Local accounts on this device. There is no server: an account is a name, a
 * salt and a wrapped data key in a small registry database, plus its own
 * encrypted database (see db.ts). Signing in derives the key-encryption key from
 * the password, unwraps the data key and keeps it in memory until lock.
 *
 * There is no password recovery by design: no copy of the key exists anywhere
 * else. The failed-attempt delay below is a courtesy against someone at the
 * keyboard; the real protection for a copied database is the PBKDF2 cost.
 */

export interface Account {
  id: string;
  /** Shown on this device's sign-in screen, so it is stored unencrypted (the user is told). */
  name: string;
  /** 'guest' is the password-less demo account with sample data; 'google' opens with a Google sign-in. */
  kind: 'password' | 'guest' | 'google';
  /** Google accounts only: the signed-in address (shown in Settings). */
  email?: string;
  createdAt: number;
  lastUsedAt: number;
  autoLockMinutes: number;
}

interface AccountRecord extends Account {
  kdf: { iterations: number; salt: Bytes } | null;
  wrapped: WrappedKey | null;
  /** Demo account only: a non-extractable key object the browser stores for us. */
  deviceKey: CryptoKey | null;
  failedAttempts: number;
  lastFailedAt: number | null;
}

interface RegistryDB extends DBSchema {
  accounts: { key: string; value: AccountRecord };
}

export const DEMO_ACCOUNT_ID = 'demo';
export const AUTO_LOCK_CHOICES = [5, 15, 30, 60] as const;
export const DEFAULT_AUTO_LOCK_MINUTES = 15;
export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 256;
const NAME_MAX = 40;
const REGISTRY_DB = 'pocketrehab-accounts';
const REMEMBER_KEY = 'pocketrehab.lastAccount';
const KDF_MS_KEY = 'pocketrehab.unlockMs';

export class AccountError extends Error {
  constructor(
    public readonly kind: 'wrong-password' | 'throttled' | 'invalid' | 'missing',
    message: string,
    /** For 'throttled' (and a wrong password that starts a wait): when the next try is allowed. */
    public readonly retryAt: number | null = null,
  ) {
    super(message);
    this.name = 'AccountError';
  }
}

// ---------- Published state (read by React through useSyncExternalStore) ----------

export interface AccountState {
  account: Account | null;
  /** Why the last account was locked, when it wasn't the user's own choice. */
  lockReason: 'idle' | 'closed-elsewhere' | null;
  /** What the sign-in screen should open with after a sign-out. */
  next: 'create' | null;
  /** The demo account is being prepared (sample data generated). */
  pending: 'demo' | null;
}

let state: AccountState = { account: null, lockReason: null, next: null, pending: null };
const listeners = new Set<() => void>();

function publish(patch: Partial<AccountState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getAccountState(): AccountState {
  return state;
}

export function subscribeAccounts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

onAccountDbClosedElsewhere(() => {
  if (state.account) void lockAccount('closed-elsewhere');
});

// ---------- Device conveniences (localStorage; never secrets) ----------

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked: the app still works, it just won't remember
  }
}

function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Same as above: a convenience only.
  }
}

/** The account this device last opened, so the sign-in screen can go straight to its password. */
export function rememberedAccountId(): string | null {
  return readLocal(REMEMBER_KEY);
}

/** How long unlocking took last time on this device, for an honest progress bar. */
export function expectedUnlockMs(): number {
  const ms = Number(readLocal(KDF_MS_KEY));
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 10_000) : 900;
}

async function timedDerive(password: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const t0 = performance.now();
  const kek = await deriveKek(password, salt, iterations);
  writeLocal(KDF_MS_KEY, String(Math.round(performance.now() - t0)));
  return kek;
}

// ---------- Registry ----------

let registryPromise: Promise<IDBPDatabase<RegistryDB>> | null = null;

function registry(): Promise<IDBPDatabase<RegistryDB>> {
  if (!registryPromise) {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new StorageError('unavailable', 'This browser does not provide local storage (IndexedDB), so PocketRehab cannot keep accounts.'));
    }
    const p: Promise<IDBPDatabase<RegistryDB>> = openDB<RegistryDB>(REGISTRY_DB, 1, {
      upgrade(db) {
        db.createObjectStore('accounts', { keyPath: 'id' });
      },
      blocking() {
        void p.then((db) => db.close());
        if (registryPromise === p) registryPromise = null;
      },
      terminated() {
        if (registryPromise === p) registryPromise = null;
      },
    }).catch((err: unknown) => {
      if (registryPromise === p) registryPromise = null;
      throw new StorageError('unavailable', `Local storage could not be opened (${describeError(err)}). Private browsing or blocked site data can cause this.`);
    });
    registryPromise = p;
  }
  return registryPromise;
}

function isRecord(v: unknown): v is AccountRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<AccountRecord>;
  const base = typeof r.id === 'string' && typeof r.name === 'string' && typeof r.createdAt === 'number' && typeof r.lastUsedAt === 'number' && typeof r.autoLockMinutes === 'number' && typeof r.failedAttempts === 'number';
  if (!base) return false;
  if (r.kind === 'password') return !!r.kdf && typeof r.kdf.iterations === 'number' && ArrayBuffer.isView(r.kdf.salt) && !!r.wrapped && ArrayBuffer.isView(r.wrapped.iv);
  return (r.kind === 'guest' || r.kind === 'google') && !!r.deviceKey;
}

function toAccount(r: AccountRecord): Account {
  return { id: r.id, name: r.name, kind: r.kind, email: r.email, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, autoLockMinutes: r.autoLockMinutes };
}

async function getRecord(id: string): Promise<AccountRecord | null> {
  const r = await (await registry()).get('accounts', id);
  return isRecord(r) ? r : null;
}

async function putRecord(r: AccountRecord): Promise<void> {
  await (await registry()).put('accounts', r);
}

/** Accounts on this device, most recently used first; the demo account last. */
export async function listAccounts(): Promise<Account[]> {
  const rows = await (await registry()).getAll('accounts');
  return rows
    .filter(isRecord)
    .map(toAccount)
    .sort((a, b) => (a.kind === b.kind ? b.lastUsedAt - a.lastUsedAt : a.kind === 'guest' ? 1 : -1));
}

// ---------- Validation ----------

function cleanName(name: string, others: Account[], selfId?: string): string {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) throw new AccountError('invalid', 'Enter a name for this account.');
  if (n.length > NAME_MAX) throw new AccountError('invalid', `Keep the name under ${NAME_MAX} characters.`);
  if (others.some((a) => a.id !== selfId && a.name.toLocaleLowerCase() === n.toLocaleLowerCase())) {
    throw new AccountError('invalid', `There’s already an account called “${n}” on this device.`);
  }
  return n;
}

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}

/** 0–4. Length matters most; mixing kinds of characters adds one step. Guidance only, never a gate beyond the minimum. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length < PASSWORD_MIN) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const byLength = password.length >= 16 ? 3 : password.length >= 12 ? 2 : 1;
  return Math.min(4, byLength + (kinds >= 3 ? 1 : 0)) as 0 | 1 | 2 | 3 | 4;
}

// ---------- Failed attempts ----------

/** Three free tries, then 5 s doubling per failure, capped at 15 minutes. */
export function retryDelayMs(failedAttempts: number): number {
  if (failedAttempts < 4) return 0;
  return Math.min(15 * 60_000, 5_000 * 2 ** (failedAttempts - 4));
}

function retryAt(r: AccountRecord): number {
  return r.lastFailedAt === null ? 0 : r.lastFailedAt + retryDelayMs(r.failedAttempts);
}

/** When the given account may try again (null = now). Read by the sign-in screen before the user types. */
export async function accountRetryAt(id: string): Promise<number | null> {
  const r = await getRecord(id);
  const at = r ? retryAt(r) : 0;
  return at > Date.now() ? at : null;
}

/** Checks a password and returns the data key. Wrong passwords are counted (persisted) and throttled. */
async function verify(rec: AccountRecord, password: string, extractable: boolean): Promise<CryptoKey> {
  if (rec.kind !== 'password' || !rec.kdf || !rec.wrapped) throw new AccountError('invalid', 'This account has no password.');
  const waitUntil = retryAt(rec);
  if (waitUntil > Date.now()) throw new AccountError('throttled', 'Too many tries. Wait a moment, then try again.', waitUntil);
  const kek = await timedDerive(password, rec.kdf.salt, rec.kdf.iterations);
  try {
    return await unwrapDataKey(rec.wrapped, kek, aad(rec.id, 'data-key'), extractable);
  } catch {
    // Count against the latest stored state: another tab may have failed too.
    const latest = (await getRecord(rec.id)) ?? rec;
    const failed = { ...latest, failedAttempts: latest.failedAttempts + 1, lastFailedAt: Date.now() };
    await putRecord(failed);
    const next = retryAt(failed);
    throw new AccountError('wrong-password', 'That password doesn’t match this account.', next > Date.now() ? next : null);
  }
}

// ---------- Lifecycle ----------

async function activate(rec: AccountRecord, key: CryptoKey): Promise<void> {
  setUnlocked({ accountId: rec.id, key });
  const used = { ...rec, lastUsedAt: Date.now(), failedAttempts: 0, lastFailedAt: null };
  await putRecord(used);
  writeLocal(REMEMBER_KEY, rec.id);
  publish({ account: toAccount(used), lockReason: null, next: null, pending: null });
}

/** Leaves the current account cleanly: screens unmount, their final saves finish, then the key is dropped. */
async function release(): Promise<void> {
  if (state.account) publish({ account: null });
  await settle();
  setUnlocked(null);
}

/**
 * Creates a password account and opens it. `prepare` runs with the new key active
 * but before any screen shows the account (restoring a backup into it).
 */
export async function createAccount(name: string, password: string, prepare?: () => Promise<void>): Promise<{ migrated: boolean; migrationError: string | null }> {
  const n = cleanName(name, await listAccounts());
  const problem = passwordProblem(password);
  if (problem) throw new AccountError('invalid', problem);
  await release();
  const now = Date.now();
  const id = crypto.randomUUID();
  const salt = randomBytes(SALT_BYTES);
  const kek = await timedDerive(password, salt, KDF_ITERATIONS);
  const wrapped = await wrapDataKey(await generateDataKey(), kek, aad(id, 'data-key'));
  // Work with a non-extractable copy; the extractable original is garbage from here on.
  const key = await unwrapDataKey(wrapped, kek, aad(id, 'data-key'));
  const rec: AccountRecord = { id, name: n, kind: 'password', createdAt: now, lastUsedAt: now, autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES, kdf: { iterations: KDF_ITERATIONS, salt }, wrapped, deviceKey: null, failedAttempts: 0, lastFailedAt: null };
  await putRecord(rec);
  setUnlocked({ accountId: id, key });
  let migrated = false;
  let migrationError: string | null = null;
  try {
    migrated = await adoptLegacyData();
  } catch (err) {
    migrationError = describeError(err); // the old data stays where it was; nothing is lost
  }
  if (prepare) {
    try {
      await prepare();
    } catch (err) {
      // A half-made account would be confusing: remove it and report what went wrong.
      setUnlocked(null);
      await deleteDatabase(accountDbName(id));
      await (await registry()).delete('accounts', id);
      throw err;
    }
  }
  await activate(rec, key);
  return { migrated, migrationError };
}

export async function unlockAccount(id: string, password: string): Promise<void> {
  const rec = await getRecord(id);
  if (!rec) throw new AccountError('missing', 'That account is no longer on this device.');
  const key = await verify(rec, password, false);
  await release();
  await activate(rec, key);
}

/**
 * Opens the account tied to a Google sign-in, creating it on first use. The id
 * comes from the address, so signing in again (or on another device) finds the
 * same account. Its key stays on this device; the Drive backup carries the data
 * between devices. `prepare` runs before any screen shows the account (restore).
 */
export async function openGoogleAccount(email: string, name: string, prepare?: (isNew: boolean) => Promise<void>): Promise<void> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase())));
  const id = `g-${[...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  await release();
  const existing = await getRecord(id);
  const isNew = !existing || existing.kind !== 'google' || !existing.deviceKey;
  const now = Date.now();
  const rec: AccountRecord = isNew
    ? { id, name: cleanName(name, await listAccounts()), email, kind: 'google', createdAt: now, lastUsedAt: now, autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES, kdf: null, wrapped: null, deviceKey: await generateDeviceKey(), failedAttempts: 0, lastFailedAt: null }
    : existing;
  if (isNew) await putRecord(rec);
  const key = rec.deviceKey as CryptoKey;
  setUnlocked({ accountId: id, key });
  try {
    if (isNew) await adoptLegacyData().catch(() => false); // old data stays where it was if this fails
    await prepare?.(isNew);
  } catch (err) {
    setUnlocked(null);
    throw err;
  }
  await activate(rec, key);
}

/**
 * Opens the password-less demo account, creating it if needed. `prepare` runs
 * while its key is active but before any screen shows it (sample data generation).
 */
export async function openDemoAccount(prepare: () => Promise<void>): Promise<void> {
  publish({ pending: 'demo', next: null, lockReason: null });
  try {
    await release();
    let rec = await getRecord(DEMO_ACCOUNT_ID);
    if (!rec || rec.kind !== 'guest' || !rec.deviceKey) {
      const now = Date.now();
      rec = { id: DEMO_ACCOUNT_ID, name: 'Demo', kind: 'guest', createdAt: now, lastUsedAt: now, autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES, kdf: null, wrapped: null, deviceKey: await generateDeviceKey(), failedAttempts: 0, lastFailedAt: null };
      await putRecord(rec);
    }
    const key = rec.deviceKey as CryptoKey;
    setUnlocked({ accountId: rec.id, key });
    await prepare();
    await activate(rec, key);
  } catch (err) {
    setUnlocked(null);
    publish({ pending: null });
    throw err;
  }
}

/**
 * Locks: screens close, pending saves finish, the key leaves memory.
 * `forget` also stops this device from offering the account first (sign out / switch).
 */
export async function lockAccount(reason: AccountState['lockReason'] = null, opts: { forget?: boolean; next?: 'create' } = {}): Promise<void> {
  // The demo has no password, so "locking" it would just reopen it: leave it instead.
  if (opts.forget || state.account?.kind === 'guest') writeLocal(REMEMBER_KEY, null);
  publish({ lockReason: reason, next: opts.next ?? null });
  await release();
}

export function signOut(next?: 'create'): Promise<void> {
  return lockAccount(null, { forget: true, next });
}

function requireActive(): Account {
  if (!state.account) throw new StorageError('locked', 'PocketRehab is locked. Sign in to continue.');
  return state.account;
}

export async function renameAccount(name: string): Promise<void> {
  const acct = requireActive();
  const rec = await getRecord(acct.id);
  if (!rec) throw new AccountError('missing', 'That account is no longer on this device.');
  const updated = { ...rec, name: cleanName(name, await listAccounts(), acct.id) };
  await putRecord(updated);
  publish({ account: toAccount(updated) });
}

export async function setAutoLockMinutes(minutes: number): Promise<void> {
  const acct = requireActive();
  if (!(AUTO_LOCK_CHOICES as readonly number[]).includes(minutes)) throw new AccountError('invalid', 'Choose one of the listed times.');
  const rec = await getRecord(acct.id);
  if (!rec) throw new AccountError('missing', 'That account is no longer on this device.');
  const updated = { ...rec, autoLockMinutes: minutes };
  await putRecord(updated);
  publish({ account: toAccount(updated) });
}

/** Re-wraps the same data key under the new password; records are untouched. */
export async function changePassword(current: string, next: string): Promise<void> {
  const acct = requireActive();
  const problem = passwordProblem(next);
  if (problem) throw new AccountError('invalid', problem);
  const rec = await getRecord(acct.id);
  if (!rec) throw new AccountError('missing', 'That account is no longer on this device.');
  const dataKey = await verify(rec, current, true);
  const salt = randomBytes(SALT_BYTES);
  const wrapped = await wrapDataKey(dataKey, await timedDerive(next, salt, KDF_ITERATIONS), aad(rec.id, 'data-key'));
  const latest = (await getRecord(rec.id)) ?? rec;
  await putRecord({ ...latest, kdf: { iterations: KDF_ITERATIONS, salt }, wrapped, failedAttempts: 0, lastFailedAt: null });
}

/** Deletes the signed-in account and all of its data from this device. Password accounts must confirm the password. */
export async function deleteAccount(password: string | null): Promise<void> {
  const acct = requireActive();
  if (acct.kind === 'password') {
    const rec = await getRecord(acct.id);
    if (!rec) throw new AccountError('missing', 'That account is no longer on this device.');
    await verify(rec, password ?? '', false);
  }
  // Off the registry first, so the account screen that appears on lock no longer lists it.
  await (await registry()).delete('accounts', acct.id);
  await lockAccount(null, { forget: true });
  await deleteDatabase(accountDbName(acct.id));
}

// ---------- Data from before accounts ----------

export type LegacyStatus = 'none' | 'demo' | 'data';

/** Opens the pre-accounts database only if it exists (opening by name would otherwise create it). */
function openLegacy(): Promise<IDBPDatabase<unknown> | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(LEGACY_DB_NAME);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = (e) => {
      if (e.oldVersion === 0) req.transaction?.abort(); // it didn't exist: undo the creation
    };
    req.onsuccess = () => resolve(wrap(req.result) as IDBPDatabase<unknown>);
    req.onerror = (e) => {
      e.preventDefault();
      resolve(null);
    };
    req.onblocked = () => resolve(null);
  });
}

function legacyStores(db: IDBPDatabase<unknown>): StoreName[] {
  return (Object.keys(KEY_PATHS) as StoreName[]).filter((s) => db.objectStoreNames.contains(s));
}

async function statusOf(db: IDBPDatabase<unknown>): Promise<LegacyStatus> {
  const stores = legacyStores(db);
  if (stores.includes('profile')) {
    const profile = (await db.get('profile', 'me')) as { isDemo?: unknown } | undefined;
    if (profile && typeof profile === 'object') return profile.isDemo === true ? 'demo' : 'data';
  }
  for (const s of stores) if ((await db.count(s)) > 0) return 'data';
  return 'none';
}

/** Whether this browser holds PocketRehab data saved before accounts existed ('demo' = only the sample profile). */
export async function legacyDataStatus(): Promise<LegacyStatus> {
  const db = await openLegacy();
  if (!db) return 'none';
  try {
    return await statusOf(db);
  } finally {
    db.close();
  }
}

const LEGACY_SCHEMAS: Partial<Record<StoreName, z.ZodType<unknown>>> = {
  profile: profileSchema,
  planVersions: planSchema,
  sessions: sessionSchema,
  checkIns: checkInSchema,
  scheduleOverrides: scheduleOverrideSchema,
  friction: frictionReportSchema,
};

/**
 * Moves pre-accounts data into the account that is now unlocked (encrypting it)
 * and deletes the unencrypted original. Sample demo data is not moved, only deleted.
 * Records that fail validation were already invisible to the app and are dropped.
 */
async function adoptLegacyData(): Promise<boolean> {
  const db = await openLegacy();
  if (!db) return false;
  let moved = false;
  try {
    if ((await statusOf(db)) === 'data') {
      const ops: WriteOp[] = [];
      for (const store of legacyStores(db)) {
        for (const row of (await db.getAll(store)) as unknown[]) {
          const schema = LEGACY_SCHEMAS[store];
          if (schema) {
            const parsed = schema.safeParse(row);
            if (parsed.success) ops.push({ store, value: parsed.data as Record<string, unknown> });
          } else if (row && typeof row === 'object' && typeof (row as { key?: unknown }).key === 'string') {
            ops.push({ store, value: row as Record<string, unknown> }); // meta: small app state, e.g. an unfinished onboarding
          }
        }
      }
      await writeRecords(ops);
      moved = ops.length > 0;
    }
  } finally {
    db.close();
  }
  await deleteDatabase(LEGACY_DB_NAME);
  return moved;
}

// ---------- Encrypted backups (Google Drive, or any file) ----------

/**
 * A backup that only this account's password can open, anywhere. It carries the
 * account's wrapped data key (the same 60 bytes kept in the registry) and the
 * data sealed with that key, so making one needs no password, and opening one
 * on a new device needs only the password the account had when it was made.
 */
export interface EncryptedBackup {
  app: 'PocketRehab';
  type: 'encrypted-backup';
  v: 1;
  /** Random account id: binds the pieces together; means nothing to anyone reading the file. */
  account: string;
  createdAt: number;
  kdf: { name: 'PBKDF2-SHA-256'; iterations: number; salt: string };
  wrappedKey: { iv: string; key: string };
  iv: string;
  ct: string;
}

const b64 = z.string().max(40_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/);
const encryptedBackupSchema = z.object({
  app: z.literal('PocketRehab'),
  type: z.literal('encrypted-backup'),
  v: z.literal(1),
  account: z.string().min(1).max(80),
  createdAt: z.number().int().nonnegative(),
  // The upper bound stops a crafted file from freezing the page in key derivation.
  kdf: z.object({ name: z.literal('PBKDF2-SHA-256'), iterations: z.number().int().min(100_000).max(5_000_000), salt: b64 }),
  wrappedKey: z.object({ iv: b64, key: b64 }),
  iv: b64,
  ct: b64,
});

export function isEncryptedBackup(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'encrypted-backup';
}

/** Seals `bundle` (an export) for the signed-in password account. */
export async function createEncryptedBackup(bundle: unknown): Promise<EncryptedBackup> {
  const acct = requireActive();
  const rec = await getRecord(acct.id);
  if (!rec || rec.kind !== 'password' || !rec.kdf || !rec.wrapped) throw new AccountError('invalid', 'The demo account has no password, so it can’t make an encrypted backup.');
  const createdAt = Date.now();
  const sealed = await sealWithAccountKey({ name: rec.name, bundle }, aad(rec.id, 'backup', createdAt));
  return {
    app: 'PocketRehab',
    type: 'encrypted-backup',
    v: 1,
    account: rec.id,
    createdAt,
    kdf: { name: 'PBKDF2-SHA-256', iterations: rec.kdf.iterations, salt: toBase64(rec.kdf.salt) },
    wrappedKey: { iv: toBase64(rec.wrapped.iv), key: toBase64(rec.wrapped.key) },
    iv: toBase64(sealed.iv),
    ct: toBase64(sealed.ct),
  };
}

/** Opens an encrypted backup with its password. Returns the account name and the export inside (validated later by the importer). */
export async function openEncryptedBackup(raw: unknown, password: string): Promise<{ name: string; bundle: unknown }> {
  const parsed = encryptedBackupSchema.safeParse(raw);
  if (!parsed.success) throw new AccountError('invalid', 'That file isn’t a PocketRehab encrypted backup, or it’s damaged.');
  const f = parsed.data;
  let salt: Bytes, wrapped: WrappedKey, iv: Bytes, ct: Bytes;
  try {
    salt = fromBase64(f.kdf.salt);
    wrapped = { iv: fromBase64(f.wrappedKey.iv), key: fromBase64(f.wrappedKey.key).buffer };
    iv = fromBase64(f.iv);
    ct = fromBase64(f.ct);
  } catch {
    throw new AccountError('invalid', 'That backup is damaged.');
  }
  const kek = await timedDerive(password, salt, f.kdf.iterations);
  let key: CryptoKey;
  try {
    key = await unwrapDataKey(wrapped, kek, aad(f.account, 'data-key'));
  } catch {
    throw new AccountError('wrong-password', 'That password doesn’t open this backup. Use the password the account had when the backup was made.');
  }
  let payload: unknown;
  try {
    payload = await openJson(key, { iv, ct: ct.buffer }, aad(f.account, 'backup', f.createdAt));
  } catch {
    throw new AccountError('invalid', 'That backup is damaged: its contents don’t match its seal.');
  }
  const p = payload as { name?: unknown; bundle?: unknown } | null;
  if (!p || typeof p !== 'object' || typeof p.name !== 'string') throw new AccountError('invalid', 'That backup is damaged.');
  return { name: p.name, bundle: p.bundle };
}

/** A name for a restored account that doesn't clash with one already on this device. */
export async function availableName(wanted: string): Promise<string> {
  const taken = new Set((await listAccounts()).map((a) => a.name.toLocaleLowerCase()));
  const base = wanted.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX - 4) || 'Restored';
  if (!taken.has(base.toLocaleLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLocaleLowerCase())) return `${base} ${i}`;
}
