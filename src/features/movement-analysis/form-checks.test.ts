import { describe, expect, it } from 'vitest';
import { EXERCISES } from '@/features/exercises/library';
import { incompleteAttemptSchema, qualitySummarySchema, repetitionSchema } from '@/lib/validation/schemas';
import type { ExerciseDefinition } from '@/types/exercise';
import type { FormCheckId } from '@/types/form';
import { LM, type Landmark, type PoseFrame } from '@/types/pose';
import { SimulatedPoseProvider } from '@/features/pose-estimation/provider';
import {
  CHECK_FAULT_REP,
  SIMULATED_PROVIDER_INFO,
  SYNTHETIC_FRAME,
  buildSyntheticBody,
  demoScript,
  generateFrames,
  seededRandom,
  type PoseFaults,
  type RepScript,
} from '@/features/pose-estimation/synthetic';
import { MovementEngine, type EngineUpdate } from './engine';
import { LandmarkSmoother, OneEuroFilter } from './filters';
import { WARN_AFTER_MS } from './formChecks';
import { angleAt, estimateBodyView, torsoScale, trunkAngleFromVertical, visibilityOf } from './geometry';
import { evaluateFrame } from './quality';

const arm = EXERCISES['shoulder-abduction'];
const curl = EXERCISES['elbow-flexion'];
const knee = EXERCISES['knee-extension'];
const sts = EXERCISES['sit-to-stand'];

function frameOf(def: ExerciseDefinition, value: number, t: number, opts: Parameters<typeof buildSyntheticBody>[3] = {}, world = true): PoseFrame {
  const body = buildSyntheticBody(def, 'right', value, opts);
  return { timestamp: t, landmarks: body.landmarks, world: world ? body.world : null, imageWidth: SYNTHETIC_FRAME.width, imageHeight: SYNTHETIC_FRAME.height, provider: SIMULATED_PROVIDER_INFO, status: 'ok' };
}

function engineFor(def: ExerciseDefinition, holdSeconds = def.demoPrescription.holdSeconds) {
  return new MovementEngine({ def, side: 'right', target: def.demoPrescription.target, sessionStart: 0, holdSeconds });
}

function runAll(engine: MovementEngine, frames: PoseFrame[]): EngineUpdate[] {
  return frames.map((f) => engine.process(f));
}

const clean = (def: ExerciseDefinition, over: Partial<RepScript> = {}): RepScript => ({
  peak: def.demo.peak,
  restMs: 1300,
  outboundMs: 1500,
  holdMs: Math.max(300, def.demoPrescription.holdSeconds * 1000),
  returnMs: 1600,
  ...over,
});

describe('rotation-robust measurement', () => {
  it('measures the arm raise in a trunk-fixed 3D frame when the body is turned, and in 2D when facing the camera', () => {
    for (const yaw of [0, 20, 40, 60]) {
      const s = evaluateFrame(frameOf(arm, 80, 1, { yawDeg: yaw }), arm, 'right');
      expect(Math.abs((s.value as number) - 80), `yaw ${yaw}`).toBeLessThan(yaw === 0 || yaw >= 40 ? 0.5 : 2.5);
      expect(s.method).toBe(yaw === 0 ? '2d' : yaw >= 40 ? '3d-body-frame' : 'hybrid');
    }
    // Without world landmarks (another provider, old recordings) it falls back to the image.
    const flat = evaluateFrame(frameOf(arm, 80, 1, { yawDeg: 40 }, false), arm, 'right');
    expect(flat.method).toBe('2d');
    expect(Math.abs((flat.value as number) - 80)).toBeGreaterThan(3);
  });

  it('blends side-view joint angles toward 3D as the limb turns away from the camera', () => {
    for (const def of [curl, knee, sts]) {
      const truth = (def.demo.neutral + def.demo.peak) / 2;
      const facing = evaluateFrame(frameOf(def, truth, 1), def, 'right');
      expect(facing.method).toBe('2d');
      expect(facing.value as number).toBeCloseTo(truth, 3);
      const turned = evaluateFrame(frameOf(def, truth, 1, { yawDeg: 45 }), def, 'right');
      const imageOnly = evaluateFrame(frameOf(def, truth, 1, { yawDeg: 45 }, false), def, 'right');
      expect(turned.method).toBe('hybrid');
      expect(Math.abs((turned.value as number) - truth), def.id).toBeLessThan(Math.abs((imageOnly.value as number) - truth));
    }
  });

  it('records the dominant method on each repetition', () => {
    const turned = engineFor(arm);
    runAll(turned, generateFrames(arm, 'right', 15, [clean(arm), clean(arm)], { yawDeg: 45 }));
    expect(turned.reps.map((r) => r.method)).toEqual(['3d-body-frame', '3d-body-frame']);
    const flat = engineFor(arm);
    runAll(flat, generateFrames(arm, 'right', 15, [clean(arm)], { imageOnly: true }));
    expect(flat.reps[0]?.method).toBe('2d');
  });
});

