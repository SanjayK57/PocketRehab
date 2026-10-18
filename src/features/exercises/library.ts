import { LM } from '@/types/pose';
import type { ExerciseDefinition, FormCheckConfig, SegmentationConfig } from '@/types/exercise';
import type { ExerciseId } from '@/lib/validation/schemas';

/**
 * PocketRehab demonstration exercise library (v1).
 *
 * These four movements were chosen because a single ordinary camera can
 * observe the measured joint angle reasonably well from one stated view.
 * Every numeric value here (targets, thresholds, form-check limits) is a
 * software demonstration parameter, not a clinically validated value. Real targets must come from the
 * user's clinician and are labeled with their source wherever they are shown.
 */

const SOURCE = 'PocketRehab demonstration library v1.0 — software-testing example, not a clinical protocol or recommendation.';

const GENERAL_WARNINGS = [
  'Only do this movement if it is part of the plan your clinician gave you or approved.',
  'Stop and follow your clinician’s instructions if you notice new or worsening symptoms.',
];

const shoulderAbduction: ExerciseDefinition = {
  id: 'shoulder-abduction',
  version: '1.0.0',
  name: 'Arm raise to the side',
  shortName: 'Arm raise',
  bodyArea: 'shoulder',
  description:
    'Raise one arm out to the side and lower it back down, keeping the elbow straight. PocketRehab measures the angle between your upper arm and your torso.',
  cameraView: 'front',
  sideMode: 'choose',
  cameraSetup: [
    'Face the camera directly, standing or sitting upright.',
    'Place the camera about 1.5–2.5 m (5–8 ft) away so your head, both shoulders and both hips are in view.',
    'Use even lighting from the front; avoid a bright window behind you.',
  ],
  instructions: [
    'Start with your arm relaxed at your side.',
    'Raise your arm out to the side with the elbow straight, as far as your plan allows.',
    'Pause briefly at the top if your plan includes a hold.',
    'Lower your arm slowly back to your side.',
  ],
  shortInstruction: 'Raise your arm out to the side, then lower it slowly.',
  phases: [
    { id: 'start', label: 'Start', description: 'Arm relaxed at your side.' },
    { id: 'outbound', label: 'Raise', description: 'Lift the arm out to the side.' },
    { id: 'hold', label: 'Hold', description: 'Pause at the top if your plan includes a hold.' },
    { id: 'return', label: 'Lower', description: 'Lower the arm back to your side.' },
  ],
  metric: {
    kind: 'elevation',
    label: 'Shoulder abduction angle (camera estimate)',
    shortLabel: 'Arm angle',
    unit: '°',
    description:
      'Angle between your trunk (the line from the middle of your hips to the middle of your shoulders) and your upper arm. When the camera model provides 3D landmarks and your body is turned, it is measured in a frame fixed to your trunk, so turning does not change the number.',
    landmarks: {
      left: { a: LM.leftHip, b: LM.leftShoulder, c: LM.leftElbow },
      right: { a: LM.rightHip, b: LM.rightShoulder, c: LM.rightElbow },
    },
    transform: 'interior',
    moving: 'c',
  },
  segmentation: {
    neutralMax: 30,
    hysteresis: 6,
    countMin: 60,
    returnHysteresis: 10,
    minRepMs: 800,
    maxRepMs: 30000,
    maxGapMs: 600,
    holdTolerance: 6,
    minReliableFraction: 0.8,
  },
  demoPrescription: { sets: 2, reps: 6, holdSeconds: 0, restSeconds: 30, target: { min: 80, max: 100, source: 'demo-example' } },
  compensationRules: [
    {
      id: 'trunk-lateral-lean',
      label: 'Torso lean',
      message: 'Your torso tilted sideways during that repetition. Try to keep your body upright as you raise your arm.',
      kind: 'trunk-lateral-lean',
      thresholdDeg: 15,
      minFrames: 4,
      requiredView: 'front',
      landmarks: [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip],
      thresholdSource: 'demo-parameter',
      limitations: 'Measured from the 2D line between hip midpoint and shoulder midpoint. A tilted camera or turning the body can trigger or hide it.',
    },
  ],
  formChecks: {
    'elbow-straight': { minElbowDeg: 150, armAboveDeg: 45 },
    'arm-to-side': { maxForwardDeg: 35, armAboveDeg: 40 },
    'shoulder-relaxed': { maxShrinkPct: 25 },
    'trunk-upright': { maxLeanDeg: 10 },
    'hold-time': { graceMs: 250 },
    'steady-pace': { minOutboundSeconds: 0.45 },
    'controlled-return': { maxSpeedDegPerSec: 180, minReturnRatio: 0.5 },
    'within-target': { pastToleranceDeg: 5 },
  },
  supportsSideComparison: true,
  warnings: GENERAL_WARNINGS,
  limitations: [
    'This is a camera estimate, not a goniometer measurement. Facing the camera gives the most accurate value; turned more than about 30°, it relies on the model’s 3D estimate, which is less precise.',
    'Requires a front view. From the side, the arm moves toward the camera and the angle cannot be measured reliably.',
  ],
  equipment: [],
  demo: { neutral: 15, peak: 90, pose: { posture: 'standing', bendToward: 'outward' } },
  source: SOURCE,
};

