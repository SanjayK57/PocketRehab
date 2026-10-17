import type { CheckIn, CheckInResponseValue } from '@/lib/validation/schemas';

/**
 * Symptom check-in questionnaires and the deterministic safety rules applied
 * to them. These are short check-ins, NOT a medical safety screening.
 *
 * The rules deliberately avoid numeric pain cutoffs: PocketRehab does not invent
 * clinical thresholds. Escalation depends only on (a) the user reporting new
 * or worsening symptoms, or (b) the user checking a general warning sign.
 */

export const QUESTIONNAIRE_VERSION = 'checkin-v1';

export type QuestionType = 'scale' | 'choice' | 'multi' | 'text';

export interface Question {
  id: string;
  type: QuestionType;
  label: string;
  help?: string;
  optional: boolean;
  /** For scales. */
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  /** For choice / multi. */
  options?: Array<{ value: string; label: string }>;
  /** Only show this question for camera sessions. */
  cameraOnly?: boolean;
}

export const WARNING_SIGNS: Array<{ value: string; label: string }> = [
  { value: 'chest', label: 'Chest pain, pressure or tightness' },
  { value: 'breathing', label: 'Trouble breathing' },
  { value: 'faint', label: 'Fainting, or feeling like you might faint' },
  { value: 'severe-pain', label: 'Sudden, severe pain or a new injury' },
  { value: 'numbness', label: 'New numbness, tingling or weakness' },
  { value: 'surgical-site', label: 'Spreading redness, warmth, swelling or fever near a surgical site' },
  { value: 'clinician-flag', label: 'Something my clinician told me to watch out for' },
];

const warningQuestion: Question = {
  id: 'warning-signs',
  type: 'multi',
  label: 'Are you having any of these right now?',
  help: 'Check any that apply. Leave all unchecked if none apply.',
  optional: true,
  options: WARNING_SIGNS,
};

const scale = (id: string, label: string, minLabel: string, maxLabel: string): Question => ({
  id,
  type: 'scale',
  label,
  optional: true,
  min: 0,
  max: 10,
  minLabel,
  maxLabel,
});

export const PRE_SESSION_QUESTIONS: Question[] = [
  {
    id: 'symptom-change',
    type: 'choice',
    label: 'Compared with your last session, how is the area you are working on?',
    optional: true,
    options: [
      { value: 'none', label: 'No discomfort' },
      { value: 'better', label: 'Better' },
      { value: 'same', label: 'About the same' },
      { value: 'worse', label: 'Worse' },
      { value: 'new', label: 'New discomfort I have not had before' },
    ],
  },
  scale('pain', 'Discomfort right now', '0 · none', '10 · worst imaginable'),
  scale('fatigue', 'How tired do you feel?', '0 · not tired', '10 · exhausted'),
  scale('difficulty', 'How hard do you expect this session to feel?', '0 · very easy', '10 · extremely hard'),
  warningQuestion,
];

export const POST_SESSION_QUESTIONS: Question[] = [
  {
    id: 'symptom-change',
    type: 'choice',
    label: 'During or after the session, did you notice new or worsening discomfort?',
    optional: true,
    options: [
      { value: 'no', label: 'No' },
      { value: 'unsure', label: 'Not sure' },
      { value: 'worse', label: 'Yes, it got worse' },
      { value: 'new', label: 'Yes, something new' },
    ],
  },
  scale('pain', 'Discomfort right now', '0 · none', '10 · worst imaginable'),
  scale('fatigue', 'How tired do you feel?', '0 · not tired', '10 · exhausted'),
  scale('difficulty', 'How hard did the session feel?', '0 · very easy', '10 · extremely hard'),
  {
    id: 'instructions-clear',
    type: 'choice',
    label: 'Were the instructions easy to understand?',
    optional: true,
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'mostly', label: 'Mostly' },
      { value: 'no', label: 'No' },
    ],
  },
  {
    id: 'camera-difficult',
    type: 'choice',
    label: 'Was the camera setup difficult?',
    optional: true,
    cameraOnly: true,
    options: [
      { value: 'no', label: 'No' },
      { value: 'somewhat', label: 'Somewhat' },
      { value: 'yes', label: 'Yes' },
    ],
  },
  {
    id: 'coaching-amount',
    type: 'choice',
    label: 'How was the amount of spoken coaching?',
    optional: true,
    options: [
      { value: 'too-much', label: 'Too much' },
      { value: 'right', label: 'About right' },
      { value: 'too-little', label: 'Too little' },
    ],
  },
  { id: 'comment', type: 'text', label: 'Anything that made this session easier or harder?', optional: true },
  warningQuestion,
];