describe('One Euro filtering', () => {
  it('smooths jitter at rest but follows a fast movement with little lag', () => {
    const rand = seededRandom(3);
    const f = new OneEuroFilter();
    const rest: number[] = [];
    for (let t = 0; t < 2000; t += 33) rest.push(f.next(t, 20 + (rand() - 0.5) * 4));
    const sd = (xs: number[]) => Math.sqrt(xs.reduce((s, x) => s + (x - 20) ** 2, 0) / xs.length);
    expect(sd(rest.slice(10))).toBeLessThan(0.5);
    let last = 0;
    for (let t = 2000; t < 2600; t += 33) last = f.next(t, 20 + (t - 2000) * 0.15); // 150°/s ramp
    expect(20 + 577 * 0.15 - last).toBeLessThan(3);
  });

  it('resets after a gap and ignores non-finite input', () => {
    const f = new OneEuroFilter();
    f.next(0, 10);
    expect(f.next(5000, 90)).toBe(90);
    expect(f.next(5033, Number.NaN)).toBe(90);
  });

  it('the landmark smoother steadies the overlay without touching visibility', () => {
    const s = new LandmarkSmoother();
    const rand = seededRandom(5);
    let out: Landmark[] | null = null;
    for (let t = 0; t < 1000; t += 33) out = s.smooth([{ x: 0.5 + (rand() - 0.5) * 0.02, y: 0.5, z: 0, visibility: 0.9, presence: 0.8 }], t);
    expect(Math.abs((out?.[0]?.x ?? 0) - 0.5)).toBeLessThan(0.004);
    expect(out?.[0]).toMatchObject({ visibility: 0.9, presence: 0.8 });
    expect(s.smooth(null, 1100)).toBeNull();
  });
});

