import { describe, expect, it } from 'vitest';
import { angleAt, estimateBodyView, toPixel, trunkAngleFromVertical } from './geometry';
import { evaluateFrame } from './quality';
import { JumpDetector, TimeConstantSmoother, coefficientOfVariation, median } from './filters';
import { RepSegmenter, type SegmenterSample } from './segmenter';
import { MovementEngine } from './engine';
import { buildFingerprint, countSpeedPeaks, detectCompensation } from './metrics';
import { EXERCISES } from '@/features/exercises/library';
import {
  SYNTHETIC_FRAME,
  SIMULATED_PROVIDER_INFO,
  buildSyntheticPose,
  generateFrames,
  seededRandom,
  standardScript,
  type RepScript,
} from '@/features/pose-estimation/synthetic';
import type { PoseFrame } from '@/types/pose';
import type { SegmentationConfig } from '@/types/exercise';

const shoulder = EXERCISES['shoulder-abduction'];
const knee = EXERCISES['knee-extension'];

function runEngine(frames: PoseFrame[], def = shoulder, side: 'left' | 'right' = 'left', target = def.demoPrescription.target) {
  const engine = new MovementEngine({ def, side, target, sessionStart: 0 });
  for (const f of frames) engine.process(f);
  engine.tick((frames[frames.length - 1]?.timestamp ?? 0) + 5000);
  return engine;
}

