import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, DB_NAME, getDb } from '@/lib/storage/db';
import {
  addPlanVersion,
  clearAllData,
  deleteSession,
  exportAllData,
  getCurrentPlan,
  getProfile,
  importAllData,
  listCheckIns,
  listPlanVersions,
  listSessions,
  recoverInterruptedSessions,
  removeDemoData,
  saveCheckIn,
  saveProfile,
  saveSession,
  storageHealth,
} from '@/lib/storage/repositories';
import { evaluateSafety } from '@/lib/safety/checkins';
import { CoachThrottle, selectMessage, trafficLight } from '@/features/live-coaching/coach';
import { adherence, buildIcs, buildSchedule, rescheduleConflict } from '@/features/scheduling/schedule';
import { compareSessions, interpretChange, isStable, INSUFFICIENT_DATA_MESSAGE, measurableSessions, series } from '@/features/analytics/analysis';
import { buildWeeklySummary } from '@/features/analytics/weekly';
import { buildReportData } from '@/features/reports/reportData';
import { diffPlans } from '@/features/exercises/describe';
import { planSchema, prescribedExerciseSchema, targetRangeSchema } from '@/lib/validation/schemas';
import { EXERCISES } from '@/features/exercises/library';
import { makeCheckIn, makePlan, makeProfile, makeSession } from '../fixtures/factories';
import type { Repetition } from '@/lib/validation/schemas';

