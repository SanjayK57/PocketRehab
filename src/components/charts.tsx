import { useId, useState, type ReactNode } from 'react';
import { useMeasuredWidth } from './useMeasuredWidth';
import { cx } from './ui';

/**
 * Small SVG charts built for honesty: real axes with units, zero-based bars,
 * no invented points, an accessible text summary, and a "Show as table" view
 * of exactly the plotted data.
 */

export interface TableData {
  columns: string[];
  rows: Array<Array<string | number>>;
}

export function ChartFigure({ title, summary, table, children, note, actions }: { title: string; summary: string; table: TableData; children: ReactNode; note?: ReactNode; actions?: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  const id = useId();
  return (
    <figure aria-labelledby={`${id}-t`} className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${id}-t`} className="font-bold">
          {title}
        </h3>
        <div className="flex items-center gap-3">
          {actions}
          <button type="button" className="text-sm font-semibold text-accent-strong underline-offset-4 hover:underline" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
            {showTable ? 'Show chart' : 'Show as table'}
          </button>
        </div>
      </div>
      {showTable ? (
        <div className="overflow-x-auto rounded-[var(--radius-control)] border border-rule">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="bg-surface-2">
              <tr>
                {table.columns.map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="px-3 py-2">
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
      <figcaption className="mt-2 max-w-[70ch] text-sm text-ink-2">
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

/** Line chart over time. y-domain comes from the data and any band, never clipped. */
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
  const pad = { l: 44, r: 16, t: 14, b: 30 };
  const ys = [...points.map((p) => p.y), ...(band ? [band.min, band.max] : [])];
  const lo = yDomain?.[0] ?? Math.floor(Math.min(...ys) - 5);
  const hi = yDomain?.[1] ?? Math.ceil(Math.max(...ys) + 5);
  const ticks = niceTicks(lo, hi, 4);
  const yMin = Math.min(lo, ticks[0] ?? lo);
  const yMax = Math.max(hi, ticks[ticks.length - 1] ?? hi);
  const xs = points.map((p) => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const sx = (x: number) => (xMax === xMin ? (pad.l + W - pad.r) / 2 : pad.l + ((x - xMin) / (xMax - xMin)) * (W - pad.l - pad.r));
  const sy = (y: number) => pad.t + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);
  const solid = points.filter((p) => !p.hollow);
  const path = (pts: Array<{ x: number; y: number }>) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const maxLabels = W < 480 ? 3 : 6;
  const xLabels = points.length <= maxLabels ? points : points.filter((_, i) => i % Math.ceil(points.length / maxLabels) === 0 || i === points.length - 1);

  return (
    <div ref={ref} className="w-full">
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      {band ? (
        <g>
          <rect x={pad.l} width={W - pad.l - pad.r} y={sy(band.max)} height={Math.max(1, sy(band.min) - sy(band.max))} fill="var(--color-ok-soft)" />
          <text x={W - pad.r - 4} y={sy(band.max) + 13} textAnchor="end" className="fill-ok text-[11px] font-semibold">
            {band.label}
          </text>
        </g>
      ) : null}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--color-rule)" strokeWidth={1} />
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
      {smoothed && smoothed.length > 1 ? <path d={path(smoothed)} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" /> : null}
      {solid.length > 1 ? <path d={path(solid)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" /> : null}
      {points.map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={p.hollow ? 5 : 4.5} fill={p.hollow ? 'var(--color-surface)' : color} stroke={p.hollow ? 'var(--color-ink-3)' : color} strokeWidth={p.hollow ? 2 : 0} strokeDasharray={p.hollow ? '2 2' : undefined} />
      ))}
    </svg>
    </div>
  );
}

/** Vertical bars from zero (never a truncated axis). */
export function BarChart({ bars, yUnit, yMax, height = 200 }: { bars: Array<{ label: string; value: number | null; tone?: 'accent' | 'muted' | 'warn'; note?: string }>; yUnit: string; yMax?: number; height?: number }) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>(640);
  const W = Math.max(300, Math.min(900, width));
  const H = height;
  const pad = { l: 40, r: 10, t: 12, b: 30 };
  const max = yMax ?? Math.max(1, ...bars.map((b) => b.value ?? 0));
  const ticks = niceTicks(0, max, 4);
  const top = Math.max(max, ticks[ticks.length - 1] ?? max);
  const bw = (W - pad.l - pad.r) / Math.max(1, bars.length);
  const sy = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const labelEvery = Math.max(1, Math.ceil((bars.length * 46) / (W - pad.l - pad.r)));
  return (
    <div ref={ref} className="w-full">
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--color-rule)" />
          <text x={pad.l - 8} y={sy(t) + 4} textAnchor="end" className="num fill-ink-3 text-[11px]">
            {t}
            {yUnit}
          </text>
        </g>
      ))}
      {bars.map((b, i) => {
        const x = pad.l + i * bw + bw * 0.2;
        const w = bw * 0.6;
        const fill = b.tone === 'muted' ? 'var(--color-rule-strong)' : b.tone === 'warn' ? 'var(--color-warn)' : 'var(--color-accent)';
        return (
          <g key={i}>
            {b.value === null ? (
              <text x={x + w / 2} y={sy(0) - 6} textAnchor="middle" className="fill-ink-3 text-[11px]">
                n/a
              </text>
            ) : (
              <rect x={x} y={sy(b.value)} width={w} height={Math.max(0, sy(0) - sy(b.value))} rx={Math.min(6, w / 2)} fill={fill} />
            )}
            {i % labelEvery === 0 ? (
              <text x={x + w / 2} y={H - 8} textAnchor="middle" className="fill-ink-3 text-[11px]">
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
              it.swatch === 'line' && 'size-2.5 rounded-full bg-accent',
              it.swatch === 'hollow' && 'size-2.5 rounded-full border-2 border-dashed border-ink-3',
              it.swatch === 'band' && 'h-2.5 w-4 bg-ok-soft',
              it.swatch === 'smooth' && 'h-1.5 w-5 rounded-full bg-accent/35',
            )}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
