import type { ExerciseDefinition } from '@/types/exercise';
import type { FormCheckId, GuidePhase } from '@/types/form';
import type { BodySide, IncompleteReason, Preferences, Repetition, ValidityState } from '@/lib/validation/schemas';
import { LANDMARK_NAMES } from '@/types/pose';
import { EXERCISES } from '@/features/exercises/library';
import { CHECK_TEXT, guideWords } from '@/features/movement-analysis/formChecks';
import { splitSentences } from './voice';

/**
 * Deterministic coaching-message selection. No language model is involved:
 * every message comes from these rules, so the coach can never invent
 * instructions, exercises or medical advice during a session.
 *
 * Core rule: form feedback (form cues, target / compensation messages, red
 * light) is only produced for movement whose tracking was reliable. Uncertain
 * tracking produces a camera/visibility message instead, never a judgement.
 *
 * Speech vs captions: `text` is the caption and may carry exact numbers;
 * `say` (when present) is what is spoken. Spoken sentences come from a finite
 * set (see allSpokenSentences) because the coach voice is pre-recorded, one
 * clip per sentence: counts 1–30, "set n of m" up to 10, a fixed list of rest
 * durations, and fixed cue sentences. Anything outside that set is spoken as a
 * generic sentence while the caption keeps the exact value.
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
  | { type: 'repeat-instruction'; exercise: ExerciseDefinition; detailed: boolean }
  /** A live form check turned to "warn" on reliable tracking. */
  | { type: 'form-cue'; check: FormCheckId; reliable: boolean }
  /** A prescribed hold started, or ended and it is time to return. */
  | { type: 'guide'; phase: Extract<GuidePhase, 'hold' | 'return'>; exercise: ExerciseDefinition };

export interface CoachMessage {
  id: string;
  /** Caption text (may contain exact numbers). */
  text: string;
  /** Spoken text when it differs from the caption; every sentence is in allSpokenSentences(). */
  say?: string;
  speak: boolean;
  /** High-priority messages interrupt speech and bypass the cooldown. */
  priority: 'high' | 'normal' | 'low';
  kind: 'instruction' | 'setup' | 'quality' | 'count' | 'feedback' | 'progress' | 'safety' | 'cue';
}

const COUNT_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
  'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine', 'thirty',
];

/** Highest repetition count spoken as a number. */
export const MAX_SPOKEN_COUNT = 30;
/** Highest set number spoken in "Set n of m". */
export const MAX_SPOKEN_SET = 10;
/** Rest durations (seconds) that have a recorded sentence; others are spoken generically. */
export const SPOKEN_REST_SECONDS = [10, 15, 20, 30, 45, 60, 90, 120, 180] as const;

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Caption and spoken forms of a repetition count. */
function countParts(n: number): { text: string; say: string } {
  const word = n >= 1 && n <= MAX_SPOKEN_COUNT ? cap(COUNT_WORDS[n] as string) : null;
  return { text: word ?? String(n), say: word ?? 'Repetition counted' };
}

/** Traffic-light state for the most recent repetition, gated on tracking quality. */
export function trafficLight(rep: Repetition | null, liveQuality: ValidityState): TrafficLight {
  if (liveQuality !== 'reliable') return 'amber';
  if (!rep) return 'idle';
  if (rep.validity !== 'reliable') return 'amber';
  if (rep.compensation.length > 0 || rep.targetMet === false || rep.checks.some((c) => c.result === 'fail')) return 'red';
  return 'green';
}

export const TRAFFIC_LIGHT_TEXT: Record<TrafficLight, { label: string; description: string }> = {
  idle: { label: 'Waiting', description: 'No repetition measured yet.' },
  green: { label: 'Criteria met', description: 'The configured measurement criteria were met and tracking checks passed.' },
  amber: { label: 'Tracking uncertain', description: 'Tracking is not reliable enough to judge this movement.' },
  red: { label: 'Criterion not met', description: 'A configured, observable criterion was not met. This is a camera estimate, not a clinical judgement.' },
};

