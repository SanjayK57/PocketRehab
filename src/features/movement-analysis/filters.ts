import type { Landmark } from '@/types/pose';
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

const alphaFor = (cutoffHz: number, dtS: number) => 1 / (1 + 1 / (2 * Math.PI * cutoffHz * dtS));

/**
 * One Euro filter (Casiez, Roussel & Vogel, CHI 2012): a low-pass filter whose
 * cutoff rises with speed, so a joint at rest is heavily smoothed while a
 * fast movement (and its peak) passes with little lag. Timestamps in ms;
 * `beta` is per unit of the signal per second. State resets after a gap or a
 * non-increasing timestamp so values from before an interruption never bleed in.
 */
export class OneEuroFilter {
  private lastT: number | null = null;
  private x: number | null = null;
  private dx = 0;

  constructor(
    private readonly minCutoffHz: number = ANALYSIS_CONFIG.oneEuro.minCutoffHz,
    private readonly beta: number = ANALYSIS_CONFIG.oneEuro.beta,
    private readonly dCutoffHz: number = ANALYSIS_CONFIG.oneEuro.dCutoffHz,
    private readonly resetAfterMs: number = ANALYSIS_CONFIG.smoothingResetMs,
  ) {}

  next(t: number, v: number): number {
    if (!Number.isFinite(t) || !Number.isFinite(v)) return this.x ?? v;
    if (this.lastT === null || this.x === null || t <= this.lastT || t - this.lastT > this.resetAfterMs) {
      this.lastT = t;
      this.x = v;
      this.dx = 0;
      return v;
    }
    const dtS = (t - this.lastT) / 1000;
    const rawDx = (v - this.x) / dtS;
    this.dx += alphaFor(this.dCutoffHz, dtS) * (rawDx - this.dx);
    const cutoff = this.minCutoffHz + this.beta * Math.abs(this.dx);
    this.x += alphaFor(cutoff, dtS) * (v - this.x);
    this.lastT = t;
    if (!Number.isFinite(this.x) || !Number.isFinite(this.dx)) {
      this.reset();
      return v;
    }
    return this.x;
  }

  reset(): void {
    this.lastT = null;
    this.x = null;
    this.dx = 0;
  }
}

/**
 * Smooths whole landmark sets for drawing (AR skeleton, joint rings) with one
 * One Euro filter per coordinate, so the overlay stops shimmering at rest but
 * still keeps up with a fast arm. Coordinates are normalized (0..1), hence a
 * large `beta`. Display only: measurements use the raw landmarks.
 */
export class LandmarkSmoother {
  private filters: OneEuroFilter[] = [];

  constructor(
    private readonly minCutoffHz = 1.2,
    private readonly beta = 6,
  ) {}

  /** Returns a smoothed copy; visibility and presence pass through unchanged. Null/empty input resets the filters. */
  smooth(landmarks: Landmark[] | null | undefined, t: number): Landmark[] | null {
    if (!landmarks || landmarks.length === 0) {
      this.reset();
      return null;
    }
    const need = landmarks.length * 3;
    while (this.filters.length < need) this.filters.push(new OneEuroFilter(this.minCutoffHz, this.beta, 1));
    return landmarks.map((lm, i) => {
      if (!lm) return lm;
      const f = (k: number, v: number) => (Number.isFinite(v) ? (this.filters[i * 3 + k] as OneEuroFilter).next(t, v) : v);
      return { ...lm, x: f(0, lm.x), y: f(1, lm.y), z: f(2, lm.z) };
    });
  }

  reset(): void {
    this.filters.forEach((f) => f.reset());
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
