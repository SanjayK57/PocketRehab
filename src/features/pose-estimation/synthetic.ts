import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame, type PoseProviderInfo, type WorldLandmark } from '@/types/pose';
import type { DemoPose, ExerciseDefinition } from '@/types/exercise';
import type { FormCheckId } from '@/types/form';
import type { BodySide } from '@/lib/validation/schemas';
import { add3, cross3, dot3, mid3, norm3, rotate3, scale3, sub3, unit3, v3, type Vec3 } from '@/features/movement-analysis/geometry';
import { interiorFromValue } from '@/features/movement-analysis/quality';

/**
 * Synthetic pose generation. Builds a full 33-landmark person in 3D (metres,
 * adult proportions), poses it so the exercise's joint angle equals a
 * requested value exactly, optionally adds form faults and a body rotation,
 * then "films" it with a pinhole camera like a laptop webcam. The result has
 * both image landmarks and consistent metric world landmarks, like MediaPipe.
 *
 * Used by:
 * - the clearly labeled "Simulated demo" session mode (no camera),
 * - the 3D demonstration figure (driven by the world landmarks),
 * - unit/integration tests and the quantitative evaluation harness (ground truth is known exactly).
 * It is not camera data and is never presented as the user's measurement.
 */

export const SYNTHETIC_FRAME = { width: 1280, height: 720 } as const;
/** Focal length in pixels for a 65° horizontal field of view (a typical laptop webcam). */
const FOCAL_PX = SYNTHETIC_FRAME.width / 2 / Math.tan((32.5 * Math.PI) / 180);

export const SIMULATED_PROVIDER_INFO: PoseProviderInfo = {
  name: 'PocketRehab simulator',
  model: 'synthetic-skeleton',
  version: '2.0.0',
  kind: 'simulated',
  delegate: 'none',
};

/**
 * Deliberate form faults a synthetic pose can show, as amplitudes at this
 * instant. They let tests, the evaluation and the simulated demo exercise
 * every form check with known ground truth.
 */
export interface PoseFaults {
  /** Elbow bent this many degrees (arm raise: elbow-straight). */
  elbowBendDeg?: number;
  /** Arm raised this many degrees in front of the side plane (arm raise: arm-to-side). */
  armForwardDeg?: number;
  /** Shoulder hitched up toward the ear, in metres (arm raise: shoulder-relaxed). */
  shrugM?: number;
  /** Trunk leaning sideways, away from the exercising arm, in degrees (arm raise: trunk-upright). */
  leanSideDeg?: number;
  /** Trunk leaning forward (+) or back (−), in degrees (curl: no-swing; knee: sit-tall; sit to stand: stand-tall). */
  leanForwardDeg?: number;
  /** Upper arm swung forward from the trunk, in degrees (curl: upper-arm-still). */
  upperArmSwingDeg?: number;
  /** Thigh lifted off the chair, in degrees (knee straightening: thigh-still). */
  thighLiftDeg?: number;
}

export interface SyntheticPoseOptions {
  /** Gaussian landmark noise in the image: standard deviation in pixels. */
  noisePx?: number;
  /** Gaussian world-landmark noise across the image plane (x, y): standard deviation in metres. */
  worldNoiseM?: number;
  /** Gaussian world-landmark depth (z) noise in metres. Defaults to twice `worldNoiseM`, as MediaPipe depth is the least certain axis. */
  worldDepthNoiseM?: number;
  /** Visibility overrides by landmark index. */
  visibility?: Partial<Record<number, number>>;
  defaultVisibility?: number;
  /** Visibility for the far-side limbs in side views. */
  farSideVisibility?: number;
  random?: () => number;
  /** Lean of the upper body in the image plane, in degrees (positive = top of the torso toward image right). */
  trunkLeanDeg?: number;
  /** Whole-body turn about the vertical axis, in degrees (0 = the exercise's intended camera view). */
  yawDeg?: number;
  faults?: PoseFaults;
}

export interface SyntheticBody {
  /** Normalized image landmarks (what a camera model would return). */
  landmarks: Landmark[];
  /** Metric world landmarks: hip-centred metres, x right, y down, z away from the camera. */
  world: WorldLandmark[];
}

