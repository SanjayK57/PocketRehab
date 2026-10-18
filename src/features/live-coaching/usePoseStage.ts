import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PoseFrame } from '@/types/pose';
import type { ExerciseDefinition } from '@/types/exercise';
import type { BodySide } from '@/lib/validation/schemas';
import { CameraError, frameBrightness, mapCameraError, openCamera, type CameraHandle } from '@/features/camera/camera';
import { MediaPipePoseProvider, PoseModelError, SimulatedPoseProvider, type PoseModelVariant, type PoseProvider } from '@/features/pose-estimation/provider';
import { median } from '@/features/movement-analysis/filters';

export type StageMode = 'camera' | 'simulated';
export type StageStatus = 'idle' | 'requesting-camera' | 'loading-model' | 'running' | 'error' | 'stopped';

export interface StageStats {
  fps: number | null;
  inferenceMs: number | null;
  delegate: string;
  model: string;
  width: number;
  height: number;
  reducedRate: boolean;
  brightness: number | null;
}

/** The camera picture must advance within this long while the page is visible, or the camera is treated as lost. */
const STALL_MS = 6000;

/**
 * Runs the capture → pose estimation loop outside React state. Per-frame data
 * goes to `onFrame` (kept in a ref) so the screen does not re-render 30 times
 * a second, and `onRender` is called on every animation frame so the overlay
 * can draw at the display's rate. Frames are processed at a sustainable rate:
 * at most one inference per animation frame, never queued, and the target rate
 * drops to 15 fps if inference is slow on this device.
 *
 * Robustness: an exception in one frame never stops the loop (it is reported
 * once); starting is cancelled cleanly if the screen closes while the camera
 * permission prompt or the model download is still pending (no camera left
 * running, no state set after unmount); a camera that unplugs, ends or stops
 * delivering pictures is reported as lost.
 */
