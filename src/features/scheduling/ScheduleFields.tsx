import { useId } from 'react';
import type { ScheduleSettings } from '@/lib/validation/schemas';
import { WEEKDAY_LONG, WEEKDAY_SHORT } from '@/lib/time/dates';
import { Field, Select, TextInput, Toggle, cx } from '@/components/ui';

export function ScheduleFields({ value, onChange }: { value: ScheduleSettings; onChange: (v: ScheduleSettings) => void }) {
  const id = useId();
  const toggleDay = (d: number) => onChange({ ...value, days: value.days.includes(d) ? value.days.filter((x) => x !== d) : [...value.days, d].sort() });
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="font-semibold">Days</legend>
        <p className="text-sm text-ink-2">Match the days your clinician suggested.</p>
        <div className="mt-2 grid grid-cols-7 gap-1.5 sm:max-w-md">
          {WEEKDAY_SHORT.map((d, i) => {
            const on = value.days.includes(i);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={WEEKDAY_LONG[i]}
                onClick={() => toggleDay(i)}
                className={cx(
                  'min-h-12 rounded-[var(--radius-control)] border text-sm font-semibold transition-colors duration-150',
                  on ? 'border-accent bg-accent text-accent-ink' : 'border-rule-strong bg-surface text-ink hover:border-ink-2',
                )}
              >
                {d}
              </button>
            );
          })}
        </div>
      </fieldset>
      <Field label="Time" htmlFor={`${id}-time`}>
        <TextInput id={`${id}-time`} type="time" value={value.time} onChange={(e) => e.target.value && onChange({ ...value, time: e.target.value })} className="w-40" />
      </Field>
      <div className="border-t border-rule">
        <Toggle
          checked={value.remindersEnabled}
          onChange={(v) => onChange({ ...value, remindersEnabled: v })}
          label="Session reminders"
          description="Shown in PocketRehab while it’s open, plus a browser notification if you allow it in Settings. Browsers can’t run PocketRehab in the background, so add your schedule to your calendar for reminders when it’s closed."
        />
        {value.remindersEnabled ? (
          <Field label="Remind me" htmlFor={`${id}-lead`}>
            <Select id={`${id}-lead`} className="w-56" value={value.reminderMinutes} onChange={(e) => onChange({ ...value, reminderMinutes: Number(e.target.value) })}>
              {[0, 5, 10, 15, 30, 60, 120].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? 'At the session time' : `${m} minutes before`}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
    </div>
  );
}
