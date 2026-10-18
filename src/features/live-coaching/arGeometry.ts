import type { Point2 } from '@/types/pose';
import type { ExerciseDefinition } from '@/types/exercise';
import { interiorFromValue } from '@/features/movement-analysis/quality';

/**
 * Geometry for the AR overlay. Given the live joint points (pixels) it works
 * out where the goniometer dial, target band and ghost guide limb sit on the
 * user's own body, rotating the reference segment by the measured angle toward
 * the side the moving segment is already on. Also: tapered capsule outlines
 * and collision-free label placement. Pure functions, no canvas state.
 */

const DEG = Math.PI / 180;

export interface JointGeometry {
  vertex: Point2;
  /** Unit vector from the vertex along the reference (non-moving) segment. */
  ref: Point2;
  /** Unit vector from the vertex along the moving segment. */
  moving: Point2;
  /** Length of the moving segment in pixels. */
  length: number;
  /** Length of the reference segment in pixels. */
  refLength: number;
  /** +1 or −1: which rotation direction takes ref toward the moving segment. */
  sign: 1 | -1;
}

function unit(v: Point2): Point2 | null {
  const m = Math.hypot(v.x, v.y);
  return m < 1e-6 || !Number.isFinite(m) ? null : { x: v.x / m, y: v.y / m };
}

export function rotate(v: Point2, rad: number): Point2 {
  return { x: v.x * Math.cos(rad) - v.y * Math.sin(rad), y: v.x * Math.sin(rad) + v.y * Math.cos(rad) };
}

/** Angle (radians) of a vector in canvas coordinates. */
export function heading(v: Point2): number {
  return Math.atan2(v.y, v.x);
}

export function jointGeometry(def: ExerciseDefinition, pts: { a: Point2; b: Point2; c: Point2 }, previousSign: 1 | -1 | null = null): JointGeometry | null {
  const movingPt = def.metric.moving === 'c' ? pts.c : pts.a;
  const refPt = def.metric.moving === 'c' ? pts.a : pts.c;
  const ref = unit({ x: refPt.x - pts.b.x, y: refPt.y - pts.b.y });
  const moving = unit({ x: movingPt.x - pts.b.x, y: movingPt.y - pts.b.y });
  if (!ref || !moving) return null;
  const cross = ref.x * moving.y - ref.y * moving.x;
  // Near collinear the cross product's sign is noise; keep the previous side.
  const sign: 1 | -1 = Math.abs(cross) < 0.05 && previousSign ? previousSign : cross >= 0 ? 1 : -1;
  return {
    vertex: pts.b,
    ref,
    moving,
    length: Math.hypot(movingPt.x - pts.b.x, movingPt.y - pts.b.y),
    refLength: Math.hypot(refPt.x - pts.b.x, refPt.y - pts.b.y),
    sign,
  };
}

/** Direction of the moving segment when the exercise metric equals `value`. */
export function directionForValue(def: ExerciseDefinition, g: JointGeometry, value: number): Point2 {
  return rotate(g.ref, g.sign * interiorFromValue(def, value) * DEG);
}

/** Canvas angle (radians) of the moving segment when the metric equals `value`. */
export function angleForValue(def: ExerciseDefinition, g: JointGeometry, value: number): number {
  return heading(directionForValue(def, g, value));
}

/** Endpoint of the ghost guide segment at `value`. */
export function ghostEndpoint(def: ExerciseDefinition, g: JointGeometry, value: number, lengthScale = 1): Point2 {
  const d = directionForValue(def, g, value);
  return { x: g.vertex.x + d.x * g.length * lengthScale, y: g.vertex.y + d.y * g.length * lengthScale };
}

/**
 * Canvas arc parameters between two metric values. The metric maps linearly to
 * a rotation, so the arc follows the metric (not the short way round), which
 * keeps a 0–180° dial drawn on the correct side of the joint.
 */
export function arcAngles(def: ExerciseDefinition, g: JointGeometry, fromValue: number, toValue: number): { start: number; end: number; anticlockwise: boolean } {
  const start = angleForValue(def, g, fromValue);
  // Rotation per metric degree in canvas radians (supplement metrics run the other way).
  const perDeg = g.sign * (def.metric.transform === 'supplement' ? -1 : 1) * DEG;
  const sweep = (toValue - fromValue) * perDeg;
  return { start, end: start + sweep, anticlockwise: sweep < 0 };
}

/** Value span the goniometer dial covers for an exercise: from below its neutral position to past its target, in tens. */
export function dialRange(def: ExerciseDefinition, target: { min: number; max: number } | null): { min: number; max: number } {
  const lo = Math.min(def.demo.neutral, target?.min ?? def.demo.neutral, def.segmentation.neutralMax) - 15;
  const hi = Math.max(def.demo.peak, target?.max ?? def.demo.peak) + 15;
  return { min: Math.max(0, Math.floor(lo / 10) * 10), max: Math.min(180, Math.ceil(hi / 10) * 10) };
}

