import { forwardRef, useEffect, useState, useSyncExternalStore, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { AccountError, expectedUnlockMs, getAccountState, passwordStrength, subscribeAccounts, type Account, type AccountState } from '@/lib/storage/accounts';
import { StorageError } from '@/lib/storage/db';
import { buttonClass, cx } from '@/components/ui';

export function useAccountState(): AccountState {
  return useSyncExternalStore(subscribeAccounts, getAccountState);
}

export function errorText(err: unknown): string {
  if (err instanceof AccountError || err instanceof StorageError) return err.message;
  if (err instanceof Error && err.name === 'GoogleError') return err.message;
  if (err instanceof Error && err.name === 'CryptoUnavailableError') return err.message;
  return 'Something went wrong. Nothing was changed. Try again.';
}

const rtf = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;

export function relativeDay(ms: number, now = Date.now()): string {
  const days = Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  if (!rtf) return new Date(ms).toLocaleDateString();
  if (days > -7) return rtf.format(days, 'day');
  if (days > -60) return rtf.format(Math.round(days / 7), 'week');
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Re-renders every second until `until` passes; returns the seconds left (0 when free). */
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

export function formatWait(seconds: number): string {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${seconds} s`;
}

const controlBase =
  'w-full min-h-12 rounded-[var(--radius-control)] border border-rule-strong/80 bg-surface pl-3 pr-12 text-base text-ink shadow-[inset_0_1px_1px_rgb(29_31_34/0.04)] placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150 hover:border-ink-2 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/20 aria-[invalid=true]:border-alert aria-[invalid=true]:ring-alert/15 disabled:bg-surface-2 disabled:text-ink-3';

/** Password input with a show/hide control that keeps its own accessible state. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(function PasswordInput({ className, ...rest }, ref) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input ref={ref} type={shown ? 'text' : 'password'} spellCheck={false} autoCapitalize="none" autoCorrect="off" className={cx(controlBase, className)} {...rest} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-[var(--radius-control)] text-ink-3 transition-colors hover:text-ink focus-visible:outline-offset-[-3px]"
      >
        {shown ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
      </button>
    </div>
  );
});

const STRENGTH = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'] as const;

/** Four short tape pieces; filled pieces are cyan. Guidance only: the minimum length is the only rule. */
export function StrengthMeter({ password, id }: { password: string; id: string }) {
  const s = passwordStrength(password);
  return (
    <div id={id} className="flex items-center gap-3" aria-live="polite">
      <div aria-hidden className="flex flex-1 gap-1.5">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cx('h-1.5 flex-1 rounded-full transition-colors duration-200', i <= s ? (s <= 1 ? 'bg-warn-mark' : 'bg-tape') : 'bg-rule')} />
        ))}
      </div>
      <span className={cx('min-w-20 whitespace-nowrap text-right text-footnote font-semibold', password ? (s <= 1 ? 'text-warn' : 'text-ink-2') : 'text-ink-3')}>{password ? STRENGTH[s] : '8+ characters'}</span>
    </div>
  );
}

/**
 * The signature moment of the account screens: while the password is stretched
 * into a key, a darker strip of tape is laid across the button. It runs for as
 * long as the same work took last time on this device, so it is honest progress,
 * and it lives inside the button, so nothing on the page jumps.
 */
export function SealButton({ phase, children, busyLabel, variant = 'primary', disabled, className, onClick, type = 'submit' }: { phase: 'idle' | 'running' | 'done'; children: ReactNode; busyLabel: string; variant?: 'primary' | 'danger'; disabled?: boolean; className?: string; onClick?: () => void; type?: 'submit' | 'button' }) {
  const ms = expectedUnlockMs();
  const running = phase !== 'idle';
  return (
    <button
      type={type}
      onClick={onClick}
      // Not `disabled` while running: that would grey the button out under the strip.
      disabled={disabled && !running}
      aria-disabled={running || undefined}
      aria-busy={running || undefined}
      className={buttonClass(variant, 'lg', cx('relative overflow-hidden', running && 'pointer-events-none', className))}
    >
      <span
        aria-hidden
        className={cx('absolute inset-y-0 left-0', variant === 'danger' ? 'bg-black/20' : 'bg-accent-strong')}
        style={{
          width: phase === 'idle' ? '0%' : phase === 'running' ? '92%' : '100%',
          transition: phase === 'running' ? `width ${Math.round(ms * 1.15)}ms cubic-bezier(0.25, 0.7, 0.4, 1)` : phase === 'done' ? 'width 140ms ease-out' : 'none',
        }}
      />
      <span className="relative">{running ? busyLabel : children}</span>
      <span className="sr-only" role="status">
        {running ? busyLabel : ''}
      </span>
    </button>
  );
}

/** An account shown as a written-on strip of tape: cyan for a password account, beige for the demo. */
export function AccountTab({ account, size = 'md', tone = 'paper' }: { account: Pick<Account, 'name' | 'kind'>; size?: 'sm' | 'md'; tone?: 'paper' | 'rail' }) {
  const initial = account.name.trim().charAt(0).toLocaleUpperCase() || '·';
  return (
    <span
      aria-hidden
      className={cx(
        'relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-bold',
        size === 'sm' ? 'h-7 w-10 text-[0.9rem]' : 'h-9 w-13 text-[1.05rem]',
        account.kind === 'guest' ? (tone === 'rail' ? 'bg-rail-3 text-rail-ink' : 'bg-surface-2 text-ink') : 'bg-tape text-white',
      )}
    >
      {/* The faint stitched centre line of kinesiology tape, as on the brand mark. */}
      <span className="absolute inset-x-1.5 top-1/2 border-t border-dashed border-white/30" />
      {/* The letter sits on its own patch of tape so the stitching stops short of it. */}
      <span className={cx('relative px-1', account.kind === 'guest' ? (tone === 'rail' ? 'bg-rail-3' : 'bg-surface-2') : 'bg-tape')}>{initial}</span>
    </span>
  );
}
