import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAppData } from '@/app/AppData';
import { useAllData } from '@/app/useData';
import { EXERCISES } from '@/features/exercises/library';
import { ProgressTabs } from '@/features/analytics/ProgressPage';
import { formatDateTime } from '@/lib/time/dates';
import { ErrorState, LoadingBlock, PageHeader, QualityBadge, Select, Tag } from '@/components/ui';

export function HistoryPage() {
  const { profile } = useAppData();
  const data = useAllData();
  const [filter, setFilter] = useState('all');
  if (!profile) return null;
  const sessions = (data.data?.sessions ?? []).filter((s) => filter === 'all' || s.exerciseId === filter || s.mode === filter);

  return (
    <div>
      <PageHeader title="Progress" description="Every saved session, newest first. Open one to see its repetition timeline or delete it." />
      <ProgressTabs />
      {data.status === 'loading' ? <LoadingBlock /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="h-filter" className="font-semibold">
          Show
        </label>
        <Select id="h-filter" className="w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All sessions</option>
          {Object.values(EXERCISES).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          <option value="camera">Camera sessions</option>
          <option value="manual">Manual logs</option>
          <option value="simulated">Simulated demos</option>
        </Select>
      </div>
      {data.status === 'ready' && sessions.length === 0 ? <p className="py-6 text-ink-2">No sessions match. Sessions appear here after you finish or end one.</p> : null}
      <ul className="divide-y divide-rule border-y border-ink">
        {sessions.map((s) => (
          <li key={s.id}>
            <Link to={`/progress/session/${s.id}`} className="group flex flex-wrap items-center gap-x-4 gap-y-1 py-3.5">
              <span className="w-36 shrink-0 text-ink-2">{formatDateTime(s.startedAt)}</span>
              <span className="min-w-0 flex-1">
                <span className="font-bold group-hover:underline">{EXERCISES[s.exerciseId].name}</span>
                <span className="text-ink-2"> · {s.side}</span>
                <span className="mt-1 flex flex-wrap gap-1.5">
                  <Tag tone={s.status === 'completed' ? 'ok' : s.status === 'in-progress' ? 'neutral' : 'warn'}>{s.status.replace('-', ' ')}</Tag>
                  {s.mode === 'simulated' ? <Tag tone="signal">Simulated demo</Tag> : s.mode === 'manual' ? <Tag>Manual log</Tag> : null}
                </span>
              </span>
              <span className="num w-24 text-right">{s.mode === 'manual' ? `${s.manualRepsReported ?? 0} reps` : `${s.reps.length} reps`}</span>
              <span className="w-44">{s.quality && s.mode !== 'manual' ? <QualityBadge state={s.summary?.valid ? 'reliable' : s.quality.state === 'reliable' ? 'uncertain' : s.quality.state} size="sm" /> : null}</span>
              <ChevronRight aria-hidden className="size-5 text-ink-3" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
