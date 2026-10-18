import type { Point2 } from '@/types/pose';
import { capsulePath, circlePath } from './arGeometry';
import { clamp, withAlpha, type OverlayTheme } from './arTheme';

/**
 * The tracked body, drawn as tapered translucent capsules instead of a stick
 * figure: each bone is a "tube" with a cross-lit gradient, a soft halo and a
 * fine rim; nearer limbs are thicker and brighter; joints are small rings. A
 * dark under-shadow keeps it legible over bright walls as well as dark rooms.
 */

/** One landmark in canvas space, with how sure the model is and how near it is (0 far … 1 near). */
export interface BodyPoint extends Point2 {
  reliable: boolean;
  depth: number;
}

export type BodyPoints = Array<BodyPoint | null>;

/** Half-thickness of each landmark as a fraction of torso length. */
const RADIUS: Record<number, number> = {
  11: 0.078, 12: 0.078, 13: 0.062, 14: 0.062, 15: 0.046, 16: 0.046,
  23: 0.09, 24: 0.09, 25: 0.072, 26: 0.072, 27: 0.052, 28: 0.052,
  31: 0.032, 32: 0.032, 19: 0.034, 20: 0.034,
};

const BONES: ReadonlyArray<readonly [number, number]> = [
  [11, 12], [23, 24], [11, 23], [12, 24],
  [11, 13], [13, 15], [15, 19], [12, 14], [14, 16], [16, 20],
  [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32],
];

const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

function key(i: number, j: number): string {
  return i < j ? `${i}-${j}` : `${j}-${i}`;
}

export interface BodyStyle {
  /** Torso length in canvas pixels: sets every thickness so the body scales with distance. */
  unit: number;
  /** Bones of the measured joint (pairs of landmark indices), drawn in tape cyan with a bloom. */
  measured: Array<readonly [number, number]>;
  /** Colour of the measured limb: tape when reliable, amber when uncertain. */
  measuredColor: string;
  measuredCore: string;
}

export function drawBody(ctx: CanvasRenderingContext2D, pts: BodyPoints, style: BodyStyle): void {
  const u = Math.max(40, style.unit);
  const radius = (i: number, p: BodyPoint) => clamp((RADIUS[i] ?? 0.05) * u, 2.5, 26) * (0.78 + 0.44 * p.depth);
  const measured = new Set(style.measured.map(([i, j]) => key(i, j)));

  drawTorsoPlate(ctx, pts);
  drawHead(ctx, pts, u);

  // Painter's order: farthest bones first so near limbs overlap far ones.
  const bones = BONES.flatMap(([i, j]) => {
    const a = pts[i];
    const b = pts[j];
    return a && b ? [{ i, j, a, b, depth: (a.depth + b.depth) / 2 }] : [];
  }).sort((x, y) => x.depth - y.depth);

  for (const bone of bones) {
    const isMeasured = measured.has(key(bone.i, bone.j));
    const r1 = radius(bone.i, bone.a);
    const r2 = radius(bone.j, bone.b);
    const reliable = bone.a.reliable && bone.b.reliable;
    const presence = (reliable ? 1 : 0.45) * (0.55 + 0.45 * bone.depth);
    if (isMeasured) paintMeasuredBone(ctx, bone.a, r1 * 1.08, bone.b, r2 * 1.08, style);
    else paintBone(ctx, bone.a, r1, bone.b, r2, presence);
  }

  for (const i of JOINTS) {
    const p = pts[i];
    if (!p) continue;
    const r = clamp(radius(i, p) * 0.58, 2.5, 11);
    const inMeasured = style.measured.some(([a, b]) => a === i || b === i);
    ctx.beginPath();
    circlePath(ctx, p, r);
    ctx.fillStyle = 'rgba(14,16,18,0.55)';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = inMeasured ? style.measuredCore : `rgba(255,255,255,${p.reliable ? 0.92 : 0.45})`;
    ctx.stroke();
    ctx.beginPath();
    circlePath(ctx, p, Math.max(1.2, r * 0.32));
    ctx.fillStyle = inMeasured ? style.measuredCore : 'rgba(255,255,255,0.9)';
    ctx.fill();
  }
}

