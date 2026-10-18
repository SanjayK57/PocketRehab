import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type MutableRefObject } from 'react';
import { AlertTriangle, Camera, CameraOff, CheckCircle2, CircleDashed, Mic, Pause, Play, RotateCcw, Square, XCircle } from 'lucide-react';
import type { PoseFrame } from '@/types/pose';
import type { ExerciseDefinition } from '@/types/exercise';
import type { BodySide, IncompleteAttempt, Preferences, PrescribedExercise, Repetition, ValidityState } from '@/lib/validation/schemas';
import { LANDMARK_NAMES } from '@/types/pose';
import { MovementEngine } from '@/features/movement-analysis/engine';
import { LiveQualityWindow, evaluateFrame, type MetricSample } from '@/features/movement-analysis/quality';
import { ANALYSIS_CONFIG } from '@/features/movement-analysis/config';
import { CAMERA_ERROR_HELP, CameraError } from '@/features/camera/camera';
import { ExerciseDemo } from '@/features/exercises/ExerciseDemo';
import { Button, Notice, cx } from '@/components/ui';
import { TapeSwatch } from '@/components/tape';
import { ConfirmDialog } from '@/components/Dialog';
import { usePoseStage, type StageStats } from './usePoseStage';
import { OverlayState, drawOverlay, fitCanvas, type OverlayStage } from './arRenderer';
import { FormCueGate, TRAFFIC_LIGHT_TEXT, trafficLight, type CoachEvent, type CoachMessage, type TrafficLight } from './coach';
import type { GuidePhase, LiveForm } from '@/types/form';
import { useReducedMotion } from '@/app/usePreferencesEffect';
import { SimulatedStage } from '@/features/simulation/SimulatedStage';
import { canRender3D } from '@/features/simulation/Figure3D';
import type { MachineEvent, MachineState } from './sessionMachine';
import { startVoiceCommands } from './voice';

export interface SetupChecks {
  person: boolean;
  landmarks: Array<{ index: number; name: string; ok: boolean }>;
  view: 'ok' | 'mismatch' | 'unknown';
  inFrame: boolean;
  light: 'ok' | 'dark' | 'unknown';
}

interface Hud {
  value: number | null;
  quality: ValidityState;
  light: TrafficLight;
  checks: SetupChecks | null;
  ready: boolean;
  lastRep: Repetition | null;
  form: LiveForm | null;
}

const READY_HOLD_MS = 1500;
const UNCERTAIN_ANNOUNCE_MS = 1500;

