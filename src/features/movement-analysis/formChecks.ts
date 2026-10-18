import { LM, type PoseFrame } from '@/types/pose';
import type { BodySide, TargetRange, ValidityState } from '@/lib/validation/schemas';
import type { ExerciseDefinition, FormCheckThresholds } from '@/types/exercise';
import type { CheckState, FormCheckId, GuidePhase, LiveCheck, LiveForm, MeasurementMethod, MovementGuide, RepCheck } from '@/types/form';
import { ANALYSIS_CONFIG } from './config';
import { angleAt, trunkAngleFromVertical, validFrameSize } from './geometry';
import { elevationAngle, frameView, jointAngle, pixel, type FrameView } from './measure';
import { OneEuroFilter, median } from './filters';
import { repTiming } from './metrics';
import type { RawRep, SegmenterPhase, SegmenterSample } from './segmenter';

/**
 * Real-time form checks. Each check is a fixed, explainable rule with a
 * demonstration threshold from the exercise definition (`def.formChecks`), so
 * new or user-made exercises only list the checks they want.
 *
 * Two kinds:
 * - Continuous checks (posture during the movement) use hysteresis: a check
 *   turns to `warn` only after its rule is broken for WARN_AFTER_MS, and back
 *   to `ok` after it has been clearly fine (RELEASE inside the limit) for
 *   CLEAR_AFTER_MS, so chips and cues never flicker. Posture checks compare
 *   against a baseline taken just before each repetition starts, so a tilted
 *   camera or a slouched rest position does not trigger them.
 * - Judged checks (timing, hold, standing fully) are decided once per
 *   repetition at a defined moment and keep their result until the next one.
 *
 * Everything is gated on reliable tracking: a check whose landmarks are not
 * reliable reports `unknown`, and every check reports `unknown` while the
 * live tracking quality is not reliable.
 */

/**
 * Fixed chip label and cue sentence per check. Cues are complete sentences
 * from a finite set (they are pre-recorded in the voice pack), so they never
 * contain measured numbers.
 */
export const CHECK_TEXT: Record<FormCheckId, { label: string; cue: string; unit: LiveCheck['unit'] }> = {
  'elbow-straight': { label: 'Elbow straight', cue: 'Keep your elbow straight.', unit: '°' },
  'arm-to-side': { label: 'Out to the side', cue: 'Raise your arm out to the side, not in front.', unit: '°' },
  'shoulder-relaxed': { label: 'Shoulder relaxed', cue: 'Relax your shoulder down, away from your ear.', unit: '%' },
  'trunk-upright': { label: 'Body upright', cue: 'Keep your body upright.', unit: '°' },
  'upper-arm-still': { label: 'Upper arm still', cue: 'Keep your upper arm still at your side.', unit: '°' },
  'start-straight': { label: 'Start straight', cue: 'Start with your arm straight.', unit: '°' },
  'no-swing': { label: 'No swinging', cue: 'Keep your body still. Let your arm do the work.', unit: '°' },
  'sit-tall': { label: 'Sitting tall', cue: "Sit tall. Don't lean back.", unit: '°' },
  'thigh-still': { label: 'Thigh resting', cue: 'Keep your thigh resting on the chair.', unit: '°' },
  'hold-time': { label: 'Hold time', cue: 'Try to hold a little longer.', unit: 's' },
  'stand-tall': { label: 'Standing tall', cue: 'Stand all the way up.', unit: '°' },
  'controlled-sit': { label: 'Slow sit', cue: 'Sit down slowly, with control.', unit: 's' },
  'controlled-return': { label: 'Slow lowering', cue: 'Lower slowly, with control.', unit: 's' },
  'steady-pace': { label: 'Steady pace', cue: 'Slow down a little.', unit: 's' },
  'within-target': { label: 'Within target', cue: "That's past your target. Only go as far as your plan allows.", unit: '°' },
};