function landmarkList(landmarks: number[] | undefined): string[] {
  return (landmarks ?? []).map((i) => LANDMARK_NAMES[i] ?? 'body').filter((v, i, a) => a.indexOf(v) === i);
}

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
      const names = landmarkList(event.landmarks);
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
      const count = countParts(event.repsInSet);
      const both = (rest: string) => ({ text: `${count.text}.${rest}`, say: `${count.say}.${rest}` });
      if (rep.validity !== 'reliable') {
        return { id: 'rep-uncertain', ...both(' The tracking was uncertain, so this repetition was not included in the movement summary.'), speak: true, priority: 'normal', kind: 'quality' };
      }
      const rule = event.exercise.compensationRules.find((r) => rep.compensation.includes(r.id));
      if (rule) return { id: 'rep-compensation', ...both(` ${rule.message}`), speak: true, priority: 'normal', kind: 'feedback' };
      if (rep.targetMet === false) {
        return {
          id: 'rep-target',
          ...both(' The measured movement range differed from the configured target. Only move as far as your plan allows.'),
          speak: prefs.feedbackFrequency === 'every-rep',
          priority: 'normal',
          kind: 'feedback',
        };
      }
      const last = event.repsInSet === event.repsTarget;
      if (minimal) return { id: 'rep', ...both(''), speak: true, priority: 'low', kind: 'count' };
      const extra = encouraging ? (last ? ' Last one of the set. Good effort.' : ' Steady work.') : last ? ' That completes the set.' : '';
      return { id: 'rep', ...both(extra), speak: prefs.feedbackFrequency === 'every-rep' || last, priority: 'low', kind: 'count' };
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
    case 'set-complete': {
      if (event.set >= event.sets) return { id: 'set-complete', text: 'All sets complete.', speak: true, priority: 'high', kind: 'progress' };
      const setText = `Set ${event.set} of ${event.sets} complete.`;
      const setSay = event.sets <= MAX_SPOKEN_SET && event.set >= 1 ? setText : 'Set complete.';
      const restText = event.restSeconds > 0 ? ` Rest for ${event.restSeconds} seconds.` : '';
      const restSay = event.restSeconds <= 0 ? '' : (SPOKEN_REST_SECONDS as readonly number[]).includes(event.restSeconds) ? restText : ' Rest until the timer ends.';
      return { id: 'set-complete', text: setText + restText, say: setSay + restSay, speak: true, priority: 'high', kind: 'progress' };
    }
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
    case 'form-cue':
      // Never a form judgement on uncertain tracking.
      if (!event.reliable) return null;
      return { id: `cue-${event.check}`, text: CHECK_TEXT[event.check].cue, speak: prefs.feedbackFrequency === 'every-rep', priority: 'normal', kind: 'cue' };
    case 'guide':
      return { id: `guide-${event.phase}`, text: `${guideWords(event.exercise)[event.phase]}.`, speak: prefs.feedbackFrequency === 'every-rep', priority: 'low', kind: 'instruction' };
  }
}

/**
 * Prevents the coach from talking over every movement: normal messages wait
 * at least `normalGapMs` after the last spoken message, low-priority ones
 * `lowGapMs`, and identical messages are not repeated within `repeatGapMs`.
 * Repetition counts are never dropped (they are short and queue behind speech).
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
    const gap = msg.priority === 'high' || msg.kind === 'count' ? 0 : msg.priority === 'normal' ? this.normalGapMs : this.lowGapMs;
    if (now - this.lastSpokenAt < gap) return false;
    this.lastSpokenAt = now;
    this.lastById.set(msg.id, now);
    return true;
  }
}

/**
 * Rules for live form cues (caption and voice): at most one cue every
 * `minGapMs`, the same cue not again within `repeatGapMs`, none shortly after a
 * count, progress or safety message (those take priority), and never while
 * tracking is uncertain.
 */
export class FormCueGate {
  private lastCueAt = -Infinity;
  private lastById = new Map<string, number>();
  private priorityAt = -Infinity;

  constructor(
    private minGapMs = 4000,
    private repeatGapMs = 10000,
    private afterPriorityMs = 1800,
  ) {}

  /** Records that a higher-priority message (count, progress, safety) was just given. */
  notePriority(now: number): void {
    this.priorityAt = now;
  }

  allow(id: string, now: number, reliable: boolean): boolean {
    if (!reliable) return false;
    if (now - this.lastCueAt < this.minGapMs) return false;
    if (now - (this.lastById.get(id) ?? -Infinity) < this.repeatGapMs) return false;
    if (now - this.priorityAt < this.afterPriorityMs) return false;
    this.lastCueAt = now;
    this.lastById.set(id, now);
    return true;
  }
}

