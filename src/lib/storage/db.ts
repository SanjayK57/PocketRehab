import { deleteDB, openDB, type DBSchema, type IDBPDatabase, type StoreNames } from 'idb';
import { aad, openJson, sealJson, type Bytes, type Sealed } from '@/lib/crypto/vault';

/**
 * Per-account encrypted IndexedDB. All data stays on this device.
 *
 * Each account has its own database (`pocketrehab-account-<id>`), so deleting an
 * account deletes exactly its data. On disk a record is `{ <key field>, iv, ct }`:
 * the key stays readable so single records can be fetched and deleted; everything
 * else is AES-GCM ciphertext bound (via AAD) to account, store and key.
 * Plaintext values are validated with zod by repositories.ts on every read and
 * write, so a corrupted or undecryptable record is skipped and counted, never fatal.
 *
 * Migrations: bump DB_VERSION and add an entry to MIGRATIONS.
 */

/** The single unencrypted database used before accounts existed. Read once, moved into the first account, deleted. */
export const LEGACY_DB_NAME = 'pocketrehab';
export const accountDbName = (accountId: string): string => `pocketrehab-account-${accountId}`;
const DB_VERSION = 2;

type Row = Record<string, unknown>;

export interface RecoverDB extends DBSchema {
  meta: { key: string; value: Row };
  profile: { key: string; value: Row };
  planVersions: { key: number; value: Row };
  sessions: { key: string; value: Row };
  checkIns: { key: string; value: Row };
  scheduleOverrides: { key: string; value: Row };
  friction: { key: string; value: Row };
  measurements: { key: string; value: Row };
}

export type StoreName = StoreNames<RecoverDB>;

/** The field each store is keyed by (same as the legacy schema, so migration is a copy). */
export const KEY_PATHS: Record<StoreName, string> = {
  meta: 'key',
  profile: 'id',
  planVersions: 'version',
  sessions: 'id',
  checkIns: 'id',
  scheduleOverrides: 'date',
  friction: 'id',
  measurements: 'id',
};
export const ALL_STORES = Object.keys(KEY_PATHS) as StoreName[];

// So far every version only adds stores, so one idempotent step covers any upgrade path.
const ensureStores = (db: IDBPDatabase<RecoverDB>): void => {
  for (const store of ALL_STORES) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: KEY_PATHS[store] });
};
const MIGRATIONS: Record<number, (db: IDBPDatabase<RecoverDB>) => void> = {
  1: ensureStores,
  2: ensureStores, // + measurements
};

export class StorageError extends Error {
  constructor(
    public readonly kind: 'unavailable' | 'quota' | 'blocked' | 'write-failed' | 'invalid-data' | 'locked',
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/** Maps low-level IndexedDB failures to understandable errors. */
export function toStorageError(err: unknown): StorageError {
  if (err instanceof StorageError) return err;
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'QuotaExceededError') {
    return new StorageError('quota', 'Your device is out of storage space for PocketRehab. Export your data, then delete old sessions to free space.');
  }
  return new StorageError('write-failed', `Saving failed: ${describeError(err)}`);
}

// ---------- The unlocked account (memory only) ----------

interface Unlocked {
  accountId: string;
  /** Non-extractable AES-GCM data key. Dropped on lock; never written anywhere in plain form. */
  key: CryptoKey;
}

let unlocked: Unlocked | null = null;
let dbPromise: Promise<IDBPDatabase<RecoverDB>> | null = null;
const inFlight = new Set<Promise<unknown>>();
let closedElsewhere: (() => void) | null = null;

/** Switches the key every repository call uses. `null` locks: later reads and writes fail with kind 'locked'. */
export function setUnlocked(next: Unlocked | null): void {
  if (unlocked && (next?.accountId !== unlocked.accountId || next.key !== unlocked.key)) void closeDb();
  unlocked = next;
}

export function unlockedAccountId(): string | null {
  return unlocked?.accountId ?? null;
}

/** Called when another tab deletes or upgrades the open account's database, so this tab can lock. */
export function onAccountDbClosedElsewhere(listener: () => void): void {
  closedElsewhere = listener;
}

function lockedError(): StorageError {
  return new StorageError('locked', 'PocketRehab is locked. Sign in to continue.');
}

function requireUnlocked(): Unlocked {
  if (!unlocked) throw lockedError();
  return unlocked;
}

export function getDb(): Promise<IDBPDatabase<RecoverDB>> {
  if (!unlocked) return Promise.reject(lockedError());
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new StorageError('unavailable', 'This browser does not provide local storage (IndexedDB), so PocketRehab cannot save data.'));
    }
    const p: Promise<IDBPDatabase<RecoverDB>> = openDB<RecoverDB>(accountDbName(unlocked.accountId), DB_VERSION, {
      upgrade(db, oldVersion, newVersion) {
        for (let v = oldVersion + 1; v <= (newVersion ?? DB_VERSION); v++) MIGRATIONS[v]?.(db);
      },
      blocked() {
        console.warn('PocketRehab storage upgrade is blocked by another open tab.');
      },
      blocking() {
        // Another tab is deleting this account: get out of its way and lock here.
        void p.then((db) => db.close());
        if (dbPromise === p) dbPromise = null;
        closedElsewhere?.();
      },
      terminated() {
        if (dbPromise === p) dbPromise = null;
      },
    }).catch((err: unknown) => {
      if (dbPromise === p) dbPromise = null;
      throw new StorageError('unavailable', `Local storage could not be opened (${describeError(err)}). Private browsing or blocked site data can cause this.`);
    });
    dbPromise = p;
  }
  return dbPromise;
}