// Adult proportions in metres (approximately 50th percentile).
const BODY = {
  shoulderHalf: 0.19,
  hipHalf: 0.09,
  torso: 0.5,
  upperArm: 0.29,
  forearm: 0.25,
  thigh: 0.43,
  shank: 0.42,
  ankleHeight: 0.08,
} as const;

/**
 * Body/scene axes. Points are built as Vec3 in BODY coordinates where
 * x = the person's left, y = up, z = the person's forward (anterior), origin on
 * the floor under the yaw pivot.
 */
const L = v3(1, 0, 0);
const U = v3(0, 1, 0);
const F = v3(0, 0, 1);
const rad = (deg: number) => (deg * Math.PI) / 180;

type Joints = Map<number, Vec3>;

interface Scene {
  joints: Joints;
  /** Point the body turns around for `yawDeg`. */
  pivot: Vec3;
  view: 'front' | 'side';
  camera: { distance: number; height: number };
  /** Trunk lean toward the person's front (negative = back), applied after the head and hands are placed. */
  leanForwardDeg: number;
}

/** Direction `dir` bent by `deg` toward `toward` (the part of `toward` perpendicular to `dir`). */
function bend(dir: Vec3, toward: Vec3, deg: number): Vec3 {
  const perp = unit3(sub3(toward, scale3(dir, dot3(toward, dir)))) ?? toward;
  return add3(scale3(dir, Math.cos(rad(deg))), scale3(perp, Math.sin(rad(deg))));
}

function sideIdx(side: BodySide) {
  return side === 'left'
    ? { s: LM.leftShoulder, e: LM.leftElbow, w: LM.leftWrist, h: LM.leftHip, k: LM.leftKnee, a: LM.leftAnkle, out: 1 }
    : { s: LM.rightShoulder, e: LM.rightElbow, w: LM.rightWrist, h: LM.rightHip, k: LM.rightKnee, a: LM.rightAnkle, out: -1 };
}
const other = (side: BodySide): BodySide => (side === 'left' ? 'right' : 'left');

/** Head, face, hands and feet placed from the main joints so the skeleton is complete and plausible. */
function addExtremities(j: Joints, trunkUp: Vec3): void {
  const ls = j.get(LM.leftShoulder) as Vec3;
  const rs = j.get(LM.rightShoulder) as Vec3;
  const shoulderMid = mid3(ls, rs);
  const lateral = unit3(sub3(ls, rs)) ?? L;
  const fwd = unit3(cross3(lateral, trunkUp)) ?? F;
  const head = add3(shoulderMid, scale3(trunkUp, 0.16));
  const at = (l: number, u: number, f: number) => add3(add3(add3(head, scale3(lateral, l)), scale3(trunkUp, u)), scale3(fwd, f));
  j.set(LM.nose, at(0, 0.02, 0.1));
  j.set(1, at(0.02, 0.045, 0.085));
  j.set(2, at(0.035, 0.045, 0.08));
  j.set(3, at(0.05, 0.045, 0.07));
  j.set(4, at(-0.02, 0.045, 0.085));
  j.set(5, at(-0.035, 0.045, 0.08));
  j.set(6, at(-0.05, 0.045, 0.07));
  j.set(LM.leftEar, at(0.075, 0.01, 0));
  j.set(LM.rightEar, at(-0.075, 0.01, 0));
  j.set(9, at(0.025, -0.035, 0.09));
  j.set(10, at(-0.025, -0.035, 0.09));
  for (const [e, w, pinky, index, thumb] of [
    [LM.leftElbow, LM.leftWrist, 17, 19, 21],
    [LM.rightElbow, LM.rightWrist, 18, 20, 22],
  ] as const) {
    const wrist = j.get(w) as Vec3;
    const dir = unit3(sub3(wrist, j.get(e) as Vec3)) ?? scale3(U, -1);
    j.set(pinky, add3(wrist, scale3(dir, 0.07)));
    j.set(index, add3(add3(wrist, scale3(dir, 0.08)), scale3(fwd, 0.015)));
    j.set(thumb, add3(add3(wrist, scale3(dir, 0.04)), scale3(fwd, 0.03)));
  }
  for (const [k, a, heel, toe] of [
    [LM.leftKnee, LM.leftAnkle, 29, 31],
    [LM.rightKnee, LM.rightAnkle, 30, 32],
  ] as const) {
    const ankle = j.get(a) as Vec3;
    const shin = unit3(sub3(ankle, j.get(k) as Vec3)) ?? scale3(U, -1);
    // The foot sits at a right angle to the shin, toes forward: rotate the shin direction +90° in the sagittal plane.
    const foot = unit3(add3(scale3(F, -dot3(shin, U)), scale3(U, dot3(shin, F)))) ?? F;
    j.set(heel, add3(add3(ankle, scale3(foot, -0.05)), scale3(shin, 0.05)));
    j.set(toe, add3(add3(ankle, scale3(foot, 0.16)), scale3(shin, 0.05)));
  }
}

