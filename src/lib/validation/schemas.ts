import { z } from 'zod';
import type { FormCheckId, MeasurementMethod } from '@/types/form';

/**
 * Persisted data schemas. Every record written to or read from IndexedDB is
 * validated against these, so corrupted or outdated records are detected
 * instead of crashing the app. Types used across the app are inferred from here.
 */

export const SCHEMA_VERSION = 1;

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');
const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a HH:MM time');
const epochMs = z.number().int().nonnegative();

export const exerciseIdSchema = z.enum(['shoulder-abduction', 'elbow-flexion', 'knee-extension', 'sit-to-stand', 'shoulder-flexion', 'hip-abduction', 'standing-knee-flexion', 'standing-march', 'hip-extension', 'mini-squat']);
export const bodySideSchema = z.enum(['left', 'right']);
export const prescribedSideSchema = z.enum(['left', 'right', 'auto']);
export const cameraViewSchema = z.enum(['front', 'side']);
export const validityStateSchema = z.enum(['reliable', 'uncertain', 'unavailable']);

export const targetRangeSchema = z
  .object({
    min: z.number().min(0).max(180),
    max: z.number().min(0).max(180),
    /** Where the number came from. Demo examples are never presented as clinical targets. */
    source: z.enum(['clinician', 'demo-example']),
  })
  .refine((t) => t.min <= t.max, { message: 'Target minimum must not exceed maximum' });

export const prescribedExerciseSchema = z.object({
  id: z.string().min(1),
  exerciseId: exerciseIdSchema,
  side: prescribedSideSchema,
  sets: z.number().int().min(1).max(10),
  reps: z.number().int().min(1).max(50),
  holdSeconds: z.number().min(0).max(120),
  restSeconds: z.number().min(0).max(600),
  target: targetRangeSchema.nullable(),
  cameraMeasurement: z.boolean(),
  enabled: z.boolean(),
  clinicianNotes: z.string().max(1000),
  equipmentNote: z.string().max(300),
});

export const planSchema = z.object({
  version: z.number().int().min(1),
  kind: z.enum(['clinician-entered', 'demonstration']),
  status: z.enum(['active', 'needs-review', 'unavailable']),
  /** Who approved these instructions, exactly as the user typed it (e.g. "Dr. Lee, PT"). */
  authorizedBy: z.string().max(200),
  authorizationDate: dateString.nullable(),
  restrictions: z.string().max(2000),
  exercises: z.array(prescribedExerciseSchema).max(20),
  createdAt: epochMs,
  changeSummary: z.string().max(500),
  changeSource: z.enum(['onboarding', 'clinician-update', 'import', 'status-change', 'demo']),
});

export const preferencesSchema = z.object({
  textScale: z.enum(['100', '115', '130', '150']),
  reducedMotion: z.enum(['system', 'reduce', 'no-preference']),
  highContrast: z.boolean(),
  captions: z.boolean(),
  voiceEnabled: z.boolean(),
  voiceURI: z.string().nullable(),
  speechRate: z.number().min(0.6).max(1.4),
  coachingStyle: z.enum(['calm', 'encouraging', 'minimal']),
  feedbackFrequency: z.enum(['every-rep', 'key-moments']),
  instructionLength: z.enum(['short', 'detailed']),
  demoPanelSize: z.enum(['small', 'large']),
  voiceCommands: z.boolean(),
  mirrorPreview: z.boolean(),
  poseModel: z.enum(['lite', 'full']),
});

export const scheduleSettingsSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).max(7),
  time: timeString,
  remindersEnabled: z.boolean(),
  reminderMinutes: z.number().int().min(0).max(240),
});

export const selfReportSchema = z.object({
  pain: z.number().min(0).max(10).nullable(),
  fatigue: z.number().min(0).max(10).nullable(),
  difficulty: z.number().min(0).max(10).nullable(),
  recordedAt: epochMs,
});

