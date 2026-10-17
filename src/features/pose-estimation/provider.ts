import type { Landmark, PoseFrame, PoseProviderInfo } from '@/types/pose';
import type { ExerciseDefinition } from '@/types/exercise';
import type { BodySide } from '@/lib/validation/schemas';
import { SIMULATED_PROVIDER_INFO, SYNTHETIC_FRAME, buildSyntheticPose, scriptedValue, seededRandom, type RepScript } from './synthetic';

/**
 * Pose providers turn an input (a camera video element, or nothing for the
 * simulator) into a normalized PoseFrame. The rest of the app only sees this
 * interface, so the model can be swapped without touching analysis code.
 */
export interface PoseProvider {
  readonly info: PoseProviderInfo;
  init(): Promise<void>;
  /** Must be called with strictly increasing timestamps. Never throws; failures come back as status 'error'. */
  estimate(input: HTMLVideoElement | null, timestampMs: number): PoseFrame;
  close(): void;
}

export type PoseModelVariant = 'lite' | 'full';

const MODEL_FILES: Record<PoseModelVariant, string> = {
  lite: 'pose_landmarker_lite.task',
  full: 'pose_landmarker_full.task',
};

export class PoseModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoseModelError';
  }
}

/**
 * MediaPipe Pose Landmarker running fully in the browser (WebAssembly, with
 * the GPU delegate when WebGL allows it, else CPU). The runtime and model are
 * served from this app's own origin; no frames leave the device.
 */
export class MediaPipePoseProvider implements PoseProvider {
  info: PoseProviderInfo;
  private landmarker: import('@mediapipe/tasks-vision').PoseLandmarker | null = null;
  private lastTs = -1;

  constructor(private readonly variant: PoseModelVariant = 'lite') {
    this.info = { name: 'MediaPipe Pose Landmarker', model: `pose_landmarker_${variant}`, version: '0.10 (tasks-vision 1.1.1)', kind: 'camera-model' };
  }

  async init(): Promise<void> {
    let vision: typeof import('@mediapipe/tasks-vision');
    try {
      vision = await import('@mediapipe/tasks-vision');
    } catch {
      throw new PoseModelError('The pose-tracking library could not be loaded. Check your connection and reload the page.');
    }
    const base = import.meta.env.BASE_URL;
    let fileset: Awaited<ReturnType<typeof vision.FilesetResolver.forVisionTasks>>;
    try {
      fileset = await vision.FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`);
    } catch {
      throw new PoseModelError('The pose-tracking runtime could not be loaded. If you are offline, connect once so it can be cached.');
    }
    const modelAssetPath = `${base}models/${MODEL_FILES[this.variant]}`;
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath, delegate },
      runningMode: 'VIDEO' as const,
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, options('GPU'));
      this.info = { ...this.info, delegate: 'GPU' };
    } catch {
      try {
        this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, options('CPU'));
        this.info = { ...this.info, delegate: 'CPU' };
      } catch (err) {
        throw new PoseModelError(`The pose model could not start on this device (${err instanceof Error ? err.message : 'unknown error'}).`);
      }
    }
  }

  estimate(input: HTMLVideoElement | null, timestampMs: number): PoseFrame {
    const w = input?.videoWidth ?? 0;
    const h = input?.videoHeight ?? 0;
    const base = { timestamp: timestampMs, imageWidth: w, imageHeight: h, provider: this.info };
    if (!this.landmarker || !input || w === 0 || h === 0) {
      return { ...base, landmarks: null, status: 'error', error: 'Camera frame or model not ready' };
    }
    // detectForVideo requires strictly increasing timestamps.
    const ts = timestampMs <= this.lastTs ? this.lastTs + 1 : timestampMs;
    this.lastTs = ts;
    const started = performance.now();
    try {
      const result = this.landmarker.detectForVideo(input, ts);
      const inferenceMs = performance.now() - started;
      const pose = result.landmarks[0];
      if (!pose || pose.length === 0) return { ...base, timestamp: ts, landmarks: null, status: 'no-pose', inferenceMs };
      const landmarks: Landmark[] = pose.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 }));
      return { ...base, timestamp: ts, landmarks, status: 'ok', inferenceMs };
    } catch (err) {
      return { ...base, timestamp: ts, landmarks: null, status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  close(): void {
    try {
      this.landmarker?.close();
    } catch {
      // Already closed.
    }
    this.landmarker = null;
  }
}

/**
 * Generates a scripted, clearly simulated person doing the exercise. Used for
 * the "Simulated demo" mode when no camera is available or wanted. Its data is
 * labeled as simulated everywhere and never counts as the user's measurement.
 */
export class SimulatedPoseProvider implements PoseProvider {
  readonly info = SIMULATED_PROVIDER_INFO;
  private readonly random: () => number;
  private readonly script: RepScript[];
  private readonly cycleMs: number;
  private start: number | null = null;

  constructor(
    private readonly def: ExerciseDefinition,
    private readonly side: BodySide,
    opts: { seed?: number; holdSeconds?: number; peak?: number } = {},
  ) {
    this.random = seededRandom(opts.seed ?? 11);
    const peak = opts.peak ?? def.demo.peak;
    const holdMs = Math.max(250, (opts.holdSeconds ?? 0) * 1000);
    // A repeating cycle of six repetitions with natural variation; the fourth falls short.
    this.script = [0, 1, 2, 3, 4, 5].map((i) => ({
      peak: i === 3 ? def.demo.neutral + (def.segmentation.countMin - def.demo.neutral) * 0.7 : peak + (this.random() - 0.5) * 8,
      restMs: 1100 + this.random() * 500,
      outboundMs: 1300 + this.random() * 400,
      holdMs,
      returnMs: 1400 + this.random() * 400,
    }));
    this.cycleMs = this.script.reduce((s, r) => s + r.restMs + r.outboundMs + r.holdMs + r.returnMs, 0);
  }

  async init(): Promise<void> {
    /* nothing to load */
  }

  /** Current simulated metric value (used by the demo panel to stay in sync). */
  valueAt(timestampMs: number): number {
    if (this.start === null) this.start = timestampMs;
    const t = (timestampMs - this.start) % this.cycleMs;
    return scriptedValue(this.def.demo.neutral, this.script, t);
  }

  estimate(_input: HTMLVideoElement | null, timestampMs: number): PoseFrame {
    const value = this.valueAt(timestampMs);
    return {
      timestamp: timestampMs,
      landmarks: buildSyntheticPose(this.def, this.side, value, { noisePx: 1.2, random: this.random }),
      imageWidth: SYNTHETIC_FRAME.width,
      imageHeight: SYNTHETIC_FRAME.height,
      provider: this.info,
      status: 'ok',
      inferenceMs: 0,
    };
  }

  close(): void {
    this.start = null;
  }
}
