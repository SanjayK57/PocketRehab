import type { Landmark, Point2, WorldLandmark } from '@/types/pose';
import type { ExerciseDefinition } from '@/types/exercise';
import type { LiveForm } from '@/types/form';
import type { BodySide, TargetRange, ValidityState } from '@/lib/validation/schemas';
import { ANALYSIS_CONFIG } from '@/features/movement-analysis/config';
import { drawBody, drawFramingGuide, type BodyPoint, type BodyPoints, type GuidePose } from './arBody';
import { coverTransform, jointGeometry, type Rect } from './arGeometry';
import { drawChips, drawGhost, drawGoniometer, drawHoldRing, drawTrail, type ChipSpec } from './arMeasure';
import { clamp, readTheme, themeKey, type OverlayTheme } from './arTheme';
export { readTheme }; // still imported from here by CameraTest and LiveStage

/**
 * Draws the AR layer on a canvas sized to the stage, in this order:
 *  1. setup framing guide (where to stand or sit),
 *  2. the tracked body as tapered, depth-shaded capsules with the measured limb in cyan,
 *  3. ghost guide limb and direction arrow,
 *  4. goniometer dial with target tape, needle and readout,
 *  5. hold ring, motion trail and check chips pinned to joints.
 * Nothing is drawn for a landmark the model did not return, and no form
 * judgement (pink) is drawn unless tracking is reliable.
 */

export interface OverlayPose {
  landmarks: Landmark[] | null;
  world: WorldLandmark[] | null;
  /** The metric's three points in source-frame pixels. */
  points: { a: Point2; b: Point2; c: Point2 } | null;
  frameWidth: number;
  frameHeight: number;
}

export type OverlayStage = 'setup' | 'countdown' | 'active' | 'idle';

export interface OverlayInput {
  pose: OverlayPose;
  def: ExerciseDefinition;
  side: BodySide;
  value: number | null;
  target: TargetRange | null;
  quality: ValidityState;
  form: LiveForm | null;
  stage: OverlayStage;
  /** All setup checks pass: the framing guide turns cyan. */
  setupFitted: boolean;
  mirrored: boolean;
  /** Draw the tracked body (off when a 3D figure is already showing it). */
  showBody: boolean;
  /** Draw the dial, ghost, chips and trail on the joint. */
  showInstruments: boolean;
  reducedMotion: boolean;
  now: number;
  /** On-stage HUD areas (CSS pixels, canvas space) that labels must not cover. */
  avoid: Rect[];
}

/** Per-canvas memory between frames: cached theme, label positions, the motion trail. */
export class OverlayState {
  theme: OverlayTheme | null = null;
  sign: 1 | -1 | null = null;
  readoutAngle: number | null = null;
  trail: Array<{ x: number; y: number; t: number }> = [];

  reset(): void {
    this.sign = null;
    this.readoutAngle = null;
    this.trail = [];
  }
}

const TRAIL_MS = 450;
const DISTAL: Record<number, number> = { 13: 15, 14: 16, 25: 27, 26: 28 };
const TORSO_SIDES = new Set(['11-23', '12-24']);

/** Keeps the canvas backing store matched to its CSS size and device pixel ratio (capped at 2). */
export function fitCanvas(canvas: HTMLCanvasElement): number {
  const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return dpr;
}

export function guidePoseFor(def: ExerciseDefinition): GuidePose {
  if (def.cameraView === 'front') return 'front-standing';
  return def.demo.pose.posture === 'seated' ? 'side-seated' : 'side-standing';
}

