import type { ExerciseDefinition } from '@/types/exercise';
import type { IncompleteReason, Preferences, Repetition, ValidityState } from '@/lib/validation/schemas';
import { LANDMARK_NAMES } from '@/types/pose';

/**
 * Deterministic coaching-message selection. No language model is involved:
 * every message comes from these rules, so the coach can never invent
 * instructions, exercises or medical advice during a session.
 *
 * Core rule: form feedback (target / compensation messages, red light) is only
 * produced for repetitions whose tracking was reliable. Uncertain tracking
 * produces a camera/visibility message instead, never a judgement of form.
 */

export type CoachingStyle = Preferences['coachingStyle'];
export type TrafficLight = 'idle' | 'green' | 'amber' | 'red';

export type CoachEvent =
  | { type: 'session-start'; exercise: ExerciseDefinition; detailed: boolean }
  | { type: 'setup-issue'; issue: 'no-person' | 'landmarks' | 'view' | 'edge' | 'low-light'; landmarks?: number[]; expectedView?: 'front' | 'side' }
  | { type: 'tracking-uncertain' }
  | { type: 'tracking-restored' }
  | { type: 'rep'; rep: Repetition; repsInSet: number; repsTarget: number; exercise: ExerciseDefinition }
  | { type: 'incomplete'; reason: IncompleteReason }
  | { type: 'set-complete'; set: number; sets: number; restSeconds: number }
  | { type: 'rest-ending' }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'session-complete' }
  | { type: 'camera-lost' }
  | { type: 'repeat-instruction'; exercise: ExerciseDefinition; detailed: boolean };

export interface CoachMessage {
  id: string;
  text: string;
  speak: boolean;
  /** High-priority messages interrupt speech and bypass the cooldown. */
  priority: 'high' | 'normal' | 'low';
  kind: 'instruction' | 'setup' | 'quality' | 'count' | 'feedback' | 'progress' | 'safety';
}

const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Traffic-light state for the most recent repetition, gated on tracking quality. */
export function trafficLight(rep: Repetition | null, liveQuality: ValidityState): TrafficLight {
  if (liveQuality !== 'reliable') return 'amber';
  if (!rep) return 'idle';
  if (rep.validity !== 'reliable') return 'amber';
  if (rep.compensation.length > 0 || rep.targetMet === false) return 'red';
  return 'green';
}

export const TRAFFIC_LIGHT_TEXT: Record<TrafficLight, { label: string; description: string }> = {
  idle: { label: 'Waiting', description: 'No repetition measured yet.' },
  green: { label: 'Criteria met', description: 'The configured measurement criteria were met and tracking checks passed.' },
  amber: { label: 'Tracking uncertain', description: 'Tracking is not reliable enough to judge this movement.' },
  red: { label: 'Criterion not met', description: 'A configured, observable criterion was not met. This is a camera estimate, not a clinical judgement.' },
};

