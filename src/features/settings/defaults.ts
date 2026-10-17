import type { Preferences, ScheduleSettings } from '@/lib/validation/schemas';

export const DEFAULT_PREFERENCES: Preferences = {
  textScale: '100',
  reducedMotion: 'system',
  highContrast: false,
  captions: true,
  voiceEnabled: true,
  voiceURI: null,
  speechRate: 1,
  coachingStyle: 'calm',
  feedbackFrequency: 'every-rep',
  instructionLength: 'short',
  demoPanelSize: 'small',
  voiceCommands: false,
  mirrorPreview: true,
  poseModel: 'lite',
};

export const DEFAULT_SCHEDULE: ScheduleSettings = {
  days: [1, 3, 5],
  time: '17:30',
  remindersEnabled: false,
  reminderMinutes: 15,
};
