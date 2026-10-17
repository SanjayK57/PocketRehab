import type { ExerciseId, BodySide, Session } from '@/lib/validation/schemas';
import { ANALYSIS_CONFIG } from '@/features/movement-analysis/config';
import { median } from '@/features/movement-analysis/filters';

/**
 * Progress analysis over saved sessions. Everything here is computed from
 * stored measurements only. Unreliable sessions never enter trends, and small
 * changes are not interpreted as improvement because PocketRehab has not
 * established its measurement error (see MEASUREMENT_ERROR_MODEL).
 */

/**
 * Known measurement error for camera angle estimates. PocketRehab has NOT run a
 * repeatability study against reference measurements, so this is null and
 * change interpretation stays conservative. When a real repeatability study
 * produces a minimal detectable change (MDC), set it here with its source.
 */
export const MEASUREMENT_ERROR_MODEL: { mdcDegrees: number; source: string } | null = null;

export const INSUFFICIENT_DATA_MESSAGE = 'Not enough reliable, comparable measurements to determine whether a meaningful change occurred.';

/** Sessions with a valid fingerprint that may be used for measured progress. */
export function measurableSessions(sessions: Session[], opts: { includeSimulated: boolean }): Session[] {
  return sessions
    .filter((s) => s.summary?.valid && s.reps.length > 0 && s.status !== 'in-progress')
    .filter((s) => s.mode === 'camera' || (opts.includeSimulated && s.mode === 'simulated'))
    .sort((a, b) => a.startedAt - b.startedAt);
}

export interface SeriesPoint {
  sessionId: string;
  t: number;
  value: number;
  /** Rolling median of up to 3 consecutive values (labelled as smoothed wherever shown). */
  smoothed: number;
  simulated: boolean;
}

export type Metric = 'peakMedian' | 'rangeMedian' | 'durationMedianMs' | 'holdMedianMs' | 'peakCv';

export function series(sessions: Session[], exerciseId: ExerciseId, side: BodySide | null, metric: Metric): SeriesPoint[] {
  const pts = sessions
    .filter((s) => s.exerciseId === exerciseId && (side === null || s.side === side))
    .map((s) => ({ s, v: s.summary?.[metric] ?? null }))
    .filter((x): x is { s: Session; v: number } => x.v !== null);
  return pts.map((p, i) => {
    const window = pts.slice(Math.max(0, i - 2), i + 1).map((q) => q.v);
    return { sessionId: p.s.id, t: p.s.startedAt, value: p.v, smoothed: median(window) as number, simulated: p.s.mode === 'simulated' };
  });
}

export type ChangeInterpretation =
  | { kind: 'insufficient'; message: string }
  | { kind: 'uninterpretable'; change: number; message: string }
  | { kind: 'within-noise'; change: number; message: string }
  | { kind: 'exceeds-noise'; change: number; message: string };

/**
 * Interprets the change between the first and latest comparable measurements.
 * Without an established error model the observed difference is reported but
 * explicitly not interpreted as improvement or decline.
 */
export function interpretChange(points: SeriesPoint[], unit = '°', errorModel = MEASUREMENT_ERROR_MODEL): ChangeInterpretation {
  if (points.length < ANALYSIS_CONFIG.trend.minComparableSessions) return { kind: 'insufficient', message: INSUFFICIENT_DATA_MESSAGE };
  const first = points[0] as SeriesPoint;
  const last = points[points.length - 1] as SeriesPoint;
  const change = Math.round((last.smoothed - first.smoothed) * 10) / 10;
  const sign = change > 0 ? '+' : '';
  if (!errorModel) {
    return {
      kind: 'uninterpretable',
      change,
      message: `Smoothed values changed by ${sign}${change}${unit} across ${points.length} sessions. PocketRehab has not established how much its camera measurements vary, so this difference may reflect camera or tracking variation rather than a real change.`,
    };
  }
  if (Math.abs(change) <= errorModel.mdcDegrees) {
    return { kind: 'within-noise', change, message: `A change of ${sign}${change}${unit} is within the estimated measurement error (±${errorModel.mdcDegrees}${unit}, ${errorModel.source}).` };
  }
  return { kind: 'exceeds-noise', change, message: `A change of ${sign}${change}${unit} is larger than the estimated measurement error (±${errorModel.mdcDegrees}${unit}, ${errorModel.source}). Discuss what it means with your clinician.` };
}

export const PLATEAU_RULE_TEXT = `Rule used: the last ${ANALYSIS_CONFIG.trend.plateauSessions} comparable reliable sessions were all within ±${ANALYSIS_CONFIG.trend.plateauBandDeg}° of their median. This is a software heuristic, not a clinical assessment.`;

/** Returns true when recent measurements are stable under the documented plateau rule. */
export function isStable(points: SeriesPoint[]): boolean {
  const n = ANALYSIS_CONFIG.trend.plateauSessions;
  if (points.length < n) return false;
  const recent = points.slice(-n).map((p) => p.value);
  const m = median(recent) as number;
  return recent.every((v) => Math.abs(v - m) <= ANALYSIS_CONFIG.trend.plateauBandDeg);
}

