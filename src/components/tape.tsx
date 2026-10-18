import { useId, type ReactNode } from 'react';
import { useMeasuredWidth } from './useMeasuredWidth';
import { cx, staggerStyle } from './ui';

/**
 * The Applied Tape signature: measurements are laid down as rounded-end strips
 * of cyan tape on a numbered backing grid. A measurement whose tracking was not
 * reliable is drawn as an "unstuck" strip: amber hatching, never cyan, and
 * labelled as not used. One geometry (the rounded strip) is used for charts,
 * the AR target zone, progress marks and legends.
 *
 * Strips are drawn with pathLength="1" so the `.tape-lay` animation can lay
 * each one down from its start angle to its peak (index.css; off under reduced motion).
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
  const left = narrow ? 56 : 84;
  const right = narrow ? 48 : 60;
  const rowH = narrow ? 40 : 44;
  const strip = narrow ? 16 : 18;
  const top = 26;
  const H = top + rows.length * rowH + (target ? 30 : 10);
  const plotW = W - left - right;
  const sx = (v: number) => left + (Math.max(0, Math.min(max, v)) / max) * plotW;
  const step = max <= 120 ? 10 : 20;
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const majorEvery = narrow ? 2 : max <= 120 ? 2 : 1;
  const cell = plotW / (max / step);

  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img">
        <HatchDefs id={hatch} />
        <defs>
          <pattern id={grid} x={left} y={top} width={cell} height={rowH} patternUnits="userSpaceOnUse">
            <path d={`M0.5 0V${rowH}`} stroke="var(--color-ink)" strokeOpacity="0.16" />
            <path d={`M${cell / 2} 0V${rowH}M0 0.5H${cell}`} stroke="var(--color-ink)" strokeOpacity="0.06" />
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
        <rect x={left + 0.5} y={top + 0.5} width={plotW} height={rows.length * rowH} fill="none" stroke="var(--color-ink)" strokeOpacity="0.18" rx="2" />
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
          const s = r.start ?? 15;
          const e = s + Math.min(40, max / 4);
          return (
            <g key={r.id}>
              <text x={0} y={y + 5} className={cx('text-[14px]', r.emphasis ? 'fill-ink font-bold' : 'fill-ink-2')}>
                {r.label}
              </text>
              {has && r.reliable ? (
                <>
                  <path d={`M${sx(r.start as number)} ${y}H${sx(r.peak as number)}`} pathLength={1} className="tape-lay" style={staggerStyle(i)} stroke="var(--color-tape)" strokeOpacity={r.simulated ? 0.6 : 1} strokeWidth={strip} strokeLinecap="round" />
                  {/* A thin highlight along the strip reads as the sheen of real tape. */}
                  <path d={`M${sx(r.start as number)} ${y - strip / 4}H${sx(r.peak as number)}`} pathLength={1} className="tape-lay" style={staggerStyle(i)} stroke="#ffffff" strokeOpacity={0.22} strokeWidth={1.5} strokeLinecap="round" />
                  <text x={sx(r.peak as number) + strip / 2 + 7} y={y + 5} className={cx('num mark-in text-[14px]', r.emphasis ? 'fill-ink font-bold' : 'fill-ink-2')} style={staggerStyle(i)}>
                    {Math.round(r.peak as number)}
                    {unit}
                  </text>
                </>
              ) : (
                <>
                  <path d={`M${sx(s)} ${y}H${sx(e)}`} pathLength={1} className="tape-lay" style={staggerStyle(i)} stroke="var(--color-warn-mark)" strokeWidth={strip} strokeLinecap="round" />
                  <path d={`M${sx(s)} ${y}H${sx(e)}`} pathLength={1} className="tape-lay" style={staggerStyle(i)} stroke={`url(#${hatch})`} strokeWidth={strip - 4} strokeLinecap="round" />
                  <text x={sx(e) + strip / 2 + 8} y={y + 5} className="mark-in fill-warn text-[13px] font-bold" style={staggerStyle(i)}>
                    {r.note ?? (narrow ? 'Uncertain, not used' : 'Tracking uncertain — not used for trends')}
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

/** Hand-drawn ring marking a completed day (a single pen loop, partial when half done). It draws itself in once. */
export function DoneRing({ partial, className }: { partial?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 58 38" className={className} aria-hidden fill="none">
      <path
        d="M6 23C3 12 16 4 31 4c14 0 25 6 24 15-1 10-14 15-28 14C14 32 4 27 5 18c1-6 8-10 16-12"
        stroke="var(--color-tape)"
        strokeWidth="2"
        strokeLinecap="round"
        pathLength={1}
        className="tape-lay"
        // Inline so it wins over the class's full-length dash: a partial day is just under half a loop.
        style={partial ? { strokeDasharray: '0.46 1' } : undefined}
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
          className={cx(
            'flex min-h-[4.75rem] flex-col justify-between gap-2 px-1 py-2.5 text-[0.82rem] leading-tight sm:min-h-24 sm:px-3 sm:text-[0.94rem]',
            i > 0 && 'border-l border-rule',
            d.status === 'today' && 'rounded-t-lg bg-surface-2',
            d.status === 'off' && 'text-ink-3',
          )}
        >
          <span className={cx('relative self-center px-0.5 text-base sm:self-start', d.status === 'off' ? 'font-medium' : 'font-bold')}>
            {d.weekday}
            {d.status === 'done' || d.status === 'partial' ? <DoneRing partial={d.status === 'partial'} className="pointer-events-none absolute -left-2.5 -top-2 h-[38px] w-[58px] overflow-visible" /> : null}
          </span>
          {/* Phones: a mark per day (the full status is in each day's label). Wider screens: words. */}
          <span aria-hidden className="flex h-3 items-center justify-center sm:hidden">
            {d.status === 'missed' ? <span className="h-2 w-4 rounded-full bg-signal" /> : null}
            {d.status === 'today' ? <span className="size-2 rounded-full bg-tape" /> : null}
            {d.status === 'upcoming' ? <span className="size-2 rounded-full border-[1.5px] border-ink-3" /> : null}
            {d.status === 'skipped' || d.status === 'unavailable' ? <span className="h-0.5 w-3 rounded-full bg-ink-3" /> : null}
          </span>
          <span className="hidden flex-col sm:flex">
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
            {d.detail ? <span className="text-ink-2 tabular-nums">{d.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function statusText(s: DayCellStatus): string {
  return { done: 'Done', partial: 'Partial', missed: 'Missed', skipped: 'Skipped', unavailable: 'Unavailable', today: 'Today', upcoming: 'Upcoming', off: 'Not scheduled' }[s];
}

/** A row of short strips, one per repetition: cyan reliable, hatched amber excluded, pink when a form criterion was not met. */
export function RepStrip({ reps }: { reps: Array<{ index: number; reliable: boolean; criterionMissed?: boolean }> }) {
  const id = useId().replace(/:/g, '');
  const { ref, width } = useMeasuredWidth<HTMLDivElement>(360);
  const n = Math.max(1, reps.length);
  // Fixed-size marks (never scaled-down text): the step shrinks to fit, within readable limits.
  const step = Math.max(22, Math.min(44, (width - 8) / n));
  const len = Math.max(8, step * 0.5);
  const W = Math.max(step * n + 8, 60);
  const missedCount = reps.filter((r) => r.reliable && r.criterionMissed).length;
  return (
    <div ref={ref} className="w-full overflow-x-auto">
      <svg
        width={W}
        height={40}
        viewBox={`0 0 ${W} 40`}
        className="block overflow-visible"
        role="img"
        aria-label={`${reps.length} repetitions. ${reps.filter((r) => !r.reliable).map((r) => `Rep ${r.index} excluded, tracking uncertain.`).join(' ') || 'All tracked reliably.'}${missedCount ? ` ${missedCount} with a form criterion not met.` : ''}`}
      >
        <HatchDefs id={id} />
        {reps.map((r, i) => {
          const cx0 = 4 + i * step + step / 2;
          const x = cx0 - len / 2;
          const color = !r.reliable ? 'var(--color-warn-mark)' : r.criterionMissed ? 'var(--color-signal)' : 'var(--color-tape)';
          return (
            <g key={r.index}>
              <path d={`M${x} 13H${x + len}`} pathLength={1} className="tape-lay" style={staggerStyle(i)} stroke={color} strokeWidth={12} strokeLinecap="round" />
              {!r.reliable ? <path d={`M${x} 13H${x + len}`} pathLength={1} className="tape-lay" style={staggerStyle(i)} stroke={`url(#${id})`} strokeWidth={8} strokeLinecap="round" /> : null}
              <text x={cx0} y={36} textAnchor="middle" className={cx('num text-[11px]', r.reliable ? 'fill-ink-3' : 'fill-warn font-bold')}>
                {r.index}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