export const profileSchema = z.object({
  id: z.literal('me'),
  displayName: z.string().trim().min(1).max(60),
  rehabContext: z.enum(['post-surgery', 'injury', 'condition', 'other', 'prefer-not']).nullable(),
  affectedArea: z.enum(['shoulder', 'elbow', 'knee', 'hip', 'back', 'other', 'prefer-not']).nullable(),
  planStatusAnswer: z.enum(['yes', 'no', 'unsure']),
  baseline: selfReportSchema.nullable(),
  schedule: scheduleSettingsSchema,
  preferences: preferencesSchema,
  equipmentAvailable: z.record(z.string(), z.boolean()),
  isDemo: z.boolean(),
  disclaimerAcceptedAt: epochMs,
  createdAt: epochMs,
  updatedAt: epochMs,
});

export const qualityFlagSchema = z.enum([
  'no-pose',
  'landmark-missing',
  'low-visibility',
  'out-of-frame',
  'near-edge',
  'implausible-jump',
  'view-mismatch',
  'inference-error',
  'low-light',
]);

// Records keyed by the union types from src/types/form.ts, so adding or removing
// an id there without updating the stored enum is a compile error (exhaustive, no extras).
const FORM_CHECK_IDS: Record<FormCheckId, true> = {
  'elbow-straight': true,
  'arm-to-side': true,
  'shoulder-relaxed': true,
  'trunk-upright': true,
  'upper-arm-still': true,
  'start-straight': true,
  'no-swing': true,
  'sit-tall': true,
  'thigh-still': true,
  'hold-time': true,
  'stand-tall': true,
  'controlled-sit': true,
  'controlled-return': true,
  'steady-pace': true,
  'within-target': true,
};
const MEASUREMENT_METHODS: Record<MeasurementMethod, true> = { '3d-body-frame': true, hybrid: true, '2d': true, none: true };

export const formCheckIdSchema = z.enum(Object.keys(FORM_CHECK_IDS) as [FormCheckId, ...FormCheckId[]]);
export const measurementMethodSchema = z.enum(Object.keys(MEASUREMENT_METHODS) as [MeasurementMethod, ...MeasurementMethod[]]);

/** Per-repetition result of one form check (see src/types/form.ts RepCheck). */
export const repCheckSchema = z.object({
  id: formCheckIdSchema,
  label: z.string().max(80),
  result: z.enum(['pass', 'fail', 'unknown']),
  value: z.number().nullable(),
  unit: z.enum(['°', 's', '%']).nullable(),
});

export const repetitionSchema = z.object({
  index: z.number().int().min(1),
  setIndex: z.number().int().min(1),
  startedAt: z.number(),
  endedAt: z.number(),
  durationMs: z.number().nonnegative(),
  outboundMs: z.number().nonnegative(),
  holdMs: z.number().nonnegative(),
  returnMs: z.number().nonnegative(),
  startValue: z.number(),
  peakValue: z.number(),
  range: z.number(),
  targetMet: z.boolean().nullable(),
  validity: z.enum(['reliable', 'uncertain']),
  reliableFraction: z.number().min(0).max(1),
  speedPeaks: z.number().int().nonnegative().nullable(),
  compensation: z.array(z.string()),
  qualityFlags: z.array(qualityFlagSchema),
  /** Form-check results for this repetition. Defaults keep sessions saved before form checks existed valid. */
  checks: z.array(repCheckSchema).max(20).default([]),
  /** How the joint angle was measured for most of this repetition; older sessions were all 2D. */
  method: measurementMethodSchema.default('2d'),
});

export const incompleteReasonSchema = z.enum(['below-count-threshold', 'too-fast', 'too-slow', 'tracking-lost']);

export const incompleteAttemptSchema = z.object({
  at: z.number(),
  reason: incompleteReasonSchema,
  peakValue: z.number().nullable(),
});

export const qualitySummarySchema = z.object({
  frames: z.number().int().nonnegative(),
  reliable: z.number().min(0).max(1),
  uncertain: z.number().min(0).max(1),
  unavailable: z.number().min(0).max(1),
  flagCounts: z.record(z.string(), z.number().int().nonnegative()),
  state: validityStateSchema,
});