/** A rule must be broken this long before a check warns, and clearly fine this long before it clears. */
export const WARN_AFTER_MS = 350;
export const CLEAR_AFTER_MS = 350;
/** How far back inside its limit a warning check must come before it can clear, per unit. */
const RELEASE: Record<'°' | '%' | 's', number> = { '°': 3, '%': 5, s: 0 };
/** Angular speed (°/s) below which the joint counts as holding still at the top. */
const TOP_SPEED = 25;
/** Leaving the top for less than this does not restart the hold count (tracking jitter). */
const HOLD_GAP_MS = 250;
/** Recent rest frames used for the per-repetition baseline. */
const BASELINE_WINDOW_MS = 600;
/** Rest frames searched for the start position (start-straight). */
const REST_WINDOW_MS = 3000;
/** Speed is the change over at least this window, so it reacts fast without single-frame jitter. */
const SPEED_WINDOW_MS = 120;

const CONTINUOUS = new Set<FormCheckId>([
  'elbow-straight',
  'arm-to-side',
  'shoulder-relaxed',
  'trunk-upright',
  'upper-arm-still',
  'start-straight',
  'no-swing',
  'sit-tall',
  'thigh-still',
  'within-target',
]);

/** The checks that apply to this exercise and prescription, in display order. */
export function activeCheckIds(def: ExerciseDefinition, target: TargetRange | null, holdSeconds: number): FormCheckId[] {
  return (Object.keys(def.formChecks) as FormCheckId[]).filter(
    (id) => !(id === 'hold-time' && !(holdSeconds > 0)) && !(id === 'within-target' && !target),
  );
}

function sideJoints(side: BodySide) {
  const left = side === 'left';
  return {
    ear: left ? LM.leftEar : LM.rightEar,
    shoulder: left ? LM.leftShoulder : LM.rightShoulder,
    otherShoulder: left ? LM.rightShoulder : LM.leftShoulder,
    elbow: left ? LM.leftElbow : LM.rightElbow,
    wrist: left ? LM.leftWrist : LM.rightWrist,
    hip: left ? LM.leftHip : LM.rightHip,
    knee: left ? LM.leftKnee : LM.rightKnee,
  };
}

/** Landmark the AR chip for a check anchors to; chosen so chips of one exercise rarely share a joint. */
export function checkAnchor(id: FormCheckId, def: ExerciseDefinition, side: BodySide): number | null {
  const j = sideJoints(side);
  const { a, b, c } = def.metric.landmarks[side];
  switch (id) {
    case 'elbow-straight':
    case 'upper-arm-still':
    case 'start-straight':
      return j.elbow;
    case 'arm-to-side':
    case 'sit-tall':
      return j.shoulder;
    case 'shoulder-relaxed':
      return j.ear;
    case 'trunk-upright':
    case 'no-swing':
    case 'thigh-still':
    case 'stand-tall':
      return j.hip;
    case 'controlled-return':
    case 'steady-pace':
      return def.metric.moving === 'c' ? c : a;
    case 'within-target':
    case 'hold-time':
    case 'controlled-sit':
      return b;
  }
}

/**
 * The on-stage guide words for an exercise. A finite set built from the
 * exercise phases ("Raise", "Bend", "Straighten", "Stand up"; "Lower slowly",
 * "Sit down slowly"), so every word can be pre-recorded.
 */
export function guideWords(def: ExerciseDefinition): Record<GuidePhase, string> {
  const label = (id: 'outbound' | 'return', fallback: string) => def.phases.find((p) => p.id === id)?.label ?? fallback;
  const move = label('outbound', 'Move');
  return {
    'get-ready': 'Get into position',
    'rest-position': move,
    move,
    hold: 'Hold',
    return: `${label('return', 'Return')} slowly`,
  };
}

/** Body measures used by the posture checks; null when not reliably measurable on this frame. */
interface Measures {
  /** Elbow interior angle (180° = straight). */
  elbow: number | null;
  /** Plane of elevation of the measured segment (0° = to the side, 90° = in front). Needs world landmarks. */
  plane: number | null;
  /** Ear height above the shoulder along the trunk, relative to shoulder width. */
  shrug: number | null;
  /** Trunk angle from image vertical (signed). */
  trunk: number | null;
  /** Upper arm angle from the trunk at the shoulder (image). */
  upperArm: number | null;
  /** Thigh angle above horizontal (image; positive = knee higher than hip). */
  thigh: number | null;
  /** Hip angle shoulder–hip–knee (180° = fully extended). */
  hip: number | null;
  /** +1 when the person faces image right, −1 when facing left. */
  facing: 1 | -1 | null;
}