/** Closes the connection (used before deleting a database and by tests). The next call reopens it. */
export async function closeDb(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  if (p) (await p.catch(() => null))?.close();
}

/**
 * Deletes a database. If an old tab still holds it open the browser finishes the
 * deletion when that tab closes; we stop waiting after a moment instead of hanging.
 */
export async function deleteDatabase(name: string): Promise<void> {
  await Promise.race([deleteDB(name), new Promise((r) => setTimeout(r, 2000))]);
}

/** Waits for reads and writes already running (e.g. the save a closing session makes) before a lock drops the key. */
export async function settle(timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Let React unmount first: a closing screen may start its final save in that commit.
  await new Promise((r) => setTimeout(r, 0));
  while (inFlight.size && Date.now() < deadline) {
    await Promise.race([Promise.allSettled([...inFlight]), new Promise((r) => setTimeout(r, deadline - Date.now()))]);
  }
}

function track<T>(op: Promise<T>): Promise<T> {
  inFlight.add(op);
  op.then(
    () => inFlight.delete(op),
    () => inFlight.delete(op),
  );
  return op;
}

// ---------- Encrypted record access ----------

/** Returned for a row that cannot be decrypted; every zod schema rejects it, so it is skipped and counted. */
export const UNREADABLE: unique symbol = Symbol('unreadable record');

function isKey(v: unknown): v is string | number {
  return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
}

// Tag checks instead of instanceof: values read back from IndexedDB can come from another realm.
const isBytes = (v: unknown): v is Bytes => ArrayBuffer.isView(v) && Object.prototype.toString.call(v) === '[object Uint8Array]';
const isBuffer = (v: unknown): v is ArrayBuffer => Object.prototype.toString.call(v) === '[object ArrayBuffer]';

function recordAad(u: Unlocked, store: StoreName, key: string | number): Bytes {
  return aad(u.accountId, store, typeof key, key);
}

async function seal(u: Unlocked, store: StoreName, value: Row): Promise<Row> {
  const field = KEY_PATHS[store];
  const key = value[field];
  if (!isKey(key)) throw new StorageError('invalid-data', `Could not save: the record has no ${field}.`);
  const { iv, ct } = await sealJson(u.key, value, recordAad(u, store, key));
  return { [field]: key, iv, ct };
}

async function unseal(u: Unlocked, store: StoreName, row: unknown): Promise<unknown> {
  if (!row || typeof row !== 'object') return UNREADABLE;
  const r = row as Row;
  const key = r[KEY_PATHS[store]];
  if (!isKey(key) || !isBytes(r.iv) || !isBuffer(r.ct)) return UNREADABLE;
  try {
    return await openJson(u.key, { iv: r.iv, ct: r.ct }, recordAad(u, store, key));
  } catch {
    return UNREADABLE;
  }
}

/** Every record in a store, decrypted (undecryptable rows come back as UNREADABLE). */
export function readAll(store: StoreName): Promise<unknown[]> {
  return track(
    (async () => {
      const u = requireUnlocked();
      const rows = await (await getDb()).getAll(store);
      return Promise.all(rows.map((row) => unseal(u, store, row)));
    })(),
  );
}

/** One record by key, decrypted; undefined when there is none. */
export function readOne(store: StoreName, key: string | number): Promise<unknown> {
  return track(
    (async () => {
      const u = requireUnlocked();
      const row = await (await getDb()).get(store, key as never);
      return row === undefined ? undefined : unseal(u, store, row);
    })(),
  );
}

export type WriteOp = { store: StoreName; value: Row } | { store: StoreName; delete: string | number };

/**
 * Applies puts and deletes (after optionally clearing whole stores) in ONE
 * transaction, so a restore or a cascade delete is all-or-nothing.
 */
export function writeRecords(ops: WriteOp[], clear: StoreName[] = []): Promise<void> {
  return track(
    (async () => {
      const u = requireUnlocked();
      // Encrypt first: an IndexedDB transaction auto-commits as soon as it waits on anything else.
      const sealed = await Promise.all(ops.map(async (op) => ('value' in op ? { store: op.store, row: await seal(u, op.store, op.value) } : op)));
      const stores = [...new Set([...clear, ...ops.map((op) => op.store)])];
      if (!stores.length) return;
      const db = await getDb();
      if (unlocked !== u) throw lockedError(); // locked or switched while encrypting
      const tx = db.transaction(stores, 'readwrite');
      // Requests run in order inside the transaction; awaiting them all keeps every failure handled.
      const requests: Promise<unknown>[] = clear.map((s) => tx.objectStore(s).clear());
      for (const op of sealed) requests.push('row' in op ? tx.objectStore(op.store).put(op.row) : tx.objectStore(op.store).delete(op.delete as never));
      await Promise.all([...requests, tx.done]);
    })().catch((err: unknown) => {
      throw toStorageError(err);
    }),
  );
}

/** Encrypts a value with the signed-in account's data key (encrypted backups: the account password reopens them on any device). */
export async function sealWithAccountKey(value: unknown, additionalData: Bytes): Promise<Sealed> {
  return sealJson(requireUnlocked().key, value, additionalData);
}
