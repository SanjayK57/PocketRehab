import { useMemo, useState } from 'react';
import { Download, FileJson, Printer } from 'lucide-react';
import type { ExerciseId } from '@/lib/validation/schemas';
import { useAppData } from '@/app/AppData';
import { useAllData } from '@/app/useData';
import { EXERCISE_LIST } from '@/features/exercises/library';
import { ProgressTabs } from '@/features/analytics/ProgressPage';
import { addDays, formatDate, todayKey } from '@/lib/time/dates';
import { downloadBlob, downloadJson, fileStamp } from '@/lib/export/download';
import { Button, CheckboxRow, ErrorState, Field, LoadingBlock, Notice, PageHeader, Section, Select, TextInput } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { buildReportData, type ReportOptions } from './reportData';
import { ReportPreview } from './ReportPreview';

export function ReportPage() {
  const { profile, plan } = useAppData();
  const data = useAllData();
  const toast = useToast();
  const today = todayKey();
  const [preset, setPreset] = useState('30');
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [exerciseIds, setExerciseIds] = useState<ExerciseId[]>(() => EXERCISE_LIST.map((e) => e.id));
  const [include, setInclude] = useState<ReportOptions['include']>({ symptoms: true, quality: true, comparisons: true, notes: true, sessionList: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const report = useMemo(() => {
    if (!data.data || from > to) return null;
    return buildReportData({ profile, plan, sessions: data.data.sessions, checkIns: data.data.checkIns, overrides: data.data.overrides, options: { from, to, exerciseIds, include }, today });
  }, [data.data, profile, plan, from, to, exerciseIds, include, today]);

  if (data.status === 'loading') return <LoadingBlock />;
  if (data.status === 'error') return <ErrorState error={data.error} onRetry={data.reload} />;

  const applyPreset = (p: string) => {
    setPreset(p);
    if (p !== 'custom') {
      setFrom(addDays(today, -(Number(p) - 1)));
      setTo(today);
    }
  };

  const downloadPdf = async () => {
    if (!report) return;
    setBusy(true);
    setError(null);
    try {
      const { renderReportPdf } = await import('./pdf');
      const blob = await renderReportPdf(report);
      downloadBlob(blob, `pocketrehab-report-${from}-to-${to}.pdf`);
      toast.show('PDF report downloaded to this device.');
    } catch (err) {
      setError(`The PDF couldn’t be created (${err instanceof Error ? err.message : String(err)}). Use Print instead and choose “Save as PDF”.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="no-print">
        <PageHeader title="Progress" description="Make a report to bring to your physical therapist. You choose what goes in it; nothing is sent anywhere. Download or print it, then share it however you like." />
        <ProgressTabs />
      </div>
      <div className="grid gap-x-12 gap-y-10 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="no-print space-y-8">
          <Section title="Report options">
            <div className="space-y-4">
              <Field label="Period" htmlFor="rp-period">
                <Select id="rp-period" value={preset} onChange={(e) => applyPreset(e.target.value)}>
                  <option value="7">Last 7 days</option>
                  <option value="14">Last 14 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="custom">Custom dates</option>
                </Select>
              </Field>
              {preset === 'custom' ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From" htmlFor="rp-from">
                    <TextInput id="rp-from" type="date" max={to} value={from} onChange={(e) => setFrom(e.target.value)} />
                  </Field>
                  <Field label="To" htmlFor="rp-to" error={from > to ? 'Must be after the start' : null}>
                    <TextInput id="rp-to" type="date" min={from} max={today} value={to} onChange={(e) => setTo(e.target.value)} />
                  </Field>
                </div>
              ) : (
                <p className="text-sm text-ink-2">
                  {formatDate(from, { month: 'short', day: 'numeric' })} – {formatDate(to, { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              )}
            </div>
          </Section>
          <Section title="Exercises">
            {EXERCISE_LIST.map((e) => (
              <CheckboxRow key={e.id} checked={exerciseIds.includes(e.id)} onChange={(on) => setExerciseIds((xs) => (on ? [...xs, e.id] : xs.filter((x) => x !== e.id)))} label={e.name} />
            ))}
          </Section>
          <Section title="Include">
            <CheckboxRow checked={include.sessionList} onChange={(v) => setInclude({ ...include, sessionList: v })} label="Session list" />
            <CheckboxRow checked={include.comparisons} onChange={(v) => setInclude({ ...include, comparisons: v })} label="First vs latest comparison" />
            <CheckboxRow checked={include.symptoms} onChange={(v) => setInclude({ ...include, symptoms: v })} label="Symptom check-ins" />
            <CheckboxRow checked={include.quality} onChange={(v) => setInclude({ ...include, quality: v })} label="Measurement quality" />
            <CheckboxRow checked={include.notes} onChange={(v) => setInclude({ ...include, notes: v })} label="My check-in notes" />
          </Section>
          <div className="flex flex-col gap-2">
            <Button size="lg" onClick={() => void downloadPdf()} loading={busy} disabled={!report || exerciseIds.length === 0} icon={<Download aria-hidden className="size-5" />}>
              Download PDF
            </Button>
            <Button variant="secondary" onClick={() => window.print()} disabled={!report} icon={<Printer aria-hidden className="size-4" />}>
              Print
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                if (report) {
                  downloadJson(report, `pocketrehab-report-data-${fileStamp()}.json`);
                  toast.show('Report data downloaded.');
                }
              }}
              disabled={!report}
              icon={<FileJson aria-hidden className="size-4" />}
            >
              Download the data (JSON)
            </Button>
          </div>
          {error ? <Notice tone="alert">{error}</Notice> : null}
        </div>
        <div className="min-w-0">
          {exerciseIds.length === 0 ? <Notice tone="warn">Choose at least one exercise.</Notice> : report ? <ReportPreview report={report} /> : <Notice tone="warn">Check the dates.</Notice>}
        </div>
      </div>
    </div>
  );
}
