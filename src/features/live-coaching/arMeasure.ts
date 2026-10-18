import type { Point2 } from '@/types/pose';
import type { ExerciseDefinition } from '@/types/exercise';
import type { TargetRange } from '@/lib/validation/schemas';
import { arcAngles, capsulePath, circlePath, dialRange, directionForValue, ghostEndpoint, placeLabel, rectsOverlap, type JointGeometry, type Rect } from './arGeometry';
import { clamp, hatchPattern, roundRect, withAlpha, type OverlayTheme } from './arTheme';

/**
 * The measuring instruments drawn on the user's joint: a goniometer dial with
 * 10° ticks, the target range laid on it as a strip of tape, a live needle and
 * a value readout that never sits on the limb; the ghost guide limb with an
 * arrow showing which way to move; the hold ring; a fading motion trail; and
 * check chips pinned to joints.
 */

export interface DialInput {
  def: ExerciseDefinition;
  g: JointGeometry;
  value: number | null;
  target: TargetRange | null;
  reliable: boolean;
  /** Bounds of the canvas in CSS pixels. */
  bounds: { w: number; h: number };
  /** Areas the readout must keep clear of (other labels, the on-stage HUD). */
  avoid: Rect[];
  previousReadoutAngle: number | null;
}

export function dialRadius(g: JointGeometry): number {
  return clamp(Math.min(g.length, g.refLength) * 0.56, 36, 116);
}

