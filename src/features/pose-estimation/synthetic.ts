import { LANDMARK_COUNT, LM, type Landmark, type Point2, type PoseFrame, type PoseProviderInfo } from '@/types/pose';
import type { ExerciseDefinition } from '@/types/exercise';
import type { BodySide } from '@/lib/validation/schemas';
import { interiorFromValue } from '@/features/movement-analysis/quality';

/**
 * Synthetic pose generation. Builds a full 33-landmark skeleton whose measured
 * joint metric equals a requested value exactly (in pixel space), then lets
 * callers add noise, dropouts, jumps and occlusion. Used by:
 * - the clearly labeled "Simulated demo" session mode (no camera),
 * - unit/integration tests,
 * - the quantitative evaluation harness (ground truth is known exactly).
 * It is not camera data and is never presented as the user's measurement.
 */

export const SYNTHETIC_FRAME = { width: 1280, height: 720 } as const;
export const SIMULATED_PROVIDER_INFO: PoseProviderInfo = {
  name: 'PocketRehab simulator',
  model: 'synthetic-skeleton',
  version: '1.0.0',
  kind: 'simulated',
  delegate: 'none',
};

type Px = Record<number, Point2>;

function rotate(v: Point2, phi: number): Point2 {
  return { x: v.x * Math.cos(phi) - v.y * Math.sin(phi), y: v.x * Math.sin(phi) + v.y * Math.cos(phi) };
}

function unit(v: Point2): Point2 {
  const m = Math.hypot(v.x, v.y);
  return { x: v.x / m, y: v.y / m };
}

function add(p: Point2, v: Point2, len = 1): Point2 {
  return { x: p.x + v.x * len, y: p.y + v.y * len };
}

/** Places point C so that angle(A, B, C) at vertex B equals `interiorDeg`, rotating toward `sign`. */
function placeAtAngle(a: Point2, b: Point2, interiorDeg: number, length: number, sign: 1 | -1): Point2 {
  const ref = unit({ x: a.x - b.x, y: a.y - b.y });
  const dir = rotate(ref, (sign * interiorDeg * Math.PI) / 180);
  return add(b, dir, length);
}

function frontBase(): Px {
  const cx = 640;
  return {
    [LM.nose]: { x: cx, y: 165 },
    [LM.leftShoulder]: { x: cx + 85, y: 255 },
    [LM.rightShoulder]: { x: cx - 85, y: 255 },
    [LM.leftHip]: { x: cx + 58, y: 470 },
    [LM.rightHip]: { x: cx - 58, y: 470 },
    [LM.leftKnee]: { x: cx + 60, y: 580 },
    [LM.rightKnee]: { x: cx - 60, y: 580 },
    [LM.leftAnkle]: { x: cx + 62, y: 680 },
    [LM.rightAnkle]: { x: cx - 62, y: 680 },
  };
}

/** Front view, arm raised to the side. Person's left appears on image right. */
function shoulderAbductionPose(side: BodySide, interior: number): Px {
  const p = frontBase();
  const s = side === 'left' ? LM.leftShoulder : LM.rightShoulder;
  const h = side === 'left' ? LM.leftHip : LM.rightHip;
  const e = side === 'left' ? LM.leftElbow : LM.rightElbow;
  const w = side === 'left' ? LM.leftWrist : LM.rightWrist;
  const sign: 1 | -1 = side === 'left' ? -1 : 1; // rotate the downward hip vector outward
  const elbow = placeAtAngle(p[h] as Point2, p[s] as Point2, interior, 135, sign);
  p[e] = elbow;
  p[w] = add(elbow, unit({ x: elbow.x - (p[s] as Point2).x, y: elbow.y - (p[s] as Point2).y }), 120);
  // Other arm relaxed at the side.
  const os = side === 'left' ? LM.rightShoulder : LM.leftShoulder;
  const oe = side === 'left' ? LM.rightElbow : LM.leftElbow;
  const ow = side === 'left' ? LM.rightWrist : LM.leftWrist;
  const dx = side === 'left' ? -12 : 12;
  p[oe] = { x: (p[os] as Point2).x + dx, y: 385 };
  p[ow] = { x: (p[os] as Point2).x + dx * 1.5, y: 500 };
  return p;
}