type MeasureKey = keyof Measures;

const NEEDS: Partial<Record<FormCheckId, MeasureKey[]>> = {
  'elbow-straight': ['elbow'],
  'arm-to-side': ['plane'],
  'shoulder-relaxed': ['shrug'],
  'trunk-upright': ['trunk'],
  'no-swing': ['trunk'],
  'sit-tall': ['trunk', 'facing'],
  'upper-arm-still': ['upperArm'],
  'thigh-still': ['thigh'],
  'stand-tall': ['hip'],
};

const DEG = 180 / Math.PI;

function measure(v: FrameView, def: ExerciseDefinition, side: BodySide, need: Set<MeasureKey>): Measures {
  const j = sideJoints(side);
  const m: Measures = { elbow: null, plane: null, shrug: null, trunk: null, upperArm: null, thigh: null, hip: null, facing: null };
  const reliable = ANALYSIS_CONFIG.visibilityReliable;
  if (need.has('elbow')) m.elbow = jointAngle(v, j.shoulder, j.elbow, j.wrist, reliable)?.degrees ?? null;
  if (need.has('plane')) {
    const { a, b, c } = def.metric.landmarks[side];
    m.plane = elevationAngle(v, a, b, c, side, reliable)?.planeDeg ?? null;
  }
  if (need.has('trunk')) m.trunk = trunkAngleFromVertical(v.lms, v.w, v.h);
  if (need.has('hip')) m.hip = jointAngle(v, j.shoulder, j.hip, j.knee, reliable)?.degrees ?? null;
  const shoulder = pixel(v, j.shoulder);
  const hip = pixel(v, j.hip);
  const knee = pixel(v, j.knee);
  if (need.has('upperArm')) {
    const r = angleAt(hip, shoulder, pixel(v, j.elbow));
    m.upperArm = r.ok ? r.degrees : null;
  }
  if (need.has('thigh') && hip && knee) {
    const r = Math.atan2(hip.y - knee.y, Math.abs(knee.x - hip.x)) * DEG;
    m.thigh = Number.isFinite(r) && Math.hypot(knee.x - hip.x, knee.y - hip.y) > 5 ? r : null;
  }
  if (need.has('shrug')) {
    const ear = pixel(v, j.ear);
    const ls = pixel(v, LM.leftShoulder);
    const rs = pixel(v, LM.rightShoulder);
    const lh = pixel(v, LM.leftHip);
    const rh = pixel(v, LM.rightHip);
    if (ear && shoulder && ls && rs && lh && rh) {
      const ux = (ls.x + rs.x - lh.x - rh.x) / 2;
      const uy = (ls.y + rs.y - lh.y - rh.y) / 2;
      const len = Math.hypot(ux, uy);
      const width = Math.hypot(ls.x - rs.x, ls.y - rs.y);
      const r = ((ear.x - shoulder.x) * ux + (ear.y - shoulder.y) * uy) / len / width;
      m.shrug = len > 5 && width > 5 && Number.isFinite(r) && r > 0 ? r : null;
    }
  }
  if (need.has('facing')) {
    // Seated, the thigh points the way the person faces; otherwise the nose is in front of the ears.
    if (hip && knee && Math.abs(knee.x - hip.x) > 0.5 * Math.abs(knee.y - hip.y)) m.facing = knee.x > hip.x ? 1 : -1;
    else {
      const nose = pixel(v, LM.nose);
      const ear = pixel(v, j.ear) ?? pixel(v, j.ear === LM.leftEar ? LM.rightEar : LM.leftEar);
      if (nose && ear && Math.abs(nose.x - ear.x) > 3) m.facing = nose.x > ear.x ? 1 : -1;
    }
  }
  return m;
}

const EMPTY_MEASURES: Measures = { elbow: null, plane: null, shrug: null, trunk: null, upperArm: null, thigh: null, hip: null, facing: null };

/** Everything the tracker needs from the engine on one frame. */
export interface FormInput {
  frame: PoseFrame;
  t: number;
  /** Smoothed metric value; null when unusable. */
  value: number | null;
  /** This frame's own tracking state and measurement method. */
  sampleState: ValidityState;
  method: MeasurementMethod;
  /** Rolling live tracking quality. */
  quality: ValidityState;
  phase: SegmenterPhase;
  /** The repetition in progress, if any. */
  rep: Readonly<RawRep> | null;
}