describe('angleAt', () => {
  it('computes right, straight and acute angles in 2D', () => {
    const r = angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 });
    expect(r.ok && r.degrees).toBeCloseTo(90, 6);
    const s = angleAt({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(s.ok && s.degrees).toBeCloseTo(180, 6);
    const a = angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(a.ok && a.degrees).toBeCloseTo(45, 6);
  });

  it('uses 3D when every point has a finite z', () => {
    const r = angleAt({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(r.ok && r.degrees).toBeCloseTo(90, 6);
  });

  it('clamps the cosine so nearly-collinear points never produce NaN', () => {
    const r = angleAt({ x: 1e8, y: 1e-9 }, { x: 0, y: 0 }, { x: 1e8 + 1, y: 0 });
    expect(r.ok).toBe(true);
    expect(r.ok && Number.isFinite(r.degrees)).toBe(true);
  });

  it('reports missing, non-finite and zero-length inputs explicitly instead of returning 0°', () => {
    expect(angleAt(null, { x: 0, y: 0 }, { x: 1, y: 0 })).toEqual({ ok: false, reason: 'missing-point' });
    expect(angleAt({ x: NaN, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toEqual({ ok: false, reason: 'non-finite' });
    expect(angleAt({ x: Infinity, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toEqual({ ok: false, reason: 'non-finite' });
    expect(angleAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toEqual({ ok: false, reason: 'zero-length' });
  });
});

describe('coordinate normalization', () => {
  it('converts normalized coordinates to pixel space so non-square frames do not distort angles', () => {
    expect(toPixel({ x: 0.5, y: 0.25 }, 1280, 720)).toEqual({ x: 640, y: 180 });
    // A 45° line in pixels is NOT 45° in normalized units on a 16:9 frame.
    const a = { x: 0.6, y: 0.5 };
    const b = { x: 0.5, y: 0.5 };
    const c = { x: 0.5 + 100 / 1280, y: 0.5 - 100 / 720 };
    const px = angleAt(toPixel(a, 1280, 720), toPixel(b, 1280, 720), toPixel(c, 1280, 720));
    expect(px.ok && px.degrees).toBeCloseTo(45, 4);
    const norm = angleAt(a, b, c);
    expect(norm.ok && Math.abs(norm.degrees - 45)).toBeGreaterThan(5);
  });

  it('the synthetic skeleton reproduces the requested angle exactly for every exercise', () => {
    for (const def of Object.values(EXERCISES)) {
      for (const side of ['left', 'right'] as const) {
        for (const value of [def.demo.neutral, (def.demo.neutral + def.demo.peak) / 2, def.demo.peak]) {
          const frame: PoseFrame = {
            timestamp: 1,
            landmarks: buildSyntheticPose(def, side, value),
            imageWidth: SYNTHETIC_FRAME.width,
            imageHeight: SYNTHETIC_FRAME.height,
            provider: SIMULATED_PROVIDER_INFO,
            status: 'ok',
          };
          const s = evaluateFrame(frame, def, side);
          expect(s.value).not.toBeNull();
          // A side view of a trunk-referenced angle (shoulder and hip at different depths) carries a
          // small perspective error, as a real camera would; everything else must be exact.
          const { a: ia, b: ib } = def.metric.landmarks[side];
          const trunkRef = def.cameraView === 'side' && [11, 12].includes(ia) !== [11, 12].includes(ib) && [ia, ib].some((i) => [23, 24].includes(i));
          if (trunkRef) expect(Math.abs((s.value as number) - value)).toBeLessThan(1);
          else expect(s.value as number).toBeCloseTo(value, 3);
        }
      }
    }
  });

  it('estimates body view from shoulder width relative to torso length', () => {
    const front = buildSyntheticPose(shoulder, 'left', 20);
    expect(estimateBodyView(front, 1280, 720).view).toBe('front');
    const side = buildSyntheticPose(knee, 'left', 100);
    expect(estimateBodyView(side, 1280, 720).view).toBe('side');
  });

  it('measures trunk lean from vertical', () => {
    const upright = trunkAngleFromVertical(buildSyntheticPose(shoulder, 'left', 20), 1280, 720);
    const leaning = trunkAngleFromVertical(buildSyntheticPose(shoulder, 'left', 20, { trunkLeanDeg: 20 }), 1280, 720);
    expect(upright).toBeCloseTo(0, 3);
    expect(leaning).toBeCloseTo(20, 1);
  });
});

describe('frame quality classification', () => {
  const base = (overrides: Partial<PoseFrame> = {}): PoseFrame => ({
    timestamp: 10,
    landmarks: buildSyntheticPose(shoulder, 'left', 45),
    imageWidth: 1280,
    imageHeight: 720,
    provider: SIMULATED_PROVIDER_INFO,
    status: 'ok',
    ...overrides,
  });

  it('is reliable when the required landmarks are visible and in frame', () => {
    const s = evaluateFrame(base(), shoulder, 'left');
    expect(s.state).toBe('reliable');
    expect(s.flags).toEqual([]);
  });

  it('is unavailable with no person, an inference error, or missing landmarks', () => {
    expect(evaluateFrame(base({ landmarks: null, status: 'no-pose' }), shoulder, 'left')).toMatchObject({ state: 'unavailable', value: null, flags: ['no-pose'] });
    expect(evaluateFrame(base({ status: 'error' }), shoulder, 'left')).toMatchObject({ state: 'unavailable', value: null, flags: ['inference-error'] });
    expect(evaluateFrame(base({ landmarks: [] }), shoulder, 'left')).toMatchObject({ state: 'unavailable', value: null, flags: ['landmark-missing'] });
  });

  it('never measures through an occluded landmark (visibility below the usable floor)', () => {
    const lms = buildSyntheticPose(shoulder, 'left', 45, { visibility: { 13: 0.1 } });
    const s = evaluateFrame(base({ landmarks: lms }), shoulder, 'left');
    expect(s.state).toBe('unavailable');
    expect(s.value).toBeNull();
  });

  it('marks partially visible landmarks as uncertain, not reliable', () => {
    const lms = buildSyntheticPose(shoulder, 'left', 45, { visibility: { 13: 0.5 } });
    const s = evaluateFrame(base({ landmarks: lms }), shoulder, 'left');
    expect(s.state).toBe('uncertain');
    expect(s.flags).toContain('low-visibility');
  });

  it('treats out-of-frame landmarks as unavailable', () => {
    const lms = buildSyntheticPose(shoulder, 'left', 45);
    (lms[13] as { x: number }).x = 1.2;
    expect(evaluateFrame(base({ landmarks: lms }), shoulder, 'left').state).toBe('unavailable');
  });

  it('flags a camera view that does not match the exercise', () => {
    const sideOn = buildSyntheticPose(knee, 'left', 100);
    const s = evaluateFrame(base({ landmarks: sideOn }), shoulder, 'left');
    expect(s.flags).toContain('view-mismatch');
    expect(s.state).not.toBe('reliable');
  });
});

describe('filters', () => {
  it('time-constant smoothing is frame-rate independent', () => {
    const run = (fps: number) => {
      const f = new TimeConstantSmoother(70, 400);
      let v = 0;
      f.next(0, 0);
      for (let t = 1000 / fps; t <= 300; t += 1000 / fps) v = f.next(t, 100);
      return v;
    };
    expect(Math.abs(run(15) - run(60))).toBeLessThan(2);
  });

  it('resets after a gap', () => {
    const f = new TimeConstantSmoother(70, 400);
    f.next(0, 0);
    expect(f.next(1000, 90)).toBe(90);
  });

  it('flags implausibly fast jumps but not ordinary motion', () => {
    const j = new JumpDetector(720, 250);
    expect(j.isJump(0, 20)).toBe(false);
    expect(j.isJump(33, 25)).toBe(false); // 150°/s
    expect(j.isJump(66, 85)).toBe(true); // 1800°/s
    expect(j.isJump(500, 30)).toBe(false); // too far apart to judge
  });

  it('computes median and coefficient of variation', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(coefficientOfVariation([10, 10, 10])).toBe(0);
    expect(coefficientOfVariation([5])).toBeNull();
  });
});

describe('RepSegmenter (synthetic sequences)', () => {
  const cfg: SegmentationConfig = { ...shoulder.segmentation };
  const sample = (t: number, value: number | null, state: SegmenterSample['state'] = 'reliable'): SegmenterSample => ({ t, value, state, flags: [], trunk: 0 });
  const feed = (seg: RepSegmenter, pts: Array<[number, number | null]>) => pts.flatMap(([t, v]) => seg.push(sample(t, v)));
  const ramp = (t0: number, t1: number, v0: number, v1: number, step = 33): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let t = t0; t <= t1; t += step) out.push([t, v0 + ((v1 - v0) * (t - t0)) / (t1 - t0)]);
    return out;
  };

  it('counts a valid completed repetition exactly once', () => {
    const seg = new RepSegmenter(cfg);
    const events = feed(seg, [...ramp(0, 500, 15, 15), ...ramp(533, 1500, 15, 90), ...ramp(1533, 2600, 90, 15)]);
    expect(events.filter((e) => e.type === 'rep')).toHaveLength(1);
  });

  it('does not count an incomplete repetition that stays below the count threshold', () => {
    const seg = new RepSegmenter(cfg);
    const events = feed(seg, [...ramp(0, 500, 15, 15), ...ramp(533, 1500, 15, 50), ...ramp(1533, 2600, 50, 15)]);
    expect(events.filter((e) => e.type === 'rep')).toHaveLength(0);
    expect(events.find((e) => e.type === 'incomplete')).toMatchObject({ reason: 'below-count-threshold' });
  });

  it('ignores repeated (duplicate) frames', () => {
    const seg = new RepSegmenter(cfg);
    const pts = [...ramp(0, 500, 15, 15), ...ramp(533, 1500, 15, 90), ...ramp(1533, 2600, 90, 15)];
    const events = pts.flatMap(([t, v]) => [...seg.push(sample(t, v)), ...seg.push(sample(t, v)), ...seg.push(sample(t - 10, v))]);
    expect(events.filter((e) => e.type === 'rep')).toHaveLength(1);
  });

  it('does not count noise around neutral, thanks to hysteresis', () => {
    const seg = new RepSegmenter(cfg);
    const rand = seededRandom(3);
    const pts: Array<[number, number]> = [];
    for (let t = 0; t < 5000; t += 33) pts.push([t, 28 + (rand() - 0.5) * 12]);
    expect(feed(seg, pts).filter((e) => e.type === 'rep')).toHaveLength(0);
  });

  it('aborts a repetition when tracking is lost mid-movement and does not guess', () => {
    const seg = new RepSegmenter(cfg);
    const events = feed(seg, [...ramp(0, 500, 15, 15), ...ramp(533, 1200, 15, 80), [1233, null], [1500, null], [2000, null], ...ramp(2100, 2800, 70, 15)]);
    expect(events.filter((e) => e.type === 'rep')).toHaveLength(0);
    expect(events.find((e) => e.type === 'incomplete')).toMatchObject({ reason: 'tracking-lost' });
  });

  it('rejects a too-fast spike as noise', () => {
    const seg = new RepSegmenter(cfg);
    const events = feed(seg, [...ramp(0, 500, 15, 15), [533, 95], [566, 95], [600, 15]]);
    expect(events.filter((e) => e.type === 'rep')).toHaveLength(0);
    expect(events.find((e) => e.type === 'incomplete')).toMatchObject({ reason: 'too-fast' });
  });

  it('requires a return to neutral: a movement that never comes back is not counted', () => {
    const seg = new RepSegmenter(cfg);
    const events = feed(seg, [...ramp(0, 500, 15, 15), ...ramp(533, 1500, 15, 90), ...ramp(1533, 2600, 90, 45)]);
    expect(events.filter((e) => e.type === 'rep')).toHaveLength(0);
  });

  it('handles valid movements with very different durations', () => {
    const seg = new RepSegmenter(cfg);
    const events = feed(seg, [
      ...ramp(0, 400, 15, 15),
      ...ramp(433, 1000, 15, 85),
      ...ramp(1033, 1700, 85, 15),
      ...ramp(1733, 2400, 15, 15),
      ...ramp(2433, 6500, 15, 88),
      ...ramp(6533, 11000, 88, 15),
    ]);
    expect(events.filter((e) => e.type === 'rep')).toHaveLength(2);
  });
});

describe('MovementEngine end-to-end on synthetic pose sequences', () => {
  it('counts every scripted valid repetition with accurate peaks', () => {
    const frames = generateFrames(shoulder, 'left', 15, standardScript(5, 90, { variation: 4 }), { noisePx: 1.5, random: seededRandom(1) });
    const engine = runEngine(frames);
    expect(engine.reps).toHaveLength(5);
    for (const r of engine.reps) {
      expect(r.validity).toBe('reliable');
      expect(r.peakValue).toBeGreaterThan(82);
      expect(r.peakValue).toBeLessThan(97);
    }
    const fp = engine.fingerprint();
    expect(fp.valid).toBe(true);
    expect(fp.validReps).toBe(5);
    expect(fp.peakCv).not.toBeNull();
  });

  it('does not count a movement that never reaches the count threshold, and marks targets not met', () => {
    const script: RepScript[] = [
      { peak: 50, restMs: 900, outboundMs: 1200, holdMs: 200, returnMs: 1200 },
      { peak: 70, restMs: 900, outboundMs: 1200, holdMs: 200, returnMs: 1200 },
    ];
    const engine = runEngine(generateFrames(shoulder, 'left', 15, script));
    expect(engine.reps).toHaveLength(1); // only the 70° movement passes countMin (60°)
    expect(engine.reps[0]?.targetMet).toBe(false); // demo target is 80–100°
    expect(engine.incompleteAttempts.map((a) => a.reason)).toContain('below-count-threshold');
  });

  it('noisy landmarks do not create extra repetitions', () => {
    const frames = generateFrames(shoulder, 'left', 15, standardScript(4, 90), { noisePx: 4, random: seededRandom(9) });
    expect(runEngine(frames).reps).toHaveLength(4);
  });

  it('a sudden landmark jump is flagged and not counted as a repetition', () => {
    const frames = generateFrames(shoulder, 'left', 15, [{ peak: 15, restMs: 4000, outboundMs: 10, holdMs: 0, returnMs: 10 }], {
      offsetAt: (t) => (t > 2000 && t < 2040 ? 80 : 0),
    });
    const engine = runEngine(frames);
    expect(engine.reps).toHaveLength(0);
    expect(engine.qualitySummary().flagCounts['implausible-jump']).toBeGreaterThan(0);
  });

  it('missing landmarks (no person detected) during a repetition abort it instead of inventing it', () => {
    const script = standardScript(1, 90);
    const frames = generateFrames(shoulder, 'left', 15, script, { dropFrame: (t) => t > 1500 && t < 2600 });
    const engine = runEngine(frames);
    expect(engine.reps).toHaveLength(0);
    expect(engine.incompleteAttempts[0]?.reason).toBe('tracking-lost');
    expect(engine.qualitySummary().unavailable).toBeGreaterThan(0);
  });

  it('partial occlusion makes repetitions uncertain and excludes them from the fingerprint', () => {
    const frames = generateFrames(shoulder, 'left', 15, standardScript(3, 90), { visibility: { 13: 0.5 } });
    const engine = runEngine(frames);
    expect(engine.reps).toHaveLength(3);
    expect(engine.reps.every((r) => r.validity === 'uncertain')).toBe(true);
    const fp = engine.fingerprint();
    expect(fp.valid).toBe(false);
    expect(fp.validReps).toBe(0);
    expect(fp.peakMedian).toBeNull();
    expect(fp.excludedReps).toBe(3);
  });

  it('a camera interruption (no frames at all) mid-repetition is detected through tick()', () => {
    const frames = generateFrames(shoulder, 'left', 15, standardScript(1, 90));
    const engine = new MovementEngine({ def: shoulder, side: 'left', target: null, sessionStart: 0 });
    const cut = frames.findIndex((f) => f.timestamp > 2500);
    frames.slice(0, cut).forEach((f) => engine.process(f));
    const lost = engine.tick((frames[cut]?.timestamp ?? 0) + 2000);
    expect(lost?.reason).toBe('tracking-lost');
    expect(engine.reps).toHaveLength(0);
  });

  it('repeated frames are not double counted', () => {
    const frames = generateFrames(shoulder, 'left', 15, standardScript(2, 90));
    const doubled = frames.flatMap((f) => [f, f]);
    const engine = runEngine(doubled);
    expect(engine.reps).toHaveLength(2);
    expect(engine.qualitySummary().frames).toBe(frames.length);
  });

  it('measures hold duration for exercises with a hold', () => {
    const script = standardScript(2, 165, { holdMs: 3000 });
    const engine = runEngine(generateFrames(knee, 'left', 95, script), knee);
    expect(engine.reps).toHaveLength(2);
    for (const r of engine.reps) expect(r.holdMs).toBeGreaterThan(2500);
  });

  it('flags a torso-lean compensation only on reliable data', () => {
    const script = standardScript(1, 90);
    const frames = generateFrames(shoulder, 'left', 15, script, { trunkLeanAt: (t) => (t > 1400 && t < 2600 ? 22 : 0) });
    const engine = runEngine(frames);
    expect(engine.reps[0]?.compensation).toContain('trunk-lateral-lean');

    const uncertain = generateFrames(shoulder, 'left', 15, script, { trunkLeanAt: (t) => (t > 1400 && t < 2600 ? 22 : 0), visibility: { 13: 0.5 } });
    expect(runEngine(uncertain).reps[0]?.compensation).toEqual([]);
  });

  it('works for every exercise in the library', () => {
    for (const def of Object.values(EXERCISES)) {
      const frames = generateFrames(def, 'left', def.demo.neutral, standardScript(3, def.demo.peak), { noisePx: 1, random: seededRandom(4) });
      const engine = runEngine(frames, def, 'left');
      expect(engine.reps, def.id).toHaveLength(3);
    }
  });
});

describe('metrics', () => {
  it('smooth single out-and-back movements produce about two speed peaks', () => {
    const frames = generateFrames(shoulder, 'left', 15, standardScript(3, 90, { holdMs: 0 }));
    const engine = runEngine(frames);
    for (const r of engine.reps) expect(r.speedPeaks).toBeGreaterThanOrEqual(2);
    for (const r of engine.reps) expect(r.speedPeaks).toBeLessThanOrEqual(3);
  });

  it('returns null smoothness for sparse data', () => {
    expect(countSpeedPeaks([{ t: 0, value: 1, state: 'reliable', flags: [], trunk: null }])).toBeNull();
  });

  it('compensation detection needs enough reliable frames', () => {
    const rule = shoulder.compensationRules[0];
    expect(rule).toBeDefined();
    expect(detectCompensation(rule!, [{ t: 0, value: 10, state: 'reliable', flags: [], trunk: 40 }])).toBe(false);
  });

  it('a session fingerprint requires enough reliable repetitions', () => {
    expect(buildFingerprint([]).valid).toBe(false);
    expect(buildFingerprint([]).peakMedian).toBeNull();
  });
});
