import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Pause, Play, SkipForward } from 'lucide-react';
import type { ExerciseDefinition } from '@/types/exercise';
import type { BodySide } from '@/lib/validation/schemas';
import { LM, SKELETON_CONNECTIONS, type Landmark } from '@/types/pose';
import { SYNTHETIC_FRAME, buildSyntheticPose } from '@/features/pose-estimation/synthetic';
import { Dialog } from '@/components/Dialog';
import { cx } from '@/components/ui';
import { useAppData } from '@/app/AppData';
import { useReducedMotion } from '@/app/usePreferencesEffect';

/**
 * Original animated demonstration of each exercise, drawn from the same
 * skeleton geometry the analysis uses (so the movement shown is exactly the
 * one being measured). It is an illustration of the movement pattern, not a
 * video of a person, and it is not synchronized to the user's own movement.
 */

type PhaseId = ExerciseDefinition['phases'][number]['id'];

function timeline(holdSeconds: number) {
  const hold = Math.max(0.6, Math.min(4, holdSeconds));
  return [
    { id: 'start' as PhaseId, dur: 1.1 },
    { id: 'outbound' as PhaseId, dur: 1.7 },
    { id: 'hold' as PhaseId, dur: hold },
    { id: 'return' as PhaseId, dur: 1.9 },
  ];
}

const ease = (x: number) => 0.5 - Math.cos(Math.PI * x) / 2;

function stateAt(def: ExerciseDefinition, t: number, holdSeconds: number): { value: number; phase: PhaseId } {
  const tl = timeline(holdSeconds);
  const total = tl.reduce((s, p) => s + p.dur, 0);
  let x = t % total;
  for (const p of tl) {
    if (x < p.dur) {
      const f = x / p.dur;
      const { neutral, peak } = def.demo;
      const value = p.id === 'start' ? neutral : p.id === 'outbound' ? neutral + (peak - neutral) * ease(f) : p.id === 'hold' ? peak : peak + (neutral - peak) * ease(f);
      return { value, phase: p.id };
    }
    x -= p.dur;
  }
  return { value: def.demo.neutral, phase: 'start' };
}

function phaseStart(phase: PhaseId, holdSeconds: number): number {
  const tl = timeline(holdSeconds);
  let t = 0;
  for (const p of tl) {
    if (p.id === phase) return t + p.dur * 0.6;
    t += p.dur;
  }
  return 0;
}

function bounds(def: ExerciseDefinition, side: BodySide) {
  const pts = [def.demo.neutral, def.demo.peak, (def.demo.neutral + def.demo.peak) / 2].flatMap((v) => buildSyntheticPose(def, side, v, { noisePx: 0 }));
  const xs = pts.map((p) => p.x * SYNTHETIC_FRAME.width);
  const ys = pts.map((p) => p.y * SYNTHETIC_FRAME.height);
  const pad = 60;
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  const w = maxX - minX;
  const h = maxY - minY;
  const size = Math.max(w, h);
  return { x: minX - (size - w) / 2, y: minY - (size - h) / 2, size };
}

