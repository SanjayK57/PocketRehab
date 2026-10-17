import type { CheckIn, FrictionReason, FrictionReport, Plan, Session } from '@/lib/validation/schemas';
import { addDays, dateKey } from '@/lib/time/dates';
import { numericResponse, responseValue } from '@/lib/safety/checkins';
import { EXERCISES } from '@/features/exercises/library';
import { adherence, countsTowardAdherence, type AdherenceSummary, type ScheduledDay } from '@/features/scheduling/schedule';
import { interpretChange, isStable, measurableSessions, series, PLATEAU_RULE_TEXT } from './analysis';
import { mean } from '@/features/movement-analysis/filters';

export interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  adherence: AdherenceSummary;
  sessionsCompleted: number;
  validMeasurements: number;
  limitations: string[];
  selfReport: { pain: number | null; fatigue: number | null; difficulty: number | null; checkIns: number; concerning: number };
  changes: string[];
  topics: string[];
  suggestions: string[];
}

export const FRICTION_LABELS: Record<FrictionReason, string> = {
  forgot: 'I forgot',
  'no-time': 'I didn’t have time',
  'camera-setup': 'Camera setup was difficult',
  'instructions-confusing': 'The instructions were confusing',
  equipment: 'Equipment wasn’t available',
  'too-tired': 'I felt too tired',
  other: 'Another reason',
};

/** Logistical suggestions for each barrier. None of them changes the prescribed plan. */
export const FRICTION_SUGGESTIONS: Record<FrictionReason, string> = {
  forgot: 'Turn on reminders in Settings or add your schedule to your calendar with the .ics export.',
  'no-time': 'Try a different session time in Schedule. PocketRehab won’t pile missed sessions onto later days.',
  'camera-setup': 'Review the camera tips on the exercise page, or log the session manually when the camera isn’t practical.',
  'instructions-confusing': 'Write down your questions in a check-in note and ask your clinician to go over the exercise again.',
  equipment: 'Check the equipment list in My Plan. Ask your clinician before substituting anything.',
  'too-tired': 'Mention the fatigue to your clinician. PocketRehab won’t change your plan on its own.',
  other: 'Add a note so you remember to mention it at your next appointment.',
};

function avg(checkIns: CheckIn[], q: string): number | null {
  const v = mean(checkIns.map((c) => numericResponse(c, q)).filter((x): x is number => x !== null));
  return v === null ? null : Math.round(v * 10) / 10;
}

