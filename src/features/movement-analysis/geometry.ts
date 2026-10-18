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
  const use3d = [a.z, b.z, c.z].every((z) => typeof z === 'number' && Number.isFinite(z));
  const d = [
    a.x - b.x,
    a.y - b.y,
    use3d ? (a.z as number) - (b.z as number) : 0,
    c.x - b.x,
    c.y - b.y,
    use3d ? (c.z as number) - (b.z as number) : 0,
  ];
  // Also rejects NaN inputs and differences of huge coordinates that overflow to Infinity.
  if (!d.every(Number.isFinite)) return { ok: false, reason: 'non-finite' };
  // Divide by the largest component first so squaring huge (finite) values cannot overflow.
  const s = Math.max(...d.map(Math.abs));
  if (!(s > 0)) return { ok: false, reason: 'zero-length' };
  const [bax, bay, baz, bcx, bcy, bcz] = d.map((v) => v / s) as [number, number, number, number, number, number];
  const magBA = Math.hypot(bax, bay, baz);
  const magBC = Math.hypot(bcx, bcy, bcz);
  if (magBA * s < epsilon || magBC * s < epsilon) return { ok: false, reason: 'zero-length' };

  const cos = (bax * bcx + bay * bcy + baz * bcz) / (magBA * magBC);
  const degrees = Math.acos(Math.min(1, Math.max(-1, cos))) * RAD_TO_DEG;
  return Number.isFinite(degrees) ? { ok: true, degrees } : { ok: false, reason: 'non-finite' };
}

/**
 * How much a landmark can be trusted, 0..1: the lower of the model's
 * visibility and presence (when given). Missing or non-numeric values count
 * as 0, so a NaN can never pass a "reliable" comparison.
 */
export function visibilityOf(lm: { visibility?: unknown; presence?: unknown } | null | undefined): number {
  if (!lm) return 0;
  const vis = typeof lm.visibility === 'number' && Number.isFinite(lm.visibility) ? lm.visibility : 0;
  const pres = lm.presence === undefined ? 1 : typeof lm.presence === 'number' && Number.isFinite(lm.presence) ? lm.presence : 0;
  return Math.min(1, Math.max(0, Math.min(vis, pres)));
}

/** True when a frame size can turn normalized coordinates into pixels. */
export function validFrameSize(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width >= 1 && height >= 1;
}

const finiteOrNull = (v: number): number | null => (Number.isFinite(v) ? v : null);

/** A 3D vector (metres for world landmarks). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add3 = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub3 = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale3 = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross3 = (a: Vec3, b: Vec3): Vec3 => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const norm3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const mid3 = (a: Vec3, b: Vec3): Vec3 => scale3(add3(a, b), 0.5);

/** Unit vector, or null when the input is (near) zero length or not finite. */
export function unit3(a: Vec3): Vec3 | null {
  const n = norm3(a);
  return Number.isFinite(n) && n > 1e-9 ? scale3(a, 1 / n) : null;
}

/** Rotates `p` about the unit axis `k` by `rad` radians (Rodrigues' formula). */
export function rotate3(p: Vec3, k: Vec3, rad: number): Vec3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return add3(add3(scale3(p, c), scale3(cross3(k, p), s)), scale3(k, dot3(k, p) * (1 - c)));
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

export function isUsable(lm: Landmark | undefined, minVisibility: number): lm is Landmark {
  return !!lm && Number.isFinite(lm.x) && Number.isFinite(lm.y) && visibilityOf(lm) >= minVisibility;
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
  if (!validFrameSize(width, height)) return null;
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
  if (!(Math.hypot(dx, dy) >= 1e-6)) return null;
  return finiteOrNull(Math.atan2(dx, dy) * RAD_TO_DEG);
}

export type BodyView = 'front' | 'side' | 'angled' | 'unknown';

/**
 * Heuristic estimate of whether the person faces the camera or stands side-on,
 * from the ratio of shoulder width to torso length in the image. A software
 * heuristic only; thresholds are in ANALYSIS_CONFIG.view.
 */
export function estimateBodyView(landmarks: Landmark[], width: number, height: number): { view: BodyView; ratio: number | null } {
  const min = ANALYSIS_CONFIG.visibilityUsable;
  if (!validFrameSize(width, height)) return { view: 'unknown', ratio: null };
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
  const ratio = distance(lsP, rsP) / torso;
  if (!(torso >= 1e-6) || !Number.isFinite(ratio)) return { view: 'unknown', ratio: null };
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
  if (lengths.length === 0 || !validFrameSize(width, height)) return null;
  return finiteOrNull(Math.max(...lengths) / height);
}
