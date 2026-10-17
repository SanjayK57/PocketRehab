import type { CheckIn, Plan, Profile, Session } from '@/lib/validation/schemas';
import { EXERCISES } from '@/features/exercises/library';
import { demonstrationExercises } from '@/features/exercises/describe';
import { DEFAULT_PREFERENCES } from '@/features/settings/defaults';
import { MovementEngine } from '@/features/movement-analysis/engine';
import { SIMULATED_PROVIDER_INFO, generateFrames, seededRandom, standardScript } from '@/features/pose-estimation/synthetic';
import { addPlanVersion, clearAllData, newId, saveCheckIn, saveFrictionReport, saveProfile, saveScheduleOverride, saveSession } from '@/lib/storage/repositories';
import { QUESTIONNAIRE_VERSION } from '@/lib/safety/checkins';
import { addDays, dateKey, parseDateKey, weekdayOf } from '@/lib/time/dates';

/**
 * Creates a clearly labeled DEMO profile with simulated history so the
 * progress screens can be explored. Every record is flagged isDemoData and
 * every session has mode "simulated"; the app shows a banner on every screen
 * and offers one-click removal. None of this is a real person's data.
 */
export async function createDemoProfile(now: Date = new Date()): Promise<void> {
  await clearAllData();
  const today = dateKey(now);
  const createdAt = now.getTime() - 22 * 86_400_000;
  const profile: Profile = {
    id: 'me',
    displayName: 'Alex (demo)',
    rehabContext: 'injury',
    affectedArea: 'shoulder',
    planStatusAnswer: 'no',
    baseline: { pain: 4, fatigue: 3, difficulty: 6, recordedAt: createdAt },
    schedule: { days: [1, 3, 5], time: '17:30', remindersEnabled: false, reminderMinutes: 15 },
    preferences: { ...DEFAULT_PREFERENCES },
    equipmentAvailable: { 'sturdy-chair': true },
    isDemo: true,
    disclaimerAcceptedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  };
  // The profile is saved last: the app switches from onboarding to the main
  // screens as soon as a profile exists, so everything else must be ready first.

  const exercises = demonstrationExercises().filter((e) => e.exerciseId === 'shoulder-abduction' || e.exerciseId === 'knee-extension');
  const plan: Omit<Plan, 'version' | 'createdAt'> = {
    kind: 'demonstration',
    status: 'active',
    authorizedBy: '',
    authorizationDate: null,
    restrictions: 'Demo profile: no real restrictions recorded.',
    exercises,
    changeSummary: 'Demo profile created with the demonstration plan',
    changeSource: 'demo',
  };
  await addPlanVersion(plan);

  const rand = seededRandom(2026);
  let n = 0;
  for (let d = addDays(today, -21); d < today; d = addDays(d, 1)) {
    if (![1, 3, 5].includes(weekdayOf(d))) continue;
    n++;
    if (n === 4) {
      // A missed day, with a barrier report, to show how missed sessions are handled.
      await saveFrictionReport({ id: newId('fr'), timestamp: parseDateKey(d).getTime() + 20 * 3_600_000, date: d, reasons: ['no-time'], note: 'Late shift at work.' });
      continue;
    }
    if (n === 7) {
      await saveScheduleOverride({ date: d, status: 'unavailable', newDate: null, newTime: null, note: 'Clinic appointment instead', updatedAt: Date.now() });
      continue;
    }
    for (const [i, ex] of exercises.entries()) {
      const def = EXERCISES[ex.exerciseId];
      const start = parseDateKey(d).getTime() + (17 * 60 + 35 + i * 9) * 60_000;
      const side = ex.side === 'left' ? 'left' : 'right';
      const progress = n / 9;
      const peak = def.demo.neutral + (def.demo.peak - def.demo.neutral) * (0.86 + 0.12 * progress) + (rand() - 0.5) * 4;
      const occluded = n === 5 && i === 0;
      const engine = new MovementEngine({ def, side, target: ex.target, sessionStart: 1000 });
      const reps = ex.sets * ex.reps;
      const frames = generateFrames(def, side, def.demo.neutral, standardScript(reps, peak, { variation: 5, seed: n * 10 + i, holdMs: ex.holdSeconds * 1000 }), {
        noisePx: 1.4,
        random: seededRandom(n * 100 + i),
        visibility: occluded ? { [def.metric.landmarks[side].c]: 0.5 } : undefined,
      });
      for (const f of frames) {
        if (engine.reps.length >= ex.reps && engine.setIndex === 1) engine.setIndex = 2;
        engine.process(f);
      }
      const session: Session = {
        id: newId('demo'),
        exerciseId: def.id,
        exerciseVersion: def.version,
        planVersion: 1,
        planKind: 'demonstration',
        prescribedExerciseId: ex.id,
        side,
        mode: 'simulated',
        status: 'completed',
        startedAt: start,
        endedAt: start + 6 * 60_000,
        lastUpdatedAt: start + 6 * 60_000,
        prescription: { sets: ex.sets, reps: ex.reps, holdSeconds: ex.holdSeconds, restSeconds: ex.restSeconds, target: ex.target },
        setsCompleted: ex.sets,
        reps: engine.reps,
        incompleteAttempts: engine.incompleteAttempts,
        summary: engine.fingerprint(),
        quality: engine.qualitySummary(),
        camera: { view: def.cameraView, width: 1280, height: 720, mirrored: true, setupVerified: true, model: SIMULATED_PROVIDER_INFO.model, delegate: 'none', medianFps: 30, medianInferenceMs: 0, subjectScale: engine.subjectScale() },
        events: [],
        preCheckInId: null,
        postCheckInId: null,
        manualRepsReported: null,
        isDemoData: true,
        notes: occluded ? 'Demo: a sleeve covered the elbow, so tracking was uncertain.' : '',
      };
      if (i === exercises.length - 1) {
        const checkIn: CheckIn = {
          id: newId('demo-ci'),
          kind: 'post',
          sessionId: session.id,
          timestamp: start + 7 * 60_000,
          questionnaireVersion: QUESTIONNAIRE_VERSION,
          responses: [
            { questionId: 'symptom-change', value: n === 6 ? 'worse' : 'no' },
            { questionId: 'pain', value: Math.max(1, Math.round(4 - progress * 2 + (rand() - 0.5) * 2)) },
            { questionId: 'fatigue', value: Math.round(3 + (rand() - 0.5) * 2) },
            { questionId: 'difficulty', value: Math.max(2, Math.round(6 - progress * 2)) },
            { questionId: 'instructions-clear', value: 'yes' },
            { questionId: 'camera-difficult', value: occluded ? 'somewhat' : 'no' },
            ...(n === 6 ? [{ questionId: 'comment', value: 'Shoulder felt more sore than usual after the second set.' }] : []),
          ],
          outcome: n === 6 ? 'caution' : 'none',
          isDemoData: true,
        };
        await saveCheckIn(checkIn);
        session.postCheckInId = checkIn.id;
      }
      await saveSession(session);
    }
  }
  await saveProfile(profile);
}
