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
import { JumpDetector, TimeConstantSmoother, median } from './filters';
import { buildFingerprint, buildRepetition } from './metrics';
import { LiveQualityWindow, evaluateFrame, type MetricSample } from './quality';
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
}

export interface EngineOptions {
  def: ExerciseDefinition;
  side: BodySide;
  target: TargetRange | null;
  sessionStart: number;
  segmentation?: Partial<SegmentationConfig>;
}

/**
 * The movement-analysis pipeline for one exercise session:
 * pose frame → quality-checked metric → glitch rejection → smoothing →
 * repetition segmentation → repetition records + quality statistics.
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
  private readonly smoother = new TimeConstantSmoother();
  private readonly jumps = new JumpDetector();
  private readonly live = new LiveQualityWindow();
  private lastT: number | null = null;
  private frames = 0;
  private stateCounts: Record<ValidityState, number> = { reliable: 0, uncertain: 0, unavailable: 0 };
  private flagCounts: Partial<Record<QualityFlag, number>> = {};
  private scales: number[] = [];
  private lastUpdate: EngineUpdate | null = null;

  constructor(opts: EngineOptions) {
    this.def = opts.def;
    this.side = opts.side;
    this.target = opts.target;
    this.sessionStart = opts.sessionStart;
    this.segmenter = new RepSegmenter({ ...opts.def.segmentation, ...opts.segmentation });
  }

  get phase(): SegmenterPhase {
    return this.segmenter.phase;
  }

  get currentPeak(): number | null {
    return this.segmenter.currentPeak;
  }

  process(frame: PoseFrame): EngineUpdate {
    if (this.lastT !== null && frame.timestamp <= this.lastT && this.lastUpdate) {
      return { ...this.lastUpdate, newRep: null, incomplete: null, duplicate: true };
    }
    this.lastT = frame.timestamp;

    const sample = evaluateFrame(frame, this.def, this.side);
    let smoothed: number | null = null;
    if (sample.value !== null) {
      if (this.jumps.isJump(sample.t, sample.value)) {
        sample.state = 'uncertain';
        sample.flags = [...sample.flags, 'implausible-jump'];
      } else {
        smoothed = this.smoother.next(sample.t, sample.value);
      }
    }

    this.frames++;
    this.stateCounts[sample.state]++;
    sample.flags.forEach((f) => (this.flagCounts[f] = (this.flagCounts[f] ?? 0) + 1));
    this.live.push(sample.t, sample.state);
    if (sample.scale !== null && sample.state === 'reliable' && this.frames % 5 === 0 && this.scales.length < 600) {
      this.scales.push(sample.scale);
    }

    const events = this.segmenter.push({ t: sample.t, value: smoothed, state: sample.state, flags: sample.flags, trunk: sample.trunk });
    const { newRep, incomplete } = this.handleEvents(events);

    const update: EngineUpdate = {
      sample,
      smoothed,
      liveQuality: this.live.state(sample.t),
      phase: this.segmenter.phase,
      newRep,
      incomplete,
      duplicate: false,
    };
    this.lastUpdate = update;
    return update;
  }

  /** Advances time without a frame (camera stalled or paused) so tracking gaps are detected. */
  tick(now: number): IncompleteAttempt | null {
    return this.handleEvents(this.segmenter.tick(now)).incomplete;
  }

  liveQuality(now: number): ValidityState {
    return this.live.state(now);
  }

  /** Forget any partial repetition and filter state, e.g. after a pause or rest. Counted reps are kept. */
  resetMotionState(): void {
    this.segmenter.reset();
    this.smoother.reset();
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