function paintBone(ctx: CanvasRenderingContext2D, a: Point2, r1: number, b: Point2, r2: number, presence: number): void {
  // Under-shadow for contrast on bright backgrounds.
  ctx.beginPath();
  capsulePath(ctx, a, r1 + 1.5, b, r2 + 1.5);
  ctx.fillStyle = `rgba(10,12,14,${0.26 * presence})`;
  ctx.fill();
  // Soft halo.
  ctx.beginPath();
  capsulePath(ctx, a, r1 * 1.9 + 2, b, r2 * 1.9 + 2);
  ctx.fillStyle = `rgba(255,255,255,${0.05 * presence})`;
  ctx.fill();
  // Tube body, lit across its width so it reads as a rounded volume.
  ctx.beginPath();
  capsulePath(ctx, a, r1, b, r2);
  ctx.fillStyle = crossGradient(ctx, a, b, (r1 + r2) / 2, [`rgba(255,255,255,${0.16 * presence})`, `rgba(255,255,255,${0.58 * presence})`, `rgba(255,255,255,${0.2 * presence})`]);
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = `rgba(255,255,255,${0.78 * presence})`;
  ctx.stroke();
}

function paintMeasuredBone(ctx: CanvasRenderingContext2D, a: Point2, r1: number, b: Point2, r2: number, style: BodyStyle): void {
  ctx.beginPath();
  capsulePath(ctx, a, r1 + 2, b, r2 + 2);
  ctx.fillStyle = 'rgba(10,12,14,0.32)';
  ctx.fill();
  // Bloom: two widening halos of the tape colour.
  for (const [grow, alpha] of [
    [2.6, 0.08],
    [1.7, 0.16],
  ] as const) {
    ctx.beginPath();
    capsulePath(ctx, a, r1 * grow + 3, b, r2 * grow + 3);
    ctx.fillStyle = withAlpha(style.measuredColor, alpha);
    ctx.fill();
  }
  ctx.beginPath();
  capsulePath(ctx, a, r1, b, r2);
  ctx.fillStyle = crossGradient(ctx, a, b, (r1 + r2) / 2, [withAlpha(style.measuredColor, 0.55), withAlpha(style.measuredCore, 0.95), withAlpha(style.measuredColor, 0.6)]);
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = withAlpha(style.measuredCore, 0.95);
  ctx.stroke();
}

/** Gradient across a bone (perpendicular to it): edge → bright centre line → edge. */
function crossGradient(ctx: CanvasRenderingContext2D, a: Point2, b: Point2, r: number, stops: [string, string, string]): CanvasGradient {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const g = ctx.createLinearGradient(mx - nx * r, my - ny * r, mx + nx * r, my + ny * r);
  g.addColorStop(0, stops[0]);
  // The highlight sits a little off-centre, as if lit from above-left.
  g.addColorStop(0.38, stops[1]);
  g.addColorStop(1, stops[2]);
  return g;
}

function drawTorsoPlate(ctx: CanvasRenderingContext2D, pts: BodyPoints): void {
  const [ls, rs, rh, lh] = [pts[11], pts[12], pts[24], pts[23]];
  if (!ls || !rs || !rh || !lh) return;
  const reliable = ls.reliable && rs.reliable && rh.reliable && lh.reliable;
  const top = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const bottom = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  const g = ctx.createLinearGradient(top.x, top.y, bottom.x, bottom.y);
  g.addColorStop(0, `rgba(255,255,255,${reliable ? 0.16 : 0.07})`);
  g.addColorStop(1, `rgba(255,255,255,${reliable ? 0.07 : 0.03})`);
  ctx.beginPath();
  ctx.moveTo(ls.x, ls.y);
  ctx.lineTo(rs.x, rs.y);
  ctx.lineTo(rh.x, rh.y);
  ctx.lineTo(lh.x, lh.y);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
}

