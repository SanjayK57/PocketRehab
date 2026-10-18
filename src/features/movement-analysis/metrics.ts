import type { ExerciseDefinition, CompensationRule } from '@/types/exercise';
import type { MovementFingerprint, QualityFlag, Repetition, TargetRange } from '@/lib/validation/schemas';
import type { MeasurementMethod, RepCheck } from '@/types/form';
import { ANALYSIS_CONFIG } from './config';
import { coefficientOfVariation, median } from './filters';
import type { RawRep, SegmenterSample } from './segmenter';

/**
 * Phase timing for one repetition, from the smoothed samples:
 * - outbound: start → first sample within `holdTolerance` of the peak
 * - hold: time spent within `holdTolerance` of the peak
 * - return: last sample within tolerance of the peak → end
 * These are measured durations, distinct from any prescribed hold time.
 */
export function repTiming(rep: RawRep, holdTolerance: number): { outboundMs: number; holdMs: number; returnMs: number } {
  const near = rep.samples.filter((s) => s.value !== null && s.value >= rep.peakValue - holdTolerance);
  const first = near[0]?.t ?? rep.peakAt;
  const last = near[near.length - 1]?.t ?? rep.peakAt;
  return {
    outboundMs: Math.max(0, first - rep.startedAt),
    holdMs: Math.max(0, last - first),
    returnMs: Math.max(0, rep.endedAt - last),
  };
}

/**
 * Movement smoothness as a count of distinct angular-speed peaks within one
 * repetition. The smoothed angle is resampled to a fixed rate (so frame-rate
 * variation does not change the result), differentiated, lightly averaged, and
 * peaks are counted when they exceed `minPeakFraction` of the repetition's top
 * speed and are separated by a dip below `valleyFraction` of the smaller peak.
 *
 * A single smooth movement out and back typically shows 2 peaks; hesitations
 * add more. This is an explainable software metric, not a validated measure of
 * recovery. Returns null when the data are too sparse or contain gaps.
 */
export function countSpeedPeaks(samples: SegmenterSample[]): number | null {
  const cfg = ANALYSIS_CONFIG.smoothness;
  const pts = samples.filter((s): s is SegmenterSample & { value: number } => s.value !== null);
  if (pts.length < cfg.minSamples) return null;
  for (let i = 1; i < pts.length; i++) {
    if ((pts[i] as SegmenterSample).t - (pts[i - 1] as SegmenterSample).t > cfg.maxGapMs) return null;
  }
  const t0 = (pts[0] as SegmenterSample).t;
  const t1 = (pts[pts.length - 1] as SegmenterSample).t;
  const step = 1000 / cfg.resampleHz;
  const resampled: number[] = [];
  let j = 0;
  for (let t = t0; t <= t1; t += step) {
    while (j < pts.length - 2 && (pts[j + 1] as SegmenterSample).t < t) j++;
    const p = pts[j] as { t: number; value: number };
    const q = pts[j + 1] as { t: number; value: number };
    const f = q.t === p.t ? 0 : (t - p.t) / (q.t - p.t);
    resampled.push(p.value + Math.min(1, Math.max(0, f)) * (q.value - p.value));
  }
  if (resampled.length < cfg.minSamples) return null;

  const speed: number[] = [];
  for (let i = 1; i < resampled.length; i++) {
    speed.push(Math.abs((resampled[i] as number) - (resampled[i - 1] as number)) * cfg.resampleHz);
  }
  const smooth = speed.map((_, i) => {
    const win = speed.slice(Math.max(0, i - 1), Math.min(speed.length, i + 2));
    return win.reduce((s, v) => s + v, 0) / win.length;
  });
  const maxSpeed = Math.max(...smooth);
  if (!(maxSpeed > 0)) return null;

  const candidates: number[] = [];
  for (let i = 0; i < smooth.length; i++) {
    const v = smooth[i] as number;
    const left = i === 0 ? -Infinity : (smooth[i - 1] as number);
    const right = i === smooth.length - 1 ? -Infinity : (smooth[i + 1] as number);
    if (v >= cfg.minPeakFraction * maxSpeed && v >= left && v > right) candidates.push(i);
  }
  let count = 0;
  let lastPeak: number | null = null;
  for (const idx of candidates) {
    if (lastPeak === null) {
      count++;
      lastPeak = idx;
      continue;
    }
    const between = smooth.slice(lastPeak, idx + 1);
    const valley = Math.min(...between);
    const smaller = Math.min(smooth[lastPeak] as number, smooth[idx] as number);
    if (valley < cfg.valleyFraction * smaller) {
      count++;
      lastPeak = idx;
    } else if ((smooth[idx] as number) > (smooth[lastPeak] as number)) {
      lastPeak = idx;
    }
  }
  return count;
}

/**
 * Checks one compensation rule over a repetition's samples. The rule's
 * measure (trunk angle) is compared with its value at the start of the
 * repetition, so a slightly tilted camera does not trigger it. Only reliable
 * samples are used; if too few are available the rule is not evaluated.
 */
