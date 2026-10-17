import type { CheckIn, Plan, Profile, Session } from '@/lib/validation/schemas';
import { demonstrationExercises } from '@/features/exercises/describe';
import { DEFAULT_PREFERENCES } from '@/features/settings/defaults';
import { MovementEngine } from '@/features/movement-analysis/engine';
import { EXERCISES } from '@/features/exercises/library';
import { generateFrames, seededRandom, standardScript } from '@/features/pose-estimation/synthetic';

/** Deterministic test fixtures. */

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  const now = Date.UTC(2026, 9, 1);
  return {
    id: 'me',
    displayName: 'Test User',
    rehabContext: null,
    affectedArea: null,
    planStatusAnswer: 'yes',
    baseline: null,
    schedule: { days: [1, 3, 5], time: '17:00', remindersEnabled: false, reminderMinutes: 15 },
    preferences: { ...DEFAULT_PREFERENCES },
    equipmentAvailable: {},
    isDemo: false,
    disclaimerAcceptedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    version: 1,
    kind: 'clinician-entered',
    status: 'active',
    authorizedBy: 'Dr. Example, PT',
    authorizationDate: '2026-09-30',
    restrictions: 'No lifting above shoulder height with weights.',
    exercises: demonstrationExercises().slice(0, 1).map((e) => ({ ...e, id: 'ex-1', target: { min: 80, max: 100, source: 'clinician' as const } })),
    createdAt: Date.UTC(2026, 9, 1),
    changeSummary: 'Initial plan',
    changeSource: 'onboarding',
    ...overrides,
  };
}

/** A completed camera session with real engine output from synthetic frames. */
export function makeSession(overrides: Partial<Session> & { peak?: number; startedAt?: number; seed?: number } = {}): Session {
  const def = EXERCISES[overrides.exerciseId ?? 'shoulder-abduction'];
  const side = overrides.side ?? 'right';
  const startedAt = overrides.startedAt ?? Date.UTC(2026, 9, 5, 21);
  const engine = new MovementEngine({ def, side, target: { min: 80, max: 100, source: 'clinician' }, sessionStart: 0 });
  const frames = generateFrames(def, side, def.demo.neutral, standardScript(5, overrides.peak ?? def.demo.peak, { variation: 2, seed: overrides.seed ?? 5 }), {
    noisePx: 1,
    random: seededRandom(overrides.seed ?? 5),
  });
  frames.forEach((f) => engine.process(f));
  const { peak: _p, seed: _s, ...rest } = overrides;
  return {
    id: `s_${startedAt}`,
    exerciseId: def.id,
    exerciseVersion: def.version,
    planVersion: 1,
    planKind: 'clinician-entered',
    prescribedExerciseId: 'ex-1',
    side,
    mode: 'camera',
    status: 'completed',
    startedAt,
    endedAt: startedAt + 60_000,
    lastUpdatedAt: startedAt + 60_000,
    prescription: { sets: 1, reps: 5, holdSeconds: 0, restSeconds: 30, target: { min: 80, max: 100, source: 'clinician' } },
    setsCompleted: 1,
    reps: engine.reps,
    incompleteAttempts: engine.incompleteAttempts,
    summary: engine.fingerprint(),
    quality: engine.qualitySummary(),
    camera: { view: def.cameraView, width: 1280, height: 720, mirrored: true, setupVerified: true, model: 'pose_landmarker_lite', delegate: 'GPU', medianFps: 30, medianInferenceMs: 12, subjectScale: engine.subjectScale() },
    events: [],
    preCheckInId: null,
    postCheckInId: null,
    manualRepsReported: null,
    isDemoData: false,
    notes: '',
    ...rest,
  };
}

export function makeCheckIn(overrides: Partial<CheckIn> = {}): CheckIn {
  return {
    id: `c_${Math.random().toString(36).slice(2)}`,
    kind: 'post',
    sessionId: null,
    timestamp: Date.UTC(2026, 9, 5, 22),
    questionnaireVersion: 'checkin-v1',
    responses: [
      { questionId: 'pain', value: 3 },
      { questionId: 'fatigue', value: 4 },
      { questionId: 'difficulty', value: 5 },
    ],
    outcome: 'none',
    isDemoData: false,
    ...overrides,
  };
}
