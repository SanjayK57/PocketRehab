/**
 * Camera access. Permission is requested only when the user deliberately
 * starts camera setup. Frames are used for on-device pose estimation and are
 * never recorded, stored or uploaded.
 */

export type CameraErrorKind = 'unsupported' | 'insecure-context' | 'permission-denied' | 'not-found' | 'in-use' | 'unknown';

export class CameraError extends Error {
  constructor(
    public readonly kind: CameraErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

export const CAMERA_ERROR_HELP: Record<CameraErrorKind, { title: string; body: string }> = {
  unsupported: {
    title: 'This browser can’t use a camera here',
    body: 'Try a current version of Chrome, Edge, Safari or Firefox. You can still use a simulated demo or log your session manually.',
  },
  'insecure-context': {
    title: 'Camera needs a secure connection',
    body: 'Browsers only allow camera access on HTTPS pages or on this computer (localhost). Open PocketRehab from its https:// address.',
  },
  'permission-denied': {
    title: 'Camera permission was not granted',
    body: 'PocketRehab only uses the camera on this device to estimate body position; nothing is recorded or uploaded. To allow it, click the camera icon in the address bar (or your browser’s site settings), choose Allow, then try again. Or continue without the camera.',
  },
  'not-found': {
    title: 'No camera was found',
    body: 'Connect a camera or use a device that has one. You can still use a simulated demo or log your session manually.',
  },
  'in-use': {
    title: 'The camera is busy',
    body: 'Another app or browser tab may be using the camera. Close it and try again.',
  },
  unknown: {
    title: 'The camera could not start',
    body: 'Try again, or continue without the camera.',
  },
};

export function mapCameraError(err: unknown): CameraError {
  if (err instanceof CameraError) return err;
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return new CameraError('permission-denied', CAMERA_ERROR_HELP['permission-denied'].title);
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new CameraError('not-found', CAMERA_ERROR_HELP['not-found'].title);
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new CameraError('in-use', CAMERA_ERROR_HELP['in-use'].title);
    case 'SecurityError':
      return new CameraError('insecure-context', CAMERA_ERROR_HELP['insecure-context'].title);
    default:
      return new CameraError('unknown', err instanceof Error ? err.message : CAMERA_ERROR_HELP.unknown.title);
  }
}

export interface CameraHandle {
  stream: MediaStream;
  settings: { width: number; height: number; facingMode: string | null; label: string };
  stop: () => void;
}

/** Opens the camera and wires `onEnded` to fire if the camera disconnects or is revoked. */
export async function openCamera(onEnded: () => void, deviceId?: string): Promise<CameraHandle> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new CameraError('insecure-context', CAMERA_ERROR_HELP['insecure-context'].title);
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('unsupported', CAMERA_ERROR_HELP.unsupported.title);
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (err) {
    throw mapCameraError(err);
  }
  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new CameraError('not-found', CAMERA_ERROR_HELP['not-found'].title);
  }
  let stopped = false;
  const handleEnded = () => {
    if (!stopped) onEnded();
  };
  track.addEventListener('ended', handleEnded);
  const s = track.getSettings();
  return {
    stream,
    settings: { width: s.width ?? 0, height: s.height ?? 0, facingMode: s.facingMode ?? null, label: track.label },
    stop: () => {
      stopped = true;
      track.removeEventListener('ended', handleEnded);
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

/**
 * Average luminance (0–255) of a tiny downscaled copy of the current frame.
 * Used only for the "too dark" setup hint; the pixels are discarded immediately.
 */
export function frameBrightness(video: HTMLVideoElement, canvas: HTMLCanvasElement): number | null {
  if (!video.videoWidth) return null;
  canvas.width = 32;
  canvas.height = 18;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, 32, 18);
    const { data } = ctx.getImageData(0, 0, 32, 18);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
    return sum / (data.length / 4);
  } catch {
    return null;
  }
}
