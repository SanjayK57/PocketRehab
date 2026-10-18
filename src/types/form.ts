/**
 * Real-time form checks and movement guidance: the contract between the
 * movement engine (producer, src/features/movement-analysis) and the live
 * coaching screen, AR overlay and coach (consumers, src/features/live-coaching).
 *
 * Every check is a deterministic, explainable software rule with a labelled
 * demonstration threshold. A check reports `unknown` whenever tracking is not
 * reliable enough to judge it, and consumers never show form feedback for
 * `unknown`.
 */

export type FormCheckId =
  // arm raise to the side
  | 'elbow-straight'
  | 'arm-to-side'
  | 'shoulder-relaxed'
  | 'trunk-upright'
  // bicep curl
  | 'upper-arm-still'
  | 'start-straight'
  | 'no-swing'
  // seated knee straightening
  | 'sit-tall'
  | 'thigh-still'
  | 'hold-time'
  // sit to stand
  | 'stand-tall'
  | 'controlled-sit'
  // every exercise
  | 'controlled-return'
  | 'steady-pace'
  | 'within-target';

/**
 * - `unknown`: not judged right now (tracking not reliable, the check's own
 *   landmarks not reliable, or a per-repetition check not decided yet for this repetition).
 * - `ok`: judged and fine.
 * - `warn`: the rule is broken. Posture checks get here only after the rule has
 *   been broken for 350 ms and leave only after it has been clearly fine for
 *   350 ms; per-repetition checks keep their result until the next repetition starts.
 */
export type CheckState = 'ok' | 'warn' | 'unknown';

/**
 * How the joint angle was measured on this frame: the camera image only
 * ('2d'), a blend of the image and the model's 3D world landmarks ('hybrid'),
 * or a trunk-fixed 3D frame ('3d-body-frame', arm raise with the body turned).
 */
export type MeasurementMethod = '3d-body-frame' | 'hybrid' | '2d' | 'none';

export interface LiveCheck {
  id: FormCheckId;
  /** Short chip label, e.g. "Elbow straight". */
  label: string;
  state: CheckState;
  /** The measured quantity behind the check, when measurable. */
  value: number | null;
  unit: '°' | 's' | '%' | null;
  /** MediaPipe landmark index the AR chip/highlight anchors to; null for a whole-body check. */
  anchor: number | null;
  /**
   * One fixed sentence used for caption and voice when the check turns to `warn`
   * (it is pre-recorded in the coach voice pack, so it must not contain numbers that vary).
   */
  cue: string;
  /** Milliseconds the check has been in its current state. */
  sinceMs: number;
}

/**
 * One check's result for a finished repetition. `fail` when the check warned
 * during the repetition (or its per-repetition rule failed); `unknown` when it
 * could not be judged, and always `unknown` on a repetition whose tracking was uncertain.
 */
export interface RepCheck {
  id: FormCheckId;
  label: string;
  result: 'pass' | 'fail' | 'unknown';
  /** Worst value seen during the repetition (posture checks) or the judged value (timing: seconds; target: peak °). */
  value: number | null;
  unit: '°' | 's' | '%' | null;
}

export type GuidePhase = 'get-ready' | 'move' | 'hold' | 'return' | 'rest-position';

export interface MovementGuide {
  phase: GuidePhase;
  /** Large on-stage instruction: "Raise", "Hold", "Lower slowly", "Get into position". */
  instruction: string;
  /** During a prescribed hold: time held so far and time required. Null when the plan has no hold. */
  hold: { heldMs: number; requiredMs: number } | null;
  /** 0..1 progress from the neutral position toward the target (or the counting threshold without a target). */
  progress: number;
  /** Current value is inside the target band and tracking is reliable. */
  inTarget: boolean;
  /** Current value is beyond target.max + tolerance: show "past your target", never push further. */
  pastTarget: boolean;
}

export interface LiveForm {
  checks: LiveCheck[];
  guide: MovementGuide;
  method: MeasurementMethod;
}