/** Side view facing image left; arm on `side` is the near arm. */
function elbowFlexionPose(side: BodySide, interior: number): Px {
  const near = side;
  const far: BodySide = side === 'left' ? 'right' : 'left';
  const idx = (s: BodySide) =>
    s === 'left'
      ? { s: LM.leftShoulder, e: LM.leftElbow, w: LM.leftWrist, h: LM.leftHip, k: LM.leftKnee, a: LM.leftAnkle }
      : { s: LM.rightShoulder, e: LM.rightElbow, w: LM.rightWrist, h: LM.rightHip, k: LM.rightKnee, a: LM.rightAnkle };
  const n = idx(near);
  const f = idx(far);
  const p: Px = {};
  p[LM.nose] = { x: 610, y: 160 };
  p[n.s] = { x: 642, y: 255 };
  p[f.s] = { x: 650, y: 250 };
  p[n.h] = { x: 645, y: 470 };
  p[f.h] = { x: 652, y: 466 };
  p[n.k] = { x: 640, y: 585 };
  p[f.k] = { x: 650, y: 585 };
  p[n.a] = { x: 645, y: 690 };
  p[f.a] = { x: 655, y: 690 };
  p[n.e] = { x: 646, y: 385 };
  p[n.w] = placeAtAngle(p[n.s] as Point2, p[n.e] as Point2, interior, 120, -1);
  p[f.e] = { x: 655, y: 380 };
  p[f.w] = { x: 650, y: 490 };
  return p;
}

/** Side view, seated, facing image right; `side` is the near (exercising) leg. */
function kneeExtensionPose(side: BodySide, interior: number): Px {
  const n = side === 'left' ? { h: LM.leftHip, k: LM.leftKnee, a: LM.leftAnkle, s: LM.leftShoulder, e: LM.leftElbow, w: LM.leftWrist } : { h: LM.rightHip, k: LM.rightKnee, a: LM.rightAnkle, s: LM.rightShoulder, e: LM.rightElbow, w: LM.rightWrist };
  const f = side === 'left' ? { h: LM.rightHip, k: LM.rightKnee, a: LM.rightAnkle, s: LM.rightShoulder, e: LM.rightElbow, w: LM.rightWrist } : { h: LM.leftHip, k: LM.leftKnee, a: LM.leftAnkle, s: LM.leftShoulder, e: LM.leftElbow, w: LM.leftWrist };
  const p: Px = {};
  p[LM.nose] = { x: 640, y: 150 };
  p[n.s] = { x: 590, y: 240 };
  p[f.s] = { x: 598, y: 236 };
  p[n.h] = { x: 600, y: 440 };
  p[f.h] = { x: 606, y: 436 };
  p[n.k] = { x: 750, y: 448 };
  p[f.k] = { x: 756, y: 444 };
  p[n.a] = placeAtAngle(p[n.h] as Point2, p[n.k] as Point2, interior, 190, -1);
  p[f.a] = { x: 760, y: 640 };
  p[n.e] = { x: 610, y: 350 };
  p[n.w] = { x: 680, y: 410 };
  p[f.e] = { x: 616, y: 346 };
  p[f.w] = { x: 686, y: 404 };
  return p;
}

/** Side view, sit-to-stand, facing image right; the hip moves around a fixed knee. */
function sitToStandPose(side: BodySide, interior: number): Px {
  const n = side === 'left' ? { h: LM.leftHip, k: LM.leftKnee, a: LM.leftAnkle, s: LM.leftShoulder, e: LM.leftElbow, w: LM.leftWrist } : { h: LM.rightHip, k: LM.rightKnee, a: LM.rightAnkle, s: LM.rightShoulder, e: LM.rightElbow, w: LM.rightWrist };
  const f = side === 'left' ? { h: LM.rightHip, k: LM.rightKnee, a: LM.rightAnkle, s: LM.rightShoulder, e: LM.rightElbow, w: LM.rightWrist } : { h: LM.leftHip, k: LM.leftKnee, a: LM.leftAnkle, s: LM.leftShoulder, e: LM.leftElbow, w: LM.leftWrist };
  const p: Px = {};
  p[n.k] = { x: 700, y: 520 };
  p[n.a] = { x: 690, y: 690 };
  const hip = placeAtAngle(p[n.a] as Point2, p[n.k] as Point2, interior, 175, 1);
  p[n.h] = hip;
  p[f.h] = { x: hip.x + 6, y: hip.y - 4 };
  p[f.k] = { x: 706, y: 516 };
  p[f.a] = { x: 696, y: 688 };
  const shoulder = { x: hip.x + 10, y: hip.y - 200 };
  p[n.s] = shoulder;
  p[f.s] = { x: shoulder.x + 8, y: shoulder.y - 4 };
  p[LM.nose] = { x: shoulder.x + 30, y: shoulder.y - 85 };
  p[n.e] = { x: shoulder.x + 10, y: shoulder.y + 120 };
  p[n.w] = { x: shoulder.x + 60, y: shoulder.y + 190 };
  p[f.e] = { x: shoulder.x + 16, y: shoulder.y + 116 };
  p[f.w] = { x: shoulder.x + 66, y: shoulder.y + 186 };
  return p;
}

