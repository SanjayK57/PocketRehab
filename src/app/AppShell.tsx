import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BellRing, ClipboardList, History, House, LineChart, Lock, Play, Settings2, WifiOff, X, type LucideIcon } from 'lucide-react';
import { useAppData } from './AppData';
import { useOnline } from './usePreferencesEffect';
import { ErrorBoundary } from './ErrorBoundary';
import { BrandMark } from '@/components/BrandMark';
import { SkipLink } from '@/components/SkipLink';
import { Button, cx, LinkButton } from '@/components/ui';
import { removeDemoData } from '@/lib/storage/repositories';
import { useToast } from '@/components/Toast';
import { useReminders } from '@/features/scheduling/useReminders';
import { useLiveQuery } from '@/lib/storage/useLiveQuery';
import { listSessions } from '@/lib/storage/repositories';
import { dateKey, formatTime, todayKey } from '@/lib/time/dates';
import { countsTowardAdherence } from '@/features/scheduling/schedule';
import { AccountMenu } from '@/features/accounts/AccountMenu';
import { InstallButton } from '@/features/install/InstallButton';

const NAV: Array<{ to: string; label: string; short?: string; icon: LucideIcon; end: boolean }> = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/plan', label: 'My Plan', icon: ClipboardList, end: false },
  { to: '/session', label: 'Start Session', short: 'Session', icon: Play, end: false },
  { to: '/progress', label: 'Progress', icon: LineChart, end: false },
  { to: '/settings', label: 'Profile & Settings', short: 'Settings', icon: Settings2, end: false },
];