export function DemoFigure({ def, side, value, className }: { def: ExerciseDefinition; side: BodySide; value: number; className?: string }) {
  const box = useMemo(() => bounds(def, side), [def, side]);
  const lms = buildSyntheticPose(def, side, value, { noisePx: 0 });
  const P = (lm: Landmark | undefined) => ({ x: (lm?.x ?? 0) * SYNTHETIC_FRAME.width, y: (lm?.y ?? 0) * SYNTHETIC_FRAME.height });
  const { a, b, c } = def.metric.landmarks[side];
  const moving = def.metric.moving === 'c' ? [b, c] : [a, b];
  const seated = def.id === 'knee-extension' || def.id === 'sit-to-stand';
  const hip = P(lms[side === 'left' ? LM.leftHip : LM.rightHip]);
  const knee = P(lms[side === 'left' ? LM.leftKnee : LM.rightKnee]);
  const head = P(lms[LM.nose]);
  const isFar = (i: number) => def.cameraView === 'side' && i >= 11 && (side === 'left' ? i % 2 === 0 : i % 2 === 1);

  return (
    <svg viewBox={`${box.x} ${box.y} ${box.size} ${box.size}`} className={className} role="img" aria-label={`Demonstration figure: ${def.name}`}>
      {seated ? (
        <g>
          <rect x={def.id === 'sit-to-stand' ? knee.x - 230 : hip.x - 60} y={def.id === 'sit-to-stand' ? 535 : hip.y + 14} width={def.id === 'sit-to-stand' ? 170 : 150} height={14} rx={7} fill="var(--color-rule-strong)" />
          <rect x={def.id === 'sit-to-stand' ? knee.x - 222 : hip.x - 52} y={def.id === 'sit-to-stand' ? 549 : hip.y + 28} width={12} height={150} rx={6} fill="var(--color-rule-strong)" />
        </g>
      ) : null}
      <line x1={box.x} x2={box.x + box.size} y1={700} y2={700} stroke="var(--color-rule)" strokeWidth={6} />
      {SKELETON_CONNECTIONS.filter(([i, j]) => i < 29 && j < 29).map(([i, j]) => {
        const pi = P(lms[i]);
        const pj = P(lms[j]);
        const highlight = (moving[0] === i && moving[1] === j) || (moving[0] === j && moving[1] === i);
        return (
          <line
            key={`${i}-${j}`}
            x1={pi.x}
            y1={pi.y}
            x2={pj.x}
            y2={pj.y}
            stroke={highlight ? 'var(--color-accent)' : 'var(--color-ink)'}
            strokeOpacity={isFar(i) || isFar(j) ? 0.25 : highlight ? 1 : 0.8}
            strokeWidth={highlight ? 26 : 20}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx={head.x} cy={head.y - 10} r={42} fill="var(--color-ink)" fillOpacity={0.85} />
      <circle cx={P(lms[b]).x} cy={P(lms[b]).y} r={16} fill="var(--color-surface)" stroke="var(--color-accent)" strokeWidth={8} />
    </svg>
  );
}

export function ExerciseDemo({ def, side, holdSeconds = 0, size = 'small', autoplay = true, className }: { def: ExerciseDefinition; side: BodySide; holdSeconds?: number; size?: 'small' | 'large'; autoplay?: boolean; className?: string }) {
  // With reduced motion the demonstration starts paused; the step button shows each phase.
  const reduced = useReducedMotion(useAppData().profile?.preferences.reducedMotion);
  const [playing, setPlaying] = useState(autoplay && !reduced);
  const [t, setT] = useState(0.4);
  const [enlarged, setEnlarged] = useState(false);
  const start = useRef<number | null>(null);
  const offset = useRef(0.4);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const step = (now: number) => {
      if (start.current === null) start.current = now - offset.current * 1000;
      const nt = (now - start.current) / 1000;
      setT(nt);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      start.current = null;
    };
  }, [playing]);

  const toggle = () => {
    offset.current = t;
    setPlaying((p) => !p);
  };
  const nextPhase = () => {
    const current = stateAt(def, t, holdSeconds).phase;
    const order: PhaseId[] = ['start', 'outbound', 'hold', 'return'];
    const nxt = order[(order.indexOf(current) + 1) % order.length] as PhaseId;
    const nt = phaseStart(nxt, holdSeconds);
    offset.current = nt;
    setPlaying(false);
    setT(nt);
  };

  const { value, phase } = stateAt(def, t, holdSeconds);
  const phaseInfo = def.phases.find((p) => p.id === phase);

  const controls = (
    <div className="flex items-center gap-1">
      <button type="button" onClick={toggle} className="rounded-full p-2 text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={playing ? 'Pause demonstration' : 'Play demonstration'}>
        {playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
      </button>
      <button type="button" onClick={nextPhase} className="rounded-full p-2 text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label="Show next phase">
        <SkipForward aria-hidden className="size-4" />
      </button>
      {size === 'small' ? (
        <button type="button" onClick={() => setEnlarged(true)} className="rounded-full p-2 text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label="Enlarge demonstration">
          <Maximize2 aria-hidden className="size-4" />
        </button>
      ) : null}
    </div>
  );

  return (
    <div className={cx('rounded-[var(--radius-card)] bg-surface text-ink', className)}>
      <div className={cx('mx-auto', size === 'large' ? 'max-w-md' : 'max-w-[15rem]')}>
        <DemoFigure def={def} side={side} value={value} className="aspect-square w-full" />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-rule px-3 py-2">
        <p className="min-w-0 text-sm" aria-live="off">
          <span className="font-bold">{phaseInfo?.label}</span>
          <span className="text-ink-2"> · {phaseInfo?.description}</span>
        </p>
        {controls}
      </div>
      <Dialog open={enlarged} onClose={() => setEnlarged(false)} title={`${def.name}: demonstration`}>
        <ExerciseDemo def={def} side={side} holdSeconds={holdSeconds} size="large" autoplay={playing} />
        <p className="text-sm">Illustration of the movement pattern drawn from PocketRehab’s exercise definition. Follow your clinician’s instructions if they differ.</p>
      </Dialog>
    </div>
  );
}