/** Compact per-session "Movement Fingerprint": only reliable repetitions contribute. */
export const fingerprintSchema = z.object({
  valid: z.boolean(),
  validReps: z.number().int().nonnegative(),
  excludedReps: z.number().int().nonnegative(),
  peakMedian: z.number().nullable(),
  peakMax: z.number().nullable(),
  startMedian: z.number().nullable(),
  rangeMedian: z.number().nullable(),
  durationMedianMs: z.number().nullable(),
  outboundMedianMs: z.number().nullable(),
  returnMedianMs: z.number().nullable(),
  holdMedianMs: z.number().nullable(),
  speedPeaksMedian: z.number().nullable(),
  peakCv: z.number().nullable(),
  durationCv: z.number().nullable(),
  restMedianMs: z.number().nullable(),
  compensationCounts: z.record(z.string(), z.number().int().nonnegative()),
  targetMetCount: z.number().int().nonnegative(),
  notes: z.array(z.string()),
});

export const cameraConditionsSchema = z.object({
  view: cameraViewSchema,
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  mirrored: z.boolean(),
  setupVerified: z.boolean(),
  model: z.string(),
  delegate: z.string(),
  medianFps: z.number().nullable(),
  medianInferenceMs: z.number().nullable(),
  /** Median torso length as a fraction of frame height: a proxy for distance to the camera. */
  subjectScale: z.number().nullable(),
});

export const sessionEventSchema = z.object({
  t: z.number(),
  kind: z.enum(['feedback', 'setup', 'paused', 'resumed', 'rest', 'set-complete', 'camera-lost', 'safety', 'rep', 'note']),
  message: z.string().max(300),
});

export const sessionSchema = z.object({
  id: z.string().min(1),
  exerciseId: exerciseIdSchema,
  exerciseVersion: z.string(),
  planVersion: z.number().int().min(1),
  planKind: z.enum(['clinician-entered', 'demonstration']),
  prescribedExerciseId: z.string(),
  side: bodySideSchema,
  mode: z.enum(['camera', 'simulated', 'manual']),
  status: z.enum(['in-progress', 'completed', 'ended-early', 'interrupted']),
  startedAt: epochMs,
  endedAt: epochMs.nullable(),
  lastUpdatedAt: epochMs,
  prescription: z.object({
    sets: z.number().int().min(1),
    reps: z.number().int().min(1),
    holdSeconds: z.number().min(0),
    restSeconds: z.number().min(0),
    target: targetRangeSchema.nullable(),
  }),
  setsCompleted: z.number().int().nonnegative(),
  reps: z.array(repetitionSchema),
  incompleteAttempts: z.array(incompleteAttemptSchema),
  summary: fingerprintSchema.nullable(),
  quality: qualitySummarySchema.nullable(),
  camera: cameraConditionsSchema.nullable(),
  events: z.array(sessionEventSchema).max(600),
  preCheckInId: z.string().nullable(),
  postCheckInId: z.string().nullable(),
  manualRepsReported: z.number().int().nonnegative().nullable(),
  isDemoData: z.boolean(),
  notes: z.string().max(1000),
});

export const checkInResponseValueSchema = z.union([z.number(), z.string(), z.boolean(), z.array(z.string())]).nullable();

export const checkInSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['pre', 'post', 'between']),
  sessionId: z.string().nullable(),
  timestamp: epochMs,
  questionnaireVersion: z.string(),
  responses: z.array(z.object({ questionId: z.string(), value: checkInResponseValueSchema })),
  outcome: z.enum(['none', 'caution', 'urgent']),
  isDemoData: z.boolean(),
});

export const scheduleOverrideSchema = z.object({
  /** The originally planned date this override applies to. */
  date: dateString,
  status: z.enum(['skipped', 'unavailable', 'rescheduled']),
  newDate: dateString.nullable(),
  newTime: timeString.nullable(),
  note: z.string().max(300),
  updatedAt: epochMs,
});

export const frictionReasonSchema = z.enum([
  'forgot',
  'no-time',
  'camera-setup',
  'instructions-confusing',
  'equipment',
  'too-tired',
  'other',
]);

export const frictionReportSchema = z.object({
  id: z.string().min(1),
  timestamp: epochMs,
  date: dateString.nullable(),
  reasons: z.array(frictionReasonSchema).min(1),
  note: z.string().max(500),
});

/**
 * A reading the user entered or imported themselves (clinic goniometer, pain
 * score, a count they kept). Always shown with its source, never mixed into
 * camera statistics.
 */
