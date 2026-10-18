import { LM, type Landmark, type WorldLandmark } from '@/types/pose';
import type { DemoPose, ExerciseDefinition } from '@/types/exercise';
import type { BodySide } from '@/lib/validation/schemas';
import { interiorFromValue } from '@/features/movement-analysis/quality';

/**
 * Pure geometry that turns pose landmarks into the joint centres of the 3D
 * figure. No three.js here, so it is unit-tested in jsdom and stays out of the
 * lazily loaded renderer chunk.
 *
 * Scene space: metres, x to the image right, y up, z toward the camera
 * (three.js convention). MediaPipe world landmarks use y down and z away from
 * the camera, so they are flipped on the way in.
 *
 * Two retargeting modes share one code path:
 * - `canonical` (exercise demonstration): limb DIRECTIONS come from the pose,
 *   limb LENGTHS from adult proportions, and the torso is scaled uniformly.
 *   Uniform scaling and length changes never change an angle between two
 *   segments, so the figure shows exactly the joint angle the engine measures,
 *   whatever proportions the synthetic generator happens to use.
 * - `data` (simulated live stage): joints sit exactly where the pose puts them,
 *   so the AR overlay drawn from the same landmarks lines up with the figure.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const mid = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);

/** Unit vector, or `fallback` when the input is (numerically) zero or not finite. */
export function unit(a: Vec3, fallback: Vec3 = v3(0, 1, 0)): Vec3 {
  const m = length(a);
  return m > 1e-9 && Number.isFinite(m) ? scale(a, 1 / m) : fallback;
}

/** Component of `a` orthogonal to the unit vector `n`, normalized. */
export function orthonormal(a: Vec3, n: Vec3, fallback: Vec3): Vec3 {
  return unit(sub(a, scale(n, dot(a, n))), fallback);
}

/** Interior angle in degrees between two vectors. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const c = dot(unit(a), unit(b));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/** Adult proportions in metres (rounded from standard anthropometric tables). */
export const BODY = {
  torso: 0.5, // hip-joint midpoint to shoulder-joint midpoint
  upperArm: 0.3,
  forearm: 0.26,
  thigh: 0.43,
  shin: 0.42,
  /** Ankle-joint centre above the sole of a flat foot. */
  ankleHeight: 0.075,
} as const;

export interface SideJoints {
  shoulder: Vec3;
  elbow: Vec3;
  wrist: Vec3;
  hip: Vec3;
  knee: Vec3;
  ankle: Vec3;
}

export interface Rig {
  hipMid: Vec3;
  shoulderMid: Vec3;
  /** Body frame: trunk axis, the figure's lateral axis and the direction it faces. */
  up: Vec3;
  lateral: Vec3;
  forward: Vec3;
  /** Neck/head axis (follows lateral head tilt from the nose landmark). */
  headUp: Vec3;
  left: SideJoints;
  right: SideJoints;
}

export type RigMode = 'canonical' | 'data';

const SIDE_INDEX = {
  left: { shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist, hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle },
  right: { shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist, hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle },
} as const;

const REQUIRED = [LM.nose, ...Object.values(SIDE_INDEX.left), ...Object.values(SIDE_INDEX.right)];

/** The rig joint for a MediaPipe landmark index (used to find the measured joint). */
export function rigJoint(rig: Rig, index: number): Vec3 | null {
  for (const s of ['left', 'right'] as const) {
    for (const [k, i] of Object.entries(SIDE_INDEX[s])) if (i === index) return rig[s][k as keyof SideJoints];
  }
  return null;
}

const finite3 = (p: Vec3) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

/** Lateral half-offsets used to give side-view images depth when no world landmarks exist. */
const SIDE_DEPTH = { shoulder: 0.18, elbow: 0.2, wrist: 0.2, hip: 0.1, knee: 0.1, ankle: 0.1 } as const;

/**
 * Depth (scene z, metres, relative to the hip midpoint) for each landmark.
 * World landmarks win when present; otherwise front views are flat and side
 * views put the exercising (near) side toward the camera, as in the synthetic
 * generator. Either way the near side ends up in front: some generators use
 * the opposite handedness, so depth is mirrored when the exercising side would
 * be hidden. Mirroring preserves every joint angle.
 */
