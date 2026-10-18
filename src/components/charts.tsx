import { useId, useState, type ReactNode } from 'react';
import { Table2, ChartSpline } from 'lucide-react';
import { useMeasuredWidth } from './useMeasuredWidth';
import { HatchDefs } from './tape';
import { cx, staggerStyle } from './ui';

/**
 * Small SVG charts built for honesty: real axes with units, zero-based bars,
 * no invented points, an accessible text summary, and a "Show as table" view
 * of exactly the plotted data. Marks share the tape vocabulary: a trend is a
 * strip of tape, bars are vertical strips, uncertain values are hatched amber.
 */

export interface TableData {
  columns: string[];
  rows: Array<Array<string | number>>;
}

export function ChartFigure({ title, summary, table, children, note, actions }: { title: string; summary: string; table: TableData; children: ReactNode; note?: ReactNode; actions?: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  const id = useId();
  return (
    <figure aria-labelledby={`${id}-t`} className="min-w-0 border-t border-ink pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-t`} className="text-headline">
          {title}
        </h3>
        <div className="flex items-center gap-3">
          {actions}
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-accent-strong transition-colors duration-150 hover:bg-accent-soft"
            aria-pressed={showTable}
            onClick={() => setShowTable((v) => !v)}
          >
            {showTable ? <ChartSpline aria-hidden className="size-4" /> : <Table2 aria-hidden className="size-4" />}
            {showTable ? 'Show chart' : 'Show as table'}
          </button>
        </div>
      </div>
      {showTable ? (
        <div className="animate-fade overflow-x-auto rounded-[var(--radius-control)] border border-rule bg-surface">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="bg-surface-2/70">
              <tr>
                {table.columns.map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="px-3 py-2 whitespace-nowrap">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div aria-hidden="true">{children}</div>
      )}
      <figcaption className="mt-3 max-w-[70ch] text-sm text-ink-2">
        <span className="sr-only">Summary: </span>
        {summary}
        {note ? <span className="mt-1 block">{note}</span> : null}
      </figcaption>
    </figure>
  );
}

export interface LinePoint {
  x: number;
  y: number;
  label: string;
  /** Hollow marker: shown but not part of the line (e.g. excluded or simulated). */
  hollow?: boolean;
}

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => span / s <= count) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

/** Line chart over time. y-domain comes from the data and any band, never clipped, never below zero for non-negative data. */
export function LineChart({
  points,
  smoothed,
  band,
  yUnit,
  yDomain,
  height = 220,
  xFormat,
  color = 'var(--color-accent)',
}: {
  points: LinePoint[];
  smoothed?: Array<{ x: number; y: number }>;
  band?: { min: number; max: number; label: string } | null;
  yUnit: string;
  yDomain?: [number, number];
  height?: number;
  xFormat: (x: number) => string;
  color?: string;
}) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>(640);
  const W = Math.max(300, Math.min(900, width));
  const H = height;
  const pad = { l: 44, r: 20, t: 22, b: 30 };
  const ys = [...points.map((p) => p.y), ...(band ? [band.min, band.max] : [])];
  const nonNegative = ys.every((y) => y >= 0);
  const span = Math.max(...ys) - Math.min(...ys);
  // Pad the domain by a share of the data's own spread (at least a little), so flat series don't look dramatic.
  const margin = Math.max(span * 0.25, Math.abs(Math.max(...ys)) * 0.08, 1);
  const rawLo = yDomain?.[0] ?? Math.min(...ys) - margin;
  const lo = !yDomain && nonNegative ? Math.max(0, rawLo) : rawLo;
  const hi = yDomain?.[1] ?? Math.max(...ys) + margin;
  const ticks = niceTicks(lo, hi, 4);
  const yMin = nonNegative && !yDomain ? Math.max(0, Math.min(lo, ticks[0] ?? lo)) : Math.min(lo, ticks[0] ?? lo);
  const yMax = Math.max(hi, ticks[ticks.length - 1] ?? hi);
  const visibleTicks = ticks.filter((t) => t >= yMin - 1e-9 && t <= yMax + 1e-9);
  const xs = points.map((p) => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const sx = (x: number) => (xMax === xMin ? (pad.l + W - pad.r) / 2 : pad.l + ((x - xMin) / (xMax - xMin)) * (W - pad.l - pad.r));
  const sy = (y: number) => pad.t + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);
  const solid = points.filter((p) => !p.hollow);
  const path = (pts: Array<{ x: number; y: number }>) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const maxLabels = W < 480 ? 3 : 6;
  const xLabels = points.length <= maxLabels ? points : points.filter((_, i) => i % Math.ceil(points.length / maxLabels) === 0 || i === points.length - 1);
  const last = solid[solid.length - 1];
  const fmt = (v: number) => `${Math.round(v * 10) / 10}${yUnit}`;

  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img">
        {band ? (
          <g>
            <rect x={pad.l} width={W - pad.l - pad.r} y={sy(band.max)} height={Math.max(1, sy(band.min) - sy(band.max))} fill="var(--color-tape)" fillOpacity={0.08} />
            <path d={`M${pad.l} ${sy(band.max) + 0.5}H${W - pad.r}M${pad.l} ${sy(band.min) - 0.5}H${W - pad.r}`} stroke="var(--color-tape)" strokeOpacity={0.5} strokeDasharray="3 3" />
            <text x={pad.l + 6} y={sy(band.max) + 14} className="fill-accent-strong text-[11px] font-semibold">
              {band.label}
            </text>
          </g>
        ) : null}
        {visibleTicks.map((t, i) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--color-ink)" strokeOpacity={i === 0 && t === 0 ? 0.35 : 0.1} strokeWidth={1} />
            <text x={pad.l - 8} y={sy(t) + 4} textAnchor="end" className="num fill-ink-3 text-[11px]">
              {t}
              {yUnit}
            </text>
          </g>
        ))}
        {xLabels.map((p) => (
          <text key={`x${p.x}`} x={sx(p.x)} y={H - 8} textAnchor="middle" className="fill-ink-3 text-[11px]">
            {xFormat(p.x)}
          </text>
        ))}
        {smoothed && smoothed.length > 1 ? <path d={path(smoothed)} pathLength={1} className="tape-lay" fill="none" stroke={color} strokeOpacity={0.24} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" /> : null}
        {solid.length > 1 ? <path d={path(solid)} pathLength={1} className="tape-lay" style={staggerStyle(2)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
        {points.map((p, i) => {
          const isLast = p === last;
          return (
            <circle
              key={i}
              className="mark-in"
              style={staggerStyle(i)}
              cx={sx(p.x)}
              cy={sy(p.y)}
              r={p.hollow ? 4.5 : isLast ? 5 : 3.75}
              fill={p.hollow ? 'var(--color-ground)' : isLast ? color : 'var(--color-ground)'}
              stroke={p.hollow ? 'var(--color-ink-3)' : color}
              strokeWidth={p.hollow ? 1.5 : 2}
              strokeDasharray={p.hollow ? '2 2' : undefined}
            />
          );
        })}
        {last ? (
          <text className="num mark-in fill-ink text-[12px] font-bold" style={staggerStyle(points.length)} x={Math.min(sx(last.x), W - 4)} y={sy(last.y) - 11} textAnchor={sx(last.x) > W - 40 ? 'end' : 'middle'}>
            {fmt(last.y)}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

/** Vertical tape strips from zero (never a truncated axis). Hatched amber marks values whose tracking was uncertain. */
export function BarChart({ bars, yUnit, yMax, height = 200 }: { bars: Array<{ label: string; value: number | null; tone?: 'accent' | 'muted' | 'warn'; note?: string }>; yUnit: string; yMax?: number; height?: number }) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>(640);
  const hatch = useId().replace(/:/g, '');
  const W = Math.max(300, Math.min(900, width));
  const H = height;
  const pad = { l: 40, r: 10, t: 22, b: 30 };
  const max = yMax ?? Math.max(1, ...bars.map((b) => b.value ?? 0));
  const ticks = niceTicks(0, max, 4);
  const top = Math.max(max, ticks[ticks.length - 1] ?? max);
  const bw = (W - pad.l - pad.r) / Math.max(1, bars.length);
  const sy = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const labelEvery = Math.max(1, Math.ceil((bars.length * 46) / (W - pad.l - pad.r)));
  const showValues = bars.length <= 10 && bw >= 30;
  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img">
        <HatchDefs id={hatch} />
        {ticks.map((t, i) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--color-ink)" strokeOpacity={i === 0 ? 0.35 : 0.1} />
            <text x={pad.l - 8} y={sy(t) + 4} textAnchor="end" className="num fill-ink-3 text-[11px]">
              {t}
              {yUnit}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const w = Math.min(22, Math.max(6, bw * 0.5));
          const x = pad.l + i * bw + (bw - w) / 2;
          const fill = b.tone === 'muted' ? 'var(--color-rule-strong)' : b.tone === 'warn' ? 'var(--color-warn-mark)' : 'var(--color-tape)';
          const h = b.value === null ? 0 : Math.max(0, sy(0) - sy(b.value));
          return (
            <g key={i}>
              {b.value === null ? (
                <text x={x + w / 2} y={sy(0) - 6} textAnchor="middle" className="mark-in fill-ink-3 text-[11px]" style={staggerStyle(i)}>
                  n/a
                </text>
              ) : h > 0 ? (
                <g className="bar-grow" style={staggerStyle(i)}>
                  <rect x={x} y={sy(b.value)} width={w} height={h} rx={Math.min(w / 2, h / 2)} fill={fill} />
                  {b.tone === 'warn' ? <rect x={x + 2} y={sy(b.value) + 2} width={w - 4} height={Math.max(0, h - 4)} rx={Math.min((w - 4) / 2, (h - 4) / 2)} fill={`url(#${hatch})`} /> : null}
                </g>
              ) : (
                <circle cx={x + w / 2} cy={sy(0) - 3} r={2.5} fill="var(--color-rule-strong)" className="mark-in" style={staggerStyle(i)} />
              )}
              {showValues && b.value !== null ? (
                <text x={x + w / 2} y={sy(b.value) - 7} textAnchor="middle" className="num mark-in fill-ink-2 text-[11px] font-bold" style={staggerStyle(i)}>
                  {b.value}
                  {yUnit}
                </text>
              ) : null}
              {i % labelEvery === 0 ? (
                <text x={x + w / 2} y={H - 8} textAnchor="middle" className={cx('text-[11px]', i === bars.length - 1 ? 'fill-ink-2 font-semibold' : 'fill-ink-3')}>
                  {b.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; swatch: 'line' | 'hollow' | 'band' | 'smooth' }> }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2">
          <span
            aria-hidden
            className={cx(
              'inline-block',
              it.swatch === 'line' && 'size-2.5 rounded-full border-2 border-tape bg-ground',
              it.swatch === 'hollow' && 'size-2.5 rounded-full border-2 border-dashed border-ink-3',
              it.swatch === 'band' && 'h-2.5 w-4 border-y border-dashed border-tape/60 bg-tape/10',
              it.swatch === 'smooth' && 'h-2 w-5 rounded-full bg-tape/25',
            )}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
