/**
 * Feature detection. PocketRehab checks what this browser can actually do
 * instead of assuming from its name, and each missing capability has a
 * documented fallback.
 */

export type CapabilityStatus = 'available' | 'limited' | 'unavailable' | 'unknown';

export interface Capability {
  id: string;
  label: string;
  status: CapabilityStatus;
  detail: string;
  fallback: string;
}

async function permissionState(name: string): Promise<PermissionState | null> {
  try {
    const result = await navigator.permissions?.query({ name } as PermissionDescriptor);
    return result?.state ?? null;
  } catch {
    return null;
  }
}

function webgl2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function wasmSimd(): boolean {
  try {
    // Smallest valid module that uses a v128 SIMD instruction.
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

async function indexedDbWorks(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('pocketrehab-probe');
      req.onsuccess = () => {
        req.result.close();
        indexedDB.deleteDatabase('pocketrehab-probe');
        resolve(true);
      };
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function modelCached(): Promise<boolean | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const keys = await caches.keys();
    if (!keys.includes('pocketrehab-pose-model')) return false;
    const cache = await caches.open('pocketrehab-pose-model');
    return (await cache.keys()).some((r) => r.url.includes('pose_landmarker'));
  } catch {
    return null;
  }
}

export async function detectCapabilities(): Promise<Capability[]> {
  const secure = window.isSecureContext;
  const camera = !!navigator.mediaDevices?.getUserMedia;
  const cameraPerm = await permissionState('camera');
  const speech = 'speechSynthesis' in window;
  const recognition = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  const notifications = 'Notification' in window;
  const sw = 'serviceWorker' in navigator;
  const idb = await indexedDbWorks();
  const cached = await modelCached();
  const gl = webgl2();
  const simd = typeof WebAssembly !== 'undefined' && wasmSimd();
  const download = 'download' in document.createElement('a');
  let persisted: boolean | null;
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? null;
  } catch {
    persisted = null;
  }

  return [
    {
      id: 'secure',
      label: 'Secure context (HTTPS)',
      status: secure ? 'available' : 'unavailable',
      detail: secure ? 'This page is served securely, so the camera can be requested.' : 'This page is not secure, so browsers block the camera.',
      fallback: 'Open PocketRehab over HTTPS or on localhost.',
    },
    {
      id: 'camera',
      label: 'Camera access',
      status: !camera ? 'unavailable' : cameraPerm === 'denied' ? 'limited' : 'available',
      detail: !camera
        ? 'This browser does not expose a camera API.'
        : cameraPerm === 'denied'
          ? 'The camera API exists but permission was denied for this site.'
          : cameraPerm === 'granted'
            ? 'Camera permission is granted.'
            : 'Permission will be requested only when you start camera setup.',
      fallback: 'Use the simulated demo or log sessions manually.',
    },
    {
      id: 'pose',
      label: 'On-device pose model',
      status: typeof WebAssembly === 'undefined' ? 'unavailable' : gl ? 'available' : 'limited',
      detail: `${typeof WebAssembly === 'undefined' ? 'WebAssembly is unavailable.' : 'WebAssembly available'}${simd ? ' with SIMD' : ' without SIMD (slower)'}; ${gl ? 'WebGL2 GPU acceleration available.' : 'no WebGL2, so the model runs on the CPU at a reduced rate.'}`,
      fallback: 'Without WebAssembly, camera measurement is unavailable; everything else still works.',
    },
    {
      id: 'offline-model',
      label: 'Pose model saved for offline use',
      status: cached === null ? 'unknown' : cached ? 'available' : 'limited',
      detail: cached === null ? 'Cache storage is not available here.' : cached ? 'The model is cached on this device.' : 'The model downloads (about 6 MB) the first time you use the camera, then works offline.',
      fallback: 'Connect to the internet once before your first camera session.',
    },
    {
      id: 'storage',
      label: 'Local data storage (IndexedDB)',
      status: idb ? (persisted ? 'available' : 'limited') : 'unavailable',
      detail: idb
        ? persisted
          ? 'Data is stored on this device and the browser marked it persistent.'
          : 'Data is stored on this device. The browser may clear it if space runs low or site data is cleared.'
        : 'This browser blocked local storage (often private browsing).',
      fallback: 'Export your data regularly from Settings.',
    },
    {
      id: 'speech',
      label: 'Spoken coaching',
      status: speech ? 'available' : 'unavailable',
      detail: speech ? 'The browser can read instructions aloud.' : 'Speech synthesis is not available.',
      fallback: 'All instructions and feedback are always shown as text captions.',
    },
    {
      id: 'voice-commands',
      label: 'Voice commands (optional)',
      status: recognition ? 'limited' : 'unavailable',
      detail: recognition
        ? 'Available in this browser. Off by default; some browsers send audio to their own speech service.'
        : 'Speech recognition is not available in this browser.',
      fallback: 'Use the on-screen buttons or keyboard shortcuts (Space to pause, R to repeat).',
    },
    {
      id: 'notifications',
      label: 'Reminder notifications',
      status: !notifications ? 'unavailable' : Notification.permission === 'granted' ? 'available' : Notification.permission === 'denied' ? 'limited' : 'limited',
      detail: !notifications
        ? 'This browser does not support notifications.'
        : `Permission: ${Notification.permission}. Reminders only fire while PocketRehab is open; browsers do not run it in the background.`,
      fallback: 'In-app reminders and the .ics calendar export.',
    },
    {
      id: 'offline',
      label: 'Offline app shell',
      status: sw ? 'available' : 'unavailable',
      detail: sw ? 'Service workers are supported, so the app can open without a connection after the first visit.' : 'Service workers are not supported here.',
      fallback: 'Stay online while using PocketRehab.',
    },
    {
      id: 'download',
      label: 'File downloads',
      status: download ? 'available' : 'limited',
      detail: download ? 'Reports, calendar files and backups download directly.' : 'Direct downloads are not supported.',
      fallback: 'Use the printable report view and your browser’s Print / Save as PDF.',
    },
  ];
}