describe('form checks', () => {
  /** Runs one clean and one faulty repetition of `id`; returns their stored results for that check. */
  function cleanThenFault(def: ExerciseDefinition, id: FormCheckId) {
    const fault = CHECK_FAULT_REP[id](def, def.demoPrescription.holdSeconds * 1000);
    if (!fault) return null;
    const engine = engineFor(def);
    runAll(engine, generateFrames(def, 'right', def.demo.neutral, [clean(def), { ...clean(def), ...fault }], { noisePx: 1, worldNoiseM: 0.005, random: seededRandom(8) }));
    return engine.reps.map((r) => r.checks.find((c) => c.id === id)?.result);
  }

  it('every check of every exercise passes a clean repetition and fails its scripted fault', () => {
    let tested = 0;
    for (const def of Object.values(EXERCISES)) {
      for (const id of Object.keys(def.formChecks) as FormCheckId[]) {
        const results = cleanThenFault(def, id);
        if (!results) continue;
        tested++;
        expect(results, `${def.id} ${id}`).toEqual(['pass', 'fail']);
      }
    }
    expect(tested).toBeGreaterThanOrEqual(20);
  });

  it('warns only after the rule has been broken for a while (hysteresis), with a fixed cue', () => {
    const states = (bendMs: number) => {
      const engine = engineFor(arm);
      const ups: EngineUpdate[] = [];
      for (let t = 0; t < 1500; t += 33) ups.push(engine.process(frameOf(arm, 15, t)));
      for (let t = 1500; t < 2300; t += 33) ups.push(engine.process(frameOf(arm, 15 + ((t - 1500) / 800) * 75, t)));
      for (let t = 2300; t < 5000; t += 33) {
        const faults: PoseFaults = t > 3000 && t < 3000 + bendMs ? { elbowBendDeg: 50 } : {};
        ups.push(engine.process(frameOf(arm, 90, t, { faults })));
      }
      return ups.map((u) => u.form.checks.find((c) => c.id === 'elbow-straight'));
    };
    expect(states(150).some((c) => c?.state === 'warn')).toBe(false);
    const long = states(900);
    const warn = long.find((c) => c?.state === 'warn');
    expect(warn?.cue).toBe('Keep your elbow straight.');
    expect(warn?.anchor).toBe(LM.rightElbow);
    expect(long[long.length - 1]?.state).toBe('ok'); // clears after the elbow straightens again
    expect(WARN_AFTER_MS).toBeGreaterThanOrEqual(300);
  });

  it('compares posture with the start of each repetition, so a tilted camera does not trigger', () => {
    const engine = engineFor(arm);
    const ups = runAll(engine, generateFrames(arm, 'right', 15, [clean(arm), clean(arm)], { trunkLeanDeg: 12 }));
    expect(ups.some((u) => u.form.checks.some((c) => c.state === 'warn'))).toBe(false);
    expect(engine.reps.every((r) => r.checks.every((c) => c.result === 'pass'))).toBe(true);
  });

  it('never judges form on unreliable tracking', () => {
    // Elbow barely visible: the arm still counts, but nothing is judged and the repetition is uncertain.
    const engine = engineFor(arm);
    const ups = runAll(engine, generateFrames(arm, 'right', 15, [{ ...clean(arm), faults: { elbowBendDeg: 50 } }], { visibility: { [LM.rightElbow]: 0.5 } }));
    expect(ups.every((u) => u.form.checks.every((c) => c.state === 'unknown' && c.value === null))).toBe(true);
    expect(engine.reps[0]?.validity).toBe('uncertain');
    expect(engine.reps[0]?.checks.every((c) => c.result === 'unknown')).toBe(true);
    expect(ups.some((u) => u.form.guide.inTarget || u.form.guide.pastTarget)).toBe(false);
  });

  it('a check whose own landmarks are unreliable reports unknown while the others still work', () => {
    const engine = engineFor(arm);
    const ups = runAll(engine, generateFrames(arm, 'right', 15, [clean(arm)], { visibility: { [LM.rightEar]: 0.2 } }));
    const mid = ups.find((u) => u.phase === 'outbound' && (u.smoothed ?? 0) > 80);
    expect(mid?.form.checks.find((c) => c.id === 'shoulder-relaxed')?.state).toBe('unknown');
    expect(mid?.form.checks.find((c) => c.id === 'elbow-straight')?.state).toBe('ok');
    expect(engine.reps[0]?.checks.find((c) => c.id === 'shoulder-relaxed')?.result).toBe('unknown');
  });

  it('arm-to-side needs 3D landmarks and says unknown without them', () => {
    const engine = engineFor(arm);
    runAll(engine, generateFrames(arm, 'right', 15, [{ ...clean(arm), faults: { armForwardDeg: 60 } }], { imageOnly: true }));
    expect(engine.reps[0]?.checks.find((c) => c.id === 'arm-to-side')?.result).toBe('unknown');
  });
});

describe('movement guide', () => {
  it('counts the prescribed hold, then says to lower; lowering early fails the hold check', () => {
    const engine = engineFor(knee, 3);
    const ups = runAll(engine, generateFrames(knee, 'right', 95, [clean(knee, { holdMs: 3400 }), clean(knee, { holdMs: 1000 })]));
    const phases = ups.map((u) => u.form.guide.phase);
    expect(phases).toContain('hold');
    expect(phases.indexOf('return')).toBeGreaterThan(phases.indexOf('hold'));
    const holds = ups.map((u) => u.form.guide.hold?.heldMs ?? 0);
    expect(Math.max(...holds)).toBe(3000);
    expect(ups.find((u) => u.form.guide.phase === 'hold')?.form.guide.instruction).toBe('Hold');
    expect(ups.find((u) => u.form.guide.phase === 'return')?.form.guide.instruction).toBe('Lower slowly');
    expect(engine.reps.map((r) => r.checks.find((c) => c.id === 'hold-time')?.result)).toEqual(['pass', 'fail']);
  });

  it('reports in-target and past-target only on reliable tracking', () => {
    const engine = engineFor(arm);
    const ups = runAll(engine, generateFrames(arm, 'right', 15, [clean(arm, { peak: 90 }), clean(arm, { peak: 118 })]));
    expect(ups.some((u) => u.form.guide.inTarget)).toBe(true);
    const past = ups.filter((u) => u.form.guide.pastTarget);
    expect(past.length).toBeGreaterThan(0);
    expect(past.every((u) => (u.smoothed ?? 0) > 105)).toBe(true);
    expect(engine.reps[1]?.checks.find((c) => c.id === 'within-target')).toMatchObject({ result: 'fail', value: expect.any(Number) });
  });

  it('shows progress from the start of the repetition toward the goal', () => {
    const ups = runAll(engineFor(arm), generateFrames(arm, 'right', 15, [clean(arm)]));
    const progress = ups.map((u) => u.form.guide.progress);
    expect(Math.min(...progress)).toBeCloseTo(0, 6);
    expect(Math.max(...progress)).toBe(1);
    expect(progress.every((p) => p >= 0 && p <= 1)).toBe(true);
  });
});