const DOWN = scale3(U, -1);

function setLeg(j: Joints, s: BodySide, hip: Vec3, thighDir: Vec3, shinDir: Vec3): void {
  const i = sideIdx(s);
  const knee = add3(hip, scale3(thighDir, BODY.thigh));
  j.set(i.h, hip);
  j.set(i.k, knee);
  j.set(i.a, add3(knee, scale3(shinDir, BODY.shank)));
}

function setArm(j: Joints, s: BodySide, upperDir: Vec3, foreDir: Vec3): void {
  const i = sideIdx(s);
  const elbow = add3(j.get(i.s) as Vec3, scale3(upperDir, BODY.upperArm));
  j.set(i.e, elbow);
  j.set(i.w, add3(elbow, scale3(foreDir, BODY.forearm)));
}

/** The resting posture: standing tall, or seated on a chair with knees at 90° and hands on the thighs. */
function posture(kind: DemoPose['posture']): { joints: Joints; hipC: Vec3 } {
  const j: Joints = new Map();
  const seated = kind === 'seated';
  const hipC = v3(0, BODY.ankleHeight + BODY.shank + (seated ? 0 : BODY.thigh), 0);
  for (const s of ['left', 'right'] as const) {
    setLeg(j, s, add3(hipC, scale3(L, sideIdx(s).out * BODY.hipHalf)), seated ? F : DOWN, DOWN);
  }
  const top = add3(hipC, scale3(U, BODY.torso));
  j.set(LM.leftShoulder, add3(top, scale3(L, BODY.shoulderHalf)));
  j.set(LM.rightShoulder, add3(top, scale3(L, -BODY.shoulderHalf)));
  for (const s of ['left', 'right'] as const) {
    if (seated) setArm(j, s, bend(DOWN, F, 18), unit3(add3(scale3(F, 0.95), scale3(U, -0.3))) ?? F);
    else {
      const upper = bend(DOWN, F, 4);
      setArm(j, s, upper, bend(upper, F, 10));
    }
  }
  return { joints: j, hipC };
}

/** Rotates the listed joints about `pivot` so that direction `from` turns onto `to`. */
function swing(j: Joints, pivot: Vec3, from: Vec3, to: Vec3, ids: number[]): void {
  const axis = unit3(cross3(from, to));
  const cos = Math.min(1, Math.max(-1, dot3(unit3(from) ?? from, unit3(to) ?? to)));
  if (!axis || cos > 1 - 1e-12) return;
  const angle = Math.acos(cos);
  for (const id of ids) {
    const p = j.get(id);
    if (p) j.set(id, add3(pivot, rotate3(sub3(p, pivot), axis, angle)));
  }
}

/** Joints carried by a moving joint (the elbow carries the wrist, the knee the ankle). */
const CARRIED: Record<number, number[]> = {
  [LM.leftShoulder]: [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder]: [LM.rightElbow, LM.rightWrist],
  [LM.leftElbow]: [LM.leftWrist],
  [LM.rightElbow]: [LM.rightWrist],
  [LM.leftKnee]: [LM.leftAnkle],
  [LM.rightKnee]: [LM.rightAnkle],
};

/**
 * Builds the posed person for any exercise from its definition: the posture
 * (`def.demo.pose`), then the metric's moving segment turned about joint B so
 * the metric reads exactly `value`, plus any requested faults.
 */
