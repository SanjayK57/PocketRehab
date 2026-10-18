/**
 * Colours, fonts and small paint helpers for the AR overlay. The theme is read
 * from the design tokens once (getComputedStyle forces style recalculation, so
 * it must never run per frame) and re-read only when the contrast mode changes.
 */

export interface OverlayTheme {
  /** Cyan tape: reliable measurement marks. */
  tape: string;
  /** A lighter tint of the tape, for glowing cores on the dark camera stage. */
  tapeLight: string;
  /** Pink tape: a configured criterion was not met. */
  signal: string;
  /** Amber hatch: tracking uncertain. */
  warn: string;
  /** Lighter amber, legible on the dark stage. */
  warnLight: string;
  ok: string;
  ink: string;
  paper: string;
  font: string;
  mono: string;
  /** The contrast mode this theme was read for, so callers know when to refresh it. */
  key: string;
}

export function readTheme(el: Element): OverlayTheme {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const tape = v('--color-tape', '#0a8fb8');
  const warn = v('--color-warn-mark', '#b7791f');
  return {
    tape,
    tapeLight: mix(tape, '#ffffff', 0.42),
    signal: v('--color-signal', '#d83a7c'),
    warn,
    warnLight: mix(warn, '#ffffff', 0.3),
    ok: v('--color-ok', '#2c7048'),
    ink: v('--color-ink', '#1d1f22'),
    paper: v('--color-surface', '#fffdf8'),
    font: v('--font-sans', 'sans-serif'),
    mono: v('--font-mono', 'monospace'),
    key: themeKey(),
  };
}

/** Identifies the token set currently applied (high contrast swaps several colours). */
export function themeKey(): string {
  return typeof document === 'undefined' ? '' : (document.documentElement.dataset.contrast ?? 'normal');
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Applies an alpha to a #rrggbb colour. */
export function withAlpha(hex: string, alpha: number): string {
  const c = parseHex(hex);
  if (!c) return hex;
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, alpha))})`;
}

/** Linear mix of two #rrggbb colours (t = 0 → a, 1 → b), returned as #rrggbb. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const ch = (i: 0 | 1 | 2) => Math.round(ca[i] + (cb[i] - ca[i]) * t);
  return `#${((1 << 24) | (ch(0) << 16) | (ch(1) << 8) | ch(2)).toString(16).slice(1)}`;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const hatchCache = new WeakMap<CanvasRenderingContext2D, { color: string; pattern: CanvasPattern | null }>();

/**
 * The "unstuck tape" amber hatch used everywhere for uncertain tracking, as a
 * canvas pattern (built once per context and colour).
 */
export function hatchPattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | string {
  const cached = hatchCache.get(ctx);
  if (cached && cached.color === color) return cached.pattern ?? color;
  let pattern: CanvasPattern | null = null;
  if (typeof document !== 'undefined') {
    const tile = document.createElement('canvas');
    tile.width = 8;
    tile.height = 8;
    const t = tile.getContext('2d');
    if (t) {
      t.fillStyle = withAlpha(color, 0.35);
      t.fillRect(0, 0, 8, 8);
      t.strokeStyle = color;
      t.lineWidth = 2;
      t.beginPath();
      // Two diagonals so the stripes tile seamlessly.
      t.moveTo(-2, 10);
      t.lineTo(10, -2);
      t.moveTo(-2, 2);
      t.lineTo(2, -2);
      t.moveTo(6, 10);
      t.lineTo(10, 6);
      t.stroke();
      pattern = ctx.createPattern(tile, 'repeat');
    }
  }
  hatchCache.set(ctx, { color, pattern });
  return pattern ?? color;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
