/**
 * Provider-independent pose types. Every pose source (MediaPipe, the simulated
 * provider used in demo mode and tests) is normalized into these shapes so the
 * movement-analysis engine never depends on one model's raw output format.
 */

/** A body landmark in normalized image coordinates (0..1 across the frame). */
export interface Landmark {
  x: number;
  y: number;
  /** Relative depth estimate from the model. Not used for angle measurement. */
  z: number;
  /** Model's per-landmark visibility estimate (0..1). A tracking-quality signal, not a calibrated probability. */
  visibility: number;
}

export type InferenceStatus = 'ok' | 'no-pose' | 'error';

export interface PoseProviderInfo {
  name: string;
  model: string;
  version: string;
  kind: 'camera-model' | 'simulated';
  /** Hardware path actually used for inference, when known (e.g. GPU / CPU). */
  delegate?: string;
}

/**
 * A landmark in metric 3D "world" coordinates (metres), origin at the hip
 * midpoint, as returned by MediaPipe's pose world landmarks: x to the image
 * right, y down, z away from the camera. Used for rotation-robust angles.
 */
export interface WorldLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseFrame {
  /** Monotonic timestamp in milliseconds. */
  timestamp: number;
  /** 33 landmarks in MediaPipe BlazePose order, or null when no person was detected. */
  landmarks: Landmark[] | null;
  /** The same 33 landmarks in metric world coordinates, when the provider supplies them. */
  world?: WorldLandmark[] | null;
  imageWidth: number;
  imageHeight: number;
  provider: PoseProviderInfo;
  status: InferenceStatus;
  error?: string;
  /** Time the model took for this frame, when measured. */
  inferenceMs?: number;
}

export interface Point2 {
  x: number;
  y: number;
}

/** MediaPipe BlazePose landmark indices used by PocketRehab. */
export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

export const LANDMARK_NAMES: Record<number, string> = {
  0: 'head',
  11: 'left shoulder',
  12: 'right shoulder',
  13: 'left elbow',
  14: 'right elbow',
  15: 'left wrist',
  16: 'right wrist',
  23: 'left hip',
  24: 'right hip',
  25: 'left knee',
  26: 'right knee',
  27: 'left ankle',
  28: 'right ankle',
};

/** Skeleton connections drawn in the AR overlay. */
export const SKELETON_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 29],
  [28, 30],
  [29, 31],
  [30, 32],
];

export const LANDMARK_COUNT = 33;
