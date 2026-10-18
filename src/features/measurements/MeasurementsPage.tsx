import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Download, FileUp, Trash2 } from 'lucide-react';
import { MEASUREMENT_KINDS, measurementSchema, type Measurement, type MeasurementKind, type Session } from '@/lib/validation/schemas';
import { deleteMeasurement, listMeasurements, newId, saveMeasurements } from '@/lib/storage/repositories';
import { useLiveQuery } from '@/lib/storage/useLiveQuery';
import { useAllData } from '@/app/useData';
import { measurableSessions } from '@/features/analytics/analysis';
import { ProgressTabs } from '@/features/analytics/ProgressPage';
import { EXERCISES } from '@/features/exercises/library';
import { downloadText } from '@/lib/export/download';
import { dateKey, parseDateKey } from '@/lib/time/dates';
import { Button, ErrorState, Field, LoadingBlock, Notice, PageHeader, Section, Select, TextArea, TextInput, cx } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { CSV_TEMPLATE, MAX_IMPORT_BYTES, parseMeasurementFile, type ImportPreview } from './importMeasurements';

/**
 * "Plug in your own data": clinic goniometer readings, pain scores, counts kept
 * on paper. Entered or imported readings sit beside what the camera measured,
 * always labelled by where they came from, and never feed camera statistics.
 */

const KIND_LABEL: Record<MeasurementKind, string> = {
  angle: 'Joint angle (degrees)',
  pain: 'Pain (0 to 10)',
  reps: 'Repetitions',
  hold: 'Hold time (seconds)',
  other: 'Something else',
};

const exercises = () => Object.values(EXERCISES);

export function MeasurementsPage() {
  const q = useLiveQuery(listMeasurements);
  const all = useAllData();
  return (
    <div>
      <PageHeader title="Progress" description="Your own readings, from your clinic or your notes, kept beside what the camera measured. Each one shows where it came from." />
      <ProgressTabs />
      <div className="grid gap-x-14 gap-y-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="min-w-0">
          {q.status === 'error' ? <ErrorState error={q.error} onRetry={q.reload} /> : q.status === 'loading' ? <LoadingBlock label="Loading your measurements" /> : <Readings items={q.data} sessions={all.data?.sessions ?? []} />}
        </div>
        <div className="min-w-0">
          <AddReading />
          <ImportReadings existing={q.data ?? []} />
        </div>
      </div>
    </div>
  );
}

// ---------- List ----------

interface Row {
  key: string;
  t: number;
  value: number;
  source: string;
  own: Measurement | null;
}

function groupKey(m: Measurement) {
  return `${m.kind}|${m.label.toLowerCase()}|${m.side ?? ''}`;
}

