import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Plan, Profile, Session } from '@/lib/validation/schemas';
import { getCurrentPlan, getProfile, recoverInterruptedSessions } from '@/lib/storage/repositories';
import { useLiveQuery } from '@/lib/storage/useLiveQuery';

interface AppData {
  status: 'loading' | 'ready' | 'error';
  error: Error | null;
  profile: Profile | null;
  plan: Plan | null;
  /** Sessions that were found "in progress" at startup (tab closed mid-session) and marked interrupted. */
  recovered: Session[];
  dismissRecovered: () => void;
  reload: () => void;
}

const Ctx = createContext<AppData | null>(null);

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppData must be used inside AppDataProvider');
  return v;
}
export function AppDataProvider({ children }: { children: ReactNode }) {
  const q = useLiveQuery(async () => {
    const [profile, plan] = await Promise.all([getProfile(), getCurrentPlan()]);
    return { profile, plan };
  });
  const [recovered, setRecovered] = useState<Session[]>([]);

  useEffect(() => {
    recoverInterruptedSessions()
      .then(setRecovered)
      .catch(() => undefined);
  }, []);

  const value: AppData = {
    status: q.status,
    error: q.error,
    profile: q.data?.profile ?? null,
    plan: q.data?.plan ?? null,
    recovered,
    dismissRecovered: () => setRecovered([]),
    reload: q.reload,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
