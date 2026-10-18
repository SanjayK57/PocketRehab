import type { Landmark, Point2, WorldLandmark } from '@/types/pose';
import type { OverlayPose } from './arRenderer';

/**
 * Lets the overlay draw at the display's refresh rate (60 fps) while poses
 * arrive at 15–30 fps: each animation frame draws the pose interpolated
 * between the last two received, so limbs glide instead of stepping. The cost
 * is at most one pose interval of extra latency (~33 ms at 30 fps), capped so
 * a stalled stream never smears.
 */
export class PoseTween {
  private prev: { pose: OverlayPose; t: number } | null = null;
  private curr: { pose: OverlayPose; t: number } | null = null;

  push(pose: OverlayPose, t: number): void {
    const sameFrame = this.curr && this.curr.pose.frameWidth === pose.frameWidth && this.curr.pose.frameHeight === pose.frameHeight;
    this.prev = sameFrame ? this.curr : null;
    this.curr = { pose, t };
  }

  clear(): void {
    this.prev = null;
    this.curr = null;
  }

  /** The pose to draw at `now`; `interpolate: false` returns the newest pose as is. */
  sample(now: number, interpolate: boolean): OverlayPose | null {
    const curr = this.curr;
    if (!curr) return null;
    const prev = this.prev;
    if (!interpolate || !prev) return curr.pose;
    const interval = Math.min(200, Math.max(8, curr.t - prev.t));
    const k = Math.min(1, Math.max(0, (now - curr.t) / interval));
    if (k >= 1) return curr.pose;
    return {
      frameWidth: curr.pose.frameWidth,
      frameHeight: curr.pose.frameHeight,
      landmarks: lerpLandmarks(prev.pose.landmarks, curr.pose.landmarks, k),
      world: lerpWorld(prev.pose.world, curr.pose.world, k),
      points: curr.pose.points && prev.pose.points ? { a: lerpPt(prev.pose.points.a, curr.pose.points.a, k), b: lerpPt(prev.pose.points.b, curr.pose.points.b, k), c: lerpPt(prev.pose.points.c, curr.pose.points.c, k) } : curr.pose.points,
    };
  }
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function lerpPt(a: Point2, b: Point2, k: number): Point2 {
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
}

function lerpLandmarks(a: Landmark[] | null, b: Landmark[] | null, k: number): Landmark[] | null {
  if (!a || !b || a.length !== b.length) return b;
  return b.map((lb, i) => {
    const la = a[i];
    return la ? { x: lerp(la.x, lb.x, k), y: lerp(la.y, lb.y, k), z: lerp(la.z, lb.z, k), visibility: lb.visibility } : lb;
  });
}

function lerpWorld(a: WorldLandmark[] | null, b: WorldLandmark[] | null, k: number): WorldLandmark[] | null {
  if (!a || !b || a.length !== b.length) return b;
  return b.map((wb, i) => {
    const wa = a[i];
    return wa ? { x: lerp(wa.x, wb.x, k), y: lerp(wa.y, wb.y, k), z: lerp(wa.z, wb.z, k), visibility: wb.visibility } : wb;
  });
}
