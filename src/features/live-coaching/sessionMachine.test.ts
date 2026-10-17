import { describe, expect, it } from 'vitest';
import { initialState, sessionReducer, sessionStatusFor, type MachineEvent, type MachineState } from './sessionMachine';

const run = (events: MachineEvent[], s: MachineState = initialState({ sets: 2, reps: 2, restSeconds: 30 })) => events.reduce(sessionReducer, s);
const reps = (n: number, now = 0): MachineEvent[] => Array.from({ length: n }, () => ({ type: 'REP' as const, now }));

describe('session state machine', () => {
  it('runs a full camera session through sets and rest to the post check-in', () => {
    let s = run([{ type: 'CHOOSE_MODE', mode: 'camera' }, { type: 'PRE_DONE', outcome: 'none' }]);
    expect(s.phase).toBe('camera-setup');
    s = run([{ type: 'SETUP_READY' }, { type: 'COUNTDOWN_DONE' }, ...reps(2, 1000)], s);
    expect(s.phase).toBe('rest');
    expect(s.restEndsAt).toBe(31000);
    s = run([{ type: 'REST_DONE' }, ...reps(2)], s);
    expect(s.phase).toBe('checkin-post');
    expect(s.setsCompleted).toBe(2);
    expect(sessionStatusFor(s)).toBe('completed');
    expect(run([{ type: 'POST_DONE' }], s).phase).toBe('summary');
  });

  it('ignores repetitions that arrive while paused or resting', () => {
    let s = run([{ type: 'CHOOSE_MODE', mode: 'simulated' }, { type: 'PRE_DONE', outcome: 'none' }, { type: 'COUNTDOWN_DONE' }, { type: 'PAUSE', now: 0 }]);
    s = run(reps(5), s);
    expect(s.totalReps).toBe(0);
  });

  it('keeps the remaining rest time across a pause', () => {
    let s = run([{ type: 'CHOOSE_MODE', mode: 'simulated' }, { type: 'PRE_DONE', outcome: 'none' }, { type: 'COUNTDOWN_DONE' }, ...reps(2, 0)]);
    s = run([{ type: 'PAUSE', now: 10_000 }, { type: 'RESUME', now: 100_000 }], s);
    expect(s.phase).toBe('rest');
    expect(s.restEndsAt).toBe(120_000);
  });

  it('an urgent warning sign stops the session with no way to continue', () => {
    const s = run([{ type: 'CHOOSE_MODE', mode: 'camera' }, { type: 'PRE_DONE', outcome: 'urgent' }, { type: 'SAFETY_CONTINUE' }]);
    expect(s.phase).toBe('safety');
    expect(run([{ type: 'SAFETY_EXIT' }], s).phase).toBe('exited');
  });

  it('a caution can continue only by explicit acknowledgement', () => {
    const s = run([{ type: 'CHOOSE_MODE', mode: 'manual' }, { type: 'PRE_DONE', outcome: 'caution' }]);
    expect(s.phase).toBe('safety');
    expect(run([{ type: 'SAFETY_CONTINUE' }], s).phase).toBe('manual-log');
  });

  it('camera loss mid-session can reconnect or end, and ending marks it interrupted', () => {
    let s = run([{ type: 'CHOOSE_MODE', mode: 'camera' }, { type: 'PRE_DONE', outcome: 'none' }, { type: 'SETUP_READY' }, { type: 'COUNTDOWN_DONE' }, ...reps(1), { type: 'CAMERA_LOST' }]);
    expect(s.phase).toBe('camera-lost');
    expect(run([{ type: 'RECONNECT' }], s).phase).toBe('camera-setup');
    s = run([{ type: 'END' }], s);
    expect(s.phase).toBe('checkin-post');
    expect(s.totalReps).toBe(1);
    expect(sessionStatusFor(s)).toBe('interrupted');
  });

  it('ending early records an early end without adding missed repetitions', () => {
    const s = run([{ type: 'CHOOSE_MODE', mode: 'simulated' }, { type: 'PRE_DONE', outcome: 'none' }, { type: 'COUNTDOWN_DONE' }, ...reps(1), { type: 'END' }]);
    expect(sessionStatusFor(s)).toBe('ended-early');
    expect(s.totalReps).toBe(1);
    expect(s.setsCompleted).toBe(0);
  });
});