const elbowFlexion: ExerciseDefinition = {
  id: 'elbow-flexion',
  version: '1.0.0',
  name: 'Bicep curl (elbow bend)',
  shortName: 'Bicep curl',
  bodyArea: 'elbow',
  description:
    'Bend your elbow to bring your hand toward your shoulder, then straighten it again. PocketRehab measures how far the elbow bends from straight.',
  cameraView: 'side',
  sideMode: 'choose',
  cameraSetup: [
    'Turn so the arm you are exercising faces the camera (side view).',
    'Keep your shoulder, elbow and wrist in view the whole time.',
    'Keep the upper arm still and close to your body.',
  ],
  instructions: [
    'Start with your arm straight and relaxed by your side.',
    'Bend the elbow to bring your hand up toward your shoulder.',
    'Pause briefly at the top if your plan includes a hold.',
    'Lower your hand slowly until the arm is straight again.',
  ],
  shortInstruction: 'Bend your elbow to lift your hand, then lower it slowly.',
  phases: [
    { id: 'start', label: 'Start', description: 'Arm straight by your side.' },
    { id: 'outbound', label: 'Bend', description: 'Bend the elbow, bringing the hand up.' },
    { id: 'hold', label: 'Hold', description: 'Pause at the top if your plan includes a hold.' },
    { id: 'return', label: 'Lower', description: 'Straighten the arm slowly.' },
  ],
  metric: {
    label: 'Elbow flexion (camera estimate)',
    shortLabel: 'Elbow bend',
    unit: '°',
    description: '180° minus the angle at the elbow between the upper arm and forearm, measured in the camera image. 0° means a straight arm.',
    landmarks: {
      left: { a: LM.leftShoulder, b: LM.leftElbow, c: LM.leftWrist },
      right: { a: LM.rightShoulder, b: LM.rightElbow, c: LM.rightWrist },
    },
    transform: 'supplement',
    moving: 'c',
  },
  segmentation: {
    neutralMax: 35,
    hysteresis: 6,
    countMin: 75,
    returnHysteresis: 10,
    minRepMs: 700,
    maxRepMs: 30000,
    maxGapMs: 600,
    holdTolerance: 6,
    minReliableFraction: 0.8,
  },
  demoPrescription: { sets: 2, reps: 8, holdSeconds: 0, restSeconds: 30, target: { min: 100, max: 140, source: 'demo-example' } },
  compensationRules: [],
  formChecks: {
    'upper-arm-still': { maxDriftDeg: 20 },
    'start-straight': { maxStartDeg: 25 },
    'no-swing': { maxSwayDeg: 10 },
    'hold-time': { graceMs: 250 },
    'steady-pace': { minOutboundSeconds: 0.45 },
    'controlled-return': { maxSpeedDegPerSec: 180, minReturnRatio: 0.5 },
    'within-target': { pastToleranceDeg: 5 },
  },
  supportsSideComparison: true,
  warnings: GENERAL_WARNINGS,
  limitations: [
    'If the forearm turns toward or away from the camera, the image angle under- or over-estimates the bend; with 3D landmarks PocketRehab corrects part of this, but a true side view is still the most accurate.',
    'Loose sleeves can hide the elbow and lower tracking quality.',
  ],
  equipment: [
    {
      id: 'light-weight',
      name: 'Hand weight',
      required: false,
      note: 'Only if your plan specifies a weight. The demonstration version uses no weight.',
    },
  ],
  demo: { neutral: 10, peak: 120, pose: { posture: 'standing', bendToward: 'forward' } },
  source: SOURCE,
};