/** Every non-empty subset of the metric landmarks, in their a/b/c order, for each side. */
function landmarkSubsets(def: ExerciseDefinition, side: BodySide): number[][] {
  const { a, b, c } = def.metric.landmarks[side];
  const all = [a, b, c];
  const out: number[][] = [];
  for (let mask = 1; mask < 8; mask++) out.push(all.filter((_, i) => mask & (1 << i)));
  return out;
}

/** A neutral reliable repetition used to enumerate repetition messages. */
function sampleRep(over: Partial<Repetition>): Repetition {
  return {
    index: 1, setIndex: 1, startedAt: 0, endedAt: 2000, durationMs: 2000, outboundMs: 900, holdMs: 0, returnMs: 1000,
    startValue: 0, peakValue: 0, range: 0, targetMet: true, validity: 'reliable', reliableFraction: 1, speedPeaks: 2,
    compensation: [], qualityFlags: [], checks: [], method: '2d',
    ...over,
  };
}

/**
 * Every sentence the coach can speak, generated from the same rules that
 * speak them (so the list cannot drift from the code), sorted and de-duplicated.
 * This is the voice-pack script: `npm run evaluate` writes it to
 * public/voice/phrases.json, and `npm run voice-pack` records one clip each.
 */
export function allSpokenSentences(): string[] {
  const styles: CoachingStyle[] = ['calm', 'encouraging', 'minimal'];
  const freqs: Array<Pick<Preferences, 'feedbackFrequency'>> = [{ feedbackFrequency: 'every-rep' }, { feedbackFrequency: 'key-moments' }];
  const events: CoachEvent[] = [];
  const defs = Object.values(EXERCISES);
  for (const exercise of defs) {
    for (const detailed of [false, true]) events.push({ type: 'session-start', exercise, detailed }, { type: 'repeat-instruction', exercise, detailed });
    for (const side of ['left', 'right'] as const) for (const landmarks of landmarkSubsets(exercise, side)) events.push({ type: 'setup-issue', issue: 'landmarks', landmarks });
    events.push({ type: 'guide', phase: 'hold', exercise }, { type: 'guide', phase: 'return', exercise });
    for (let n = 1; n <= MAX_SPOKEN_COUNT; n++) {
      for (const repsTarget of [n, n + 1]) {
        const base = { type: 'rep' as const, repsInSet: n, repsTarget, exercise };
        events.push({ ...base, rep: sampleRep({}) }, { ...base, rep: sampleRep({ validity: 'uncertain' }) }, { ...base, rep: sampleRep({ targetMet: false }) });
        for (const rule of exercise.compensationRules) events.push({ ...base, rep: sampleRep({ compensation: [rule.id] }) });
      }
    }
  }
  events.push({ type: 'setup-issue', issue: 'landmarks', landmarks: [] });
  for (const issue of ['no-person', 'view', 'edge', 'low-light'] as const) for (const expectedView of ['front', 'side'] as const) events.push({ type: 'setup-issue', issue, expectedView });
  for (const reason of ['below-count-threshold', 'too-fast', 'too-slow', 'tracking-lost'] as const) events.push({ type: 'incomplete', reason });
  for (let sets = 1; sets <= MAX_SPOKEN_SET; sets++) {
    for (let set = 1; set <= sets; set++) for (const restSeconds of [0, ...SPOKEN_REST_SECONDS]) events.push({ type: 'set-complete', set, sets, restSeconds });
  }
  // Out-of-range values exercise the generic spoken forms.
  events.push({ type: 'set-complete', set: 1, sets: MAX_SPOKEN_SET + 1, restSeconds: 7 });
  events.push({ type: 'rep', repsInSet: MAX_SPOKEN_COUNT + 1, repsTarget: MAX_SPOKEN_COUNT + 2, exercise: defs[0] as ExerciseDefinition, rep: sampleRep({}) });
  for (const check of Object.keys(CHECK_TEXT) as FormCheckId[]) events.push({ type: 'form-cue', check, reliable: true });
  events.push(
    { type: 'tracking-uncertain' },
    { type: 'tracking-restored' },
    { type: 'rest-ending' },
    { type: 'paused' },
    { type: 'resumed' },
    { type: 'session-complete' },
    { type: 'camera-lost' },
  );

  const sentences = new Set<string>();
  for (const event of events) {
    for (const style of styles) {
      for (const prefs of freqs) {
        const msg = selectMessage(event, style, prefs);
        if (msg) for (const s of splitSentences(msg.say ?? msg.text)) sentences.add(s);
      }
    }
  }
  return [...sentences].sort();
}
