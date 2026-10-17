import type { Landmark, Point2 } from '@/types/pose';
import { LM } from '@/types/pose';
import { ANALYSIS_CONFIG } from './config';

export interface Vec {
  x: number;
  y: number;
  z?: number;
}

export type AngleResult =
  | { ok: true; degrees: number }
  | { ok: false; reason: 'missing-point' | 'non-finite' | 'zero-length' };

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Angle at vertex B formed by points A–B–C, in degrees (0..180).
 *
 * Uses cos θ = (BA · BC) / (|BA| |BC|). The cosine is clamped to [-1, 1]
 * before acos so floating-point error can never produce NaN. If all three
 * points carry a finite `z`, the angle is computed in 3D; otherwise in 2D.
 *
 * Returns an explicit failure instead of a number when a point is missing,
 * non-finite, or a segment has (near) zero length. It never substitutes 0°.
 *
 * Note: a 2D angle measured in a camera image is a projection. It can differ
 * from the true anatomical angle because of perspective, body rotation and depth.
 */
export function angleAt(a: Vec | null | undefined, b: Vec | null | undefined, c: Vec | null | undefined, epsilon = 1e-6): AngleResult {
  if (!a || !b || !c) return { ok: false, reason: 'missing-point' };
  const coords = [a.x, a.y, b.x, b.y, c.x, c.y];
  if (!coords.every(Number.isFinite)) return { ok: false, reason: 'non-finite' };
  const use3d = [a.z, b.z, c.z].every((z) => typeof z === 'number' && Number.isFinite(z));

  const bax = a.x - b.x;
  const bay = a.y - b.y;
  const baz = use3d ? (a.z as number) - (b.z as number) : 0;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const bcz = use3d ? (c.z as number) - (b.z as number) : 0;

  const magBA = Math.hypot(bax, bay, baz);
  const magBC = Math.hypot(bcx, bcy, bcz);
  if (magBA < epsilon || magBC < epsilon) return { ok: false, reason: 'zero-length' };

  const cos = (bax * bcx + bay * bcy + baz * bcz) / (magBA * magBC);
  const clamped = Math.min(1, Math.max(-1, cos));
  return { ok: true, degrees: Math.acos(clamped) * RAD_TO_DEG };
}

/** Converts a normalized landmark to pixel space so x and y share the same scale. */
export function toPixel(lm: Pick<Landmark, 'x' | 'y'>, width: number, height: number): Point2 {
  return { x: lm.x * width, y: lm.y * height };
}

export function midpoint(p: Point2, q: Point2): Point2 {
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
}

export function distance(p: Point2, q: Point2): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

function isUsable(lm: Landmark | undefined, minVisibility: number): lm is Landmark {
  return !!lm && Number.isFinite(lm.x) && Number.isFinite(lm.y) && lm.visibility >= minVisibility;
}

/**
 * Signed angle of the hip-midpoint → shoulder-midpoint line from image vertical,
 * in degrees. 0 = upright; positive = top of the torso toward image right.
 * Falls back to a single side when only one shoulder/hip pair is usable.
 */
export function trunkAngleFromVertical(
  landmarks: Landmark[],
  width: number,
  height: number,
  minVisibility: number = ANALYSIS_CONFIG.visibilityReliable,
): number | null {
  const ls = landmarks[LM.leftShoulder];
  const rs = landmarks[LM.rightShoulder];
  const lh = landmarks[LM.leftHip];
  const rh = landmarks[LM.rightHip];
  let shoulder: Point2 | null = null;
  let hip: Point2 | null = null;
  if (isUsable(ls, minVisibility) && isUsable(rs, minVisibility) && isUsable(lh, minVisibility) && isUsable(rh, minVisibility)) {
    shoulder = midpoint(toPixel(ls, width, height), toPixel(rs, width, height));
    hip = midpoint(toPixel(lh, width, height), toPixel(rh, width, height));
  } else if (isUsable(ls, minVisibility) && isUsable(lh, minVisibility)) {
    shoulder = toPixel(ls, width, height);
    hip = toPixel(lh, width, height);
  } else if (isUsable(rs, minVisibility) && isUsable(rh, minVisibility)) {
    shoulder = toPixel(rs, width, height);
    hip = toPixel(rh, width, height);
  }
  if (!shoulder || !hip) return null;
  const dx = shoulder.x - hip.x;
  const dy = hip.y - shoulder.y; // image y grows downward
  if (Math.hypot(dx, dy) < 1e-6) return null;
  return Math.atan2(dx, dy) * RAD_TO_DEG;
}

export type BodyView = 'front' | 'side' | 'angled' | 'unknown';

/**
 * Heuristic estimate of whether the person faces the camera or stands side-on,
 * from the ratio of shoulder width to torso length in the image. A software
 * heuristic only; thresholds are in ANALYSIS_CONFIG.view.
 */
export function estimateBodyView(landmarks: Landmark[], width: number, height: number): { view: BodyView; ratio: number | null } {
  const min = ANALYSIS_CONFIG.visibilityUsable;
  const ls = landmarks[LM.leftShoulder];
  const rs = landmarks[LM.rightShoulder];
  const lh = landmarks[LM.leftHip];
  const rh = landmarks[LM.rightHip];
  if (!isUsable(ls, min) || !isUsable(rs, min) || !isUsable(lh, min) || !isUsable(rh, min)) {
    return { view: 'unknown', ratio: null };
  }
  const lsP = toPixel(ls, width, height);
  const rsP = toPixel(rs, width, height);
  const torso = distance(midpoint(lsP, rsP), midpoint(toPixel(lh, width, height), toPixel(rh, width, height)));
  if (torso < 1e-6) return { view: 'unknown', ratio: null };
  const ratio = distance(lsP, rsP) / torso;
  const { frontMinRatio, sideMaxRatio } = ANALYSIS_CONFIG.view;
  const view: BodyView = ratio >= frontMinRatio ? 'front' : ratio <= sideMaxRatio ? 'side' : 'angled';
  return { view, ratio };
}

/** Torso length as a fraction of frame height: a rough proxy for distance from the camera. */
export function torsoScale(landmarks: Landmark[], width: number, height: number): number | null {
  const min = ANALYSIS_CONFIG.visibilityReliable;
  const pairs: Array<[number, number]> = [
    [LM.leftShoulder, LM.leftHip],
    [LM.rightShoulder, LM.rightHip],
  ];
  const lengths = pairs
    .map(([s, h]) => {
      const sl = landmarks[s];
      const hl = landmarks[h];
      return isUsable(sl, min) && isUsable(hl, min) ? distance(toPixel(sl, width, height), toPixel(hl, width, height)) : null;
    })
    .filter((v): v is number => v !== null);
  if (lengths.length === 0 || height <= 0) return null;
  return Math.max(...lengths) / height;
}
