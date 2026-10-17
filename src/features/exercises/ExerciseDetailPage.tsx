import { useParams } from 'react-router-dom';
import { Video } from 'lucide-react';
import { useAppData } from '@/app/AppData';
import { EXERCISES } from './library';
import { describePrescription, describeTarget, sideLabel } from './describe';
import { ExerciseDemo } from './ExerciseDemo';
import { KeyValue, LinkButton, Notice, PageHeader, Section } from '@/components/ui';

export function ExerciseDetailPage() {
  const { id } = useParams();
  const { plan } = useAppData();
  const ex = plan?.exercises.find((e) => e.id === id);
  if (!plan || !ex) {
    return (
      <div className="space-y-4">
        <PageHeader title="Exercise not found" description="It isn’t in your current plan." />
        <LinkButton to="/plan">Back to My Plan</LinkButton>
      </div>
    );
  }
  const def = EXERCISES[ex.exerciseId];
  const side = ex.side === 'left' ? 'left' : 'right';
  return (
    <div>
      <PageHeader
        title={def.name}
        description={def.description}
        actions={
          ex.enabled && plan.status !== 'unavailable' ? (
            <LinkButton to={`/session/${ex.id}`} size="lg" icon={<Video aria-hidden className="size-5" />}>
              Start this exercise
            </LinkButton>
          ) : null
        }
      />
      {!ex.enabled ? <Notice tone="neutral" className="mb-8" title="This exercise is paused in your plan">Update the plan to resume it.</Notice> : null}
      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-9">
          <Section title="Your prescription">
            <KeyValue
              items={[
                { label: 'Side', value: sideLabel(ex.side) },
                { label: 'Sets and repetitions', value: describePrescription(ex) },
                { label: 'Target angle', value: describeTarget(ex.target) },
                { label: 'Camera measurement', value: ex.cameraMeasurement ? `On (${def.cameraView} view)` : 'Off — log manually' },
                { label: 'Source', value: plan.kind === 'demonstration' ? 'Demonstration plan (not a recommendation)' : `Your clinician’s instructions, plan v${plan.version}` },
              ]}
            />
            {ex.clinicianNotes ? (
              <p className="mt-3">
                <span className="font-semibold">Clinician’s notes: </span>
                {ex.clinicianNotes}
              </p>
            ) : null}
          </Section>
          <Section title="Instructions">
            <ol className="max-w-[65ch] list-decimal space-y-1.5 pl-5">
              {def.instructions.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ol>
          </Section>
          <Section title="Movement phases">
            <dl className="grid gap-3 sm:grid-cols-2">
              {def.phases.map((p) => (
                <div key={p.id}>
                  <dt className="font-semibold">{p.label}</dt>
                  <dd className="text-ink-2">{p.description}</dd>
                </div>
              ))}
            </dl>
          </Section>
          <Section title="Camera setup">
            <ul className="max-w-[65ch] list-disc space-y-1.5 pl-5">
              {def.cameraSetup.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </Section>
          <Section title="How it’s measured">
            <p className="max-w-[65ch]">
              <span className="font-semibold">{def.metric.label}.</span> {def.metric.description}
            </p>
            <p className="mt-2 max-w-[65ch] text-ink-2">
              A repetition counts when the movement leaves the start position, passes {def.segmentation.countMin}° and returns below {def.segmentation.neutralMax}°, taking between {def.segmentation.minRepMs / 1000} and {def.segmentation.maxRepMs / 1000} seconds. Repetitions where fewer than {Math.round(def.segmentation.minReliableFraction * 100)}% of frames had reliable tracking are counted but excluded from measurements. These are software parameters, not clinically validated thresholds.
            </p>
            {def.compensationRules.map((r) => (
              <p key={r.id} className="mt-2 max-w-[65ch] text-ink-2">
                <span className="font-semibold text-ink">{r.label} check:</span> flagged when the torso angle changes more than {r.thresholdDeg}° from the start of a repetition ({r.requiredView} view, reliable tracking only). Configurable demonstration parameter, not validated. {r.limitations}
              </p>
            ))}
          </Section>
          <Section title="Known limitations">
            <ul className="max-w-[65ch] list-disc space-y-1.5 pl-5 text-ink-2">
              {def.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Section>
          <Section title="Before you start">
            {plan.restrictions ? (
              <Notice tone="warn" title="Your recorded restrictions" className="mb-3">
                {plan.restrictions}
              </Notice>
            ) : null}
            <ul className="max-w-[65ch] list-disc space-y-1.5 pl-5">
              {def.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-ink-3">
              Definition version {def.version}. {def.source}
            </p>
          </Section>
        </div>
        <div className="space-y-4">
          <ExerciseDemo def={def} side={side} holdSeconds={ex.holdSeconds} size="large" className="border border-rule" />
          <Section title="Equipment">
            {def.equipment.length === 0 && !ex.equipmentNote ? (
              <p className="text-ink-2">No equipment needed for this movement as described.</p>
            ) : (
              <ul className="space-y-2">
                {def.equipment.map((e) => (
                  <li key={e.id}>
                    <span className="font-semibold">{e.name}</span> <span className="text-sm text-ink-2">({e.required ? 'needed' : 'only if your plan says so'})</span>
                    <span className="block text-sm text-ink-2">{e.note}</span>
                  </li>
                ))}
                {ex.equipmentNote ? <li className="text-ink-2">Clinician’s note: {ex.equipmentNote}</li> : null}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