async function resetDb() {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe('storage', () => {
  beforeEach(resetDb);

  it('saves and reads back a profile, plan and session (persistence)', async () => {
    await saveProfile(makeProfile());
    const { version: _v, createdAt: _c, ...plan } = makePlan();
    await addPlanVersion(plan);
    await saveSession(makeSession());
    await closeDb(); // simulate an app reload
    expect((await getProfile())?.displayName).toBe('Test User');
    expect((await getCurrentPlan())?.version).toBe(1);
    expect(await listSessions()).toHaveLength(1);
  });

  it('keeps every plan version (history is append-only)', async () => {
    const { version: _v, createdAt: _c, ...plan } = makePlan();
    await addPlanVersion(plan);
    await addPlanVersion({ ...plan, changeSummary: 'Reps changed', changeSource: 'clinician-update' });
    const versions = await listPlanVersions();
    expect(versions.map((p) => p.version)).toEqual([1, 2]);
  });

  it('rejects invalid data on write', async () => {
    await expect(saveProfile({ ...makeProfile(), displayName: '' })).rejects.toThrow(/Could not save your profile/);
  });

  it('skips corrupted records on read instead of crashing', async () => {
    await saveSession(makeSession());
    const db = await getDb();
    await db.put('sessions', { id: 'broken', exerciseId: 'not-a-real-exercise' });
    const before = storageHealth.invalidRecords;
    const sessions = await listSessions();
    expect(sessions).toHaveLength(1);
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
    const recovered = await recoverInterruptedSessions();
    expect(recovered).toHaveLength(1);
    const [saved] = await listSessions();
    expect(saved?.status).toBe('interrupted');
    expect(saved?.reps).toHaveLength(s.reps.length);
  });

  it('exports, clears and re-imports all data', async () => {
    await saveProfile(makeProfile());
    await saveSession(makeSession());
    const bundle = await exportAllData();
    await clearAllData();
    expect(await getProfile()).toBeNull();
    expect(await listSessions()).toHaveLength(0);
    await importAllData(JSON.parse(JSON.stringify(bundle)));
    expect((await getProfile())?.displayName).toBe('Test User');
    expect(await listSessions()).toHaveLength(1);
  });

  it('refuses to import an invalid backup and leaves data untouched', async () => {
    await saveProfile(makeProfile());
    await expect(importAllData({ app: 'Other' })).rejects.toThrow();
    expect(await getProfile()).not.toBeNull();
  });

  it('removing demo data wipes a demo profile completely', async () => {
    await saveProfile(makeProfile({ isDemo: true }));
    await saveSession(makeSession({ isDemoData: true, mode: 'simulated' }));
    await removeDemoData();
    expect(await getProfile()).toBeNull();
    expect(await listSessions()).toHaveLength(0);
  });
});

describe('validation', () => {
  it('rejects a target range whose minimum exceeds its maximum', () => {
    expect(targetRangeSchema.safeParse({ min: 100, max: 80, source: 'clinician' }).success).toBe(false);
  });

  it('rejects out-of-range prescriptions', () => {
    const base = makePlan().exercises[0];
    expect(prescribedExerciseSchema.safeParse({ ...base, reps: 0 }).success).toBe(false);
    expect(prescribedExerciseSchema.safeParse({ ...base, sets: 99 }).success).toBe(false);
    expect(planSchema.safeParse(makePlan()).success).toBe(true);
  });

  it('describes plan changes for the history view', () => {
    const a = makePlan();
    const b = makePlan({ version: 2, exercises: a.exercises.map((e) => ({ ...e, reps: e.reps + 2 })) });
    expect(diffPlans(a, b).join(' ')).toMatch(/reps 6 → 8/);
  });
});

describe('safety rules (deterministic)', () => {
  it('any warning sign is urgent', () => {
    expect(evaluateSafety({ 'warning-signs': ['breathing'] }).level).toBe('urgent');
  });
  it('new or worsening symptoms trigger caution', () => {
    expect(evaluateSafety({ 'symptom-change': 'worse' }).level).toBe('caution');
    expect(evaluateSafety({ 'symptom-change': 'new' }).level).toBe('caution');
  });
  it('a high pain number alone does not invent an escalation threshold', () => {
    expect(evaluateSafety({ pain: 9, 'symptom-change': 'same' }).level).toBe('none');
  });
  it('unknown warning-sign values are ignored and empty answers are fine', () => {
    expect(evaluateSafety({ 'warning-signs': ['not-a-sign'] }).level).toBe('none');
    expect(evaluateSafety({}).level).toBe('none');
  });
});

describe('coaching rules', () => {
  const def = EXERCISES['shoulder-abduction'];
  const rep = (over: Partial<Repetition> = {}): Repetition => ({
    index: 1, setIndex: 1, startedAt: 0, endedAt: 2000, durationMs: 2000, outboundMs: 900, holdMs: 100, returnMs: 1000,
    startValue: 15, peakValue: 90, range: 75, targetMet: true, validity: 'reliable', reliableFraction: 1, speedPeaks: 2, compensation: [], qualityFlags: [],
    ...over,
  });

  it('never gives form feedback for an uncertain repetition', () => {
    const msg = selectMessage({ type: 'rep', rep: rep({ validity: 'uncertain', targetMet: false, compensation: ['trunk-lateral-lean'] }), repsInSet: 2, repsTarget: 6, exercise: def }, 'calm');
    expect(msg?.kind).toBe('quality');
    expect(msg?.text).toMatch(/not included in the movement summary/);
    expect(msg?.text).not.toMatch(/torso|target/i);
  });

  it('traffic light is amber whenever tracking is not reliable, even if criteria were missed', () => {
    expect(trafficLight(rep({ targetMet: false }), 'uncertain')).toBe('amber');
    expect(trafficLight(rep({ validity: 'uncertain', targetMet: false }), 'reliable')).toBe('amber');
    expect(trafficLight(rep({ targetMet: false }), 'reliable')).toBe('red');
    expect(trafficLight(rep(), 'reliable')).toBe('green');
    expect(trafficLight(null, 'reliable')).toBe('idle');
  });

  it('describes a missed target neutrally and never encourages pushing further', () => {
    const msg = selectMessage({ type: 'rep', rep: rep({ targetMet: false }), repsInSet: 1, repsTarget: 6, exercise: def }, 'encouraging');
    expect(msg?.text).toMatch(/differed from the configured target/);
    expect(msg?.text).toMatch(/Only move as far as your plan allows/);
  });

  it('reports compensation only from the predefined rule text', () => {
    const msg = selectMessage({ type: 'rep', rep: rep({ compensation: ['trunk-lateral-lean'] }), repsInSet: 1, repsTarget: 6, exercise: def }, 'calm');
    expect(msg?.text).toContain(def.compensationRules[0]?.message);
  });

  it('throttles speech so the coach does not talk over every movement', () => {
    const t = new CoachThrottle(2500, 1200, 8000);
    const normal = { id: 'x', text: 'x', speak: true, priority: 'normal' as const, kind: 'setup' as const };
    expect(t.shouldSpeak(normal, 0)).toBe(true);
    expect(t.shouldSpeak({ ...normal, id: 'y' }, 1000)).toBe(false);
    expect(t.shouldSpeak({ ...normal, priority: 'high' }, 1100)).toBe(true);
    expect(t.shouldSpeak(normal, 4000)).toBe(false); // same message repeated too soon
  });
});

describe('scheduling and adherence', () => {
  const settings = { days: [1, 3, 5], time: '17:00', remindersEnabled: true, reminderMinutes: 15 };
  const plan = makePlan();

  it('builds planned days and marks missed, completed and upcoming correctly', () => {
    // Oct 5 2026 is a Monday.
    const done = makeSession({ startedAt: new Date(2026, 9, 5, 17, 10).getTime() });
    const days = buildSchedule(settings, [], [done], plan, '2026-10-04', '2026-10-10', '2026-10-08');
    expect(days.map((d) => [d.date, d.status])).toEqual([
      ['2026-10-05', 'completed'],
      ['2026-10-07', 'missed'],
      ['2026-10-09', 'upcoming'],
    ]);
    const a = adherence(days);
    expect(a.eligible).toBe(2);
    expect(a.percent).toBe(50);
  });

  it('simulated sessions never count toward adherence', () => {
    const sim = makeSession({ mode: 'simulated', startedAt: new Date(2026, 9, 5, 17, 10).getTime() });
    const days = buildSchedule(settings, [], [sim], plan, '2026-10-05', '2026-10-05', '2026-10-06');
    expect(days[0]?.status).toBe('missed');
  });

  it('rescheduling moves a session instead of duplicating it, and unavailable days are excluded from adherence', () => {
    const overrides = [
      { date: '2026-10-07', status: 'rescheduled' as const, newDate: '2026-10-08', newTime: '09:00', note: '', updatedAt: 1 },
      { date: '2026-10-09', status: 'unavailable' as const, newDate: null, newTime: null, note: 'Travel', updatedAt: 1 },
    ];
    const days = buildSchedule(settings, overrides, [], plan, '2026-10-05', '2026-10-11', '2026-10-12');
    expect(days.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-08', '2026-10-09']);
    expect(days[1]?.origin).toBe('rescheduled');
    expect(adherence(days).eligible).toBe(2);
    expect(adherence([]).percent).toBeNull();
  });

  it('refuses to stack two sessions on one day', () => {
    const days = buildSchedule(settings, [], [], plan, '2026-10-05', '2026-10-11', '2026-10-05');
    expect(rescheduleConflict('2026-10-07', days, '2026-10-05')).not.toBeNull();
    expect(rescheduleConflict('2026-10-06', days, '2026-10-05')).toBeNull();
  });

  it('exports a valid iCalendar file', () => {
    const days = buildSchedule(settings, [], [], plan, '2026-10-05', '2026-10-11', '2026-10-01');
    const ics = buildIcs(days, { minutes: 20, reminderMinutes: 15, exerciseNames: ['Arm raise, side'], now: Date.UTC(2026, 9, 1) });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain('DTSTART:20261005T170000');
    expect(ics).toContain('DTEND:20261005T172000');
    expect(ics).toContain('TRIGGER:-PT15M');
    expect(ics).toContain('Arm raise\\, side');
    ics.split('\r\n').forEach((line) => expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75));
  });
});

describe('progress analysis', () => {
  const day = (d: number) => Date.UTC(2026, 9, d, 21);

  it('trends exclude unreliable and simulated sessions', () => {
    const good = makeSession({ startedAt: day(1) });
    const sim = makeSession({ startedAt: day(2), mode: 'simulated' });
    const bad = makeSession({ startedAt: day(3) });
    bad.summary = { ...(bad.summary as NonNullable<typeof bad.summary>), valid: false };
    expect(measurableSessions([good, sim, bad], { includeSimulated: false }).map((s) => s.id)).toEqual([good.id]);
  });

  it('refuses to interpret trends with too few sessions', () => {
    const pts = series(measurableSessions([makeSession({ startedAt: day(1) }), makeSession({ startedAt: day(2) })], { includeSimulated: false }), 'shoulder-abduction', 'right', 'peakMedian');
    expect(interpretChange(pts)).toEqual({ kind: 'insufficient', message: INSUFFICIENT_DATA_MESSAGE });
  });

  it('reports observed changes without calling them improvement when error is unknown', () => {
    const sessions = [80, 84, 88, 92].map((p, i) => makeSession({ startedAt: day(i + 1), peak: p, seed: i + 1 }));
    const pts = series(measurableSessions(sessions, { includeSimulated: false }), 'shoulder-abduction', 'right', 'peakMedian');
    const result = interpretChange(pts);
    expect(result.kind).toBe('uninterpretable');
    expect(result.message).toMatch(/may reflect camera or tracking variation/);
    expect(result.message).not.toMatch(/improv/i);
  });

  it('uses an error model when one exists', () => {
    const pts = [1, 2, 3].map((i) => ({ sessionId: String(i), t: i, value: 80 + i * 10, smoothed: 80 + i * 10, simulated: false }));
    expect(interpretChange(pts, '°', { mdcDegrees: 5, source: 'test' }).kind).toBe('exceeds-noise');
    expect(interpretChange(pts, '°', { mdcDegrees: 50, source: 'test' }).kind).toBe('within-noise');
  });

  it('applies the documented stability rule', () => {
    const mk = (vals: number[]) => vals.map((v, i) => ({ sessionId: String(i), t: i, value: v, smoothed: v, simulated: false }));
    expect(isStable(mk([90, 92, 89, 91]))).toBe(true);
    expect(isStable(mk([80, 90, 100, 110]))).toBe(false);
    expect(isStable(mk([90, 91]))).toBe(false);
  });

  it('warns when sessions are not comparable', () => {
    const a = makeSession({ startedAt: day(1) });
    const b = makeSession({ startedAt: day(2), side: 'left' });
    const c = compareSessions(a, b);
    expect(c.comparable).toBe(false);
    expect(c.warnings.join(' ')).toMatch(/Different sides/);
    const d = makeSession({ startedAt: day(3) });
    d.camera = { ...(d.camera as NonNullable<typeof d.camera>), subjectScale: (a.camera?.subjectScale ?? 0.3) * 1.6 };
    expect(compareSessions(a, d).warnings.join(' ')).toMatch(/distance from the camera/);
  });

  it('weekly summary uses only stored data and lists limitations', () => {
    const s = makeSession({ startedAt: new Date(2026, 9, 5, 17).getTime() });
    const days = buildSchedule({ days: [1, 3], time: '17:00', remindersEnabled: false, reminderMinutes: 0 }, [], [s], makePlan(), '2026-10-04', '2026-10-10', '2026-10-11');
    const w = buildWeeklySummary({ weekStart: '2026-10-04', days, sessions: [s], checkIns: [makeCheckIn({ timestamp: new Date(2026, 9, 5, 18).getTime(), outcome: 'caution' })], friction: [], plan: makePlan(), includeSimulated: false });
    expect(w.sessionsCompleted).toBe(1);
    expect(w.adherence.percent).toBe(50);
    expect(w.topics.join(' ')).toMatch(/new or worsening/);
    expect(w.limitations.join(' ')).toMatch(/not clinically validated/);
  });
});

describe('report data', () => {
  it('labels missing information instead of inventing it', () => {
    const r = buildReportData({
      profile: makeProfile(),
      plan: makePlan(),
      sessions: [],
      checkIns: [],
      overrides: [],
      options: { from: '2026-10-01', to: '2026-10-07', exerciseIds: ['shoulder-abduction'], include: { symptoms: true, quality: true, comparisons: true, notes: true, sessionList: true } },
      today: '2026-10-08',
    });
    expect(r.measurements).toHaveLength(0);
    expect(r.missing.join(' ')).toMatch(/No sessions in this period had enough reliable camera tracking/);
    expect(r.missing.join(' ')).toMatch(/No symptom check-ins/);
    expect(r.disclaimer).toMatch(/not a medical diagnosis/);
  });

  it('includes measured sessions and excludes simulated ones for real profiles', () => {
    const sessions = [makeSession({ startedAt: new Date(2026, 9, 2, 17).getTime() }), makeSession({ startedAt: new Date(2026, 9, 3, 17).getTime(), mode: 'simulated' })];
    const r = buildReportData({
      profile: makeProfile(),
      plan: makePlan(),
      sessions,
      checkIns: [makeCheckIn({ timestamp: new Date(2026, 9, 2, 18).getTime() })],
      overrides: [],
      options: { from: '2026-10-01', to: '2026-10-07', exerciseIds: ['shoulder-abduction'], include: { symptoms: true, quality: true, comparisons: false, notes: false, sessionList: true } },
      today: '2026-10-08',
    });
    expect(r.sessions).toHaveLength(1);
    expect(r.symptoms?.[0]?.pain).toBe('3/10');
    expect(r.comparisons).toBeNull();
    expect(r.quality?.reliable).toBe(1);
  });
});