interface CheckRuntime {
  state: CheckState;
  since: number;
  /** Continuous checks: when the rule started being broken / clearly fine. */
  brokenSince: number | null;
  fineSince: number | null;
  value: number | null;
  /** Per-repetition aggregation. */
  warnedThisRep: boolean;
  measuredThisRep: number;
  worst: { excess: number; value: number } | null;
  judged: { result: RepCheck['result']; value: number | null } | null;
}

interface RepState {
  startedAt: number;
  baseline: Partial<Record<MeasureKey, number>>;
  holdRunStart: number | null;
  lastTopT: number | null;
  heldMs: number;
  maxHeldMs: number;
  holdDone: boolean;
  hipTop: number | null;
  returnJudged: boolean;
}

export class FormTracker {
  private readonly ids: FormCheckId[];
  private readonly words: Record<GuidePhase, string>;
  private readonly need: Set<MeasureKey>;
  private readonly runtime = new Map<FormCheckId, CheckRuntime>();
  private restBuffer: Array<{ t: number; m: Measures }> = [];
  private restValues: Array<{ t: number; v: number }> = [];
  private recent: Array<{ t: number; v: number }> = [];
  private restStart: number | null = null;
  /** Per-measure smoothing: single-frame landmark noise must not decide a posture check. */
  private readonly measureFilters = new Map<MeasureKey, OneEuroFilter>();
  private rep: RepState | null = null;
  private lastRepChecks: RepCheck[] = [];
  private method: MeasurementMethod = 'none';

  constructor(
    private readonly def: ExerciseDefinition,
    private readonly side: BodySide,
    private readonly target: TargetRange | null,
    private readonly holdSeconds: number,
  ) {
    this.ids = activeCheckIds(def, target, holdSeconds);
    this.words = guideWords(def);
    this.need = new Set(this.ids.flatMap((id) => NEEDS[id] ?? []));
    this.reset();
  }

  private cfg<K extends FormCheckId>(id: K): FormCheckThresholds[K] {
    return this.def.formChecks[id] as FormCheckThresholds[K];
  }

  /**
   * Feeds one frame. Pass the repetition the segmenter just completed (if any)
   * so its judged checks are decided; read them with repChecks().
   */
  update(input: FormInput, finished: RawRep | null = null): LiveForm {
    const { t, phase } = input;
    const usable = input.sampleState === 'reliable' && input.quality === 'reliable';
    const speed = this.speed(t, input.value);
    const v = this.view(input.frame);
    const m = this.smoothMeasures(t, usable && v ? measure(v, this.def, this.side, this.need) : EMPTY_MEASURES);
    this.method = input.method;

    // Repetition boundaries.
    if (input.rep && (!this.rep || this.rep.startedAt !== input.rep.startedAt)) this.startRep(input.rep.startedAt, t);
    if (finished) this.finishRep(finished, t);
    else if (!input.rep && this.rep) this.rep = null; // aborted (tracking lost, too slow)

    if (!this.rep && usable) {
      this.restBuffer.push({ t, m });
      while (this.restBuffer.length > 0 && (this.restBuffer[0] as { t: number }).t < t - BASELINE_WINDOW_MS) this.restBuffer.shift();
      if (input.value !== null && Math.abs(speed) <= TOP_SPEED) {
        this.restValues.push({ t, v: input.value });
        while (this.restValues.length > 0 && (this.restValues[0] as { t: number }).t < t - REST_WINDOW_MS) this.restValues.shift();
      }
    }

    if (this.rep && input.rep) this.trackTop(input, m, usable, speed);
    if (this.rep && phase === 'returning' && !this.rep.returnJudged) this.judgeAtTop(input.rep, t);

    for (const id of this.ids) {
      if (!CONTINUOUS.has(id)) continue;
      this.step(id, usable ? this.evaluate(id, m, input, speed) : null, t);
    }
    return { checks: this.ids.map((id) => this.live(id, t, input.quality)), guide: this.guide(input), method: this.method };
  }

