import type { Landmark, PoseFrame, PoseProviderInfo, WorldLandmark } from '@/types/pose';
import type { ExerciseDefinition } from '@/types/exercise';
import type { BodySide } from '@/lib/validation/schemas';
import {
  SIMULATED_PROVIDER_INFO,
  SYNTHETIC_FRAME,
  buildSyntheticBody,
  demoScript,
  scriptDuration,
  scriptedState,
  seededRandom,
  type PoseFaults,
  type RepScript,
} from './synthetic';

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

type Vision = typeof import('@mediapipe/tasks-vision');
type Landmarker = import('@mediapipe/tasks-vision').PoseLandmarker;
type Fileset = Awaited<ReturnType<Vision['FilesetResolver']['forVisionTasks']>>;

/** Loading the runtime and model normally takes 1–5 s; past this the user is told instead of waiting forever. */
const INIT_TIMEOUT_MS = 25000;
/** A GPU start-up that has not finished by now is abandoned for the CPU path (some drivers stall instead of failing). */
const GPU_INIT_TIMEOUT_MS = 12000;
/** Consecutive GPU inference failures before switching to the CPU delegate. */
const GPU_FAILURES_BEFORE_FALLBACK = 3;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PoseModelError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * MediaPipe Pose Landmarker running fully in the browser (WebAssembly, with
 * the GPU delegate when WebGL allows it, else CPU). The runtime and model are
 * served from this app's own origin; no frames leave the device.
 *
 * Besides image landmarks it returns MediaPipe's metric world landmarks
 * (`frame.world`), which the analysis uses for rotation-robust angles. If the
 * GPU path fails at start-up, keeps failing, or loses its WebGL context, the
 * provider re-creates the model on the CPU and keeps going.
 */
export class MediaPipePoseProvider implements PoseProvider {
  info: PoseProviderInfo;
  private vision: Vision | null = null;
  private fileset: Fileset | null = null;
  private landmarker: Landmarker | null = null;
  private gpuCanvas: HTMLCanvasElement | null = null;
  private gpuFailures = 0;
  private switching: Promise<void> | null = null;
  private closed = false;
  private lastTs = -1;
  /** Bumped on every create(); a slower, superseded start-up closes its own landmarker. */
  private generation = 0;

  constructor(private readonly variant: PoseModelVariant = 'lite') {
    this.info = { name: 'MediaPipe Pose Landmarker', model: `pose_landmarker_${variant}`, version: '0.10 (tasks-vision 1.1.1)', kind: 'camera-model' };
  }

  async init(): Promise<void> {
    this.closed = false;
    await withTimeout(this.load(), INIT_TIMEOUT_MS, 'The pose model took too long to load. Check your connection, then try again or use the simulated demo.');
  }

