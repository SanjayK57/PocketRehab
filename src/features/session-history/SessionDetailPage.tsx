import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { useLiveQuery } from '@/lib/storage/useLiveQuery';
import { deleteSession, getSession, listCheckIns } from '@/lib/storage/repositories';
import { EXERCISES } from '@/features/exercises/library';
import { INCOMPLETE_REASON_TEXT } from '@/types/exercise';
import { formatDateTime, formatDuration } from '@/lib/time/dates';
import { numericResponse, responseValue } from '@/lib/safety/checkins';
import { Button, ErrorState, KeyValue, LinkButton, LoadingBlock, Notice, PageHeader, QualityBadge, Section, Tag } from '@/components/ui';
import { ConfirmDialog } from '@/components/Dialog';
import { RepStrip } from '@/components/tape';
import { useToast } from '@/components/Toast';
import { RepTable } from './RepTable';

/** A saved session's full timeline: repetitions, quality flags, feedback events and check-ins. */
export function SessionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const q = useLiveQuery(async () => {
    const [session, checkIns] = await Promise.all([getSession(id ?? ''), listCheckIns()]);
    return { session, checkIns: checkIns.filter((c) => c.sessionId === id) };
  }, [id]);

  if (q.status === 'loading') return <LoadingBlock />;
  if (q.status === 'error') return <ErrorState error={q.error} onRetry={q.reload} />;
  const s = q.data.session;
  if (!s) {
    return (
      <div className="space-y-4">
        <PageHeader title="Session not found" description="It may have been deleted." />
        <LinkButton to="/progress/history">All sessions</LinkButton>
      </div>
    );
  }
  const def = EXERCISES[s.exerciseId];
  const fp = s.summary;

  return (
    <div className="space-y-10">
      <PageHeader
        title={`${def.name} · ${s.side}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {formatDateTime(s.startedAt)}
            <Tag tone={s.status === 'completed' ? 'ok' : 'warn'}>{s.status.replace('-', ' ')}</Tag>
            {s.mode === 'simulated' ? <Tag tone="signal">Simulated demo · not your data</Tag> : s.mode === 'manual' ? <Tag>Manual log</Tag> : <Tag tone="accent">Camera</Tag>}
          </span>
        }
        actions={
          <>
            <LinkButton to="/progress/history" variant="secondary">
              All sessions
            </LinkButton>
            <Button variant="quiet" icon={<Trash2 aria-hidden className="size-4" />} onClick={() => setConfirm(true)}>
              Delete
            </Button>
          </>
        }
      />

      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
        <Section title="Summary">
          <KeyValue
            items={[
              { label: 'Repetitions counted', value: s.mode === 'manual' ? `${s.manualRepsReported ?? 0} (reported)` : `${s.reps.length} of ${s.prescription.sets * s.prescription.reps}` },
              { label: 'Sets completed', value: `${s.setsCompleted} of ${s.prescription.sets}` },
              { label: 'Duration', value: s.endedAt ? formatDuration(s.endedAt - s.startedAt) : '—' },
              { label: 'Plan version', value: `v${s.planVersion} (${s.planKind === 'demonstration' ? 'demonstration' : 'clinician-entered'})` },
              { label: 'Exercise definition', value: `v${s.exerciseVersion}` },
            ]}
          />
          {s.notes ? <p className="mt-3">Notes: {s.notes}</p> : null}
        </Section>
        {s.mode !== 'manual' ? (
          <Section title="Measurement quality" actions={s.quality ? <QualityBadge state={s.quality.state} size="sm" /> : null}>
            {s.quality ? (
              <KeyValue
                items={[
                  { label: 'Frames analysed', value: <span className="num">{s.quality.frames}</span> },
                  { label: 'Reliable / uncertain / unavailable', value: <span className="num">{Math.round(s.quality.reliable * 100)}% / {Math.round(s.quality.uncertain * 100)}% / {Math.round(s.quality.unavailable * 100)}%</span> },
                  { label: 'Camera setup checks', value: s.camera?.setupVerified ? 'Passed' : s.mode === 'simulated' ? 'Not applicable' : 'Skipped' },
                  { label: 'Camera view · image size', value: s.camera ? `${s.camera.view} · ${s.camera.width}×${s.camera.height}` : '—' },
                  { label: 'Tracking rate', value: s.camera?.medianFps ? `${s.camera.medianFps} fps · ${s.camera.delegate}` : '—' },
                ]}
              />
            ) : (
              <p className="text-ink-2">No quality data saved.</p>
            )}
            {s.reps.length ? (
              <div className="mt-3">
                <RepStrip reps={s.reps.map((r) => ({ index: r.index, reliable: r.validity === 'reliable' }))} />
              </div>
            ) : null}
          </Section>
        ) : null}
      </div>

      {fp ? (
        <Section title="Movement fingerprint" description={fp.valid ? 'Medians of the reliable repetitions. Camera estimates.' : undefined}>
          {fp.valid ? (
            <div className="grid gap-x-12 lg:grid-cols-2">
              <KeyValue
                items={[
                  { label: 'Peak angle', value: `${fp.peakMedian}°`, hint: `highest ${fp.peakMax}°` },
                  { label: 'Range', value: `${fp.rangeMedian}°`, hint: `from ${fp.startMedian}°` },
                  { label: 'Reached target', value: s.prescription.target ? `${fp.targetMetCount} of ${fp.validReps}` : 'No target' },
                ]}
              />
              <KeyValue
                items={[
                  { label: 'Repetition time', value: formatDuration(fp.durationMedianMs) },
                  { label: 'Rest between reps', value: formatDuration(fp.restMedianMs) },
                  { label: 'Speed changes per rep', value: fp.speedPeaksMedian ?? '—' },
                ]}
              />
            </div>
          ) : (
            <Notice tone="warn" title="Not used for progress">
              {fp.notes.join(' ')}
            </Notice>
          )}
        </Section>
      ) : null}

      {s.reps.length ? (
        <Section title="Repetition timeline">
          <RepTable session={s} def={def} />
        </Section>
      ) : null}

      {s.incompleteAttempts.length ? (
        <Section title="Movements not counted">
          <ul className="divide-y divide-rule">
            {s.incompleteAttempts.map((a, i) => (
              <li key={i} className="flex flex-wrap gap-x-4 py-2">
                <span className="num w-20 text-ink-2">{formatDuration(a.at)}</span>
                <span className="flex-1">{INCOMPLETE_REASON_TEXT[a.reason]}</span>
                {a.peakValue !== null ? <span className="num text-ink-2">peak {a.peakValue}°</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {s.events.length ? (
        <Section title="Coaching and feedback log">
          <ol className="max-h-80 divide-y divide-rule overflow-y-auto">
            {s.events.map((e, i) => (
              <li key={i} className="flex gap-4 py-1.5 text-sm">
                <span className="num w-16 shrink-0 text-ink-3">{formatDuration(e.t)}</span>
                <span>{e.message}</span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {q.data.checkIns.length ? (
        <Section title="Check-ins for this session">
          <ul className="space-y-2">
            {q.data.checkIns.map((c) => (
              <li key={c.id}>
                <span className="font-semibold">{c.kind === 'pre' ? 'Before' : 'After'}:</span> discomfort {numericResponse(c, 'pain') ?? '—'}/10, fatigue {numericResponse(c, 'fatigue') ?? '—'}/10, difficulty {numericResponse(c, 'difficulty') ?? '—'}/10
                {typeof responseValue(c, 'comment') === 'string' && responseValue(c, 'comment') ? <span className="block text-ink-2">“{String(responseValue(c, 'comment'))}”</span> : null}
                {c.outcome !== 'none' ? <Tag tone="warn" className="ml-2">{c.outcome === 'urgent' ? 'warning sign reported' : 'new or worse symptoms'}</Tag> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <p className="text-sm text-ink-3">PocketRehab doesn’t record video, so there’s no replay. This timeline shows what was measured and said during the session.</p>

      <ConfirmDialog
        open={confirm}
        onCancel={() => setConfirm(false)}
        title="Delete this session?"
        confirmLabel="Delete session"
        danger
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          await deleteSession(s.id);
          toast.show('Session deleted from this device.');
          navigate('/progress/history');
        }}
      >
        <p>This permanently removes the session and its check-ins from this device. It can’t be undone (unless you exported a backup).</p>
      </ConfirmDialog>
    </div>
  );
}