const kneeExtension: ExerciseDefinition = {
  id: 'knee-extension',
  version: '1.0.0',
  name: 'Seated knee straightening',
  shortName: 'Knee extension',
  bodyArea: 'knee',
  description:
    'Sitting in a chair, straighten one knee to lift your foot forward, then lower it back down. PocketRehab measures the angle at your knee.',
  cameraView: 'side',
  sideMode: 'choose',
  cameraSetup: [
    'Sit sideways to the camera so the leg you are exercising is closest to it.',
    'Place the camera low (about seat height) and 1.5–2.5 m (5–8 ft) away.',
    'Your hip, knee and ankle must stay in view the whole time.',
  ],
  instructions: [
    'Sit upright with your foot on the floor and the knee bent.',
    'Straighten the knee to lift your foot forward, as far as your plan allows.',
    'Hold at the top for the time in your plan.',
    'Lower your foot slowly back to the floor.',
  ],
  shortInstruction: 'Straighten your knee to lift your foot, hold, then lower it slowly.',
  phases: [
    { id: 'start', label: 'Start', description: 'Seated, foot on the floor, knee bent.' },
    { id: 'outbound', label: 'Straighten', description: 'Straighten the knee to lift the foot.' },
    { id: 'hold', label: 'Hold', description: 'Hold the leg up for the time in your plan.' },
    { id: 'return', label: 'Lower', description: 'Lower the foot back to the floor.' },
  ],
  metric: {
    label: 'Knee angle (camera estimate)',
    shortLabel: 'Knee angle',
    unit: '°',
    description: 'Angle at the knee between the thigh (knee to hip) and shin (knee to ankle) in the camera image. 180° is a fully straight leg.',
    landmarks: {
      left: { a: LM.leftHip, b: LM.leftKnee, c: LM.leftAnkle },
      right: { a: LM.rightHip, b: LM.rightKnee, c: LM.rightAnkle },
    },
    transform: 'interior',
    moving: 'c',
  },
  segmentation: {
    neutralMax: 115,
    hysteresis: 6,
    countMin: 140,
    returnHysteresis: 10,
    minRepMs: 800,
    maxRepMs: 40000,
    maxGapMs: 600,
    holdTolerance: 8,
    minReliableFraction: 0.8,
  },
  demoPrescription: { sets: 2, reps: 6, holdSeconds: 3, restSeconds: 45, target: { min: 160, max: 180, source: 'demo-example' } },
  compensationRules: [
    {
      id: 'trunk-sagittal-lean',
      label: 'Leaning back',
      message: 'Your torso leaned back during that repetition. Try to stay sitting upright while you straighten your knee.',
      kind: 'trunk-sagittal-lean',
      thresholdDeg: 20,
      minFrames: 4,
      requiredView: 'side',
      landmarks: [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip],
      thresholdSource: 'demo-parameter',
      limitations: 'Measured as the change in the hip-to-shoulder line from the start of the repetition. A chair back can hide the hip.',
    },
  ],
  formChecks: {
    'sit-tall': { maxBackLeanDeg: 12 },
    'thigh-still': { maxLiftDeg: 12 },
    'hold-time': { graceMs: 250 },
    'steady-pace': { minOutboundSeconds: 0.45 },
    'controlled-return': { maxSpeedDegPerSec: 180, minReturnRatio: 0.5 },
    'within-target': { pastToleranceDeg: 5 },
  },
  supportsSideComparison: true,
  warnings: GENERAL_WARNINGS,
  limitations: [
    'The chair, loose clothing or a blanket can hide the hip or knee and reduce tracking quality.',
    'If the leg points toward the camera instead of across it, the angle is under-estimated.',
  ],
  equipment: [
    {
      id: 'sturdy-chair',
      name: 'Sturdy chair without wheels',
      required: true,
      note: 'Needed to do the seated movement as described.',
    },
  ],
  demo: { neutral: 95, peak: 168, pose: { posture: 'seated', bendToward: 'down' } },
  source: SOURCE,
};

