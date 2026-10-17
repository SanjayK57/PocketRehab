import { useId, type ReactNode } from 'react';
import { useMeasuredWidth } from './useMeasuredWidth';
import { cx } from './ui';

/**
 * The Applied Tape signature: measurements are laid down as rounded-end strips
 * of cyan tape on a numbered backing grid. A measurement whose tracking was not
 * reliable is drawn as an "unstuck" strip: amber hatching, never cyan, and
 * labelled as not used. One geometry (the rounded strip) is used for charts,
 * the AR target zone, progress marks and legends.
 */

export function HatchDefs({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="var(--color-ground)" />
        <path d="M1 0V6" stroke="var(--color-warn-mark)" strokeWidth="1.6" />
      </pattern>
    </defs>
  );
}

/** Inline legend swatch. */
export function TapeSwatch({ kind, className }: { kind: 'reliable' | 'uncertain' | 'signal' | 'target'; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width="30" height="14" viewBox="0 0 30 14" aria-hidden className={cx('shrink-0', className)}>
      <HatchDefs id={id} />
      {kind === 'target' ? <rect x="2" y="1" width="26" height="12" fill="var(--color-tape)" fillOpacity="0.12" stroke="var(--color-tape)" strokeOpacity="0.6" strokeDasharray="3 2" /> : null}
      {kind === 'reliable' ? <path d="M8 7H22" stroke="var(--color-tape)" strokeWidth="12" strokeLinecap="round" /> : null}
      {kind === 'signal' ? <path d="M8 7H22" stroke="var(--color-signal)" strokeWidth="12" strokeLinecap="round" /> : null}
      {kind === 'uncertain' ? (
        <>
          <path d="M8 7H22" stroke="var(--color-warn-mark)" strokeWidth="12" strokeLinecap="round" />
          <path d="M8 7H22" stroke={`url(#${id})`} strokeWidth="8" strokeLinecap="round" />
        </>
      ) : null}
    </svg>
  );
}

export interface StripRow {
  id: string;
  label: string;
  start: number | null;
  peak: number | null;
  reliable: boolean;
  emphasis?: boolean;
  /** Shown instead of a value for unreliable rows. */
  note?: string;
  simulated?: boolean;
}

/**
 * Range strips: one row per session, each strip runs from the start angle to
 * the peak angle (both medians of reliable repetitions). Axis is degrees on a
 * fixed 0–max scale, so rows are always comparable at the same scale.
 */
