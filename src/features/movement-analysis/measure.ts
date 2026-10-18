import { LM, type Landmark, type Point2, type WorldLandmark } from '@/types/pose';
import type { MeasurementMethod } from '@/types/form';
import type { BodySide } from '@/lib/validation/schemas';
import { ANALYSIS_CONFIG } from './config';
import { add3, angleAt, cross3, dot3, isUsable, mid3, norm3, scale3, sub3, toPixel, unit3, v3, visibilityOf, type Vec3 } from './geometry';

/**
 * Rotation-robust joint measurement. A camera image only shows a projection,
 * so a limb that turns toward the camera reads wrong in 2D. When the model
 * also supplies metric world landmarks, each measurement blends the image
 * angle with a 3D estimate, weighted by how far the movement plane has turned
 * away from the camera. The weight changes smoothly (no jump at a threshold),
 * and without world landmarks everything falls back to the 2D image angle.
 * Evidence for each choice is in docs/EVALUATION.md (section 2).
 */

const DEG = 180 / Math.PI;

/**
 * Where each blend ramps from 0 to 1 (chosen on synthetic rotated skeletons,
 * docs/EVALUATION.md section 2). Planarity is the sine of the joint angle:
 * below it the limb is too straight for its plane to be known.
 */
export const BLEND = {
  obliquityDeg: [15, 35] as [number, number],
  planarity: [0.15, 0.35] as [number, number],
  yawDeg: [10, 30] as [number, number],
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Hermite smoothstep: 0 below e0, 1 above e1, smooth in between. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** One pose frame prepared for measurement. */
export interface FrameView {
  lms: Landmark[];
  /** World landmarks when present, complete and the same length as `lms`. */
  world: WorldLandmark[] | null;
  w: number;
  h: number;
}

export function frameView(lms: Landmark[], world: WorldLandmark[] | null | undefined, w: number, h: number): FrameView {
  return { lms, world: world && world.length === lms.length ? world : null, w, h };
}

/** Pixel position of a landmark at or above the visibility floor. */
export function pixel(v: FrameView, i: number, min: number = ANALYSIS_CONFIG.visibilityReliable): Point2 | null {
  const lm = v.lms[i];
  return isUsable(lm, min) ? toPixel(lm, v.w, v.h) : null;
}

/** World position (metres) of a landmark whose image detection is reliable. */
export function worldAt(v: FrameView, i: number, min: number = ANALYSIS_CONFIG.visibilityReliable): Vec3 | null {
  const p = v.world?.[i];
  if (!p || visibilityOf(v.lms[i]) < min) return null;
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) ? v3(p.x, p.y, p.z) : null;
}

/** Metres per image pixel, from torso segments seen in both spaces (weak perspective). */
export function metresPerPixel(v: FrameView): number | null {
  let metres = 0;
  let pixels = 0;
  for (const [i, j] of [
    [LM.leftShoulder, LM.leftHip],
    [LM.rightShoulder, LM.rightHip],
    [LM.leftShoulder, LM.rightShoulder],
    [LM.leftHip, LM.rightHip],
  ] as const) {
    const pi = pixel(v, i);
    const pj = pixel(v, j);
    const wi = worldAt(v, i);
    const wj = worldAt(v, j);
    if (!pi || !pj || !wi || !wj) continue;
    metres += Math.hypot(wi.x - wj.x, wi.y - wj.y);
    pixels += Math.hypot(pi.x - pj.x, pi.y - pj.y);
  }
  const s = metres / pixels;
  return pixels > 20 && Number.isFinite(s) && s > 0 ? s : null;
}

export interface BodyFrame {
  /** Up the trunk (hip midpoint → shoulder midpoint). */
  up: Vec3;
  /** Toward the person's left, orthogonal to `up`. */
  left: Vec3;
  /** Out of the person's chest. */
  forward: Vec3;
  /** Body turn away from facing the camera, 0..90°. */
  yawDeg: number;
}

/** Trunk-fixed axes from world landmarks; null unless all four torso corners are reliable. */
export function bodyFrame(v: FrameView): BodyFrame | null {
  const ls = worldAt(v, LM.leftShoulder);
  const rs = worldAt(v, LM.rightShoulder);
  const lh = worldAt(v, LM.leftHip);
  const rh = worldAt(v, LM.rightHip);
  if (!ls || !rs || !lh || !rh) return null;
  const up = unit3(sub3(mid3(ls, rs), mid3(lh, rh)));
  if (!up) return null;
  const lateral = add3(sub3(ls, rs), sub3(lh, rh));
  const left = unit3(sub3(lateral, scale3(up, dot3(lateral, up))));
  if (!left) return null;
  const yawDeg = Math.atan2(Math.abs(left.z), Math.abs(left.x)) * DEG;
  return { up, left, forward: cross3(left, up), yawDeg };
}

export interface Measured {
  degrees: number;
  method: MeasurementMethod;
  /** Share of the 3D estimate in the value (0 = pure image angle). */
  weight3d: number;
}

/**
 * Interior angle at `b` (degrees). The image angle is exact while the limb's
 * plane faces the camera; as the plane turns away (obliquity from the world
 * landmarks' plane normal, 15° → 35°) the value blends toward a hybrid angle
 * that keeps the precise image x/y (scaled to metres) and adds world depth.
 * A nearly straight limb has no defined plane and stays 2D, where it is exact anyway.
 */