const sitToStand: ExerciseDefinition = {
  id: 'sit-to-stand',
  version: '1.0.0',
  name: 'Sit to stand',
  shortName: 'Sit to stand',
  bodyArea: 'legs',
  description:
    'Stand up from a chair and sit back down with control. PocketRehab measures the knee angle on the side facing the camera.',
  cameraView: 'side',
  sideMode: 'auto',
  cameraSetup: [
    'Place the chair sideways to the camera.',
    'Put the camera 2–3 m (7–10 ft) away so your whole body, standing and sitting, stays in view.',
    'Make sure nothing blocks the view of your hip, knee and ankle.',
  ],
  instructions: [
    'Sit near the front of the chair with your feet flat on the floor.',
    'Stand up fully, using the method your clinician showed you.',
    'Pause briefly when standing if your plan includes a hold.',
    'Sit back down slowly and with control.',
  ],
  shortInstruction: 'Stand up from the chair, then sit back down slowly.',
  phases: [
    { id: 'start', label: 'Seated', description: 'Seated near the front of the chair.' },
    { id: 'outbound', label: 'Stand up', description: 'Rise to standing.' },
    { id: 'hold', label: 'Stand', description: 'Pause standing if your plan includes a hold.' },
    { id: 'return', label: 'Sit down', description: 'Lower back down to the chair with control.' },
  ],
  metric: {
    label: 'Knee angle (camera estimate)',
    shortLabel: 'Knee angle',
    unit: '°',
    description: 'Angle at the knee between thigh and shin on the side closest to the camera. Larger means more upright.',
    landmarks: {
      left: { a: LM.leftHip, b: LM.leftKnee, c: LM.leftAnkle },
      right: { a: LM.rightHip, b: LM.rightKnee, c: LM.rightAnkle },
    },
    transform: 'interior',
    moving: 'a',
  },
  segmentation: {
    neutralMax: 120,
    hysteresis: 8,
    countMin: 150,
    returnHysteresis: 10,
    minRepMs: 1200,
    maxRepMs: 30000,
    maxGapMs: 700,
    holdTolerance: 8,
    minReliableFraction: 0.8,
  },
  demoPrescription: { sets: 1, reps: 5, holdSeconds: 0, restSeconds: 60, target: { min: 160, max: 180, source: 'demo-example' } },
  compensationRules: [],
  // controlled-sit replaces controlled-return here: both would judge the same descent.
  formChecks: {
    'stand-tall': { minKneeDeg: 165, minHipDeg: 160 },
    'controlled-sit': { minSitSeconds: 0.45 },
    'hold-time': { graceMs: 250 },
    'steady-pace': { minOutboundSeconds: 0.45 },
    'within-target': { pastToleranceDeg: 5 },
  },
  supportsSideComparison: false,
  warnings: [
    ...GENERAL_WARNINGS,
    'Use a stable chair that cannot roll or slide, and have support nearby if your clinician advised it.',
  ],
  limitations: [
    'Needs your whole body in view. Laptop cameras usually have to be 2–3 m away, which lowers tracking detail.',
    'The chair can hide the hip while seated, which may lower tracking quality at the start of each repetition.',
  ],
  equipment: [
    { id: 'sturdy-chair', name: 'Sturdy chair without wheels', required: true, note: 'Needed to do the movement as described.' },
    { id: 'clear-space', name: 'Clear floor space around the chair', required: true, note: 'So nothing is in the way when you stand.' },
  ],
  demo: { neutral: 95, peak: 172, pose: { posture: 'seated', bendToward: 'backward', riseLeanDeg: 35 } },
  source: SOURCE,
};


