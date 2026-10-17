import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';

/**
 * IndexedDB schema for PocketRehab. All data stays on this device.
 * Records are stored as plain objects and validated with zod on every read
 * (see repositories.ts), so a corrupted record is skipped and reported rather
 * than crashing the app.
 *
 * Migrations: bump DB_VERSION and add an entry to MIGRATIONS. Each migration
 * runs once, in order, inside the upgrade transaction.
 */

export const DB_NAME = 'pocketrehab';
export const DB_VERSION = 1;

export interface RecoverDB extends DBSchema {
  meta: { key: string; value: { key: string; value: unknown } };
  profile: { key: string; value: Record<string, unknown> };
  planVersions: { key: number; value: Record<string, unknown> };
  sessions: { key: string; value: Record<string, unknown>; indexes: { byStartedAt: number } };
  checkIns: { key: string; value: Record<string, unknown>; indexes: { byTimestamp: number } };
  scheduleOverrides: { key: string; value: Record<string, unknown> };
  friction: { key: string; value: Record<string, unknown> };
}

export type StoreName = StoreNames<RecoverDB>;
export const ALL_STORES: StoreName[] = ['meta', 'profile', 'planVersions', 'sessions', 'checkIns', 'scheduleOverrides', 'friction'];

type Migration = (db: IDBPDatabase<RecoverDB>, tx: IDBPTransaction<RecoverDB, StoreName[], 'versionchange'>) => void;

const MIGRATIONS: Record<number, Migration> = {
  1: (db) => {
    db.createObjectStore('meta', { keyPath: 'key' });
    db.createObjectStore('profile', { keyPath: 'id' });
    db.createObjectStore('planVersions', { keyPath: 'version' });
    const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
    sessions.createIndex('byStartedAt', 'startedAt');
    const checkIns = db.createObjectStore('checkIns', { keyPath: 'id' });
    checkIns.createIndex('byTimestamp', 'timestamp');
    db.createObjectStore('scheduleOverrides', { keyPath: 'date' });
    db.createObjectStore('friction', { keyPath: 'id' });
  },
};

export class StorageError extends Error {
  constructor(
    public readonly kind: 'unavailable' | 'quota' | 'blocked' | 'write-failed' | 'invalid-data',
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

let dbPromise: Promise<IDBPDatabase<RecoverDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<RecoverDB>> {
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new StorageError('unavailable', 'This browser does not provide local storage (IndexedDB), so PocketRehab cannot save data.'));
    }
    dbPromise = openDB<RecoverDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, tx) {
        for (let v = oldVersion + 1; v <= (newVersion ?? DB_VERSION); v++) MIGRATIONS[v]?.(db, tx);
      },
      blocked() {
        console.warn('PocketRehab storage upgrade is blocked by another open tab.');
      },
      terminated() {
        dbPromise = null;
      },
    }).catch((err: unknown) => {
      dbPromise = null;
      throw new StorageError('unavailable', `Local storage could not be opened (${describeError(err)}). Private browsing or blocked site data can cause this.`);
    });
  }
  return dbPromise;
}

/** Closes the connection (used by tests and before deleting the database). */
export async function closeDb(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null);
    db?.close();
    dbPromise = null;
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
