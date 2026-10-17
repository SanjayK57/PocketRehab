import { Link } from 'react-router-dom';
import { Camera, ChevronRight, ClipboardPen } from 'lucide-react';
import { useAppData } from '@/app/AppData';
import { useAllData } from '@/app/useData';
import { EXERCISES } from '@/features/exercises/library';
import { describePrescription, sideLabel } from '@/features/exercises/describe';
import { DemoFigure } from '@/features/exercises/ExerciseDemo';
import { countsTowardAdherence } from '@/features/scheduling/schedule';
import { dateKey, todayKey } from '@/lib/time/dates';
import { LinkButton, Notice, PageHeader, Section, Tag } from '@/components/ui';

export function StartSessionPage() {
  const { plan, profile } = useAppData();
  const data = useAllData();
  if (!plan) return null;
  const today = todayKey();
  const doneToday = new Set((data.data?.sessions ?? []).filter((s) => countsTowardAdherence(s, profile?.isDemo) && dateKey(new Date(s.startedAt)) === today).map((s) => s.prescribedExerciseId));
  const enabled = plan.exercises.filter((e) => e.enabled);
  const paused = plan.exercises.filter((e) => !e.enabled);

  return (
    <div>
      <PageHeader title="Start a session" description="Pick an exercise from your plan. You’ll do a quick check-in first, then choose camera, simulated demo, or manual logging." />
      {plan.status === 'unavailable' ? (
        <Notice tone="warn" title="Your plan is marked unavailable" className="mb-6" actions={<LinkButton to="/plan" size="sm">Open My Plan</LinkButton>}>
          Sessions are paused until the plan is updated with your clinician.
        </Notice>
      ) : null}
      {plan.kind === 'demonstration' ? (
        <Notice tone="info" className="mb-8" title="You’re using the demonstration plan">
          These movements are examples for trying the software. Only do them if a clinician has said they’re right for you.
        </Notice>
      ) : null}
      <Section title="Today’s exercises">
        <ul className="divide-y divide-rule">
          {enabled.map((e) => {
            const def = EXERCISES[e.exerciseId];
            const done = doneToday.has(e.id);
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-4 py-4">
                <div className="size-20 shrink-0 overflow-hidden rounded-[var(--radius-control)] bg-surface-2">
                  <DemoFigure def={def} side={e.side === 'left' ? 'left' : 'right'} value={(def.demo.neutral + def.demo.peak) / 2} className="size-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link to={`/plan/exercise/${e.id}`} className="text-lg font-bold hover:underline">
                      {def.name}
                    </Link>
                    {done ? <Tag tone="ok">Done today</Tag> : null}
                  </p>
                  <p className="text-ink-2">
                    {sideLabel(e.side)} · {describePrescription(e)}
                  </p>
                  <p className="flex items-center gap-1.5 text-sm text-ink-3">
                    {e.cameraMeasurement ? <Camera aria-hidden className="size-4" /> : <ClipboardPen aria-hidden className="size-4" />}
                    {e.cameraMeasurement ? `Camera measured · ${def.cameraView} view` : 'Logged without camera'}
                  </p>
                </div>
                {plan.status !== 'unavailable' ? (
                  <LinkButton to={`/session/${e.id}`} variant={done ? 'secondary' : 'primary'}>
                    {done ? 'Do it again' : 'Start'} <ChevronRight aria-hidden className="size-4" />
                  </LinkButton>
                ) : null}
              </li>
            );
          })}
        </ul>
        {enabled.length === 0 ? <p className="py-4 text-ink-2">No exercises are enabled. Update your plan to add or resume exercises.</p> : null}
      </Section>
      {paused.length ? (
        <Section title="Paused in your plan" className="mt-10">
          <ul className="space-y-1 text-ink-2">
            {paused.map((e) => (
              <li key={e.id}>
                {EXERCISES[e.exerciseId].name} · {sideLabel(e.side)}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
