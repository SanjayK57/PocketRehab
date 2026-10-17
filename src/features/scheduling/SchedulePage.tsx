import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, CalendarPlus, ChevronLeft, ChevronRight, Undo2 } from 'lucide-react';
import type { ScheduleSettings } from '@/lib/validation/schemas';
import { useAppData } from '@/app/AppData';
import { useAllData } from '@/app/useData';
import { deleteScheduleOverride, saveProfile, saveScheduleOverride } from '@/lib/storage/repositories';
import { downloadText, fileStamp } from '@/lib/export/download';
import { addDays, formatDate, formatTime, todayKey, weekStart } from '@/lib/time/dates';
import { EXERCISES } from '@/features/exercises/library';
import { PlanTabs } from '@/features/exercises/PlanPage';
import { Button, ErrorState, Field, LoadingBlock, Notice, PageHeader, Section, Tag, TextInput } from '@/components/ui';
import { DoneRing } from '@/components/tape';
import { useToast } from '@/components/Toast';
import { adherence, buildIcs, buildSchedule, estimateSessionMinutes, rescheduleConflict, type ScheduledDay } from './schedule';
import { ScheduleFields } from './ScheduleFields';

const STATUS_TEXT: Record<ScheduledDay['status'], string> = {
  upcoming: 'Upcoming',
  today: 'Today',
  completed: 'Done',
  partial: 'Partly done',
  missed: 'Missed',
  skipped: 'Skipped',
  unavailable: 'Marked unavailable',
};

