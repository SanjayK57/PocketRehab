import type { CheckIn, ExerciseId, Plan, Profile, ScheduleOverride, Session } from '@/lib/validation/schemas';
import { EXERCISES } from '@/features/exercises/library';
import { DISCLAIMER_SHORT, numericResponse, responseValue } from '@/lib/safety/checkins';
import { adherence, buildSchedule, type AdherenceSummary } from '@/features/scheduling/schedule';
import { compareSessions, interpretChange, isStable, measurableSessions, series, PLATEAU_RULE_TEXT, type ComparisonRow } from '@/features/analytics/analysis';
import { dateKey, formatDate } from '@/lib/time/dates';
import { describePrescription, describeTarget } from '@/features/exercises/describe';

export interface ReportOptions {
  from: string;
  to: string;
  exerciseIds: ExerciseId[];
  include: { symptoms: boolean; quality: boolean; comparisons: boolean; notes: boolean; sessionList: boolean };
}

export interface ReportData {
  generatedAt: number;
  from: string;
  to: string;
  name: string;
  isDemo: boolean;
  plan: { version: number; kind: Plan['kind']; status: Plan['status']; authorizedBy: string; authorizationDate: string | null; restrictions: string } | null;
  exercises: Array<{ id: string; name: string; side: string; prescription: string; target: string; camera: boolean }>;
  adherence: AdherenceSummary;
  sessions: Array<{ date: string; exercise: string; side: string; mode: string; status: string; reps: number; validReps: number | null; peak: string; range: string; duration: string; quality: string }>;
  measurements: Array<{ name: string; sessions: number; first: string; latest: string; interpretation: string; stable: string | null }>;
  symptoms: Array<{ date: string; kind: string; pain: string; fatigue: string; difficulty: string; change: string; outcome: string }> | null;
  quality: { camera: number; reliable: number; uncertain: number; excludedReps: number; commonIssues: string[] } | null;
  comparisons: Array<{ name: string; a: string; b: string; comparable: boolean; warnings: string[]; rows: ComparisonRow[] }> | null;
  notes: string[] | null;
  missing: string[];
  limitations: string[];
  disclaimer: string;
}

const FLAG_TEXT: Record<string, string> = {
  'no-pose': 'person not detected',
  'landmark-missing': 'body points missing',
  'low-visibility': 'body points hard to see',
  'out-of-frame': 'body out of frame',
  'near-edge': 'body near frame edge',
  'implausible-jump': 'tracking glitches',
  'view-mismatch': 'camera angle did not match exercise',
  'inference-error': 'tracking errors',
  'low-light': 'low light',
};

const fmt = (v: number | null | undefined, unit = '') => (v === null || v === undefined ? 'not available' : `${Math.round(v * 10) / 10}${unit}`);
const fmtS = (ms: number | null | undefined) => (ms === null || ms === undefined ? 'not available' : `${(ms / 1000).toFixed(1)} s`);
const fmtScore = (v: number | null) => (v === null ? 'not answered' : `${v}/10`);

