import { useId } from 'react';
import { Trash2 } from 'lucide-react';
import type { ExerciseId, PrescribedExercise } from '@/lib/validation/schemas';
import { EXERCISES, EXERCISE_LIST } from './library';
import { Button, CheckboxRow, Select, TextArea, TextInput, cx } from '@/components/ui';

/**
 * Editor for clinician-provided exercise parameters. Values are entered by the
 * user from their clinician's instructions; PocketRehab never suggests numbers
 * here. Targets are optional and always labelled as coming from the clinician.
 */

export function newPrescription(exerciseId: ExerciseId): PrescribedExercise {
  const def = EXERCISES[exerciseId];
  return {
    id: `ex_${exerciseId}_${Math.random().toString(36).slice(2, 8)}`,
    exerciseId,
    side: def.sideMode === 'auto' ? 'auto' : 'right',
    sets: 1,
    reps: 5,
    holdSeconds: 0,
    restSeconds: 30,
    target: null,
    cameraMeasurement: true,
    enabled: true,
    clinicianNotes: '',
    equipmentNote: '',
  };
}

export function validatePrescription(e: PrescribedExercise): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!Number.isInteger(e.sets) || e.sets < 1 || e.sets > 10) errors.sets = 'Enter 1–10 sets.';
  if (!Number.isInteger(e.reps) || e.reps < 1 || e.reps > 50) errors.reps = 'Enter 1–50 repetitions.';
  if (!(e.holdSeconds >= 0 && e.holdSeconds <= 120)) errors.hold = 'Enter 0–120 seconds.';
  if (!(e.restSeconds >= 0 && e.restSeconds <= 600)) errors.rest = 'Enter 0–600 seconds.';
  if (e.target) {
    if (!(e.target.min >= 0 && e.target.max <= 180)) errors.target = 'Angles must be between 0° and 180°.';
    else if (e.target.min > e.target.max) errors.target = 'The lower angle must not be above the upper angle.';
  }
  return errors;
}

function NumberField({ label, value, onChange, min, max, suffix, error, id }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; suffix?: string; error?: string; id: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <TextInput
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={Number.isFinite(value) ? value : ''}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(ev) => onChange(ev.target.value === '' ? Number.NaN : Number(ev.target.value))}
          className="num w-24"
        />
        {suffix ? <span className="text-sm text-ink-2">{suffix}</span> : null}
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-sm font-semibold text-alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function PrescriptionCard({ value, onChange, onRemove, showErrors }: { value: PrescribedExercise; onChange: (v: PrescribedExercise) => void; onRemove?: () => void; showErrors: boolean }) {
  const def = EXERCISES[value.exerciseId];
  const id = useId();
  const errors = showErrors ? validatePrescription(value) : {};
  const set = (patch: Partial<PrescribedExercise>) => onChange({ ...value, ...patch });
  return (
    <fieldset className={cx('rounded-[var(--radius-card)] border border-rule bg-surface p-4 sm:p-5', !value.enabled && 'opacity-75')}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <legend className="contents">
          <span className="block text-lg font-bold">{def.name}</span>
        </legend>
        {onRemove ? (
          <Button variant="quiet" size="sm" icon={<Trash2 aria-hidden className="size-4" />} onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1">
          <label htmlFor={`${id}-side`} className="block text-sm font-semibold">
            Side
          </label>
          {def.sideMode === 'auto' ? (
            <p id={`${id}-side`} className="py-2.5 text-ink-2">
              Side facing the camera
            </p>
          ) : (
            <Select id={`${id}-side`} value={value.side} onChange={(e) => set({ side: e.target.value as PrescribedExercise['side'] })}>
              <option value="right">Right</option>
              <option value="left">Left</option>
            </Select>
          )}
        </div>
        <NumberField id={`${id}-sets`} label="Sets" value={value.sets} min={1} max={10} onChange={(v) => set({ sets: v })} error={errors.sets} />
        <NumberField id={`${id}-reps`} label="Reps per set" value={value.reps} min={1} max={50} onChange={(v) => set({ reps: v })} error={errors.reps} />
        <NumberField id={`${id}-hold`} label="Hold" value={value.holdSeconds} min={0} max={120} suffix="s" onChange={(v) => set({ holdSeconds: v })} error={errors.hold} />
        <NumberField id={`${id}-rest`} label="Rest between sets" value={value.restSeconds} min={0} max={600} suffix="s" onChange={(v) => set({ restSeconds: v })} error={errors.rest} />
      </div>

      <div className="mt-4 space-y-2 border-t border-rule pt-4">
        <CheckboxRow
          checked={value.target !== null}
          onChange={(on) => set({ target: on ? { min: def.demoPrescription.target.min, max: def.demoPrescription.target.max, source: 'clinician' } : null })}
          label="My clinician gave me a target angle range"
          description="Only add this if your clinician told you a range. PocketRehab uses it to compare camera estimates, never to push you further."
        />
        {value.target ? (
          <div className="flex flex-wrap items-end gap-4 pl-7">
            <NumberField id={`${id}-tmin`} label="From" value={value.target.min} min={0} max={180} suffix="°" onChange={(v) => set({ target: { ...(value.target as NonNullable<typeof value.target>), min: v, source: 'clinician' } })} />
            <NumberField id={`${id}-tmax`} label="To" value={value.target.max} min={0} max={180} suffix="°" onChange={(v) => set({ target: { ...(value.target as NonNullable<typeof value.target>), max: v, source: 'clinician' } })} />
            {errors.target ? <p className="pb-2 text-sm font-semibold text-alert">{errors.target}</p> : null}
            <p className="w-full text-sm text-ink-2">Measured as: {def.metric.description}</p>
          </div>
        ) : null}
        <CheckboxRow checked={value.cameraMeasurement} onChange={(v) => set({ cameraMeasurement: v })} label="Measure with the camera" description={`Needs a ${def.cameraView} view. Turn off to log this exercise without the camera.`} />
      </div>

      <div className="mt-3 space-y-1">
        <label htmlFor={`${id}-notes`} className="block text-sm font-semibold">
          Clinician’s notes for this exercise <span className="font-normal text-ink-3">Optional</span>
        </label>
        <TextArea id={`${id}-notes`} rows={2} maxLength={1000} value={value.clinicianNotes} onChange={(e) => set({ clinicianNotes: e.target.value })} placeholder="For example: keep the thumb pointing up" />
      </div>
    </fieldset>
  );
}

export function ExercisePicker({ selected, onAdd }: { selected: ExerciseId[]; onAdd: (id: ExerciseId) => void }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {EXERCISE_LIST.map((def) => {
        const count = selected.filter((s) => s === def.id).length;
        return (
          <li key={def.id}>
            <button
              type="button"
              onClick={() => onAdd(def.id)}
              className="flex min-h-14 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] border border-rule-strong bg-surface px-4 py-3 text-left transition-colors hover:border-ink-2"
            >
              <span>
                <span className="block font-semibold">{def.name}</span>
                <span className="block text-sm text-ink-2">
                  {def.bodyArea[0]?.toUpperCase()}
                  {def.bodyArea.slice(1)} · {def.cameraView} camera view
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-accent-strong">{count > 0 ? `Added ×${count} · add another side` : 'Add'}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