export function buildWeeklySummary(input: {
  weekStart: string;
  days: ScheduledDay[];
  sessions: Session[];
  checkIns: CheckIn[];
  friction: FrictionReport[];
  plan: Plan | null;
  includeSimulated: boolean;
}): WeeklySummary {
  const weekEnd = addDays(input.weekStart, 6);
  const inWeek = (ms: number) => {
    const k = dateKey(new Date(ms));
    return k >= input.weekStart && k <= weekEnd;
  };
  const weekSessions = input.sessions.filter((s) => inWeek(s.startedAt));
  const weekCheckIns = input.checkIns.filter((c) => inWeek(c.timestamp));
  const weekFriction = input.friction.filter((f) => inWeek(f.timestamp));
  const weekDays = input.days.filter((d) => d.date >= input.weekStart && d.date <= weekEnd);

  const completed = weekSessions.filter((s) => countsTowardAdherence(s, input.includeSimulated));
  const measured = measurableSessions(weekSessions, { includeSimulated: input.includeSimulated });

  const limitations: string[] = [];
  const unreliable = weekSessions.filter((s) => s.mode === 'camera' && s.status !== 'in-progress' && !s.summary?.valid).length;
  if (unreliable > 0) limitations.push(`${unreliable} camera session${unreliable === 1 ? '' : 's'} did not have enough reliable tracking to be used as measurements.`);
  const manual = weekSessions.filter((s) => s.mode === 'manual').length;
  if (manual > 0) limitations.push(`${manual} session${manual === 1 ? ' was' : 's were'} logged manually, without camera measurements.`);
  const simulated = weekSessions.filter((s) => s.mode === 'simulated').length;
  if (simulated > 0) limitations.push(`${simulated} simulated demo session${simulated === 1 ? '' : 's'} ${input.includeSimulated ? 'are included as sample data' : 'are excluded from your progress'}.`);
  limitations.push('Camera angles are 2D estimates and are not clinically validated.');

  const changes: string[] = [];
  const topics: string[] = [];
  const allMeasured = measurableSessions(input.sessions.filter((s) => dateKey(new Date(s.startedAt)) <= weekEnd), { includeSimulated: input.includeSimulated });
  const keys = new Set(allMeasured.map((s) => `${s.exerciseId}|${s.side}`));
  for (const key of keys) {
    const [exerciseId, side] = key.split('|') as [Session['exerciseId'], Session['side']];
    const pts = series(allMeasured, exerciseId, side, 'peakMedian');
    const name = `${EXERCISES[exerciseId].shortName} (${side})`;
    changes.push(`${name}: ${interpretChange(pts).message}`);
    if (isStable(pts)) {
      topics.push(`${name}: measured peak angle has been stable across recent sessions. You may want to talk with your clinician about progress expectations. ${PLATEAU_RULE_TEXT}`);
    }
  }

  const concerning = weekCheckIns.filter((c) => c.outcome !== 'none').length;
  if (concerning > 0) topics.push(`You reported new or worsening symptoms or warning signs on ${concerning} check-in${concerning === 1 ? '' : 's'} this week.`);
  const unclear = weekCheckIns.filter((c) => responseValue(c, 'instructions-clear') === 'no').length;
  if (unclear > 0) topics.push(`Instructions were hard to understand in ${unclear} session${unclear === 1 ? '' : 's'}.`);
  if (input.plan?.status === 'needs-review') topics.push('Your plan is marked as needing review.');
  if (input.plan?.status === 'unavailable') topics.push('Your plan is marked as unavailable.');
  const notes = weekCheckIns.map((c) => responseValue(c, 'comment')).filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  notes.slice(0, 3).forEach((n) => topics.push(`Your note: “${n.trim()}”`));

  const reasons = new Set<FrictionReason>();
  weekFriction.forEach((f) => f.reasons.forEach((r) => reasons.add(r)));
  weekCheckIns.filter((c) => responseValue(c, 'camera-difficult') === 'yes').forEach(() => reasons.add('camera-setup'));
  const suggestions = [...reasons].map((r) => FRICTION_SUGGESTIONS[r]);

  return {
    weekStart: input.weekStart,
    weekEnd,
    adherence: adherence(weekDays),
    sessionsCompleted: completed.length,
    validMeasurements: measured.length,
    limitations,
    selfReport: {
      pain: avg(weekCheckIns, 'pain'),
      fatigue: avg(weekCheckIns, 'fatigue'),
      difficulty: avg(weekCheckIns, 'difficulty'),
      checkIns: weekCheckIns.length,
      concerning,
    },
    changes,
    topics,
    suggestions,
  };
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  earned: boolean;
  progress: string;
}

/** Participation-based milestones. No streak penalties, no leaderboards, no claims about recovery. */
export function achievements(sessions: Session[], checkIns: CheckIn[], days: ScheduledDay[], includeSimulated = false): Achievement[] {
  const real = sessions.filter((s) => countsTowardAdherence(s, includeSimulated));
  const reliable = real.filter((s) => (s.mode === 'camera' || (includeSimulated && s.mode === 'simulated')) && s.summary?.valid).length;
  const weeks = new Map<string, ScheduledDay[]>();
  days.forEach((d) => {
    const k = addDays(d.date, -new Date(`${d.date}T12:00:00`).getDay());
    weeks.set(k, [...(weeks.get(k) ?? []), d]);
  });
  const fullWeek = [...weeks.values()].some((w) => {
    const due = w.filter((d) => d.status !== 'unavailable' && d.status !== 'upcoming' && d.status !== 'today');
    return due.length > 0 && due.every((d) => d.status === 'completed');
  });
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const cameBack = sorted.some((d, i) => d.status === 'completed' && sorted.slice(0, i).some((p) => p.status === 'missed' || p.status === 'skipped'));

  return [
    { id: 'first', title: 'First session', description: 'Completed your first planned session.', earned: real.length >= 1, progress: `${Math.min(real.length, 1)} of 1` },
    { id: 'week', title: 'Planned week', description: 'Completed every session that was due in a week.', earned: fullWeek, progress: fullWeek ? 'Done' : 'Not yet' },
    { id: 'reliable', title: 'Clear view', description: 'Recorded 5 camera sessions with reliable tracking.', earned: reliable >= 5, progress: `${Math.min(reliable, 5)} of 5` },
    { id: 'checkins', title: 'Keeping notes', description: 'Logged 5 check-ins to share with your clinician.', earned: checkIns.length >= 5, progress: `${Math.min(checkIns.length, 5)} of 5` },
    { id: 'back', title: 'Picked it back up', description: 'Completed a session after a missed or skipped one.', earned: cameBack, progress: cameBack ? 'Done' : 'Not yet' },
  ];
}