  private async load(): Promise<void> {
    try {
      this.vision = await import('@mediapipe/tasks-vision');
    } catch {
      throw new PoseModelError('The pose-tracking library could not be loaded. Check your connection and reload the page.');
    }
    const base = import.meta.env.BASE_URL;
    try {
      this.fileset = await this.vision.FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`);
    } catch {
      throw new PoseModelError('The pose-tracking runtime could not be loaded. If you are offline, connect once so it can be cached.');
    }
    try {
      await withTimeout(this.create('GPU'), GPU_INIT_TIMEOUT_MS, 'GPU start-up timed out');
    } catch {
      try {
        await this.create('CPU');
      } catch (err) {
        throw new PoseModelError(`The pose model could not start on this device (${err instanceof Error ? err.message : 'unknown error'}).`);
      }
    }
  }

  private async create(delegate: 'GPU' | 'CPU'): Promise<void> {
    if (!this.vision || !this.fileset) throw new PoseModelError('The pose-tracking runtime is not loaded.');
    const generation = ++this.generation;
    // Own the GPU canvas so a lost WebGL context can be noticed and handled.
    const canvas = delegate === 'GPU' && typeof document !== 'undefined' ? document.createElement('canvas') : undefined;
    const landmarker = await this.vision.PoseLandmarker.createFromOptions(this.fileset, {
      baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/${MODEL_FILES[this.variant]}`, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      ...(canvas ? { canvas } : {}),
    });
    if (this.closed || generation !== this.generation) {
      // close() ran while the model was loading (the user left the screen), or a newer start-up replaced this one.
      landmarker.close();
      return;
    }
    this.landmarker = landmarker;
    this.gpuFailures = 0;
    this.info = { ...this.info, delegate };
    if (canvas) {
      this.gpuCanvas = canvas;
      canvas.addEventListener('webglcontextlost', this.onContextLost);
    }
  }

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    this.fallBackToCpu();
  };

  /** Replaces a failing GPU landmarker with a CPU one; frames report 'error' until it is ready. */
  private fallBackToCpu(): void {
    if (this.switching || this.closed || this.info.delegate === 'CPU') return;
    this.releaseLandmarker();
    this.switching = this.create('CPU')
      .catch(() => {
        // Nothing left to try; estimate() keeps reporting errors and the stage shows them.
      })
      .finally(() => {
        this.switching = null;
      });
  }

  estimate(input: HTMLVideoElement | null, timestampMs: number): PoseFrame {
    const w = input?.videoWidth ?? 0;
    const h = input?.videoHeight ?? 0;
    const base = { timestamp: timestampMs, imageWidth: w, imageHeight: h, provider: this.info };
    if (!this.landmarker || !input || w === 0 || h === 0) {
      const error = this.switching ? 'Switching pose tracking to the CPU' : 'Camera frame or model not ready';
      return { ...base, landmarks: null, status: 'error', error };
    }
    // detectForVideo requires strictly increasing timestamps.
    const ts = Number.isFinite(timestampMs) && timestampMs > this.lastTs ? timestampMs : this.lastTs + 1;
    this.lastTs = ts;
    const started = performance.now();
    try {
      const result = this.landmarker.detectForVideo(input, ts);
      const inferenceMs = performance.now() - started;
      this.gpuFailures = 0;
      const pose = result.landmarks[0];
      if (!pose || pose.length === 0) return { ...base, timestamp: ts, landmarks: null, world: null, status: 'no-pose', inferenceMs };
      const landmarks: Landmark[] = pose.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0, ...(p.presence === undefined ? {} : { presence: p.presence }) }));
      const worldPose = result.worldLandmarks[0];
      const world: WorldLandmark[] | null =
        worldPose && worldPose.length === pose.length ? worldPose.map((p, i) => ({ x: p.x, y: p.y, z: p.z, visibility: landmarks[i]?.visibility ?? 0 })) : null;
      return { ...base, timestamp: ts, landmarks, world, status: 'ok', inferenceMs };
    } catch (err) {
      if (this.info.delegate === 'GPU' && ++this.gpuFailures >= GPU_FAILURES_BEFORE_FALLBACK) this.fallBackToCpu();
      return { ...base, timestamp: ts, landmarks: null, status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private releaseLandmarker(): void {
    try {
      this.landmarker?.close();
    } catch {
      // Already closed or the context is gone.
    }
    this.landmarker = null;
    this.gpuCanvas?.removeEventListener('webglcontextlost', this.onContextLost);
    this.gpuCanvas = null;
  }

  close(): void {
    this.closed = true;
    this.releaseLandmarker();
  }
}

/**
 * Generates a scripted, clearly simulated person doing the exercise. Used for
 * the "Simulated demo" mode when no camera is available or wanted. Its data is
 * labeled as simulated everywhere and never counts as the user's measurement.
 *
 * The script repeats a cycle with natural variation, one movement that falls
 * short, and realistic faults on some repetitions (see demoScript), so the
 * demo shows the form checks working. Frames carry image and world landmarks.
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
    this.script = demoScript(def, { holdMs: (opts.holdSeconds ?? 0) * 1000, random: this.random, ...(opts.peak === undefined ? {} : { peak: opts.peak }) });
    this.cycleMs = scriptDuration(this.script, 0);
  }

  async init(): Promise<void> {
    /* nothing to load */
  }

  /** Scripted metric value and fault amplitudes at this time (shared with the demo figure so they stay in sync). */
  stateAt(timestampMs: number): { value: number; faults: PoseFaults } {
    if (this.start === null || !Number.isFinite(this.start)) this.start = timestampMs;
    const elapsed = timestampMs - this.start;
    const t = Number.isFinite(elapsed) && elapsed > 0 ? elapsed % this.cycleMs : 0;
    return scriptedState(this.def.demo.neutral, this.script, t);
  }

  /** Current simulated metric value (used by the demo panel to stay in sync). */
  valueAt(timestampMs: number): number {
    return this.stateAt(timestampMs).value;
  }

  estimate(_input: HTMLVideoElement | null, timestampMs: number): PoseFrame {
    const { value, faults } = this.stateAt(timestampMs);
    const body = buildSyntheticBody(this.def, this.side, value, { noisePx: 1.2, worldNoiseM: 0.004, random: this.random, faults });
    return {
      timestamp: timestampMs,
      landmarks: body.landmarks,
      world: body.world,
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