function buildScene(def: ExerciseDefinition, side: BodySide, value: number, f: PoseFaults): Scene {
  const pose = def.demo.pose;
  const { joints: j, hipC: restHip } = posture(pose.posture);
  const i = sideIdx(side);
  const out = scale3(L, i.out);
  const toward = { outward: out, forward: F, backward: scale3(F, -1), up: U, down: DOWN }[pose.bendToward];
  const at = (id: number) => j.get(id) as Vec3;

  // Faults that change where the measured joint sits, applied before the joint is posed.
  if (f.upperArmSwingDeg) swing(j, at(i.s), sub3(at(i.e), at(i.s)), bend(unit3(sub3(at(i.e), at(i.s))) ?? DOWN, F, f.upperArmSwingDeg), [i.e, i.w]);
  if (f.thighLiftDeg) swing(j, at(i.h), sub3(at(i.k), at(i.h)), bend(unit3(sub3(at(i.k), at(i.h))) ?? F, U, f.thighLiftDeg), [i.k, i.a]);

  const { a, b, c } = def.metric.landmarks[side];
  const interior = interiorFromValue(def, value);
  let lean = f.leanForwardDeg ?? 0;
  if (pose.riseLeanDeg !== undefined) {
    // Rising from a chair: both thighs turn about the fixed knees and the upper body rides on the hips.
    for (const s of ['left', 'right'] as const) {
      const k = sideIdx(s);
      const knee = at(k.k);
      j.set(k.h, add3(knee, scale3(bend(unit3(sub3(at(k.a), knee)) ?? DOWN, toward, interior), BODY.thigh)));
    }
    const shift = sub3(mid3(at(LM.leftHip), at(LM.rightHip)), restHip);
    for (const id of [11, 12, 13, 14, 15, 16]) j.set(id, add3(at(id), shift));
    const span = def.demo.peak - def.demo.neutral;
    lean += pose.riseLeanDeg * Math.min(1, Math.max(0, 1 - (value - def.demo.neutral) / (span || 1)));
  } else {
    const ref = def.metric.kind === 'elevation' ? DOWN : unit3(sub3(at(a), at(b))) ?? DOWN;
    const plane = f.armForwardDeg ? add3(scale3(toward, Math.cos(rad(f.armForwardDeg))), scale3(F, Math.sin(rad(f.armForwardDeg)))) : toward;
    const dir = bend(ref, plane, interior);
    const carried = CARRIED[c] ?? [];
    const before = sub3(at(c), at(b));
    j.set(c, add3(at(b), scale3(dir, norm3(before))));
    // The segment beyond the moving joint continues straight (an arm raised with a straight elbow).
    for (const id of carried) j.set(id, add3(at(c), scale3(dir, norm3(sub3(at(id), add3(at(b), before))))));
  }
  if (f.elbowBendDeg) {
    const upper = unit3(sub3(at(i.e), at(i.s))) ?? DOWN;
    j.set(i.w, add3(at(i.e), scale3(bend(upper, F, f.elbowBendDeg), BODY.forearm)));
  }

  const hipC = mid3(at(LM.leftHip), at(LM.rightHip));
  const seated = pose.posture === 'seated' && pose.riseLeanDeg === undefined;
  const scene: Scene = {
    joints: j,
    pivot: seated ? hipC : v3(0, 0, 0),
    view: def.cameraView,
    camera: seated ? { distance: 2.6, height: 0.75 } : { distance: def.cameraView === 'front' || pose.riseLeanDeg !== undefined ? 3.2 : 3.0, height: pose.riseLeanDeg !== undefined ? 0.95 : 1.0 },
    leanForwardDeg: lean,
  };
  return scene;
}

/** Points that move with the trunk when it leans (head, shoulders, arms, hands). */
const UPPER_BODY = Array.from({ length: 23 }, (_, i) => i);

function tiltUpperBody(j: Joints, pivot: Vec3, toward: Vec3, deg: number): void {
  if (!deg) return;
  const axis = unit3(cross3(U, toward));
  if (!axis) return;
  for (const idx of UPPER_BODY) {
    const p = j.get(idx);
    if (p) j.set(idx, add3(pivot, rotate3(sub3(p, pivot), axis, rad(deg))));
  }
}