// ---------------------------------------------------------------------------
// Archive exercises. Same rules as above; each entry only states what differs.

type ArchiveInput = Omit<ExerciseDefinition, 'version' | 'warnings' | 'compensationRules' | 'source' | 'segmentation' | 'formChecks' | 'phases'> & {
  segmentation: Pick<SegmentationConfig, 'neutralMax' | 'countMin'> & Partial<SegmentationConfig>;
  /** Labels for the start, outbound, hold and return phases. */
  phaseWords: [start: string, outbound: string, ret: string];
  phaseHints: [start: string, outbound: string, ret: string];
  view: 'front' | 'side';
  /** Replaces the default posture check when it would interfere with the measurement. */
  checks?: FormCheckConfig;
};

const TIMING_CHECKS: FormCheckConfig = {
  'hold-time': { graceMs: 250 },
  'steady-pace': { minOutboundSeconds: 0.45 },
  'controlled-return': { maxSpeedDegPerSec: 180, minReturnRatio: 0.5 },
  'within-target': { pastToleranceDeg: 5 },
};

const BALANCE: ExerciseDefinition['equipment'][number] = {
  id: 'support',
  name: 'Counter or sturdy chair to hold',
  required: false,
  note: 'Hold on lightly for balance if you need to. Keep it out of the way of the measured leg.',
};

function archive({ segmentation, phaseWords, phaseHints, view, checks, ...e }: ArchiveInput): ExerciseDefinition {
  return {
    ...e,
    version: '1.0.0',
    warnings: GENERAL_WARNINGS,
    compensationRules: [],
    source: SOURCE,
    phases: [
      { id: 'start', label: phaseWords[0], description: phaseHints[0] },
      { id: 'outbound', label: phaseWords[1], description: phaseHints[1] },
      { id: 'hold', label: 'Hold', description: 'Pause here if your plan includes a hold.' },
      { id: 'return', label: phaseWords[2], description: phaseHints[2] },
    ],
    // Side views judge front-to-back sway; front views judge sideways lean.
    formChecks: checks ?? (view === 'side' ? { 'no-swing': { maxSwayDeg: 10 }, ...TIMING_CHECKS } : { 'trunk-upright': { maxLeanDeg: 10 }, ...TIMING_CHECKS }),
    segmentation: {
      hysteresis: 6,
      returnHysteresis: 10,
      minRepMs: 800,
      maxRepMs: 30000,
      maxGapMs: 600,
      holdTolerance: 6,
      minReliableFraction: 0.8,
      ...segmentation,
    },
  };
}

const SIDE_SETUP = [
  'Stand side-on to the camera with the leg or arm you are exercising closest to it.',
  'Place the camera 2–3 m (7–10 ft) away so your whole body stays in view.',
  'Use even light from the front; avoid a bright window behind you.',
];

const shoulderFlexion = archive({
  id: 'shoulder-flexion',
  name: 'Arm raise to the front',
  shortName: 'Front raise',
  bodyArea: 'shoulder',
  description: 'Raise one straight arm forward and up, then lower it. PocketRehab measures the angle between your upper arm and your torso from the side.',
  cameraView: 'side',
  view: 'side',
  sideMode: 'choose',
  cameraSetup: ['Stand side-on to the camera with the arm you are exercising closest to it.', 'Keep your hip, shoulder and elbow in view the whole time.', 'Use even light from the front; avoid a bright window behind you.'],
  instructions: ['Stand tall with your arm relaxed at your side.', 'Raise the arm forward and up with the elbow straight, as far as your plan allows.', 'Pause at the top if your plan includes a hold.', 'Lower it slowly back to your side.'],
  shortInstruction: 'Raise your arm forward and up, then lower it slowly.',
  phaseWords: ['Start', 'Raise', 'Lower'],
  phaseHints: ['Arm relaxed at your side.', 'Lift the straight arm forward and up.', 'Lower the arm back to your side.'],
  metric: {
    label: 'Shoulder flexion angle (camera estimate)',
    shortLabel: 'Arm angle',
    unit: '°',
    description: 'Angle between the line from hip to shoulder and the line from shoulder to elbow, seen from the side.',
    landmarks: { left: { a: LM.leftHip, b: LM.leftShoulder, c: LM.leftElbow }, right: { a: LM.rightHip, b: LM.rightShoulder, c: LM.rightElbow } },
    transform: 'interior',
    moving: 'c',
  },
  segmentation: { neutralMax: 30, countMin: 60 },
  demoPrescription: { sets: 2, reps: 8, holdSeconds: 0, restSeconds: 30, target: { min: 90, max: 150, source: 'demo-example' } },
  supportsSideComparison: true,
  limitations: ['Leaning back makes the arm look higher than it is; the no-swing check watches for it.', 'A loose sleeve can hide the elbow.'],
  equipment: [],
  demo: { neutral: 15, peak: 130, pose: { posture: 'standing', bendToward: 'forward' } },
});

