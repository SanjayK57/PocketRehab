import type { PoseFrame, Point2 } from '@/types/pose';
import type { ExerciseDefinition } from '@/types/exercise';
import type { BodySide, QualityFlag, ValidityState } from '@/lib/validation/schemas';
import type { MeasurementMethod } from '@/types/form';
import { ANALYSIS_CONFIG } from './config';
import { estimateBodyView, toPixel, torsoScale, trunkAngleFromVertical, validFrameSize, visibilityOf, type BodyView } from './geometry';
import { elevationAngle, frameView, jointAngle } from './measure';

/** One frame's measurement for the exercise's joint metric plus its quality metadata. */
export interface MetricSample {
  t: number;
  /** Measured value in degrees after the exercise transform; null when it could not be measured. */
  value: number | null;
  state: ValidityState;
  flags: QualityFlag[];
  /** Lowest visibility (min of visibility and presence) among the metric's three landmarks, when available. */
  minVisibility: number | null;
  /**
   * Pixel positions of the metric's landmarks (for the AR overlay), when available.
   * For an elevation metric `a` is a point on the trunk axis below `b`, so the
   * angle a–b–c drawn in the image is the angle that was measured (in 2D).
   */
  points: { a: Point2; b: Point2; c: Point2 } | null;
  /** How the value was measured on this frame ('none' when it was not). */
  method: MeasurementMethod;
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

export function unavailable(t: number, flags: QualityFlag[], extra: Partial<MetricSample> = {}): MetricSample {
  return { t, value: null, state: 'unavailable', flags, minVisibility: null, points: null, method: 'none', trunk: null, view: 'unknown', scale: null, ...extra };
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
  const w = frame.imageWidth;
  const h = frame.imageHeight;
  // Without a real frame size, normalized coordinates cannot become pixels, so nothing can be measured.
  if (!validFrameSize(w, h)) return unavailable(t, ['inference-error']);

  const { a, b, c } = metricLandmarks(def, side);
  const la = lms[a];
  const lb = lms[b];
  const lc = lms[c];
  if (!la || !lb || !lc || ![la.x, la.y, lb.x, lb.y, lc.x, lc.y].every(Number.isFinite)) {
    return unavailable(t, ['landmark-missing']);
  }

  const minVisibility = Math.min(visibilityOf(la), visibilityOf(lb), visibilityOf(lc));
  const raw = { a: toPixel(la, w, h), b: toPixel(lb, w, h), c: toPixel(lc, w, h) };
  const { view } = estimateBodyView(lms, w, h);
  const trunk = trunkAngleFromVertical(lms, w, h);
  const scale = torsoScale(lms, w, h);
  const context = { minVisibility, points: raw, trunk, view, scale };

  if (minVisibility < ANALYSIS_CONFIG.visibilityUsable) return unavailable(t, ['low-visibility'], context);

  const outside = [la, lb, lc].some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1);
  if (outside) return unavailable(t, ['out-of-frame'], context);

  const fv = frameView(lms, frame.world, w, h);
  let measured: { degrees: number; method: MeasurementMethod } | null;
  let points = raw;
  if (def.metric.kind === 'elevation') {
    const e = elevationAngle(fv, a, b, c, side);
    measured = e;
    if (e) points = { ...raw, a: e.reference };
  } else {
    measured = jointAngle(fv, a, b, c);
  }
  if (!measured) return unavailable(t, ['landmark-missing'], context);

  const flags: QualityFlag[] = [];
  if (minVisibility < ANALYSIS_CONFIG.visibilityReliable) flags.push('low-visibility');
  const m = ANALYSIS_CONFIG.edgeMargin;
  if ([la, lb, lc].some((p) => p.x < m || p.x > 1 - m || p.y < m || p.y > 1 - m)) flags.push('near-edge');
  if ((def.cameraView === 'front' && view === 'side') || (def.cameraView === 'side' && view === 'front')) {
    flags.push('view-mismatch');
  }

  const value = transformAngle(def, measured.degrees);
  if (!Number.isFinite(value)) return unavailable(t, ['landmark-missing'], context);
  return {
    t,
    value,
    state: flags.length === 0 ? 'reliable' : 'uncertain',
    flags,
    ...context,
    points,
    method: measured.method,
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