  /** Results for the repetition finished on the latest update(). */
  repChecks(): RepCheck[] {
    return this.lastRepChecks;
  }

  reset(): void {
    this.rep = null;
    this.restBuffer = [];
    this.restValues = [];
    this.recent = [];
    this.restStart = null;
    this.lastRepChecks = [];
    for (const id of this.ids) {
      this.runtime.set(id, { state: 'unknown', since: 0, brokenSince: null, fineSince: null, value: null, warnedThisRep: false, measuredThisRep: 0, worst: null, judged: null });
    }
  }

  private smoothMeasures(t: number, m: Measures): Measures {
    const out = { ...m };
    for (const key of ['elbow', 'plane', 'shrug', 'trunk', 'upperArm', 'thigh', 'hip'] as const) {
      let f = this.measureFilters.get(key);
      if (!f) this.measureFilters.set(key, (f = new OneEuroFilter(1.0, 0.02)));
      const x = m[key];
      if (x === null) f.reset();
      else out[key] = f.next(t, x);
    }
    return out;
  }

  /** Angular speed of the smoothed value (°/s) over the last SPEED_WINDOW_MS; 0 when unknown. */
  private speed(t: number, value: number | null): number {
    if (value === null) {
      this.recent = [];
      return 0;
    }
    this.recent.push({ t, v: value });
    while (this.recent.length > 2 && t - (this.recent[1] as { t: number }).t >= SPEED_WINDOW_MS) this.recent.shift();
    const first = this.recent[0] as { t: number; v: number };
    const dt = t - first.t;
    return dt >= SPEED_WINDOW_MS * 0.5 ? ((value - first.v) / dt) * 1000 : 0;
  }

  private view(frame: PoseFrame): FrameView | null {
    if (!frame.landmarks || !validFrameSize(frame.imageWidth, frame.imageHeight)) return null;
    return frameView(frame.landmarks, frame.world, frame.imageWidth, frame.imageHeight);
  }

  private rt(id: FormCheckId): CheckRuntime {
    return this.runtime.get(id) as CheckRuntime;
  }

  private startRep(startedAt: number, t: number): void {
    const baseline: Partial<Record<MeasureKey, number>> = {};
    for (const key of ['shrug', 'trunk', 'upperArm', 'thigh'] as const) {
      const vals = this.restBuffer.map((e) => e.m[key]).filter((x): x is number => x !== null);
      const med = median(vals);
      if (med !== null) baseline[key] = med;
    }
    this.restBuffer = [];
    // The start position is where the joint last settled before moving (not the value where counting began).
    const lastSettled = this.restValues[this.restValues.length - 1]?.t ?? 0;
    this.restStart = median(this.restValues.filter((e) => e.t >= lastSettled - BASELINE_WINDOW_MS).map((e) => e.v));
    this.restValues = [];
    this.rep = { startedAt, baseline, holdRunStart: null, lastTopT: null, heldMs: 0, maxHeldMs: 0, holdDone: false, hipTop: null, returnJudged: false };
    for (const id of this.ids) {
      const r = this.rt(id);
      r.warnedThisRep = false;
      r.measuredThisRep = 0;
      r.worst = null;
      if (!CONTINUOUS.has(id)) {
        r.judged = null;
        this.setState(r, 'unknown', t);
      }
    }
  }

  /** Hold timing and the hip angle at the top, for the guide and the judged checks. */
  private trackTop(input: FormInput, m: Measures, usable: boolean, speed: number): void {
    const rep = this.rep as RepState;
    const cur = input.rep as Readonly<RawRep>;
    const { holdTolerance, countMin } = this.def.segmentation;
    const v = input.value;
    const nearPeak = v !== null && v >= cur.peakValue - holdTolerance;
    if (nearPeak && m.hip !== null) rep.hipTop = Math.max(rep.hipTop ?? -Infinity, m.hip);
    const atTop = usable && input.phase === 'outbound' && nearPeak && (v as number) >= countMin && Math.abs(speed) <= TOP_SPEED;
    if (atTop) {
      if (rep.holdRunStart === null || (rep.lastTopT !== null && input.t - rep.lastTopT > HOLD_GAP_MS)) rep.holdRunStart = input.t;
      rep.lastTopT = input.t;
      rep.heldMs = input.t - rep.holdRunStart;
      rep.maxHeldMs = Math.max(rep.maxHeldMs, rep.heldMs);
    } else if (rep.lastTopT === null || input.t - rep.lastTopT > HOLD_GAP_MS) {
      rep.holdRunStart = null;
      rep.heldMs = 0;
    }
    const required = this.holdSeconds * 1000;
    if (required > 0 && !rep.holdDone && rep.maxHeldMs >= required) {
      rep.holdDone = true;
      if (this.ids.includes('hold-time')) this.judge('hold-time', 'pass', round1(rep.maxHeldMs / 1000), input.t);
    }
  }

