import type { z } from 'zod';
import {
  SCHEMA_VERSION,
  checkInSchema,
  exportBundleSchema,
  frictionReportSchema,
  planSchema,
  profileSchema,
  scheduleOverrideSchema,
  sessionSchema,
  type CheckIn,
  type ExportBundle,
  type FrictionReport,
  type Plan,
  type Profile,
  type ScheduleOverride,
  type Session,
} from '@/lib/validation/schemas';
import { ALL_STORES, StorageError, getDb, toStorageError, type StoreName } from './db';

/**
 * Typed repository functions. This is the only module that talks to IndexedDB
 * directly; UI code goes through these functions. Every read is validated,
 * every write is validated before it is stored, and every change emits an
 * event so open screens refresh.
 */

export const dataEvents = new EventTarget();

function notify(store: StoreName | 'all'): void {
  dataEvents.dispatchEvent(new CustomEvent('change', { detail: store }));
}

/** Count of records skipped because they failed validation since the app started. */
export const storageHealth = { invalidRecords: 0 };

function parseAll<T>(schema: z.ZodType<T>, rows: unknown[]): T[] {
  const out: T[] = [];
  for (const row of rows) {
    const result = schema.safeParse(row);
    if (result.success) out.push(result.data);
    else storageHealth.invalidRecords++;
  }
  return out;
}

function parseOne<T>(schema: z.ZodType<T>, row: unknown): T | null {
  if (row === undefined || row === null) return null;
  const result = schema.safeParse(row);
  if (!result.success) {
    storageHealth.invalidRecords++;
    return null;
  }
  return result.data;
}

function validate<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new StorageError('invalid-data', `Could not save ${what}: ${issue ? `${issue.path.join('.') || 'value'} ${issue.message}` : 'invalid data'}.`);
  }
  return result.data;
}

async function put(store: Exclude<StoreName, 'meta'>, value: Record<string, unknown>): Promise<void> {
  try {
    const db = await getDb();
    await db.put(store, value);
  } catch (err) {
    throw toStorageError(err);
  }
  notify(store);
}

// ---------- Profile ----------

export async function getProfile(): Promise<Profile | null> {
  const db = await getDb();
  return parseOne(profileSchema, await db.get('profile', 'me'));
}

export async function saveProfile(profile: Profile): Promise<Profile> {
  const valid = validate(profileSchema, { ...profile, updatedAt: Date.now() }, 'your profile');
  await put('profile', valid as unknown as Record<string, unknown>);
  return valid;
}

// ---------- Plans (versioned history) ----------

export async function listPlanVersions(): Promise<Plan[]> {
  const db = await getDb();
  return parseAll(planSchema, await db.getAll('planVersions')).sort((a, b) => a.version - b.version);
}

export async function getCurrentPlan(): Promise<Plan | null> {
  const versions = await listPlanVersions();
  return versions[versions.length - 1] ?? null;
}

/** Saves a new plan version. Earlier versions are never modified, so the history stays intact. */
export async function addPlanVersion(plan: Omit<Plan, 'version' | 'createdAt'>): Promise<Plan> {
  const versions = await listPlanVersions();
  const next = { ...plan, version: (versions[versions.length - 1]?.version ?? 0) + 1, createdAt: Date.now() };
  const valid = validate(planSchema, next, 'the plan');
  await put('planVersions', valid as unknown as Record<string, unknown>);
  return valid;
}

// ---------- Sessions ----------

export async function listSessions(): Promise<Session[]> {
  const db = await getDb();
  return parseAll(sessionSchema, await db.getAll('sessions')).sort((a, b) => b.startedAt - a.startedAt);
}

export async function getSession(id: string): Promise<Session | null> {
  const db = await getDb();
  return parseOne(sessionSchema, await db.get('sessions', id));
}

export async function saveSession(session: Session): Promise<Session> {
  const valid = validate(sessionSchema, { ...session, lastUpdatedAt: Date.now() }, 'the session');
  await put('sessions', valid as unknown as Record<string, unknown>);
  return valid;
}

/** Deletes a session and the check-ins attached to it. */
export async function deleteSession(id: string): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(['sessions', 'checkIns'], 'readwrite');
    await tx.objectStore('sessions').delete(id);
    const checkIns = await tx.objectStore('checkIns').getAll();
    for (const c of checkIns) if (c.sessionId === id) await tx.objectStore('checkIns').delete(String(c.id));
    await tx.done;
  } catch (err) {
    throw toStorageError(err);
  }
  notify('sessions');
  notify('checkIns');
}

/**
 * Marks sessions left "in progress" (e.g. the tab was closed mid-session) as
 * interrupted. They are kept as they were saved; nothing is repeated or added.
 */
export async function recoverInterruptedSessions(): Promise<Session[]> {
  const sessions = await listSessions();
  const stale = sessions.filter((s) => s.status === 'in-progress');
  const recovered: Session[] = [];
  for (const s of stale) {
    recovered.push(await saveSession({ ...s, status: 'interrupted', endedAt: s.endedAt ?? s.lastUpdatedAt }));
  }
  return recovered;
}

