import type { PoseFrame } from '@/types/pose';
import type { ExerciseDefinition, SegmentationConfig } from '@/types/exercise';
import type {
  BodySide,
  IncompleteAttempt,
  MovementFingerprint,
  QualityFlag,
  QualitySummary,
  Repetition,
  TargetRange,
  ValidityState,
} from '@/lib/validation/schemas';
import type { LiveForm } from '@/types/form';
import { JumpDetector, OneEuroFilter, median } from './filters';
import { FormTracker } from './formChecks';
import { buildFingerprint, buildRepetition } from './metrics';
import { LiveQualityWindow, evaluateFrame, unavailable, type MetricSample } from './quality';
import { RepSegmenter, type SegmenterEvent, type SegmenterPhase } from './segmenter';

export interface EngineUpdate {
  sample: MetricSample;
  /** Smoothed metric value used for repetition detection; null when unusable. */
  smoothed: number | null;
  liveQuality: ValidityState;
  phase: SegmenterPhase;
  newRep: Repetition | null;
  incomplete: IncompleteAttempt | null;
  duplicate: boolean;
  /** Live form checks, movement guide and the measurement method used on this frame. */
  form: LiveForm;
}

/** Timestamps beyond this (about the year 2286 in epoch ms) are treated as corrupt, so durations can never overflow. */
const MAX_TIME_MS = 1e13;
const saneTime = (t: number) => Number.isFinite(t) && Math.abs(t) < MAX_TIME_MS;

export interface EngineOptions {
  def: ExerciseDefinition;
  side: BodySide;
  target: TargetRange | null;
  sessionStart: number;
  /** Prescribed hold at the peak, in seconds (0 = no hold). Drives hold guidance and the hold-time check. */
  holdSeconds?: number;
  segmentation?: Partial<SegmentationConfig>;
}

/**
 * The movement-analysis pipeline for one exercise session:
 * pose frame → quality-checked metric → glitch rejection → One Euro smoothing →
 * repetition segmentation → form checks → repetition records + quality statistics.
 * Every output is finite or null, and every stored record fits its schema,
 * whatever the input (NaN coordinates, corrupt timestamps, missing landmarks).
 *
 * It has no DOM or React dependencies, so it runs identically on live camera
 * frames, simulated frames and synthetic test fixtures.
 */
export class MovementEngine {
  readonly reps: Repetition[] = [];
  readonly incompleteAttempts: IncompleteAttempt[] = [];
  setIndex = 1;

  private readonly def: ExerciseDefinition;
  private readonly side: BodySide;
  private readonly target: TargetRange | null;
  private readonly sessionStart: number;
  private readonly segmenter: RepSegmenter;
  private readonly smoother = new OneEuroFilter();
  private readonly jumps = new JumpDetector();
  private readonly live = new LiveQualityWindow();
  private lastT: number | null = null;
  private frames = 0;
  private stateCounts: Record<ValidityState, number> = { reliable: 0, uncertain: 0, unavailable: 0 };
  private flagCounts: Partial<Record<QualityFlag, number>> = {};
  private scales: number[] = [];
  private lastUpdate: EngineUpdate | null = null;
  private readonly form: FormTracker;

  constructor(opts: EngineOptions) {
    this.def = opts.def;
    this.side = opts.side;
    this.target = opts.target;
    this.sessionStart = saneTime(opts.sessionStart) ? opts.sessionStart : 0;
    this.segmenter = new RepSegmenter({ ...opts.def.segmentation, ...opts.segmentation });
    const hold = opts.holdSeconds ?? 0;
    this.form = new FormTracker(opts.def, opts.side, opts.target, Number.isFinite(hold) && hold > 0 ? Math.min(hold, 600) : 0);
  }

  get phase(): SegmenterPhase {
    return this.segmenter.phase;
  }

  get currentPeak(): number | null {
    return this.segmenter.currentPeak;
  }

