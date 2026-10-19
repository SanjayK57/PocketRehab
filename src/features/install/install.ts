import { useSyncExternalStore } from 'react';

/** Chrome, Edge and Android fire this when the app can be installed; it is kept so a button can show the prompt later. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

// Registered at import time (from main.tsx) so the event is never missed before React mounts.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export type InstallMode = 'installed' | 'prompt' | 'ios' | 'mac-safari' | 'other';

function mode(): InstallMode {
  if (typeof window === 'undefined') return 'other';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return 'installed';
  if (deferred) return 'prompt';
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  if (iOS) return 'ios';
  if (ua.includes('Macintosh') && ua.includes('Safari') && !/Chrome|Chromium|Edg|Firefox/.test(ua)) return 'mac-safari';
  return 'other';
}

export function useInstallMode(): InstallMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    mode,
    () => 'other',
  );
}

/** Shows the browser's own install dialog. Resolves true when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  await e.prompt();
  const { outcome } = await e.userChoice;
  deferred = null;
  notify();
  return outcome === 'accepted';
}
