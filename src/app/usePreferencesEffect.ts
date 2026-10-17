import { useEffect, useState } from 'react';
import type { Preferences } from '@/lib/validation/schemas';

/** Applies text size, motion and contrast preferences to the document root. */
export function usePreferencesEffect(prefs: Preferences | null | undefined): void {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.textScale = prefs?.textScale ?? '100';
    root.dataset.motion = prefs?.reducedMotion ?? 'system';
    root.dataset.contrast = prefs?.highContrast ? 'more' : 'normal';
  }, [prefs?.textScale, prefs?.reducedMotion, prefs?.highContrast]);
}

/** True when motion should be reduced, combining the OS setting and the in-app preference. */
export function useReducedMotion(pref: Preferences['reducedMotion'] | undefined): boolean {
  const [system, setSystem] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setSystem(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  if (pref === 'reduce') return true;
  if (pref === 'no-preference') return false;
  return !!system;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