export function selectMessage(event: CoachEvent, style: CoachingStyle, prefs: Pick<Preferences, 'feedbackFrequency'> = { feedbackFrequency: 'every-rep' }): CoachMessage | null {
  const minimal = style === 'minimal';
  const encouraging = style === 'encouraging';
  switch (event.type) {
    case 'session-start': {
      const text = event.detailed ? event.exercise.instructions.join(' ') : event.exercise.shortInstruction;
      return { id: 'start', text: minimal ? event.exercise.shortInstruction : `${event.exercise.name}. ${text}`, speak: true, priority: 'high', kind: 'instruction' };
    }
    case 'repeat-instruction': {
      const text = event.detailed ? event.exercise.instructions.join(' ') : event.exercise.shortInstruction;
      return { id: 'repeat', text, speak: true, priority: 'high', kind: 'instruction' };
    }
    case 'setup-issue': {
      const names = (event.landmarks ?? []).map((i) => LANDMARK_NAMES[i] ?? 'body').filter((v, i, a) => a.indexOf(v) === i);
      const text =
        event.issue === 'no-person'
          ? 'I can’t see a person yet. Step into view of the camera.'
          : event.issue === 'landmarks'
            ? `Your ${names.length ? names.join(' and ') : 'body'} ${names.length > 1 ? 'are' : 'is'} difficult to see. Try adjusting the camera or stepping back.`
            : event.issue === 'view'
              ? event.expectedView === 'front'
                ? 'This exercise needs you to face the camera.'
                : 'This exercise needs a side view. Turn so your side faces the camera.'
              : event.issue === 'edge'
                ? 'Part of your body is at the edge of the picture. Step toward the middle.'
                : 'The picture looks dark. Try adding light in front of you.';
      return { id: `setup-${event.issue}`, text, speak: true, priority: 'normal', kind: 'setup' };
    }
    case 'tracking-uncertain':
      return {
        id: 'uncertain',
        text: minimal ? 'Tracking uncertain. Check the camera view.' : 'Tracking is uncertain right now, so I won’t judge your movement. Check that your whole body part is in view.',
        speak: true,
        priority: 'normal',
        kind: 'quality',
      };
    case 'tracking-restored':
      return { id: 'restored', text: 'Tracking is reliable again.', speak: !minimal, priority: 'low', kind: 'quality' };
    case 'rep': {
      const { rep } = event;
      const count = cap(countWord(event.repsInSet));
      if (rep.validity !== 'reliable') {
        return {
          id: 'rep-uncertain',
          text: `${count}. The tracking was uncertain, so this repetition was not included in the movement summary.`,
          speak: true,
          priority: 'normal',
          kind: 'quality',
        };
      }
      const rule = event.exercise.compensationRules.find((r) => rep.compensation.includes(r.id));
      if (rule) {
        return { id: 'rep-compensation', text: `${count}. ${rule.message}`, speak: true, priority: 'normal', kind: 'feedback' };
      }
      if (rep.targetMet === false) {
        return {
          id: 'rep-target',
          text: `${count}. The measured movement range differed from the configured target. Only move as far as your plan allows.`,
          speak: prefs.feedbackFrequency === 'every-rep',
          priority: 'normal',
          kind: 'feedback',
        };
      }
      const last = event.repsInSet === event.repsTarget;
      if (minimal) return { id: 'rep', text: count, speak: true, priority: 'low', kind: 'count' };
      const extra = encouraging ? (last ? ' Last one of the set. Good effort.' : ' Steady work.') : last ? ' That completes the set.' : '';
      return {
        id: 'rep',
        text: `${count}.${extra}`,
        speak: prefs.feedbackFrequency === 'every-rep' || last,
        priority: 'low',
        kind: 'count',
      };
    }
    case 'incomplete':
      if (event.reason === 'below-count-threshold') {
        return {
          id: 'incomplete-range',
          text: 'That movement wasn’t counted because it didn’t reach the counting range. Only move as far as your plan allows.',
          speak: !minimal,
          priority: 'normal',
          kind: 'feedback',
        };
      }
      if (event.reason === 'tracking-lost') {
        return { id: 'incomplete-tracking', text: 'I lost sight of you during that movement, so it wasn’t counted.', speak: true, priority: 'normal', kind: 'quality' };
      }
      return null;
    case 'set-complete':
      return {
        id: 'set-complete',
        text:
          event.set >= event.sets
            ? 'All sets complete.'
            : `Set ${event.set} of ${event.sets} complete.${event.restSeconds > 0 ? ` Rest for ${event.restSeconds} seconds.` : ''}`,
        speak: true,
        priority: 'high',
        kind: 'progress',
      };
    case 'rest-ending':
      return { id: 'rest-ending', text: 'Rest is over. Start the next set when you’re ready.', speak: true, priority: 'high', kind: 'progress' };
    case 'paused':
      return { id: 'paused', text: 'Session paused. Review your instructions before continuing.', speak: true, priority: 'high', kind: 'progress' };
    case 'resumed':
      return { id: 'resumed', text: 'Resuming.', speak: !minimal, priority: 'high', kind: 'progress' };
    case 'session-complete':
      return {
        id: 'complete',
        text: minimal ? 'Session complete.' : encouraging ? 'Session complete. Thank you for showing up for your plan today.' : 'Session complete. Your results are saved on this device.',
        speak: true,
        priority: 'high',
        kind: 'progress',
      };
    case 'camera-lost':
      return { id: 'camera-lost', text: 'The camera stopped. Your progress so far is saved.', speak: true, priority: 'high', kind: 'safety' };
  }
}

/**
 * Prevents the coach from talking over every movement: normal messages wait
 * at least `normalGapMs` after the last spoken message, low-priority ones
 * `lowGapMs`, and identical messages are not repeated within `repeatGapMs`.
 */
export class CoachThrottle {
  private lastSpokenAt = -Infinity;
  private lastById = new Map<string, number>();

  constructor(
    private normalGapMs = 2500,
    private lowGapMs = 1200,
    private repeatGapMs = 8000,
  ) {}

  shouldSpeak(msg: CoachMessage, now: number): boolean {
    if (!msg.speak) return false;
    const lastSame = this.lastById.get(msg.id);
    if (msg.priority !== 'high' && msg.kind !== 'count' && lastSame !== undefined && now - lastSame < this.repeatGapMs) return false;
    const gap = msg.priority === 'high' ? 0 : msg.priority === 'normal' ? this.normalGapMs : this.lowGapMs;
    if (now - this.lastSpokenAt < gap) return false;
    this.lastSpokenAt = now;
    this.lastById.set(msg.id, now);
    return true;
  }
}