describe('simulated provider and data-driven synthetic poses', () => {
  it('produces consistent image and world landmarks and shows each check failing in the demo', () => {
    for (const def of Object.values(EXERCISES)) {
      const p = new SimulatedPoseProvider(def, 'right', { holdSeconds: def.demoPrescription.holdSeconds });
      const frame = p.estimate(null, 1000);
      expect(frame.world).toHaveLength(33);
      const w = frame.world as NonNullable<PoseFrame['world']>;
      const len = (a: number, b: number) => Math.hypot((w[a]?.x ?? 0) - (w[b]?.x ?? 0), (w[a]?.y ?? 0) - (w[b]?.y ?? 0), (w[a]?.z ?? 0) - (w[b]?.z ?? 0));
      expect(len(LM.rightShoulder, LM.rightElbow)).toBeCloseTo(0.29, 1);
      expect(len(LM.rightHip, LM.rightKnee)).toBeCloseTo(0.43, 1);
      const script = demoScript(def, { holdMs: def.demoPrescription.holdSeconds * 1000 });
      const faulted = script.filter((r) => r.faults || r.restValue !== undefined || r.returnMs < 1000 || r.outboundMs < 1000 || r.peak > (def.demoPrescription.target.max ?? Infinity) + 5 || r.holdMs < def.demoPrescription.holdSeconds * 1000 * 0.5);
      expect(faulted.length, def.id).toBeGreaterThanOrEqual(3);
    }
  });

  it('builds exact poses for a new exercise described only by data', () => {
    const hipAbduction: ExerciseDefinition = {
      ...arm,
      metric: { ...arm.metric, kind: 'elevation', landmarks: { left: { a: LM.leftShoulder, b: LM.leftHip, c: LM.leftKnee }, right: { a: LM.rightShoulder, b: LM.rightHip, c: LM.rightKnee } } },
      demo: { neutral: 0, peak: 35, pose: { posture: 'standing', bendToward: 'outward' } },
    };
    const kneeCurl: ExerciseDefinition = {
      ...knee,
      cameraView: 'side',
      metric: { ...knee.metric, transform: 'supplement' },
      demo: { neutral: 5, peak: 90, pose: { posture: 'standing', bendToward: 'backward' } },
    };
    for (const [def, value] of [
      [hipAbduction, 30],
      [kneeCurl, 70],
    ] as const) {
      const s = evaluateFrame(frameOf(def, value, 1), def, 'right');
      expect(s.value as number).toBeCloseTo(value, 3);
    }
  });
});