/**
 * Camera axes expressed in body coordinates. Front view: the person faces the
 * camera, so their left appears on image right. Side view: the camera looks
 * at the exercising side, so the person faces image right for the right side
 * and image left for the left side.
 */
function cameraAxes(view: 'front' | 'side', side: BodySide): { x: Vec3; y: Vec3; z: Vec3 } {
  if (view === 'front') return { x: L, y: DOWN, z: scale3(F, -1) };
  return side === 'right' ? { x: F, y: DOWN, z: L } : { x: scale3(F, -1), y: DOWN, z: scale3(L, -1) };
}

/** Builds the 3D person and films it. Image landmarks and world landmarks describe the same pose. */
export function buildSyntheticBody(def: ExerciseDefinition, side: BodySide, value: number, opts: SyntheticPoseOptions = {}): SyntheticBody {
  const faults = opts.faults ?? {};
  const scene = buildScene(def, side, value, faults);
  const j = scene.joints;
  const hipC = () => mid3(j.get(LM.leftHip) as Vec3, j.get(LM.rightHip) as Vec3);
  const cam = cameraAxes(scene.view, side);

  addExtremities(j, unit3(sub3(mid3(j.get(LM.leftShoulder) as Vec3, j.get(LM.rightShoulder) as Vec3), hipC())) ?? U);
  // A shrug lifts one shoulder and its arm; the head stays where it was.
  if (faults.shrugM) {
    const arm = side === 'left' ? [LM.leftShoulder, LM.leftElbow, LM.leftWrist, 17, 19, 21] : [LM.rightShoulder, LM.rightElbow, LM.rightWrist, 18, 20, 22];
    for (const id of arm) j.set(id, add3(j.get(id) as Vec3, scale3(U, faults.shrugM)));
  }
  if (faults.leanSideDeg) tiltUpperBody(j, hipC(), scale3(L, -sideIdx(side).out), faults.leanSideDeg);
  tiltUpperBody(j, hipC(), F, scene.leanForwardDeg);
  if (opts.trunkLeanDeg) tiltUpperBody(j, hipC(), cam.x, opts.trunkLeanDeg);
  if (opts.yawDeg) {
    for (const [idx, p] of j) j.set(idx, add3(scene.pivot, rotate3(sub3(p, scene.pivot), U, rad(opts.yawDeg))));
  }

  // Body coordinates → camera coordinates (metres; x right, y down, z away from the camera).
  const toCam = (p: Vec3): Vec3 => {
    const d = sub3(p, v3(scene.pivot.x, scene.camera.height, scene.pivot.z));
    return v3(dot3(d, cam.x), dot3(d, cam.y), dot3(d, cam.z) + scene.camera.distance);
  };
  const hip = toCam(hipC());

  const rand = opts.random ?? Math.random;
  const noise = opts.noisePx ?? 0;
  const wNoise = opts.worldNoiseM ?? 0;
  const zNoise = opts.worldDepthNoiseM ?? wNoise * 2;
  const g = (sd: number) => (sd ? gaussian(rand) * sd : 0);
  const farSide = scene.view === 'side' ? other(side) : null;
  const landmarks: Landmark[] = [];
  const world: WorldLandmark[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const c = toCam(j.get(i) ?? hipC());
    let vis = opts.defaultVisibility ?? 0.95;
    if (farSide && isSideLandmark(i, farSide)) vis = opts.farSideVisibility ?? 0.55;
    const override = opts.visibility?.[i];
    if (override !== undefined) vis = override;
    const px = SYNTHETIC_FRAME.width / 2 + (FOCAL_PX * c.x) / c.z + g(noise);
    const py = SYNTHETIC_FRAME.height / 2 + (FOCAL_PX * c.y) / c.z + g(noise);
    landmarks.push({
      x: px / SYNTHETIC_FRAME.width,
      y: py / SYNTHETIC_FRAME.height,
      // MediaPipe-style relative depth: hip-centred, roughly the same scale as x.
      z: ((c.z - hip.z) * FOCAL_PX) / hip.z / SYNTHETIC_FRAME.width,
      visibility: vis,
    });
    world.push({ x: c.x - hip.x + g(wNoise), y: c.y - hip.y + g(wNoise), z: c.z - hip.z + g(zNoise), visibility: vis });
  }
  return { landmarks, world };
}

