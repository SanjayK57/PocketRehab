import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { FrictionReason } from '@/lib/validation/schemas';
import { useAppData } from '@/app/AppData';
import { BETWEEN_SESSION_QUESTIONS, type SafetyOutcome } from '@/lib/safety/checkins';
import { newId, saveFrictionReport } from '@/lib/storage/repositories';
import { FRICTION_LABELS, FRICTION_SUGGESTIONS } from '@/features/analytics/weekly';
import { Button, CheckboxRow, Field, LinkButton, Notice, PageHeader, Section, TextArea } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { CheckInForm } from './CheckInForm';
import { SafetyStop } from './SafetyStop';
import { formatDate } from '@/lib/time/dates';

/** Between-session check-in and the optional "what got in the way" barrier report. */
export function CheckInPage() {
  const { profile, plan } = useAppData();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const barriersFirst = params.get('barriers') === '1';
  const date = params.get('date');
  const [tab, setTab] = useState<'symptoms' | 'barriers'>(barriersFirst ? 'barriers' : 'symptoms');
  const [outcome, setOutcome] = useState<SafetyOutcome | null>(null);
  const [reasons, setReasons] = useState<FrictionReason[]>([]);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState<FrictionReason[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!profile || !plan) return null;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Check-in" description="Record how things are going between sessions. It takes under a minute and everything is optional." />
      <div role="tablist" aria-label="Check-in type" className="mb-8 flex gap-1 border-b border-rule">
        {(
          [
            ['symptoms', 'How I’m feeling'],
            ['barriers', 'What got in the way'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px min-h-11 border-b-[3px] px-3 font-semibold ${tab === id ? 'border-tape text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'symptoms' ? (
        outcome ? (
          outcome.level === 'none' ? (
            <Notice tone="ok" title="Check-in saved" actions={<LinkButton to="/" size="sm">Back to Home</LinkButton>}>
              It will appear in your progress and reports.
            </Notice>
          ) : (
            <SafetyStop outcome={outcome} clinician={plan.authorizedBy} context="between" onExit={() => navigate('/')} />
          )
        ) : (
          <CheckInForm kind="between" questions={BETWEEN_SESSION_QUESTIONS} sessionId={null} isDemoData={profile.isDemo} submitLabel="Save check-in" onDone={({ outcome: o }) => setOutcome(o)} />
        )
      ) : submitted ? (
        <div className="space-y-6">
          <Notice tone="ok" title="Thanks, noted">
            These suggestions only change logistics like timing and setup. PocketRehab never adds exercise because a session was missed.
          </Notice>
          <Section title="Ideas that might help">
            <ul className="space-y-3">
              {submitted.map((r) => (
                <li key={r}>
                  <span className="font-semibold">{FRICTION_LABELS[r]}:</span> <span className="text-ink-2">{FRICTION_SUGGESTIONS[r]}</span>
                </li>
              ))}
            </ul>
          </Section>
          <div className="flex flex-wrap gap-2">
            <LinkButton to="/plan/schedule">Open schedule</LinkButton>
            <LinkButton to="/" variant="secondary">
              Back to Home
            </LinkButton>
          </div>
        </div>
      ) : (
        <form
          className="space-y-6"
          onSubmit={async (e) => {
            e.preventDefault();
            if (reasons.length === 0) {
              setError('Pick at least one reason, or go back.');
              return;
            }
            try {
              await saveBarriers(reasons, note, date);
              setSubmitted(reasons);
              toast.show('Saved.');
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          <fieldset>
            <legend className="font-semibold">{date ? `What got in the way on ${formatDate(date, { weekday: 'long', month: 'short', day: 'numeric' })}?` : 'What has been getting in the way?'}</legend>
            <p className="mb-2 text-sm text-ink-2">No judgement. This helps you and your clinician plan around real life.</p>
            {(Object.keys(FRICTION_LABELS) as FrictionReason[]).map((r) => (
              <CheckboxRow key={r} checked={reasons.includes(r)} onChange={(on) => setReasons((xs) => (on ? [...xs, r] : xs.filter((x) => x !== r)))} label={FRICTION_LABELS[r]} />
            ))}
          </fieldset>
          <Field label="Anything else?" optional htmlFor="fr-note">
            <TextArea id="fr-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error ? <p role="alert" className="text-sm font-semibold text-alert">{error}</p> : null}
          <Button type="submit" size="lg">
            Save
          </Button>
        </form>
      )}
    </div>
  );
}

async function saveBarriers(reasons: FrictionReason[], note: string, date: string | null): Promise<void> {
  await saveFrictionReport({ id: newId('fr'), timestamp: Date.now(), date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, reasons, note: note.trim() });
}