export function AppShell() {
  const { profile, recovered, dismissRecovered } = useAppData();
  const online = useOnline();
  const toast = useToast();
  const location = useLocation();
  const sessions = useLiveQuery(listSessions);
  const doneToday = (sessions.data ?? []).some((s) => countsTowardAdherence(s, profile?.isDemo) && dateKey(new Date(s.startedAt)) === todayKey());
  const reminder = useReminders(profile, doneToday);
  const inLiveSession = /^\/session\/.+/.test(location.pathname);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15.5rem_1fr]">
      <SkipLink targetId="main" />

      <aside className="no-print hidden bg-rail text-rail-ink lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="flex items-center gap-3 px-5 pt-7 pb-9">
          <BrandMark className="h-7 w-9" />
          <span>
            <span className="block text-[1.25rem] leading-tight font-bold tracking-[-0.02em]">PocketRehab</span>
            <span className="block text-[0.8rem] text-rail-ink-2">Rehab done right.</span>
          </span>
        </div>
        <nav aria-label="Main navigation" className="flex-1 px-3">
          <ul className="space-y-0.5">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cx(
                      'group relative flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 transition-[background-color,color] duration-150 focus-visible:outline-rail-ink',
                      isActive ? 'bg-rail-3/70 font-bold text-rail-ink' : 'font-medium text-rail-ink-2 hover:bg-rail-2 hover:text-rail-ink',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {/* The active page is marked with a short strip of cyan tape. */}
                      <span aria-hidden className={cx('absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-full bg-tape transition-transform duration-300 ease-[var(--ease-out)]', isActive ? 'scale-y-100' : 'scale-y-0')} />
                      <item.icon aria-hidden className={cx('size-5 transition-colors', isActive && 'text-tape')} strokeWidth={isActive ? 2 : 1.75} />
                      <span>{item.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="px-3 pb-3 text-rail-ink">
          <InstallButton tone="rail" className="mb-3 w-full justify-center" />
          <AccountMenu />
        </div>
        <p className="mx-4 mb-6 flex gap-2.5 border-t border-rail-3 px-1 pt-4 text-[0.8125rem] leading-snug text-rail-ink-2">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <span>Pose tracking runs on this device. Camera video is never uploaded.</span>
        </p>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="no-print sticky top-0 z-30 flex items-center gap-2.5 border-b border-rule/80 bg-ground/90 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur-md lg:hidden">
          <BrandMark className="h-5 w-7" />
          <span className="flex-1 text-lg font-bold tracking-[-0.02em]">PocketRehab</span>
          <InstallButton className="min-h-9 px-3" />
          <AccountMenu compact />
        </header>

        <div className="no-print">
          {profile?.isDemo ? (
            <Banner tone="demo">
              <p className="flex-1">
                <strong>Demo profile.</strong> Everything here is simulated sample data, not a real person’s history.
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="bg-surface/70"
                onClick={async () => {
                  await removeDemoData();
                  toast.show('Demo profile removed.');
                }}
              >
                Remove demo data
              </Button>
            </Banner>
          ) : null}
          {!online ? (
            <Banner tone="warn" icon={<WifiOff aria-hidden className="size-4 shrink-0 text-warn" />}>
              <p className="flex-1">You’re offline. Saved data, plans and progress still work. Camera tracking works only if the pose model was cached on an earlier visit.</p>
            </Banner>
          ) : null}
          {reminder.dueAt && !inLiveSession ? (
            <Banner tone="accent" icon={<BellRing aria-hidden className="size-4 shrink-0 text-accent-strong" />} onDismiss={reminder.dismiss} dismissLabel="Dismiss reminder">
              <p className="flex-1">Your planned session is at {formatTime(reminder.dueAt)}.</p>
              <LinkButton to="/session" size="sm">
                Start session
              </LinkButton>
            </Banner>
          ) : null}
          {recovered.length > 0 ? (
            <Banner tone="neutral" icon={<History aria-hidden className="size-4 shrink-0 text-ink-2" />} onDismiss={dismissRecovered} dismissLabel="Dismiss">
              <p className="flex-1">
                Your last session was interrupted before it finished. What was measured up to that point was saved and marked as interrupted. Nothing was repeated or added.
              </p>
              <LinkButton to={`/progress/session/${recovered[0]?.id}`} size="sm" variant="secondary" onClick={dismissRecovered}>
                Review it
              </LinkButton>
            </Banner>
          ) : null}
        </div>

        <main id="main" tabIndex={-1} className={cx('mx-auto w-full flex-1 px-4 pt-7 pb-28 outline-none sm:px-8 lg:pt-11 lg:pb-14', inLiveSession ? 'max-w-[90rem]' : 'max-w-6xl')}>
          <ErrorBoundary resetKey={location.pathname}>
            {/* Keyed by route so each screen settles in once as it opens (reduced motion: no movement). */}
            <div key={location.pathname} className="route-enter">
              <Outlet />
            </div>
          </ErrorBoundary>
        </main>
      </div>

      <nav aria-label="Main navigation" className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-rail-2 bg-rail pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="grid grid-cols-5">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) => cx('group relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[0.72rem] font-semibold transition-colors', isActive ? 'text-rail-ink' : 'text-rail-ink-2 active:text-rail-ink')}
              >
                {({ isActive }) => (
                  <>
                    <span aria-hidden className={cx('absolute top-0 h-[3px] w-8 rounded-b-full bg-tape transition-transform duration-300 ease-[var(--ease-out)]', isActive ? 'scale-x-100' : 'scale-x-0')} />
                    <item.icon aria-hidden className={cx('size-[1.375rem] transition-transform duration-200 ease-[var(--ease-spring)] group-active:scale-90', isActive && 'text-tape')} strokeWidth={isActive ? 2 : 1.75} />
                    <span>{item.short ?? item.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

const BANNER_TONES = {
  demo: 'bg-signal-soft/80',
  warn: 'bg-warn-soft',
  accent: 'bg-accent-soft',
  neutral: 'bg-surface-2',
} as const;

/** Full-width status strip under the header (demo data, offline, reminder, recovered session). */
function Banner({ tone, icon, children, onDismiss, dismissLabel }: { tone: keyof typeof BANNER_TONES; icon?: ReactNode; children: ReactNode; onDismiss?: () => void; dismissLabel?: string }) {
  return (
    <div role="status" className={cx('flex animate-fade flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm text-ink sm:px-8', BANNER_TONES[tone])}>
      {icon}
      {children}
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="-mr-1 rounded-full p-1.5 text-ink-2 transition-colors hover:bg-ink/[0.06] hover:text-ink" aria-label={dismissLabel}>
          <X aria-hidden className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