/** Image landmarks only (see buildSyntheticBody for world landmarks too). */
export function buildSyntheticPose(def: ExerciseDefinition, side: BodySide, value: number, opts: SyntheticPoseOptions = {}): Landmark[] {
  return buildSyntheticBody(def, side, value, opts).landmarks;
}

function isSideLandmark(i: number, side: BodySide): boolean {
  if (i < 11) return side === 'left' ? [1, 2, 3, 7, 9].includes(i) : [4, 5, 6, 8, 10].includes(i);
  return side === 'left' ? i % 2 === 1 : i % 2 === 0;
}

/** Standard normal sample (Box–Muller), deterministic with a seeded PRNG. */
function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
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
  /** Value held during the rest before this repetition (default: the neutral value), e.g. to start with a bent arm. */
  restValue?: number;
  /** Form faults shown in this repetition, at full strength at the peak. */
  faults?: PoseFaults;
}

const easeInOut = (x: number) => 0.5 - Math.cos(Math.PI * x) / 2;

function scaleFaults(f: PoseFaults | undefined, k: number): PoseFaults {
  if (!f || k <= 0) return {};
  const out: PoseFaults = {};
  for (const [key, v] of Object.entries(f) as Array<[keyof PoseFaults, number | undefined]>) if (v) out[key] = v * k;
  return out;
}

/** Metric value and fault amplitudes at time `t` (ms from start) for a sequence of scripted repetitions. */
export function scriptedState(neutral: number, reps: RepScript[], t: number): { value: number; faults: PoseFaults } {
  let cursor = 0;
  for (const r of reps) {
    const rest = r.restValue ?? neutral;
    // Faults grow with the movement: none at rest, full strength at the peak.
    const at = (value: number) => ({ value, faults: scaleFaults(r.faults, r.peak === rest ? 1 : (value - rest) / (r.peak - rest)) });
    // Settle into a different rest position over the first half of the rest instead of jumping there.
    if (t < cursor + r.restMs) return { value: neutral + (rest - neutral) * easeInOut(Math.min(1, (t - cursor) / (r.restMs * 0.5))), faults: {} };
    cursor += r.restMs;
    if (t < cursor + r.outboundMs) return at(rest + (r.peak - rest) * easeInOut((t - cursor) / r.outboundMs));
    cursor += r.outboundMs;
    if (t < cursor + r.holdMs) return at(r.peak);
    cursor += r.holdMs;
    if (t < cursor + r.returnMs) {
      const value = r.peak + (neutral - r.peak) * easeInOut((t - cursor) / r.returnMs);
      return { value, faults: scaleFaults(r.faults, r.peak === neutral ? 1 : (value - neutral) / (r.peak - neutral)) };
    }
    cursor += r.returnMs;
  }
  return { value: neutral, faults: {} };
}

/** Value of the metric at time `t` (ms from start) for a sequence of scripted repetitions. */
export function scriptedValue(neutral: number, reps: RepScript[], t: number): number {
  return scriptedState(neutral, reps, t).value;
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
  /** Omit world landmarks, like a 2D-only pose provider. */
  imageOnly?: boolean;
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
  const base = { imageWidth: SYNTHETIC_FRAME.width, imageHeight: SYNTHETIC_FRAME.height, provider: SIMULATED_PROVIDER_INFO };
  for (let t = 0; t <= total; t += 1000 / fps) {
    const ts = Math.round((start + t) * 1000) / 1000;
    if (opts.dropFrame?.(t)) {
      frames.push({ ...base, timestamp: ts, landmarks: null, world: null, status: 'no-pose' });
      continue;
    }
    const state = scriptedState(neutral, reps, t);
    const body = buildSyntheticBody(def, side, state.value + (opts.offsetAt?.(t) ?? 0), {
      ...opts,
      visibility: { ...opts.visibility, ...opts.visibilityAt?.(t) },
      trunkLeanDeg: opts.trunkLeanAt?.(t) ?? opts.trunkLeanDeg,
      faults: { ...opts.faults, ...state.faults },
    });
    frames.push({ ...base, timestamp: ts, landmarks: body.landmarks, world: opts.imageOnly ? null : body.world, status: 'ok' });
  }
  return frames;
}

