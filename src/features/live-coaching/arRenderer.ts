import type { Landmark, Point2 } from '@/types/pose';
import { SKELETON_CONNECTIONS } from '@/types/pose';
import type { ExerciseDefinition } from '@/types/exercise';
import type { TargetRange, ValidityState } from '@/lib/validation/schemas';
import { ANALYSIS_CONFIG } from '@/features/movement-analysis/config';
import { arcAngles, ghostEndpoint, jointGeometry, type JointGeometry } from './arGeometry';
import type { TrafficLight } from './coach';

/**
 * Draws the AR layer on a canvas sized to the video's display box:
 *  1. skeleton (landmarks dim when not reliable),
 *  2. target zone anchored to the tracked joint (the configured range, as a band),
 *  3. ghost guide segment showing where the movement goes,
 *  4. live angle arc with the value,
 *  5. floating repetition counter and tracking-quality badge next to the joint.
 * Nothing is drawn for a landmark the model did not return.
 */

export interface OverlayInput {
  landmarks: Landmark[] | null;
  /** Source frame size (the model's coordinate space). */
  frameWidth: number;
  frameHeight: number;
  def: ExerciseDefinition;
  side: 'left' | 'right';
  value: number | null;
  points: { a: Point2; b: Point2; c: Point2 } | null;
  target: TargetRange | null;
  quality: ValidityState;
  light: TrafficLight;
  reps: number;
  repsTarget: number;
  /** 0..1 phase of the ghost guide animation; null shows the target position. */
  ghostPhase: number | null;
  mirrored: boolean;
  showGuides: boolean;
}

export interface OverlayTheme {
  tape: string;
  accent: string;
  accentSoft: string;
  signal: string;
  ok: string;
  warn: string;
  ink: string;
  paper: string;
  font: string;
  mono: string;
}

export function readTheme(el: Element): OverlayTheme {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    tape: v('--color-tape', '#0a8fb8'),
    accent: v('--color-accent', '#0a7ea4'),
    accentSoft: v('--color-accent-soft', '#dcf'),
    signal: v('--color-signal', '#c2306e'),
    ok: v('--color-ok', '#2f7a4a'),
    warn: v('--color-warn', '#9a5b00'),
    ink: v('--color-ink', '#1d1f22'),
    paper: v('--color-surface', '#fffdf9'),
    font: v('--font-sans', 'sans-serif'),
    mono: v('--font-mono', 'monospace'),
  };
}

/** Maps frame coordinates to the canvas's object-fit: cover box. */
export function coverTransform(frameW: number, frameH: number, boxW: number, boxH: number) {
  const scale = Math.max(boxW / frameW, boxH / frameH);
  const offX = (boxW - frameW * scale) / 2;
  const offY = (boxH - frameH * scale) / 2;
  return { scale, offX, offY };
}

let lastSign: 1 | -1 | null = null;