  /** Decided when the person starts coming back: pace on the way out, the hold, and standing fully. */
  private judgeAtTop(cur: Readonly<RawRep> | null, t: number): void {
    const rep = this.rep as RepState;
    rep.returnJudged = true;
    // A movement that never reached the counting range is reported as not counted, not judged for form.
    if (!cur || cur.peakValue < this.def.segmentation.countMin) return;
    const { holdTolerance } = this.def.segmentation;
    if (this.ids.includes('steady-pace')) {
      const out = repTiming({ ...cur, endedAt: t }, holdTolerance).outboundMs / 1000;
      this.judge('steady-pace', out < this.cfg('steady-pace').minOutboundSeconds ? 'fail' : 'pass', round1(out), t);
    }
    if (this.ids.includes('hold-time') && !rep.holdDone) {
      const ok = rep.maxHeldMs >= this.holdSeconds * 1000 - this.cfg('hold-time').graceMs;
      this.judge('hold-time', ok ? 'pass' : 'fail', round1(rep.maxHeldMs / 1000), t);
    }
    if (this.ids.includes('stand-tall')) {
      const { minKneeDeg, minHipDeg } = this.cfg('stand-tall');
      const kneeOk = cur.peakValue >= minKneeDeg;
      const hipOk = rep.hipTop === null ? null : rep.hipTop >= minHipDeg;
      const result = !kneeOk || hipOk === false ? 'fail' : hipOk === null ? 'unknown' : 'pass';
      this.judge('stand-tall', result, round1(Math.min(cur.peakValue, rep.hipTop ?? Infinity)), t);
    }
  }

  private finishRep(raw: RawRep, t: number): void {
    if (this.rep && !this.rep.returnJudged) this.judgeAtTop(raw, t);
    const { holdTolerance } = this.def.segmentation;
    const timing = repTiming(raw, holdTolerance);
    if (this.ids.includes('controlled-return')) {
      const { maxSpeedDegPerSec, minReturnRatio } = this.cfg('controlled-return');
      const fast = maxReturnSpeed(raw, holdTolerance) > maxSpeedDegPerSec || timing.returnMs < minReturnRatio * timing.outboundMs;
      this.judge('controlled-return', fast ? 'fail' : 'pass', round1(timing.returnMs / 1000), t);
    }
    if (this.ids.includes('controlled-sit')) {
      const secs = timing.returnMs / 1000;
      this.judge('controlled-sit', secs < this.cfg('controlled-sit').minSitSeconds ? 'fail' : 'pass', round1(secs), t);
    }

    this.lastRepChecks = this.ids.map((id) => {
      const r = this.rt(id);
      const text = CHECK_TEXT[id];
      let result: RepCheck['result'];
      let value: number | null;
      if (id === 'start-straight') {
        const start = this.restStart;
        result = start === null ? 'unknown' : start > this.cfg('start-straight').maxStartDeg ? 'fail' : 'pass';
        value = start === null ? null : round1(start);
      } else if (id === 'within-target' && this.target) {
        const past = raw.peakValue > this.target.max + this.cfg('within-target').pastToleranceDeg;
        result = past || raw.peakValue < this.target.min ? 'fail' : 'pass';
        value = round1(raw.peakValue);
      } else if (CONTINUOUS.has(id)) {
        result = r.warnedThisRep ? 'fail' : r.measuredThisRep > 0 ? 'pass' : 'unknown';
        value = r.worst ? round1(r.worst.value) : null;
      } else {
        result = r.judged?.result ?? 'unknown';
        value = r.judged?.value ?? null;
      }
      return { id, label: text.label, result, value, unit: text.unit };
    });
    this.rep = null;
  }

