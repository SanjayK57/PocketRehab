import { useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Camera, CameraOff, ChevronRight, Download, FileUp, History, PencilLine } from 'lucide-react';
import type { Plan } from '@/lib/validation/schemas';
import { planFileSchema } from '@/lib/validation/schemas';
import { useAppData } from '@/app/AppData';
import { addPlanVersion } from '@/lib/storage/repositories';
import { downloadJson, fileStamp, readJsonFile } from '@/lib/export/download';
import { EXERCISES } from './library';
import { describePrescription, describeTarget, planKindLabel, sideLabel } from './describe';
import { Button, LinkButton, Notice, PageHeader, Section, Select, Tag, cx } from '@/components/ui';
import { ConfirmDialog } from '@/components/Dialog';
import { useToast } from '@/components/Toast';
import { formatDate } from '@/lib/time/dates';

export function PlanTabs() {
  const tabs = [
    { to: '/plan', label: 'Exercises', end: true },
    { to: '/plan/schedule', label: 'Schedule' },
    { to: '/plan/equipment', label: 'Equipment' },
    { to: '/plan/history', label: 'History' },
  ];
  return (
    <nav aria-label="My Plan sections" className="-mt-4 mb-8 overflow-x-auto border-b border-rule">
      <ul className="flex min-w-max gap-1">
        {tabs.map((t) => (
          <li key={t.to}>
            <NavLink
              to={t.to}
              end={t.end}
              className={({ isActive }) => cx('-mb-px inline-flex min-h-11 items-center border-b-[3px] px-3 font-semibold transition-colors', isActive ? 'border-tape text-ink' : 'border-transparent text-ink-2 hover:text-ink')}
            >
              {t.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function PlanPage() {
  const { plan, profile } = useAppData();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<Plan | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!plan || !profile) return null;

  const setStatus = async (status: Plan['status']) => {
    const { version: _v, createdAt: _c, ...rest } = plan;
    await addPlanVersion({ ...rest, status, changeSource: 'status-change', changeSummary: `Status changed to “${status.replace('-', ' ')}” by the user` });
    toast.show(`Plan marked ${status.replace('-', ' ')}.`);
  };

  const exportPlan = () => {
    downloadJson({ app: 'PocketRehab', type: 'plan', exportedAt: Date.now(), plan }, `pocketrehab-plan-v${plan.version}-${fileStamp()}.json`);
    toast.show('Plan file downloaded.');
  };

  const onFile = async (file: File | undefined) => {
    setImportError(null);
    if (!file) return;
    try {
      const raw = await readJsonFile(file);
      const parsed = planFileSchema.safeParse(raw);
      if (!parsed.success) throw new Error('This is not a valid PocketRehab plan file.');
      setImporting(parsed.data.plan);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div>
      <PageHeader
        title="My Plan"
        description={
          <>
            {planKindLabel(plan)} · version {plan.version}
            {plan.kind === 'clinician-entered' ? <> · approved by {plan.authorizedBy || 'not recorded'}{plan.authorizationDate ? `, ${formatDate(plan.authorizationDate, { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}</> : null}
          </>
        }
        actions={
          <>
            <LinkButton to="/plan/edit" icon={<PencilLine aria-hidden className="size-4" />}>
              Update plan
            </LinkButton>
            <Button variant="secondary" onClick={exportPlan} icon={<Download aria-hidden className="size-4" />}>
              Export
            </Button>
            <Button variant="secondary" onClick={() => fileRef.current?.click()} icon={<FileUp aria-hidden className="size-4" />}>
              Import
            </Button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Import a plan file" onChange={(e) => void onFile(e.target.files?.[0])} />
          </>
        }
      />
      <PlanTabs />

      {plan.kind === 'demonstration' ? (
        <Notice tone="info" className="mb-8" title="This is the demonstration plan" actions={<LinkButton to="/plan/edit" size="sm">Enter my clinician’s plan</LinkButton>}>
          It contains the four movements PocketRehab can measure, with example numbers for trying the software. PocketRehab does not decide which exercises are right for your condition.
        </Notice>
      ) : null}
      {importError ? <Notice tone="alert" className="mb-6" title="Import failed">{importError}</Notice> : null}

      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Section title="Exercises">
          <ul className="divide-y divide-rule">
            {plan.exercises.map((e) => {
              const def = EXERCISES[e.exerciseId];
              return (
                <li key={e.id}>
                  <Link to={`/plan/exercise/${e.id}`} className="group flex items-center gap-4 py-4">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-bold group-hover:underline">{def.name}</span>
                        {!e.enabled ? <Tag>Paused</Tag> : null}
                        {e.cameraMeasurement ? (
                          <Tag tone="accent">
                            <Camera aria-hidden className="size-3.5" /> Camera
                          </Tag>
                        ) : (
                          <Tag>
                            <CameraOff aria-hidden className="size-3.5" /> No camera
                          </Tag>
                        )}
                      </span>
                      <span className="block text-ink-2">
                        {sideLabel(e.side)} · {describePrescription(e)}
                      </span>
                      <span className="block text-sm text-ink-3">Target: {describeTarget(e.target)}</span>
                    </span>
                    <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-3" />
                  </Link>
                </li>
              );
            })}
          </ul>
          {plan.exercises.length === 0 ? <p className="py-4 text-ink-2">No exercises in this plan yet.</p> : null}
        </Section>

        <div className="space-y-8">
          <Section title="Restrictions">
            {plan.restrictions ? <p className="whitespace-pre-line">{plan.restrictions}</p> : <p className="text-ink-2">None recorded. Add any your clinician gave you when you update the plan.</p>}
          </Section>
          <Section title="Plan status">
            <p className="mb-3 text-ink-2">Mark the plan if it needs your clinician’s review or can’t be followed right now. PocketRehab keeps every change in the plan history.</p>
            <label htmlFor="plan-status" className="sr-only">
              Plan status
            </label>
            <Select
              id="plan-status"
              value={plan.status}
              disabled={busy}
              onChange={async (e) => {
                setBusy(true);
                await setStatus(e.target.value as Plan['status']);
                setBusy(false);
              }}
            >
              <option value="active">Active</option>
              <option value="needs-review">Needs review by my clinician</option>
              <option value="unavailable">Unavailable (pause sessions)</option>
            </Select>
            <Link to="/plan/history" className="mt-4 inline-flex items-center gap-1.5 font-bold text-accent-strong underline-offset-4 hover:underline">
              <History aria-hidden className="size-4" /> View plan history
            </Link>
          </Section>
        </div>
      </div>

      <ConfirmDialog
        open={importing !== null}
        onCancel={() => setImporting(null)}
        title="Replace your plan with this file?"
        confirmLabel="Import as a new version"
        busy={busy}
        onConfirm={async () => {
          if (!importing) return;
          setBusy(true);
          const { version: _v, createdAt: _c, ...rest } = importing;
          await addPlanVersion({ ...rest, changeSource: 'import', changeSummary: `Imported from a plan file (originally version ${importing.version})` });
          setBusy(false);
          setImporting(null);
          toast.show('Plan imported as a new version. Your previous plan stays in the history.');
        }}
      >
        {importing ? (
          <>
            <p>
              The file contains a {importing.kind === 'demonstration' ? 'demonstration plan' : `plan approved by ${importing.authorizedBy || 'an unrecorded clinician'}`} with {importing.exercises.length} exercise{importing.exercises.length === 1 ? '' : 's'}.
            </p>
            <p>Only import plan files you trust, such as one you exported yourself. Your current plan stays in the history.</p>
          </>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
