import { useLiveQuery } from '@/lib/storage/useLiveQuery';
import { listPlanVersions } from '@/lib/storage/repositories';
import { ErrorState, LoadingBlock, PageHeader, Tag } from '@/components/ui';
import { PlanTabs } from './PlanPage';
import { diffPlans, planKindLabel } from './describe';
import { formatDateTime } from '@/lib/time/dates';

const SOURCE_LABEL = {
  onboarding: 'Entered during setup',
  'clinician-update': 'Updated from clinician instructions',
  import: 'Imported from a file',
  'status-change': 'Status changed',
  demo: 'Demo profile',
} as const;

export function PlanHistoryPage() {
  const q = useLiveQuery(listPlanVersions);
  return (
    <div>
      <PageHeader title="My Plan" description="Every version of your plan is kept, with when it changed and who approved it (as you entered it)." />
      <PlanTabs />
      {q.status === 'loading' ? <LoadingBlock /> : null}
      {q.status === 'error' ? <ErrorState error={q.error} onRetry={q.reload} /> : null}
      {q.data ? (
        <ol className="space-y-0">
          {[...q.data].reverse().map((p, i, arr) => {
            const prev = arr[i + 1];
            return (
              <li key={p.version} className="grid gap-x-6 border-t border-ink py-5 sm:grid-cols-[8rem_1fr]">
                <div>
                  <p className="text-lg font-bold">Version {p.version}</p>
                  {i === 0 ? <Tag tone="accent">Current</Tag> : null}
                </div>
                <div className="space-y-1.5">
                  <p className="font-semibold">{SOURCE_LABEL[p.changeSource]}</p>
                  <p className="text-ink-2">
                    {formatDateTime(p.createdAt)} · {planKindLabel(p)} · status {p.status.replace('-', ' ')}
                    {p.kind === 'clinician-entered' ? ` · approved by ${p.authorizedBy || 'not recorded'}${p.authorizationDate ? ` (${p.authorizationDate})` : ''}` : ''}
                  </p>
                  {p.changeSummary ? <p>“{p.changeSummary}”</p> : null}
                  {prev ? (
                    <ul className="list-disc pl-5 text-sm text-ink-2">
                      {diffPlans(prev, p).map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-ink-2">First version: {p.exercises.length} exercise{p.exercises.length === 1 ? '' : 's'}.</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
