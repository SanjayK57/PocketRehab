import { LM } from '@/types/pose';
import type { ExerciseDefinition } from '@/types/exercise';
import type { ExerciseId } from '@/lib/validation/schemas';

/**
 * PocketRehab demonstration exercise library (v1).
 *
 * These four movements were chosen because a single ordinary camera can
 * observe the measured joint angle reasonably well from one stated view.
 * Every numeric value here (targets, thresholds) is a software demonstration
 * parameter, not a clinically validated value. Real targets must come from the
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
    label: 'Shoulder abduction angle (camera estimate)',
    shortLabel: 'Arm angle',
    unit: '°',
    description: 'Angle between the line from hip to shoulder and the line from shoulder to elbow, measured in the camera image.',
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
  supportsSideComparison: true,
  warnings: GENERAL_WARNINGS,
  limitations: [
    'This is a 2D angle in the camera image, not a goniometer measurement. Turning your body or raising the arm forward instead of sideways changes the number.',
    'Requires a front view. From the side, the arm moves toward the camera and the angle cannot be measured reliably.',
  ],
  equipment: [],
  demo: { neutral: 15, peak: 90 },
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
  supportsSideComparison: true,
  warnings: GENERAL_WARNINGS,
  limitations: [
    'If the forearm turns toward or away from the camera, the 2D angle can under- or over-estimate the true elbow bend.',
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
  demo: { neutral: 10, peak: 120 },
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
  demo: { neutral: 95, peak: 168 },
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
  demo: { neutral: 95, peak: 172 },
  source: SOURCE,
};

export const EXERCISES: Record<ExerciseId, ExerciseDefinition> = {
  'shoulder-abduction': shoulderAbduction,
  'elbow-flexion': elbowFlexion,
  'knee-extension': kneeExtension,
  'sit-to-stand': sitToStand,
};

export const EXERCISE_LIST: ExerciseDefinition[] = Object.values(EXERCISES);

