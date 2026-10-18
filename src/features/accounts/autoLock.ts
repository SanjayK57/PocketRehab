import { useEffect } from 'react';
import { lockAccount, type Account } from '@/lib/storage/accounts';

/**
 * Locks a password account after a stretch without input. A live session holds
 * the lock open: people exercise for minutes without touching the device, and
 * locking mid-set would end their session.
 */

let lastActivity = Date.now();
let holds = 0;

/** Pauses auto-lock until the returned function is called (safe to call twice). */
export function holdAutoLock(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    lastActivity = Date.now(); // the idle clock starts when the session ends, not when it started
  };
}

/** Pauses auto-lock while the calling component is mounted (and `active`). */
export function useAutoLockHold(active = true): void {
  useEffect(() => (active ? holdAutoLock() : undefined), [active]);
}

const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

export function useAutoLock(account: Account | null): void {
  const id = account?.kind === 'password' ? account.id : null;
  const minutes = account?.autoLockMinutes ?? 0;
  useEffect(() => {
    if (!id || minutes <= 0) return;
    lastActivity = Date.now();
    const bump = () => {
      lastActivity = Date.now();
    };
    // Timers are throttled in background tabs, so the check also runs when the tab comes back.
    const check = () => {
      if (holds === 0 && Date.now() - lastActivity >= minutes * 60_000) void lockAccount('idle');
    };
    for (const e of ACTIVITY) window.addEventListener(e, bump, { capture: true, passive: true });
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 15_000);
    return () => {
      for (const e of ACTIVITY) window.removeEventListener(e, bump, { capture: true });
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, [id, minutes]);
}