// ---------- Session comparison ----------

export interface ComparisonRow {
  key: string;
  label: string;
  unit: string;
  a: number | null;
  b: number | null;
  diff: number | null;
}

export interface SessionComparison {
  comparable: boolean;
  warnings: string[];
  excluded: string[];
  rows: ComparisonRow[];
}

/** Compares two sessions of the same exercise and explains why the comparison may be unreliable. */
export function compareSessions(a: Session, b: Session): SessionComparison {
  const warnings: string[] = [];
  const excluded: string[] = [];
  let blocking = false;

  if (a.exerciseId !== b.exerciseId) {
    warnings.push('These sessions are different exercises and cannot be compared.');
    blocking = true;
  }
  if (a.side !== b.side) {
    warnings.push(`Different sides were measured (${a.side} vs ${b.side}). Left-right differences are not always expected to disappear.`);
    blocking = true;
  }
  if (a.exerciseVersion !== b.exerciseVersion) warnings.push('The exercise definition changed between these sessions, so measurements may not be directly comparable.');
  if (a.mode !== b.mode) warnings.push(`Measurement modes differ (${a.mode} vs ${b.mode}).`);
  if (a.mode === 'simulated' || b.mode === 'simulated') warnings.push('At least one session is a simulated demo, not a camera measurement.');
  for (const [name, s] of [['First', a], ['Second', b]] as const) {
    if (!s.summary?.valid) {
      warnings.push(`${name} session does not have enough reliable repetitions; its values are excluded.`);
      blocking = true;
    }
    if (s.summary && s.summary.excludedReps > 0) excluded.push(`${name} session: ${s.summary.excludedReps} repetition(s) excluded for uncertain tracking.`);
  }
  if (a.camera && b.camera) {
    if (a.camera.view !== b.camera.view) {
      warnings.push('The camera view differed between sessions.');
      blocking = true;
    }
    const ra = a.camera.width / Math.max(1, a.camera.height);
    const rb = b.camera.width / Math.max(1, b.camera.height);
    if (Math.abs(ra - rb) > 0.05) warnings.push('The camera image shape (aspect ratio) differed, which can change 2D angle estimates.');
    if (a.camera.subjectScale && b.camera.subjectScale) {
      const diff = Math.abs(a.camera.subjectScale - b.camera.subjectScale) / Math.max(a.camera.subjectScale, b.camera.subjectScale);
      if (diff > ANALYSIS_CONFIG.comparison.maxScaleDifference) {
        warnings.push(`Your distance from the camera appears to have changed noticeably (body size in the picture differed by ${Math.round(diff * 100)}%).`);
      }
    }
    if (a.camera.model !== b.camera.model) warnings.push('Different tracking models were used.');
  }
  if (!MEASUREMENT_ERROR_MODEL) warnings.push('PocketRehab has not established its measurement error, so small differences may be camera or tracking variation.');

  const sa = a.summary;
  const sb = b.summary;
  const row = (key: keyof NonNullable<Session['summary']>, label: string, unit: string, scale = 1): ComparisonRow => {
    const va = sa?.valid ? (sa[key] as number | null) : null;
    const vb = sb?.valid ? (sb[key] as number | null) : null;
    const av = va === null ? null : Math.round((va / scale) * 10) / 10;
    const bv = vb === null ? null : Math.round((vb / scale) * 10) / 10;
    return { key, label, unit, a: av, b: bv, diff: av !== null && bv !== null ? Math.round((bv - av) * 10) / 10 : null };
  };

  return {
    comparable: !blocking,
    warnings,
    excluded,
    rows: [
      row('peakMedian', 'Peak angle (median)', '°'),
      row('rangeMedian', 'Movement range (median)', '°'),
      row('durationMedianMs', 'Repetition duration (median)', 's', 1000),
      row('outboundMedianMs', 'Outbound phase (median)', 's', 1000),
      row('returnMedianMs', 'Return phase (median)', 's', 1000),
      row('holdMedianMs', 'Hold (median)', 's', 1000),
      row('speedPeaksMedian', 'Speed peaks per rep (median)', ''),
      row('peakCv', 'Peak variation between reps', '%'),
      row('validReps', 'Reliable repetitions', ''),
    ],
  };
}

/** Latest left vs right values for an exercise, when both sides have reliable data. */
export function sideComparison(sessions: Session[], exerciseId: ExerciseId): { left: Session; right: Session } | null {
  const reliable = sessions.filter((s) => s.exerciseId === exerciseId && s.summary?.valid).sort((a, b) => b.startedAt - a.startedAt);
  const left = reliable.find((s) => s.side === 'left');
  const right = reliable.find((s) => s.side === 'right');
  return left && right ? { left, right } : null;
}
