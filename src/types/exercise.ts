import type { BodySide, CameraView, ExerciseId, IncompleteReason, TargetRange } from '@/lib/validation/schemas';
import type { FormCheckId } from './form';

/**
 * Which three landmarks define the measured joint angle, and how the raw
 * interior angle is turned into the displayed value.
 *
 * - `interior`: displayed value is the angle at B between BA and BC.
 * - `supplement`: displayed value is 180° minus the interior angle (used for
 *   elbow flexion so that "more bend" reads as a larger number).
 *
 * `moving` names the segment that moves during the exercise (used to draw the
 * AR ghost guide); the other segment is the reference.
 */
export interface JointMetric {
  /**
   * `joint-angle` (default): the angle at B between BA and BC.
   * `elevation`: the angle of segment B→C from the trunk's downward axis
   * (shoulder or hip midpoint line), so an inboard hip does not bias it; A
   * only names the reference side for drawing. Elevation can also be measured
   * in a 3D body frame from world landmarks, which survives body rotation.
   */
  kind?: 'joint-angle' | 'elevation';
  label: string;
  shortLabel: string;
  unit: '°';
  description: string;
  landmarks: Record<BodySide, { a: number; b: number; c: number }>;
  transform: 'interior' | 'supplement';
  moving: 'a' | 'c';
}

/**
 * Repetition segmentation parameters. These are software parameters chosen for
 * the demonstration library and can be changed per exercise. They are NOT
 * clinically validated thresholds.
 */
export interface SegmentationConfig {
  /** Values at or below this are treated as the neutral/start position. */
  neutralMax: number;
  /** Extra degrees above neutralMax required before a repetition is considered started (hysteresis). */
  hysteresis: number;
  /** Peak value the movement must reach for the repetition to be counted as completed. */
  countMin: number;
  /** How far below the running peak the value must drop before the return phase begins. */
  returnHysteresis: number;
  minRepMs: number;
  maxRepMs: number;
  /** A gap in usable measurements longer than this during a repetition aborts it. */
  maxGapMs: number;
  /** Degrees from the peak that still count as "holding". */
  holdTolerance: number;
  /** Fraction of reliable frames required for a repetition's measurements to be included. */
  minReliableFraction: number;
}

export interface CompensationRule {
  id: string;
  label: string;
  /** Plain-language message used in coaching when the rule triggers on reliable data. */
  message: string;
  kind: 'trunk-lateral-lean' | 'trunk-sagittal-lean';
  /** Degrees of change from the start of the repetition. Demonstration parameter, configurable, unvalidated. */
  thresholdDeg: number;
  /** Consecutive reliable frames over threshold needed before flagging. */
  minFrames: number;
  requiredView: CameraView;
  landmarks: number[];
  thresholdSource: 'demo-parameter';
  limitations: string;
}

/**
 * Thresholds for each real-time form check. Every number is a software
 * demonstration parameter chosen for this library: configurable, explainable,
 * and NOT a clinically validated threshold.
 */