// ---------- Check-ins ----------

export async function listCheckIns(): Promise<CheckIn[]> {
  const db = await getDb();
  return parseAll(checkInSchema, await db.getAll('checkIns')).sort((a, b) => b.timestamp - a.timestamp);
}

export async function saveCheckIn(checkIn: CheckIn): Promise<CheckIn> {
  const valid = validate(checkInSchema, checkIn, 'the check-in');
  await put('checkIns', valid as unknown as Record<string, unknown>);
  return valid;
}

// ---------- Schedule overrides ----------

export async function listScheduleOverrides(): Promise<ScheduleOverride[]> {
  const db = await getDb();
  return parseAll(scheduleOverrideSchema, await db.getAll('scheduleOverrides'));
}

export async function saveScheduleOverride(o: ScheduleOverride): Promise<void> {
  const valid = validate(scheduleOverrideSchema, { ...o, updatedAt: Date.now() }, 'the schedule change');
  await put('scheduleOverrides', valid as unknown as Record<string, unknown>);
}

export async function deleteScheduleOverride(date: string): Promise<void> {
  const db = await getDb();
  await db.delete('scheduleOverrides', date);
  notify('scheduleOverrides');
}

// ---------- Friction reports ----------

export async function listFrictionReports(): Promise<FrictionReport[]> {
  const db = await getDb();
  return parseAll(frictionReportSchema, await db.getAll('friction')).sort((a, b) => b.timestamp - a.timestamp);
}

export async function saveFrictionReport(r: FrictionReport): Promise<void> {
  const valid = validate(frictionReportSchema, r, 'your response');
  await put('friction', valid as unknown as Record<string, unknown>);
}

// ---------- Meta (small app state) ----------

export async function getMeta<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const row = await db.get('meta', key);
  return row ? (row.value as T) : null;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  try {
    const db = await getDb();
    await db.put('meta', { key, value });
  } catch (err) {
    throw toStorageError(err);
  }
  notify('meta');
}

export async function deleteMeta(key: string): Promise<void> {
  const db = await getDb();
  await db.delete('meta', key);
  notify('meta');
}

// ---------- Whole-dataset operations ----------

export async function exportAllData(): Promise<ExportBundle> {
  const [profile, planVersions, sessions, checkIns, scheduleOverrides, frictionReports] = await Promise.all([
    getProfile(),
    listPlanVersions(),
    listSessions(),
    listCheckIns(),
    listScheduleOverrides(),
    listFrictionReports(),
  ]);
  return { app: 'PocketRehab', schemaVersion: SCHEMA_VERSION, exportedAt: Date.now(), profile, planVersions, sessions, checkIns, scheduleOverrides, frictionReports };
}

/** Replaces all data with a previously exported backup. The file is fully validated first. */
export async function importAllData(raw: unknown): Promise<void> {
  const bundle = validate(exportBundleSchema, raw, 'the backup file');
  await clearAllData();
  try {
    const db = await getDb();
    const tx = db.transaction(['profile', 'planVersions', 'sessions', 'checkIns', 'scheduleOverrides', 'friction'], 'readwrite');
    if (bundle.profile) await tx.objectStore('profile').put(bundle.profile as unknown as Record<string, unknown>);
    for (const p of bundle.planVersions) await tx.objectStore('planVersions').put(p as unknown as Record<string, unknown>);
    for (const s of bundle.sessions) await tx.objectStore('sessions').put(s as unknown as Record<string, unknown>);
    for (const c of bundle.checkIns) await tx.objectStore('checkIns').put(c as unknown as Record<string, unknown>);
    for (const o of bundle.scheduleOverrides) await tx.objectStore('scheduleOverrides').put(o as unknown as Record<string, unknown>);
    for (const f of bundle.frictionReports) await tx.objectStore('friction').put(f as unknown as Record<string, unknown>);
    await tx.done;
  } catch (err) {
    throw toStorageError(err);
  }
  notify('all');
}

/** Deletes every record PocketRehab stores on this device (IndexedDB and local preferences). */
export async function clearAllData(): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(ALL_STORES, 'readwrite');
    await Promise.all(ALL_STORES.map((s) => tx.objectStore(s).clear()));
    await tx.done;
  } catch (err) {
    throw toStorageError(err);
  }
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('pocketrehab'))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // localStorage can be unavailable; nothing else to clear there.
  }
  notify('all');
}

/** Removes everything that belongs to the sample demo profile. */
export async function removeDemoData(): Promise<void> {
  const profile = await getProfile();
  if (profile?.isDemo) {
    await clearAllData();
    return;
  }
  const db = await getDb();
  const tx = db.transaction(['sessions', 'checkIns'], 'readwrite');
  for (const s of await tx.objectStore('sessions').getAll()) if (s.isDemoData === true) await tx.objectStore('sessions').delete(String(s.id));
  for (const c of await tx.objectStore('checkIns').getAll()) if (c.isDemoData === true) await tx.objectStore('checkIns').delete(String(c.id));
  await tx.done;
  notify('all');
}

export function newId(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${rand}`;
}