/** Draws the dial and returns the readout's rectangle and direction (kept for next frame's stability). */
export function drawGoniometer(ctx: CanvasRenderingContext2D, input: DialInput, theme: OverlayTheme): { readout: Rect | null; readoutAngle: number | null } {
  const { def, g, value, target, reliable } = input;
  const R = dialRadius(g);
  const range = dialRange(def, target);
  const v = g.vertex;
  const at = (val: number, r: number): Point2 => {
    const d = directionForValue(def, g, val);
    return { x: v.x + d.x * r, y: v.y + d.y * r };
  };
  const accent = reliable ? theme.tapeLight : theme.warnLight;

  // Protractor wedge between the zero line and the live value: the measured angle itself.
  if (value !== null) {
    const wedge = arcAngles(def, g, 0, clamp(value, 0, 180));
    const grad = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, R);
    grad.addColorStop(0, withAlpha(reliable ? theme.tape : theme.warn, 0));
    grad.addColorStop(1, withAlpha(reliable ? theme.tape : theme.warn, 0.2));
    ctx.beginPath();
    ctx.moveTo(v.x, v.y);
    ctx.arc(v.x, v.y, R - 1, wedge.start, wedge.end, wedge.anticlockwise);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Dial track.
  const track = arcAngles(def, g, range.min, range.max);
  ctx.lineCap = 'round';
  strokeArc(ctx, v, R, track, 'rgba(10,12,14,0.35)', 3.5);
  strokeArc(ctx, v, R, track, 'rgba(255,255,255,0.32)', 1.2);

  // Target band: a strip of tape on the dial, brighter when the value is inside it.
  if (target) {
    const band = arcAngles(def, g, clamp(target.min, range.min, range.max), clamp(target.max, range.min, range.max));
    const inBand = reliable && value !== null && value >= target.min && value <= target.max;
    strokeArc(ctx, v, R + 8, band, 'rgba(10,12,14,0.32)', 13);
    if (inBand) strokeArc(ctx, v, R + 8, band, withAlpha(theme.tape, 0.28), 22);
    strokeArc(ctx, v, R + 8, band, withAlpha(inBand ? theme.tapeLight : theme.tape, inBand ? 0.98 : 0.62), 9);
  }

  // Ticks every 10°, longer every 30°, with small numerals where the limb is not crossing.
  for (let t = Math.ceil(range.min / 10) * 10; t <= range.max; t += 10) {
    const major = t % 30 === 0;
    const p0 = at(t, R - (major ? 9 : 5));
    const p1 = at(t, R + 1);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.strokeStyle = 'rgba(10,12,14,0.4)';
    ctx.lineWidth = major ? 3.4 : 2.6;
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${major ? 0.9 : 0.55})`;
    ctx.lineWidth = major ? 1.6 : 1;
    ctx.stroke();
    if (major && R >= 52 && (value === null || Math.abs(t - value) > 14)) {
      const lp = at(t, R - 19);
      ctx.font = `600 10px ${theme.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.fillText(String(t), lp.x, lp.y);
    }
  }

  if (value === null) return { readout: null, readoutAngle: null };

  // Live sweep along the dial, with any part past the plan's target in pink.
  const shown = clamp(value, range.min, range.max);
  const over = target && reliable && value > target.max + 5 ? target.max + 5 : null;
  strokeArc(ctx, v, R, arcAngles(def, g, range.min, over ?? shown), withAlpha(reliable ? theme.tapeLight : theme.warnLight, 0.95), 3);
  if (over !== null) strokeArc(ctx, v, R, arcAngles(def, g, over, shown), theme.signal, 3.5);

  // Needle: a short bright pointer through the dial at the live value, with a bead.
  const n0 = at(shown, R - 14);
  const n1 = at(shown, R + 14);
  ctx.beginPath();
  ctx.moveTo(n0.x, n0.y);
  ctx.lineTo(n1.x, n1.y);
  ctx.strokeStyle = 'rgba(10,12,14,0.45)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.2;
  ctx.stroke();
  const bead = at(shown, R);
  ctx.beginPath();
  circlePath(ctx, bead, 4.5);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = accent;
  ctx.stroke();

  // Readout: placed around the joint where it is clear of both body segments.
  const text = `${Math.round(value)}°`;
  ctx.font = `700 22px ${theme.mono}`;
  const w = Math.ceil(ctx.measureText(text).width) + 26;
  const h = 36;
  const movingEnd = { x: v.x + g.moving.x * g.length, y: v.y + g.moving.y * g.length };
  const refEnd = { x: v.x + g.ref.x * g.refLength, y: v.y + g.ref.y * g.refLength };
  const valueDir = directionForValue(def, g, shown);
  const valueEnd = { x: v.x + valueDir.x * R * 1.3, y: v.y + valueDir.y * R * 1.3 };
  // Prefer the side opposite the angle being measured (outside both arms).
  const bis = { x: -(g.ref.x + g.moving.x), y: -(g.ref.y + g.moving.y) };
  const preferred = Math.hypot(bis.x, bis.y) > 0.2 ? Math.atan2(bis.y, bis.x) : Math.atan2(-g.ref.y, -g.ref.x);
  const placed = placeLabel({
    anchor: v,
    distance: R * 0.55 + 34,
    w,
    h,
    segments: [
      [v, movingEnd],
      [v, refEnd],
      [v, valueEnd],
    ],
    avoid: input.avoid,
    bounds: input.bounds,
    preferred,
    previous: input.previousReadoutAngle,
  });
  const r = placed.rect;
  ctx.save();
  roundRect(ctx, r.x, r.y, r.w, r.h, h / 2);
  ctx.fillStyle = 'rgba(16,18,20,0.78)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = reliable ? withAlpha(theme.tapeLight, 0.9) : hatchPattern(ctx, theme.warnLight);
  ctx.stroke();
  ctx.fillStyle = reliable ? '#ffffff' : theme.warnLight;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 1);
  ctx.restore();
  return { readout: r, readoutAngle: placed.angle };
}

function strokeArc(ctx: CanvasRenderingContext2D, c: Point2, r: number, arc: { start: number; end: number; anticlockwise: boolean }, color: string, width: number): void {
  if (Math.abs(arc.end - arc.start) < 1e-3) return;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, arc.start, arc.end, arc.anticlockwise);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/**
 * The ghost guide limb: a translucent capsule showing where the moving segment
 * should go next, with a curved arrow from the live position toward it.
 */