export function SchedulePage() {
  const { profile, plan } = useAppData();
  const data = useAllData();
  const toast = useToast();
  const today = todayKey();
  const [anchor, setAnchor] = useState(() => weekStart(today));
  const [moving, setMoving] = useState<ScheduledDay | null>(null);
  const [moveDate, setMoveDate] = useState('');
  const [moveTime, setMoveTime] = useState('');
  const [moveError, setMoveError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ScheduleSettings | null>(null);
  const [notifState, setNotifState] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));

  const sessions = useMemo(() => (data.data?.sessions ?? []).filter((s) => profile?.isDemo || s.mode !== 'simulated'), [data.data, profile?.isDemo]);
  const days = useMemo(() => (profile && data.data ? buildSchedule(profile.schedule, data.data.overrides, sessions, plan, anchor, addDays(anchor, 6), today, { includeSimulated: profile.isDemo }) : []), [profile, data.data, sessions, plan, anchor, today]);
  // Days around the moving session, used to prevent stacking two sessions on one day.
  const nearby = useMemo(() => (profile && data.data ? buildSchedule(profile.schedule, data.data.overrides, sessions, plan, addDays(today, -7), addDays(today, 35), today, { includeSimulated: profile.isDemo }) : []), [profile, data.data, sessions, plan, today]);

  if (!profile || !plan) return null;
  const current = settings ?? profile.schedule;
  const dirty = settings !== null && JSON.stringify(settings) !== JSON.stringify(profile.schedule);
  const week = adherence(days);

  const startMove = (d: ScheduledDay) => {
    setMoving(d);
    setMoveDate(d.date < today ? today : addDays(d.date, 1));
    setMoveTime(d.time);
    setMoveError(null);
  };

  const confirmMove = async () => {
    if (!moving) return;
    if (!moveDate || moveDate < today) {
      setMoveError('Choose today or a later date.');
      return;
    }
    const original = moving.originalDate ?? moving.date;
    const conflict = rescheduleConflict(moveDate, nearby, moving.date);
    if (conflict) {
      setMoveError(conflict);
      return;
    }
    await saveScheduleOverride({ date: original, status: 'rescheduled', newDate: moveDate, newTime: moveTime || null, note: '', updatedAt: Date.now() });
    toast.show(`Moved to ${formatDate(moveDate, { weekday: 'long', month: 'short', day: 'numeric' })}.`);
    setMoving(null);
  };

  const mark = async (d: ScheduledDay, status: 'skipped' | 'unavailable') => {
    await saveScheduleOverride({ date: d.originalDate ?? d.date, status, newDate: null, newTime: null, note: '', updatedAt: Date.now() });
    toast.show(status === 'skipped' ? 'Marked as skipped. Nothing is added to other days.' : 'Marked unavailable. It won’t count against your adherence.');
  };

  const exportIcs = () => {
    const upcoming = buildSchedule(profile.schedule, data.data?.overrides ?? [], sessions, plan, today, addDays(today, 27), today, { includeSimulated: profile.isDemo }).filter((d) => d.status === 'upcoming' || d.status === 'today');
    if (upcoming.length === 0) {
      toast.show('There are no upcoming sessions in the next four weeks to export.', 'info');
      return;
    }
    const ics = buildIcs(upcoming, {
      minutes: estimateSessionMinutes(plan),
      reminderMinutes: profile.schedule.remindersEnabled ? profile.schedule.reminderMinutes : null,
      exerciseNames: plan.exercises.filter((e) => e.enabled).map((e) => EXERCISES[e.exerciseId].name),
    });
    downloadText(ics, `pocketrehab-schedule-${fileStamp()}.ics`, 'text/calendar');
    toast.show(`Calendar file with ${upcoming.length} sessions downloaded. Open it to add them to your calendar app.`);
  };

  const askNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setNotifState(result);
    if (result === 'granted') toast.show('Notifications allowed. They appear while PocketRehab is open.');
  };

  return (
    <div>
      <PageHeader title="My Plan" description="Your weekly schedule. Moving or skipping a session never adds extra work to other days." />
      <PlanTabs />
      {data.status === 'loading' ? <LoadingBlock /> : null}
      {data.status === 'error' ? <ErrorState error={data.error} onRetry={data.reload} /> : null}

      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Section
          title={`Week of ${formatDate(anchor, { month: 'long', day: 'numeric' })}`}
          actions={
            <div className="flex items-center gap-1">
              <Button variant="quiet" size="sm" aria-label="Previous week" onClick={() => setAnchor(addDays(anchor, -7))} icon={<ChevronLeft aria-hidden className="size-4" />} />
              <Button variant="quiet" size="sm" onClick={() => setAnchor(weekStart(today))}>
                This week
              </Button>
              <Button variant="quiet" size="sm" aria-label="Next week" onClick={() => setAnchor(addDays(anchor, 7))} icon={<ChevronRight aria-hidden className="size-4" />} />
            </div>
          }
        >
          <p className="mb-3 text-ink-2">{week.percent === null ? 'No sessions were due yet this week.' : `${week.completed} of ${week.eligible} due sessions completed (${week.percent}%). Days marked unavailable aren’t counted.`}</p>
          {days.length === 0 ? <p className="py-4 text-ink-2">No sessions scheduled this week. Pick days in the schedule settings.</p> : null}
          <ul className="divide-y divide-rule border-y border-rule">
            {days.map((d) => (
              <li key={`${d.date}-${d.origin}`} className="py-4">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <div className="relative w-28 shrink-0">
                    <p className="font-bold">{formatDate(d.date, { weekday: 'long' })}</p>
                    <p className="text-sm text-ink-2">{formatDate(d.date, { month: 'short', day: 'numeric' })}</p>
                    {d.status === 'completed' ? <DoneRing className="pointer-events-none absolute -left-3 -top-2 h-10 w-24 overflow-visible" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="num font-semibold">{formatTime(d.time)}</span>
                      <Tag tone={d.status === 'completed' ? 'ok' : d.status === 'missed' ? 'signal' : d.status === 'today' ? 'accent' : 'neutral'}>{STATUS_TEXT[d.status]}</Tag>
                      {d.origin === 'rescheduled' && d.originalDate ? <span className="text-sm text-ink-2">moved from {formatDate(d.originalDate, { month: 'short', day: 'numeric' })}</span> : null}
                    </p>
                    <p className="text-sm text-ink-2">
                      {d.completedExercises} of {d.plannedExercises} exercises done
                    </p>
                    {d.status === 'missed' ? (
                      <Link to={`/checkin?barriers=1&date=${d.date}`} className="text-sm font-semibold text-accent-strong underline underline-offset-4">
                        What got in the way?
                      </Link>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {['upcoming', 'today', 'missed', 'partial'].includes(d.status) && d.date >= addDays(today, -7) ? (
                      <Button size="sm" variant="secondary" onClick={() => startMove(d)}>
                        Reschedule
                      </Button>
                    ) : null}
                    {['upcoming', 'today', 'missed'].includes(d.status) ? (
                      <>
                        <Button size="sm" variant="quiet" onClick={() => void mark(d, 'skipped')}>
                          Skip
                        </Button>
                        <Button size="sm" variant="quiet" onClick={() => void mark(d, 'unavailable')}>
                          Unavailable
                        </Button>
                      </>
                    ) : null}
                    {d.status === 'skipped' || d.status === 'unavailable' || d.origin === 'rescheduled' ? (
                      <Button
                        size="sm"
                        variant="quiet"
                        icon={<Undo2 aria-hidden className="size-4" />}
                        onClick={async () => {
                          await deleteScheduleOverride(d.originalDate ?? d.date);
                          toast.show('Change undone.');
                        }}
                      >
                        Undo
                      </Button>
                    ) : null}
                  </div>
                </div>
                {moving && moving.date === d.date && moving.origin === d.origin ? (
                  <div className="mt-4 rounded-[var(--radius-card)] bg-surface-2 p-4">
                    <p className="mb-3 font-semibold">Move this session to:</p>
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label="Date" htmlFor="mv-date">
                        <TextInput id="mv-date" type="date" min={today} value={moveDate} onChange={(e) => setMoveDate(e.target.value)} />
                      </Field>
                      <Field label="Time" htmlFor="mv-time">
                        <TextInput id="mv-time" type="time" value={moveTime} onChange={(e) => setMoveTime(e.target.value)} />
                      </Field>
                      <Button onClick={() => void confirmMove()}>Move session</Button>
                      <Button variant="quiet" onClick={() => setMoving(null)}>
                        Cancel
                      </Button>
                    </div>
                    {moveError ? (
                      <p role="alert" className="mt-2 text-sm font-semibold text-alert">
                        {moveError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>

        <div className="space-y-10">
          <Section title="Add to your calendar">
            <p className="mb-3 text-ink-2">Download a standard .ics file of the next four weeks. It works with Apple Calendar, Google Calendar and Outlook, and includes a reminder if you turned reminders on. PocketRehab isn’t connected to any calendar account.</p>
            <Button variant="secondary" onClick={exportIcs} icon={<CalendarPlus aria-hidden className="size-4" />}>
              Download calendar file
            </Button>
          </Section>
          <Section title="Browser notifications">
            {notifState === 'unsupported' ? (
              <p className="text-ink-2">This browser doesn’t support notifications. In-app reminders and the calendar file still work.</p>
            ) : notifState === 'granted' ? (
              <p className="text-ink-2">Allowed. Reminders appear as notifications while PocketRehab is open in a tab or installed window.</p>
            ) : notifState === 'denied' ? (
              <p className="text-ink-2">Blocked in your browser settings. In-app reminders and the calendar file still work.</p>
            ) : (
              <>
                <p className="mb-3 text-ink-2">Optional. Browsers can only show these while PocketRehab is open; they can’t wake a closed app.</p>
                <Button variant="secondary" onClick={() => void askNotifications()} icon={<BellRing aria-hidden className="size-4" />}>
                  Allow notifications
                </Button>
              </>
            )}
          </Section>
        </div>
      </div>

      <Section title="Schedule settings" className="mt-12 max-w-3xl">
        <ScheduleFields value={current} onChange={setSettings} />
        {current.days.length === 0 ? <Notice tone="warn" className="mt-4">With no days selected, nothing is scheduled and reminders stay off.</Notice> : null}
        <div className="mt-5 flex gap-2">
          <Button
            disabled={!dirty}
            onClick={async () => {
              if (!settings) return;
              await saveProfile({ ...profile, schedule: settings });
              setSettings(null);
              toast.show('Schedule saved.');
            }}
          >
            Save schedule
          </Button>
          {dirty ? (
            <Button variant="quiet" onClick={() => setSettings(null)}>
              Discard changes
            </Button>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
