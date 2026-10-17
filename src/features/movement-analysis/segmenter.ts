import type { SegmentationConfig } from '@/types/exercise';
import type { IncompleteReason, QualityFlag, ValidityState } from '@/lib/validation/schemas';

/** A smoothed sample fed to the segmenter. `value: null` means no usable measurement at this time. */
export interface SegmenterSample {
  t: number;
  value: number | null;
  state: ValidityState;
  flags: QualityFlag[];
  trunk: number | null;
}

export type SegmenterPhase = 'waiting' | 'ready' | 'outbound' | 'returning';

export interface RawRep {
  startedAt: number;
  endedAt: number;
  startValue: number;
  peakValue: number;
  peakAt: number;
  samples: SegmenterSample[];
}

export type SegmenterEvent =
  | { type: 'phase'; phase: SegmenterPhase; t: number }
  | { type: 'rep'; rep: RawRep }
  | { type: 'incomplete'; at: number; reason: IncompleteReason; peakValue: number | null };

interface ActiveRep {
  startedAt: number;
  startValue: number;
  peakValue: number;
  peakAt: number;
  samples: SegmenterSample[];
}

/**
 * Finite-state machine that turns a stream of joint-angle samples into
 * repetitions. All exercises in the library increase their metric away from a
 * neutral start position and return to it.
 *
 *   waiting ──(value ≤ neutralMax)──▶ ready
 *   ready ──(value > neutralMax + hysteresis)──▶ outbound
 *   outbound ──(value < peak − returnHysteresis)──▶ returning
 *   returning ──(value > peak)──▶ outbound          (movement went higher again)
 *   returning ──(value ≤ neutralMax)──▶ ready       (repetition ends and is evaluated)
 *
 * A repetition is counted only if its peak reached `countMin` and its duration
 * is within [minRepMs, maxRepMs]. Otherwise it is reported as an incomplete
 * attempt with a reason. A gap in usable samples longer than `maxGapMs` during
 * a repetition aborts it ("tracking-lost") and the machine waits for the neutral
 * position again, so it never guesses what happened while it could not see.
 * Repeated or out-of-order timestamps are ignored, so a duplicated frame can
 * never be double-counted.
 */
export class RepSegmenter {
  phase: SegmenterPhase = 'waiting';
  private lastT: number | null = null;
  private lastValidT: number | null = null;
  private lastNeutral: { t: number; value: number; sample: SegmenterSample } | null = null;
  private active: ActiveRep | null = null;

  constructor(private readonly cfg: SegmentationConfig) {}

  get inRepetition(): boolean {
    return this.active !== null;
  }

  get currentPeak(): number | null {
    return this.active?.peakValue ?? null;
  }

  push(sample: SegmenterSample): SegmenterEvent[] {
    if (this.lastT !== null && sample.t <= this.lastT) return [];
    this.lastT = sample.t;

    const events: SegmenterEvent[] = this.checkGap(sample.t);
    if (sample.value === null) return events;

    this.lastValidT = sample.t;
    const v = sample.value;
    const { neutralMax, hysteresis, returnHysteresis, maxRepMs } = this.cfg;

    switch (this.phase) {
      case 'waiting':
        if (v <= neutralMax) {
          this.lastNeutral = { t: sample.t, value: v, sample };
          events.push(this.setPhase('ready', sample.t));
        }
        break;

      case 'ready':
        if (v <= neutralMax) {
          this.lastNeutral = { t: sample.t, value: v, sample };
        } else if (v > neutralMax + hysteresis) {
          const start = this.lastNeutral ?? { t: sample.t, value: v, sample };
          this.active = {
            startedAt: start.t,
            startValue: start.value,
            peakValue: v,
            peakAt: sample.t,
            samples: start.sample === sample ? [sample] : [start.sample, sample],
          };
          events.push(this.setPhase('outbound', sample.t));
        }
        break;

      case 'outbound':
      case 'returning': {
        const rep = this.active;
        if (!rep) {
          events.push(this.setPhase('waiting', sample.t));
          break;
        }
        rep.samples.push(sample);
        if (sample.t - rep.startedAt > maxRepMs) {
          events.push(this.abort(sample.t, 'too-slow'));
          break;
        }
        if (v > rep.peakValue) {
          rep.peakValue = v;
          rep.peakAt = sample.t;
          if (this.phase === 'returning') events.push(this.setPhase('outbound', sample.t));
        } else if (this.phase === 'outbound' && v < rep.peakValue - returnHysteresis) {
          events.push(this.setPhase('returning', sample.t));
        }
        if (this.phase === 'returning' && v <= neutralMax) {
          events.push(...this.finish(sample));
        }
        break;
      }
    }
    return events;
  }

  /** Call when time passes without frames (e.g. the camera stalls) so gaps are detected. */
  tick(now: number): SegmenterEvent[] {
    return this.checkGap(now);
  }

  reset(): void {
    this.phase = 'waiting';
    this.lastT = null;
    this.lastValidT = null;
    this.lastNeutral = null;
    this.active = null;
  }

  private checkGap(now: number): SegmenterEvent[] {
    if (this.active && this.lastValidT !== null && now - this.lastValidT > this.cfg.maxGapMs) {
      return [this.abort(now, 'tracking-lost')];
    }
    if (!this.active && this.phase === 'ready' && this.lastValidT !== null && now - this.lastValidT > this.cfg.maxGapMs) {
      // Lost sight of the person while at rest: require the neutral position again.
      this.lastNeutral = null;
      return [this.setPhase('waiting', now)];
    }
    return [];
  }

  private finish(endSample: SegmenterSample): SegmenterEvent[] {
    const rep = this.active as ActiveRep;
    this.active = null;
    this.lastNeutral = { t: endSample.t, value: endSample.value as number, sample: endSample };
    const duration = endSample.t - rep.startedAt;
    const events: SegmenterEvent[] = [];
    if (duration < this.cfg.minRepMs) {
      events.push({ type: 'incomplete', at: endSample.t, reason: 'too-fast', peakValue: rep.peakValue });
    } else if (rep.peakValue < this.cfg.countMin) {
      events.push({ type: 'incomplete', at: endSample.t, reason: 'below-count-threshold', peakValue: rep.peakValue });
    } else {
      events.push({
        type: 'rep',
        rep: {
          startedAt: rep.startedAt,
          endedAt: endSample.t,
          startValue: rep.startValue,
          peakValue: rep.peakValue,
          peakAt: rep.peakAt,
          samples: rep.samples,
        },
      });
    }
    events.push(this.setPhase('ready', endSample.t));
    return events;
  }

  private abort(t: number, reason: IncompleteReason): SegmenterEvent {
    const peak = this.active?.peakValue ?? null;
    this.active = null;
    this.lastNeutral = null;
    this.phase = 'waiting';
    return { type: 'incomplete', at: t, reason, peakValue: peak };
  }

  private setPhase(phase: SegmenterPhase, t: number): SegmenterEvent {
    this.phase = phase;
    return { type: 'phase', phase, t };
  }
}
