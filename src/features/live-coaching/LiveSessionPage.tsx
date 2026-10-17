import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, ClipboardPen, MonitorPlay } from 'lucide-react';
import type { BodySide, CheckIn, IncompleteAttempt, Repetition, Session, SessionEvent } from '@/lib/validation/schemas';
import { useAppData } from '@/app/AppData';
import { EXERCISES } from '@/features/exercises/library';
import { describePrescription, describeTarget, sideLabel } from '@/features/exercises/describe';
import { ExerciseDemo } from '@/features/exercises/ExerciseDemo';
import { MovementEngine } from '@/features/movement-analysis/engine';
import { POST_SESSION_QUESTIONS, PRE_SESSION_QUESTIONS, type SafetyOutcome } from '@/lib/safety/checkins';
import { newId, saveProfile, saveScheduleOverride, saveSession } from '@/lib/storage/repositories';
import { todayKey } from '@/lib/time/dates';
import { CheckInForm } from '@/features/check-ins/CheckInForm';
import { SafetyStop } from '@/features/check-ins/SafetyStop';
import { Button, LinkButton, Notice, PageHeader, Section, TextArea, TextInput, Field } from '@/components/ui';
import { CoachThrottle, selectMessage, type CoachEvent, type CoachMessage } from './coach';
import { initialState, sessionReducer, sessionStatusFor, type SessionMode } from './sessionMachine';
import { LiveStage } from './LiveStage';
import { SessionSummary } from './SessionSummary';
import { speak, stopSpeaking } from './voice';
import type { StageStats } from './usePoseStage';
import { useToast } from '@/components/Toast';

