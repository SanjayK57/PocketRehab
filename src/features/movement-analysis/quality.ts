import type { PoseFrame, Point2 } from '@/types/pose';
import type { ExerciseDefinition } from '@/types/exercise';
import type { BodySide, QualityFlag, ValidityState } from '@/lib/validation/schemas';
import { ANALYSIS_CONFIG } from './config';
import { angleAt, estimateBodyView, toPixel, torsoScale, trunkAngleFromVertical, type BodyView } from './geometry';

/** One frame's measurement for the exercise's joint metric plus its quality metadata. */
export interface MetricSample {
  t: number;
  /** Measured value in degrees after the exercise transform; null when it could not be measured. */
  value: number | null;
  state: ValidityState;
  flags: QualityFlag[];
  /** Lowest visibility among the metric's three landmarks, when available. */
  minVisibility: number | null;
  /** Pixel positions of the metric's landmarks (for the AR overlay), when available. */
  points: { a: Point2; b: Point2; c: Point2 } | null;
  /** Trunk angle from vertical (for compensation checks), when measurable. */
  trunk: number | null;
  view: BodyView;
  /** Torso length / frame height, when measurable. */
  scale: number | null;
}

export function metricLandmarks(def: ExerciseDefinition, side: BodySide) {
  return def.metric.landmarks[side];
}

/** Applies the exercise's transform to an interior angle. */
export function transformAngle(def: ExerciseDefinition, interior: number): number {
  return def.metric.transform === 'supplement' ? 180 - interior : interior;
}

/** Inverse of transformAngle: displayed value → interior angle (used to draw AR guides). */
export function interiorFromValue(def: ExerciseDefinition, value: number): number {
  return def.metric.transform === 'supplement' ? 180 - value : value;
}

function unavailable(t: number, flags: QualityFlag[], extra: Partial<MetricSample> = {}): MetricSample {
  return { t, value: null, state: 'unavailable', flags, minVisibility: null, points: null, trunk: null, view: 'unknown', scale: null, ...extra };
}

/**
 * Evaluates a single pose frame for an exercise: computes the joint metric and
 * classifies the frame as reliable, uncertain or unavailable using predefined
 * checks (landmark presence, visibility, frame bounds, camera view). The
 * visibility values are tracking-quality estimates, not calibrated probabilities.
 */
export function evaluateFrame(frame: PoseFrame, def: ExerciseDefinition, side: BodySide): MetricSample {
  const t = frame.timestamp;
  if (frame.status === 'error') return unavailable(t, ['inference-error']);
  const lms = frame.landmarks;
  if (frame.status === 'no-pose' || !lms) return unavailable(t, ['no-pose']);

  const { a, b, c } = metricLandmarks(def, side);
  const la = lms[a];
  const lb = lms[b];
  const lc = lms[c];
  if (!la || !lb || !lc || ![la.x, la.y, lb.x, lb.y, lc.x, lc.y].every(Number.isFinite)) {
    return unavailable(t, ['landmark-missing']);
  }

  const w = frame.imageWidth;
  const h = frame.imageHeight;
  const minVisibility = Math.min(la.visibility, lb.visibility, lc.visibility);
  const points = { a: toPixel(la, w, h), b: toPixel(lb, w, h), c: toPixel(lc, w, h) };
  const { view } = estimateBodyView(lms, w, h);
  const trunk = trunkAngleFromVertical(lms, w, h);
  const scale = torsoScale(lms, w, h);
  const context = { minVisibility, points, trunk, view, scale };

  if (minVisibility < ANALYSIS_CONFIG.visibilityUsable) return unavailable(t, ['low-visibility'], context);

  const outside = [la, lb, lc].some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1);
  if (outside) return unavailable(t, ['out-of-frame'], context);

  const angle = angleAt(points.a, points.b, points.c);
  if (!angle.ok) return unavailable(t, ['landmark-missing'], context);

  const flags: QualityFlag[] = [];
  if (minVisibility < ANALYSIS_CONFIG.visibilityReliable) flags.push('low-visibility');
  const m = ANALYSIS_CONFIG.edgeMargin;
  if ([la, lb, lc].some((p) => p.x < m || p.x > 1 - m || p.y < m || p.y > 1 - m)) flags.push('near-edge');
  if ((def.cameraView === 'front' && view === 'side') || (def.cameraView === 'side' && view === 'front')) {
    flags.push('view-mismatch');
  }

  return {
    t,
    value: transformAngle(def, angle.degrees),
    state: flags.length === 0 ? 'reliable' : 'uncertain',
    flags,
    ...context,
  };
}

/** Tracks the live tracking-quality state over a short rolling window. */
export class LiveQualityWindow {
  private entries: Array<{ t: number; state: ValidityState }> = [];

  constructor(private windowMs: number = ANALYSIS_CONFIG.liveQualityWindowMs) {}

  push(t: number, state: ValidityState): void {
    this.entries.push({ t, state });
    this.prune(t);
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.entries.length > 0 && (this.entries[0] as { t: number }).t < cutoff) this.entries.shift();
  }

  state(now: number): ValidityState {
    this.prune(now);
    if (this.entries.length === 0) return 'unavailable';
    const n = this.entries.length;
    const reliable = this.entries.filter((e) => e.state === 'reliable').length / n;
    const usable = this.entries.filter((e) => e.state !== 'unavailable').length / n;
    if (reliable >= ANALYSIS_CONFIG.liveReliableFraction) return 'reliable';
    if (usable >= ANALYSIS_CONFIG.liveUsableFraction) return 'uncertain';
    return 'unavailable';
  }

  reset(): void {
    this.entries = [];
  }
}