export function drawOverlay(ctx: CanvasRenderingContext2D, input: OverlayInput, state: OverlayState): void {
  const { canvas } = ctx;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (W === 0 || H === 0) return;
  const dpr = canvas.width / W;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!state.theme || state.theme.key !== themeKey()) state.theme = readTheme(canvas);
  const theme = state.theme;
  const { pose, def } = input;

  if (input.stage === 'setup' && input.showBody) {
    const facing: 1 | -1 = (input.side === 'right') !== input.mirrored ? 1 : -1;
    const pulse = input.reducedMotion ? 1 : 0.5 + 0.5 * Math.sin(input.now / 520);
    drawFramingGuide(ctx, { w: W, h: H, dpr, pose: guidePoseFor(def), facing, fitted: input.setupFitted, pulse }, theme);
  }

  const lms = pose.landmarks;
  if (!lms || pose.frameWidth <= 0 || pose.frameHeight <= 0) {
    state.trail = [];
    return;
  }

  const { scale, offX, offY } = coverTransform(pose.frameWidth, pose.frameHeight, W, H);
  const toCanvas = (p: Point2): Point2 => {
    const x = p.x * scale + offX;
    return { x: input.mirrored ? W - x : x, y: p.y * scale + offY };
  };
  const body = bodyPoints(lms, pose.world, pose.frameWidth, pose.frameHeight, toCanvas);
  const torso = torsoLength(body);
  const { a, b, c } = def.metric.landmarks[input.side];
  const reliable = input.quality === 'reliable';

  if (input.showBody) {
    const measured: Array<readonly [number, number]> = [];
    for (const [i, j] of [
      [a, b],
      [b, c],
    ] as const) {
      if (!TORSO_SIDES.has(i < j ? `${i}-${j}` : `${j}-${i}`)) measured.push([i, j]);
    }
    // When one arm of the angle is the trunk (arm raise), light the whole moving limb instead.
    const moving = def.metric.moving === 'c' ? c : a;
    const distal = DISTAL[moving];
    if (measured.length < 2 && distal !== undefined) measured.push([moving, distal]);
    drawBody(ctx, body, {
      unit: torso ?? H * 0.3,
      measured,
      measuredColor: reliable ? theme.tape : theme.warn,
      measuredCore: reliable ? theme.tapeLight : theme.warnLight,
    });
  }

  if (!input.showInstruments || !pose.points) {
    state.trail = [];
    return;
  }
  const pts = { a: toCanvas(pose.points.a), b: toCanvas(pose.points.b), c: toCanvas(pose.points.c) };
  const g = jointGeometry(def, pts, state.sign);
  if (!g) return;
  state.sign = g.sign;
  const guide = input.form?.guide ?? null;
  const target = input.target;
  const goal = target ? (target.min + target.max) / 2 : def.demo.peak;
  const animate = !input.reducedMotion;

  // Ghost guide: before the exercise it demonstrates the movement; during it, it shows the next position.
  let ghostValue: number | null = null;
  let arrow = false;
  if (input.stage === 'setup' || input.stage === 'countdown') {
    const phase = animate ? (input.now / 4200) % 1 : 0.5;
    const t = 0.5 - Math.cos(phase * Math.PI * 2) / 2;
    ghostValue = def.demo.neutral + (goal - def.demo.neutral) * t;
  } else if (input.stage === 'active') {
    const p = guide?.phase ?? 'move';
    if (p === 'return') ghostValue = def.demo.neutral;
    else if (p !== 'hold') ghostValue = goal;
    arrow = reliable && p !== 'hold' && !guide?.pastTarget;
  }
  if (ghostValue !== null) {
    drawGhost(ctx, { def, g, ghostValue, liveValue: input.value, thickness: (torso ?? H * 0.3) * 0.06, arrow, now: input.now, animate }, theme);
  }

  // Motion trail behind the moving joint (real movement only, not decoration).
  const movingPt = def.metric.moving === 'c' ? pts.c : pts.a;
  if (reliable && input.stage === 'active') {
    state.trail.push({ x: movingPt.x, y: movingPt.y, t: input.now });
    while (state.trail.length && input.now - (state.trail[0]?.t ?? 0) > TRAIL_MS) state.trail.shift();
    drawTrail(ctx, state.trail, input.now, TRAIL_MS, clamp((torso ?? 200) * 0.05, 3, 9), theme);
  } else {
    state.trail = [];
  }

  const dial = drawGoniometer(
    ctx,
    { def, g, value: input.value, target, reliable, bounds: { w: W, h: H }, avoid: input.avoid, previousReadoutAngle: state.readoutAngle },
    theme,
  );
  state.readoutAngle = dial.readoutAngle;

  if (guide?.hold && guide.phase === 'hold' && reliable) {
    drawHoldRing(ctx, g.vertex, clamp((torso ?? 200) * 0.09, 14, 26), guide.hold.heldMs / Math.max(1, guide.hold.requiredMs), theme);
  }

  // Check chips: form judgements only on reliable tracking; otherwise one honest "uncertain" chip.
  const chips: ChipSpec[] = [];
  if (!reliable) {
    if (input.stage === 'active' || input.stage === 'countdown') chips.push({ anchor: g.vertex, label: input.quality === 'uncertain' ? 'Tracking uncertain' : 'Not measurable', tone: 'uncertain' });
  } else if (input.form && input.stage === 'active') {
    for (const check of input.form.checks) {
      const anchor = check.anchor === null ? null : body[check.anchor];
      if (!anchor || check.state === 'unknown') continue;
      if (check.state === 'warn') chips.unshift({ anchor, label: check.label, tone: 'warn' });
      else chips.push({ anchor, label: check.label, tone: 'ok' });
    }
  }
  const center = bodyCenter(body);
  drawChips(ctx, chips.slice(0, 4), center, { w: W, h: H }, [...input.avoid, ...(dial.readout ? [dial.readout] : [])], theme);
}