  process(frame: PoseFrame): EngineUpdate {
    const t = frame.timestamp;
    if (!saneTime(t) || (this.lastT !== null && t <= this.lastT)) {
      if (this.lastUpdate) return { ...this.lastUpdate, newRep: null, incomplete: null, duplicate: true };
      return this.idleUpdate(unavailable(this.lastT ?? 0, ['inference-error']));
    }
    this.lastT = t;

    const sample = evaluateFrame(frame, this.def, this.side);
    let smoothed: number | null = null;
    if (sample.value !== null) {
      if (this.jumps.isJump(sample.t, sample.value)) {
        sample.state = 'uncertain';
        sample.flags = [...sample.flags, 'implausible-jump'];
      } else {
        const v = this.smoother.next(sample.t, sample.value);
        smoothed = Number.isFinite(v) ? v : null;
      }
    }

    this.frames++;
    this.stateCounts[sample.state]++;
    sample.flags.forEach((f) => (this.flagCounts[f] = (this.flagCounts[f] ?? 0) + 1));
    this.live.push(sample.t, sample.state);
    if (sample.scale !== null && sample.state === 'reliable' && this.frames % 5 === 0 && this.scales.length < 600) {
      this.scales.push(sample.scale);
    }

    const events = this.segmenter.push({ t, value: smoothed, state: sample.state, flags: sample.flags, trunk: sample.trunk, method: sample.method });
    const liveQuality = this.live.state(t);
    const finished = events.find((e) => e.type === 'rep');
    const form = this.form.update(
      {
        frame,
        t,
        value: smoothed,
        sampleState: sample.state,
        method: sample.method,
        quality: liveQuality,
        phase: this.segmenter.phase,
        rep: this.segmenter.current,
      },
      finished?.type === 'rep' ? finished.rep : null,
    );
    const { newRep, incomplete } = this.handleEvents(events);

    const update: EngineUpdate = { sample, smoothed, liveQuality, phase: this.segmenter.phase, newRep, incomplete, duplicate: false, form };
    this.lastUpdate = update;
    return update;
  }

  /** An update for a frame that could not be processed (corrupt timestamp before any valid frame). */
  private idleUpdate(sample: MetricSample): EngineUpdate {
    const form = this.form.update({
      frame: { timestamp: sample.t, landmarks: null, imageWidth: 0, imageHeight: 0, provider: { name: '', model: '', version: '', kind: 'simulated' }, status: 'error' },
      t: sample.t,
      value: null,
      sampleState: 'unavailable',
      method: 'none',
      quality: 'unavailable',
      phase: this.segmenter.phase,
      rep: null,
    });
    return { sample, smoothed: null, liveQuality: 'unavailable', phase: this.segmenter.phase, newRep: null, incomplete: null, duplicate: true, form };
  }

  /** Advances time without a frame (camera stalled or paused) so tracking gaps are detected. */
  tick(now: number): IncompleteAttempt | null {
    if (!saneTime(now)) return null;
    return this.handleEvents(this.segmenter.tick(now)).incomplete;
  }

  liveQuality(now: number): ValidityState {
    return this.live.state(now);
  }

  /** Forget any partial repetition and filter state, e.g. after a pause or rest. Counted reps are kept. */
  resetMotionState(): void {
    this.segmenter.reset();
    this.smoother.reset();
    this.form.reset();
    this.jumps.reset();
    this.live.reset();
    this.lastT = null;
    this.lastUpdate = null;
  }

  qualitySummary(): QualitySummary {
    const n = this.frames;
    const frac = (k: ValidityState) => (n === 0 ? 0 : Math.round((this.stateCounts[k] / n) * 1000) / 1000);
    const reliable = frac('reliable');
    const usable = n === 0 ? 0 : (this.stateCounts.reliable + this.stateCounts.uncertain) / n;
    const state: ValidityState = n === 0 ? 'unavailable' : reliable >= 0.7 ? 'reliable' : usable >= 0.5 ? 'uncertain' : 'unavailable';
    const flagCounts: Record<string, number> = {};
    Object.entries(this.flagCounts).forEach(([k, v]) => (flagCounts[k] = v ?? 0));
    return { frames: n, reliable, uncertain: frac('uncertain'), unavailable: frac('unavailable'), flagCounts, state };
  }

  fingerprint(): MovementFingerprint {
    return buildFingerprint(this.reps);
  }

  subjectScale(): number | null {
    const m = median(this.scales);
    return m === null ? null : Math.round(m * 1000) / 1000;
  }

  private handleEvents(events: SegmenterEvent[]): { newRep: Repetition | null; incomplete: IncompleteAttempt | null } {
    let newRep: Repetition | null = null;
    let incomplete: IncompleteAttempt | null = null;
    for (const e of events) {
      if (e.type === 'rep') {
        newRep = buildRepetition(e.rep, this.def, {
          index: this.reps.length + 1,
          setIndex: this.setIndex,
          target: this.target,
          sessionStart: this.sessionStart,
          checks: this.form.repChecks(),
        });
        this.reps.push(newRep);
      } else if (e.type === 'incomplete') {
        incomplete = {
          at: e.at - this.sessionStart,
          reason: e.reason,
          peakValue: e.peakValue === null ? null : Math.round(e.peakValue * 10) / 10,
        };
        this.incompleteAttempts.push(incomplete);
      }
    }
    return { newRep, incomplete };
  }
}
