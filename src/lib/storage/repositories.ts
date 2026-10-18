import type { z } from 'zod';
import {
  SCHEMA_VERSION,
  checkInSchema,
  exportBundleSchema,
  frictionReportSchema,
  measurementSchema,
  planSchema,
  profileSchema,
  scheduleOverrideSchema,
  sessionSchema,
  type CheckIn,
  type ExportBundle,
  type FrictionReport,
  type Measurement,
  type Plan,
  type Profile,
  type ScheduleOverride,
  type Session,
} from '@/lib/validation/schemas';
import { ALL_STORES, StorageError, readAll, readOne, writeRecords, type StoreName, type WriteOp } from './db';
import { deleteAccount, getAccountState } from './accounts';

/**
 * Typed repository functions: the app's only door to stored data. They work on
 * the signed-in account (encryption happens underneath, in db.ts). Every read is
 * validated, every write is validated before it is stored, and every change
 * emits an event so open screens refresh.
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

async function put(store: Exclude<StoreName, 'meta'>, value: unknown): Promise<void> {
  await writeRecords([{ store, value: value as Record<string, unknown> }]);
  notify(store);
}

// ---------- Profile ----------

export async function getProfile(): Promise<Profile | null> {
  return parseOne(profileSchema, await readOne('profile', 'me'));
}

export async function saveProfile(profile: Profile): Promise<Profile> {
  const valid = validate(profileSchema, { ...profile, updatedAt: Date.now() }, 'your profile');
  await put('profile', valid);
  return valid;
}

// ---------- Plans (versioned history) ----------

export async function listPlanVersions(): Promise<Plan[]> {
  return parseAll(planSchema, await readAll('planVersions')).sort((a, b) => a.version - b.version);
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
  await put('planVersions', valid);
  return valid;
}

// ---------- Sessions ----------

export async function listSessions(): Promise<Session[]> {
  return parseAll(sessionSchema, await readAll('sessions')).sort((a, b) => b.startedAt - a.startedAt);
}

export async function getSession(id: string): Promise<Session | null> {
  return parseOne(sessionSchema, await readOne('sessions', id));
}

export async function saveSession(session: Session): Promise<Session> {
  const valid = validate(sessionSchema, { ...session, lastUpdatedAt: Date.now() }, 'the session');
  await put('sessions', valid);
  return valid;
}

/** Deletes a session and the check-ins attached to it, in one transaction. */
export async function deleteSession(id: string): Promise<void> {
  const attached = (await listCheckIns()).filter((c) => c.sessionId === id);
  await writeRecords([{ store: 'sessions', delete: id }, ...attached.map((c): WriteOp => ({ store: 'checkIns', delete: c.id }))]);
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
  return parseAll(checkInSchema, await readAll('checkIns')).sort((a, b) => b.timestamp - a.timestamp);
}

export async function saveCheckIn(checkIn: CheckIn): Promise<CheckIn> {
  const valid = validate(checkInSchema, checkIn, 'the check-in');
  await put('checkIns', valid);
  return valid;
}

// ---------- Schedule overrides ----------

export async function listScheduleOverrides(): Promise<ScheduleOverride[]> {
  return parseAll(scheduleOverrideSchema, await readAll('scheduleOverrides'));
}

export async function saveScheduleOverride(o: ScheduleOverride): Promise<void> {
  const valid = validate(scheduleOverrideSchema, { ...o, updatedAt: Date.now() }, 'the schedule change');
  await put('scheduleOverrides', valid);
}

export async function deleteScheduleOverride(date: string): Promise<void> {
  await writeRecords([{ store: 'scheduleOverrides', delete: date }]);
  notify('scheduleOverrides');
}

// ---------- Friction reports ----------

export async function listFrictionReports(): Promise<FrictionReport[]> {
  return parseAll(frictionReportSchema, await readAll('friction')).sort((a, b) => b.timestamp - a.timestamp);
}

export async function saveFrictionReport(r: FrictionReport): Promise<void> {
  const valid = validate(frictionReportSchema, r, 'your response');
  await put('friction', valid);
}

// ---------- Your own measurements (entered or imported) ----------

export async function listMeasurements(): Promise<Measurement[]> {
  return parseAll(measurementSchema, await readAll('measurements')).sort((a, b) => b.timestamp - a.timestamp);
}

/** Saves several readings in one transaction: an import lands completely or not at all. */
export async function saveMeasurements(items: Measurement[]): Promise<Measurement[]> {
  const valid = items.map((m, i) => validate(measurementSchema, m, items.length > 1 ? `reading ${i + 1}` : 'the reading'));
  await writeRecords(valid.map((value) => ({ store: 'measurements' as const, value })));
  notify('measurements');
  return valid;
}

export async function deleteMeasurement(id: string): Promise<void> {
  await writeRecords([{ store: 'measurements', delete: id }]);
  notify('measurements');
}

// ---------- Meta (small app state) ----------

