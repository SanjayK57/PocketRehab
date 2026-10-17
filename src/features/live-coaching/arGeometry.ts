import type { Point2 } from '@/types/pose';
import type { ExerciseDefinition } from '@/types/exercise';
import { interiorFromValue } from '@/features/movement-analysis/quality';

/**
 * Geometry for the AR overlay. Given the live joint points (pixels) it works
 * out where the target zone and the ghost guide segment sit on the user's own
 * body, rotating the reference segment by the target angle toward the side
 * the moving segment is already on.
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
  /** +1 or −1: which rotation direction takes ref toward the moving segment. */
  sign: 1 | -1;
}

function unit(v: Point2): Point2 | null {
  const m = Math.hypot(v.x, v.y);
  return m < 1e-6 ? null : { x: v.x / m, y: v.y / m };
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
  return { vertex: pts.b, ref, moving, length: Math.hypot(movingPt.x - pts.b.x, movingPt.y - pts.b.y), sign };
}

/** Direction of the moving segment when the exercise metric equals `value`. */
export function directionForValue(def: ExerciseDefinition, g: JointGeometry, value: number): Point2 {
  return rotate(g.ref, g.sign * interiorFromValue(def, value) * DEG);
}

/** Endpoint of the ghost guide segment at `value`. */
export function ghostEndpoint(def: ExerciseDefinition, g: JointGeometry, value: number, lengthScale = 1): Point2 {
  const d = directionForValue(def, g, value);
  return { x: g.vertex.x + d.x * g.length * lengthScale, y: g.vertex.y + d.y * g.length * lengthScale };
}

/** Start/end canvas angles (radians) for an arc between two metric values, drawn the short way. */
export function arcAngles(def: ExerciseDefinition, g: JointGeometry, fromValue: number, toValue: number): { start: number; end: number; anticlockwise: boolean } {
  const a = heading(directionForValue(def, g, fromValue));
  const b = heading(directionForValue(def, g, toValue));
  let delta = b - a;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return { start: a, end: b, anticlockwise: delta < 0 };
}