/** Landmarks in canvas space with reliability and a 0..1 nearness from depth. */
function bodyPoints(lms: Landmark[], world: WorldLandmark[] | null, fw: number, fh: number, toCanvas: (p: Point2) => Point2): BodyPoints {
  const usable = ANALYSIS_CONFIG.visibilityUsable;
  const reliableVis = ANALYSIS_CONFIG.visibilityReliable;
  const lh = lms[23];
  const rh = lms[24];
  const ls = lms[11];
  const rs = lms[12];
  const torsoNorm = lh && rh && ls && rs ? Math.hypot(((ls.x + rs.x - lh.x - rh.x) / 2) * fw, ((ls.y + rs.y - lh.y - rh.y) / 2) * fh) : 0;
  const hipZ = lh && rh ? (lh.z + rh.z) / 2 : 0;
  const wl = world && world.length === lms.length ? world : null;
  const wHipZ = wl && wl[23] && wl[24] ? (wl[23].z + wl[24].z) / 2 : 0;

  return lms.map((lm, i) => {
    if (!lm || !(lm.visibility >= usable) || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) return null;
    let rel = 0;
    const w = wl?.[i];
    if (w && Number.isFinite(w.z)) rel = (w.z - wHipZ) / 0.5; // world: metres, torso ≈ 0.5 m
    else if (torsoNorm > 1 && Number.isFinite(lm.z)) rel = ((lm.z - hipZ) * fw) / torsoNorm; // image z uses the x scale
    const p = toCanvas({ x: lm.x * fw, y: lm.y * fh });
    const point: BodyPoint = { x: p.x, y: p.y, reliable: lm.visibility >= reliableVis, depth: clamp(0.5 - rel * 0.9, 0, 1) };
    return point;
  });
}

function torsoLength(body: BodyPoints): number | null {
  const [ls, rs, lh, rh] = [body[11], body[12], body[23], body[24]];
  if (ls && rs && lh && rh) return Math.hypot((ls.x + rs.x - lh.x - rh.x) / 2, (ls.y + rs.y - lh.y - rh.y) / 2);
  const s = ls ?? rs;
  const h = lh ?? rh;
  return s && h ? Math.hypot(s.x - h.x, s.y - h.y) : null;
}

function bodyCenter(body: BodyPoints): Point2 | null {
  const pts = [body[11], body[12], body[23], body[24]].filter((p): p is BodyPoint => !!p);
  if (!pts.length) return null;
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}
