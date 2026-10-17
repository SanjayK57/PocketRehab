import type { SafetyLevel } from '@/lib/safety/checkins';

/**
 * The live session workflow as a pure reducer, so every transition (pause,
 * rest, camera loss, safety stop, early end) is deterministic and testable.
 * It never repeats a session or adds missed repetitions to a later set.
 */

export type SessionMode = 'camera' | 'simulated' | 'manual';

export type Phase =
  | 'intro'
  | 'checkin-pre'
  | 'safety'
  | 'camera-setup'
  | 'manual-log'
  | 'countdown'
  | 'active'
  | 'paused'
  | 'rest'
  | 'camera-lost'
  | 'checkin-post'
  | 'summary'
  | 'exited';

export interface MachineState {
  phase: Phase;
  mode: SessionMode | null;
  sets: number;
  repsPerSet: number;
  restSeconds: number;
  set: number;
  repsInSet: number;
  totalReps: number;
  restEndsAt: number | null;
  restRemainingMs: number | null;
  pausedFrom: 'active' | 'rest' | 'countdown' | null;
  safety: SafetyLevel;
  endReason: 'completed' | 'ended-early' | 'camera-lost' | null;
  setsCompleted: number;
}

export type MachineEvent =
  | { type: 'CHOOSE_MODE'; mode: SessionMode }
  | { type: 'PRE_DONE'; outcome: SafetyLevel }
  | { type: 'SAFETY_CONTINUE' }
  | { type: 'SAFETY_EXIT' }
  | { type: 'SETUP_READY' }
  | { type: 'COUNTDOWN_DONE' }
  | { type: 'REP'; now: number }
  | { type: 'REST_DONE' }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'CAMERA_LOST' }
  | { type: 'RECONNECT' }
  | { type: 'END' }
  | { type: 'MANUAL_DONE' }
  | { type: 'POST_DONE' }
  | { type: 'BACK_TO_INTRO' };

export function initialState(p: { sets: number; reps: number; restSeconds: number }): MachineState {
  return {
    phase: 'intro',
    mode: null,
    sets: p.sets,
    repsPerSet: p.reps,
    restSeconds: p.restSeconds,
    set: 1,
    repsInSet: 0,
    totalReps: 0,
    restEndsAt: null,
    restRemainingMs: null,
    pausedFrom: null,
    safety: 'none',
    endReason: null,
    setsCompleted: 0,
  };
}

function afterSafety(s: MachineState): MachineState {
  if (s.mode === 'manual') return { ...s, phase: 'manual-log' };
  if (s.mode === 'camera') return { ...s, phase: 'camera-setup' };
  return { ...s, phase: 'countdown' };
}

const LIVE: Phase[] = ['countdown', 'active', 'paused', 'rest'];

export function sessionReducer(s: MachineState, e: MachineEvent): MachineState {
  switch (e.type) {
    case 'CHOOSE_MODE':
      return s.phase === 'intro' ? { ...s, mode: e.mode, phase: 'checkin-pre' } : s;
    case 'BACK_TO_INTRO':
      return s.phase === 'checkin-pre' || s.phase === 'camera-setup' ? { ...s, phase: 'intro', mode: null } : s;
    case 'PRE_DONE':
      if (s.phase !== 'checkin-pre') return s;
      if (e.outcome === 'none') return afterSafety({ ...s, safety: 'none' });
      return { ...s, phase: 'safety', safety: e.outcome };
    case 'SAFETY_CONTINUE':
      // Only a caution (not an urgent warning sign) may continue, and only by explicit acknowledgement.
      return s.phase === 'safety' && s.safety === 'caution' ? afterSafety(s) : s;
    case 'SAFETY_EXIT':
      return s.phase === 'safety' ? { ...s, phase: 'exited' } : s;
    case 'SETUP_READY':
      return s.phase === 'camera-setup' ? { ...s, phase: 'countdown' } : s;
    case 'COUNTDOWN_DONE':
      return s.phase === 'countdown' ? { ...s, phase: 'active' } : s;
    case 'REP': {
      if (s.phase !== 'active') return s;
      const repsInSet = s.repsInSet + 1;
      const totalReps = s.totalReps + 1;
      if (repsInSet < s.repsPerSet) return { ...s, repsInSet, totalReps };
      const setsCompleted = s.set;
      if (s.set >= s.sets) return { ...s, repsInSet, totalReps, setsCompleted, phase: 'checkin-post', endReason: 'completed' };
      if (s.restSeconds <= 0) return { ...s, repsInSet: 0, totalReps, setsCompleted, set: s.set + 1 };
      return { ...s, repsInSet, totalReps, setsCompleted, phase: 'rest', restEndsAt: e.now + s.restSeconds * 1000 };
    }
    case 'REST_DONE':
      return s.phase === 'rest' ? { ...s, phase: 'active', set: s.set + 1, repsInSet: 0, restEndsAt: null } : s;
    case 'PAUSE':
      if (s.phase !== 'active' && s.phase !== 'rest' && s.phase !== 'countdown') return s;
      return {
        ...s,
        phase: 'paused',
        pausedFrom: s.phase,
        restRemainingMs: s.phase === 'rest' && s.restEndsAt !== null ? Math.max(0, s.restEndsAt - e.now) : null,
      };
    case 'RESUME':
      if (s.phase !== 'paused') return s;
      if (s.pausedFrom === 'rest') {
        return { ...s, phase: 'rest', restEndsAt: e.now + (s.restRemainingMs ?? 0), restRemainingMs: null, pausedFrom: null };
      }
      // Resuming always goes through a short countdown so nobody is rushed.
      return { ...s, phase: 'countdown', pausedFrom: null };
    case 'CAMERA_LOST':
      return LIVE.includes(s.phase) || s.phase === 'camera-setup' ? { ...s, phase: 'camera-lost' } : s;
    case 'RECONNECT':
      return s.phase === 'camera-lost' ? { ...s, phase: 'camera-setup' } : s;
    case 'END':
      if (s.phase === 'camera-lost') return { ...s, phase: 'checkin-post', endReason: 'camera-lost' };
      return LIVE.includes(s.phase) ? { ...s, phase: 'checkin-post', endReason: 'ended-early' } : s;
    case 'MANUAL_DONE':
      return s.phase === 'manual-log' ? { ...s, phase: 'checkin-post', endReason: 'completed' } : s;
    case 'POST_DONE':
      return s.phase === 'checkin-post' ? { ...s, phase: 'summary' } : s;
  }
}

export function sessionStatusFor(s: MachineState): 'completed' | 'ended-early' | 'interrupted' | 'in-progress' {
  if (s.endReason === 'completed') return 'completed';
  if (s.endReason === 'camera-lost') return 'interrupted';
  if (s.endReason === 'ended-early') return 'ended-early';
  return 'in-progress';
}
