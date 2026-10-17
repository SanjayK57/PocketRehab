import { useEffect, useRef, useState } from 'react';
import type { Profile } from '@/lib/validation/schemas';
import { getMeta, setMeta } from '@/lib/storage/repositories';
import { todayKey } from '@/lib/time/dates';

export interface ReminderState {
  /** The session time (HH:MM today) the in-app reminder is about, when one is due. */
  dueAt: string | null;
  dismiss: () => void;
}

/**
 * In-app reminders. While PocketRehab is open it checks every 30 seconds whether
 * a scheduled session starts within the reminder window, shows an in-app
 * banner, and also posts a browser notification if the user granted that
 * permission. Browsers do not run the page in the background, so reminders
 * cannot be guaranteed when the app is closed; the .ics export covers that.
 */
export function useReminders(profile: Profile | null, sessionDoneToday: boolean): ReminderState {
  const [dueAt, setDueAt] = useState<string | null>(null);
  const notified = useRef<string | null>(null);

  const enabled = !!profile && profile.schedule.remindersEnabled;
  useEffect(() => {
    if (!profile || !profile.schedule.remindersEnabled) return;
    const check = async () => {
      const now = new Date();
      if (!profile.schedule.days.includes(now.getDay()) || sessionDoneToday) {
        setDueAt(null);
        return;
      }
      const [h, m] = profile.schedule.time.split(':').map(Number);
      const start = new Date(now);
      start.setHours(h ?? 0, m ?? 0, 0, 0);
      const minutesUntil = (start.getTime() - now.getTime()) / 60_000;
      const key = `${todayKey(now)} ${profile.schedule.time}`;
      const dismissed = await getMeta<string>('reminderDismissed').catch(() => null);
      if (minutesUntil <= profile.schedule.reminderMinutes && minutesUntil > -60 && dismissed !== key) {
        setDueAt(profile.schedule.time);
        if (notified.current !== key && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          notified.current = key;
          try {
            new Notification('PocketRehab session reminder', { body: `Your planned session is at ${profile.schedule.time}.`, tag: key });
          } catch {
            // Some platforms only allow notifications from a service worker; the in-app banner still shows.
          }
        }
      } else {
        setDueAt(null);
      }
    };
    void check();
    const id = window.setInterval(() => void check(), 30_000);
    return () => window.clearInterval(id);
  }, [profile, sessionDoneToday]);

  return {
    dueAt: enabled ? dueAt : null,
    dismiss: () => {
      if (profile) void setMeta('reminderDismissed', `${todayKey()} ${profile.schedule.time}`);
      setDueAt(null);
    },
  };
}