const hipAbduction = archive({
  id: 'hip-abduction',
  name: 'Standing leg raise to the side',
  shortName: 'Side leg raise',
  bodyArea: 'hip',
  description: 'Standing tall, lift one straight leg out to the side and lower it. PocketRehab measures how far the leg moves away from the line of your body.',
  cameraView: 'front',
  view: 'front',
  // A sideways lean changes this hip angle directly, so lean is part of the measurement rather than a separate check.
  checks: TIMING_CHECKS,
  sideMode: 'choose',
  cameraSetup: ['Face the camera directly.', 'Place the camera 2–3 m (7–10 ft) away so your whole body is in view.', 'Hold a counter or chair beside the other leg if you need balance.'],
  instructions: ['Stand tall with your feet together.', 'Lift one leg out to the side with the knee straight and toes facing forward.', 'Pause briefly if your plan includes a hold.', 'Lower the leg slowly.'],
  shortInstruction: 'Lift your leg out to the side, then lower it slowly.',
  phaseWords: ['Start', 'Lift', 'Lower'],
  phaseHints: ['Standing tall, feet together.', 'Lift the straight leg out to the side.', 'Lower the leg back down.'],
  metric: {
    label: 'Hip abduction (camera estimate)',
    shortLabel: 'Leg angle',
    unit: '°',
    description: '180° minus the angle at the hip between your torso and thigh, seen from the front. 0° means the leg is in line with your body.',
    landmarks: { left: { a: LM.leftShoulder, b: LM.leftHip, c: LM.leftKnee }, right: { a: LM.rightShoulder, b: LM.rightHip, c: LM.rightKnee } },
    transform: 'supplement',
    moving: 'c',
  },
  segmentation: { neutralMax: 8, hysteresis: 4, countMin: 15, returnHysteresis: 5, holdTolerance: 4 },
  demoPrescription: { sets: 2, reps: 8, holdSeconds: 0, restSeconds: 30, target: { min: 20, max: 35, source: 'demo-example' } },
  supportsSideComparison: true,
  limitations: ['Leaning your body to the other side makes the leg look higher; the upright check watches for it.', 'Small movements (under about 10°) are hard to measure from a single camera.'],
  equipment: [BALANCE],
  demo: { neutral: 2, peak: 30, pose: { posture: 'standing', bendToward: 'outward' } },
});