export function jointAngle(v: FrameView, a: number, b: number, c: number, min: number = ANALYSIS_CONFIG.visibilityUsable): Measured | null {
  const pa = pixel(v, a, min);
  const pb = pixel(v, b, min);
  const pc = pixel(v, c, min);
  const flat = angleAt(pa, pb, pc);
  if (!flat.ok || !pa || !pb || !pc) return null;

  const wa = worldAt(v, a);
  const wb = worldAt(v, b);
  const wc = worldAt(v, c);
  const s = wa && wb && wc ? metresPerPixel(v) : null;
  if (!wa || !wb || !wc || s === null) return { degrees: flat.degrees, method: '2d', weight3d: 0 };

  const u = sub3(wa, wb);
  const q = sub3(wc, wb);
  const n = cross3(u, q);
  const nn = norm3(n);
  const sinInterior = nn / (norm3(u) * norm3(q));
  if (!(nn > 0) || !Number.isFinite(sinInterior)) return { degrees: flat.degrees, method: '2d', weight3d: 0 };
  const obliquity = Math.acos(Math.min(1, Math.abs(n.z) / nn)) * DEG;
  let w = smoothstep(BLEND.obliquityDeg[0], BLEND.obliquityDeg[1], obliquity) * smoothstep(BLEND.planarity[0], BLEND.planarity[1], sinInterior);
  if (w < 1e-3) return { degrees: flat.degrees, method: '2d', weight3d: 0 };

  const lift = (p: Point2, z: number): Vec3 => v3(p.x * s, p.y * s, z);
  const hybrid = angleAt(lift(pa, wa.z), lift(pb, wb.z), lift(pc, wc.z));
  if (!hybrid.ok) w = 0;
  const degrees = hybrid.ok ? (1 - w) * flat.degrees + w * hybrid.degrees : flat.degrees;
  return { degrees, method: w < 0.05 ? '2d' : 'hybrid', weight3d: w };
}

export interface Elevation extends Measured {
  /**
   * Plane of elevation from world landmarks: 0° = straight out to the side,
   * 90° = straight in front. Null without world landmarks or with the segment near the trunk.
   */
  planeDeg: number | null;
  /** Pixel point one trunk length "below" `b` along the trunk axis, for drawing the reference line. */
  reference: Point2;
}

/**
 * Elevation of segment b→c from the trunk's downward axis (shoulder flexion or
 * abduction, hip abduction...). In the image the reference is the hip-midpoint
 * → shoulder-midpoint line, which removes the bias of using the inboard hip on
 * the same side. With reliable world landmarks the value blends (body yaw
 * 10° → 30°) toward the same angle measured in a trunk-fixed 3D frame, which
 * does not change when the person turns.
 */
export function elevationAngle(
  v: FrameView,
  a: number,
  b: number,
  c: number,
  side: BodySide,
  min: number = ANALYSIS_CONFIG.visibilityUsable,
): Elevation | null {
  const pb = pixel(v, b, min);
  const pc = pixel(v, c, min);
  if (!pb || !pc) return null;
  const torso = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip].map((i) => pixel(v, i));
  const [ls, rs, lh, rh] = torso;
  let down: Point2 | null = null;
  if (ls && rs && lh && rh) {
    down = { x: (lh.x + rh.x - ls.x - rs.x) / 2, y: (lh.y + rh.y - ls.y - rs.y) / 2 };
  } else {
    const pa = pixel(v, a, min);
    if (pa) down = { x: pa.x - pb.x, y: pa.y - pb.y };
  }
  if (!down) return null;
  const reference = { x: pb.x + down.x, y: pb.y + down.y };
  const flat = angleAt(reference, pb, pc);
  if (!flat.ok) return null;

  const frame = bodyFrame(v);
  const wb = worldAt(v, b);
  const wc = worldAt(v, c);
  if (!frame || !wb || !wc) return { degrees: flat.degrees, method: '2d', weight3d: 0, planeDeg: null, reference };
  const seg = sub3(wc, wb);
  const body = angleAt(scale3(frame.up, -1), v3(0, 0, 0), seg);
  if (!body.ok) return { degrees: flat.degrees, method: '2d', weight3d: 0, planeDeg: null, reference };
  const outward = side === 'left' ? frame.left : scale3(frame.left, -1);
  const planeDeg = body.degrees >= 20 ? Math.atan2(dot3(seg, frame.forward), dot3(seg, outward)) * DEG : null;
  const w = smoothstep(BLEND.yawDeg[0], BLEND.yawDeg[1], frame.yawDeg);
  const degrees = (1 - w) * flat.degrees + w * body.degrees;
  return { degrees, method: w < 0.05 ? '2d' : w > 0.95 ? '3d-body-frame' : 'hybrid', weight3d: w, planeDeg, reference };
}

/** Image-only interior angle at `b` (the pre-blending method; kept for the evaluation's comparison). */
export function imageAngle(v: FrameView, a: number, b: number, c: number, min: number = ANALYSIS_CONFIG.visibilityUsable): number | null {
  const r = angleAt(pixel(v, a, min), pixel(v, b, min), pixel(v, c, min));
  return r.ok ? r.degrees : null;
}