export const MEASUREMENT_KINDS = {
  angle: { unit: '°', min: -30, max: 200 },
  pain: { unit: '/10', min: 0, max: 10 },
  reps: { unit: 'reps', min: 0, max: 1000 },
  hold: { unit: 's', min: 0, max: 3600 },
  other: { unit: '', min: -1e6, max: 1e6 },
} as const;
export const measurementKindSchema = z.enum(Object.keys(MEASUREMENT_KINDS) as [keyof typeof MEASUREMENT_KINDS, ...Array<keyof typeof MEASUREMENT_KINDS>]);

export const measurementSchema = z
  .object({
    id: z.string().min(1).max(80),
    timestamp: epochMs,
    kind: measurementKindSchema,
    label: z.string().trim().min(1).max(80),
    value: z.number().finite(),
    unit: z.string().max(12),
    side: bodySideSchema.nullable(),
    /** Set when the reading measures the same thing as a library exercise, so it can sit beside the camera's numbers. */
    exerciseId: z.string().max(60).nullable().default(null),
    source: z.enum(['manual', 'import']),
    /** Where the number came from, in the user's words ("Clinic goniometer") or the imported file's name. */
    sourceLabel: z.string().max(80),
    note: z.string().max(500),
    createdAt: epochMs,
  })
  .refine((m) => m.value >= MEASUREMENT_KINDS[m.kind].min && m.value <= MEASUREMENT_KINDS[m.kind].max, { message: 'Value is outside the range this kind of measurement allows', path: ['value'] });

/** Shape of a full data export / backup file. */
export const exportBundleSchema = z.object({
  app: z.literal('PocketRehab'),
  schemaVersion: z.number().int(),
  exportedAt: epochMs,
  profile: profileSchema.nullable(),
  planVersions: z.array(planSchema),
  sessions: z.array(sessionSchema),
  checkIns: z.array(checkInSchema),
  scheduleOverrides: z.array(scheduleOverrideSchema),
  frictionReports: z.array(frictionReportSchema),
  // Optional so backups made before measurements existed still restore.
  measurements: z.array(measurementSchema).default([]),
});

/** Shape of a standalone plan file (for sharing a plan between devices or from a clinician). */
export const planFileSchema = z.object({
  app: z.literal('PocketRehab'),
  type: z.literal('plan'),
  exportedAt: epochMs,
  plan: planSchema,
});

export type ExerciseId = z.infer<typeof exerciseIdSchema>;
export type BodySide = z.infer<typeof bodySideSchema>;
export type PrescribedSide = z.infer<typeof prescribedSideSchema>;
export type CameraView = z.infer<typeof cameraViewSchema>;
export type ValidityState = z.infer<typeof validityStateSchema>;
export type TargetRange = z.infer<typeof targetRangeSchema>;
export type PrescribedExercise = z.infer<typeof prescribedExerciseSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type ScheduleSettings = z.infer<typeof scheduleSettingsSchema>;
export type SelfReport = z.infer<typeof selfReportSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type QualityFlag = z.infer<typeof qualityFlagSchema>;
export type Repetition = z.infer<typeof repetitionSchema>;
export type IncompleteReason = z.infer<typeof incompleteReasonSchema>;
export type IncompleteAttempt = z.infer<typeof incompleteAttemptSchema>;
export type QualitySummary = z.infer<typeof qualitySummarySchema>;
export type MovementFingerprint = z.infer<typeof fingerprintSchema>;
export type CameraConditions = z.infer<typeof cameraConditionsSchema>;
export type SessionEvent = z.infer<typeof sessionEventSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type CheckInResponseValue = z.infer<typeof checkInResponseValueSchema>;
export type CheckIn = z.infer<typeof checkInSchema>;
export type ScheduleOverride = z.infer<typeof scheduleOverrideSchema>;
export type FrictionReason = z.infer<typeof frictionReasonSchema>;
export type FrictionReport = z.infer<typeof frictionReportSchema>;
export type MeasurementKind = z.infer<typeof measurementKindSchema>;
export type Measurement = z.infer<typeof measurementSchema>;
export type ExportBundle = z.infer<typeof exportBundleSchema>;
export type PlanFile = z.infer<typeof planFileSchema>;