const standingKneeFlexion = archive({
  id: 'standing-knee-flexion',
  name: 'Standing knee curl',
  shortName: 'Knee curl',
  bodyArea: 'knee',
  description: 'Standing tall, bend one knee to bring your heel up behind you, then lower it. PocketRehab measures how far the knee bends.',
  cameraView: 'side',
  view: 'side',
  sideMode: 'choose',
  cameraSetup: SIDE_SETUP,
  instructions: ['Stand tall, holding a counter or chair if you need balance.', 'Bend one knee to bring the heel up behind you; keep your thighs side by side.', 'Pause at the top if your plan includes a hold.', 'Lower the foot slowly.'],
  shortInstruction: 'Bend your knee to bring your heel up behind you, then lower it slowly.',
  phaseWords: ['Start', 'Bend', 'Lower'],
  phaseHints: ['Standing tall on both feet.', 'Bring the heel up behind you.', 'Lower the foot to the floor.'],
  metric: {
    label: 'Knee flexion (camera estimate)',
    shortLabel: 'Knee bend',
    unit: '°',
    description: '180° minus the angle at the knee between thigh and shin, seen from the side. 0° means a straight leg.',
    landmarks: { left: { a: LM.leftHip, b: LM.leftKnee, c: LM.leftAnkle }, right: { a: LM.rightHip, b: LM.rightKnee, c: LM.rightAnkle } },
    transform: 'supplement',
    moving: 'c',
  },
  segmentation: { neutralMax: 25, countMin: 50 },
  demoPrescription: { sets: 2, reps: 8, holdSeconds: 0, restSeconds: 30, target: { min: 70, max: 100, source: 'demo-example' } },
  supportsSideComparison: true,
  limitations: ['If the thigh swings forward the bend reads higher than the knee alone moved.', 'Wide trousers can hide the knee.'],
  equipment: [BALANCE],
  demo: { neutral: 5, peak: 90, pose: { posture: 'standing', bendToward: 'backward' } },
});

const standingMarch = archive({
  id: 'standing-march',
  name: 'Standing march',
  shortName: 'March',
  bodyArea: 'hip',
  description: 'Standing tall, lift one knee up in front of you like a slow march, then lower it. PocketRehab measures how high the thigh lifts.',
  cameraView: 'side',
  view: 'side',
  sideMode: 'choose',
  cameraSetup: SIDE_SETUP,
  instructions: ['Stand tall, holding a counter or chair if you need balance.', 'Lift one knee up in front of you, as high as your plan allows.', 'Pause at the top if your plan includes a hold.', 'Lower the foot slowly.'],
  shortInstruction: 'Lift your knee up in front of you, then lower it slowly.',
  phaseWords: ['Start', 'Lift', 'Lower'],
  phaseHints: ['Standing tall on both feet.', 'Lift the knee up in front.', 'Lower the foot to the floor.'],
  metric: {
    label: 'Hip flexion (camera estimate)',
    shortLabel: 'Thigh lift',
    unit: '°',
    description: '180° minus the angle at the hip between your torso and thigh, seen from the side. 0° means standing straight.',
    landmarks: { left: { a: LM.leftShoulder, b: LM.leftHip, c: LM.leftKnee }, right: { a: LM.rightShoulder, b: LM.rightHip, c: LM.rightKnee } },
    transform: 'supplement',
    moving: 'c',
  },
  segmentation: { neutralMax: 20, countMin: 45 },
  demoPrescription: { sets: 2, reps: 10, holdSeconds: 0, restSeconds: 30, target: { min: 60, max: 90, source: 'demo-example' } },
  supportsSideComparison: true,
  limitations: ['Leaning back makes the thigh look higher; the no-swing check watches for it.'],
  equipment: [BALANCE],
  demo: { neutral: 5, peak: 80, pose: { posture: 'standing', bendToward: 'forward' } },
});

