import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppDataProvider, useAppData } from './AppData';
import { AppShell } from './AppShell';
import { usePreferencesEffect } from './usePreferencesEffect';
import { ToastProvider } from '@/components/Toast';
import { ErrorState, LoadingBlock } from '@/components/ui';
import { HomePage } from '@/features/dashboard/HomePage';
import { OnboardingFlow } from '@/features/onboarding/OnboardingFlow';
import { PlanPage } from '@/features/exercises/PlanPage';
import { ExerciseDetailPage } from '@/features/exercises/ExerciseDetailPage';
import { PlanEditorPage } from '@/features/exercises/PlanEditorPage';
import { PlanHistoryPage } from '@/features/exercises/PlanHistoryPage';
import { SchedulePage } from '@/features/scheduling/SchedulePage';
import { EquipmentPage } from '@/features/equipment/EquipmentPage';
import { StartSessionPage } from '@/features/live-coaching/StartSessionPage';
import { ProgressPage } from '@/features/analytics/ProgressPage';
import { HistoryPage } from '@/features/session-history/HistoryPage';
import { SessionDetailPage } from '@/features/session-history/SessionDetailPage';
import { ComparePage } from '@/features/analytics/ComparePage';
import { WeeklySummaryPage } from '@/features/analytics/WeeklySummaryPage';
import { CheckInPage } from '@/features/check-ins/CheckInPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AboutPage } from '@/features/settings/AboutPage';
import { AccountScreen } from '@/features/accounts/AccountScreen';
import { useAccountState } from '@/features/accounts/accountUi';
import { useGoogleAutoBackup } from '@/features/accounts/useGoogleAutoBackup';
import { useAutoLock, useAutoLockHold } from '@/features/accounts/autoLock';
import { forgetGoogle } from '@/features/accounts/google';
import { MeasurementsPage } from '@/features/measurements/MeasurementsPage';

// Heavier screens load on demand: the live session pulls in the pose model; reports pull in the PDF library.
const LiveSessionPage = lazy(() => import('@/features/live-coaching/LiveSessionPage').then((m) => ({ default: m.LiveSessionPage })));
const ReportPage = lazy(() => import('@/features/reports/ReportPage').then((m) => ({ default: m.ReportPage })));

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingBlock label="Loading" />}>{children}</Suspense>;
}

/** Someone exercising may not touch the device for minutes: never auto-lock mid-session. */
function KeepUnlocked({ children }: { children: ReactNode }) {
  useAutoLockHold();
  return children;
}

/**
 * No account open → the account screen. An open account gets its own data
 * provider (keyed by id), so switching accounts can never show the last
 * account's data for a frame.
 */
function AccountGate() {
  const { account } = useAccountState();
  useGoogleAutoBackup(account);
  useAutoLock(account);
  useEffect(() => {
    if (!account) forgetGoogle();
  }, [account]);
  if (!account) return <AccountScreen />;
  return (
    <AppDataProvider key={account.id}>
      <Gate />
    </AppDataProvider>
  );
}

function Gate() {
  const { status, error, profile, reload } = useAppData();
  usePreferencesEffect(profile?.preferences);

  if (status === 'loading') {
    return (
      <div className="mx-auto max-w-xl px-6 py-24">
        <LoadingBlock label="Opening PocketRehab" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-6 py-24">
        <h1 className="text-2xl font-bold">PocketRehab couldn’t open its local storage</h1>
        <ErrorState title="Storage unavailable" error={error ?? 'Unknown error'} onRetry={reload} />
        <p className="text-ink-2">
          PocketRehab saves your plan and sessions only in this browser. Private browsing or blocked site data can prevent that. Try a normal browser window, or allow site data for this page.
        </p>
      </div>
    );
  }

  if (!profile) {
    return (
      <Routes>
        <Route path="/welcome" element={<OnboardingFlow />} />
        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="plan" element={<PlanPage />} />
        <Route path="plan/exercise/:id" element={<ExerciseDetailPage />} />
        <Route path="plan/edit" element={<PlanEditorPage />} />
        <Route path="plan/history" element={<PlanHistoryPage />} />
        <Route path="plan/schedule" element={<SchedulePage />} />
        <Route path="plan/equipment" element={<EquipmentPage />} />
        <Route path="session" element={<StartSessionPage />} />
        <Route
          path="session/:prescribedId"
          element={
            <KeepUnlocked>
              <Lazy>
                <LiveSessionPage />
              </Lazy>
            </KeepUnlocked>
          }
        />
        <Route path="progress" element={<ProgressPage />} />
        <Route path="progress/history" element={<HistoryPage />} />
        <Route path="progress/session/:id" element={<SessionDetailPage />} />
        <Route path="progress/compare" element={<ComparePage />} />
        <Route path="progress/week" element={<WeeklySummaryPage />} />
        <Route path="progress/measurements" element={<MeasurementsPage />} />
        <Route
          path="progress/report"
          element={
            <Lazy>
              <ReportPage />
            </Lazy>
          }
        />
        <Route path="checkin" element={<CheckInPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/about" element={<AboutPage />} />
        <Route path="welcome" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="space-y-3 py-10">
      <h1 className="text-2xl font-bold">That page doesn’t exist</h1>
      <p className="text-ink-2">The link may be out of date.</p>
      <a href="#/" className="font-semibold text-accent-strong underline">
        Go to Home
      </a>
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <AccountGate />
      </ToastProvider>
    </HashRouter>
  );
}
