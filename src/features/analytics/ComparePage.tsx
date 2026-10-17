import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAppData } from '@/app/AppData';
import { useAllData } from '@/app/useData';
import { EXERCISES } from '@/features/exercises/library';
import { ErrorState, LoadingBlock, Notice, PageHeader, Section, Select } from '@/components/ui';
import { RangeStrips } from '@/components/tape';
import { ProgressTabs, sessionLabel } from './ProgressPage';
import { compareSessions } from './analysis';
import { dateKey, formatDate } from '@/lib/time/dates';

/** Before-and-after comparison of two sessions of the same exercise, with comparability warnings. */
export function ComparePage() {
  const { profile } = useAppData();
  const data = useAllData();
  const candidates = useMemo(
    () => (data.data?.sessions ?? []).filter((s) => s.mode !== 'manual' && s.reps.length > 0 && s.status !== 'in-progress' && (profile?.isDemo || s.mode !== 'simulated')).sort((a, b) => a.startedAt - b.startedAt),
    [data.data, profile?.isDemo],
  );
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);
  const a = candidates.find((s) => s.id === aId) ?? candidates.find((s) => s.summary?.valid) ?? candidates[0] ?? null;
  const sameEx = candidates.filter((s) => a && s.exerciseId === a.exerciseId && s.id !== a.id);
  const b = sameEx.find((s) => s.id === bId) ?? sameEx[sameEx.length - 1] ?? null;
  const comparison = a && b ? compareSessions(a, b) : null;

  if (data.status === 'loading') return <LoadingBlock />;
  if (data.status === 'error') return <ErrorState error={data.error} onRetry={data.reload} />;

  return (
    <div>
      <PageHeader title="Progress" description="Compare two sessions of the same exercise, measure by measure. PocketRehab tells you when the comparison may not be fair." />
      <ProgressTabs />
      {candidates.length < 2 ? (
        <p className="max-w-[62ch] text-ink-2">You need at least two camera sessions of the same exercise to compare. Video isn’t recorded, so the comparison uses the saved measurements.</p>
      ) : (
        <div className="space-y-10">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cmp-a" className="mb-1 block font-semibold">
                Earlier session
              </label>
              <Select id="cmp-a" value={a?.id ?? ''} onChange={(e) => { setAId(e.target.value); setBId(null); }}>
                {candidates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {sessionLabel(s)}
                    {s.summary?.valid ? '' : ' — not enough reliable tracking'}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="cmp-b" className="mb-1 block font-semibold">
                Later session (same exercise)
              </label>
              <Select id="cmp-b" value={b?.id ?? ''} onChange={(e) => setBId(e.target.value)} disabled={sameEx.length === 0}>
                {sameEx.map((s) => (
                  <option key={s.id} value={s.id}>
                    {sessionLabel(s)}
                    {s.summary?.valid ? '' : ' — not enough reliable tracking'}
                  </option>
                ))}
              </Select>
              {sameEx.length === 0 ? <p className="mt-1 text-sm text-ink-2">No other sessions of this exercise yet.</p> : null}
            </div>
          </div>

          {comparison && a && b ? (
            <>
              {comparison.warnings.length ? (
                <Notice tone={comparison.comparable ? 'neutral' : 'warn'} title={comparison.comparable ? 'Read this comparison with care' : 'These sessions are not directly comparable'}>
                  <ul className="mt-1 space-y-1">
                    {comparison.warnings.map((w) => (
                      <li key={w} className="flex gap-2">
                        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                        {w}
                      </li>
                    ))}
                  </ul>
                </Notice>
              ) : null}
              <Section title={`${EXERCISES[a.exerciseId].name}: range side by side`}>
                <RangeStrips
                  rows={[a, b].map((s, i) => ({ id: s.id, label: formatDate(dateKey(new Date(s.startedAt)), { month: 'short', day: 'numeric' }), start: s.summary?.valid ? s.summary.startMedian : null, peak: s.summary?.valid ? s.summary.peakMedian : null, reliable: !!s.summary?.valid, emphasis: i === 1, simulated: s.mode === 'simulated' }))}
                  target={b.prescription.target ? { min: b.prescription.target.min, max: b.prescription.target.max, label: `${b.prescription.target.min}–${b.prescription.target.max}°` } : null}
                  max={a.exerciseId === 'shoulder-abduction' || a.exerciseId === 'elbow-flexion' ? 160 : 180}
                />
              </Section>
              <Section title="Measure by measure">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-left">
                    <thead>
                      <tr className="border-b border-ink text-sm text-ink-2">
                        <th scope="col" className="py-2 pr-4 font-semibold">Measure</th>
                        <th scope="col" className="py-2 pr-4 font-semibold">{formatDate(dateKey(new Date(a.startedAt)), { month: 'short', day: 'numeric' })}</th>
                        <th scope="col" className="py-2 pr-4 font-semibold">{formatDate(dateKey(new Date(b.startedAt)), { month: 'short', day: 'numeric' })}</th>
                        <th scope="col" className="py-2 font-semibold">Difference</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rule">
                      {comparison.rows.map((r) => (
                        <tr key={r.key}>
                          <th scope="row" className="py-2 pr-4 font-normal">{r.label}</th>
                          <td className="num py-2 pr-4">{r.a === null ? 'excluded' : `${r.a}${r.unit ? (r.unit === 's' ? ' s' : r.unit) : ''}`}</td>
                          <td className="num py-2 pr-4">{r.b === null ? 'excluded' : `${r.b}${r.unit ? (r.unit === 's' ? ' s' : r.unit) : ''}`}</td>
                          <td className="num py-2">{r.diff === null ? '—' : `${r.diff > 0 ? '+' : ''}${r.diff}${r.unit ? (r.unit === 's' ? ' s' : r.unit) : ''}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {comparison.excluded.length ? (
                  <ul className="mt-3 space-y-1 text-sm text-ink-2">
                    {comparison.excluded.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                ) : null}
              </Section>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