export function usePoseStage(opts: {
  mode: StageMode;
  def: ExerciseDefinition | null;
  side: BodySide;
  modelVariant: PoseModelVariant;
  onFrame: (frame: PoseFrame) => void;
  onRender?: (now: number) => void;
  onCameraLost: () => void;
  holdSeconds?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<StageStatus>('idle');
  const [error, setError] = useState<CameraError | PoseModelError | null>(null);
  const [stats, setStats] = useState<StageStats>({ fps: null, inferenceMs: null, delegate: '', model: '', width: 0, height: 0, reducedRate: false, brightness: null });

  const onFrameRef = useRef(opts.onFrame);
  const onRenderRef = useRef(opts.onRender);
  const onLostRef = useRef(opts.onCameraLost);
  useLayoutEffect(() => {
    onFrameRef.current = opts.onFrame;
    onRenderRef.current = opts.onRender;
    onLostRef.current = opts.onCameraLost;
  });

  const cameraRef = useRef<CameraHandle | null>(null);
  const providerRef = useRef<PoseProvider | null>(null);
  const loopRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  /** Incremented by every start/stop; an async start that finds it changed abandons itself. */
  const generation = useRef(0);
  const mounted = useRef(true);
  const reportedError = useRef(false);
  const timings = useRef({ frameTimes: [] as number[], inference: [] as number[], reduced: false, lastProcessed: 0, lastStats: 0, lastBrightness: 0, brightness: null as number | null, videoTime: -1, videoTimeAt: 0 });
  const scratch = useRef<HTMLCanvasElement | null>(null);

  const stopLoop = () => {
    activeRef.current = false;
    if (loopRef.current !== null) {
      cancelAnimationFrame(loopRef.current);
      loopRef.current = null;
    }
  };

  const stop = useCallback(() => {
    generation.current++;
    stopLoop();
    cameraRef.current?.stop();
    cameraRef.current = null;
    providerRef.current?.close();
    providerRef.current = null;
    const v = videoRef.current;
    if (v) v.srcObject = null;
    if (mounted.current) setStatus((s) => (s === 'error' ? s : 'stopped'));
  }, []);

  const cameraLost = useCallback(() => {
    stopLoop();
    if (!mounted.current) return;
    setStatus('error');
    setError(new CameraError('unknown', 'The camera stopped or was disconnected.'));
    onLostRef.current();
  }, []);

  /** Processes at most one frame; called once per animation frame while the loop runs. */
  const step = useCallback(
    (now: number) => {
      const provider = providerRef.current;
      if (!provider) return;
      const t = timings.current;
      const video = opts.mode === 'camera' ? videoRef.current : null;
      if (opts.mode === 'camera') {
        if (!video) return;
        // Stall watchdog: the picture has to keep moving while the page is visible.
        if (video.currentTime !== t.videoTime) {
          t.videoTime = video.currentTime;
          t.videoTimeAt = now;
        } else if (t.videoTimeAt > 0 && now - t.videoTimeAt > STALL_MS && document.visibilityState === 'visible') {
          cameraLost();
          return;
        }
        if (video.readyState < 2 || video.paused) return;
      }
      // The simulator is cheap, so it runs at the display rate for the smoothest demonstration.
      const minGap = opts.mode === 'simulated' ? 1000 / 60 : 1000 / (t.reduced ? 15 : 30);
      if (now - t.lastProcessed < minGap - 2) return;
      t.lastProcessed = now;
      const frame = provider.estimate(video, now);
      t.frameTimes.push(now);
      if (frame.inferenceMs !== undefined) t.inference.push(frame.inferenceMs);
      if (t.frameTimes.length > 60) t.frameTimes.shift();
      if (t.inference.length > 60) t.inference.shift();

      if (opts.mode === 'camera' && video && now - t.lastBrightness > 1000) {
        t.lastBrightness = now;
        scratch.current ??= document.createElement('canvas');
        t.brightness = frameBrightness(video, scratch.current);
      }
      if (now - t.lastStats > 1000) {
        t.lastStats = now;
        const inf = median(t.inference);
        if (inf !== null && inf > 45 && !t.reduced && opts.mode === 'camera') t.reduced = true;
        const span = (t.frameTimes[t.frameTimes.length - 1] ?? 0) - (t.frameTimes[0] ?? 0);
        const fps = t.frameTimes.length > 5 && span > 0 ? ((t.frameTimes.length - 1) / span) * 1000 : null;
        setStats({
          fps: fps === null ? null : Math.round(fps),
          inferenceMs: inf === null ? null : Math.round(inf * 10) / 10,
          delegate: provider.info.delegate ?? '',
          model: provider.info.model,
          width: frame.imageWidth,
          height: frame.imageHeight,
          reducedRate: t.reduced,
          brightness: t.brightness === null ? null : Math.round(t.brightness),
        });
      }
      onFrameRef.current(frame);
    },
    [opts.mode, cameraLost],
  );

  const startLoop = useCallback(() => {
    stopLoop();
    activeRef.current = true;
    const loop = (now: number) => {
      if (!activeRef.current) return;
      loopRef.current = requestAnimationFrame(loop);
      // One bad frame must never end the session: report the first failure and keep going.
      try {
        step(now);
        onRenderRef.current?.(now);
      } catch (err) {
        if (!reportedError.current) {
          reportedError.current = true;
          console.error('PocketRehab live loop: a frame failed and was skipped.', err);
        }
      }
    };
    loopRef.current = requestAnimationFrame(loop);
  }, [step]);

  const start = useCallback(async () => {
    const gen = ++generation.current;
    const current = () => gen === generation.current && mounted.current;
    setError(null);
    timings.current = { frameTimes: [], inference: [], reduced: false, lastProcessed: 0, lastStats: 0, lastBrightness: 0, brightness: null, videoTime: -1, videoTimeAt: 0 };
    if (opts.mode === 'simulated') {
      if (!opts.def) return;
      const provider = new SimulatedPoseProvider(opts.def, opts.side, { holdSeconds: opts.holdSeconds });
      await provider.init();
      if (!current()) return provider.close();
      providerRef.current = provider;
      setStatus('running');
      startLoop();
      return;
    }
    try {
      setStatus('requesting-camera');
      const cam = await openCamera(() => {
        if (gen === generation.current) cameraLost();
      });
      if (!current()) return cam.stop();
      cameraRef.current = cam;
      const video = videoRef.current;
      if (video) {
        video.srcObject = cam.stream;
        video.muted = true;
        video.playsInline = true;
        await video.play().catch(() => undefined);
      }
      if (!current()) return;
      setStatus('loading-model');
      if (!providerRef.current) {
        const provider = new MediaPipePoseProvider(opts.modelVariant);
        try {
          await provider.init();
        } catch (err) {
          provider.close();
          throw err;
        }
        if (!current()) return provider.close();
        providerRef.current = provider;
      }
      setStatus('running');
      startLoop();
    } catch (err) {
      if (gen !== generation.current) return;
      cameraRef.current?.stop();
      cameraRef.current = null;
      if (!mounted.current) return;
      setStatus('error');
      setError(err instanceof PoseModelError ? err : mapCameraError(err));
    }
  }, [opts.mode, opts.def, opts.side, opts.modelVariant, opts.holdSeconds, startLoop, cameraLost]);

  /** Re-attaches the existing stream to a newly mounted <video> (e.g. after a layout change). */
  const reattach = useCallback(() => {
    const v = videoRef.current;
    if (v && cameraRef.current && v.srcObject !== cameraRef.current.stream) {
      v.srcObject = cameraRef.current.stream;
      void v.play().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      stop();
      mounted.current = false;
    };
  }, [stop]);

  return { videoRef, status, error, stats, start, stop, reattach };
}
