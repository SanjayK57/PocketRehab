import type { Plan, ScheduleOverride, ScheduleSettings, Session } from '@/lib/validation/schemas';
import { addDays, dateKey, parseDateKey, weekdayOf } from '@/lib/time/dates';

export type DayStatus = 'upcoming' | 'today' | 'completed' | 'partial' | 'missed' | 'skipped' | 'unavailable';

export interface ScheduledDay {
  date: string;
  time: string;
  origin: 'planned' | 'rescheduled';
  /** For a rescheduled session, the date it was originally planned for. */
  originalDate: string | null;
  status: DayStatus;
  plannedExercises: number;
  completedExercises: number;
  sessionIds: string[];
  note: string;
}

/**
 * Sessions that count toward adherence: completed sessions that are not
 * simulated demos. The demo profile (which only has simulated data) passes
 * includeSimulated so its sample schedule reads correctly.
 */
export function countsTowardAdherence(s: Session, includeSimulated = false): boolean {
  return (includeSimulated || s.mode !== 'simulated') && s.status === 'completed';
}

export function enabledExerciseCount(plan: Plan | null): number {
  return plan ? plan.exercises.filter((e) => e.enabled).length : 0;
}

/**
 * Builds the schedule between two dates (inclusive) from the weekly settings,
 * the user's overrides, and completed sessions. A rescheduled session moves to
 * its new date; it never doubles up with the original. Missed sessions are
 * shown as missed; nothing is automatically added to later days.
 */
export function buildSchedule(
  settings: ScheduleSettings,
  overrides: ScheduleOverride[],
  sessions: Session[],
  plan: Plan | null,
  from: string,
  to: string,
  today: string,
  opts: { includeSimulated?: boolean } = {},
): ScheduledDay[] {
  const byDate = new Map(overrides.map((o) => [o.date, o]));
  const planned = Math.max(1, enabledExerciseCount(plan));
  const completedByDate = new Map<string, Session[]>();
  for (const s of sessions) {
    if (!countsTowardAdherence(s, opts.includeSimulated)) continue;
    const key = dateKey(new Date(s.startedAt));
    completedByDate.set(key, [...(completedByDate.get(key) ?? []), s]);
  }

  const days: ScheduledDay[] = [];
  const make = (date: string, time: string, origin: ScheduledDay['origin'], originalDate: string | null, forced: DayStatus | null, note: string): ScheduledDay => {
    const done = completedByDate.get(date) ?? [];
    const completedExercises = new Set(done.map((s) => s.prescribedExerciseId)).size;
    let status: DayStatus;
    if (forced) status = forced;
    else if (completedExercises >= planned) status = 'completed';
    else if (completedExercises > 0) status = date < today ? 'partial' : date === today ? 'today' : 'partial';
    else status = date < today ? 'missed' : date === today ? 'today' : 'upcoming';
    return { date, time, origin, originalDate, status, plannedExercises: planned, completedExercises, sessionIds: done.map((s) => s.id), note };
  };

  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!settings.days.includes(weekdayOf(d))) continue;
    const o = byDate.get(d);
    if (o?.status === 'rescheduled') continue;
    const forced = o?.status === 'skipped' ? 'skipped' : o?.status === 'unavailable' ? 'unavailable' : null;
    days.push(make(d, settings.time, 'planned', null, forced, o?.note ?? ''));
  }
  for (const o of overrides) {
    if (o.status !== 'rescheduled' || !o.newDate || o.newDate < from || o.newDate > to) continue;
    days.push(make(o.newDate, o.newTime ?? settings.time, 'rescheduled', o.date, null, o.note));
  }
  return days.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
}

export interface AdherenceSummary {
  scheduled: number;
  eligible: number;
  completed: number;
  partial: number;
  missed: number;
  skipped: number;
  unavailable: number;
  /** Completed ÷ eligible, or null when nothing was due yet (not meaningful). */
  percent: number | null;
}

/**
 * Adherence = fully completed scheduled days ÷ days that were due (missed,
 * skipped, partial or completed). Days marked "unavailable" by the user and
 * days still upcoming are excluded.
 */
export function adherence(days: ScheduledDay[]): AdherenceSummary {
  const count = (s: DayStatus) => days.filter((d) => d.status === s).length;
  const completed = count('completed');
  const partial = count('partial');
  const missed = count('missed');
  const skipped = count('skipped');
  const unavailable = count('unavailable');
  const eligible = completed + partial + missed + skipped;
  return {
    scheduled: days.length,
    eligible,
    completed,
    partial,
    missed,
    skipped,
    unavailable,
    percent: eligible === 0 ? null : Math.round((completed / eligible) * 100),
  };
}

/** Checks whether moving a session to `target` would stack two sessions on one day. */
export function rescheduleConflict(target: string, days: ScheduledDay[], movingFrom: string): string | null {
  const clash = days.find((d) => d.date === target && d.date !== movingFrom && d.status !== 'skipped' && d.status !== 'unavailable');
  if (clash) return 'You already have a session planned that day. PocketRehab does not stack sessions; choose another day or skip this one.';
  return null;
}

/** The first scheduled day from today onward that still has work to do. */
export function nextSession(days: ScheduledDay[], today: string): ScheduledDay | null {
  return days.find((d) => d.date >= today && (d.status === 'upcoming' || d.status === 'today' || d.status === 'partial')) ?? null;
}

/** Rough session length estimate from the plan (for calendar exports). Not a prescription. */
export function estimateSessionMinutes(plan: Plan | null): number {
  if (!plan) return 20;
  let seconds = 0;
  for (const e of plan.exercises.filter((x) => x.enabled)) {
    seconds += e.sets * e.reps * (4 + e.holdSeconds) + Math.max(0, e.sets - 1) * e.restSeconds + 90;
  }
  return Math.max(10, Math.ceil(seconds / 60 / 5) * 5);
}

// ---------- iCalendar export ----------

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds lines longer than 75 octets as required by RFC 5545. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    if (currentBytes + len > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = '';
      currentBytes = 0;
    }
    current += ch;
    currentBytes += len;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function icsLocal(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

function icsUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Builds a standard .ics calendar file for upcoming sessions. Times are
 * "floating" local times, so they appear at the chosen hour in any calendar app.
 */
export function buildIcs(days: ScheduledDay[], opts: { minutes: number; reminderMinutes: number | null; exerciseNames: string[]; now?: number }): string {
  const now = opts.now ?? Date.now();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PocketRehab//Rehab Schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const d of days) {
    if (d.status === 'skipped' || d.status === 'unavailable') continue;
    const start = parseDateKey(d.date);
    const [h, m] = d.time.split(':').map(Number);
    start.setHours(h ?? 0, (m ?? 0) + opts.minutes);
    const endKey = dateKey(start);
    const endTime = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${d.date}-${d.time.replace(':', '')}-pocketrehab@local`,
      `DTSTAMP:${icsUtc(now)}`,
      `DTSTART:${icsLocal(d.date, d.time)}`,
      `DTEND:${icsLocal(endKey, endTime)}`,
      fold(`SUMMARY:${icsEscape('PocketRehab rehab session')}`),
      fold(`DESCRIPTION:${icsEscape(`Planned exercises: ${opts.exerciseNames.join(', ') || 'see PocketRehab'}. Follow your clinician's instructions.`)}`),
    );
    if (opts.reminderMinutes !== null) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', fold(`DESCRIPTION:${icsEscape('PocketRehab session reminder')}`), `TRIGGER:-PT${opts.reminderMinutes}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