const hipExtension = archive({
  id: 'hip-extension',
  name: 'Standing leg swing back',
  shortName: 'Leg back',
  bodyArea: 'hip',
  description: 'Standing tall, move one straight leg back behind you without arching your back, then return. PocketRehab measures how far the thigh moves back.',
  cameraView: 'side',
  view: 'side',
  sideMode: 'choose',
  // Too small a movement to judge a hold reliably from one camera.
  checks: { 'no-swing': { maxSwayDeg: 10 }, 'steady-pace': { minOutboundSeconds: 0.45 }, 'controlled-return': { maxSpeedDegPerSec: 180, minReturnRatio: 0.5 }, 'within-target': { pastToleranceDeg: 5 } },
  cameraSetup: SIDE_SETUP,
  instructions: ['Stand tall, holding a counter or chair in front of you.', 'Move one straight leg back behind you; keep your back still.', 'Bring the leg back slowly.'],
  shortInstruction: 'Move your straight leg back behind you, then return slowly.',
  phaseWords: ['Start', 'Move back', 'Return'],
  phaseHints: ['Standing tall on both feet.', 'Move the straight leg back.', 'Bring the leg back under you.'],
  metric: {
    label: 'Hip extension (camera estimate)',
    shortLabel: 'Leg angle',
    unit: '°',
    description: '180° minus the angle at the hip between your torso and thigh, seen from the side. 0° means the leg is under you.',
    landmarks: { left: { a: LM.leftShoulder, b: LM.leftHip, c: LM.leftKnee }, right: { a: LM.rightShoulder, b: LM.rightHip, c: LM.rightKnee } },
    transform: 'supplement',
    moving: 'c',
  },
  segmentation: { neutralMax: 6, hysteresis: 3, countMin: 12, returnHysteresis: 4, holdTolerance: 4 },
  demoPrescription: { sets: 2, reps: 8, holdSeconds: 0, restSeconds: 30, target: { min: 15, max: 25, source: 'demo-example' } },
  supportsSideComparison: true,
  limitations: ['Hip extension is a small movement; arching the back makes it look bigger, which the no-swing check watches for.'],
  equipment: [BALANCE],
  demo: { neutral: 1, peak: 20, pose: { posture: 'standing', bendToward: 'backward' } },
});

const miniSquat = archive({
  id: 'mini-squat',
  name: 'Mini squat',
  shortName: 'Mini squat',
  bodyArea: 'legs',
  description: 'Standing with feet hip-width apart, bend both knees a little as if starting to sit, then stand back up. PocketRehab measures the knee bend on the side facing the camera.',
  cameraView: 'side',
  view: 'side',
  // Squatting leans the trunk forward on purpose, so the sway check would misfire.
  checks: TIMING_CHECKS,
  sideMode: 'auto',
  cameraSetup: SIDE_SETUP,
  instructions: ['Stand with feet hip-width apart, holding a counter if you need balance.', 'Bend your knees and push your hips back a little, as far as your plan allows.', 'Pause at the bottom if your plan includes a hold.', 'Stand back up slowly.'],
  shortInstruction: 'Bend your knees a little, then stand back up slowly.',
  phaseWords: ['Standing', 'Bend', 'Stand up'],
  phaseHints: ['Standing tall, feet hip-width apart.', 'Bend the knees and push the hips back.', 'Straighten back up.'],
  metric: {
    label: 'Knee flexion (camera estimate)',
    shortLabel: 'Knee bend',
    unit: '°',
    description: '180° minus the angle at the knee between thigh and shin on the side closest to the camera. 0° means standing straight.',
    landmarks: { left: { a: LM.leftHip, b: LM.leftKnee, c: LM.leftAnkle }, right: { a: LM.rightHip, b: LM.rightKnee, c: LM.rightAnkle } },
    transform: 'supplement',
    moving: 'a',
  },
  segmentation: { neutralMax: 15, countMin: 30, minRepMs: 1000 },
  demoPrescription: { sets: 2, reps: 8, holdSeconds: 0, restSeconds: 45, target: { min: 40, max: 60, source: 'demo-example' } },
  supportsSideComparison: false,
  limitations: ['Measures the knee on the side facing the camera only.', 'Knees drifting inward cannot be seen from the side.'],
  equipment: [BALANCE],
  demo: { neutral: 4, peak: 50, pose: { posture: 'standing', bendToward: 'backward', riseLeanDeg: 15 } },
});

export const EXERCISES: Record<ExerciseId, ExerciseDefinition> = {
  'shoulder-abduction': shoulderAbduction,
  'elbow-flexion': elbowFlexion,
  'knee-extension': kneeExtension,
  'sit-to-stand': sitToStand,
  'shoulder-flexion': shoulderFlexion,
  'hip-abduction': hipAbduction,
  'standing-knee-flexion': standingKneeFlexion,
  'standing-march': standingMarch,
  'hip-extension': hipExtension,
  'mini-squat': miniSquat,
};

export const EXERCISE_LIST: ExerciseDefinition[] = Object.values(EXERCISES);

