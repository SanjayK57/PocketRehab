import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BellRing, ClipboardList, House, LineChart, Lock, Play, Settings2, WifiOff, X } from 'lucide-react';
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

const NAV = [
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
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <SkipLink targetId="main" />

      <aside className="no-print hidden bg-rail text-rail-ink lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="flex items-center gap-2.5 px-5 pb-8 pt-7">
          <BrandMark className="h-6 w-8" />
          <span>
            <span className="block text-xl font-bold leading-tight tracking-tight">PocketRehab</span>
            <span className="block text-[0.8rem] text-rail-ink-2">Rehab done right.</span>
          </span>
        </div>
        <nav aria-label="Main navigation" className="flex-1 px-3">
          <ul className="space-y-1">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cx(
                      'flex min-h-11 items-center gap-3 rounded-lg px-3 transition-colors duration-150 focus-visible:outline-rail-ink',
                      isActive ? 'bg-rail-3 font-bold text-rail-ink' : 'font-medium text-rail-ink-2 hover:bg-rail-2 hover:text-rail-ink',
                    )
                  }
                >
                  <item.icon aria-hidden className="size-5" strokeWidth={1.75} />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <p className="mx-4 mb-6 flex gap-2.5 border-t border-rail-3 px-1 pt-4 text-sm leading-snug text-rail-ink-2">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <span>Pose tracking runs on this device. Camera video is never uploaded.</span>
        </p>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="no-print flex items-center gap-2.5 border-b border-rule bg-ground/95 px-4 py-3 backdrop-blur lg:hidden">
          <BrandMark className="h-5 w-7" />
          <span className="text-lg font-bold tracking-tight">PocketRehab</span>
        </header>

        <div className="no-print">
          {profile?.isDemo ? (
            <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-signal-soft px-4 py-2.5 text-sm text-ink sm:px-8">
              <p className="flex-1">
                <strong>Demo profile.</strong> Everything here is simulated sample data, not a real person’s history.
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await removeDemoData();
                  toast.show('Demo profile removed.');
                }}
              >
                Remove demo data
              </Button>
            </div>
          ) : null}
          {!online ? (
            <div role="status" className="flex items-center gap-2 bg-warn-soft px-4 py-2.5 text-sm sm:px-8">
              <WifiOff aria-hidden className="size-4 text-warn" />
              <p>
                You’re offline. Saved data, plans and progress still work. Camera tracking works only if the pose model was cached on an earlier visit.
              </p>
            </div>
          ) : null}
          {reminder.dueAt && !inLiveSession ? (
            <div role="status" className="flex flex-wrap items-center gap-3 bg-accent-soft px-4 py-2.5 text-sm sm:px-8">
              <BellRing aria-hidden className="size-4 text-accent-strong" />
              <p className="flex-1">Your planned session is at {formatTime(reminder.dueAt)}.</p>
              <LinkButton to="/session" size="sm">
                Start session
              </LinkButton>
              <button type="button" onClick={reminder.dismiss} className="rounded p-1 text-ink-2 hover:text-ink" aria-label="Dismiss reminder">
                <X aria-hidden className="size-4" />
              </button>
            </div>
          ) : null}
          {recovered.length > 0 ? (
            <div role="status" className="flex flex-wrap items-center gap-3 bg-surface-2 px-4 py-2.5 text-sm sm:px-8">
              <p className="flex-1">
                Your last session was interrupted before it finished. What was measured up to that point was saved and marked as interrupted. Nothing was repeated or added.
              </p>
              <LinkButton to={`/progress/session/${recovered[0]?.id}`} size="sm" variant="secondary" onClick={dismissRecovered}>
                Review it
              </LinkButton>
              <button type="button" onClick={dismissRecovered} className="rounded p-1 text-ink-2 hover:text-ink" aria-label="Dismiss">
                <X aria-hidden className="size-4" />
              </button>
            </div>
          ) : null}
        </div>

        <main id="main" tabIndex={-1} className={cx('mx-auto w-full flex-1 px-4 pb-28 pt-6 outline-none sm:px-8 lg:pb-12 lg:pt-10', inLiveSession ? 'max-w-[90rem]' : 'max-w-6xl')}>
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
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
                className={({ isActive }) => cx('flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[0.72rem] font-semibold', isActive ? 'text-rail-ink' : 'text-rail-ink-2')}
              >
                {({ isActive }) => (
                  <>
                    <item.icon aria-hidden className={cx('size-5', isActive && 'text-tape')} strokeWidth={1.75} />
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
