/**
 * Central configuration for movement analysis. These are software parameters
 * chosen for the demonstration build; none of them is a clinically validated
 * threshold. Changing them changes how strict tracking-quality checks are.
 */
export const ANALYSIS_CONFIG = {
  /** Landmark visibility at or above this is treated as reliable for measurement. */
  visibilityReliable: 0.65,
  /** Below this the landmark is treated as not visible at all (no measurement produced). */
  visibilityUsable: 0.3,
  /** Normalized distance from the image border that counts as "near the edge". */
  edgeMargin: 0.02,
  /** Angle changes faster than this between consecutive frames are treated as tracking glitches. */
  maxAngularSpeedDegPerSec: 720,
  /** Only check for glitches between frames closer together than this; larger gaps are handled as gaps. */
  jumpCheckMaxDtMs: 250,
  /** Time constant of the exponential smoothing filter. Frame-rate independent. */
  smoothingTauMs: 70,
  /** Filter state is reset after a gap this long. */
  smoothingResetMs: 400,
  /** Window used for the live tracking-quality indicator. */
  liveQualityWindowMs: 1000,
  liveReliableFraction: 0.8,
  liveUsableFraction: 0.5,
  view: {
    /** Shoulder width / torso length at or above this suggests the person faces the camera. */
    frontMinRatio: 0.45,
    /** At or below this suggests a side view. */
    sideMaxRatio: 0.3,
  },
  smoothness: {
    resampleHz: 30,
    /** A speed peak must be at least this fraction of the repetition's maximum speed. */
    minPeakFraction: 0.2,
    /** Between two counted peaks the speed must dip below this fraction of the smaller peak. */
    valleyFraction: 0.6,
    minSamples: 8,
    /** Resampling is refused across gaps longer than this. */
    maxGapMs: 200,
  },
  consistencyMinReps: 3,
  /** A session's fingerprint is marked valid only with at least this many reliable repetitions. */
  minValidRepsForSession: 2,
  /** Average frame brightness (0–255) below which the setup check warns about lighting. */
  lowLightLuma: 45,
  comparison: {
    /** Subject scale (torso length / frame height) differing by more than this fraction triggers a warning. */
    maxScaleDifference: 0.25,
  },
  trend: {
    minComparableSessions: 3,
    plateauSessions: 4,
    plateauBandDeg: 5,
  },
} as const;
