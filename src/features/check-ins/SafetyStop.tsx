import { useState } from 'react';
import { OctagonAlert, PhoneCall, TriangleAlert } from 'lucide-react';
import { SAFETY_COPY, type SafetyOutcome } from '@/lib/safety/checkins';
import { Button, CheckboxRow } from '@/components/ui';

/**
 * Shown when a check-in reports a warning sign (urgent) or new/worsening
 * symptoms (caution). It pauses the workflow, never encourages pushing through,
 * and does not attempt to diagnose. Urgent stops cannot be bypassed.
 */
export function SafetyStop({ outcome, clinician, onExit, onContinue, context }: { outcome: SafetyOutcome; clinician: string; onExit: () => void; onContinue?: () => void; context: 'before' | 'after' | 'between' }) {
  const [ack, setAck] = useState(false);
  const urgent = outcome.level === 'urgent';
  const copy = urgent ? SAFETY_COPY.urgent : SAFETY_COPY.caution;
  return (
    <section role="alert" aria-labelledby="safety-title" className={urgent ? 'rounded-[var(--radius-card)] bg-alert-soft p-6 sm:p-8' : 'rounded-[var(--radius-card)] bg-warn-soft p-6 sm:p-8'}>
      <div className="flex items-start gap-3">
        {urgent ? <OctagonAlert aria-hidden className="mt-1 size-7 shrink-0 text-alert" /> : <TriangleAlert aria-hidden className="mt-1 size-7 shrink-0 text-warn" />}
        <div className="min-w-0 space-y-3">
          <h2 id="safety-title" className="text-2xl font-bold">
            {copy.title}
          </h2>
          {copy.body.map((p) => (
            <p key={p} className="max-w-[62ch] text-[1.05rem]">
              {p}
            </p>
          ))}
          {outcome.reasons.length ? (
            <div>
              <p className="font-semibold">You reported:</p>
              <ul className="ml-5 list-disc text-ink-2">
                {outcome.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {clinician ? (
            <p className="flex items-center gap-2 text-ink-2">
              <PhoneCall aria-hidden className="size-4" /> Your plan lists: <strong className="text-ink">{clinician}</strong>
            </p>
          ) : null}
          <p className="text-sm text-ink-2">This check-in is not a complete medical safety screening.</p>
        </div>
      </div>
      <div className="mt-6 space-y-3 border-t border-ink/20 pt-5">
        {!urgent && onContinue && context === 'before' ? (
          <>
            <CheckboxRow checked={ack} onChange={setAck} label="My clinician’s instructions say I can continue with these symptoms." description="Only check this if your clinician told you so. If you’re unsure, skip today." />
            <div className="flex flex-wrap gap-2">
              <Button size="lg" onClick={onExit}>
                Skip this session
              </Button>
              <Button size="lg" variant="secondary" disabled={!ack} onClick={onContinue}>
                Continue as my clinician instructed
              </Button>
            </div>
          </>
        ) : (
          <Button size="lg" onClick={onExit}>
            {urgent ? 'I understand' : 'Back to Home'}
          </Button>
        )}
      </div>
    </section>
  );
}
