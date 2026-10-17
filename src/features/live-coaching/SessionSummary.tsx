import { useMemo } from 'react';
import type { ExerciseDefinition } from '@/types/exercise';
import type { Preferences, Session } from '@/lib/validation/schemas';
import { INCOMPLETE_REASON_TEXT } from '@/types/exercise';
import { useLiveQuery } from '@/lib/storage/useLiveQuery';
import { listSessions } from '@/lib/storage/repositories';
import { compareSessions } from '@/features/analytics/analysis';
import { formatDuration } from '@/lib/time/dates';
import { useAppData } from '@/app/AppData';
import { Button, KeyValue, LinkButton, Notice, PageHeader, QualityBadge, Section } from '@/components/ui';
import { RepStrip } from '@/components/tape';
import { RepTable } from '@/features/session-history/RepTable';

/** Results of the session that just ended, built only from what was saved. */
export function SessionSummary({ session, def, coachingAnswer, onApplyCoaching }: { session: Session | null; def: ExerciseDefinition; coachingAnswer: string | null; onApplyCoaching: (patch: Partial<Preferences>) => Promise<void> }) {
  const { profile } = useAppData();
  const all = useLiveQuery(listSessions);
  const previous = useMemo(() => {
    if (!session || !all.data) return null;
    return all.data.find((s) => s.id !== session.id && s.exerciseId === session.exerciseId && s.side === session.side && s.summary?.valid && s.mode === session.mode && s.startedAt < session.startedAt) ?? null;
  }, [all.data, session]);

  if (!session) {
    return (
      <div className="space-y-4">
        <PageHeader title="Summary unavailable" description="This session could not be saved, so there is nothing to summarise. Your earlier data is unaffected." />
        <LinkButton to="/">Back to Home</LinkButton>
      </div>
    );
  }

  const fp = session.summary;
  const prescribedTotal = session.prescription.sets * session.prescription.reps;
  const counted = session.mode === 'manual' ? (session.manualRepsReported ?? 0) : session.reps.length;
  const comparison = previous && fp?.valid ? compareSessions(previous, session) : null;
  const prefs = profile?.preferences;
  const suggestion =
    !prefs || !coachingAnswer
      ? null
      : coachingAnswer === 'too-much' && prefs.feedbackFrequency === 'every-rep'
        ? { text: 'You said there was too much spoken coaching. Switch to speaking only at key moments (set ends and tracking issues)?', patch: { feedbackFrequency: 'key-moments' as const } }
        : coachingAnswer === 'too-much' && prefs.coachingStyle !== 'minimal'
          ? { text: 'You said there was too much spoken coaching. Switch to the minimal coaching style?', patch: { coachingStyle: 'minimal' as const } }
          : coachingAnswer === 'too-little' && prefs.feedbackFrequency === 'key-moments'
            ? { text: 'You said there was too little coaching. Speak after every repetition again?', patch: { feedbackFrequency: 'every-rep' as const } }
            : coachingAnswer === 'too-little' && !prefs.voiceEnabled
              ? { text: 'You said there was too little coaching. Turn spoken coaching on?', patch: { voiceEnabled: true } }
              : null;

  return (
    <div className="space-y-9">
      <PageHeader
        title={`${def.name}: ${session.status === 'completed' ? 'completed' : session.status === 'interrupted' ? 'interrupted' : 'ended early'}`}
        description={session.mode === 'simulated' ? 'Simulated demo session. These numbers come from a simulated figure, not from you, and are not part of your progress.' : session.mode === 'manual' ? 'Logged without the camera. No movement measurements were made.' : 'Saved on this device.'}
        actions={
          <>
            <LinkButton to="/" variant="secondary">
              Done
            </LinkButton>
            <LinkButton to={`/progress/session/${session.id}`}>Session details</LinkButton>
          </>
        }
      />

      {suggestion ? (
        <Notice tone="info" title="Adjust your coaching?" actions={<Button size="sm" onClick={() => void onApplyCoaching(suggestion.patch)}>Yes, change it</Button>}>
          {suggestion.text} This only changes how PocketRehab talks to you, never your exercises.
        </Notice>
      ) : null}

      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
        <Section title="What you did">
          <KeyValue
            items={[
              { label: 'Repetitions counted', value: <span className="num">{counted} of {prescribedTotal}</span>, hint: session.mode === 'manual' ? 'As you reported' : 'Only movements that met the counting criteria' },
              { label: 'Sets completed', value: <span className="num">{session.setsCompleted} of {session.prescription.sets}</span> },
              ...(session.mode !== 'manual' ? [{ label: 'Movements not counted', value: <span className="num">{session.incompleteAttempts.length}</span> }] : []),
              { label: 'Duration', value: session.endedAt ? formatDuration(session.endedAt - session.startedAt) : '—' },
            ]}
          />
          {session.incompleteAttempts.length ? (
            <ul className="mt-3 space-y-1 text-sm text-ink-2">
              {Object.entries(
                session.incompleteAttempts.reduce<Record<string, number>>((acc, a) => ((acc[a.reason] = (acc[a.reason] ?? 0) + 1), acc), {}),
              ).map(([reason, n]) => (
                <li key={reason}>
                  {n} × {INCOMPLETE_REASON_TEXT[reason as keyof typeof INCOMPLETE_REASON_TEXT]}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>

        {session.mode !== 'manual' ? (
          <Section title="Measurement quality" actions={session.quality ? <QualityBadge state={session.quality.state} size="sm" /> : null}>
            {session.quality ? (
              <p className="mb-3">
                <span className="num text-2xl font-bold">{Math.round(session.quality.reliable * 100)}%</span> of frames had reliable tracking.
              </p>
            ) : null}
            {session.reps.length ? <RepStrip reps={session.reps.map((r) => ({ index: r.index, reliable: r.validity === 'reliable' }))} /> : <p className="text-ink-2">No repetitions were counted.</p>}
            {fp?.notes.map((n) => (
              <p key={n} className="mt-2 text-sm text-ink-2">
                {n}
              </p>
            ))}
            {session.camera && !session.camera.setupVerified && session.mode === 'camera' ? <p className="mt-2 text-sm text-warn">The camera setup checks were skipped, so treat these numbers with extra caution.</p> : null}
          </Section>
        ) : null}
      </div>

      {fp?.valid ? (
        <Section title="Movement fingerprint (camera estimates)" description="Medians of the reliable repetitions only. 2D camera angles are estimates, not clinical measurements.">
          <div className="grid gap-x-12 lg:grid-cols-2">
            <KeyValue
              items={[
                { label: def.metric.shortLabel + ' at peak', value: <span className="num">{fp.peakMedian}°</span>, hint: fp.peakMax !== null ? `highest ${fp.peakMax}°` : undefined },
                { label: 'Movement range', value: <span className="num">{fp.rangeMedian}°</span>, hint: `from ${fp.startMedian}° start` },
                { label: 'Reached target range', value: session.prescription.target ? <span className="num">{fp.targetMetCount} of {fp.validReps}</span> : 'No target set' },
                { label: 'Compensations flagged', value: Object.keys(fp.compensationCounts).length ? Object.entries(fp.compensationCounts).map(([k, v]) => `${def.compensationRules.find((r) => r.id === k)?.label ?? k}: ${v}`).join(', ') : 'None detected' },
              ]}
            />
            <KeyValue
              items={[
                { label: 'Repetition time', value: formatDuration(fp.durationMedianMs) },
                { label: 'Out / hold / back', value: `${formatDuration(fp.outboundMedianMs)} · ${formatDuration(fp.holdMedianMs)} · ${formatDuration(fp.returnMedianMs)}` },
                { label: 'Speed changes per rep', value: fp.speedPeaksMedian === null ? 'Not available' : <span className="num">{fp.speedPeaksMedian}</span>, hint: 'About 2 = one smooth movement out and back' },
                { label: 'Rep-to-rep variation', value: fp.peakCv === null ? 'Needs 3+ reliable reps' : <span className="num">{fp.peakCv}%</span>, hint: 'Of the peak angle' },
              ]}
            />
          </div>
        </Section>
      ) : session.mode !== 'manual' ? (
        <Notice tone="warn" title="Not enough reliable tracking for measurements">
          This session is saved, but it won’t be used for progress trends. Better lighting and keeping the whole movement in view usually help.
        </Notice>
      ) : null}

      {comparison ? (
        <Section title="Compared with your previous comparable session">
          {comparison.warnings.length ? (
            <ul className="mb-3 space-y-1 text-sm text-ink-2">
              {comparison.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <KeyValue
            items={comparison.rows
              .filter((r) => r.a !== null && r.b !== null && ['peakMedian', 'rangeMedian', 'durationMedianMs'].includes(r.key))
              .map((r) => ({ label: r.label, value: <span className="num">{`${r.b}${r.unit === 's' ? ' s' : r.unit}`}</span>, hint: `previous ${r.a}${r.unit === 's' ? ' s' : r.unit} · difference ${r.diff !== null && r.diff > 0 ? '+' : ''}${r.diff}${r.unit === 's' ? ' s' : r.unit}` }))}
          />
        </Section>
      ) : null}

      {session.reps.length ? (
        <Section title="Repetition by repetition">
          <RepTable session={session} def={def} />
        </Section>
      ) : null}
    </div>
  );
}