export function landmarkDepths(world: WorldLandmark[] | null | undefined, def: ExerciseDefinition, side: BodySide): number[] {
  const depth = new Array<number>(33).fill(0);
  const usable = world && world.length >= 29 && REQUIRED.every((i) => Number.isFinite(world[i]?.z));
  if (usable) {
    const hipZ = -(((world[LM.leftHip]?.z ?? 0) + (world[LM.rightHip]?.z ?? 0)) / 2);
    for (let i = 0; i < depth.length; i++) depth[i] = -(world[i]?.z ?? 0) - hipZ || 0;
  } else if (def.cameraView === 'side') {
    for (const s of ['left', 'right'] as const) {
      const sign = s === side ? 1 : -1;
      for (const [k, i] of Object.entries(SIDE_INDEX[s])) depth[i] = sign * SIDE_DEPTH[k as keyof typeof SIDE_DEPTH];
    }
  }
  if (def.cameraView === 'side') {
    const near = SIDE_INDEX[side];
    const far = SIDE_INDEX[side === 'left' ? 'right' : 'left'];
    if ((depth[near.hip] ?? 0) + (depth[near.shoulder] ?? 0) < (depth[far.hip] ?? 0) + (depth[far.shoulder] ?? 0)) {
      for (let i = 0; i < depth.length; i++) depth[i] = -(depth[i] ?? 0);
    }
  }
  return depth;
}

/** Pixel position of a normalized landmark. */
const px = (lm: Landmark | undefined, w: number, h: number) => ({ x: (lm?.x ?? NaN) * w, y: (lm?.y ?? NaN) * h });

/**
 * 3D points for the demonstration: image pixels scaled to metres by the trunk
 * length, with depth from {@link landmarkDepths}. Only directions and the
 * torso shape are used downstream (canonical retargeting), so the scale is
 * not critical. Returns null when a required landmark is missing.
 */
export function posePoints(landmarks: Landmark[], frameW: number, frameH: number, world: WorldLandmark[] | null | undefined, def: ExerciseDefinition, side: BodySide): Vec3[] | null {
  const depth = landmarkDepths(world, def, side);
  const p = landmarks.map((lm) => px(lm, frameW, frameH));
  const get = (i: number) => p[i] ?? { x: NaN, y: NaN };
  const hip = { x: (get(LM.leftHip).x + get(LM.rightHip).x) / 2, y: (get(LM.leftHip).y + get(LM.rightHip).y) / 2 };
  const sh = { x: (get(LM.leftShoulder).x + get(LM.rightShoulder).x) / 2, y: (get(LM.leftShoulder).y + get(LM.rightShoulder).y) / 2 };
  const torsoPx = Math.hypot(sh.x - hip.x, sh.y - hip.y);
  if (!(torsoPx > 1)) return null;
  const s = BODY.torso / torsoPx;
  const out = p.map((q, i) => v3((q.x - hip.x) * s, -(q.y - hip.y) * s, depth[i] ?? 0));
  return REQUIRED.every((i) => out[i] && finite3(out[i])) ? out : null;
}

/** A pinhole camera looking straight down -z, used by the simulated stage. */
export interface StageCamera {
  /** Focal length in frame pixels. */
  focal: number;
  /** Camera centre in scene space. */
  position: Vec3;
  frameW: number;
  frameH: number;
}

/**
 * 3D points whose projection through `cam` lands exactly on the landmark
 * pixels: each landmark is pushed along its camera ray to its depth. This is
 * what keeps the simulated figure under the AR overlay drawn from the same
 * landmarks.
 */
export function unprojectPoints(landmarks: Landmark[], world: WorldLandmark[] | null | undefined, def: ExerciseDefinition, side: BodySide, cam: StageCamera, bodyZ = 0): Vec3[] | null {
  const depth = landmarkDepths(world, def, side);
  const out = landmarks.map((lm, i) => {
    const q = px(lm, cam.frameW, cam.frameH);
    const z = bodyZ + (depth[i] ?? 0);
    const dist = cam.position.z - z;
    return v3(cam.position.x + ((q.x - cam.frameW / 2) * dist) / cam.focal, cam.position.y - ((q.y - cam.frameH / 2) * dist) / cam.focal, z);
  });
  return REQUIRED.every((i) => out[i] && finite3(out[i])) ? out : null;
}