describe('robustness against corrupt input', () => {
  const rand = seededRandom(99);
  const WEIRD = [Number.NaN, Infinity, -Infinity, 0, -1, 2, 1e308, -1e308, 0.5, undefined, null, '0.5'];
  const weird = (): number => (rand() < 0.5 ? rand() : (WEIRD[Math.floor(rand() * WEIRD.length)] as number));
  const garbage = (): Landmark[] | null => {
    if (rand() < 0.1) return null;
    return Array.from({ length: [0, 12, 33, 33, 40][Math.floor(rand() * 5)] as number }, () => ({ x: weird(), y: weird(), z: weird(), visibility: weird(), presence: rand() < 0.5 ? undefined : weird() }));
  };

  it('angleAt never reports a non-finite angle', () => {
    for (let i = 0; i < 3000; i++) {
      const p = () => ({ x: weird(), y: weird(), z: rand() < 0.5 ? weird() : undefined });
      const r = angleAt(p(), p(), p());
      if (r.ok) expect(r.degrees >= 0 && r.degrees <= 180).toBe(true);
    }
    expect(angleAt({ x: 1e308, y: 0 }, { x: -1e308, y: 0 }, { x: 0, y: 1 }).ok).toBe(false);
    expect(angleAt({ x: 1e300, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1e300 })).toEqual({ ok: true, degrees: 90 });
  });

  it('treats NaN or missing visibility as invisible, and uses presence when given', () => {
    expect(visibilityOf({ visibility: Number.NaN })).toBe(0);
    expect(visibilityOf({})).toBe(0);
    expect(visibilityOf({ visibility: 0.9, presence: 0.4 })).toBe(0.4);
    const lms = buildSyntheticBody(arm, 'right', 60).landmarks;
    const at = (patch: Partial<Landmark>) => evaluateFrame({ ...frameOf(arm, 60, 1), landmarks: lms.map((l, i) => (i === LM.rightElbow ? { ...l, ...patch } : l)) }, arm, 'right');
    expect(at({ visibility: Number.NaN }).state).toBe('unavailable');
    expect(at({ visibility: undefined as unknown as number }).state).toBe('unavailable');
    expect(at({ presence: 0.5 }).state).toBe('uncertain');
    expect(evaluateFrame({ ...frameOf(arm, 60, 1), imageHeight: 0 }, arm, 'right')).toMatchObject({ state: 'unavailable', value: null });
  });

  it('geometry helpers return finite numbers or null on garbage', () => {
    for (let i = 0; i < 2000; i++) {
      const lms = garbage() ?? [];
      const [w, h] = [weird() * 2000, weird() * 2000];
      for (const v of [trunkAngleFromVertical(lms, w, h), estimateBodyView(lms, w, h).ratio, torsoScale(lms, w, h)]) {
        if (v !== null) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('the engine keeps every output finite and every stored record valid', () => {
    for (const def of Object.values(EXERCISES)) {
      const engine = engineFor(def);
      let t = 0;
      for (let i = 0; i < 1500; i++) {
        const r = rand();
        t = r < 0.03 ? Number.NaN : r < 0.05 ? 1e300 : r < 0.08 ? t - 500 : t + rand() * 80;
        const good = rand() < 0.6;
        const frame: PoseFrame = good
          ? frameOf(def, def.demo.neutral + (def.demo.peak - def.demo.neutral) * Math.abs(Math.sin(i / 25)), t)
          : { timestamp: t, landmarks: garbage(), world: rand() < 0.5 ? null : (garbage() as PoseFrame['world']), imageWidth: weird() * 1280, imageHeight: weird() * 720, provider: SIMULATED_PROVIDER_INFO, status: rand() < 0.8 ? 'ok' : 'error' };
        const u = engine.process(frame);
        for (const v of [u.smoothed, u.sample.value, u.sample.trunk, u.sample.scale, u.form.guide.progress, u.sample.t]) if (v !== null) expect(Number.isFinite(v)).toBe(true);
        for (const c of u.form.checks) if (c.value !== null) expect(Number.isFinite(c.value)).toBe(true);
        if (Number.isFinite(t) && rand() < 0.01) engine.tick(t + 2000);
      }
      engine.reps.forEach((rep) => expect(() => repetitionSchema.parse(rep)).not.toThrow());
      engine.incompleteAttempts.forEach((a) => expect(() => incompleteAttemptSchema.parse(a)).not.toThrow());
      expect(() => qualitySummarySchema.parse(engine.qualitySummary())).not.toThrow();
    }
  });

  it('old stored repetitions without checks or a method still parse', () => {
    const old = { index: 1, setIndex: 1, startedAt: 0, endedAt: 2000, durationMs: 2000, outboundMs: 800, holdMs: 200, returnMs: 900, startValue: 15, peakValue: 90, range: 75, targetMet: true, validity: 'reliable', reliableFraction: 1, speedPeaks: 2, compensation: [], qualityFlags: [] };
    expect(repetitionSchema.parse(old)).toMatchObject({ checks: [], method: '2d' });
  });
});