export async function getMeta<T>(key: string): Promise<T | null> {
  const row = await readOne('meta', key);
  return row && typeof row === 'object' && 'value' in row ? (row.value as T) : null;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await writeRecords([{ store: 'meta', value: { key, value } }]);
  notify('meta');
}

export async function deleteMeta(key: string): Promise<void> {
  await writeRecords([{ store: 'meta', delete: key }]);
  notify('meta');
}

// ---------- Whole-dataset operations ----------

export async function exportAllData(): Promise<ExportBundle> {
  const [profile, planVersions, sessions, checkIns, scheduleOverrides, frictionReports, measurements] = await Promise.all([
    getProfile(),
    listPlanVersions(),
    listSessions(),
    listCheckIns(),
    listScheduleOverrides(),
    listFrictionReports(),
    listMeasurements(),
  ]);
  return { app: 'PocketRehab', schemaVersion: SCHEMA_VERSION, exportedAt: Date.now(), profile, planVersions, sessions, checkIns, scheduleOverrides, frictionReports, measurements };
}

/** Backups larger than this are refused before parsing (a year of daily sessions is a few MB). */
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Finds a key that could be used for prototype pollution anywhere in a parsed
 * file. Iterative with a node budget, so a hostile file can't overflow the stack.
 */
function unsafeKeyIn(value: unknown): string | null {
  const stack: unknown[] = [value];
  for (let budget = 2_000_000; stack.length; budget--) {
    if (budget <= 0) return 'too many nested values';
    const v = stack.pop();
    if (!v || typeof v !== 'object') continue;
    for (const k of Object.keys(v)) {
      if (UNSAFE_KEYS.has(k)) return k;
      stack.push((v as Record<string, unknown>)[k]);
    }
  }
  return null;
}

/** Reads a backup file chosen by the user: size cap first, then JSON. Validation happens in importAllData. */
export async function readBackupFile(file: File): Promise<unknown> {
  if (file.size > MAX_BACKUP_BYTES) throw new StorageError('invalid-data', 'That file is too large to be a PocketRehab backup (the limit is 25 MB).');
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch {
    throw new StorageError('invalid-data', 'That file isn’t a PocketRehab backup (it isn’t valid JSON).');
  }
}

/**
 * Replaces all data in the signed-in account with a previously exported backup.
 * The file is fully checked first (shape, version, unsafe keys); the swap is one
 * transaction, so a failure leaves the current data exactly as it was.
 */
export async function importAllData(raw: unknown): Promise<void> {
  const unsafe = unsafeKeyIn(raw);
  if (unsafe) throw new StorageError('invalid-data', `That file can’t be restored: it contains an unexpected field (${unsafe}).`);
  const version = raw && typeof raw === 'object' ? (raw as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (typeof version === 'number' && version > SCHEMA_VERSION) {
    throw new StorageError('invalid-data', 'That backup was made by a newer version of PocketRehab. Update the app (reload the page), then try again.');
  }
  const bundle = validate(exportBundleSchema, raw, 'the backup file');
  if (bundle.schemaVersion < 1) throw new StorageError('invalid-data', 'That backup’s version isn’t one PocketRehab knows.');
  const ops: WriteOp[] = [
    ...(bundle.profile ? [{ store: 'profile' as const, value: bundle.profile }] : []),
    ...bundle.planVersions.map((value) => ({ store: 'planVersions' as const, value })),
    ...bundle.sessions.map((value) => ({ store: 'sessions' as const, value })),
    ...bundle.checkIns.map((value) => ({ store: 'checkIns' as const, value })),
    ...bundle.scheduleOverrides.map((value) => ({ store: 'scheduleOverrides' as const, value })),
    ...bundle.frictionReports.map((value) => ({ store: 'friction' as const, value })),
    ...bundle.measurements.map((value) => ({ store: 'measurements' as const, value })),
  ];
  await writeRecords(ops, ALL_STORES);
  notify('all');
}

/** Deletes every record in the signed-in account (the account itself stays). */
export async function clearAllData(): Promise<void> {
  await writeRecords([], ALL_STORES);
  notify('all');
}

/**
 * Removes the sample demo data. In the demo account that means the whole demo
 * account; in a real account, only records flagged as demo data.
 */
export async function removeDemoData(): Promise<void> {
  if (getAccountState().account?.kind === 'guest') {
    await deleteAccount(null); // the demo account has no password and holds only sample data
    return;
  }
  const profile = await getProfile();
  if (profile?.isDemo) {
    await clearAllData();
    return;
  }
  const [sessions, checkIns] = await Promise.all([listSessions(), listCheckIns()]);
  await writeRecords([
    ...sessions.filter((x) => x.isDemoData).map((x): WriteOp => ({ store: 'sessions', delete: x.id })),
    ...checkIns.filter((x) => x.isDemoData).map((x): WriteOp => ({ store: 'checkIns', delete: x.id })),
  ]);
  notify('all');
}

export function newId(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${rand}`;
}