export const BETWEEN_SESSION_QUESTIONS: Question[] = [
  {
    id: 'symptom-change',
    type: 'choice',
    label: 'Since your last session, have your symptoms changed?',
    optional: true,
    options: [
      { value: 'better', label: 'Better' },
      { value: 'same', label: 'About the same' },
      { value: 'worse', label: 'Worse' },
      { value: 'new', label: 'Something new' },
    ],
  },
  scale('pain', 'Discomfort right now', '0 · none', '10 · worst imaginable'),
  scale('fatigue', 'How tired do you feel?', '0 · not tired', '10 · exhausted'),
  { id: 'comment', type: 'text', label: 'Anything you want to remember to tell your clinician?', optional: true },
  warningQuestion,
];

export type SafetyLevel = 'none' | 'caution' | 'urgent';

export interface SafetyOutcome {
  level: SafetyLevel;
  reasons: string[];
}

export type Responses = Record<string, CheckInResponseValue | undefined>;

/**
 * Deterministic safety evaluation.
 * - Any checked warning sign → urgent (direct to urgent/emergency care, no diagnosis).
 * - New or worsening symptoms → caution (pause; follow clinician instructions; contact care team).
 * - Otherwise → none.
 */
export function evaluateSafety(responses: Responses): SafetyOutcome {
  const reasons: string[] = [];
  const signs = responses['warning-signs'];
  const checked = Array.isArray(signs) ? signs.filter((s) => WARNING_SIGNS.some((w) => w.value === s)) : [];
  if (checked.length > 0) {
    checked.forEach((s) => reasons.push(WARNING_SIGNS.find((w) => w.value === s)?.label ?? s));
    return { level: 'urgent', reasons };
  }
  const change = responses['symptom-change'];
  if (change === 'worse') return { level: 'caution', reasons: ['You reported that your symptoms are worse.'] };
  if (change === 'new') return { level: 'caution', reasons: ['You reported new discomfort.'] };
  return { level: 'none', reasons };
}

export const SAFETY_COPY = {
  urgent: {
    title: 'Stop and get help now',
    body: [
      'You reported a symptom that may need prompt medical attention. PocketRehab cannot tell what is causing it.',
      'If this could be an emergency, call 911 or your local emergency number now.',
      'Otherwise, contact your doctor or care team before doing any more exercises.',
    ],
  },
  caution: {
    title: 'Check with your care team first',
    body: [
      'You reported new or worsening discomfort. PocketRehab cannot tell why, and it will not encourage you to push through it.',
      'Follow the instructions your clinician gave you for this situation. If you are not sure what they would want, skip this session and contact your care team.',
    ],
  },
} as const;

export const DISCLAIMER_SHORT =
  'PocketRehab supports adherence to a rehabilitation plan provided or approved by a qualified healthcare professional. Its camera measurements and coaching may be inaccurate and do not replace professional assessment. Follow your clinician’s instructions and stop if you experience concerning symptoms.';

export function responsesToArray(responses: Responses): CheckIn['responses'] {
  return Object.entries(responses)
    .filter(([, v]) => v !== undefined)
    .map(([questionId, value]) => ({ questionId, value: value ?? null }));
}

export function responseValue(checkIn: CheckIn | null | undefined, questionId: string): CheckInResponseValue | undefined {
  return checkIn?.responses.find((r) => r.questionId === questionId)?.value;
}

export function numericResponse(checkIn: CheckIn | null | undefined, questionId: string): number | null {
  const v = responseValue(checkIn, questionId);
  return typeof v === 'number' ? v : null;
}
