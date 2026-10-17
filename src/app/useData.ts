import { listCheckIns, listFrictionReports, listScheduleOverrides, listSessions } from '@/lib/storage/repositories';
import { useLiveQuery } from '@/lib/storage/useLiveQuery';
import type { CheckIn, FrictionReport, ScheduleOverride, Session } from '@/lib/validation/schemas';

export interface AllData {
  sessions: Session[];
  checkIns: CheckIn[];
  overrides: ScheduleOverride[];
  friction: FrictionReport[];
}

/** Every stored record the progress and schedule screens need, refreshed on any change. */
export function useAllData() {
  return useLiveQuery<AllData>(async () => {
    const [sessions, checkIns, overrides, friction] = await Promise.all([listSessions(), listCheckIns(), listScheduleOverrides(), listFrictionReports()]);
    return { sessions, checkIns, overrides, friction };
  });
}