/** A standard script of `count` repetitions peaking around `peak` (± variation). */
export function standardScript(count: number, peak: number, opts: { holdMs?: number; variation?: number; seed?: number; restMs?: number } = {}): RepScript[] {
  const rand = seededRandom(opts.seed ?? 7);
  return Array.from({ length: count }, () => ({
    peak: peak + (rand() - 0.5) * 2 * (opts.variation ?? 0),
    restMs: opts.restMs ?? 900,
    outboundMs: 1300 + rand() * 300,
    holdMs: opts.holdMs ?? 300,
    returnMs: 1400 + rand() * 300,
  }));
}

/**
 * The rep that demonstrates each form check failing, so the simulated demo
 * shows every check of an exercise firing. Null when the check cannot be shown
 * with this prescription (no hold, or a target already at the joint's limit).
 */
export const CHECK_FAULT_REP: Record<FormCheckId, (def: ExerciseDefinition, holdMs: number) => Partial<RepScript> | null> = {
  'elbow-straight': () => ({ faults: { elbowBendDeg: 45 } }),
  'arm-to-side': () => ({ faults: { armForwardDeg: 55 } }),
  'shoulder-relaxed': () => ({ faults: { shrugM: 0.08 } }),
  'trunk-upright': () => ({ faults: { leanSideDeg: 16 } }),
  'upper-arm-still': () => ({ faults: { upperArmSwingDeg: 35 } }),
  // Rest with the elbow bent: still inside the start position, but past the start-straight limit.
  'start-straight': (def) => ({ restValue: ((def.formChecks['start-straight']?.maxStartDeg ?? 25) + def.segmentation.neutralMax) / 2 }),
  'no-swing': () => ({ faults: { leanForwardDeg: -15 } }),
  'sit-tall': () => ({ faults: { leanForwardDeg: -20 } }),
  'thigh-still': () => ({ faults: { thighLiftDeg: 20 } }),
  'hold-time': (_def, holdMs) => (holdMs >= 1000 ? { holdMs: Math.round(holdMs * 0.35) } : null),
  'stand-tall': () => ({ faults: { leanForwardDeg: 28 } }),
  'controlled-sit': () => ({ returnMs: 600 }),
  'controlled-return': () => ({ returnMs: 380 }),
  'steady-pace': () => ({ outboundMs: 420 }),
  'within-target': (def) => {
    const target = def.demoPrescription.target;
    const limit = def.metric.transform === 'supplement' ? 160 : 178;
    const peak = Math.min(limit, (target.max ?? def.demo.peak) + 12);
    return peak > (target.max ?? Infinity) + (def.formChecks['within-target']?.pastToleranceDeg ?? 5) ? { peak } : null;
  },
};

/**
 * The repeating script of the simulated demo, built from the exercise's own
 * checks: clean repetitions with natural variation, one movement that falls
 * short of counting, and one repetition showing each check's fault. Clearly
 * simulated; never the user's data.
 */
export function demoScript(def: ExerciseDefinition, opts: { holdMs?: number; peak?: number; random?: () => number } = {}): RepScript[] {
  const rand = opts.random ?? seededRandom(11);
  const peak = opts.peak ?? def.demo.peak;
  const holdMs = Math.max(250, opts.holdMs ?? 0);
  const short = def.demo.neutral + (def.segmentation.countMin - def.demo.neutral) * 0.7;
  const rep = (over: Partial<RepScript> = {}): RepScript => ({
    peak: peak + (rand() - 0.5) * 8,
    restMs: 1100 + rand() * 500,
    outboundMs: 1300 + rand() * 400,
    holdMs,
    returnMs: 1400 + rand() * 400,
    ...over,
  });
  const faults = (Object.keys(def.formChecks) as FormCheckId[])
    .map((id) => CHECK_FAULT_REP[id](def, opts.holdMs ?? 0))
    .filter((f): f is Partial<RepScript> => f !== null);
  const script = [rep()];
  faults.forEach((f, i) => {
    script.push(rep(f));
    if (i === 0) script.push(rep(), rep({ peak: short }));
    else if (i % 2 === 1) script.push(rep());
  });
  return script;
}