  private judge(id: FormCheckId, result: RepCheck['result'], value: number | null, t: number): void {
    const r = this.rt(id);
    r.judged = { result, value: value !== null && Number.isFinite(value) ? value : null };
    r.value = r.judged.value;
    this.setState(r, result === 'fail' ? 'warn' : result === 'pass' ? 'ok' : 'unknown', t);
  }

  /** How far past its limit a continuous check is (> 0 = broken), with the value shown; null when not measurable. */
  private evaluate(id: FormCheckId, m: Measures, input: FormInput, speed: number): { value: number; excess: number } | null | 'freeze' {
    const base = this.rep?.baseline;
    const v = input.value;
    const inRep = this.rep !== null;
    const delta = (key: MeasureKey) => {
      const cur = m[key];
      const b = base?.[key];
      return cur === null || b === undefined ? null : cur - b;
    };
    // Between repetitions the baseline checks have nothing to compare with; let an old warning clear.
    const idle = (cur: number | null) => (cur === null ? null : { value: 0, excess: -Infinity });
    switch (id) {
      case 'elbow-straight': {
        const { minElbowDeg, armAboveDeg } = this.cfg(id);
        if (m.elbow === null || v === null) return null;
        return { value: m.elbow, excess: v > armAboveDeg ? minElbowDeg - m.elbow : -Infinity };
      }
      case 'arm-to-side': {
        const { maxForwardDeg, armAboveDeg } = this.cfg(id);
        if (v !== null && v <= armAboveDeg) return { value: m.plane ?? 0, excess: -Infinity };
        return m.plane === null ? null : { value: m.plane, excess: m.plane - maxForwardDeg };
      }
      case 'shoulder-relaxed': {
        const b = base?.shrug;
        if (!inRep) return idle(m.shrug);
        if (m.shrug === null || b === undefined || b <= 0) return null;
        const shrink = (1 - m.shrug / b) * 100;
        return { value: shrink, excess: shrink - this.cfg(id).maxShrinkPct };
      }
      case 'trunk-upright':
      case 'no-swing': {
        if (!inRep) return idle(m.trunk);
        const d = delta('trunk');
        const limit = id === 'no-swing' ? this.cfg('no-swing').maxSwayDeg : this.cfg('trunk-upright').maxLeanDeg;
        return d === null ? null : { value: Math.abs(d), excess: Math.abs(d) - limit };
      }
      case 'sit-tall': {
        if (!inRep) return idle(m.trunk);
        const d = delta('trunk');
        if (d === null || m.facing === null) return null;
        const back = -m.facing * d;
        return { value: back, excess: back - this.cfg(id).maxBackLeanDeg };
      }
      case 'upper-arm-still': {
        if (!inRep) return idle(m.upperArm);
        const d = delta('upperArm');
        return d === null ? null : { value: Math.abs(d), excess: Math.abs(d) - this.cfg(id).maxDriftDeg };
      }
      case 'thigh-still': {
        if (!inRep) return idle(m.thigh);
        const d = delta('thigh');
        return d === null ? null : { value: d, excess: d - this.cfg(id).maxLiftDeg };
      }
      case 'start-straight': {
        // Judged only while settled in the start position; frozen while moving and during a repetition.
        if (inRep || Math.abs(speed) > TOP_SPEED) return 'freeze';
        if (v === null) return null;
        return { value: v, excess: v - this.cfg(id).maxStartDeg };
      }
      case 'within-target': {
        if (v === null || !this.target) return null;
        return { value: v, excess: v - (this.target.max + this.cfg(id).pastToleranceDeg) };
      }
      default:
        return null;
    }
  }

