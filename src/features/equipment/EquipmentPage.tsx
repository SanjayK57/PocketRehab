import { useAppData } from '@/app/AppData';
import { EXERCISES } from '@/features/exercises/library';
import { PlanTabs } from '@/features/exercises/PlanPage';
import { saveProfile } from '@/lib/storage/repositories';
import { CheckboxRow, Notice, PageHeader, Section } from '@/components/ui';

/**
 * Equipment checklist for the exercises in the current plan. Lists only what
 * the exercise definition needs or what the clinician noted. No shopping,
 * links or substitutions.
 */
export function EquipmentPage() {
  const { plan, profile } = useAppData();
  if (!plan || !profile) return null;
  const enabled = plan.exercises.filter((e) => e.enabled);
  const items = new Map<string, { name: string; note: string; required: boolean; exercises: string[] }>();
  for (const e of enabled) {
    for (const eq of EXERCISES[e.exerciseId].equipment) {
      const cur = items.get(eq.id) ?? { name: eq.name, note: eq.note, required: eq.required, exercises: [] };
      cur.exercises.push(EXERCISES[e.exerciseId].shortName);
      cur.required = cur.required || eq.required;
      items.set(eq.id, cur);
    }
  }
  const notes = enabled.filter((e) => e.equipmentNote.trim());
  const none = enabled.filter((e) => EXERCISES[e.exerciseId].equipment.length === 0 && !e.equipmentNote.trim());

  return (
    <div>
      <PageHeader title="My Plan" description="What your planned exercises need. Tick what you have. PocketRehab doesn’t sell or recommend products." />
      <PlanTabs />
      <div className="max-w-3xl space-y-10">
        <Section title="Checklist">
          {items.size === 0 ? (
            <p className="text-ink-2">Your current exercises don’t need any equipment as described.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {[...items.entries()].map(([id, it]) => (
                <li key={id} className="py-1">
                  <CheckboxRow
                    checked={!!profile.equipmentAvailable[id]}
                    onChange={(v) => void saveProfile({ ...profile, equipmentAvailable: { ...profile.equipmentAvailable, [id]: v } })}
                    label={`${it.name}${it.required ? '' : ' (only if your plan says so)'}`}
                    description={`${it.note} Used for: ${it.exercises.join(', ')}.`}
                  />
                </li>
              ))}
            </ul>
          )}
        </Section>
        {notes.length ? (
          <Section title="Notes from your clinician">
            <ul className="space-y-2">
              {notes.map((e) => (
                <li key={e.id}>
                  <span className="font-semibold">{EXERCISES[e.exerciseId].name}:</span> {e.equipmentNote}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        {none.length ? (
          <Section title="No equipment needed">
            <p className="text-ink-2">{none.map((e) => EXERCISES[e.exerciseId].name).join(', ')}.</p>
          </Section>
        ) : null}
        <Notice tone="neutral">Don’t substitute equipment or exercises without asking your clinician.</Notice>
      </div>
    </div>
  );
}
