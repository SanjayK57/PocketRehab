import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Award } from 'lucide-react';
import type { BodySide, ExerciseId, Session } from '@/lib/validation/schemas';
import { useAppData } from '@/app/AppData';
import { useAllData } from '@/app/useData';
import { EXERCISES } from '@/features/exercises/library';
import { numericResponse } from '@/lib/safety/checkins';
import { addDays, dateKey, formatDate, todayKey, weekStart } from '@/lib/time/dates';
import { adherence, buildSchedule, countsTowardAdherence } from '@/features/scheduling/schedule';
import { BarChart, ChartFigure, Legend, LineChart } from '@/components/charts';
import { RangeStrips, TapeSwatch } from '@/components/tape';
import { ErrorState, KeyValue, LinkButton, LoadingBlock, PageHeader, Section, Select, cx } from '@/components/ui';
import { INSUFFICIENT_DATA_MESSAGE, PLATEAU_RULE_TEXT, interpretChange, isStable, measurableSessions, series, sideComparison } from './analysis';
import { achievements } from './weekly';
import { formatDuration } from '@/lib/time/dates';

export function ProgressTabs() {
  const tabs = [
    { to: '/progress', label: 'Overview', end: true },
    { to: '/progress/history', label: 'Session history' },
    { to: '/progress/compare', label: 'Compare sessions' },
    { to: '/progress/week', label: 'Weekly summary' },
    { to: '/progress/report', label: 'Report for my clinician' },
  ];
  return (
    <nav aria-label="Progress sections" className="-mt-4 mb-8 overflow-x-auto border-b border-rule">
      <ul className="flex min-w-max gap-1">
        {tabs.map((t) => (
          <li key={t.to}>
            <NavLink to={t.to} end={t.end} className={({ isActive }) => cx('-mb-px inline-flex min-h-11 items-center border-b-[3px] px-3 font-semibold transition-colors', isActive ? 'border-tape text-ink' : 'border-transparent text-ink-2 hover:text-ink')}>
              {t.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const shortDate = (t: number) => formatDate(dateKey(new Date(t)), { month: 'short', day: 'numeric' });

export function ProgressPage() {
  const { profile, plan } = useAppData();
  const data = useAllData();
  const includeSimulated = profile?.isDemo ?? false;
  const sessions = useMemo(() => (data.data?.sessions ?? []).filter((s) => includeSimulated || s.mode !== 'simulated'), [data.data, includeSimulated]);
  const measured = useMemo(() => measurableSessions(sessions, { includeSimulated }), [sessions, includeSimulated]);
  const combos = useMemo(() => {
    const seen = new Map<string, { exerciseId: ExerciseId; side: BodySide; last: number }>();
    sessions
      .filter((s) => s.mode !== 'manual' && s.reps.length > 0)
      .forEach((s) => {
        const k = `${s.exerciseId}|${s.side}`;
        const cur = seen.get(k);
        if (!cur || cur.last < s.startedAt) seen.set(k, { exerciseId: s.exerciseId, side: s.side, last: s.startedAt });
      });
    return [...seen.values()].sort((a, b) => b.last - a.last);
  }, [sessions]);
  const [pick, setPick] = useState<string | null>(null);
  const selected = combos.find((c) => `${c.exerciseId}|${c.side}` === pick) ?? combos[0] ?? null;

  if (!profile || !plan) return null;
  if (data.status === 'loading') return <LoadingBlock lines={8} />;
  if (data.status === 'error') return <ErrorState error={data.error} onRetry={data.reload} />;

  const header = (
    <>
      <PageHeader title="Progress" description="Everything here is calculated from sessions saved on this device. Camera angles are estimates; only reliable repetitions count." />
      <ProgressTabs />
    </>
  );

  if (sessions.length === 0) {
    return (
      <div>
        {header}
        <div className="max-w-[62ch] space-y-3 py-4">
          <h2 className="text-xl font-bold">No sessions yet</h2>
          <p className="text-ink-2">Your charts start after your first session. PocketRehab never fills these screens with example data for a real profile. If you just want to look around, you can explore the demo profile from Settings.</p>
          <LinkButton to="/session">Start a session</LinkButton>
        </div>
      </div>
    );
  }

  const today = todayKey();
  const def = selected ? EXERCISES[selected.exerciseId] : null;
  const group = selected ? sessions.filter((s) => s.exerciseId === selected.exerciseId && s.side === selected.side && s.mode !== 'manual' && s.reps.length > 0).sort((a, b) => a.startedAt - b.startedAt) : [];
  const peakPts = selected ? series(measured, selected.exerciseId, selected.side, 'peakMedian') : [];
  const durPts = selected ? series(measured, selected.exerciseId, selected.side, 'durationMedianMs') : [];
  const holdPts = selected && (plan.exercises.find((e) => e.exerciseId === selected.exerciseId)?.holdSeconds ?? 0) > 0 ? series(measured, selected.exerciseId, selected.side, 'holdMedianMs') : [];
  const latestValid = [...group].reverse().find((s) => s.summary?.valid) ?? null;
  const interp = interpretChange(peakPts);
  const target = group[group.length - 1]?.prescription.target ?? null;
  const sides = selected ? sideComparison(measured, selected.exerciseId) : null;

  // Weekly bars (last 8 weeks)
  const weeks = Array.from({ length: 8 }, (_, i) => weekStart(addDays(today, -7 * (7 - i))));
  const weekly = weeks.map((w) => {
    const days = buildSchedule(profile.schedule, data.data?.overrides ?? [], sessions, plan, w, addDays(w, 6) < today ? addDays(w, 6) : today, today, { includeSimulated });
    const done = sessions.filter((s) => countsTowardAdherence(s, includeSimulated)).filter((s) => {
      const k = dateKey(new Date(s.startedAt));
      return k >= w && k <= addDays(w, 6);
    }).length;
    return { w, done, adh: adherence(days).percent };
  });

  const checkIns = (data.data?.checkIns ?? []).filter((c) => includeSimulated || !c.isDemoData).sort((a, b) => a.timestamp - b.timestamp);
  const symptom = (q: string) => checkIns.map((c) => ({ x: c.timestamp, y: numericResponse(c, q), label: shortDate(c.timestamp) })).filter((p): p is { x: number; y: number; label: string } => p.y !== null);
  const pain = symptom('pain');
  const fatigue = symptom('fatigue');
  const camSessions = sessions.filter((s) => s.mode !== 'manual' && s.quality && s.status !== 'in-progress').sort((a, b) => a.startedAt - b.startedAt).slice(-12);
  const achieved = achievements(sessions, checkIns, buildSchedule(profile.schedule, data.data?.overrides ?? [], sessions, plan, addDays(today, -90), today, today, { includeSimulated }), includeSimulated);

  return (
    <div>
      {header}
      {selected && def ? (
        <div className="space-y-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <label htmlFor="pr-ex" className="mb-1 block font-semibold">
                Exercise
              </label>
              <Select id="pr-ex" className="w-auto min-w-72" value={`${selected.exerciseId}|${selected.side}`} onChange={(e) => setPick(e.target.value)}>
                {combos.map((c) => (
                  <option key={`${c.exerciseId}|${c.side}`} value={`${c.exerciseId}|${c.side}`}>
                    {EXERCISES[c.exerciseId].name} · {c.side}
                  </option>
                ))}
              </Select>
            </div>
            {includeSimulated ? <p className="text-sm text-signal-ink">Demo profile: these are simulated sessions.</p> : null}
          </div>

          <div className="grid gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Section title={`${def.shortName} · ${selected.side} · range per session`}>
              <ul className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-2">
                <li className="flex items-center gap-2">
                  <TapeSwatch kind="reliable" /> Reliable measurement
                </li>
                <li className="flex items-center gap-2">
                  <TapeSwatch kind="uncertain" /> Tracking uncertain, not used
                </li>
                {target ? (
                  <li className="flex items-center gap-2">
                    <TapeSwatch kind="target" /> {target.source === 'clinician' ? 'Clinician target' : 'Demo target'}
                  </li>
                ) : null}
              </ul>
              <figure>
                <RangeStrips
                  rows={group.slice(-10).map((s, i, arr) => ({ id: s.id, label: shortDate(s.startedAt), start: s.summary?.valid ? s.summary.startMedian : null, peak: s.summary?.valid ? s.summary.peakMedian : null, reliable: !!s.summary?.valid, emphasis: i === arr.length - 1, simulated: s.mode === 'simulated' }))}
                  target={target ? { min: target.min, max: target.max, label: `${target.min}–${target.max}°` } : null}
                  max={selected.exerciseId === 'shoulder-abduction' || selected.exerciseId === 'elbow-flexion' ? 160 : 180}
                />
                <figcaption className="mt-2 max-w-[70ch] text-ink-2">{interp.message}</figcaption>
              </figure>
              {isStable(peakPts) ? <p className="mt-2 max-w-[70ch] text-sm text-ink-2">Recent measurements have been stable. That can be worth discussing with your clinician. {PLATEAU_RULE_TEXT}</p> : null}
            </Section>

            <Section title="Movement fingerprint">
              {latestValid?.summary ? (
                <>
                  <p className="mb-2 text-sm text-ink-2">Latest reliable session, {shortDate(latestValid.startedAt)}. Medians of reliable repetitions.</p>
                  <KeyValue
                    items={[
                      { label: 'Peak angle', value: <span className="num">{latestValid.summary.peakMedian}°</span> },
                      { label: 'Range', value: <span className="num">{latestValid.summary.rangeMedian}°</span> },
                      { label: 'Repetition time', value: formatDuration(latestValid.summary.durationMedianMs) },
                      ...(latestValid.summary.holdMedianMs && latestValid.prescription.holdSeconds > 0 ? [{ label: 'Hold', value: formatDuration(latestValid.summary.holdMedianMs), hint: `prescribed ${latestValid.prescription.holdSeconds} s` }] : []),
                      { label: 'Speed changes per rep', value: latestValid.summary.speedPeaksMedian ?? '—' },
                      { label: 'Rep-to-rep variation', value: latestValid.summary.peakCv === null ? '—' : `${latestValid.summary.peakCv}%` },
                      { label: 'Reliable reps', value: `${latestValid.summary.validReps} of ${latestValid.reps.length}` },
                    ]}
                  />
                </>
              ) : (
                <p className="text-ink-2">{INSUFFICIENT_DATA_MESSAGE}</p>
              )}
              {sides && def.supportsSideComparison ? (
                <div className="mt-6">
                  <h3 className="mb-1 font-bold">Left and right</h3>
                  <p className="mb-2 text-sm text-ink-2">Latest reliable session for each side. Symmetry isn’t always expected; ask your clinician what to expect.</p>
                  <KeyValue
                    items={[
                      { label: `Left (${shortDate(sides.left.startedAt)})`, value: <span className="num">{sides.left.summary?.peakMedian}°</span> },
                      { label: `Right (${shortDate(sides.right.startedAt)})`, value: <span className="num">{sides.right.summary?.peakMedian}°</span> },
                    ]}
                  />
                </div>
              ) : null}
            </Section>
          </div>

          <div className="grid gap-x-12 gap-y-10 lg:grid-cols-2">
            <ChartFigure
              title="Peak angle over time"
              summary={peakPts.length === 0 ? INSUFFICIENT_DATA_MESSAGE : `${peakPts.length} reliable session${peakPts.length === 1 ? '' : 's'}, from ${Math.round(peakPts[0]?.value ?? 0)}° to ${Math.round(peakPts[peakPts.length - 1]?.value ?? 0)}°. ${interp.kind === 'insufficient' ? '' : 'Thick pale line is a 3-session rolling median (smoothed); dots are raw session medians.'}`}
              table={{ columns: ['Session', 'Peak (median)', 'Smoothed'], rows: peakPts.map((p) => [shortDate(p.t), `${p.value}°`, `${Math.round(p.smoothed * 10) / 10}°`]) }}
            >
              {peakPts.length ? <LineChart points={peakPts.map((p) => ({ x: p.t, y: p.value, label: shortDate(p.t) }))} smoothed={peakPts.length >= 3 ? peakPts.map((p) => ({ x: p.t, y: p.smoothed })) : undefined} band={target ? { min: target.min, max: target.max, label: target.source === 'clinician' ? 'clinician target' : 'demo target' } : null} yUnit="°" xFormat={shortDate} color="var(--color-tape)" /> : <EmptyChart />}
              {peakPts.length >= 3 ? <Legend items={[{ label: 'Session median (raw)', swatch: 'line' }, { label: 'Smoothed (3-session median)', swatch: 'smooth' }]} /> : null}
            </ChartFigure>
            <ChartFigure
              title="Repetition time"
              summary={durPts.length ? `Median time per repetition across ${durPts.length} reliable session${durPts.length === 1 ? '' : 's'}. Measured time, not the prescribed pace.` : INSUFFICIENT_DATA_MESSAGE}
              table={{ columns: ['Session', 'Rep time'], rows: durPts.map((p) => [shortDate(p.t), formatDuration(p.value)]) }}
            >
              {durPts.length ? <LineChart points={durPts.map((p) => ({ x: p.t, y: Math.round(p.value / 100) / 10, label: shortDate(p.t) }))} yUnit="s" xFormat={shortDate} color="var(--color-ink-2)" /> : <EmptyChart />}
            </ChartFigure>
            {holdPts.length ? (
              <ChartFigure title="Measured hold time" summary={`Measured time near the peak in each reliable session. Prescribed hold: ${plan.exercises.find((e) => e.exerciseId === selected.exerciseId)?.holdSeconds ?? 0} s.`} table={{ columns: ['Session', 'Hold'], rows: holdPts.map((p) => [shortDate(p.t), formatDuration(p.value)]) }}>
                <LineChart points={holdPts.map((p) => ({ x: p.t, y: Math.round(p.value / 100) / 10, label: shortDate(p.t) }))} yUnit="s" xFormat={shortDate} color="var(--color-ink-2)" />
              </ChartFigure>
            ) : null}
            <ChartFigure
              title="Tracking quality by session"
              summary={`Share of frames with reliable tracking in the last ${camSessions.length} camera session${camSessions.length === 1 ? '' : 's'}, all exercises.`}
              table={{ columns: ['Session', 'Exercise', 'Reliable frames'], rows: camSessions.map((s) => [shortDate(s.startedAt), EXERCISES[s.exerciseId].shortName, `${Math.round((s.quality?.reliable ?? 0) * 100)}%`]) }}
            >
              {camSessions.length ? <BarChart bars={camSessions.map((s) => ({ label: shortDate(s.startedAt), value: Math.round((s.quality?.reliable ?? 0) * 100), tone: s.summary?.valid ? 'accent' : 'warn' }))} yUnit="%" yMax={100} /> : <EmptyChart />}
            </ChartFigure>
          </div>
        </div>
      ) : (
        <p className="mb-10 max-w-[62ch] text-ink-2">No camera sessions yet, so there are no movement measurements. Manual logs still count toward your schedule.</p>
      )}

      <div className="mt-12 grid gap-x-12 gap-y-10 lg:grid-cols-2">
        <ChartFigure title="Sessions completed per week" summary={`Completed sessions in each of the last 8 weeks: ${weekly.map((w) => w.done).join(', ')}.`} table={{ columns: ['Week of', 'Sessions', 'Adherence'], rows: weekly.map((w) => [formatDate(w.w, { month: 'short', day: 'numeric' }), w.done, w.adh === null ? 'nothing due' : `${w.adh}%`]) }}>
          <BarChart bars={weekly.map((w) => ({ label: formatDate(w.w, { month: 'short', day: 'numeric' }), value: w.done }))} yUnit="" />
        </ChartFigure>
        <ChartFigure title="Adherence by week" summary="Fully completed scheduled days ÷ days that were due. Weeks with nothing due show n/a." table={{ columns: ['Week of', 'Adherence'], rows: weekly.map((w) => [formatDate(w.w, { month: 'short', day: 'numeric' }), w.adh === null ? 'n/a' : `${w.adh}%`]) }}>
          <BarChart bars={weekly.map((w) => ({ label: formatDate(w.w, { month: 'short', day: 'numeric' }), value: w.adh }))} yUnit="%" yMax={100} />
        </ChartFigure>
        <ChartFigure title="Self-reported discomfort and fatigue" summary={pain.length || fatigue.length ? `${checkIns.length} check-ins. These are your own 0–10 ratings, not measurements.` : 'No check-ins with ratings yet.'} table={{ columns: ['Date', 'Discomfort', 'Fatigue'], rows: checkIns.map((c) => [shortDate(c.timestamp), numericResponse(c, 'pain') ?? '—', numericResponse(c, 'fatigue') ?? '—']) }}>
          {pain.length ? <LineChart points={pain} yUnit="" yDomain={[0, 10]} xFormat={shortDate} color="var(--color-signal)" /> : <EmptyChart />}
          {pain.length ? <p className="mt-1 text-sm text-ink-2">Discomfort (0–10). Fatigue values are in the table view.</p> : null}
        </ChartFigure>
        <Section title="Milestones">
          <ul className="space-y-3">
            {achieved.map((a) => (
              <li key={a.id} className={cx('flex items-start gap-3', !a.earned && 'text-ink-3')}>
                <Award aria-hidden className={cx('mt-0.5 size-5 shrink-0', a.earned ? 'text-tape' : 'text-rule-strong')} />
                <span>
                  <span className={cx('block font-semibold', a.earned && 'text-ink')}>
                    {a.title} <span className="sr-only">{a.earned ? '(earned)' : '(not yet)'}</span>
                  </span>
                  <span className="text-sm">
                    {a.description} · {a.progress}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink-3">Milestones celebrate showing up, not recovery. There are no streaks to lose.</p>
        </Section>
      </div>
    </div>
  );
}

function EmptyChart() {
  return <p className="py-10 text-center text-ink-3">Not enough data yet</p>;
}

export function sessionLabel(s: Session): string {
  return `${shortDate(s.startedAt)} · ${EXERCISES[s.exerciseId].shortName} · ${s.side}${s.mode === 'simulated' ? ' (simulated)' : s.mode === 'manual' ? ' (manual)' : ''}`;
}