/** Assembles report content from stored data only. Missing information is labeled, never filled in. */
export function buildReportData(input: {
  profile: Profile | null;
  plan: Plan | null;
  sessions: Session[];
  checkIns: CheckIn[];
  overrides: ScheduleOverride[];
  options: ReportOptions;
  today: string;
  now?: number;
}): ReportData {
  const { options: o, profile, plan } = input;
  const includeSimulated = profile?.isDemo ?? false;
  const inRange = (ms: number) => {
    const k = dateKey(new Date(ms));
    return k >= o.from && k <= o.to;
  };
  const sessions = input.sessions
    .filter((s) => inRange(s.startedAt) && o.exerciseIds.includes(s.exerciseId) && s.status !== 'in-progress')
    .filter((s) => includeSimulated || s.mode !== 'simulated')
    .sort((a, b) => a.startedAt - b.startedAt);
  const checkIns = input.checkIns.filter((c) => inRange(c.timestamp)).sort((a, b) => a.timestamp - b.timestamp);
  const missing: string[] = [];

  const days = profile
    ? buildSchedule(profile.schedule, input.overrides, input.sessions.filter((s) => includeSimulated || s.mode !== 'simulated'), plan, o.from, o.to < input.today ? o.to : input.today, input.today, { includeSimulated })
    : [];
  if (!profile || profile.schedule.days.length === 0) missing.push('No schedule was set, so adherence could not be calculated.');

  const measured = measurableSessions(sessions, { includeSimulated });
  const measurementKeys = [...new Set(measured.map((s) => `${s.exerciseId}|${s.side}`))];
  const measurements = measurementKeys.map((key) => {
    const [exerciseId, side] = key.split('|') as [ExerciseId, Session['side']];
    const pts = series(measured, exerciseId, side, 'peakMedian');
    const first = pts[0];
    const latest = pts[pts.length - 1];
    return {
      name: `${EXERCISES[exerciseId].name} (${side})`,
      sessions: pts.length,
      first: first ? `${fmt(first.value, '°')} on ${formatDate(dateKey(new Date(first.t)))}` : 'not available',
      latest: latest ? `${fmt(latest.value, '°')} on ${formatDate(dateKey(new Date(latest.t)))}` : 'not available',
      interpretation: interpretChange(pts).message,
      stable: isStable(pts) ? PLATEAU_RULE_TEXT : null,
    };
  });
  if (measurements.length === 0) missing.push('No sessions in this period had enough reliable camera tracking to report movement measurements.');

  const camera = sessions.filter((s) => s.mode === 'camera');
  const flagTotals = new Map<string, number>();
  camera.forEach((s) => Object.entries(s.quality?.flagCounts ?? {}).forEach(([k, v]) => flagTotals.set(k, (flagTotals.get(k) ?? 0) + v)));
  const commonIssues = [...flagTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => FLAG_TEXT[k] ?? k);

  const comparisons = measurementKeys
    .map((key) => {
      const group = measured.filter((s) => `${s.exerciseId}|${s.side}` === key);
      if (group.length < 2) return null;
      const a = group[0] as Session;
      const b = group[group.length - 1] as Session;
      const c = compareSessions(a, b);
      return {
        name: `${EXERCISES[a.exerciseId].name} (${a.side})`,
        a: formatDate(dateKey(new Date(a.startedAt))),
        b: formatDate(dateKey(new Date(b.startedAt))),
        comparable: c.comparable,
        warnings: c.warnings,
        rows: c.rows,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const notes = checkIns
    .map((c) => responseValue(c, 'comment'))
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());

  if (o.include.symptoms && checkIns.length === 0) missing.push('No symptom check-ins were recorded in this period.');

  return {
    generatedAt: input.now ?? Date.now(),
    from: o.from,
    to: o.to,
    name: profile?.displayName ?? 'Not provided',
    isDemo: profile?.isDemo ?? false,
    plan: plan
      ? { version: plan.version, kind: plan.kind, status: plan.status, authorizedBy: plan.authorizedBy, authorizationDate: plan.authorizationDate, restrictions: plan.restrictions }
      : null,
    exercises: (plan?.exercises ?? [])
      .filter((e) => o.exerciseIds.includes(e.exerciseId))
      .map((e) => ({
        id: e.id,
        name: EXERCISES[e.exerciseId].name,
        side: e.side,
        prescription: describePrescription(e),
        target: describeTarget(e.target),
        camera: e.cameraMeasurement,
      })),
    adherence: adherence(days),
    sessions: o.include.sessionList
      ? sessions.map((s) => ({
          date: formatDate(dateKey(new Date(s.startedAt))),
          exercise: EXERCISES[s.exerciseId].shortName,
          side: s.side,
          mode: s.mode === 'camera' ? 'Camera' : s.mode === 'manual' ? 'Manual log' : 'Simulated demo',
          status: s.status.replace('-', ' '),
          reps: s.mode === 'manual' ? (s.manualRepsReported ?? 0) : s.reps.length,
          validReps: s.mode === 'manual' ? null : (s.summary?.validReps ?? 0),
          peak: s.summary?.valid ? fmt(s.summary.peakMedian, '°') : 'not reliable',
          range: s.summary?.valid ? fmt(s.summary.rangeMedian, '°') : 'not reliable',
          duration: s.summary?.valid ? fmtS(s.summary.durationMedianMs) : 'not reliable',
          quality: s.quality ? `${Math.round(s.quality.reliable * 100)}% reliable frames` : s.mode === 'manual' ? 'no camera' : 'not available',
        }))
      : [],
    measurements,
    symptoms: o.include.symptoms
      ? checkIns.map((c) => ({
          date: formatDate(dateKey(new Date(c.timestamp))),
          kind: c.kind === 'pre' ? 'Before session' : c.kind === 'post' ? 'After session' : 'Between sessions',
          pain: fmtScore(numericResponse(c, 'pain')),
          fatigue: fmtScore(numericResponse(c, 'fatigue')),
          difficulty: fmtScore(numericResponse(c, 'difficulty')),
          change: String(responseValue(c, 'symptom-change') ?? 'not answered'),
          outcome: c.outcome === 'urgent' ? 'Warning sign reported' : c.outcome === 'caution' ? 'New or worse symptoms reported' : 'No concerns flagged',
        }))
      : null,
    quality: o.include.quality
      ? {
          camera: camera.length,
          reliable: camera.filter((s) => s.summary?.valid).length,
          uncertain: camera.filter((s) => !s.summary?.valid).length,
          excludedReps: camera.reduce((sum, s) => sum + (s.summary?.excludedReps ?? 0), 0),
          commonIssues,
        }
      : null,
    comparisons: o.include.comparisons ? comparisons : null,
    notes: o.include.notes ? notes : null,
    missing,
    limitations: [
      'Movement values are 2D joint-angle estimates from a single camera. They are not goniometer measurements and are not clinically validated.',
      'Only repetitions with reliable tracking are included in measurements; uncertain repetitions are counted but excluded.',
      'PocketRehab has not established its measurement error, so small changes may reflect camera position or tracking variation.',
      'Symptom scores are self-reported and are not objective measurements.',
      ...(includeSimulated ? ['This report belongs to a demo profile and contains simulated sample data, not a real person’s history.'] : []),
    ],
    disclaimer: `${DISCLAIMER_SHORT} This report was generated by PocketRehab from data stored on the user’s device. It is not a medical diagnosis.`,
  };
}
