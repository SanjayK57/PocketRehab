import { ANALYSIS_CONFIG } from './config';

/**
 * Exponential moving average whose smoothing depends on elapsed time rather
 * than frame count: alpha = 1 − exp(−dt / tau). This keeps the filter's
 * behavior the same at 15 fps and 60 fps. The state resets after a gap so a
 * value from before an interruption never bleeds into a new measurement.
 */
export class TimeConstantSmoother {
  private lastT: number | null = null;
  private value: number | null = null;

  constructor(
    private tauMs: number = ANALYSIS_CONFIG.smoothingTauMs,
    private resetAfterMs: number = ANALYSIS_CONFIG.smoothingResetMs,
  ) {}

  next(t: number, v: number): number {
    if (this.lastT === null || this.value === null || t - this.lastT > this.resetAfterMs || t <= this.lastT) {
      this.lastT = t;
      this.value = v;
      return v;
    }
    const dt = t - this.lastT;
    const alpha = 1 - Math.exp(-dt / this.tauMs);
    this.value = this.value + alpha * (v - this.value);
    this.lastT = t;
    return this.value;
  }

  reset(): void {
    this.lastT = null;
    this.value = null;
  }
}

/**
 * Flags physically implausible jumps: the angle changing faster than
 * `maxDegPerSec` between two consecutive frames that are close in time.
 * Compares against the previous raw value, so a sustained real change is only
 * flagged on the transition frame, while a one-frame spike is flagged on both edges.
 */
export class JumpDetector {
  private lastT: number | null = null;
  private lastV: number | null = null;

  constructor(
    private maxDegPerSec: number = ANALYSIS_CONFIG.maxAngularSpeedDegPerSec,
    private maxDtMs: number = ANALYSIS_CONFIG.jumpCheckMaxDtMs,
  ) {}

  isJump(t: number, v: number): boolean {
    const prevT = this.lastT;
    const prevV = this.lastV;
    this.lastT = t;
    this.lastV = v;
    if (prevT === null || prevV === null) return false;
    const dt = t - prevT;
    if (dt <= 0 || dt > this.maxDtMs) return false;
    return (Math.abs(v - prevV) / dt) * 1000 > this.maxDegPerSec;
  }

  reset(): void {
    this.lastT = null;
    this.lastV = null;
  }
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function standardDeviation(values: number[]): number | null {
  const m = mean(values);
  if (m === null || values.length < 2) return null;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Coefficient of variation in percent (sample SD / mean × 100). */
export function coefficientOfVariation(values: number[]): number | null {
  const m = mean(values);
  const sd = standardDeviation(values);
  if (m === null || sd === null || Math.abs(m) < 1e-9) return null;
  return (sd / Math.abs(m)) * 100;
}