function drawHead(ctx: CanvasRenderingContext2D, pts: BodyPoints, unit: number): void {
  const nose = pts[0];
  const le = pts[7];
  const re = pts[8];
  const ls = pts[11];
  const rs = pts[12];
  if (!nose) return;
  // Centre between the ears when both are tracked (the nose sits forward of the skull centre).
  const c = le && re ? { x: (le.x + re.x) / 2 * 0.7 + nose.x * 0.3, y: (le.y + re.y) / 2 * 0.7 + nose.y * 0.3 } : nose;
  const r = clamp(le && re ? Math.hypot(le.x - re.x, le.y - re.y) * 0.62 : unit * 0.2, unit * 0.13, unit * 0.3);
  const reliable = nose.reliable;
  if (ls && rs) {
    const neckBase = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
    const toward = Math.hypot(neckBase.x - c.x, neckBase.y - c.y) || 1;
    const neckTop = { x: c.x + ((neckBase.x - c.x) / toward) * r * 0.8, y: c.y + ((neckBase.y - c.y) / toward) * r * 0.8 };
    ctx.beginPath();
    capsulePath(ctx, neckTop, unit * 0.045, neckBase, unit * 0.055);
    ctx.fillStyle = `rgba(255,255,255,${reliable ? 0.18 : 0.08})`;
    ctx.fill();
  }
  const g = ctx.createRadialGradient(c.x - r * 0.3, c.y - r * 0.35, r * 0.1, c.x, c.y, r);
  g.addColorStop(0, `rgba(255,255,255,${reliable ? 0.42 : 0.18})`);
  g.addColorStop(1, `rgba(255,255,255,${reliable ? 0.1 : 0.05})`);
  ctx.beginPath();
  circlePath(ctx, c, r + 1.5);
  ctx.fillStyle = 'rgba(10,12,14,0.22)';
  ctx.fill();
  ctx.beginPath();
  circlePath(ctx, c, r);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = `rgba(255,255,255,${reliable ? 0.75 : 0.35})`;
  ctx.stroke();
}

/* ------------------------------------------------------------------------- */
/* Setup framing guide                                                        */
/* ------------------------------------------------------------------------- */

export type GuidePose = 'front-standing' | 'side-standing' | 'side-seated';

type Shape = { kind: 'capsule'; a: [number, number]; b: [number, number]; r1: number; r2: number } | { kind: 'circle'; c: [number, number]; r: number };

const cap = (a: [number, number], b: [number, number], r1: number, r2 = r1): Shape => ({ kind: 'capsule', a, b, r1, r2 });
const dot = (c: [number, number], r: number): Shape => ({ kind: 'circle', c, r });

/** Figure shapes in units of the figure's height (0 = head top, 1 = floor), x from the figure's centre line. */
function guideShapes(pose: GuidePose): Shape[] {
  if (pose === 'front-standing') {
    const side = (s: 1 | -1): Shape[] => [
      cap([0.11 * s, 0.205], [0.15 * s, 0.355], 0.036, 0.031),
      cap([0.15 * s, 0.355], [0.165 * s, 0.5], 0.03, 0.025),
      dot([0.168 * s, 0.53], 0.027),
      cap([0.062 * s, 0.5], [0.068 * s, 0.735], 0.054, 0.042),
      cap([0.068 * s, 0.735], [0.07 * s, 0.94], 0.04, 0.03),
      cap([0.07 * s, 0.965], [0.1 * s, 0.975], 0.022, 0.018),
    ];
    return [
      dot([0, 0.072], 0.062),
      cap([0, 0.12], [0, 0.18], 0.028, 0.034),
      cap([-0.105, 0.2], [0.105, 0.2], 0.04),
      cap([0, 0.23], [0, 0.43], 0.1, 0.085),
      cap([-0.06, 0.49], [0.06, 0.49], 0.062),
      ...side(1),
      ...side(-1),
    ];
  }
  if (pose === 'side-standing') {
    return [
      dot([0.012, 0.072], 0.062),
      cap([0, 0.12], [0, 0.18], 0.028, 0.034),
      cap([0, 0.21], [0, 0.46], 0.07, 0.068),
      cap([0, 0.21], [0.008, 0.36], 0.036, 0.031),
      cap([0.008, 0.36], [0.014, 0.5], 0.03, 0.025),
      dot([0.016, 0.53], 0.027),
      cap([0, 0.5], [0.004, 0.735], 0.058, 0.044),
      cap([0.004, 0.735], [0, 0.94], 0.042, 0.03),
      cap([0, 0.965], [0.07, 0.975], 0.024, 0.018),
    ];
  }
  return [
    dot([0, 0.11], 0.072),
    cap([0, 0.17], [0, 0.23], 0.03, 0.036),
    cap([0, 0.25], [0, 0.55], 0.08, 0.078),
    cap([0, 0.25], [0.035, 0.41], 0.037, 0.032),
    cap([0.035, 0.41], [0.14, 0.5], 0.03, 0.026),
    cap([0.01, 0.585], [0.27, 0.6], 0.07, 0.056),
    cap([0.27, 0.6], [0.285, 0.92], 0.05, 0.036),
    cap([0.285, 0.955], [0.36, 0.965], 0.025, 0.018),
  ];
}