/** Projects a scene point through the stage camera to frame pixels (inverse of {@link unprojectPoints}). */
export function projectPoint(p: Vec3, cam: StageCamera): { x: number; y: number } {
  const dist = cam.position.z - p.z;
  return { x: cam.frameW / 2 + ((p.x - cam.position.x) * cam.focal) / dist, y: cam.frameH / 2 - ((p.y - cam.position.y) * cam.focal) / dist };
}

function sideJoints(points: Vec3[], s: BodySide): SideJoints {
  const i = SIDE_INDEX[s];
  const g = (k: number) => points[k] ?? v3(0, 0, 0);
  return { shoulder: g(i.shoulder), elbow: g(i.elbow), wrist: g(i.wrist), hip: g(i.hip), knee: g(i.knee), ankle: g(i.ankle) };
}

/** Builds the figure's joints from 3D landmark points. */
export function buildRig(points: Vec3[], mode: RigMode): Rig {
  const L = sideJoints(points, 'left');
  const R = sideJoints(points, 'right');
  const hipMid = mid(L.hip, R.hip);
  const shoulderMid = mid(L.shoulder, R.shoulder);
  const up = unit(sub(shoulderMid, hipMid));
  let lateral = orthonormal(add(sub(L.hip, R.hip), sub(L.shoulder, R.shoulder)), up, v3(1, 0, 0));
  let forward = cross(lateral, up);
  // Face the way the nose points. A flat front view has no forward cue, so it faces the camera.
  const nose = points[LM.nose] ?? shoulderMid;
  const lookRaw = sub(sub(nose, shoulderMid), scale(up, dot(sub(nose, shoulderMid), up)));
  const look = length(lookRaw) > 0.02 ? lookRaw : v3(0, 0, 1);
  if (dot(forward, look) < 0) {
    lateral = scale(lateral, -1);
    forward = scale(forward, -1);
  }
  // Head tilts sideways with the nose but never pitches: a faceless head looks odd nodding.
  const headUp = orthonormal(unit(sub(nose, shoulderMid), up), forward, up);

  if (mode === 'data') return { hipMid, shoulderMid, up, lateral, forward, headUp, left: L, right: R };

  const k = BODY.torso / Math.max(1e-6, length(sub(shoulderMid, hipMid)));
  const torsoPoint = (p: Vec3) => add(hipMid, scale(sub(p, hipMid), k));
  const limb = (from: Vec3, dataFrom: Vec3, dataTo: Vec3, len: number, fallback: Vec3) => add(from, scale(unit(sub(dataTo, dataFrom), fallback), len));
  const down = scale(up, -1);
  const retarget = (j: SideJoints): SideJoints => {
    const shoulder = torsoPoint(j.shoulder);
    const hip = torsoPoint(j.hip);
    const elbow = limb(shoulder, j.shoulder, j.elbow, BODY.upperArm, down);
    const wrist = limb(elbow, j.elbow, j.wrist, BODY.forearm, down);
    const knee = limb(hip, j.hip, j.knee, BODY.thigh, down);
    const ankle = limb(knee, j.knee, j.ankle, BODY.shin, down);
    return { shoulder, elbow, wrist, hip, knee, ankle };
  };
  return { hipMid, shoulderMid: torsoPoint(shoulderMid), up, lateral, forward, headUp, left: retarget(L), right: retarget(R) };
}

/** Moves every joint by `d`. */
export function translateRig(rig: Rig, d: Vec3): Rig {
  const t = (p: Vec3) => add(p, d);
  const side = (j: SideJoints): SideJoints => ({ shoulder: t(j.shoulder), elbow: t(j.elbow), wrist: t(j.wrist), hip: t(j.hip), knee: t(j.knee), ankle: t(j.ankle) });
  return { ...rig, hipMid: t(rig.hipMid), shoulderMid: t(rig.shoulderMid), left: side(rig.left), right: side(rig.right) };
}

/**
 * Which feet carry the body for an exercise: those resting on the floor at both
 * the start and the peak of the movement (both feet when standing, only the
 * resting foot during a seated knee straightening). The demonstration keeps
 * these planted so the figure never slides.
 */
export function supportFeet(neutral: Rig, peak: Rig): BodySide[] {
  const low = (r: Rig) => Math.min(r.left.ankle.y, r.right.ankle.y);
  const onFloor = (r: Rig, s: BodySide) => r[s].ankle.y - low(r) < 0.04;
  const feet = (['left', 'right'] as const).filter((s) => onFloor(neutral, s) && onFloor(peak, s));
  return feet.length ? feet : ['left', 'right'];
}