export interface SyntheticPoseOptions {
  /** Gaussian-like pixel noise added to every landmark. */
  noisePx?: number;
  /** Visibility overrides by landmark index. */
  visibility?: Partial<Record<number, number>>;
  defaultVisibility?: number;
  /** Visibility for the far-side limbs in side views. */
  farSideVisibility?: number;
  random?: () => number;
  /** Additional trunk lean (degrees, positive = image right) applied to shoulders/head. */
  trunkLeanDeg?: number;
}

/** Builds 33 normalized landmarks where the exercise metric equals `value` (before noise). */
export function buildSyntheticPose(def: ExerciseDefinition, side: BodySide, value: number, opts: SyntheticPoseOptions = {}): Landmark[] {
  const interior = interiorFromValue(def, value);
  const px =
    def.id === 'shoulder-abduction'
      ? shoulderAbductionPose(side, interior)
      : def.id === 'elbow-flexion'
        ? elbowFlexionPose(side, interior)
        : def.id === 'knee-extension'
          ? kneeExtensionPose(side, interior)
          : sitToStandPose(side, interior);

  if (opts.trunkLeanDeg) {
    const lean = (opts.trunkLeanDeg * Math.PI) / 180;
    const hipMid = midpointOf(px[LM.leftHip], px[LM.rightHip]);
    for (const idx of [LM.leftShoulder, LM.rightShoulder, LM.nose, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist]) {
      const pt = px[idx];
      if (!pt || !hipMid) continue;
      const v = rotate({ x: pt.x - hipMid.x, y: pt.y - hipMid.y }, lean);
      px[idx] = { x: hipMid.x + v.x, y: hipMid.y + v.y };
    }
  }

  const rand = opts.random ?? Math.random;
  const noise = opts.noisePx ?? 0;
  const farSide = def.cameraView === 'side' ? (side === 'left' ? 'right' : 'left') : null;
  const out: Landmark[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const base = px[i] ?? fallbackPoint(i, px);
    const nx = noise ? gaussian(rand) * noise : 0;
    const ny = noise ? gaussian(rand) * noise : 0;
    let vis = opts.defaultVisibility ?? 0.95;
    if (farSide && isSideLandmark(i, farSide)) vis = opts.farSideVisibility ?? 0.55;
    const override = opts.visibility?.[i];
    if (override !== undefined) vis = override;
    out.push({ x: (base.x + nx) / SYNTHETIC_FRAME.width, y: (base.y + ny) / SYNTHETIC_FRAME.height, z: 0, visibility: vis });
  }
  return out;
}

function midpointOf(p?: Point2, q?: Point2): Point2 | null {
  return p && q ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } : null;
}

function isSideLandmark(i: number, side: BodySide): boolean {
  if (i < 11) return false;
  return side === 'left' ? i % 2 === 1 : i % 2 === 0;
}

/** Face, hand and foot points are placed near their parent joint. */
function fallbackPoint(i: number, px: Px): Point2 {
  const near = (idx: number, dx: number, dy: number): Point2 => {
    const p = px[idx] ?? { x: 640, y: 360 };
    return { x: p.x + dx, y: p.y + dy };
  };
  if (i <= 10) return near(LM.nose, ((i % 5) - 2) * 6, i > 8 ? 14 : -6);
  if (i === 17 || i === 19 || i === 21) return near(LM.leftWrist, 4, 10);
  if (i === 18 || i === 20 || i === 22) return near(LM.rightWrist, -4, 10);
  if (i === 29 || i === 31) return near(LM.leftAnkle, i === 31 ? 18 : -4, 12);
  if (i === 30 || i === 32) return near(LM.rightAnkle, i === 32 ? 18 : -4, 12);
  return { x: 640, y: 360 };
}