export interface FormCheckThresholds {
  /** Elbow interior angle below `minElbowDeg` while the arm is raised above `armAboveDeg`. */
  'elbow-straight': { minElbowDeg: number; armAboveDeg: number };
  /** Plane of elevation more than `maxForwardDeg` in front of the side plane, once the arm is above `armAboveDeg`. Needs 3D landmarks. */
  'arm-to-side': { maxForwardDeg: number; armAboveDeg: number };
  /** Ear-to-shoulder distance (relative to shoulder width) shrinking by more than `maxShrinkPct` percent of the repetition's start. */
  'shoulder-relaxed': { maxShrinkPct: number };
  /** Sideways trunk lean changing by more than `maxLeanDeg` from the repetition's start. */
  'trunk-upright': { maxLeanDeg: number };
  /** Upper arm angle to the trunk changing by more than `maxDriftDeg` from the repetition's start. */
  'upper-arm-still': { maxDriftDeg: number };
  /** The repetition starting with more than `maxStartDeg` of elbow bend. */
  'start-straight': { maxStartDeg: number };
  /** Forward/backward trunk sway of more than `maxSwayDeg` from the repetition's start. */
  'no-swing': { maxSwayDeg: number };
  /** Trunk leaning back by more than `maxBackLeanDeg` from the repetition's start. */
  'sit-tall': { maxBackLeanDeg: number };
  /** Thigh lifting more than `maxLiftDeg` from its angle at the repetition's start. */
  'thigh-still': { maxLiftDeg: number };
  /** Lowering before the prescribed hold minus `graceMs`. Only active when the plan has a hold. */
  'hold-time': { graceMs: number };
  /** Peak knee angle below `minKneeDeg` or hip angle (shoulder–hip–knee) at the peak below `minHipDeg`. */
  'stand-tall': { minKneeDeg: number; minHipDeg: number };
  /** The measured return phase (leaving the top until back below the seated threshold) shorter than `minSitSeconds`. */
  'controlled-sit': { minSitSeconds: number };
  /** Returning faster than `maxSpeedDegPerSec`, or in less than `minReturnRatio` × the outbound time. */
  'controlled-return': { maxSpeedDegPerSec: number; minReturnRatio: number };
  /** The measured outbound phase (leaving the start position until reaching the top) shorter than `minOutboundSeconds`. */
  'steady-pace': { minOutboundSeconds: number };
  /** Peak more than `pastToleranceDeg` above the target maximum counts as past the target. Needs a target. */
  'within-target': { pastToleranceDeg: number };
}

/** The checks an exercise runs, in display order (object key order), with their demonstration thresholds. */
export type FormCheckConfig = { [K in FormCheckId]?: FormCheckThresholds[K] };

/**
 * How the synthetic person performs the movement. The generator builds the
 * posture, then turns the metric's moving segment about joint B so the metric
 * equals the requested value exactly, so a new exercise (or a user-made one)
 * gets a simulated demo and test poses from data alone.
 */
export interface DemoPose {
  posture: 'standing' | 'seated';
  /**
   * Where the moving segment points when the interior angle at B is 90°,
   * i.e. the side the angle opens toward. `outward` = away from the body's midline.
   */
  bendToward: 'outward' | 'forward' | 'backward' | 'up' | 'down';
  /**
   * The body rises over the measured joint (sit to stand): both legs follow the
   * value and the upper body rides on the hips, leaning forward by up to this
   * many degrees early in the rise.
   */
  riseLeanDeg?: number;
}

export interface EquipmentItem {
  id: string;
  name: string;
  required: boolean;
  note: string;
}

export interface ExercisePhase {
  id: 'start' | 'outbound' | 'hold' | 'return';
  label: string;
  description: string;
}

export interface ExerciseDefinition {
  id: ExerciseId;
  version: string;
  name: string;
  shortName: string;
  bodyArea: 'shoulder' | 'elbow' | 'hip' | 'knee' | 'legs';
  description: string;
  cameraView: CameraView;
  /** `choose`: user/clinician picks the side. `auto`: the side closer to the camera is used. */
  sideMode: 'choose' | 'auto';
  cameraSetup: string[];
  instructions: string[];
  shortInstruction: string;
  phases: ExercisePhase[];
  metric: JointMetric;
  segmentation: SegmentationConfig;
  /** Example prescription used ONLY for the demonstration plan. */
  demoPrescription: {
    sets: number;
    reps: number;
    holdSeconds: number;
    restSeconds: number;
    target: TargetRange;
  };
  compensationRules: CompensationRule[];
  /** Real-time form checks for this exercise (demonstration thresholds, see FormCheckThresholds). */
  formChecks: FormCheckConfig;
  supportsSideComparison: boolean;
  warnings: string[];
  limitations: string[];
  equipment: EquipmentItem[];
  /** Angles and posture used by the demonstration figure, the simulated demo and the synthetic test poses. */
  demo: { neutral: number; peak: number; pose: DemoPose };
  source: string;
}

export const INCOMPLETE_REASON_TEXT: Record<IncompleteReason, string> = {
  'below-count-threshold': 'The movement did not reach the range needed to count a repetition.',
  'too-fast': 'The movement was shorter than the minimum repetition time, so it was treated as noise.',
  'too-slow': 'The movement took longer than the maximum repetition time.',
  'tracking-lost': 'Tracking was lost during the movement, so it could not be measured.',
};