interface GuideCache {
  key: string;
  canvas: HTMLCanvasElement;
}

let guideCache: GuideCache | null = null;

/**
 * A soft outline of where to stand or sit, with camera framing corners, shown
 * during setup. It turns tape cyan once the person fits it. The outline is
 * rendered once to an offscreen canvas (union fill, then the same shapes shrunk
 * and cut out) and reused every frame.
 */
export function drawFramingGuide(
  ctx: CanvasRenderingContext2D,
  opts: { w: number; h: number; dpr: number; pose: GuidePose; facing: 1 | -1; fitted: boolean; pulse: number },
  theme: OverlayTheme,
): void {
  const { w, h, dpr, pose, facing } = opts;
  if (w < 40 || h < 40 || typeof document === 'undefined') return;
  const figH = h * (pose === 'side-seated' ? 0.7 : 0.84);
  const top = (h - figH) / 2 + (pose === 'side-seated' ? h * 0.04 : 0);
  const cx = w / 2 - (pose === 'side-seated' ? facing * figH * 0.12 : 0);
  const toXY = ([x, y]: [number, number]) => ({ x: cx + x * figH * facing, y: top + y * figH });

  const cacheKey = `${w}x${h}@${dpr}:${pose}:${facing}`;
  if (!guideCache || guideCache.key !== cacheKey) {
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(w * dpr));
    off.height = Math.max(1, Math.round(h * dpr));
    const o = off.getContext('2d');
    if (!o) return;
    o.scale(dpr, dpr);
    const shapes = guideShapes(pose);
    const fillShapes = (inset: number) => {
      o.beginPath();
      for (const s of shapes) {
        if (s.kind === 'circle') circlePath(o, toXY(s.c), Math.max(0.5, s.r * figH - inset));
        else capsulePath(o, toXY(s.a), Math.max(0.5, s.r1 * figH - inset), toXY(s.b), Math.max(0.5, s.r2 * figH - inset));
      }
      o.fill('nonzero');
    };
    o.fillStyle = '#ffffff';
    fillShapes(0);
    o.globalCompositeOperation = 'destination-out';
    o.fillStyle = 'rgba(0,0,0,0.86)';
    fillShapes(2.2);
    o.globalCompositeOperation = 'source-over';
    guideCache = { key: cacheKey, canvas: off };
  }

  ctx.save();
  // Tint the cached white outline: draw it, then colour it in place.
  ctx.globalAlpha = (opts.fitted ? 0.95 : 0.7) * (0.82 + 0.18 * opts.pulse);
  ctx.drawImage(guideCache.canvas, 0, 0, w, h);
  if (opts.fitted) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = theme.tapeLight;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();

  if (pose === 'side-seated') {
    // A chair hint under the seated outline.
    const seat = toXY([-0.06, 0.66]);
    const seatEnd = toXY([0.25, 0.66]);
    const back = toXY([-0.1, 0.3]);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.setLineDash([2, 7]);
    ctx.beginPath();
    ctx.moveTo(back.x, back.y);
    ctx.lineTo(back.x, seat.y);
    ctx.lineTo(seatEnd.x, seat.y);
    ctx.moveTo(seatEnd.x - 4 * facing, seat.y);
    ctx.lineTo(seatEnd.x - 4 * facing, toXY([0, 1]).y);
    ctx.moveTo(back.x, seat.y);
    ctx.lineTo(back.x, toXY([0, 1]).y);
    ctx.stroke();
    ctx.restore();
  }

  // Viewfinder corners around the figure's space, and a floor line.
  const boxW = Math.min(w * 0.82, figH * (pose === 'front-standing' ? 0.62 : 0.6));
  const x0 = w / 2 - boxW / 2;
  const x1 = w / 2 + boxW / 2;
  const y0 = Math.max(10, top - h * 0.03);
  const y1 = Math.min(h - 10, top + figH + h * 0.02);
  const arm = Math.min(28, boxW * 0.12);
  ctx.save();
  ctx.strokeStyle = opts.fitted ? theme.tapeLight : 'rgba(255,255,255,0.82)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [x, y, sx, sy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x0, y1, 1, -1],
    [x1, y1, -1, -1],
  ] as const) {
    ctx.moveTo(x, y + arm * sy);
    ctx.arcTo(x, y, x + arm * sx, y, 8);
    ctx.lineTo(x + arm * sx, y);
  }
  ctx.stroke();
  ctx.restore();
}