export function LiveSessionPage() {
  const { prescribedId } = useParams();
  const [search] = useSearchParams();
  const { profile, plan } = useAppData();
  const navigate = useNavigate();
  const toast = useToast();
  const prescribed = plan?.exercises.find((e) => e.id === prescribedId) ?? null;
  const def = prescribed ? EXERCISES[prescribed.exerciseId] : null;
  const prefs = profile?.preferences;

  const [machine, dispatch] = useReducer(sessionReducer, prescribed ?? { sets: 1, reps: 1, restSeconds: 0 }, (p) => initialState({ sets: p.sets, reps: p.reps, restSeconds: p.restSeconds }));
  const [caption, setCaption] = useState<CoachMessage | null>(null);
  const [safety, setSafety] = useState<SafetyOutcome | null>(null);
  const [preCheckIn, setPreCheckIn] = useState<CheckIn | null>(null);
  const [savedSession, setSavedSession] = useState<Session | null>(null);
  const [coachingAnswer, setCoachingAnswer] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const engineRef = useRef<MovementEngine | null>(null);
  const [sessionId] = useState(() => newId('s'));
  const startedAt = useRef<number | null>(null);
  const events = useRef<SessionEvent[]>([]);
  const statsRef = useRef<StageStats | null>(null);
  const setupVerified = useRef(true);
  const throttle = useRef(new CoachThrottle());
  const lastSaved = useRef(0);
  const machineRef = useRef(machine);
  useLayoutEffect(() => {
    machineRef.current = machine;
  });

  // Side for this session: fixed by the plan, or (sit to stand) whichever leg faces the camera during setup.
  const [autoSide, setAutoSide] = useState<BodySide>('right');
  const side: BodySide = prescribed?.side === 'auto' ? autoSide : prescribed?.side === 'left' ? 'left' : 'right';

  const coach = useCallback(
    (event: CoachEvent) => {
      if (!prefs) return;
      const msg = selectMessage(event, prefs.coachingStyle, prefs);
      if (!msg) return;
      setCaption(msg);
      if (startedAt.current !== null && events.current.length < 600) {
        events.current.push({ t: Date.now() - startedAt.current, kind: msg.kind === 'count' ? 'rep' : msg.kind === 'progress' ? 'note' : msg.kind === 'safety' ? 'camera-lost' : msg.kind === 'setup' || msg.kind === 'quality' ? 'setup' : 'feedback', message: msg.text.slice(0, 300) });
      }
      if (prefs.voiceEnabled && throttle.current.shouldSpeak(msg, performance.now())) {
        speak(msg.text, { rate: prefs.speechRate, voiceURI: prefs.voiceURI, interrupt: msg.priority === 'high' });
      }
    },
    [prefs],
  );

  const ensureEngine = useCallback(() => {
    if (!engineRef.current && def && prescribed) {
      startedAt.current ??= Date.now();
      engineRef.current = new MovementEngine({ def, side, target: prescribed.target, sessionStart: performance.now() });
    }
    return engineRef.current as MovementEngine;
  }, [def, prescribed, side]);

  const buildSession = useCallback(
    (status: Session['status']): Session | null => {
      if (!def || !prescribed || !plan || !profile) return null;
      const m = machineRef.current;
      const engine = engineRef.current;
      const s = statsRef.current;
      const mode = m.mode ?? 'manual';
      const start = startedAt.current ?? Date.now();
      return {
        id: sessionId,
        exerciseId: def.id,
        exerciseVersion: def.version,
        planVersion: plan.version,
        planKind: plan.kind,
        prescribedExerciseId: prescribed.id,
        side,
        mode,
        status,
        startedAt: start,
        endedAt: status === 'in-progress' ? null : Date.now(),
        lastUpdatedAt: Date.now(),
        prescription: { sets: prescribed.sets, reps: prescribed.reps, holdSeconds: prescribed.holdSeconds, restSeconds: prescribed.restSeconds, target: prescribed.target },
        setsCompleted: m.setsCompleted,
        reps: engine?.reps ?? [],
        incompleteAttempts: engine?.incompleteAttempts ?? [],
        summary: engine ? engine.fingerprint() : null,
        quality: engine ? engine.qualitySummary() : null,
        camera:
          mode === 'manual' || !engine
            ? null
            : {
                view: def.cameraView,
                width: s?.width ?? 0,
                height: s?.height ?? 0,
                mirrored: mode === 'camera' && (prefs?.mirrorPreview ?? true),
                setupVerified: mode === 'camera' ? setupVerified.current : false,
                model: s?.model ?? (mode === 'simulated' ? 'synthetic-skeleton' : 'unknown'),
                delegate: s?.delegate || (mode === 'simulated' ? 'none' : 'unknown'),
                medianFps: s?.fps ?? null,
                medianInferenceMs: s?.inferenceMs ?? null,
                subjectScale: engine.subjectScale(),
              },
        events: events.current.slice(-600),
        preCheckInId: preCheckIn?.id ?? null,
        postCheckInId: null,
        manualRepsReported: null,
        isDemoData: profile.isDemo,
        notes: '',
      };
    },
    [def, prescribed, plan, profile, prefs, side, preCheckIn, sessionId],
  );

  const persist = useCallback(
    async (status: Session['status']) => {
      const s = buildSession(status);
      if (!s) return null;
      try {
        const saved = await saveSession(s);
        setSaveError(null);
        return saved;
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [buildSession],
  );

  const onRep = useCallback(
    (rep: Repetition) => {
      if (!def) return;
      const m = machineRef.current;
      dispatch({ type: 'REP', now: Date.now() });
      coach({ type: 'rep', rep, repsInSet: m.repsInSet + 1, repsTarget: m.repsPerSet, exercise: def });
      if (m.repsInSet + 1 >= m.repsPerSet) {
        coach({ type: 'set-complete', set: m.set, sets: m.sets, restSeconds: m.restSeconds });
      }
      if (Date.now() - lastSaved.current > 1000) {
        lastSaved.current = Date.now();
        void persist('in-progress');
      }
    },
    [coach, def, persist],
  );

  const onIncomplete = useCallback((a: IncompleteAttempt) => coach({ type: 'incomplete', reason: a.reason }), [coach]);
  // The side can only change before measuring starts (the engine is created at the countdown).
  const chooseAutoSide = useCallback((s: BodySide) => {
    if (!engineRef.current) setAutoSide(s);
  }, []);
  const onStats = useCallback((s: StageStats) => {
    statsRef.current = s;
  }, []);

  // Each step of the workflow starts at the top of the page.
  useEffect(() => {
    if (machine.phase !== 'active' && machine.phase !== 'paused' && machine.phase !== 'rest') window.scrollTo({ top: 0 });
  }, [machine.phase]);

  // "Log without camera" links open straight into the manual flow.
  const presetMode = useRef(search.get('mode'));
  useEffect(() => {
    if (presetMode.current === 'manual' && machine.phase === 'intro' && prescribed) {
      presetMode.current = null;
      dispatch({ type: 'CHOOSE_MODE', mode: 'manual' });
    }
  }, [machine.phase, prescribed]);

  // Start-of-session announcement and first save.
  const announced = useRef(false);
  useEffect(() => {
    if (machine.phase === 'countdown' && def) {
      ensureEngine();
      if (!announced.current) {
        announced.current = true;
        coach({ type: 'session-start', exercise: def, detailed: prefs?.instructionLength === 'detailed' });
        void persist('in-progress');
      }
    }
    // Saving is asynchronous; any error state it sets happens after the save resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (machine.phase === 'rest' || machine.phase === 'paused' || machine.phase === 'camera-lost') void persist('in-progress');
  }, [machine.phase, def, coach, ensureEngine, persist, prefs?.instructionLength]);

  // Session end: save the final record once the live part finishes.
  const finalized = useRef(false);
  useEffect(() => {
    if (machine.phase === 'checkin-post' && !finalized.current && machine.mode !== 'manual') {
      finalized.current = true;
      // The coach shows a caption (state) in response to the session ending; saving resolves asynchronously.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (machine.endReason === 'completed') coach({ type: 'session-complete' });
      void persist(sessionStatusFor(machine)).then((s) => s && setSavedSession(s));
    }
  }, [machine, coach, persist]);

  // Leaving the page mid-session keeps what was measured and marks it interrupted.
  useEffect(
    () => () => {
      stopSpeaking();
      const m = machineRef.current;
      if (['countdown', 'active', 'paused', 'rest', 'camera-lost'].includes(m.phase) && engineRef.current) {
        const s = buildSession('interrupted');
        if (s) void saveSession(s).catch(() => undefined);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!profile || !plan || !prefs) return null;
  if (!prescribed || !def) {
    return (
      <div className="space-y-4">
        <PageHeader title="Exercise not found" description="This exercise isn’t in your current plan. It may have been removed or changed." />
        <LinkButton to="/session">Choose an exercise</LinkButton>
      </div>
    );
  }
  if (plan.status === 'unavailable') {
    return (
      <div className="space-y-4">
        <PageHeader title="Your plan is marked unavailable" description="Sessions are paused until your plan is updated. Check with your clinician, then update the plan in My Plan." />
        <LinkButton to="/plan">Go to My Plan</LinkButton>
      </div>
    );
  }

  const choose = (mode: SessionMode) => dispatch({ type: 'CHOOSE_MODE', mode });
  const switchMode = (mode: 'simulated' | 'manual') => {
    // Restart the workflow in the new mode; the pre-session check-in already happened.
    dispatch({ type: 'BACK_TO_INTRO' });
    dispatch({ type: 'CHOOSE_MODE', mode });
    dispatch({ type: 'PRE_DONE', outcome: 'none' });
  };

  const header = (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <Link to="/session" className="inline-flex items-center gap-1.5 font-semibold text-accent-strong underline-offset-4 hover:underline">
        <ArrowLeft aria-hidden className="size-4" /> All exercises
      </Link>
      {plan.kind === 'demonstration' ? <p className="text-sm text-signal-ink">Demonstration plan: not a recommendation for you</p> : null}
    </div>
  );

  return (
    <div>
      {header}
      {saveError ? <Notice tone="alert" className="mb-4" title="Saving failed">{saveError}</Notice> : null}

      {machine.phase === 'intro' ? (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-7">
            <PageHeader title={def.name} description={`${sideLabel(prescribed.side)} · ${describePrescription(prescribed)}`} />
            {prescribed.clinicianNotes ? (
              <Section title="Your clinician’s notes">
                <p className="max-w-[65ch]">{prescribed.clinicianNotes}</p>
              </Section>
            ) : null}
            <Section title="How to do it">
              <ol className="max-w-[65ch] list-decimal space-y-1.5 pl-5">
                {def.instructions.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ol>
            </Section>
            <Section title="Camera position">
              <ul className="max-w-[65ch] list-disc space-y-1.5 pl-5">
                {def.cameraSetup.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-ink-2">Target: {describeTarget(prescribed.target)}</p>
            </Section>
            {plan.restrictions ? (
              <Notice tone="warn" title="Your recorded restrictions">
                {plan.restrictions}
              </Notice>
            ) : null}
            {plan.status === 'needs-review' ? <Notice tone="warn" title="Your plan is marked as needing review">Check with your clinician that this exercise is still part of your plan before continuing.</Notice> : null}
            <ul className="max-w-[65ch] space-y-1 text-sm text-ink-2">
              {def.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <Section title="How do you want to do this session?">
              <div className="grid gap-3 sm:grid-cols-3">
                <ModeButton icon={<Camera aria-hidden className="size-6" />} title="Use my camera" body="Counts reps and estimates the angle, with tracking quality shown." disabled={!prescribed.cameraMeasurement} disabledNote="Camera measurement is turned off for this exercise in your plan." onClick={() => choose('camera')} primary />
                <ModeButton icon={<MonitorPlay aria-hidden className="size-6" />} title="Simulated demo" body="Watch a simulated figure do it, to see how tracking works. Not your data." onClick={() => choose('simulated')} />
                <ModeButton icon={<ClipboardPen aria-hidden className="size-6" />} title="Log without camera" body="Do the exercise, then record what you completed." onClick={() => choose('manual')} />
              </div>
            </Section>
          </div>
          <div className="space-y-3">
            <ExerciseDemo def={def} side={side} holdSeconds={prescribed.holdSeconds} size="large" autoplay className="border border-rule" />
            <p className="text-sm text-ink-3">{def.source}</p>
          </div>
        </div>
      ) : null}

      {machine.phase === 'checkin-pre' ? (
        <div>
          <PageHeader title="Quick check before you start" description="Everything is optional. This is not a medical screening." />
          <CheckInForm
            kind="pre"
            questions={PRE_SESSION_QUESTIONS}
            sessionId={sessionId}
            isDemoData={profile.isDemo}
            submitLabel="Continue"
            onDone={({ checkIn, outcome }) => {
              setPreCheckIn(checkIn);
              setSafety(outcome);
              dispatch({ type: 'PRE_DONE', outcome: outcome.level });
            }}
            onSkip={() => dispatch({ type: 'PRE_DONE', outcome: 'none' })}
          />
        </div>
      ) : null}

      {machine.phase === 'safety' && safety ? (
        <SafetyStop
          outcome={safety}
          clinician={plan.authorizedBy}
          context="before"
          onExit={async () => {
            await saveScheduleOverride({ date: todayKey(), status: 'skipped', newDate: null, newTime: null, note: 'Skipped after a symptom check-in', updatedAt: Date.now() }).catch(() => undefined);
            toast.show('Session skipped. Follow your clinician’s instructions.', 'info');
            navigate('/');
          }}
          onContinue={() => dispatch({ type: 'SAFETY_CONTINUE' })}
        />
      ) : null}

      {machine.phase === 'exited' ? (
        <div className="space-y-4">
          <PageHeader title="Session not started" />
          <LinkButton to="/">Back to Home</LinkButton>
        </div>
      ) : null}

      {(machine.mode === 'camera' || machine.mode === 'simulated') && ['camera-setup', 'countdown', 'active', 'paused', 'rest', 'camera-lost'].includes(machine.phase) ? (
        <LiveStage
          key={machine.mode}
          def={def}
          prescribed={prescribed}
          side={side}
          mode={machine.mode}
          machine={machine}
          dispatch={dispatch}
          prefs={prefs}
          engineRef={engineRef}
          ensureEngine={ensureEngine}
          coach={coach}
          caption={caption}
          onRep={onRep}
          onIncomplete={onIncomplete}
          onStats={onStats}
          onSetupVerified={(v) => (setupVerified.current = v)}
          onAutoSide={prescribed.side === 'auto' ? chooseAutoSide : undefined}
          onSwitchToSimulated={() => switchMode('simulated')}
          onSwitchToManual={() => switchMode('manual')}
        />
      ) : null}

      {machine.phase === 'manual-log' ? (
        <ManualLog
          repsPrescribed={prescribed.sets * prescribed.reps}
          onSave={async (reps, sets, notes, completed) => {
            startedAt.current ??= Date.now();
            const base = buildSession(completed ? 'completed' : 'ended-early');
            if (!base) return;
            try {
              const saved = await saveSession({ ...base, mode: 'manual', setsCompleted: sets, manualRepsReported: reps, notes });
              setSavedSession(saved);
              finalized.current = true;
              dispatch({ type: 'MANUAL_DONE' });
            } catch (err) {
              setSaveError(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      ) : null}

      {machine.phase === 'checkin-post' ? (
        <div>
          <PageHeader title={machine.endReason === 'completed' ? 'Session complete' : 'Session ended'} description="How did that feel? Everything is optional." />
          <CheckInForm
            kind="post"
            questions={POST_SESSION_QUESTIONS}
            sessionId={sessionId}
            isDemoData={profile.isDemo}
            cameraSession={machine.mode === 'camera'}
            submitLabel="Save and see summary"
            onDone={async ({ checkIn, outcome, responses }) => {
              setSafety(outcome);
              setCoachingAnswer(typeof responses['coaching-amount'] === 'string' ? (responses['coaching-amount'] as string) : null);
              const current = savedSession ?? buildSession(sessionStatusFor(machine));
              if (current) {
                const saved = await saveSession({ ...current, postCheckInId: checkIn.id }).catch(() => null);
                if (saved) setSavedSession(saved);
              }
              dispatch({ type: 'POST_DONE' });
            }}
            onSkip={() => dispatch({ type: 'POST_DONE' })}
          />
        </div>
      ) : null}

      {machine.phase === 'summary' ? (
        <div className="space-y-8">
          {safety && safety.level !== 'none' ? <SafetyStop outcome={safety} clinician={plan.authorizedBy} context="after" onExit={() => navigate('/')} /> : null}
          <SessionSummary
            session={savedSession}
            def={def}
            coachingAnswer={coachingAnswer}
            onApplyCoaching={async (patch) => {
              await saveProfile({ ...profile, preferences: { ...profile.preferences, ...patch } });
              toast.show('Coaching preference updated.');
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function ModeButton({ icon, title, body, onClick, primary, disabled, disabledNote }: { icon: React.ReactNode; title: string; body: string; onClick: () => void; primary?: boolean; disabled?: boolean; disabledNote?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        primary
          ? 'flex min-h-36 flex-col items-start gap-2 rounded-[var(--radius-card)] bg-accent p-4 text-left text-accent-ink transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-rule-strong'
          : 'flex min-h-36 flex-col items-start gap-2 rounded-[var(--radius-card)] border border-ink/60 p-4 text-left transition-colors hover:border-ink hover:bg-surface-2'
      }
    >
      {icon}
      <span className="text-lg font-bold">{title}</span>
      <span className={primary ? 'text-sm text-accent-ink/90' : 'text-sm text-ink-2'}>{disabled && disabledNote ? disabledNote : body}</span>
    </button>
  );
}

function ManualLog({ repsPrescribed, onSave }: { repsPrescribed: number; onSave: (reps: number, sets: number, notes: string, completed: boolean) => Promise<void> }) {
  const [reps, setReps] = useState<number>(repsPrescribed);
  const [sets, setSets] = useState<number>(1);
  const [notes, setNotes] = useState('');
  const [completed, setCompleted] = useState(true);
  const [busy, setBusy] = useState(false);
  const invalid = !Number.isInteger(reps) || reps < 0 || reps > 500 || !Number.isInteger(sets) || sets < 0 || sets > 20;
  const max = useMemo(() => repsPrescribed, [repsPrescribed]);
  return (
    <form
      className="max-w-xl space-y-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (invalid) return;
        setBusy(true);
        await onSave(reps, sets, notes.trim(), completed);
        setBusy(false);
      }}
    >
      <PageHeader title="Log your session" description="Do the exercise as your clinician instructed, then record what you completed. No camera measurements are made." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Repetitions completed (all sets)" htmlFor="m-reps" help={`Your plan: ${max} in total.`} error={invalid ? 'Enter whole numbers.' : null}>
          <TextInput id="m-reps" type="number" min={0} max={500} value={Number.isFinite(reps) ? reps : ''} onChange={(e) => setReps(Number(e.target.value))} className="num w-32" />
        </Field>
        <Field label="Sets completed" htmlFor="m-sets">
          <TextInput id="m-sets" type="number" min={0} max={20} value={Number.isFinite(sets) ? sets : ''} onChange={(e) => setSets(Number(e.target.value))} className="num w-32" />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="font-semibold">Did you finish the planned session?</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="m-done" checked={completed} onChange={() => setCompleted(true)} /> Yes, all of it
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="m-done" checked={!completed} onChange={() => setCompleted(false)} /> No, I stopped early
        </label>
      </fieldset>
      <Field label="Notes" optional htmlFor="m-notes">
        <TextArea id="m-notes" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Button type="submit" size="lg" loading={busy} disabled={invalid}>
        Save session
      </Button>
    </form>
  );
}