/** Approximately normal noise from the sum of uniforms (deterministic with a seeded PRNG). */
function gaussian(rand: () => number): number {
  return (rand() + rand() + rand() + rand() + rand() + rand() - 3) / 1;
}

/** Small deterministic PRNG so simulations and tests are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RepScript {
  /** Peak value reached in this repetition. */
  peak: number;
  restMs: number;
  outboundMs: number;
  holdMs: number;
  returnMs: number;
}

const easeInOut = (x: number) => 0.5 - Math.cos(Math.PI * x) / 2;

/** Value of the metric at time `t` (ms from start) for a sequence of scripted repetitions. */
export function scriptedValue(neutral: number, reps: RepScript[], t: number): number {
  let cursor = 0;
  for (const r of reps) {
    if (t < cursor + r.restMs) return neutral;
    cursor += r.restMs;
    if (t < cursor + r.outboundMs) return neutral + (r.peak - neutral) * easeInOut((t - cursor) / r.outboundMs);
    cursor += r.outboundMs;
    if (t < cursor + r.holdMs) return r.peak;
    cursor += r.holdMs;
    if (t < cursor + r.returnMs) return r.peak + (neutral - r.peak) * easeInOut((t - cursor) / r.returnMs);
    cursor += r.returnMs;
  }
  return neutral;
}

export function scriptDuration(reps: RepScript[], tailMs = 800): number {
  return reps.reduce((s, r) => s + r.restMs + r.outboundMs + r.holdMs + r.returnMs, 0) + tailMs;
}

export interface FrameSequenceOptions extends SyntheticPoseOptions {
  fps?: number;
  startTime?: number;
  /** Return true to drop the person entirely for that frame (camera/model sees no one). */
  dropFrame?: (t: number) => boolean;
  /** Return per-frame visibility overrides (e.g. to simulate occlusion). */
  visibilityAt?: (t: number) => Partial<Record<number, number>> | undefined;
  /** Additive offset to the metric at time t (e.g. to inject a sudden jump). */
  offsetAt?: (t: number) => number;
  trunkLeanAt?: (t: number) => number;
}

/** Generates a deterministic stream of PoseFrames following a repetition script. */
export function generateFrames(
  def: ExerciseDefinition,
  side: BodySide,
  neutral: number,
  reps: RepScript[],
  opts: FrameSequenceOptions = {},
): PoseFrame[] {
  const fps = opts.fps ?? 30;
  const start = opts.startTime ?? 1000;
  const total = scriptDuration(reps);
  const frames: PoseFrame[] = [];
  for (let t = 0; t <= total; t += 1000 / fps) {
    const ts = Math.round((start + t) * 1000) / 1000;
    if (opts.dropFrame?.(t)) {
      frames.push({ timestamp: ts, landmarks: null, imageWidth: SYNTHETIC_FRAME.width, imageHeight: SYNTHETIC_FRAME.height, provider: SIMULATED_PROVIDER_INFO, status: 'no-pose' });
      continue;
    }
    const value = scriptedValue(neutral, reps, t) + (opts.offsetAt?.(t) ?? 0);
    const landmarks = buildSyntheticPose(def, side, value, {
      ...opts,
      visibility: { ...opts.visibility, ...opts.visibilityAt?.(t) },
      trunkLeanDeg: opts.trunkLeanAt?.(t) ?? opts.trunkLeanDeg,
    });
    frames.push({ timestamp: ts, landmarks, imageWidth: SYNTHETIC_FRAME.width, imageHeight: SYNTHETIC_FRAME.height, provider: SIMULATED_PROVIDER_INFO, status: 'ok' });
  }
  return frames;
}

/** A standard script of `count` repetitions peaking around `peak` (± variation). */
export function standardScript(count: number, peak: number, opts: { holdMs?: number; variation?: number; seed?: number; restMs?: number } = {}): RepScript[] {
  const rand = seededRandom(opts.seed ?? 7);
  return Array.from({ length: count }, () => ({
    peak: peak + ((rand() - 0.5) * 2 * (opts.variation ?? 0)),
    restMs: opts.restMs ?? 900,
    outboundMs: 1300 + rand() * 300,
    holdMs: opts.holdMs ?? 300,
    returnMs: 1400 + rand() * 300,
  }));
}
