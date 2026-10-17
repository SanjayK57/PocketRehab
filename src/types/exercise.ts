import type { BodySide, CameraView, ExerciseId, IncompleteReason, TargetRange } from '@/lib/validation/schemas';

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
  bodyArea: 'shoulder' | 'elbow' | 'knee' | 'legs';
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
  supportsSideComparison: boolean;
  warnings: string[];
  limitations: string[];
  equipment: EquipmentItem[];
  /** Angles used by the animated demonstration figure. */
  demo: { neutral: number; peak: number };
  source: string;
}

export const INCOMPLETE_REASON_TEXT: Record<IncompleteReason, string> = {
  'below-count-threshold': 'The movement did not reach the range needed to count a repetition.',
  'too-fast': 'The movement was shorter than the minimum repetition time, so it was treated as noise.',
  'too-slow': 'The movement took longer than the maximum repetition time.',
  'tracking-lost': 'Tracking was lost during the movement, so it could not be measured.',
};