export function RangeStrips({ rows, target, max = 180, unit = '°' }: { rows: StripRow[]; target?: { min: number; max: number; label: string } | null; max?: number; unit?: string }) {
  const hatch = useId().replace(/:/g, '');
  const grid = `${hatch}g`;
  const { ref, width } = useMeasuredWidth<HTMLDivElement>();
  // The drawing is sized to the real container so text stays ~13–14px on phones too.
  const W = Math.max(320, Math.min(900, width));
  const narrow = W < 520;
  const left = narrow ? 58 : 92;
  const right = narrow ? 46 : 56;
  const rowH = 44;
  const top = 26;
  const H = top + rows.length * rowH + (target ? 30 : 10);
  const plotW = W - left - right;
  const sx = (v: number) => left + (Math.max(0, Math.min(max, v)) / max) * plotW;
  const step = max <= 120 ? 10 : 20;
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const majorEvery = narrow ? 2 : max <= 120 ? 2 : 1;

  return (
    <div ref={ref} className="w-full">
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      <HatchDefs id={hatch} />
      <defs>
        <pattern id={grid} x={left} y={top} width={plotW / (max / step)} height={rowH} patternUnits="userSpaceOnUse">
          <path d={`M0.5 0V${rowH}`} stroke="var(--color-ink)" strokeOpacity="0.2" />
          <path d={`M${plotW / (max / step) / 2} 0V${rowH}M0 0.5H${plotW / (max / step)}`} stroke="var(--color-ink)" strokeOpacity="0.07" />
        </pattern>
      </defs>
      {ticks.map((t, i) =>
        i % majorEvery === 0 || t === max ? (
          <text key={t} x={sx(t)} y={14} textAnchor="middle" className="num fill-ink-3 text-[12px]">
            {t}
            {t === max ? unit : ''}
          </text>
        ) : null,
      )}
      <rect x={left} y={top} width={plotW} height={rows.length * rowH} fill={`url(#${grid})`} />
      <rect x={left + 0.5} y={top + 0.5} width={plotW} height={rows.length * rowH} fill="none" stroke="var(--color-ink)" strokeOpacity="0.2" />
      {target ? (
        <g>
          <rect x={sx(target.min)} y={top} width={Math.max(2, sx(target.max) - sx(target.min))} height={rows.length * rowH} fill="var(--color-tape)" fillOpacity="0.09" />
          <path d={`M${sx(target.min) + 0.5} ${top}V${top + rows.length * rowH}M${sx(target.max) + 0.5} ${top}V${top + rows.length * rowH}`} stroke="var(--color-tape)" strokeOpacity="0.55" strokeDasharray="3 3" />
          <text x={Math.min((sx(target.min) + sx(target.max)) / 2, W - 4)} y={top + rows.length * rowH + 20} textAnchor={(sx(target.min) + sx(target.max)) / 2 > W - 110 ? 'end' : 'middle'} className="fill-accent-strong text-[13px] font-bold">
            {target.label}
          </text>
        </g>
      ) : null}
      {rows.map((r, i) => {
        const y = top + i * rowH + rowH / 2;
        const has = r.start !== null && r.peak !== null;
        return (
          <g key={r.id}>
            <text x={0} y={y + 5} className={cx('text-[14px]', r.emphasis ? 'fill-ink font-bold' : 'fill-ink-2')}>
              {r.label}
            </text>
            {has && r.reliable ? (
              <>
                <path d={`M${sx(r.start as number)} ${y}H${sx(r.peak as number)}`} stroke="var(--color-tape)" strokeOpacity={r.simulated ? 0.55 : 1} strokeWidth={18} strokeLinecap="round" />
                <text x={sx(r.peak as number) + 16} y={y + 5} className={cx('num text-[14px]', r.emphasis ? 'fill-ink font-bold' : 'fill-ink')}>
                  {Math.round(r.peak as number)}
                  {unit}
                </text>
              </>
            ) : (
              <>
                <path d={`M${sx(r.start ?? 15)} ${y}H${sx((r.start ?? 15) + Math.min(40, max / 4))}`} stroke="var(--color-warn-mark)" strokeWidth={18} strokeLinecap="round" />
                <path d={`M${sx(r.start ?? 15)} ${y}H${sx((r.start ?? 15) + Math.min(40, max / 4))}`} stroke={`url(#${hatch})`} strokeWidth={14} strokeLinecap="round" />
                <text x={sx((r.start ?? 15) + Math.min(40, max / 4)) + 18} y={y + 5} className="fill-warn text-[13px] font-bold">
                  {r.note ?? 'Tracking uncertain — not used for trends'}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
    </div>
  );
}

export type DayCellStatus = 'done' | 'partial' | 'missed' | 'skipped' | 'unavailable' | 'today' | 'upcoming' | 'off';

/** Hand-drawn ring marking a completed day (a single pen loop, partial when half done). */
export function DoneRing({ partial, className }: { partial?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 58 38" className={className} aria-hidden fill="none">
      <path
        d="M6 23C3 12 16 4 31 4c14 0 25 6 24 15-1 10-14 15-28 14C14 32 4 27 5 18c1-6 8-10 16-12"
        stroke="var(--color-tape)"
        strokeWidth="2"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={partial ? '46 100' : undefined}
      />
    </svg>
  );
}

export function WeekCells({ days }: { days: Array<{ key: string; weekday: string; status: DayCellStatus; detail?: ReactNode; label: string }> }) {
  return (
    <ol className="grid grid-cols-7 border-b border-rule">
      {days.map((d, i) => (
        <li
          key={d.key}
          aria-current={d.status === 'today' ? 'date' : undefined}
          aria-label={`${d.label}: ${statusText(d.status)}`}
          className={cx('flex min-h-24 flex-col justify-between gap-2 px-1.5 py-2.5 text-[0.82rem] leading-tight sm:px-3 sm:text-[0.94rem]', i > 0 && 'border-l border-rule', d.status === 'today' && 'bg-surface-2', d.status === 'off' && 'text-ink-3')}
        >
          <span className={cx('relative self-start px-0.5 text-base', d.status === 'off' ? 'font-medium' : 'font-bold')}>
            {d.weekday}
            {d.status === 'done' || d.status === 'partial' ? <DoneRing partial={d.status === 'partial'} className="pointer-events-none absolute -left-2.5 -top-2 h-[38px] w-[58px] overflow-visible" /> : null}
          </span>
          <span className="flex flex-col">
            {d.status === 'missed' ? (
              <span className="flex items-center gap-1.5 font-bold">
                <svg width="16" height="12" aria-hidden>
                  <path d="M5 6H11" stroke="var(--color-signal)" strokeWidth="8" strokeLinecap="round" />
                </svg>
                Missed
              </span>
            ) : (
              <span className={cx(d.status === 'today' && 'font-bold', (d.status === 'upcoming' || d.status === 'off') && 'text-ink-3')}>{statusText(d.status)}</span>
            )}
            {d.detail ? <span className="text-ink-2">{d.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function statusText(s: DayCellStatus): string {
  return { done: 'Done', partial: 'Partial', missed: 'Missed', skipped: 'Skipped', unavailable: 'Unavailable', today: 'Today', upcoming: 'Upcoming', off: 'Not scheduled' }[s];
}

/** A row of short strips, one per repetition: cyan reliable, hatched amber excluded. */
export function RepStrip({ reps }: { reps: Array<{ index: number; reliable: boolean }> }) {
  const id = useId().replace(/:/g, '');
  const n = Math.max(1, reps.length);
  const W = Math.max(120, n * 48);
  return (
    <svg viewBox={`0 0 ${W} 40`} className="h-10 w-full max-w-sm" role="img" aria-label={`${reps.length} repetitions. ${reps.filter((r) => !r.reliable).map((r) => `Rep ${r.index} excluded, tracking uncertain.`).join(' ') || 'All tracked reliably.'}`}>
      <HatchDefs id={id} />
      {reps.map((r, i) => {
        const x = 12 + i * 48;
        return (
          <g key={r.index}>
            <path d={`M${x} 12H${x + 24}`} stroke={r.reliable ? 'var(--color-tape)' : 'var(--color-warn-mark)'} strokeWidth={14} strokeLinecap="round" />
            {!r.reliable ? <path d={`M${x} 12H${x + 24}`} stroke={`url(#${id})`} strokeWidth={10} strokeLinecap="round" /> : null}
            <text x={x + 12} y={37} textAnchor="middle" className={cx('num text-[12px]', r.reliable ? 'fill-ink-3' : 'fill-warn font-bold')}>
              {r.index}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
