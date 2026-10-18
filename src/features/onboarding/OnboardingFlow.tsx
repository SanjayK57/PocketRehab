import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Camera, Lock, ShieldCheck } from 'lucide-react';
import type { PrescribedExercise, Preferences, Profile, ScheduleSettings } from '@/lib/validation/schemas';
import { addPlanVersion, deleteMeta, getMeta, saveProfile, setMeta } from '@/lib/storage/repositories';
import { DISCLAIMER_SHORT } from '@/lib/safety/checkins';
import { DEFAULT_PREFERENCES, DEFAULT_SCHEDULE } from '@/features/settings/defaults';
import { demonstrationExercises, describePrescription, describeTarget, sideLabel } from '@/features/exercises/describe';
import { EXERCISES } from '@/features/exercises/library';
import { ExercisePicker, PrescriptionCard, newPrescription, validatePrescription } from '@/features/exercises/PrescriptionEditor';
import { ScheduleFields } from '@/features/scheduling/ScheduleFields';
import { PreferenceFields } from '@/features/settings/PreferenceFields';
import { CameraTest } from '@/features/live-coaching/CameraTest';
import { exploreDemo } from '@/features/accounts/demo';
import { BrandMark } from '@/components/BrandMark';
import { SkipLink } from '@/components/SkipLink';
import { Button, CheckboxRow, ChoiceGroup, Field, KeyValue, Notice, Scale, TextArea, TextInput, cx } from '@/components/ui';
import { WEEKDAY_SHORT, formatTime } from '@/lib/time/dates';

interface Draft {
  step: number;
  accepted: boolean;
  displayName: string;
  rehabContext: Profile['rehabContext'];
  affectedArea: Profile['affectedArea'];
  planStatusAnswer: Profile['planStatusAnswer'] | null;
  exercises: PrescribedExercise[];
  authorizedBy: string;
  authorizationDate: string;
  restrictions: string;
  baseline: { pain: number | null; fatigue: number | null; difficulty: number | null };
  schedule: ScheduleSettings;
  preferences: Preferences;
}

const EMPTY: Draft = {
  step: 0,
  accepted: false,
  displayName: '',
  rehabContext: null,
  affectedArea: null,
  planStatusAnswer: null,
  exercises: [],
  authorizedBy: '',
  authorizationDate: '',
  restrictions: '',
  baseline: { pain: null, fatigue: null, difficulty: null },
  schedule: DEFAULT_SCHEDULE,
  preferences: DEFAULT_PREFERENCES,
};

const STEPS = ['Welcome', 'About you', 'Your plan', 'Restrictions', 'How you feel today', 'Schedule', 'Coaching & accessibility', 'Privacy & camera', 'Camera test', 'Review'];
const DRAFT_KEY = 'onboardingDraft';