/** Translation that puts the support feet's ankles over `target` (x/z) with their soles on y = 0. */
export function groundOffset(rig: Rig, feet: BodySide[], target: { x: number; z: number }): Vec3 {
  const ankles = feet.map((s) => rig[s].ankle);
  const n = Math.max(1, ankles.length);
  const c = ankles.reduce((acc, a) => add(acc, scale(a, 1 / n)), v3(0, 0, 0));
  return v3(target.x - c.x, BODY.ankleHeight - c.y, target.z - c.z);
}

/** The plane the measured segment moves in, anchored at the measured joint. */
export interface MotionPlane {
  /** The measured joint (vertex B of the angle). */
  origin: Vec3;
  /** Unit vector from B toward A: interior angle 0°. */
  ref: Vec3;
  /** Unit vector in the plane, where the moving segment points at an interior angle of 90°. */
  perp: Vec3;
  /** ref × perp: the axis the moving segment turns about as the interior angle grows. */
  normal: Vec3;
}

/**
 * Direction of the moving segment at 90° for each exercise, from the body
 * frame. Explicit per movement so a near-straight limb (where the actual
 * segments are almost parallel) never makes the plane flip.
 */
const PERPENDICULAR: Record<DemoPose['bendToward'], (rig: Rig, side: BodySide) => Vec3> = {
  outward: (rig, side) => sub(rig[side].shoulder, rig[side === 'left' ? 'right' : 'left'].shoulder),
  forward: (rig) => rig.forward,
  backward: (rig) => scale(rig.forward, -1),
  up: (rig) => rig.up,
  down: (rig) => scale(rig.up, -1),
};

export function motionPlane(rig: Rig, def: ExerciseDefinition, side: BodySide): MotionPlane {
  const { a, b } = def.metric.landmarks[side];
  const A = rigJoint(rig, a) ?? rig.hipMid;
  const B = rigJoint(rig, b) ?? rig.hipMid;
  const ref = unit(sub(A, B));
  const toward = PERPENDICULAR[def.demo.pose.bendToward] ?? PERPENDICULAR.forward;
  const perp = orthonormal(toward(rig, side), ref, rig.forward);
  return { origin: B, ref, perp, normal: cross(ref, perp) };
}

/** Interior angle (degrees) of the measured joint for a displayed metric value. */
export function interiorFor(def: ExerciseDefinition, value: number): number {
  return interiorFromValue(def, value);
}

export type SegmentId = `${BodySide}.${'upperArm' | 'forearm' | 'hand' | 'thigh' | 'shin' | 'foot'}`;

/**
 * Segments drawn in tape cyan: the segment that moves relative to the measured
 * joint and everything it carries (the whole arm for an arm raise, the lower
 * leg and foot for a knee straightening). When the measured joint's proximal
 * end moves instead (sit to stand), only that segment is marked.
 */
export function measuredSegments(def: ExerciseDefinition, side: BodySide): SegmentId[] {
  const { a, b, c } = def.metric.landmarks[side];
  const chains: Array<{ from: number; to: number; segs: Array<'upperArm' | 'forearm' | 'hand' | 'thigh' | 'shin' | 'foot'> }> = [
    { from: SIDE_INDEX[side].shoulder, to: SIDE_INDEX[side].elbow, segs: ['upperArm', 'forearm', 'hand'] },
    { from: SIDE_INDEX[side].elbow, to: SIDE_INDEX[side].wrist, segs: ['forearm', 'hand'] },
    { from: SIDE_INDEX[side].hip, to: SIDE_INDEX[side].knee, segs: ['thigh', 'shin', 'foot'] },
    { from: SIDE_INDEX[side].knee, to: SIDE_INDEX[side].ankle, segs: ['shin', 'foot'] },
    { from: SIDE_INDEX[side].knee, to: SIDE_INDEX[side].hip, segs: ['thigh'] },
  ];
  const to = def.metric.moving === 'c' ? c : a;
  const chain = chains.find((ch) => ch.from === b && ch.to === to);
  return (chain?.segs ?? []).map((s) => `${side}.${s}` as SegmentId);
}
