import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Plus, Video } from 'lucide-react';
import type { Session } from '@/lib/validation/schemas';
import { useAppData } from '@/app/AppData';
import { useAllData } from '@/app/useData';
import { EXERCISES } from '@/features/exercises/library';
import { describePrescription } from '@/features/exercises/describe';
import { buildSchedule, adherence, nextSession, type ScheduledDay } from '@/features/scheduling/schedule';
import { interpretChange, measurableSessions, series } from '@/features/analytics/analysis';
import { numericResponse, responseValue } from '@/lib/safety/checkins';
import { addDays, dateKey, formatDate, formatTime, todayKey, weekStart, WEEKDAY_SHORT } from '@/lib/time/dates';
import { ErrorState, LinkButton, LoadingBlock, Notice, Section, buttonClass } from '@/components/ui';
import { RangeStrips, RepStrip, WeekCells, TapeSwatch, type DayCellStatus, type StripRow } from '@/components/tape';

function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function HomePage() {
  const { profile, plan } = useAppData();
  const data = useAllData();
  const today = todayKey();

  const view = useMemo(() => {
    if (!profile || !data.data) return null;
    const includeSimulated = profile.isDemo;
    const sessions = data.data.sessions.filter((s) => includeSimulated || s.mode !== 'simulated');
    const wkStart = weekStart(today);
    const days = buildSchedule(profile.schedule, data.data.overrides, sessions, plan, wkStart, addDays(wkStart, 6), today, { includeSimulated });
    const upcoming = buildSchedule(profile.schedule, data.data.overrides, sessions, plan, today, addDays(today, 14), today, { includeSimulated });
    const next = nextSession(upcoming, today);
    const missed = buildSchedule(profile.schedule, data.data.overrides, sessions, plan, addDays(today, -6), addDays(today, -1), today, { includeSimulated }).filter((d) => d.status === 'missed');

    // The plot: the most recently measured exercise/side, last 5 camera sessions (reliable or not).
    const cameraLike = sessions.filter((s) => (s.mode === 'camera' || (includeSimulated && s.mode === 'simulated')) && s.status !== 'in-progress' && s.reps.length > 0).sort((a, b) => b.startedAt - a.startedAt);
    const latest = cameraLike[0] ?? null;
    let plot: { title: string; rows: StripRow[]; caption: string; target: Session['prescription']['target']; exerciseId: string } | null = null;
    if (latest) {
      const group = cameraLike.filter((s) => s.exerciseId === latest.exerciseId && s.side === latest.side).slice(0, 5).reverse();
      const measured = measurableSessions(sessions, { includeSimulated });
      const pts = series(measured, latest.exerciseId, latest.side, 'peakMedian');
      const def = EXERCISES[latest.exerciseId];
      plot = {
        title: `${def.shortName} · ${latest.side} · peak angle (camera estimate)`,
        exerciseId: latest.exerciseId,
        target: latest.prescription.target,
        caption: interpretChange(pts).message,
        rows: group.map((s, i) => ({
          id: s.id,
          label: formatDate(dateKey(new Date(s.startedAt)), { month: 'short', day: 'numeric' }),
          start: s.summary?.valid ? s.summary.startMedian : null,
          peak: s.summary?.valid ? s.summary.peakMedian : null,
          reliable: !!s.summary?.valid,
          emphasis: i === group.length - 1,
          simulated: s.mode === 'simulated',
        })),
      };
    }
    const lastCheckIn = data.data.checkIns.filter((c) => includeSimulated || !c.isDemoData)[0] ?? null;
    return { days, wk: adherence(days), next, missed, plot, latest, lastCheckIn, wkStart };
  }, [profile, plan, data.data, today]);

  if (!profile || !plan) return null;
  if (data.status === 'loading') return <LoadingBlock label="Loading your dashboard" lines={6} />;
  if (data.status === 'error') return <ErrorState error={data.error} onRetry={data.reload} />;
  if (!view) return null;

  const enabled = plan.exercises.filter((e) => e.enabled);
  const firstEnabled = enabled[0];
  const nextLabel = view.next ? (view.next.date === today ? `Today, ${formatTime(view.next.time)}` : `${formatDate(view.next.date, { weekday: 'long', month: 'short', day: 'numeric' })}, ${formatTime(view.next.time)}`) : 'No session scheduled';

  return (
    <div className="grid gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-8">
        <header>
          <h1 className="text-[2rem] font-bold leading-tight sm:text-[2.1rem]">
            {greeting()}, {profile.displayName}
          </h1>
          <p className="mt-1.5 text-ink-2">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} ·{' '}
            {plan.kind === 'demonstration' ? (
              <span className="text-signal-ink">You’re using the demonstration plan, not a clinician’s plan</span>
            ) : (
              <>Your plan was entered from {plan.authorizedBy ? `${plan.authorizedBy}’s` : 'your clinician’s'} instructions (v{plan.version})</>
            )}
          </p>
        </header>

        {plan.status !== 'active' ? (
          <Notice tone="warn" title={plan.status === 'needs-review' ? 'Your plan is marked as needing review' : 'Your plan is marked unavailable'} actions={<LinkButton to="/plan" size="sm" variant="secondary">Open My Plan</LinkButton>}>
            {plan.status === 'needs-review' ? 'Check with your clinician before continuing these exercises.' : 'Sessions are paused until the plan is updated.'}
          </Notice>
        ) : null}

        <Section
          title={view.plot ? <span className="text-[1.35rem] leading-snug">{view.plot.title}</span> : 'Your measurements'}
          actions={
            <Link to="/progress" className="inline-flex items-center gap-1 font-bold text-accent-strong underline-offset-4 hover:underline">
              All progress <ChevronRight aria-hidden className="size-4" />
            </Link>
          }
        >
          {view.plot ? (
            <>
              <ul className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-2">
                <li className="flex items-center gap-2">
                  <TapeSwatch kind="reliable" /> Reliable measurement
                </li>
                <li className="flex items-center gap-2">
                  <TapeSwatch kind="uncertain" /> Tracking uncertain
                </li>
                <li>Each strip runs from start angle to peak angle</li>
              </ul>
              <figure>
                <RangeStrips rows={view.plot.rows} target={view.plot.target ? { min: view.plot.target.min, max: view.plot.target.max, label: `${view.plot.target.source === 'clinician' ? 'Clinician target' : 'Demo target'} ${view.plot.target.min}–${view.plot.target.max}°` } : null} max={view.plot.exerciseId === 'shoulder-abduction' || view.plot.exerciseId === 'elbow-flexion' ? 160 : 180} />
                <figcaption className="mt-2 max-w-[70ch] text-ink-2">
                  <span className="sr-only">
                    {view.plot.rows.map((r) => `${r.label}: ${r.reliable && r.peak !== null ? `${Math.round(r.peak)} degrees` : 'tracking uncertain, not used'}`).join('; ')}.{' '}
                  </span>
                  {view.plot.caption}
                </figcaption>
              </figure>
            </>
          ) : (
            <div className="max-w-[62ch] space-y-3 py-2">
              <p className="text-lg">No measurements yet.</p>
              <p className="text-ink-2">After your first camera session, each session appears here as a strip of tape running from where the movement started to its peak angle. Sessions with shaky tracking are shown hatched and are never used as progress.</p>
              {firstEnabled ? (
                <LinkButton to={`/session/${firstEnabled.id}`} icon={<Video aria-hidden className="size-4" />}>
                  Start your first session
                </LinkButton>
              ) : null}
            </div>
          )}
        </Section>

        <Section title="This week" actions={<p className="text-ink-2">{view.wk.percent === null ? 'Nothing due yet this week' : `${view.wk.completed} of ${view.wk.eligible} due sessions completed (${view.wk.percent}%)`}</p>}>
          <WeekCells days={weekCells(view.days, view.wkStart, today)} />
          <p className="mt-2 text-sm text-ink-3">
            <Link to="/plan/schedule" className="font-semibold text-accent-strong underline underline-offset-4">
              Open schedule
            </Link>{' '}
            to reschedule, mark a day unavailable, or add it to your calendar.
          </p>
        </Section>

        {view.missed.length ? (
          <Notice tone="neutral" title={`You missed ${view.missed.length === 1 ? 'a session' : `${view.missed.length} sessions`} in the last week`} actions={<><LinkButton to="/plan/schedule" size="sm">Reschedule</LinkButton><LinkButton to="/checkin?barriers=1" size="sm" variant="secondary">Tell us what got in the way</LinkButton></>}>
            That happens. PocketRehab won’t pile missed sessions onto later days. You can move one to another day, or note what made it hard so you can mention it to your clinician.
          </Notice>
        ) : null}
      </div>

      <aside className="space-y-8" aria-label="Next session and recent check-in">
        <section aria-labelledby="next-h" className="rounded-[var(--radius-card)] bg-surface-2 p-6">
          <h2 id="next-h" className="text-[1.4rem] font-bold leading-tight">
            {nextLabel}
          </h2>
          <p className="text-ink-2">
            Next session · {enabled.length} exercise{enabled.length === 1 ? '' : 's'}
          </p>
          <ol className="my-4">
            {enabled.map((e, i) => (
              <li key={e.id} className="grid grid-cols-[1.25rem_1fr] gap-2.5 border-t border-ink/15 py-2.5">
                <span className="num text-ink-2">{i + 1}</span>
                <span>
                  <Link to={`/plan/exercise/${e.id}`} className="block font-bold hover:underline">
                    {EXERCISES[e.exerciseId].name}
                  </Link>
                  <span className="text-ink-2">
                    {e.side === 'auto' ? 'side facing camera' : e.side} · {describePrescription(e)}
                  </span>
                </span>
              </li>
            ))}
            {enabled.length === 0 ? <li className="text-ink-2">No exercises are enabled in your plan.</li> : null}
          </ol>
          {firstEnabled ? (
            <>
              <Link to="/session" className={buttonClass('primary', 'lg', 'w-full')}>
                <Video aria-hidden className="size-5" /> Start session
              </Link>
              <Link to={`/session/${firstEnabled.id}?mode=manual`} className="mt-1.5 flex min-h-10 w-full items-center justify-center font-bold underline decoration-1 underline-offset-4 hover:text-accent-strong">
                Log without camera
              </Link>
            </>
          ) : (
            <LinkButton to="/plan" className="w-full">
              Set up your plan
            </LinkButton>
          )}
        </section>

        <Section title={<>Last check-in {view.lastCheckIn ? <span className="font-normal text-ink-2">· {view.lastCheckIn.kind === 'pre' ? 'before session' : view.lastCheckIn.kind === 'post' ? 'after session' : 'between sessions'}, {formatDate(dateKey(new Date(view.lastCheckIn.timestamp)), { month: 'short', day: 'numeric' })}</span> : null}</>}>
          {view.lastCheckIn ? (
            <dl className="divide-y divide-rule border-b border-rule">
              {[
                ['Discomfort', numericResponse(view.lastCheckIn, 'pain')],
                ['Fatigue', numericResponse(view.lastCheckIn, 'fatigue')],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between py-2">
                  <dt className="text-ink-2">{k}</dt>
                  <dd className="num font-bold">{v === null ? 'not answered' : `${v}/10`}</dd>
                </div>
              ))}
              <div className="flex justify-between py-2">
                <dt className="text-ink-2">Change</dt>
                <dd className="font-bold">{changeText(responseValue(view.lastCheckIn, 'symptom-change'))}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-ink-2">No check-ins yet. They take under a minute and help you tell your clinician how sessions felt.</p>
          )}
          <Link to="/checkin" className="mt-3 inline-flex items-center gap-1.5 font-bold text-accent-strong underline-offset-4 hover:underline">
            <Plus aria-hidden className="size-4" /> New check-in
          </Link>
        </Section>

        <Section title="Tracking quality, last session">
          {view.latest && view.latest.quality ? (
            <>
              <p className="mb-2">
                <span className="num mr-1.5 text-[1.4rem] font-bold">{Math.round(view.latest.quality.reliable * 100)}%</span>reliable frames
              </p>
              <RepStrip reps={view.latest.reps.map((r) => ({ index: r.index, reliable: r.validity === 'reliable' }))} />
              <p className="mt-1.5 text-ink-2">
                {(() => {
                  const ex = view.latest.reps.filter((r) => r.validity !== 'reliable');
                  return ex.length ? `${ex.length} of ${view.latest.reps.length} reps excluded (tracking uncertain)` : `All ${view.latest.reps.length} reps tracked reliably`;
                })()}
                {view.latest.mode === 'simulated' ? ' · simulated' : ''}
              </p>
            </>
          ) : (
            <p className="text-ink-2">Shown after your first camera session.</p>
          )}
        </Section>
      </aside>
    </div>
  );
}

function changeText(v: unknown): string {
  const map: Record<string, string> = { none: 'No discomfort', better: 'Better', same: 'About the same', worse: 'Worse', new: 'Something new', no: 'No change', unsure: 'Not sure' };
  return typeof v === 'string' ? (map[v] ?? v) : 'not answered';
}

function weekCells(days: ScheduledDay[], start: string, today: string) {
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDays(start, i);
    const d = days.find((x) => x.date === key);
    let status: DayCellStatus = 'off';
    let detail: string | undefined;
    if (d) {
      status = d.status === 'completed' ? 'done' : d.status === 'partial' ? 'partial' : d.status === 'missed' ? 'missed' : d.status === 'skipped' ? 'skipped' : d.status === 'unavailable' ? 'unavailable' : d.status === 'today' ? 'today' : 'upcoming';
      if (d.status === 'partial') detail = `${d.completedExercises} of ${d.plannedExercises}`;
      if (d.status === 'today' || (key === today && d.status === 'upcoming')) {
        status = 'today';
        detail = formatTime(d.time);
      }
    }
    return { key, weekday: WEEKDAY_SHORT[i] as string, status, detail, label: formatDate(key, { weekday: 'long', month: 'short', day: 'numeric' }) };
  });
}
