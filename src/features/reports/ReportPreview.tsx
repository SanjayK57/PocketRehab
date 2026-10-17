import type { ReportData } from './reportData';
import { formatDate } from '@/lib/time/dates';

/** On-screen and printable version of the report (same content as the PDF). */
export function ReportPreview({ report: r }: { report: ReportData }) {
  const a = r.adherence;
  return (
    <article className="rounded-[var(--radius-card)] border border-ink/20 bg-surface p-6 print:border-0 print:p-0 sm:p-8" aria-label="Report preview">
      <header className="mb-6 border-b border-ink pb-4">
        <h2 className="text-2xl font-bold">PocketRehab progress report</h2>
        <p className="text-ink-2">
          {r.name} · {formatDate(r.from, { month: 'long', day: 'numeric', year: 'numeric' })} to {formatDate(r.to, { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
        <p className="text-sm text-ink-3">Generated {new Date(r.generatedAt).toLocaleString()} from data stored on the user’s device.</p>
        {r.isDemo ? <p className="mt-2 font-semibold text-signal-ink">Demo profile: simulated sample data, not a real person’s history.</p> : null}
        <p className="mt-3 rounded-[var(--radius-control)] bg-surface-2 p-3 text-sm">{r.disclaimer}</p>
      </header>

      <Block title="Plan">
        {r.plan ? (
          <>
            <p>
              {r.plan.kind === 'demonstration' ? 'Demonstration plan (not a clinical prescription)' : 'Plan entered by the user from clinician instructions'} · version {r.plan.version} · status {r.plan.status.replace('-', ' ')}
            </p>
            <p className="text-ink-2">
              Approved by (as entered by the user): {r.plan.authorizedBy || 'not recorded'}
              {r.plan.authorizationDate ? `, ${r.plan.authorizationDate}` : ''}
            </p>
            {r.plan.restrictions ? <p className="text-ink-2">Recorded restrictions: {r.plan.restrictions}</p> : null}
            <Table head={['Exercise', 'Side', 'Prescribed', 'Target', 'Camera']} rows={r.exercises.map((e) => [e.name, e.side, e.prescription, e.target, e.camera ? 'yes' : 'no'])} />
          </>
        ) : (
          <p className="text-ink-2">No plan recorded.</p>
        )}
      </Block>

      <Block title="Adherence">
        <p>{a.percent === null ? 'No scheduled sessions were due in this period, so adherence is not calculated.' : `${a.completed} of ${a.eligible} due sessions completed (${a.percent}%). Partially completed: ${a.partial}. Missed: ${a.missed}. Skipped: ${a.skipped}. Marked unavailable (excluded): ${a.unavailable}.`}</p>
      </Block>

      <Block title="Movement measurements (camera estimates)">
        {r.measurements.length === 0 ? <p className="text-ink-2">No reliable camera measurements in this period.</p> : null}
        {r.measurements.map((m) => (
          <div key={m.name} className="mb-3">
            <p className="font-semibold">{m.name}</p>
            <p>
              {m.sessions} reliable session{m.sessions === 1 ? '' : 's'}. First: {m.first}. Latest: {m.latest}.
            </p>
            <p className="text-sm text-ink-2">{m.interpretation}</p>
            {m.stable ? <p className="text-sm text-ink-2">{m.stable}</p> : null}
          </div>
        ))}
      </Block>

      {r.sessions.length ? (
        <Block title="Sessions">
          <Table head={['Date', 'Exercise', 'Side', 'Mode', 'Status', 'Reps', 'Reliable', 'Peak', 'Range', 'Rep time', 'Tracking']} rows={r.sessions.map((s) => [s.date, s.exercise, s.side, s.mode, s.status, String(s.reps), s.validReps === null ? '—' : String(s.validReps), s.peak, s.range, s.duration, s.quality])} />
        </Block>
      ) : null}

      {r.comparisons && r.comparisons.length ? (
        <Block title="First vs latest comparison">
          {r.comparisons.map((c) => (
            <div key={c.name} className="mb-4">
              <p className="font-semibold">
                {c.name}: {c.a} vs {c.b}
                {c.comparable ? '' : ' (not directly comparable)'}
              </p>
              <Table head={['Measure', c.a, c.b, 'Difference']} rows={c.rows.map((row) => [row.label, row.a === null ? 'not available' : `${row.a} ${row.unit}`, row.b === null ? 'not available' : `${row.b} ${row.unit}`, row.diff === null ? '—' : `${row.diff > 0 ? '+' : ''}${row.diff} ${row.unit}`])} />
              <ul className="mt-1 list-disc pl-5 text-sm text-ink-2">
                {c.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ))}
        </Block>
      ) : null}

      {r.symptoms ? (
        <Block title="Self-reported check-ins">
          {r.symptoms.length ? <Table head={['Date', 'When', 'Discomfort', 'Fatigue', 'Difficulty', 'Change', 'Flag']} rows={r.symptoms.map((s) => [s.date, s.kind, s.pain, s.fatigue, s.difficulty, s.change, s.outcome])} /> : <p className="text-ink-2">No check-ins recorded in this period.</p>}
          <p className="mt-1 text-sm text-ink-2">Scores are self-reported (0–10), not objective measurements.</p>
        </Block>
      ) : null}

      {r.quality ? (
        <Block title="Measurement quality">
          <p>
            Camera sessions: {r.quality.camera}. With enough reliable tracking: {r.quality.reliable}. Not reliable enough to use: {r.quality.uncertain}. Repetitions excluded for uncertain tracking: {r.quality.excludedReps}.
          </p>
          {r.quality.commonIssues.length ? <p className="text-ink-2">Most common tracking issues: {r.quality.commonIssues.join(', ')}.</p> : null}
        </Block>
      ) : null}

      {r.notes && r.notes.length ? (
        <Block title="User notes">
          <ul className="list-disc pl-5">
            {r.notes.map((n) => (
              <li key={n}>“{n}”</li>
            ))}
          </ul>
        </Block>
      ) : null}

      <Block title="Missing information and limitations">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {[...r.missing, ...r.limitations].map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Block>
    </article>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 break-inside-avoid-page">
      <h3 className="mb-2 border-b border-rule pb-1 text-lg font-bold">{title}</h3>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="bg-surface-2">
            {head.map((h) => (
              <th key={h} scope="col" className="px-2 py-1.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="px-2 py-1.5">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