export function detectCompensation(rule: CompensationRule, samples: SegmenterSample[]): boolean {
  const usable = samples.filter((s) => s.state === 'reliable' && s.trunk !== null);
  if (usable.length < rule.minFrames + 2) return false;
  const baseline = median(usable.slice(0, 3).map((s) => s.trunk as number));
  if (baseline === null) return false;
  let run = 0;
  for (const s of usable) {
    if (Math.abs((s.trunk as number) - baseline) > rule.thresholdDeg) {
      run++;
      if (run >= rule.minFrames) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

export function targetMet(peak: number, target: TargetRange | null): boolean | null {
  if (!target) return null;
  return peak >= target.min && peak <= target.max;
}

/** Builds a stored repetition record from a segmented repetition. */
export function buildRepetition(
  raw: RawRep,
  def: ExerciseDefinition,
  opts: { index: number; setIndex: number; target: TargetRange | null; sessionStart: number; checks: RepCheck[] },
): Repetition {
  const timing = repTiming(raw, def.segmentation.holdTolerance);
  const total = raw.samples.length;
  const reliable = raw.samples.filter((s) => s.state === 'reliable').length;
  const reliableFraction = total === 0 ? 0 : reliable / total;
  const validity = reliableFraction >= def.segmentation.minReliableFraction ? 'reliable' : 'uncertain';
  const flags = new Set<QualityFlag>();
  raw.samples.forEach((s) => s.flags.forEach((f) => flags.add(f)));
  const compensation =
    validity === 'reliable' ? def.compensationRules.filter((r) => detectCompensation(r, raw.samples)).map((r) => r.id) : [];

  return {
    index: opts.index,
    setIndex: opts.setIndex,
    startedAt: raw.startedAt - opts.sessionStart,
    endedAt: raw.endedAt - opts.sessionStart,
    durationMs: raw.endedAt - raw.startedAt,
    outboundMs: timing.outboundMs,
    holdMs: timing.holdMs,
    returnMs: timing.returnMs,
    startValue: round1(raw.startValue),
    peakValue: round1(raw.peakValue),
    range: round1(raw.peakValue - raw.startValue),
    targetMet: targetMet(raw.peakValue, opts.target),
    validity,
    reliableFraction: Math.round(reliableFraction * 1000) / 1000,
    speedPeaks: validity === 'reliable' ? countSpeedPeaks(raw.samples) : null,
    compensation,
    qualityFlags: [...flags],
    checks: validity === 'reliable' ? opts.checks : opts.checks.map((c) => ({ ...c, result: 'unknown' as const })),
    method: dominantMethod(raw.samples),
  };
}

/** The method used on most measured samples of a repetition (2D when none is recorded). */
export function dominantMethod(samples: SegmenterSample[]): MeasurementMethod {
  const counts = new Map<MeasurementMethod, number>();
  for (const s of samples) if (s.value !== null) counts.set(s.method ?? '2d', (counts.get(s.method ?? '2d') ?? 0) + 1);
  let best: MeasurementMethod = '2d';
  let n = 0;
  counts.forEach((c, m) => {
    if (c > n) [best, n] = [m, c];
  });
  return best;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Summarizes a session into its Movement Fingerprint. Only reliable
 * repetitions contribute to measurements; uncertain ones are counted as
 * excluded with an explanation. The fingerprint is marked valid only when at
 * least `minValidRepsForSession` reliable repetitions exist.
 */
export function buildFingerprint(reps: Repetition[]): MovementFingerprint {
  const valid = reps.filter((r) => r.validity === 'reliable');
  const excluded = reps.length - valid.length;
  const notes: string[] = [];
  if (excluded > 0) {
    notes.push(`${excluded} repetition${excluded === 1 ? ' was' : 's were'} excluded from measurements because tracking was uncertain.`);
  }
  const consistencyOk = valid.length >= ANALYSIS_CONFIG.consistencyMinReps;
  if (valid.length > 0 && !consistencyOk) {
    notes.push(`Rep-to-rep variation needs at least ${ANALYSIS_CONFIG.consistencyMinReps} reliable repetitions.`);
  }

  const rests: number[] = [];
  for (let i = 1; i < valid.length; i++) {
    const prev = valid[i - 1] as Repetition;
    const cur = valid[i] as Repetition;
    if (prev.setIndex === cur.setIndex) rests.push(cur.startedAt - prev.endedAt);
  }

  const compensationCounts: Record<string, number> = {};
  valid.forEach((r) => r.compensation.forEach((c) => (compensationCounts[c] = (compensationCounts[c] ?? 0) + 1)));
  const speedPeaks = valid.map((r) => r.speedPeaks).filter((v): v is number => v !== null);

  const isValid = valid.length >= ANALYSIS_CONFIG.minValidRepsForSession;
  if (!isValid) {
    notes.push(
      `Fewer than ${ANALYSIS_CONFIG.minValidRepsForSession} reliable repetitions, so this session is not used for progress trends.`,
    );
  }

  return {
    valid: isValid,
    validReps: valid.length,
    excludedReps: excluded,
    peakMedian: roundOrNull(median(valid.map((r) => r.peakValue))),
    peakMax: valid.length ? Math.max(...valid.map((r) => r.peakValue)) : null,
    startMedian: roundOrNull(median(valid.map((r) => r.startValue))),
    rangeMedian: roundOrNull(median(valid.map((r) => r.range))),
    durationMedianMs: roundOrNull(median(valid.map((r) => r.durationMs))),
    outboundMedianMs: roundOrNull(median(valid.map((r) => r.outboundMs))),
    returnMedianMs: roundOrNull(median(valid.map((r) => r.returnMs))),
    holdMedianMs: roundOrNull(median(valid.map((r) => r.holdMs))),
    speedPeaksMedian: median(speedPeaks),
    peakCv: consistencyOk ? roundOrNull(coefficientOfVariation(valid.map((r) => r.peakValue))) : null,
    durationCv: consistencyOk ? roundOrNull(coefficientOfVariation(valid.map((r) => r.durationMs))) : null,
    restMedianMs: roundOrNull(median(rests)),
    compensationCounts,
    targetMetCount: valid.filter((r) => r.targetMet === true).length,
    notes,
  };
}

function roundOrNull(v: number | null): number | null {
  return v === null ? null : Math.round(v * 10) / 10;
}