function Readings({ items, sessions }: { items: Measurement[]; sessions: Session[] }) {
  const toast = useToast();
  const groups = useMemo(() => {
    const map = new Map<string, Measurement[]>();
    for (const m of items) map.set(groupKey(m), [...(map.get(groupKey(m)) ?? []), m]);
    return [...map.values()];
  }, [items]);
  const camera = useMemo(() => measurableSessions(sessions, { includeSimulated: false }), [sessions]);

  if (!items.length) {
    return (
      <Section title="Readings">
        <p className="max-w-[56ch] text-ink-2">Nothing here yet. Add a reading your clinician took, a pain score, or a count you kept, or import a spreadsheet. If you link a reading to an exercise, the camera’s numbers for that exercise appear next to it.</p>
      </Section>
    );
  }

  return (
    <div className="space-y-12">
      {groups.map((g) => {
        const first = g[0] as Measurement;
        const exercise = first.exerciseId ? exercises().find((e) => e.id === first.exerciseId) : undefined;
        const cameraRows: Row[] =
          first.kind === 'angle' && exercise
            ? camera
                .filter((s) => s.exerciseId === exercise.id && (first.side === null || s.side === first.side) && s.summary?.peakMedian != null)
                .slice(-6)
                .map((s) => ({ key: s.id, t: s.startedAt, value: s.summary?.peakMedian as number, source: 'Camera', own: null }))
            : [];
        const rows: Row[] = [...g.map((m) => ({ key: m.id, t: m.timestamp, value: m.value, source: m.sourceLabel || 'Entered by you', own: m })), ...cameraRows].sort((a, b) => b.t - a.t);
        const scaleMax = first.kind === 'angle' ? 180 : first.kind === 'pain' ? 10 : Math.max(1, ...rows.map((r) => Math.abs(r.value)));
        const unit = first.kind === 'other' ? first.unit : MEASUREMENT_KINDS[first.kind].unit;
        return (
          <Section
            key={groupKey(first)}
            title={
              <>
                {first.label}
                {first.side ? <span className="font-normal text-ink-2"> · {first.side}</span> : null}
              </>
            }
            actions={changeLine(g, unit) ? <span className="text-callout text-ink-2">{changeLine(g, unit)}</span> : undefined}
            description={exercise ? `Shown with the camera’s reliable peak angle for “${exercise.name}”. Camera numbers are estimates and may differ from a goniometer.` : undefined}
          >
            <ul className="divide-y divide-rule">
              {rows.map((r) => (
                <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto_2.75rem] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[6.5rem_minmax(0,1fr)_4.5rem_minmax(0,10rem)_2.75rem] sm:gap-x-4">
                  <span className="text-callout text-ink-2 sm:order-1">{new Date(r.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  <span className="col-span-2 truncate text-right text-callout text-ink-2 sm:order-4 sm:col-span-1 sm:text-left" title={r.source}>
                    {r.own ? r.source : <span className="font-semibold text-accent-strong">Camera</span>}
                  </span>
                  <span aria-hidden className="relative h-2.5 rounded-full bg-rule/60 sm:order-2">
                    <span className={cx('absolute inset-y-0 left-0 rounded-full', r.own ? 'bg-ink-2' : 'bg-tape')} style={{ width: `${Math.max(3, Math.min(100, (Math.abs(r.value) / scaleMax) * 100))}%` }} />
                  </span>
                  <span className="whitespace-nowrap text-right font-mono text-[1.05rem] font-semibold tabular-nums sm:order-3">
                    {formatValue(r.value)}
                    {unit === '°' ? '°' : <span className="text-callout font-normal text-ink-2">{withUnit('', unit)}</span>}
                  </span>
                  <span className="flex justify-end sm:order-5">
                    {r.own ? (
                      <button
                        type="button"
                        aria-label={`Delete ${first.label} reading from ${new Date(r.t).toLocaleDateString()}`}
                        className="grid size-11 place-items-center rounded-[var(--radius-control)] text-ink-3 transition-colors hover:bg-alert-soft hover:text-alert"
                        onClick={async () => {
                          await deleteMeasurement((r.own as Measurement).id);
                          toast.show('Reading deleted.');
                        }}
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {g.some((m) => m.note) ? (
              <ul className="mt-3 space-y-1 text-callout text-ink-2">
                {g
                  .filter((m) => m.note)
                  .slice(0, 3)
                  .map((m) => (
                    <li key={m.id}>
                      <span className="text-ink-3">{new Date(m.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}:</span> {m.note}
                    </li>
                  ))}
              </ul>
            ) : null}
          </Section>
        );
      })}
    </div>
  );
}

function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** "92°", "3/10", "20 s": symbols attach, words get a space. */
function withUnit(value: string, unit: string): string {
  return !unit ? value : unit === '°' || unit.startsWith('/') ? `${value}${unit}` : `${value} ${unit}`;
}

/** Plain change between the first and latest of your own readings; no judgement about good or bad. */
function changeLine(g: Measurement[], unit: string): string | null {
  if (g.length < 2) return null;
  const sorted = [...g].sort((a, b) => a.timestamp - b.timestamp);
  const first = sorted[0] as Measurement;
  const last = sorted[sorted.length - 1] as Measurement;
  const d = last.value - first.value;
  const since = new Date(first.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (d === 0) return `Same as ${since}`;
  return `${d > 0 ? 'Up' : 'Down'} ${withUnit(formatValue(Math.abs(d)), unit === '/10' ? '' : unit)} since ${since}`;
}

// ---------- Manual entry ----------

function AddReading() {
  const id = useId();
  const toast = useToast();
  const [kind, setKind] = useState<MeasurementKind>('angle');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [side, setSide] = useState<'' | 'left' | 'right'>('');
  const [exerciseId, setExerciseId] = useState('');
  const [date, setDate] = useState(() => dateKey(new Date()));
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const range = MEASUREMENT_KINDS[kind];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const day = parseDateKey(date);
    day.setHours(12, 0, 0, 0);
    const candidate = {
      id: newId('m'),
      timestamp: day.getTime(),
      kind,
      label: label.trim(),
      value: value.trim() === '' ? Number.NaN : Number(value),
      unit: kind === 'other' ? unit.trim() : range.unit,
      side: side || null,
      exerciseId: kind === 'angle' && exerciseId ? exerciseId : null,
      source: 'manual' as const,
      sourceLabel: source.trim() || 'Entered by you',
      note: note.trim(),
      createdAt: Date.now(),
    };
    const parsed = measurementSchema.safeParse(candidate);
    if (!candidate.label) return setError('Say what was measured, for example “Knee bend”.');
    if (!Number.isFinite(candidate.value)) return setError('Enter the value as a number.');
    if (day.getTime() > Date.now() + 86_400_000 || Number.isNaN(day.getTime())) return setError('Choose a date that isn’t in the future.');
    if (!parsed.success) return setError(`Use a value from ${range.min} to ${range.max}.`);
    setError(null);
    setBusy(true);
    try {
      await saveMeasurements([parsed.data]);
      toast.show('Reading saved.');
      setValue('');
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  return (
    <Section title="Add a reading">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Kind" htmlFor={`${id}-kind`}>
          <Select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as MeasurementKind)}>
            {(Object.keys(KIND_LABEL) as MeasurementKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What was measured" htmlFor={`${id}-label`}>
          <TextInput id={`${id}-label`} list={`${id}-labels`} maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === 'pain' ? 'Pain during exercise' : kind === 'angle' ? 'Knee bend' : ''} />
          <datalist id={`${id}-labels`}>
            {['Knee bend', 'Knee straightening', 'Shoulder raise to the side', 'Shoulder raise forward', 'Elbow bend', 'Pain at rest', 'Pain during exercise'].map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={kind === 'other' ? 'Value' : `Value (${range.unit === '°' ? 'degrees' : range.unit})`} htmlFor={`${id}-value`}>
            <TextInput id={`${id}-value`} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="font-mono tabular-nums" />
          </Field>
          {kind === 'other' ? (
            <Field label="Unit" htmlFor={`${id}-unit`} optional>
              <TextInput id={`${id}-unit`} maxLength={12} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="cm" />
            </Field>
          ) : (
            <Field label="Side" htmlFor={`${id}-side`} optional>
              <Select id={`${id}-side`} value={side} onChange={(e) => setSide(e.target.value as typeof side)}>
                <option value="">Not specific</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </Select>
            </Field>
          )}
        </div>
        {kind === 'angle' ? (
          <Field label="Same movement as" htmlFor={`${id}-ex`} optional help="Puts the camera’s numbers for this exercise beside your readings.">
            <Select id={`${id}-ex`} value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}>
              <option value="">No exercise</option>
              {exercises().map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date" htmlFor={`${id}-date`}>
            <TextInput id={`${id}-date`} type="date" max={dateKey(new Date())} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Measured by" htmlFor={`${id}-source`} optional>
            <TextInput id={`${id}-source`} list={`${id}-sources`} maxLength={80} value={source} onChange={(e) => setSource(e.target.value)} placeholder="Me" />
            <datalist id={`${id}-sources`}>
              {['Clinic goniometer', 'My physical therapist', 'My own count'].map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field label="Note" htmlFor={`${id}-note`} optional>
          <TextArea id={`${id}-note`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error ? (
          <p className="text-sm font-semibold text-alert" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" loading={busy}>
          Save reading
        </Button>
      </form>
    </Section>
  );
}

// ---------- Import ----------

function ImportReadings({ existing }: { existing: Measurement[] }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<(ImportPreview & { name: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (file: File) => {
    setError(null);
    setPreview(null);
    if (file.size > MAX_IMPORT_BYTES) return setError('That file is larger than 2 MB. Split it, or keep only the columns PocketRehab reads.');
    try {
      setPreview({ ...parseMeasurementFile(await file.text(), file.name, existing), name: file.name });
    } catch {
      setError('That file couldn’t be read.');
    }
  };

  return (
    <Section title="Import from a file" className="mt-12" description="A CSV saved from a spreadsheet, or a JSON file. Columns: date, measure, value, and optionally unit, side, source, note. Dates as 2026-10-18 or 10/18/2026 (month first). Nothing is saved until you confirm.">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<FileUp aria-hidden className="size-4" />} onClick={() => fileRef.current?.click()}>
          Choose a file
        </Button>
        <Button variant="quiet" icon={<Download aria-hidden className="size-4" />} onClick={() => downloadText(CSV_TEMPLATE, 'pocketrehab-measurements-template.csv', 'text/csv')}>
          CSV template
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv,.json,application/json,.txt,text/plain"
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a measurements file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void choose(f);
        }}
      />
      {error ? (
        <Notice tone="alert" className="mt-4">
          {error}
        </Notice>
      ) : null}
      {preview ? (
        <div className="mt-5 animate-rise rounded-[var(--radius-card)] bg-surface-2 p-4">
          <p className="font-semibold">
            {preview.valid.length ? `${preview.valid.length} reading${preview.valid.length === 1 ? '' : 's'} ready` : 'Nothing to import'}
            {preview.problems.length ? <span className="font-normal text-ink-2"> · {preview.problems.length} skipped</span> : null}
          </p>
          <p className="text-callout text-ink-2">From “{preview.name}”. Each will be labelled with its source.</p>
          {preview.valid.length ? (
            <table className="mt-3 w-full text-callout">
              <caption className="sr-only">Readings that will be imported</caption>
              <thead className="text-left text-ink-3">
                <tr>
                  <th className="py-1 font-semibold">Date</th>
                  <th className="py-1 font-semibold">Measure</th>
                  <th className="py-1 text-right font-semibold">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule/70">
                {preview.valid.slice(0, 6).map((m) => (
                  <tr key={m.id}>
                    <td className="py-1.5 pr-2 whitespace-nowrap text-ink-2">{new Date(m.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}</td>
                    <td className="max-w-0 truncate py-1.5 pr-2">{m.label}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums whitespace-nowrap">{withUnit(formatValue(m.value), m.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {preview.valid.length > 6 ? <p className="mt-1 text-footnote text-ink-3">and {preview.valid.length - 6} more</p> : null}
          {preview.problems.length ? (
            <details className="mt-3 text-callout">
              <summary className="cursor-pointer font-semibold text-warn">Why {preview.problems.length === 1 ? 'one row was' : `${preview.problems.length} rows were`} skipped</summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-ink-2">
                {preview.problems.slice(0, 50).map((p, i) => (
                  <li key={i}>
                    {p.line > 0 ? <span className="font-mono text-ink-3">{preview.format === 'csv' ? `Line ${p.line}` : `Item ${p.line}`}: </span> : null}
                    {p.error}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {preview.valid.length ? (
              <Button
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await saveMeasurements(preview.valid);
                    toast.show(`Imported ${preview.valid.length} reading${preview.valid.length === 1 ? '' : 's'}.`);
                    setPreview(null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                  setBusy(false);
                }}
              >
                Import {preview.valid.length} reading{preview.valid.length === 1 ? '' : 's'}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setPreview(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
