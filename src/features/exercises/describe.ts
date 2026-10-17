import type { Plan, PrescribedExercise, TargetRange } from '@/lib/validation/schemas';
import { EXERCISES } from './library';

export function describePrescription(e: Pick<PrescribedExercise, 'sets' | 'reps' | 'holdSeconds' | 'restSeconds'>): string {
  const parts = [`${e.sets} ${e.sets === 1 ? 'set' : 'sets'} × ${e.reps} reps`];
  if (e.holdSeconds > 0) parts.push(`hold ${e.holdSeconds} s`);
  if (e.restSeconds > 0 && e.sets > 1) parts.push(`rest ${e.restSeconds} s between sets`);
  return parts.join(' · ');
}

export function describeTarget(t: TargetRange | null): string {
  if (!t) return 'No target set';
  const src = t.source === 'clinician' ? 'from your clinician' : 'demo example, not a clinical target';
  return `${t.min}°–${t.max}° (${src})`;
}

export function sideLabel(side: PrescribedExercise['side']): string {
  return side === 'auto' ? 'Side facing camera' : side === 'left' ? 'Left side' : 'Right side';
}

export function planKindLabel(plan: Pick<Plan, 'kind'>): string {
  return plan.kind === 'demonstration' ? 'Demonstration plan' : 'Plan entered from clinician instructions';
}

/** Creates the clearly labeled demonstration plan used when no clinician plan exists. */
export function demonstrationExercises(): PrescribedExercise[] {
  return Object.values(EXERCISES).map((def) => ({
    id: `demo-${def.id}`,
    exerciseId: def.id,
    side: def.sideMode === 'auto' ? 'auto' : 'right',
    sets: def.demoPrescription.sets,
    reps: def.demoPrescription.reps,
    holdSeconds: def.demoPrescription.holdSeconds,
    restSeconds: def.demoPrescription.restSeconds,
    target: def.demoPrescription.target,
    cameraMeasurement: true,
    enabled: true,
    clinicianNotes: '',
    equipmentNote: '',
  }));
}

/** Describes what changed between two plan versions (for the plan history view). */
export function diffPlans(prev: Plan, next: Plan): string[] {
  const changes: string[] = [];
  if (prev.status !== next.status) changes.push(`Status: ${prev.status} → ${next.status}`);
  if (prev.authorizedBy !== next.authorizedBy) changes.push(`Approved by: “${prev.authorizedBy || 'not recorded'}” → “${next.authorizedBy || 'not recorded'}”`);
  if (prev.restrictions !== next.restrictions) changes.push('Restrictions were updated');
  if (prev.kind !== next.kind) changes.push(`Plan type: ${prev.kind} → ${next.kind}`);
  const byId = new Map(prev.exercises.map((e) => [e.id, e]));
  for (const e of next.exercises) {
    const old = byId.get(e.id);
    const name = `${EXERCISES[e.exerciseId].shortName} (${sideLabel(e.side).toLowerCase()})`;
    if (!old) {
      changes.push(`Added ${name}`);
      continue;
    }
    byId.delete(e.id);
    const fields: string[] = [];
    if (old.sets !== e.sets) fields.push(`sets ${old.sets} → ${e.sets}`);
    if (old.reps !== e.reps) fields.push(`reps ${old.reps} → ${e.reps}`);
    if (old.holdSeconds !== e.holdSeconds) fields.push(`hold ${old.holdSeconds} s → ${e.holdSeconds} s`);
    if (old.restSeconds !== e.restSeconds) fields.push(`rest ${old.restSeconds} s → ${e.restSeconds} s`);
    if (JSON.stringify(old.target) !== JSON.stringify(e.target)) fields.push(`target ${describeTarget(old.target)} → ${describeTarget(e.target)}`);
    if (old.side !== e.side) fields.push(`side ${old.side} → ${e.side}`);
    if (old.enabled !== e.enabled) fields.push(e.enabled ? 're-enabled' : 'disabled');
    if (old.cameraMeasurement !== e.cameraMeasurement) fields.push(e.cameraMeasurement ? 'camera measurement on' : 'camera measurement off');
    if (old.clinicianNotes !== e.clinicianNotes) fields.push('notes updated');
    if (fields.length) changes.push(`${name}: ${fields.join(', ')}`);
  }
  for (const e of byId.values()) changes.push(`Removed ${EXERCISES[e.exerciseId].shortName} (${sideLabel(e.side).toLowerCase()})`);
  return changes.length ? changes : ['No changes to prescribed parameters'];
}
