import { useState } from 'react';
import type { CheckIn } from '@/lib/validation/schemas';
import { QUESTIONNAIRE_VERSION, evaluateSafety, responsesToArray, type Question, type Responses, type SafetyOutcome } from '@/lib/safety/checkins';
import { newId, saveCheckIn } from '@/lib/storage/repositories';
import { Button, CheckboxRow, ChoiceGroup, Notice, Scale, TextArea } from '@/components/ui';

/**
 * Short, skippable symptom check-in. Every question is optional. The result
 * is evaluated by the deterministic safety rules, never by free-form text.
 */
export function CheckInForm({
  kind,
  questions,
  sessionId,
  isDemoData,
  cameraSession,
  submitLabel,
  onDone,
  onSkip,
}: {
  kind: CheckIn['kind'];
  questions: Question[];
  sessionId: string | null;
  isDemoData: boolean;
  cameraSession?: boolean;
  submitLabel: string;
  onDone: (result: { checkIn: CheckIn; outcome: SafetyOutcome; responses: Responses }) => void;
  onSkip?: () => void;
}) {
  const [responses, setResponses] = useState<Responses>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (id: string, v: Responses[string]) => setResponses((r) => ({ ...r, [id]: v }));
  const visible = questions.filter((q) => !q.cameraOnly || cameraSession);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const outcome = evaluateSafety(responses);
    const checkIn: CheckIn = {
      id: newId('ci'),
      kind,
      sessionId,
      timestamp: Date.now(),
      questionnaireVersion: QUESTIONNAIRE_VERSION,
      responses: responsesToArray(responses),
      outcome: outcome.level,
      isDemoData,
    };
    try {
      await saveCheckIn(checkIn);
      onDone({ checkIn, outcome, responses });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <form
      className="max-w-2xl space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {visible.map((q) => (
        <QuestionField key={q.id} q={q} value={responses[q.id]} onChange={(v) => set(q.id, v)} />
      ))}
      {error ? <Notice tone="alert" title="Couldn’t save your check-in">{error}</Notice> : null}
      <div className="flex flex-wrap gap-2 border-t border-ink pt-5">
        <Button type="submit" size="lg" loading={saving}>
          {submitLabel}
        </Button>
        {onSkip ? (
          <Button variant="quiet" size="lg" onClick={onSkip}>
            Skip check-in
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-ink-3">These are your own ratings. They are not a medical assessment, and PocketRehab can’t tell what causes any symptom.</p>
    </form>
  );
}

function QuestionField({ q, value, onChange }: { q: Question; value: Responses[string]; onChange: (v: Responses[string]) => void }) {
  if (q.type === 'scale') {
    return <Scale id={`q-${q.id}`} label={q.label} value={typeof value === 'number' ? value : null} onChange={onChange} minLabel={q.minLabel ?? String(q.min)} maxLabel={q.maxLabel ?? String(q.max)} min={q.min} max={q.max} />;
  }
  if (q.type === 'choice') {
    return (
      <ChoiceGroup
        name={q.id}
        legend={
          <>
            {q.label} <span className="text-sm font-normal text-ink-3">Optional</span>
          </>
        }
        columns={q.options && q.options.length > 3 ? 2 : 3}
        value={typeof value === 'string' ? value : null}
        onChange={onChange}
        options={(q.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
      />
    );
  }
  if (q.type === 'multi') {
    const list = Array.isArray(value) ? value : [];
    return (
      <fieldset className="rounded-[var(--radius-card)] border border-ink/25 p-4">
        <legend className="px-1 font-semibold">{q.label}</legend>
        {q.help ? <p className="mb-2 text-sm text-ink-2">{q.help}</p> : null}
        {(q.options ?? []).map((o) => (
          <CheckboxRow key={o.value} checked={list.includes(o.value)} onChange={(on) => onChange(on ? [...list, o.value] : list.filter((x) => x !== o.value))} label={o.label} />
        ))}
      </fieldset>
    );
  }
  return (
    <div className="space-y-1.5">
      <label htmlFor={`q-${q.id}`} className="block font-semibold">
        {q.label} <span className="text-sm font-normal text-ink-3">Optional</span>
      </label>
      <TextArea id={`q-${q.id}`} rows={3} maxLength={500} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