export function drawOverlay(ctx: CanvasRenderingContext2D, input: OverlayInput, theme: OverlayTheme): void {
  const { canvas } = ctx;
  const dpr = canvas.width / Math.max(1, canvas.clientWidth);
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!input.landmarks || input.frameWidth === 0) return;

  const { scale, offX, offY } = coverTransform(input.frameWidth, input.frameHeight, W, H);
  const toCanvas = (p: Point2): Point2 => {
    const x = p.x * scale + offX;
    return { x: input.mirrored ? W - x : x, y: p.y * scale + offY };
  };
  const lmPx = (lm: Landmark): Point2 => toCanvas({ x: lm.x * input.frameWidth, y: lm.y * input.frameHeight });
  const reliableVis = ANALYSIS_CONFIG.visibilityReliable;
  const usableVis = ANALYSIS_CONFIG.visibilityUsable;

  // 1. Skeleton
  ctx.lineCap = 'round';
  for (const [i, j] of SKELETON_CONNECTIONS) {
    const a = input.landmarks[i];
    const b = input.landmarks[j];
    if (!a || !b || a.visibility < usableVis || b.visibility < usableVis) continue;
    const pa = lmPx(a);
    const pb = lmPx(b);
    const strong = a.visibility >= reliableVis && b.visibility >= reliableVis;
    ctx.strokeStyle = strong ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = strong ? 3 : 2;
    ctx.setLineDash(strong ? [] : [4, 6]);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const idx of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    const lm = input.landmarks[idx];
    if (!lm || lm.visibility < usableVis) continue;
    const p = lmPx(lm);
    ctx.fillStyle = lm.visibility >= reliableVis ? '#ffffff' : 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  if (!input.points) return;
  const pts = { a: toCanvas(input.points.a), b: toCanvas(input.points.b), c: toCanvas(input.points.c) };
  const g = jointGeometry(input.def, pts, lastSign);
  if (!g) return;
  lastSign = g.sign;
  const reliable = input.quality === 'reliable';
  const radius = clamp(g.length * 0.85, 46, 150);
  const bandWidth = clamp(radius * 0.32, 14, 40);

  if (input.showGuides && input.target) {
    // 2. Target zone: a thick band between the target's min and max, on the user's joint.
    const zone = arcAngles(input.def, g, input.target.min, input.target.max);
    const inZone = input.value !== null && input.value >= input.target.min && input.value <= input.target.max && reliable;
    ctx.strokeStyle = inZone ? withAlpha(theme.tape, 0.92) : withAlpha(theme.tape, 0.42);
    ctx.lineWidth = bandWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(g.vertex.x, g.vertex.y, radius, zone.start, zone.end, zone.anticlockwise);
    ctx.stroke();
    const mid = ghostEndpoint(input.def, g, (input.target.min + input.target.max) / 2, (radius + bandWidth / 2 + 44) / Math.max(1, g.length));
    label(ctx, mid, `target ${input.target.min}–${input.target.max}°`, theme, 'rgba(18,20,22,0.72)', '#fff', 12);
  }

  if (input.showGuides) {
    // 3. Ghost guide: a translucent segment from the user's joint showing the movement path.
    const guideValue = ghostValue(input);
    if (guideValue !== null) drawGhost(ctx, input.def, g, guideValue, theme);
  }

  // 4. Live angle arc from the neutral reference to the current value.
  if (input.value !== null) {
    const from = input.def.metric.transform === 'supplement' ? 0 : Math.min(input.value, input.def.demo.neutral);
    const arc = arcAngles(input.def, g, from, input.value);
    ctx.strokeStyle = reliable ? '#ffffff' : '#e3a948';
    ctx.lineWidth = 3;
    ctx.setLineDash(reliable ? [] : [6, 6]);
    ctx.beginPath();
    ctx.arc(g.vertex.x, g.vertex.y, radius * 0.55, arc.start, arc.end, arc.anticlockwise);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = reliable ? '#ffffff' : '#e3a948';
    ctx.beginPath();
    ctx.arc(g.vertex.x, g.vertex.y, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5. Floating counter + quality badge beside the joint, on the side away from the moving limb.
  const towardTarget = ghostEndpoint(input.def, g, input.target ? (input.target.min + input.target.max) / 2 : input.def.demo.peak);
  const limbGoesLeft = towardTarget.x < g.vertex.x;
  const anchor = {
    x: clamp(limbGoesLeft ? g.vertex.x + 56 : g.vertex.x - 56 - HUD_W, 8, W - HUD_W - 8),
    y: clamp(g.vertex.y - HUD_H - 28, 8, H - HUD_H - 8),
  };
  drawHud(ctx, anchor, input, theme);
}

function ghostValue(input: OverlayInput): number | null {
  const neutral = input.def.demo.neutral;
  const peak = input.target ? (input.target.min + input.target.max) / 2 : input.def.demo.peak;
  if (input.ghostPhase === null) return peak;
  const t = 0.5 - Math.cos(input.ghostPhase * Math.PI * 2) / 2;
  return neutral + (peak - neutral) * t;
}

function drawGhost(ctx: CanvasRenderingContext2D, def: ExerciseDefinition, g: JointGeometry, value: number, theme: OverlayTheme) {
  const end = ghostEndpoint(def, g, value);
  ctx.save();
  ctx.strokeStyle = withAlpha(theme.tape, 0.5);
  ctx.lineWidth = clamp(g.length * 0.16, 12, 26);
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(g.vertex.x, g.vertex.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.setLineDash([2, 8]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(g.vertex.x, g.vertex.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.restore();
}

const HUD_W = 150;
const HUD_H = 84;

function drawHud(ctx: CanvasRenderingContext2D, at: Point2, input: OverlayInput, theme: OverlayTheme) {
  const w = HUD_W;
  const h = HUD_H;
  ctx.save();
  ctx.fillStyle = 'rgba(18,20,22,0.78)';
  roundRect(ctx, at.x, at.y, w, h, 12);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 30px ${theme.mono}`;
  ctx.textBaseline = 'top';
  ctx.fillText(`${input.reps}`, at.x + 12, at.y + 8);
  const repW = ctx.measureText(`${input.reps}`).width;
  ctx.font = `500 15px ${theme.font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(`/ ${input.repsTarget} reps`, at.x + 18 + repW, at.y + 19);
  const q = input.quality;
  const color = q === 'reliable' ? theme.tape : q === 'uncertain' ? '#b7791f' : '#6b6f76';
  const text = q === 'reliable' ? 'Tracking reliable' : q === 'uncertain' ? 'Tracking uncertain' : 'Not measurable';
  ctx.fillStyle = withAlpha(color, 0.95);
  roundRect(ctx, at.x + 10, at.y + 50, w - 20, 24, 12);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 12.5px ${theme.font}`;
  ctx.fillText(text, at.x + 20, at.y + 56);
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, at: Point2, text: string, theme: OverlayTheme, bg: string, fg: string, size: number) {
  ctx.save();
  ctx.font = `600 ${size}px ${theme.font}`;
  const w = ctx.measureText(text).width + 14;
  const x = clamp(at.x - w / 2, 4, ctx.canvas.clientWidth - w - 4);
  const y = clamp(at.y - 11, 4, ctx.canvas.clientHeight - 26);
  ctx.fillStyle = bg;
  roundRect(ctx, x, y, w, 22, 11);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 7, y + 11.5);
  ctx.restore();
}


function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Applies an alpha to a #rrggbb colour. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1] as string, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