export function drawGhost(
  ctx: CanvasRenderingContext2D,
  opts: { def: ExerciseDefinition; g: JointGeometry; ghostValue: number; liveValue: number | null; thickness: number; arrow: boolean; now: number; animate: boolean },
  theme: OverlayTheme,
): void {
  const { def, g } = opts;
  const end = ghostEndpoint(def, g, opts.ghostValue);
  const r = clamp(opts.thickness, 4, 18);
  ctx.save();
  ctx.beginPath();
  capsulePath(ctx, g.vertex, r * 1.05, end, r * 0.8);
  ctx.fillStyle = withAlpha(theme.tape, 0.16);
  ctx.fill();
  ctx.setLineDash([7, 6]);
  ctx.lineDashOffset = opts.animate ? -opts.now * 0.02 : 0;
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = withAlpha(theme.tapeLight, 0.85);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  circlePath(ctx, end, r * 0.8 + 3);
  ctx.lineWidth = 2;
  ctx.strokeStyle = withAlpha(theme.tapeLight, 0.9);
  ctx.stroke();
  ctx.restore();

  if (!opts.arrow || opts.liveValue === null || Math.abs(opts.ghostValue - opts.liveValue) < 10) return;
  // Curved arrow outside the dial, from the live angle toward the guide angle.
  const radius = Math.max(dialRadius(g) + 30, g.length * 0.78);
  const step = opts.ghostValue > opts.liveValue ? -6 : 6;
  const arc = arcAngles(def, g, opts.liveValue, opts.ghostValue + step);
  if (Math.abs(arc.end - arc.start) < 0.08) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(g.vertex.x, g.vertex.y, radius, arc.start, arc.end, arc.anticlockwise);
  ctx.strokeStyle = 'rgba(10,12,14,0.35)';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = opts.animate ? (arc.anticlockwise ? 1 : -1) * opts.now * 0.045 : 0;
  ctx.strokeStyle = theme.tapeLight;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.setLineDash([]);
  // Arrowhead along the arc's tangent at its end.
  const ea = arc.end;
  const tip = { x: g.vertex.x + Math.cos(ea) * radius, y: g.vertex.y + Math.sin(ea) * radius };
  const dir = arc.anticlockwise ? -1 : 1;
  const tx = -Math.sin(ea) * dir;
  const ty = Math.cos(ea) * dir;
  const nx = Math.cos(ea);
  const ny = Math.sin(ea);
  const size = 11;
  ctx.beginPath();
  ctx.moveTo(tip.x + tx * size * 0.6, tip.y + ty * size * 0.6);
  ctx.lineTo(tip.x - tx * size * 0.7 + nx * size * 0.62, tip.y - ty * size * 0.7 + ny * size * 0.62);
  ctx.lineTo(tip.x - tx * size * 0.7 - nx * size * 0.62, tip.y - ty * size * 0.7 - ny * size * 0.62);
  ctx.closePath();
  ctx.fillStyle = theme.tapeLight;
  ctx.strokeStyle = 'rgba(10,12,14,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

/** Ring around the joint that fills while a prescribed hold is in progress. */
export function drawHoldRing(ctx: CanvasRenderingContext2D, at: Point2, radius: number, progress: number, theme: OverlayTheme): void {
  const p = clamp(progress, 0, 1);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  circlePath(ctx, at, radius);
  ctx.strokeStyle = 'rgba(10,12,14,0.4)';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 4;
  ctx.stroke();
  if (p > 0) {
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.strokeStyle = p >= 1 ? '#ffffff' : theme.tapeLight;
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  ctx.restore();
}

/** A short trail behind the moving joint that fades out over its length. */
export function drawTrail(ctx: CanvasRenderingContext2D, trail: Array<{ x: number; y: number; t: number }>, now: number, spanMs: number, width: number, theme: OverlayTheme): void {
  if (trail.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1] as { x: number; y: number; t: number };
    const b = trail[i] as { x: number; y: number; t: number };
    const age = clamp(1 - (now - b.t) / spanMs, 0, 1);
    if (age <= 0) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = withAlpha(theme.tapeLight, 0.55 * age * age);
    ctx.lineWidth = Math.max(1, width * age);
    ctx.stroke();
  }
  ctx.restore();
}

export interface ChipSpec {
  anchor: Point2;
  label: string;
  tone: 'warn' | 'ok' | 'uncertain';
}

/**
 * Check chips pinned to joints: pink for a criterion not met, amber hatch when
 * tracking is uncertain, a small cyan tick when the check passes. Each chip is
 * pushed away from the body centre and from earlier chips and labels.
 */
export function drawChips(ctx: CanvasRenderingContext2D, chips: ChipSpec[], bodyCenter: Point2 | null, bounds: { w: number; h: number }, avoid: Rect[], theme: OverlayTheme): Rect[] {
  const placed: Rect[] = [];
  ctx.save();
  ctx.font = `700 13px ${theme.font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const chip of chips) {
    const away = bodyCenter ? { x: chip.anchor.x - bodyCenter.x, y: chip.anchor.y - bodyCenter.y } : { x: 1, y: 0 };
    const m = Math.hypot(away.x, away.y) || 1;
    const dir = { x: away.x / m, y: away.y / m };
    if (chip.tone === 'ok') {
      // Compact tick badge: no words for a passing check, so the body stays uncluttered.
      const c = { x: chip.anchor.x + dir.x * 22, y: chip.anchor.y + dir.y * 22 };
      const rect = { x: c.x - 10, y: c.y - 10, w: 20, h: 20 };
      if ([...placed, ...avoid].some((o) => rectsOverlap(rect, o, 4))) continue;
      ctx.beginPath();
      circlePath(ctx, c, 10);
      ctx.fillStyle = theme.tape;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c.x - 4.2, c.y + 0.2);
      ctx.lineTo(c.x - 1.2, c.y + 3.2);
      ctx.lineTo(c.x + 4.6, c.y - 3.4);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      placed.push(rect);
      continue;
    }
    const w = Math.ceil(ctx.measureText(chip.label).width) + 40;
    const h = 30;
    let rect: Rect = { x: chip.anchor.x + dir.x * 34 - (dir.x < 0 ? w : 0), y: chip.anchor.y + dir.y * 26 - h / 2, w, h };
    for (let tries = 0; tries < 6 && [...placed, ...avoid].some((o) => rectsOverlap(rect, o, 4)); tries++) rect = { ...rect, y: rect.y + (dir.y >= 0 ? h + 6 : -(h + 6)) };
    rect.x = clamp(rect.x, 6, bounds.w - w - 6);
    rect.y = clamp(rect.y, 6, bounds.h - h - 6);
    // Leader line from the joint to the chip.
    const cx = clamp(chip.anchor.x, rect.x + h / 2, rect.x + rect.w - h / 2);
    const cy = rect.y + h / 2;
    ctx.beginPath();
    ctx.moveTo(chip.anchor.x, chip.anchor.y);
    ctx.lineTo(cx, cy);
    ctx.strokeStyle = chip.tone === 'warn' ? withAlpha(theme.signal, 0.9) : withAlpha(theme.warnLight, 0.9);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    circlePath(ctx, chip.anchor, 5);
    ctx.fillStyle = chip.tone === 'warn' ? theme.signal : theme.warnLight;
    ctx.fill();
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, h / 2);
    if (chip.tone === 'warn') {
      ctx.fillStyle = theme.signal;
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(16,18,20,0.86)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = hatchPattern(ctx, theme.warnLight);
      ctx.stroke();
    }
    // Icon: "!" in a ring for a criterion not met, a dashed ring for uncertain.
    const ic = { x: rect.x + 16, y: rect.y + h / 2 };
    ctx.beginPath();
    circlePath(ctx, ic, 7);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#ffffff';
    if (chip.tone === 'uncertain') ctx.setLineDash([2.5, 2.5]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (chip.tone === 'warn') {
      ctx.beginPath();
      ctx.moveTo(ic.x, ic.y - 3.6);
      ctx.lineTo(ic.x, ic.y + 0.8);
      ctx.moveTo(ic.x, ic.y + 3.4);
      ctx.lineTo(ic.x, ic.y + 3.6);
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillText(chip.label, rect.x + 30, rect.y + h / 2 + 0.5);
    placed.push(rect);
  }
  ctx.restore();
  return placed;
}
