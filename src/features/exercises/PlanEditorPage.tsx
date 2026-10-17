import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PrescribedExercise } from '@/lib/validation/schemas';
import { useAppData } from '@/app/AppData';
import { addPlanVersion } from '@/lib/storage/repositories';
import { ExercisePicker, PrescriptionCard, newPrescription, validatePrescription } from './PrescriptionEditor';
import { Button, CheckboxRow, Field, LinkButton, Notice, PageHeader, Section, TextArea, TextInput } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { diffPlans } from './describe';

/**
 * Updates the plan from new clinician instructions. Saving always creates a
 * new version with who approved it and when; earlier versions are kept.
 */
export function PlanEditorPage() {
  const { plan } = useAppData();
  const navigate = useNavigate();
  const toast = useToast();
  const fromDemo = plan?.kind === 'demonstration';
  const [exercises, setExercises] = useState<PrescribedExercise[]>(() => (fromDemo ? [] : (plan?.exercises ?? [])));
  const [authorizedBy, setAuthorizedBy] = useState(fromDemo ? '' : (plan?.authorizedBy ?? ''));
  const [date, setDate] = useState(fromDemo ? '' : (plan?.authorizationDate ?? ''));
  const [restrictions, setRestrictions] = useState(plan?.restrictions ?? '');
  const [summary, setSummary] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!plan) return null;

  const invalid = exercises.length === 0 || exercises.some((e) => Object.keys(validatePrescription(e)).length > 0);

  const save = async () => {
    setShowErrors(true);
    setError(null);
    if (invalid) {
      setError(exercises.length === 0 ? 'Add at least one exercise from your clinician’s instructions.' : 'Fix the highlighted values first.');
      return;
    }
    if (!confirmed) {
      setError('Confirm that these values come from your clinician’s instructions.');
      return;
    }
    setSaving(true);
    try {
      const next = {
        kind: 'clinician-entered' as const,
        status: 'active' as const,
        authorizedBy: authorizedBy.trim(),
        authorizationDate: date || null,
        restrictions: restrictions.trim(),
        exercises,
        changeSource: 'clinician-update' as const,
        changeSummary: summary.trim() || 'Updated from clinician instructions',
      };
      const saved = await addPlanVersion(next);
      const changes = diffPlans(plan, saved);
      toast.show(`Plan saved as version ${saved.version}. ${changes.length} change${changes.length === 1 ? '' : 's'} recorded.`);
      navigate('/plan');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader title={fromDemo ? 'Enter your clinician’s plan' : 'Update your plan'} description="Enter the exercises and numbers exactly as your clinician gave them. PocketRehab never suggests or changes treatment values; saving creates a new version and keeps the old one." />
      <div className="space-y-10">
        <Section title="Exercises">
          <p className="mb-4 max-w-[62ch] text-ink-2">Add each exercise from your instructions that PocketRehab supports. Add the same exercise twice for left and right sides.</p>
          <ExercisePicker selected={exercises.map((e) => e.exerciseId)} onAdd={(id) => setExercises((xs) => [...xs, newPrescription(id)])} />
          <div className="mt-6 space-y-4">
            {exercises.map((ex, i) => (
              <div key={ex.id} className="space-y-2">
                <PrescriptionCard value={ex} showErrors={showErrors} onChange={(v) => setExercises((xs) => xs.map((x, j) => (j === i ? v : x)))} onRemove={() => setExercises((xs) => xs.filter((_, j) => j !== i))} />
                <CheckboxRow checked={!ex.enabled} onChange={(paused) => setExercises((xs) => xs.map((x, j) => (j === i ? { ...x, enabled: !paused } : x)))} label="Pause this exercise (keep it in the plan but don’t schedule it)" />
              </div>
            ))}
          </div>
        </Section>
        <Section title="Approval">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Who gave or approved these instructions?" htmlFor="pe-auth" optional help="For example “Dr. Lee, PT”.">
              <TextInput id="pe-auth" maxLength={200} value={authorizedBy} onChange={(e) => setAuthorizedBy(e.target.value)} />
            </Field>
            <Field label="Date of the instructions" htmlFor="pe-date" optional>
              <TextInput id="pe-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
        </Section>
        <Section title="Restrictions">
          <Field label="Restrictions or precautions from your clinician" htmlFor="pe-restr" optional>
            <TextArea id="pe-restr" rows={4} maxLength={2000} value={restrictions} onChange={(e) => setRestrictions(e.target.value)} />
          </Field>
        </Section>
        <Section title="What changed">
          <Field label="Short note for the plan history" htmlFor="pe-sum" optional help="For example “PT increased reps after 10/14 visit”.">
            <TextInput id="pe-sum" maxLength={500} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          <div className="mt-4">
            <CheckboxRow checked={confirmed} onChange={setConfirmed} label="These exercises and values come from my clinician’s instructions." />
          </div>
        </Section>
        {error ? <Notice tone="alert" role="alert" title="Can’t save yet">{error}</Notice> : null}
        <div className="flex flex-wrap gap-2 border-t border-ink pt-5">
          <Button size="lg" onClick={save} loading={saving}>
            Save as version {plan.version + 1}
          </Button>
          <LinkButton to="/plan" size="lg" variant="secondary">
            Cancel
          </LinkButton>
        </div>
      </div>
    </div>
  );
}