export function OnboardingFlow() {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    getMeta<Draft>(DRAFT_KEY)
      .then((d) => {
        if (d) setDraft({ ...EMPTY, ...d });
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (loaded) void setMeta(DRAFT_KEY, draft).catch(() => undefined);
  }, [draft, loaded]);

  useEffect(() => {
    if (loaded) headingRef.current?.focus();
  }, [draft.step, loaded]);

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const step = draft.step;

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (step === 0 && !draft.accepted) e.accepted = 'Please confirm you’ve read this before continuing.';
    if (step === 1 && !draft.displayName.trim()) e.displayName = 'Enter the name you’d like PocketRehab to use. A first name or nickname is fine.';
    if (step === 1 && draft.displayName.trim().length > 60) e.displayName = 'Keep the name under 60 characters.';
    if (step === 2) {
      if (!draft.planStatusAnswer) e.planStatusAnswer = 'Choose one option.';
      if (draft.planStatusAnswer === 'yes') {
        if (draft.exercises.length === 0) e.exercises = 'Add at least one exercise from your plan, or choose “Not yet” to use the demonstration plan.';
        if (draft.exercises.some((x) => Object.keys(validatePrescription(x)).length > 0)) e.exercises = 'Fix the highlighted values in your exercises.';
      }
    }
    if (step === 5 && draft.schedule.days.length === 0) e.days = 'Pick at least one day, or the schedule and reminders will stay empty.';
    return e;
  };

  const next = () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    update({ step: Math.min(STEPS.length - 1, step + 1) });
  };
  const back = () => {
    setErrors({});
    update({ step: Math.max(0, step - 1) });
  };

  const finish = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const now = Date.now();
      const hasPlan = draft.planStatusAnswer === 'yes';
      await addPlanVersion({
        kind: hasPlan ? 'clinician-entered' : 'demonstration',
        status: 'active',
        authorizedBy: hasPlan ? draft.authorizedBy.trim() : '',
        authorizationDate: hasPlan && draft.authorizationDate ? draft.authorizationDate : null,
        restrictions: draft.restrictions.trim(),
        exercises: hasPlan ? draft.exercises : demonstrationExercises(),
        changeSummary: hasPlan ? 'Plan entered during setup from clinician instructions' : 'Demonstration plan created during setup',
        changeSource: 'onboarding',
      });
      // Saved last: the app opens as soon as a profile exists, so the plan must already be there.
      await saveProfile({
        id: 'me',
        displayName: draft.displayName.trim(),
        rehabContext: draft.rehabContext,
        affectedArea: draft.affectedArea,
        planStatusAnswer: draft.planStatusAnswer ?? 'unsure',
        baseline: Object.values(draft.baseline).some((v) => v !== null) ? { ...draft.baseline, recordedAt: now } : null,
        schedule: draft.schedule,
        preferences: draft.preferences,
        equipmentAvailable: {},
        isDemo: false,
        disclaimerAcceptedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await deleteMeta(DRAFT_KEY);
      navigate('/', { replace: true });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const startDemo = async () => {
    setDemoBusy(true);
    try {
      // The demo is its own account; this account's unfinished setup stays saved for later.
      await exploreDemo();
      navigate('/', { replace: true });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setDemoBusy(false);
    }
  };

  if (!loaded) return null;
  const optionalStep = [4, 8].includes(step);

  return (
    <div className="min-h-dvh bg-ground">
      <SkipLink targetId="onboarding-main" />
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-6 w-8" />
            <span className="text-lg font-bold tracking-tight">PocketRehab</span>
          </div>
          <p className="text-sm text-ink-2" aria-live="polite">
            Step {step + 1} of {STEPS.length}
            <span className="hidden sm:inline"> · {STEPS[step]}</span>
          </p>
        </div>
        <div className="mx-auto flex max-w-3xl gap-1 px-4 pb-3 sm:px-6" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s} className={cx('h-1.5 flex-1 rounded-full transition-colors duration-200', i <= step ? 'bg-accent' : 'bg-rule')} />
          ))}
        </div>
      </header>

      <main id="onboarding-main" tabIndex={-1} className="outline-none mx-auto max-w-3xl px-4 pb-32 pt-8 sm:px-6">
        <h1 ref={headingRef} tabIndex={-1} className="mb-2 text-[1.75rem] font-bold leading-tight outline-none sm:text-[2rem]">
          {TITLES[step]}
        </h1>
        <div className="mb-8 max-w-[62ch] text-lg text-ink-2">{INTROS[step]}</div>

        {step === 0 ? (
          <div className="space-y-6">
            <ul className="space-y-3 text-[1.05rem]">
              <Bullet icon={<ShieldCheck aria-hidden className="size-5 text-accent-strong" />}>Follow the plan your clinician gave you, with spoken and on-screen instructions.</Bullet>
              <Bullet icon={<Camera aria-hidden className="size-5 text-accent-strong" />}>Optionally use your camera to count repetitions and estimate joint angles, with a clear signal for how trustworthy each measurement is.</Bullet>
              <Bullet icon={<Lock aria-hidden className="size-5 text-accent-strong" />}>Everything stays on this device. Nothing is uploaded, and you can export or delete it any time.</Bullet>
            </ul>
            <Notice tone="neutral" title="Before you start">
              {DISCLAIMER_SHORT}
            </Notice>
            <div>
              <CheckboxRow checked={draft.accepted} onChange={(v) => update({ accepted: v })} label="I understand that PocketRehab supports my clinician’s plan and does not replace professional care." />
              {errors.accepted ? <p className="text-sm font-semibold text-alert">{errors.accepted}</p> : null}
            </div>
            <div className="border-t border-rule pt-6">
              <h2 className="font-bold">Just looking around?</h2>
              <p className="mt-1 max-w-[60ch] text-ink-2">Open a separate demo account filled with simulated sample sessions. It is clearly labelled, and what you’ve entered here stays saved for later.</p>
              <Button variant="secondary" className="mt-3" onClick={startDemo} loading={demoBusy}>
                Explore the demo profile
              </Button>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-6">
            <Field label="What should we call you?" htmlFor="name" error={errors.displayName} help="Shown on your home screen and reports. A first name or nickname is enough.">
              <TextInput id="name" autoComplete="given-name" maxLength={60} value={draft.displayName} onChange={(e) => update({ displayName: e.target.value })} aria-invalid={errors.displayName ? true : undefined} aria-describedby={errors.displayName ? 'name-error' : 'name-help'} />
            </Field>
            <ChoiceGroup
              name="context"
              legend={
                <>
                  What are you recovering from? <span className="text-sm font-normal text-ink-3">Optional</span>
                </>
              }
              help="Only used to label your reports. PocketRehab does not change anything based on it."
              columns={2}
              value={draft.rehabContext}
              onChange={(v) => update({ rehabContext: v })}
              options={[
                { value: 'post-surgery', label: 'Surgery' },
                { value: 'injury', label: 'An injury' },
                { value: 'condition', label: 'A longer-term condition' },
                { value: 'other', label: 'Something else' },
                { value: 'prefer-not', label: 'Prefer not to say' },
              ]}
            />
            <ChoiceGroup
              name="area"
              legend={
                <>
                  Main area you’re working on <span className="text-sm font-normal text-ink-3">Optional</span>
                </>
              }
              columns={3}
              value={draft.affectedArea}
              onChange={(v) => update({ affectedArea: v })}
              options={[
                { value: 'shoulder', label: 'Shoulder' },
                { value: 'elbow', label: 'Elbow' },
                { value: 'knee', label: 'Knee' },
                { value: 'hip', label: 'Hip' },
                { value: 'back', label: 'Back' },
                { value: 'other', label: 'Other' },
                { value: 'prefer-not', label: 'Prefer not to say' },
              ]}
            />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-6">
            <ChoiceGroup
              name="hasPlan"
              legend="Do you have exercise instructions from a physical therapist, doctor or other qualified clinician?"
              value={draft.planStatusAnswer}
              onChange={(v) => update({ planStatusAnswer: v })}
              options={[
                { value: 'yes', label: 'Yes, I have instructions', description: 'Enter the exercises, sets and repetitions exactly as your clinician gave them.' },
                { value: 'no', label: 'Not yet', description: 'Use the demonstration plan to try the software. It is not a recommendation for you.' },
                { value: 'unsure', label: 'I’m not sure', description: 'Start with the demonstration plan and ask your clinician before doing any exercise.' },
              ]}
            />
            {errors.planStatusAnswer ? <p className="text-sm font-semibold text-alert">{errors.planStatusAnswer}</p> : null}

            {draft.planStatusAnswer === 'yes' ? (
              <div className="space-y-5">
                <p className="max-w-[62ch] text-ink-2">
                  PocketRehab can measure four exercises with the camera. Add the ones that appear in your plan. If your plan has other exercises, you can still keep them on paper; PocketRehab won’t invent instructions for them.
                </p>
                <ExercisePicker selected={draft.exercises.map((e) => e.exerciseId)} onAdd={(id) => update({ exercises: [...draft.exercises, newPrescription(id)] })} />
                {draft.exercises.map((ex, i) => (
                  <PrescriptionCard
                    key={ex.id}
                    value={ex}
                    showErrors={!!errors.exercises}
                    onChange={(v) => update({ exercises: draft.exercises.map((x, j) => (j === i ? v : x)) })}
                    onRemove={() => update({ exercises: draft.exercises.filter((_, j) => j !== i) })}
                  />
                ))}
                {errors.exercises ? (
                  <p role="alert" className="text-sm font-semibold text-alert">
                    {errors.exercises}
                  </p>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Who gave or approved these instructions?" optional htmlFor="auth" help="For example “Dr. Lee, PT”. Shown on your reports as entered by you.">
                    <TextInput id="auth" maxLength={200} value={draft.authorizedBy} onChange={(e) => update({ authorizedBy: e.target.value })} />
                  </Field>
                  <Field label="Date of the instructions" optional htmlFor="authdate">
                    <TextInput id="authdate" type="date" value={draft.authorizationDate} onChange={(e) => update({ authorizationDate: e.target.value })} />
                  </Field>
                </div>
              </div>
            ) : draft.planStatusAnswer ? (
              <Notice tone="info" title="You’ll start with the demonstration plan">
                It contains the four movements PocketRehab can measure, with example numbers for testing the software. PocketRehab does not decide which exercises are right for your condition. Please check with a clinician before doing any of them, and enter your real plan later in My Plan.
              </Notice>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <Field label="Restrictions or precautions from your clinician" optional htmlFor="restrictions" help="Only enter what your clinician told you, in their words if possible. PocketRehab shows these before every session; it can’t check them for you.">
            <TextArea id="restrictions" rows={5} maxLength={2000} value={draft.restrictions} onChange={(e) => update({ restrictions: e.target.value })} placeholder="For example: no lifting above shoulder height until your next visit" />
          </Field>
        ) : null}

        {step === 4 ? (
          <div className="space-y-7">
            <Scale id="b-pain" label="Discomfort right now" value={draft.baseline.pain} onChange={(v) => update({ baseline: { ...draft.baseline, pain: v } })} minLabel="0 · none" maxLabel="10 · worst imaginable" />
            <Scale id="b-fatigue" label="How tired you feel" value={draft.baseline.fatigue} onChange={(v) => update({ baseline: { ...draft.baseline, fatigue: v } })} minLabel="0 · not tired" maxLabel="10 · exhausted" />
            <Scale id="b-difficulty" label="How hard everyday movement feels" value={draft.baseline.difficulty} onChange={(v) => update({ baseline: { ...draft.baseline, difficulty: v } })} minLabel="0 · very easy" maxLabel="10 · extremely hard" />
          </div>
        ) : null}

        {step === 5 ? (
          <div className="space-y-4">
            <ScheduleFields value={draft.schedule} onChange={(schedule) => update({ schedule })} />
            {errors.days ? <p className="text-sm font-semibold text-alert">{errors.days}</p> : null}
          </div>
        ) : null}

        {step === 6 ? <PreferenceFields value={draft.preferences} onChange={(preferences) => update({ preferences })} compact /> : null}

        {step === 7 ? (
          <div className="max-w-[64ch] space-y-5 text-[1.05rem]">
            <Explain title="What the camera is used for">PocketRehab looks at camera frames to estimate where your shoulders, elbows, hips, knees and ankles are, then measures joint angles and counts repetitions.</Explain>
            <Explain title="Where it happens">Entirely in your browser on this device, using Google’s open-source MediaPipe pose model. Video is never recorded, saved or uploaded. Only the numbers (angles, repetition times, tracking quality) are saved.</Explain>
            <Explain title="When you’ll be asked">Your browser asks for camera permission only when you choose to set up the camera. You can always use PocketRehab without it.</Explain>
            <Explain title="Where your data lives">In this browser’s storage on this device. It doesn’t sync to other devices, and clearing site data deletes it, so export a backup from Settings now and then. PocketRehab is not a medical record system.</Explain>
          </div>
        ) : null}

        {step === 8 ? <CameraTest /> : null}

        {step === 9 ? (
          <div className="space-y-6">
            <KeyValue
              items={[
                { label: 'Name', value: draft.displayName || '—' },
                { label: 'Plan', value: draft.planStatusAnswer === 'yes' ? `${draft.exercises.length} exercise${draft.exercises.length === 1 ? '' : 's'} from your clinician` : 'Demonstration plan (not a recommendation)' },
                { label: 'Approved by', value: draft.planStatusAnswer === 'yes' ? draft.authorizedBy || 'Not recorded' : '—' },
                { label: 'Restrictions', value: draft.restrictions ? 'Recorded' : 'None entered' },
                { label: 'Schedule', value: draft.schedule.days.length ? `${draft.schedule.days.map((d) => WEEKDAY_SHORT[d]).join(', ')} at ${formatTime(draft.schedule.time)}` : 'No days chosen' },
                { label: 'Voice coaching', value: draft.preferences.voiceEnabled ? `On · ${draft.preferences.coachingStyle}` : 'Off (captions only)' },
              ]}
            />
            {draft.planStatusAnswer === 'yes' ? (
              <ul className="divide-y divide-rule border-y border-rule">
                {draft.exercises.map((e) => (
                  <li key={e.id} className="py-3">
                    <p className="font-semibold">
                      {EXERCISES[e.exerciseId].name} · {sideLabel(e.side)}
                    </p>
                    <p className="text-ink-2">
                      {describePrescription(e)} · {describeTarget(e.target)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
            <Notice tone="neutral">Finishing setup does not mean you are cleared for any exercise. Follow your clinician’s instructions.</Notice>
            {saveError ? <Notice tone="alert" title="Couldn’t save">{saveError}</Notice> : null}
          </div>
        ) : null}
        {saveError && step !== 9 ? <Notice tone="alert" className="mt-6" title="Something went wrong">{saveError}</Notice> : null}
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-rule bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {step > 0 ? (
            <Button variant="secondary" onClick={back} icon={<ArrowLeft aria-hidden className="size-4" />}>
              Back
            </Button>
          ) : (
            <span className="text-sm text-ink-3">Your progress is saved as you go.</span>
          )}
          <div className="flex gap-2">
            {optionalStep ? (
              <Button variant="quiet" onClick={() => update({ step: step + 1 })}>
                Skip
              </Button>
            ) : null}
            {step < STEPS.length - 1 ? (
              <Button onClick={next}>
                {step === 0 ? 'Get started' : 'Continue'}
                <ArrowRight aria-hidden className="size-4" />
              </Button>
            ) : (
              <Button onClick={finish} loading={saving}>
                Finish setup
              </Button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

const TITLES = [
  'Rehab done right.',
  'About you',
  'Your exercise plan',
  'Restrictions and notes',
  'How you feel today',
  'When do you plan to exercise?',
  'Coaching and accessibility',
  'Privacy and your camera',
  'Test your camera',
  'Review and confirm',
];

const INTROS: ReactNode[] = [
  'PocketRehab helps you follow the rehab plan your clinician gave you at home, and turns your sessions into an honest report you can share at your next appointment.',
  'Only what’s needed to personalise the app. Everything optional can be skipped.',
  'PocketRehab never creates or changes treatment. It follows the plan you enter.',
  'Recording these keeps them in front of you before every session.',
  'A starting point you can compare with later. These are your own ratings, not measurements.',
  'PocketRehab builds a weekly schedule and can remind you while the app is open. You can change this any time.',
  'Choose how the coach talks to you. Captions are always available.',
  'Here is exactly how the camera and your data are handled.',
  'Optional. Check that your camera works and see the body tracking. You can skip this and do it before your first session.',
  'Check everything before saving. You can change any of it later.',
];

function Bullet({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function Explain({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="font-bold">{title}</h2>
      <p className="mt-1 text-ink-2">{children}</p>
    </div>
  );
}
