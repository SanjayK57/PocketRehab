import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAppData } from '@/app/AppData';
import { useAllData } from '@/app/useData';
import { buildSchedule } from '@/features/scheduling/schedule';
import { addDays, formatDate, todayKey, weekStart } from '@/lib/time/dates';
import { Button, ErrorState, KeyValue, LinkButton, LoadingBlock, PageHeader, Section } from '@/components/ui';
import { ProgressTabs } from './ProgressPage';
import { buildWeeklySummary } from './weekly';

export function WeeklySummaryPage() {
  const { profile, plan } = useAppData();
  const data = useAllData();
  const today = todayKey();
  const [anchor, setAnchor] = useState(() => weekStart(today));
  const summary = useMemo(() => {
    if (!profile || !data.data) return null;
    const includeSimulated = profile.isDemo;
    const sessions = data.data.sessions.filter((s) => includeSimulated || s.mode !== 'simulated');
    const end = addDays(anchor, 6);
    const days = buildSchedule(profile.schedule, data.data.overrides, sessions, plan, anchor, end < today ? end : today, today, { includeSimulated });
    return buildWeeklySummary({ weekStart: anchor, days, sessions, checkIns: data.data.checkIns.filter((c) => includeSimulated || !c.isDemoData), friction: data.data.friction, plan, includeSimulated });
  }, [profile, plan, data.data, anchor, today]);

  if (data.status === 'loading') return <LoadingBlock />;
  if (data.status === 'error') return <ErrorState error={data.error} onRetry={data.reload} />;
  if (!summary) return null;
  const a = summary.adherence;

  return (
    <div>
      <PageHeader title="Progress" description="A plain summary of one week. It describes what was recorded; it does not draw medical conclusions." />
      <ProgressTabs />
      <div className="mb-8 flex flex-wrap items-center gap-2">
        <Button variant="quiet" size="sm" aria-label="Previous week" onClick={() => setAnchor(addDays(anchor, -7))} icon={<ChevronLeft aria-hidden className="size-4" />} />
        <h2 className="text-xl font-bold">
          {formatDate(summary.weekStart, { month: 'long', day: 'numeric' })} – {formatDate(summary.weekEnd, { month: 'long', day: 'numeric' })}
        </h2>
        <Button variant="quiet" size="sm" aria-label="Next week" disabled={addDays(anchor, 7) > today} onClick={() => setAnchor(addDays(anchor, 7))} icon={<ChevronRight aria-hidden className="size-4" />} />
      </div>
      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-2">
        <Section title="Sessions">
          <KeyValue
            items={[
              { label: 'Scheduled', value: a.scheduled },
              { label: 'Completed sessions (all exercises)', value: summary.sessionsCompleted },
              { label: 'Scheduled days completed', value: a.eligible ? `${a.completed} of ${a.eligible} due` : 'Nothing due' },
              { label: 'Adherence', value: a.percent === null ? 'Not meaningful yet' : `${a.percent}%`, hint: a.unavailable ? `${a.unavailable} day(s) marked unavailable, not counted` : undefined },
              { label: 'Sessions with reliable measurements', value: summary.validMeasurements },
            ]}
          />
        </Section>
        <Section title="How you said you felt">
          <KeyValue
            items={[
              { label: 'Check-ins', value: summary.selfReport.checkIns },
              { label: 'Average discomfort', value: summary.selfReport.pain === null ? '—' : `${summary.selfReport.pain}/10` },
              { label: 'Average fatigue', value: summary.selfReport.fatigue === null ? '—' : `${summary.selfReport.fatigue}/10` },
              { label: 'Average difficulty', value: summary.selfReport.difficulty === null ? '—' : `${summary.selfReport.difficulty}/10` },
              { label: 'Check-ins flagging symptoms', value: summary.selfReport.concerning },
            ]}
          />
        </Section>
        <Section title="Measurements">
          {summary.changes.length ? (
            <ul className="space-y-2">
              {summary.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-2">No reliable measurements up to this week.</p>
          )}
        </Section>
        <Section title="Limitations">
          <ul className="list-disc space-y-1 pl-5 text-ink-2">
            {summary.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Section>
        <Section title="Topics you might raise with your clinician">
          {summary.topics.length ? (
            <ul className="list-disc space-y-1.5 pl-5">
              {summary.topics.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-2">Nothing flagged this week.</p>
          )}
        </Section>
        <Section title="Practical ideas">
          {summary.suggestions.length ? (
            <ul className="list-disc space-y-1.5 pl-5">
              {summary.suggestions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-2">No barriers reported this week.</p>
          )}
          <LinkButton to="/progress/report" variant="secondary" className="mt-4">
            Make a report for my clinician
          </LinkButton>
        </Section>
      </div>
    </div>
  );
}
