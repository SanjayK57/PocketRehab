import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff } from 'lucide-react';
import type { PoseFrame } from '@/types/pose';
import { EXERCISES } from '@/features/exercises/library';
import { ANALYSIS_CONFIG } from '@/features/movement-analysis/config';
import { CAMERA_ERROR_HELP, CameraError } from '@/features/camera/camera';
import { Button, Notice } from '@/components/ui';
import { usePoseStage } from './usePoseStage';
import { OverlayState, drawOverlay, fitCanvas } from './arRenderer';
import { useAppData } from '@/app/AppData';

const KEY_POINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

/** Optional camera check: live preview with the body skeleton. Nothing is recorded. */
export function CameraTest() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState<number | null>(null);
  const profile = useAppData().profile;
  const mirrored = profile?.preferences.mirrorPreview ?? true;
  const lastUi = useRef(0);
  const overlay = useRef(new OverlayState());

  const onFrame = (frame: PoseFrame) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      fitCanvas(canvas);
      drawOverlay(
        ctx,
        {
          pose: { landmarks: frame.landmarks, world: frame.world ?? null, points: null, frameWidth: frame.imageWidth, frameHeight: frame.imageHeight },
          def: EXERCISES['shoulder-abduction'],
          side: 'right',
          value: null,
          target: null,
          quality: 'unavailable',
          form: null,
          stage: 'idle',
          setupFitted: false,
          mirrored,
          showBody: true,
          showInstruments: false,
          reducedMotion: false,
          now: frame.timestamp,
          avoid: [],
        },
        overlay.current,
      );
    }
    if (frame.timestamp - lastUi.current > 300) {
      lastUi.current = frame.timestamp;
      setVisible(frame.landmarks ? KEY_POINTS.filter((i) => (frame.landmarks?.[i]?.visibility ?? 0) >= ANALYSIS_CONFIG.visibilityReliable).length : 0);
    }
  };

  const { videoRef, status, error, stats, start, stop } = usePoseStage({ mode: 'camera', def: null, side: 'right', modelVariant: profile?.preferences.poseModel ?? 'lite', onFrame, onCameraLost: () => setVisible(null) });
  useEffect(() => () => stop(), [stop]);

  const running = status === 'running';
  const help = error instanceof CameraError ? CAMERA_ERROR_HELP[error.kind] : error ? { title: 'Pose tracking could not start', body: error.message } : null;

  return (
    <div className="space-y-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-card)] bg-stage text-stage-ink">
        <video ref={videoRef} className="absolute inset-0 size-full object-cover" style={{ transform: mirrored ? 'scaleX(-1)' : undefined }} muted playsInline aria-label="Camera preview" />
        <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden />
        {!running ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            {status === 'requesting-camera' ? <p>Waiting for camera permission…</p> : status === 'loading-model' ? <p>Loading the on-device pose model (about 6 MB the first time)…</p> : <CameraOff aria-hidden className="size-10 text-stage-ink-2" />}
            {status === 'idle' || status === 'stopped' || status === 'error' ? <p className="max-w-sm text-stage-ink-2">The camera is off. Turning it on asks your browser for permission.</p> : null}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <Button variant="secondary" onClick={stop} icon={<CameraOff aria-hidden className="size-4" />}>
            Turn camera off
          </Button>
        ) : (
          <Button onClick={() => void start()} loading={status === 'requesting-camera' || status === 'loading-model'} icon={<Camera aria-hidden className="size-4" />}>
            Turn on camera
          </Button>
        )}
        {running ? (
          <p role="status" className="text-ink-2">
            {visible === null ? 'Looking for you…' : visible === 0 ? 'No person detected yet. Step back so your upper body is in view.' : `${visible} of ${KEY_POINTS.length} key body points clearly visible.`}
            {stats.fps ? ` · ${stats.fps} fps${stats.delegate ? ` on ${stats.delegate}` : ''}` : ''}
          </p>
        ) : null}
      </div>
      {help ? <Notice tone="warn" title={help.title}>{help.body}</Notice> : null}
    </div>
  );
}