export function LiveStage({
  def,
  prescribed,
  side,
  mode,
  machine,
  dispatch,
  prefs,
  engineRef,
  ensureEngine,
  coach,
  caption,
  onRep,
  onIncomplete,
  onStats,
  onSetupVerified,
  onSwitchToSimulated,
  onSwitchToManual,
  onAutoSide,
}: {
  def: ExerciseDefinition;
  prescribed: PrescribedExercise;
  side: BodySide;
  mode: 'camera' | 'simulated';
  machine: MachineState;
  dispatch: Dispatch<MachineEvent>;
  prefs: Preferences;
  engineRef: MutableRefObject<MovementEngine | null>;
  ensureEngine: () => MovementEngine;
  coach: (e: CoachEvent) => void;
  caption: CoachMessage | null;
  onRep: (rep: Repetition) => void;
  onIncomplete: (a: IncompleteAttempt) => void;
  onStats: (s: StageStats) => void;
  onSetupVerified: (verified: boolean) => void;
  onSwitchToSimulated: () => void;
  onSwitchToManual: () => void;
  /** For exercises measured on the side facing the camera: reports which side is more visible during setup. */
  onAutoSide?: (side: BodySide) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const machineRef = useRef(machine);
  useLayoutEffect(() => {
    machineRef.current = machine;
  });
  const live = useRef(new LiveQualityWindow());
  const lastHud = useRef(0);
  const readySince = useRef<number | null>(null);
  const uncertainSince = useRef<number | null>(null);
  const announcedUncertain = useRef(false);
  const lastRepRef = useRef<Repetition | null>(null);
  const stageStatsRef = useRef<StageStats>({ fps: null, inferenceMs: null, delegate: '', model: '', width: 0, height: 0, reducedRate: false, brightness: null });
  const [hud, setHud] = useState<Hud>({ value: null, quality: 'unavailable', light: 'idle', checks: null, ready: false, lastRep: null, form: null });
  const overlay = useRef(new OverlayState());
  const frameRef = useRef<PoseFrame | null>(null);
  const cueGate = useRef(new FormCueGate());
  const formRef = useRef<LiveForm | null>(null);
  const lastGuide = useRef<GuidePhase | null>(null);
  const reduced = useReducedMotion(prefs.reducedMotion);
  const reducedRef = useRef(reduced);
  useLayoutEffect(() => {
    reducedRef.current = reduced;
  });
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const mirrored = mode === 'camera' && prefs.mirrorPreview;
  const target = prescribed.target;

  const onFrame = useCallback(
    (frame: PoseFrame) => {
      const phase = machineRef.current.phase;
      frameRef.current = frame;
      let sample: MetricSample;
      let value: number | null;
      if (phase === 'active' && engineRef.current) {
        const upd = engineRef.current.process(frame);
        sample = upd.sample;
        value = upd.smoothed ?? sample.value;
        formRef.current = upd.form;
        if (upd.newRep) {
          lastRepRef.current = upd.newRep;
          cueGate.current.notePriority(performance.now());
          onRep(upd.newRep);
        }
        if (upd.incomplete) onIncomplete(upd.incomplete);
      } else {
        sample = evaluateFrame(frame, def, side);
        value = sample.value;
        formRef.current = null;
      }
      const t = frame.timestamp;
      live.current.push(t, sample.state);
      const quality = live.current.state(t);

      // Announce sustained uncertain tracking during the exercise (never as form feedback).
      if (phase === 'active') {
        if (quality !== 'reliable') {
          uncertainSince.current ??= t;
          if (!announcedUncertain.current && t - uncertainSince.current > UNCERTAIN_ANNOUNCE_MS) {
            announcedUncertain.current = true;
            const missing = frame.landmarks ? (['a', 'b', 'c'] as const).map((k) => def.metric.landmarks[side][k]).filter((i) => (frame.landmarks?.[i]?.visibility ?? 0) < ANALYSIS_CONFIG.visibilityReliable) : [];
            if (!frame.landmarks) coach({ type: 'setup-issue', issue: 'no-person' });
            else if (sample.flags.includes('view-mismatch')) coach({ type: 'setup-issue', issue: 'view', expectedView: def.cameraView });
            else if (missing.length) coach({ type: 'setup-issue', issue: 'landmarks', landmarks: missing });
            else coach({ type: 'tracking-uncertain' });
          }
        } else {
          uncertainSince.current = null;
          if (announcedUncertain.current) {
            announcedUncertain.current = false;
            coach({ type: 'tracking-restored' });
          }
        }
      }

      // Form cues: the first check that is failing, if the gate allows a cue now (never on uncertain tracking).
      const form = formRef.current;
      if (phase === 'active' && form) {
        const now = performance.now();
        const failing = form.checks.find((c) => c.state === 'warn');
        if (failing && cueGate.current.allow(failing.id, now, quality === 'reliable')) coach({ type: 'form-cue', check: failing.id, reliable: true });
        // Spoken "Hold" / "Lower slowly" only for exercises with a prescribed hold, so plain reps stay quiet.
        const gp = form.guide.phase;
        if (gp !== lastGuide.current) {
          if (prescribed.holdSeconds > 0 && lastGuide.current !== null && (gp === 'hold' || gp === 'return')) coach({ type: 'guide', phase: gp, exercise: def });
          lastGuide.current = gp;
        }
      }

      // Pick the side facing the camera (higher average visibility of hip, knee, ankle).
      if (phase === 'camera-setup' && onAutoSide && frame.landmarks) {
        const vis = (ids: number[]) => ids.reduce((s, i) => s + (frame.landmarks?.[i]?.visibility ?? 0), 0) / ids.length;
        const better: BodySide = vis([23, 25, 27]) >= vis([24, 26, 28]) ? 'left' : 'right';
        if (better !== side) onAutoSide(better);
      }

      // Setup checklist.
      let checks: SetupChecks | null = null;
      let ready = false;
      if (phase === 'camera-setup') {
        const { a, b, c } = def.metric.landmarks[side];
        checks = {
          person: !!frame.landmarks,
          landmarks: [a, b, c].map((i) => ({ index: i, name: LANDMARK_NAMES[i] ?? 'body point', ok: (frame.landmarks?.[i]?.visibility ?? 0) >= ANALYSIS_CONFIG.visibilityReliable })),
          view: sample.view === 'unknown' ? 'unknown' : sample.flags.includes('view-mismatch') ? 'mismatch' : 'ok',
          inFrame: !!frame.landmarks && !sample.flags.includes('out-of-frame') && !sample.flags.includes('near-edge'),
          light: stageStatsRef.current.brightness === null ? 'unknown' : stageStatsRef.current.brightness < ANALYSIS_CONFIG.lowLightLuma ? 'dark' : 'ok',
        };
        const allOk = checks.person && checks.landmarks.every((l) => l.ok) && checks.view !== 'mismatch' && checks.inFrame;
        if (allOk) {
          readySince.current ??= t;
          ready = t - readySince.current >= READY_HOLD_MS;
        } else {
          readySince.current = null;
        }
      }

      const light = trafficLight(lastRepRef.current, quality);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        fitCanvas(canvas);
        const stage: OverlayStage = phase === 'camera-setup' ? 'setup' : phase === 'countdown' ? 'countdown' : phase === 'active' ? 'active' : 'idle';
        drawOverlay(
          ctx,
          {
            pose: { landmarks: frame.landmarks, world: frame.world ?? null, points: sample.points, frameWidth: frame.imageWidth, frameHeight: frame.imageHeight },
            def,
            side,
            value,
            target,
            quality,
            form: phase === 'active' ? form : null,
            stage,
            setupFitted: readySince.current !== null,
            mirrored,
            showBody: mode !== 'simulated' || !canRender3D(),
            showInstruments: sample.points !== null,
            reducedMotion: reducedRef.current,
            now: t,
            avoid: [],
          },
          overlay.current,
        );
      }

      if (t - lastHud.current > 120) {
        lastHud.current = t;
        setHud({ value, quality, light, checks, ready, lastRep: lastRepRef.current, form: phase === 'active' ? form : null });
      }
    },
    [coach, def, engineRef, mirrored, onIncomplete, onRep, side, target, onAutoSide, prescribed.holdSeconds, mode],
  );

  const { videoRef, status: stageStatus, error: stageError, stats: stageStats, start: startStage, stop: stopStage } = usePoseStage({
    mode,
    def,
    side,
    modelVariant: prefs.poseModel,
    holdSeconds: prescribed.holdSeconds,
    onFrame,
    onCameraLost: () => {
      dispatch({ type: 'CAMERA_LOST' });
      coach({ type: 'camera-lost' });
    },
  });
  useLayoutEffect(() => {
    stageStatsRef.current = stageStats;
  });

  useEffect(() => onStats(stageStats), [stageStats, onStats]);

  // The simulated stage starts on its own; the camera only after an explicit click.
  // (The stage stops itself on unmount, so this also recovers from React's development double-mount.)
  useEffect(() => {
    if (mode === 'simulated') void startStage();
  }, [mode, startStage]);

  // Countdown → active.
  useEffect(() => {
    if (machine.phase !== 'countdown') return;
    const id = window.setTimeout(() => dispatch({ type: 'COUNTDOWN_DONE' }), 3000);
    return () => window.clearTimeout(id);
  }, [machine.phase, dispatch]);

  // Entering active: fresh motion state so nothing spans a pause or rest.
  const prevPhase = useRef(machine.phase);
  useEffect(() => {
    if (machine.phase === 'active' && prevPhase.current !== 'active') {
      const engine = ensureEngine();
      engine.resetMotionState();
      engine.setIndex = machine.set;
      live.current.reset();
      overlay.current.reset();
      lastGuide.current = null;
      uncertainSince.current = null;
      announcedUncertain.current = false;
    }
    prevPhase.current = machine.phase;
  }, [machine.phase, machine.set, ensureEngine]);

  // Rest timer and camera-stall detection.
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
      const m = machineRef.current;
      if (m.phase === 'rest' && m.restEndsAt !== null && Date.now() >= m.restEndsAt) {
        dispatch({ type: 'REST_DONE' });
        coach({ type: 'rest-ending' });
      }
      if (m.phase === 'active' && engineRef.current) {
        const lost = engineRef.current.tick(performance.now());
        if (lost) onIncomplete(lost);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [dispatch, coach, engineRef, onIncomplete]);

  // Pause automatically if the tab is hidden (the browser stops delivering frames).
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && ['active', 'rest', 'countdown'].includes(machineRef.current.phase)) {
        dispatch({ type: 'PAUSE', now: Date.now() });
        coach({ type: 'paused' });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [dispatch, coach]);

  const pause = useCallback(() => {
    dispatch({ type: 'PAUSE', now: Date.now() });
    coach({ type: 'paused' });
  }, [dispatch, coach]);
  const resume = useCallback(() => {
    dispatch({ type: 'RESUME', now: Date.now() });
    coach({ type: 'resumed' });
  }, [dispatch, coach]);
  const repeat = useCallback(() => coach({ type: 'repeat-instruction', exercise: def, detailed: prefs.instructionLength === 'detailed' }), [coach, def, prefs.instructionLength]);

  // Keyboard shortcuts: Space pause/resume, R repeat, Escape end.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      // Typing in a field never triggers shortcuts; Space and R on a focused button keep their normal meaning.
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || target?.isContentEditable || target?.closest('dialog')) return;
      if (tag === 'BUTTON' && e.key !== 'Escape') return;
      const p = machineRef.current.phase;
      if (e.code === 'Space') {
        if (p === 'active' || p === 'rest' || p === 'countdown') {
          e.preventDefault();
          pause();
        } else if (p === 'paused') {
          e.preventDefault();
          resume();
        }
      } else if (e.key === 'r' || e.key === 'R') {
        repeat();
      } else if (e.key === 'Escape' && ['active', 'rest', 'paused', 'countdown'].includes(p)) {
        // Consume the key and open on the next tick: otherwise the same Escape press is
        // delivered to the just-opened dialog as a "close" request and shuts it immediately.
        e.preventDefault();
        window.setTimeout(() => setConfirmEnd(true), 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pause, resume, repeat]);

  // Optional voice commands.
  const livePhase = ['countdown', 'active', 'rest', 'paused'].includes(machine.phase);
  useEffect(() => {
    if (!prefs.voiceCommands || !livePhase) return;
    return startVoiceCommands(
      (cmd) => {
        if (cmd === 'pause') pause();
        else if (cmd === 'resume' && machineRef.current.phase === 'paused') resume();
        else if (cmd === 'repeat') repeat();
        else if (cmd === 'end') setConfirmEnd(true);
      },
      (msg) => setVoiceError(msg),
    );
  }, [prefs.voiceCommands, livePhase, pause, resume, repeat]);

  const startCamera = () => void startStage();
  const reconnect = () => {
    dispatch({ type: 'RECONNECT' });
    void startStage();
  };
  const endSession = () => {
    setConfirmEnd(false);
    stopStage();
    dispatch({ type: 'END' });
  };

  const cameraHelp = stageError instanceof CameraError ? CAMERA_ERROR_HELP[stageError.kind] : stageError ? { title: 'Pose tracking could not start', body: `${stageError.message} You can still use a simulated demo or log your session manually.` } : null;
  const restLeft = machine.phase === 'rest' && machine.restEndsAt ? Math.max(0, Math.ceil((machine.restEndsAt - now) / 1000)) : null;
  const isSetup = machine.phase === 'camera-setup';

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* Stage */}
      <div className="min-w-0">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[var(--radius-card)] bg-stage text-stage-ink sm:aspect-video">
          {mode === 'camera' ? <video ref={videoRef} className="absolute inset-0 size-full object-cover" style={{ transform: mirrored ? 'scaleX(-1)' : undefined }} muted playsInline aria-label="Live camera preview" /> : null}
          {mode === 'simulated' && canRender3D() ? <SimulatedStage frameRef={frameRef} def={def} side={side} reducedMotion={reduced} className="absolute inset-0 size-full" /> : null}
          <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden />
          {mode === 'simulated' ? (
            <p className="absolute left-3 top-3 rounded-full bg-signal px-3 py-1 text-sm font-bold text-white">Simulated demo · not your camera</p>
          ) : null}

          {isSetup && stageStatus !== 'running' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
              {stageStatus === 'requesting-camera' ? (
                <p className="text-lg">Waiting for camera permission…</p>
              ) : stageStatus === 'loading-model' ? (
                <p className="text-lg">Loading the on-device pose model…</p>
              ) : cameraHelp ? (
                <CameraOff aria-hidden className="size-10 text-stage-ink-2" />
              ) : (
                <>
                  <Camera aria-hidden className="size-10 text-stage-ink-2" />
                  <p className="max-w-md text-stage-ink-2">The camera is off. When you turn it on, your browser will ask for permission. Video stays on this device and is never recorded.</p>
                  <Button size="lg" onClick={startCamera} icon={<Camera aria-hidden className="size-5" />}>
                    Turn on camera
                  </Button>
                </>
              )}
            </div>
          ) : null}

          {machine.phase === 'active' && hud.form ? <GuideBanner form={hud.form} /> : null}

          {machine.phase === 'countdown' ? (
            <div className="absolute inset-0 flex items-center justify-center bg-stage/55">
              <p className="text-center text-2xl font-bold" aria-live="assertive">
                Get into the start position
                <span className="mt-2 block text-base font-normal text-stage-ink-2">{def.phases[0]?.description}</span>
              </p>
            </div>
          ) : null}

          {machine.phase === 'rest' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-stage/80 p-6 text-center">
              <p className="text-lg text-stage-ink-2">
                Set {machine.set} of {machine.sets} complete · rest
              </p>
              <p className="num text-7xl font-bold" aria-live="off">
                {restLeft}
                <span className="text-3xl">s</span>
              </p>
              <Button variant="secondary" className="border-stage-ink/60 text-stage-ink hover:bg-stage-2" onClick={() => dispatch({ type: 'REST_DONE' })}>
                Start next set now
              </Button>
            </div>
          ) : null}

          {machine.phase === 'paused' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-stage/85 p-6 text-center">
              <p className="text-2xl font-bold">Session paused</p>
              <p className="max-w-md text-stage-ink-2">Review your instructions before continuing. {def.shortInstruction}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="lg" onClick={resume} icon={<Play aria-hidden className="size-5" />}>
                  Resume
                </Button>
                <Button size="lg" variant="secondary" className="border-stage-ink/60 text-stage-ink hover:bg-stage-2" onClick={() => setConfirmEnd(true)}>
                  End session
                </Button>
              </div>
            </div>
          ) : null}

          {machine.phase === 'camera-lost' ? (
            <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-stage/90 p-6 text-center">
              <CameraOff aria-hidden className="size-10" />
              <p className="text-2xl font-bold">The camera stopped</p>
              <p className="max-w-md text-stage-ink-2">It may have been disconnected or taken by another app. Everything measured so far is saved. Nothing will be repeated or added.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="lg" onClick={reconnect}>
                  Reconnect camera
                </Button>
                <Button size="lg" variant="secondary" className="border-stage-ink/60 text-stage-ink hover:bg-stage-2" onClick={endSession}>
                  End and save
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {cameraHelp && isSetup ? (
          <Notice
            tone="warn"
            className="mt-4"
            title={cameraHelp.title}
            actions={
              <>
                <Button size="sm" onClick={startCamera}>
                  Try again
                </Button>
                <Button size="sm" variant="secondary" onClick={onSwitchToSimulated}>
                  Use simulated demo
                </Button>
                <Button size="sm" variant="secondary" onClick={onSwitchToManual}>
                  Log without camera
                </Button>
              </>
            }
          >
            {cameraHelp.body}
          </Notice>
        ) : null}

        {stageStats.reducedRate ? (
          <p className="mt-3 text-sm text-ink-2">This device is processing frames slowly, so tracking runs at a reduced rate (about 15 per second). Measurements are still checked for quality.</p>
        ) : null}

        {/* Captions */}
        {prefs.captions && !isSetup ? (
          <div aria-live="polite" className="mt-4 min-h-16 rounded-[var(--radius-card)] bg-ink px-5 py-4 text-xl font-semibold leading-snug text-ground sm:text-2xl">
            {caption ? caption.text : <span className="text-rail-ink-2">Captions will appear here.</span>}
          </div>
        ) : !isSetup ? (
          <p aria-live="polite" className="sr-only">
            {caption?.text}
          </p>
        ) : null}
      </div>

      {/* Side panel */}
      <aside aria-label="Session controls" className="min-w-0 space-y-5">
        {isSetup ? (
          <SetupPanel def={def} checks={hud.checks} ready={hud.ready} running={stageStatus === 'running'} stats={stageStats} onStart={() => { onSetupVerified(true); dispatch({ type: 'SETUP_READY' }); }} onStartAnyway={() => { onSetupVerified(false); dispatch({ type: 'SETUP_READY' }); }} onSimulated={onSwitchToSimulated} onManual={onSwitchToManual} />
        ) : (
          <>
            <div>
              <h2 className="text-xl font-bold leading-tight">{def.name}</h2>
              <p className="text-ink-2">
                {side === 'left' ? 'Left side' : 'Right side'} · Set {Math.min(machine.set, machine.sets)} of {machine.sets}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-4 border-t border-ink pt-3">
              <div>
                <p className="text-sm text-ink-2">Repetitions</p>
                <p className="num text-5xl font-bold leading-none" aria-live="polite">
                  {machine.repsInSet}
                  <span className="text-2xl font-normal text-ink-3">/{machine.repsPerSet}</span>
                </p>
              </div>
              <div>
                <p className="text-sm text-ink-2">{def.metric.shortLabel}</p>
                <p className={cx('num text-5xl font-bold leading-none', hud.quality !== 'reliable' && 'text-ink-3')}>
                  {hud.value === null ? '—' : Math.round(hud.value)}
                  <span className="text-2xl font-normal">°</span>
                </p>
              </div>
              <p className="col-span-2 mt-2 text-sm text-ink-2">
                {target ? (
                  <>
                    Target {target.min}–{target.max}° <span className="text-ink-3">({target.source === 'clinician' ? 'from your clinician' : 'demo example'})</span>
                  </>
                ) : (
                  'No target angle set'
                )}
                {prescribed.holdSeconds > 0 ? ` · hold ${prescribed.holdSeconds} s` : ''}
              </p>
            </div>
            <TrafficLightPanel light={hud.light} quality={hud.quality} />
            <FormChecksPanel form={hud.form} lastRep={hud.lastRep} />
            <div className="flex flex-wrap gap-2">
              {machine.phase === 'paused' ? (
                <Button size="lg" onClick={resume} icon={<Play aria-hidden className="size-5" />}>
                  Resume
                </Button>
              ) : (
                <Button size="lg" variant="secondary" onClick={pause} disabled={!['active', 'rest', 'countdown'].includes(machine.phase)} icon={<Pause aria-hidden className="size-5" />}>
                  Pause
                </Button>
              )}
              <Button size="lg" variant="secondary" onClick={repeat} icon={<RotateCcw aria-hidden className="size-5" />}>
                Repeat
              </Button>
              <Button size="lg" variant="quiet" onClick={() => setConfirmEnd(true)} icon={<Square aria-hidden className="size-4" />}>
                End
              </Button>
            </div>
            <p className="text-sm text-ink-3">
              Keys: Space pause/resume · R repeat · Esc end
              {prefs.voiceCommands ? (
                <span className="mt-1 flex items-center gap-1.5">
                  <Mic aria-hidden className="size-4" /> Voice: “pause”, “resume”, “repeat”, “end session”
                </span>
              ) : null}
            </p>
            {voiceError ? <Notice tone="warn">{voiceError}</Notice> : null}
            <ExerciseDemo def={def} side={side} holdSeconds={prescribed.holdSeconds} size={prefs.demoPanelSize === 'large' ? 'large' : 'small'} className="border border-rule" />
          </>
        )}
      </aside>

      <ConfirmDialog open={confirmEnd} onCancel={() => setConfirmEnd(false)} onConfirm={endSession} title="End this session?" confirmLabel="End and save">
        <p>
          You’ve completed {machine.totalReps} repetition{machine.totalReps === 1 ? '' : 's'}. What was measured so far will be saved and marked as ended early. Missed repetitions are never added to a later session.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function TrafficLightPanel({ light, quality }: { light: TrafficLight; quality: ValidityState }) {
  const rows: Array<{ key: TrafficLight; swatch: 'reliable' | 'uncertain' | 'signal' }> = [
    { key: 'green', swatch: 'reliable' },
    { key: 'amber', swatch: 'uncertain' },
    { key: 'red', swatch: 'signal' },
  ];
  return (
    <div className="border-t border-ink pt-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-bold">Last repetition</h3>
        <span className={cx('text-sm font-semibold', quality === 'reliable' ? 'text-ok' : quality === 'uncertain' ? 'text-warn' : 'text-ink-3')}>
          Tracking {quality}
        </span>
      </div>
      <ul className="space-y-1.5" aria-label="Feedback indicator">
        {rows.map((r) => {
          const on = light === r.key;
          return (
            <li key={r.key} aria-current={on ? 'true' : undefined} className={cx('flex items-start gap-3 rounded-[var(--radius-control)] px-2.5 py-2 transition-colors', on ? 'bg-surface-2' : 'opacity-45')}>
              <TapeSwatch kind={r.swatch} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block font-semibold">{TRAFFIC_LIGHT_TEXT[r.key].label}</span>
                {on ? <span className="block text-sm text-ink-2">{TRAFFIC_LIGHT_TEXT[r.key].description}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {light === 'idle' ? <p className="mt-2 text-sm text-ink-3">{TRAFFIC_LIGHT_TEXT.idle.description}</p> : null}
    </div>
  );
}

function SetupPanel({ def, checks, ready, running, stats, onStart, onStartAnyway, onSimulated, onManual }: { def: ExerciseDefinition; checks: SetupChecks | null; ready: boolean; running: boolean; stats: StageStats; onStart: () => void; onStartAnyway: () => void; onSimulated: () => void; onManual: () => void }) {
  const item = (ok: boolean | null, label: string, hint?: string) => (
    <li className="flex items-start gap-2.5 py-1.5">
      {ok === null ? <CircleDashed aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-3" /> : ok ? <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-ok" /> : <XCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-signal-ink" />}
      <span>
        <span className="font-semibold">{label}</span>
        <span className="sr-only">: {ok === null ? 'not checked yet' : ok ? 'OK' : 'needs attention'}</span>
        {hint && ok === false ? <span className="block text-sm text-ink-2">{hint}</span> : null}
      </span>
    </li>
  );
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Camera setup</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">
          {def.cameraSetup.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
      <div className="border-t border-ink pt-3">
        <h3 className="font-bold">Checks</h3>
        <ul role="status" aria-live="polite">
          {item(checks ? checks.person : null, 'A person is in view', 'Step into the picture.')}
          {checks
            ? checks.landmarks.map((l) => item(l.ok, `${l.name[0]?.toUpperCase()}${l.name.slice(1)} visible`, 'Make sure it isn’t covered or out of the picture.'))
            : item(null, 'Required body points visible')}
          {item(checks ? (checks.view === 'unknown' ? null : checks.view === 'ok') : null, def.cameraView === 'front' ? 'Facing the camera' : 'Side-on to the camera', def.cameraView === 'front' ? 'Turn to face the camera.' : 'Turn so your side faces the camera.')}
          {item(checks ? checks.inFrame : null, 'Whole movement inside the picture', 'Step back or toward the middle.')}
          {item(checks ? (checks.light === 'unknown' ? null : checks.light === 'ok') : null, 'Enough light', 'Add light in front of you; avoid a bright window behind you.')}
        </ul>
        {running && stats.fps ? (
          <p className="mt-2 text-sm text-ink-3">
            Tracking at {stats.fps} frames/s{stats.delegate ? ` (${stats.delegate})` : ''}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Button size="lg" className="w-full" disabled={!ready} onClick={onStart}>
          {ready ? 'Start exercise' : running ? 'Waiting for all checks…' : 'Turn on the camera first'}
        </Button>
        {running && !ready ? (
          <Button variant="quiet" className="w-full" onClick={onStartAnyway} icon={<AlertTriangle aria-hidden className="size-4" />}>
            Start anyway (measurements may be marked uncertain)
          </Button>
        ) : null}
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
          <button type="button" className="font-semibold text-accent-strong underline underline-offset-4" onClick={onSimulated}>
            Use simulated demo instead
          </button>
          <button type="button" className="font-semibold text-accent-strong underline underline-offset-4" onClick={onManual}>
            Log without camera
          </button>
        </div>
      </div>
    </div>
  );
}

/** Large on-stage instruction for the current phase, with a hold countdown when the plan has a hold. */
function GuideBanner({ form }: { form: LiveForm }) {
  const { guide } = form;
  const holdLeft = guide.phase === 'hold' && guide.hold ? Math.max(0, Math.ceil((guide.hold.requiredMs - guide.hold.heldMs) / 1000)) : null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-stage/80 to-transparent px-5 pb-4 pt-10">
      <p className="text-3xl font-bold leading-none text-white sm:text-4xl" aria-hidden>
        {guide.instruction}
        {holdLeft !== null ? <span className="num ml-3 text-tape">{holdLeft}</span> : null}
      </p>
      {guide.pastTarget ? <p className="rounded-full bg-signal px-3 py-1 text-sm font-bold text-white">Past your target</p> : guide.inTarget ? <p className="rounded-full bg-tape px-3 py-1 text-sm font-bold text-white">In target</p> : null}
    </div>
  );
}

const CHECK_SWATCH = { ok: 'reliable', warn: 'signal', unknown: 'uncertain' } as const;

/** Live form checks while moving, and how the last repetition went. Unknown means "not judged", never "wrong". */
function FormChecksPanel({ form, lastRep }: { form: LiveForm | null; lastRep: Repetition | null }) {
  const lastChecks = lastRep?.checks ?? [];
  if (!form && lastChecks.length === 0) return null;
  return (
    <div className="border-t border-ink pt-3">
      <h3 className="mb-2 font-bold">Form checks</h3>
      {form ? (
        <ul className="space-y-1" aria-label="Live form checks">
          {form.checks.map((c) => (
            <li key={c.id} className={cx('flex items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5 transition-colors', c.state === 'warn' && 'bg-surface-2')}>
              <TapeSwatch kind={CHECK_SWATCH[c.state]} />
              <span className="min-w-0 flex-1 font-semibold">{c.label}</span>
              <span className={cx('text-sm', c.state === 'warn' ? 'font-semibold text-signal-ink' : 'text-ink-3')}>{c.state === 'ok' ? 'Good' : c.state === 'warn' ? 'Adjust' : 'Not judged'}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {lastChecks.length > 0 ? (
        <p className="mt-2 text-sm text-ink-2">
          Last repetition:{' '}
          {lastChecks.every((c) => c.result !== 'fail')
            ? lastChecks.some((c) => c.result === 'pass')
              ? 'all checks passed.'
              : 'tracking was uncertain, so form was not judged.'
            : `to work on: ${lastChecks
                .filter((c) => c.result === 'fail')
                .map((c) => c.label.toLowerCase())
                .join(', ')}.`}
        </p>
      ) : null}
    </div>
  );
}