  /** Advances one continuous check's hysteresis state machine. */
  private step(id: FormCheckId, e: { value: number; excess: number } | null | 'freeze', t: number): void {
    if (e === 'freeze') return;
    const r = this.rt(id);
    if (e === null) {
      r.brokenSince = null;
      r.fineSince = null;
      r.value = null;
      this.setState(r, 'unknown', t);
      return;
    }
    r.value = Number.isFinite(e.value) ? e.value : null;
    // Only frames where the rule actually applied count as judged (not an arm resting below the gate).
    if (this.rep && Number.isFinite(e.excess)) {
      r.measuredThisRep++;
      if (Number.isFinite(e.excess) && r.value !== null && (!r.worst || e.excess > r.worst.excess)) r.worst = { excess: e.excess, value: r.value };
    }
    const broken = e.excess > 0;
    const fine = e.excess <= -RELEASE[CHECK_TEXT[id].unit ?? '°'];
    r.brokenSince = broken ? (r.brokenSince ?? t) : null;
    r.fineSince = fine ? (r.fineSince ?? t) : null;
    if (r.state !== 'warn' && r.brokenSince !== null && t - r.brokenSince >= WARN_AFTER_MS) {
      this.setState(r, 'warn', t);
      if (this.rep) r.warnedThisRep = true;
    } else if (r.state === 'warn' && r.fineSince !== null && t - r.fineSince >= CLEAR_AFTER_MS) {
      this.setState(r, 'ok', t);
    } else if (r.state === 'unknown' && !broken) {
      this.setState(r, 'ok', t);
    }
  }

  private setState(r: CheckRuntime, state: CheckState, t: number): void {
    if (r.state !== state) {
      r.state = state;
      r.since = t;
    }
  }

  private live(id: FormCheckId, t: number, quality: ValidityState): LiveCheck {
    const r = this.rt(id);
    const text = CHECK_TEXT[id];
    const state: CheckState = quality === 'reliable' ? r.state : 'unknown';
    const value = state === 'unknown' || r.value === null ? null : round1(r.value);
    return { id, label: text.label, state, value, unit: text.unit, anchor: checkAnchor(id, this.def, this.side), cue: text.cue, sinceMs: Math.max(0, t - r.since) };
  }

  private guide(input: FormInput): MovementGuide {
    const { phase, value, quality } = input;
    const reliable = quality === 'reliable' && value !== null;
    const rep = this.rep;
    const goal = this.target?.min ?? this.def.segmentation.countMin;
    const required = this.holdSeconds * 1000;
    let guidePhase: GuidePhase;
    if (phase === 'waiting') guidePhase = 'get-ready';
    else if (phase === 'ready') guidePhase = 'rest-position';
    else if (phase === 'returning') guidePhase = 'return';
    else if (required > 0 && rep) guidePhase = rep.holdDone ? 'return' : rep.heldMs > 0 ? 'hold' : 'move';
    else guidePhase = rep && rep.heldMs > 0 && value !== null && value >= goal ? 'return' : 'move';

    const from = input.rep?.startValue ?? this.def.demo.neutral;
    const progress = value === null || goal <= from ? 0 : Math.min(1, Math.max(0, (value - from) / (goal - from)));
    const tol = this.def.formChecks['within-target']?.pastToleranceDeg ?? 5;
    return {
      phase: guidePhase,
      instruction: this.words[guidePhase],
      hold: required > 0 ? { heldMs: Math.round(Math.min(required, rep?.holdDone ? required : (rep?.heldMs ?? 0))), requiredMs: required } : null,
      progress,
      inTarget: reliable && !!this.target && value >= this.target.min && value <= this.target.max,
      pastTarget: reliable && !!this.target && value > this.target.max + tol,
    };
  }
}

/** Fastest return speed (°/s) over windows of at least 150 ms, so single-frame jitter cannot dominate. */
function maxReturnSpeed(raw: RawRep, holdTolerance: number): number {
  const pts = raw.samples.filter((s): s is SegmenterSample & { value: number } => s.value !== null);
  let from = 0;
  pts.forEach((s, i) => {
    if (s.value >= raw.peakValue - holdTolerance) from = i;
  });
  const ret = pts.slice(from);
  let best = 0;
  let j = 0;
  for (let i = 1; i < ret.length; i++) {
    const cur = ret[i] as { t: number; value: number };
    while (j + 1 < i && cur.t - (ret[j + 1] as { t: number }).t >= 150) j++;
    const prev = ret[j] as { t: number; value: number };
    const dt = cur.t - prev.t;
    if (dt >= 150) best = Math.max(best, ((prev.value - cur.value) / dt) * 1000);
  }
  return best;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