/**
 * Outline of a tapered capsule: a circle of radius r1 at p1 and r2 at p2 joined
 * by their outer tangents. Adds a closed sub-path to the current path.
 */
export function capsulePath(ctx: CanvasRenderingContext2D, p1: Point2, r1: number, p2: Point2, r2: number): void {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (!(len > Math.abs(r1 - r2) + 0.5)) {
    const big = r1 >= r2 ? { p: p1, r: r1 } : { p: p2, r: r2 };
    circlePath(ctx, big.p, big.r);
    return;
  }
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const sin = (r1 - r2) / len;
  const cos = Math.sqrt(Math.max(0, 1 - sin * sin));
  // Unit vectors from each centre to its two tangent points.
  const tpx = nx * cos + ux * sin;
  const tpy = ny * cos + uy * sin;
  const tmx = -nx * cos + ux * sin;
  const tmy = -ny * cos + uy * sin;
  const aPlus = Math.atan2(tpy, tpx);
  const aMinus = Math.atan2(tmy, tmx);
  ctx.moveTo(p1.x + r1 * tpx, p1.y + r1 * tpy);
  ctx.lineTo(p2.x + r2 * tpx, p2.y + r2 * tpy);
  ctx.arc(p2.x, p2.y, r2, aPlus, aMinus, true);
  ctx.lineTo(p1.x + r1 * tmx, p1.y + r1 * tmy);
  ctx.arc(p1.x, p1.y, r1, aMinus, aPlus, true);
  ctx.closePath();
}

/**
 * Full circle sub-path drawn anticlockwise, the same winding as capsulePath, so
 * overlapping circles and capsules in one path fill as a union (nonzero rule).
 */
export function circlePath(ctx: CanvasRenderingContext2D, c: Point2, r: number): void {
  ctx.moveTo(c.x + r, c.y);
  ctx.arc(c.x, c.y, r, 0, -Math.PI * 2, true);
  ctx.closePath();
}

export function pointSegmentDistance(p: Point2, a: Point2, b: Point2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

/** Shortest distance from a segment to a rectangle (0 when they touch), sampled along the segment. */
function segmentRectDistance(a: Point2, b: Point2, r: Rect): number {
  let best = Infinity;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
    const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

/**
 * Picks where to put a label of size w×h around `anchor` so it stays clear of
 * the body segments and other overlay elements and inside the canvas. Tries 24
 * directions at `distance`; keeps the previous direction unless another one is
 * clearly better, so the label does not jump around from frame to frame.
 */
export function placeLabel(opts: {
  anchor: Point2;
  distance: number;
  w: number;
  h: number;
  segments: Array<readonly [Point2, Point2]>;
  avoid: Rect[];
  bounds: { w: number; h: number };
  preferred: number;
  previous: number | null;
}): { rect: Rect; angle: number } {
  const { anchor, distance, w, h, segments, avoid, bounds } = opts;
  const rectAt = (angle: number): Rect => ({ x: anchor.x + Math.cos(angle) * distance - w / 2, y: anchor.y + Math.sin(angle) * distance - h / 2, w, h });
  const score = (angle: number): number => {
    const r = rectAt(angle);
    const clear = segments.reduce((m, [a, b]) => Math.min(m, segmentRectDistance(a, b, r)), 80);
    const outside = Math.max(0, -r.x) + Math.max(0, -r.y) + Math.max(0, r.x + r.w - bounds.w) + Math.max(0, r.y + r.h - bounds.h);
    const blocked = avoid.some((o) => rectsOverlap(r, o, 6)) ? 60 : 0;
    let turn = Math.abs(angle - opts.preferred) % (Math.PI * 2);
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    return clear - outside * 2 - blocked - turn * 4;
  };
  let bestAngle = opts.preferred;
  let bestScore = -Infinity;
  for (let i = 0; i < 24; i++) {
    const angle = opts.preferred + (i * Math.PI * 2) / 24;
    const s = score(angle);
    if (s > bestScore) {
      bestScore = s;
      bestAngle = angle;
    }
  }
  if (opts.previous !== null && score(opts.previous) >= bestScore - 8) bestAngle = opts.previous;
  const r = rectAt(bestAngle);
  // Final clamp so a crowded corner never pushes the label off screen.
  r.x = Math.max(4, Math.min(bounds.w - w - 4, r.x));
  r.y = Math.max(4, Math.min(bounds.h - h - 4, r.y));
  return { rect: r, angle: bestAngle };
}

/** Maps frame coordinates to the canvas's object-fit: cover box. */
export function coverTransform(frameW: number, frameH: number, boxW: number, boxH: number) {
  const scale = Math.max(boxW / frameW, boxH / frameH);
  const offX = (boxW - frameW * scale) / 2;
  const offY = (boxH - frameH * scale) / 2;
  return { scale, offX, offY };
}
