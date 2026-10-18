import { forwardRef, useId, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link, NavLink, type LinkProps } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, Info, Loader2, OctagonAlert } from 'lucide-react';

/** Shared, accessible building blocks. Every colour comes from the design tokens in index.css. */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Index for the `.stagger` / `.tape-lay` / `.bar-grow` CSS delays (a custom property, set through the CSSOM). */
export function staggerStyle(i: number): CSSProperties {
  return { '--i': i } as CSSProperties;
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
type Size = 'md' | 'lg' | 'sm';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink shadow-[0_1px_2px_rgb(8_111_144/0.25)] hover:bg-accent-strong disabled:bg-rule-strong disabled:text-surface disabled:shadow-none',
  secondary: 'bg-surface/60 text-ink border border-ink/25 hover:border-ink/60 hover:bg-surface disabled:text-ink-3 disabled:border-rule disabled:bg-transparent',
  ghost: 'text-accent-strong hover:bg-accent-soft disabled:text-ink-3',
  quiet: 'text-ink-2 hover:text-ink hover:bg-ink/[0.06] disabled:text-ink-3',
  danger: 'bg-alert text-white hover:brightness-95 disabled:opacity-50',
};

const SIZES: Record<Size, string> = {
  sm: 'min-h-9 px-3 text-callout gap-1.5',
  md: 'min-h-11 px-4 text-base gap-2',
  lg: 'min-h-13 px-6 text-[1.0625rem] gap-2.5',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra?: string): string {
  return cx(
    // Press feedback is a quick scale, released with the spring: it confirms the tap without moving the layout.
    'inline-flex items-center justify-center rounded-[var(--radius-control)] font-semibold whitespace-nowrap transition-[background-color,color,border-color,box-shadow,transform] duration-200 ease-[var(--ease-spring)] active:scale-[0.97] active:duration-75 disabled:cursor-not-allowed disabled:active:scale-100 select-none',
    VARIANTS[variant],
    SIZES[size],
    extra,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({ variant = 'primary', size = 'md', className, icon, children, ...rest }: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-9 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 max-w-3xl">
        <h1 className="text-[1.875rem] leading-[1.1] font-bold tracking-[-0.025em] sm:text-display">{title}</h1>
        {description ? <div className="mt-2.5 max-w-[62ch] text-[1.0625rem] leading-relaxed text-ink-2">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/** A hairline-ruled section: the default container. Use sparingly; most content needs no box. */
export function Section({ title, description, actions, children, className, id, as = 'section' }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string; as?: 'section' | 'div' }) {
  const Tag = as;
  const headingId = useId();
  return (
    <Tag id={id} aria-labelledby={title ? headingId : undefined} className={cx('min-w-0 border-t border-ink pt-4', className)}>
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          {title ? (
            <h2 id={headingId} className="text-headline">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions}
        </div>
      ) : null}
      {description ? <div className="-mt-2 mb-4 max-w-[65ch] text-ink-2">{description}</div> : null}
      {children}
    </Tag>
  );
}

/**
 * Section tabs (My Plan, Progress). The active tab carries a short strip of cyan
 * tape that grows in from its centre. `short` is the label used on phones.
 */
export function TabNav({ label, tabs }: { label: string; tabs: Array<{ to: string; label: string; short?: string; end?: boolean }> }) {
  return (
    <nav aria-label={label} className="tab-scroll -mx-4 -mt-3 mb-9 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-rule">
        {tabs.map((t) => (
          <li key={t.to}>
            <NavLink
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cx(
                  'group relative -mb-px inline-flex min-h-11 items-center rounded-t-md px-3 font-semibold transition-colors duration-150',
                  isActive ? 'text-ink' : 'text-ink-2 hover:bg-ink/[0.04] hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {t.short ? (
                    <>
                      <span className="sm:hidden">{t.short}</span>
                      <span className="hidden sm:inline">{t.label}</span>
                    </>
                  ) : (
                    t.label
                  )}
                  <span aria-hidden className={cx('absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-tape transition-transform duration-300 ease-[var(--ease-out)]', isActive ? 'scale-x-100' : 'scale-x-0')} />
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

type Tone = 'info' | 'ok' | 'warn' | 'alert' | 'neutral';

const NOTICE_TONES: Record<Tone, { box: string; icon: ReactNode }> = {
  info: { box: 'bg-accent-soft text-ink', icon: <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-accent-strong" /> },
  ok: { box: 'bg-ok-soft text-ink', icon: <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-ok" /> },
  warn: { box: 'bg-warn-soft text-ink', icon: <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" /> },
  alert: { box: 'bg-alert-soft text-ink', icon: <OctagonAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-alert" /> },
  neutral: { box: 'bg-surface-2 text-ink', icon: <CircleHelp aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-2" /> },
};

export function Notice({ tone = 'info', title, children, actions, className, role }: { tone?: Tone; title?: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string; role?: 'status' | 'alert' }) {
  const t = NOTICE_TONES[tone];
  return (
    <div role={role} className={cx('flex gap-3 rounded-[var(--radius-card)] px-4 py-3.5 sm:px-5', t.box, className)}>
      {t.icon}
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cx('text-[0.95rem] text-ink-2', title ? 'mt-0.5' : null)}>{children}</div> : null}
        {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** A loading placeholder block; give it the size of what it stands in for. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={cx('skeleton block', className)} style={style} />;
}

/** Generic content placeholder: a few lines of text. Prefer PageSkeleton for whole screens. */
export function LoadingBlock({ label = 'Loading', lines = 3 }: { label?: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 py-2">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-4" style={{ width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

/**
 * Whole-screen placeholder shaped like a PocketRehab page: title, a ruled module
 * with tape-strip rows, and a side column. It holds the layout still while
 * local data loads, so nothing jumps when it arrives.
 */
export function PageSkeleton({ label = 'Loading', rows = 4, aside = true }: { label?: string; rows?: number; aside?: boolean }) {
  return (
    <div role="status" aria-live="polite" className="animate-fade">
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-9 w-64 max-w-[70%] rounded-lg" />
      <Skeleton className="mt-4 h-4 w-[28rem] max-w-[90%]" />
      <div className={cx('mt-10 grid gap-x-12 gap-y-10', aside && 'xl:grid-cols-[minmax(0,1fr)_22rem]')}>
        <div className="border-t border-rule pt-4">
          <Skeleton className="h-5 w-56 max-w-[60%]" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-3.5 w-14 shrink-0" />
                <Skeleton className="h-[18px] rounded-full" style={{ width: `${58 - ((i * 13) % 24)}%`, marginLeft: `${18 + ((i * 7) % 10)}%` }} />
              </div>
            ))}
          </div>
        </div>
        {aside ? (
          <div className="space-y-3 rounded-[var(--radius-card)] bg-surface-2/70 p-6">
            <Skeleton className="h-6 w-48 bg-ink/10" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-6 h-12 w-full rounded-[var(--radius-control)]" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', error, onRetry }: { title?: string; error: Error | string; onRetry?: () => void }) {
  return (
    <Notice tone="alert" role="alert" title={title} actions={onRetry ? <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button> : undefined}>
      {typeof error === 'string' ? error : error.message}
    </Notice>
  );
}

// ---------- Form controls ----------

export function Field({ label, help, error, children, htmlFor, optional }: { label: ReactNode; help?: ReactNode; error?: string | null; children: ReactNode; htmlFor: string; optional?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block font-semibold">
        {label}
        {optional ? <span className="ml-2 text-sm font-normal text-ink-3">Optional</span> : null}
      </label>
      {help ? (
        <p id={`${htmlFor}-help`} className="text-sm text-ink-2">
          {help}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="flex animate-fade items-center gap-1.5 text-sm font-semibold text-alert">
          <AlertTriangle aria-hidden className="size-4" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlBase =
  'w-full rounded-[var(--radius-control)] border border-rule-strong/80 bg-surface px-3 text-base text-ink shadow-[inset_0_1px_1px_rgb(29_31_34/0.04)] placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150 hover:border-ink-2 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/20 aria-[invalid=true]:border-alert aria-[invalid=true]:ring-alert/15 disabled:bg-surface-2 disabled:text-ink-3';

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(controlBase, 'min-h-11', className)} {...rest} />;
});

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(controlBase, 'min-h-24 py-2.5 leading-relaxed', className)} {...rest} />;
}

/**
 * Native select (keyboard, screen readers and the phone picker all for free) with a drawn chevron.
 * `className` sizes the control (e.g. "w-auto min-w-72", "w-56"); it applies to the wrapper so the chevron stays inside.
 */
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cx('relative max-w-full', className?.includes('w-auto') ? 'inline-block' : 'block', className)}>
      <select className={cx(controlBase, 'min-h-11 w-full cursor-pointer appearance-none pr-10')} {...rest}>
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-2" />
    </span>
  );
}

/** Large, labelled choice buttons (radio semantics). */
export function ChoiceGroup<T extends string>({ name, legend, options, value, onChange, help, columns = 1 }: { name: string; legend: ReactNode; options: Array<{ value: T; label: ReactNode; description?: ReactNode }>; value: T | null | undefined; onChange: (v: T) => void; help?: ReactNode; columns?: 1 | 2 | 3 }) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-semibold">{legend}</legend>
      {help ? <p className="text-sm text-ink-2">{help}</p> : null}
      <div className={cx('grid gap-2 pt-1', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-3')}>
        {options.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={o.value}
              className={cx(
                'flex min-h-12 cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border px-3.5 py-3 transition-[border-color,background-color,box-shadow] duration-200 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent/25',
                checked ? 'border-accent bg-accent-soft/70 shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'border-rule-strong/70 bg-surface hover:border-ink-2',
              )}
            >
              <input type="radio" name={name} value={o.value} checked={checked} onChange={() => onChange(o.value)} className="mt-1 size-4 shrink-0 focus-visible:outline-none" />
              <span className="min-w-0">
                <span className="block font-semibold">{o.label}</span>
                {o.description ? <span className="mt-0.5 block text-sm text-ink-2">{o.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function CheckboxRow({ checked, onChange, label, description, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; id?: string }) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <label htmlFor={inputId} className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5">
      <input id={inputId} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-[1.1rem] shrink-0" />
      <span>
        <span className="block font-medium">{label}</span>
        {description ? <span className="block text-sm text-ink-2">{description}</span> : null}
      </span>
    </label>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="font-semibold">
          {label}
        </label>
        {description ? <p className="text-sm text-ink-2">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-[30px] w-[51px] shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50',
          checked ? 'bg-accent' : 'bg-rule-strong/70',
        )}
      >
        <span className="sr-only">{checked ? 'On' : 'Off'}</span>
        <span aria-hidden className={cx('inline-block size-[26px] rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.18),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-transform duration-300 ease-[var(--ease-spring)]', checked ? 'translate-x-[23px]' : 'translate-x-[2px]')} />
      </button>
    </div>
  );
}

/** 0–10 scale with labelled ends; can be left unanswered. */
export function Scale({ id, label, value, onChange, minLabel, maxLabel, min = 0, max = 10 }: { id: string; label: ReactNode; value: number | null; onChange: (v: number | null) => void; minLabel: string; maxLabel: string; min?: number; max?: number }) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-semibold">
        {label}
        <span className="ml-2 text-sm font-normal text-ink-3">Optional</span>
      </legend>
      <div role="radiogroup" aria-label={typeof label === 'string' ? label : undefined} className="flex flex-wrap gap-1.5">
        {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => {
          const selected = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={selected}
              id={n === min ? id : undefined}
              onClick={() => onChange(selected ? null : n)}
              className={cx(
                'size-11 rounded-[var(--radius-control)] border text-base font-semibold tabular-nums transition-[background-color,border-color,color,transform] duration-200 ease-[var(--ease-spring)] active:scale-95',
                selected ? 'scale-105 border-accent bg-accent text-accent-ink shadow-[0_4px_12px_-4px_rgb(8_111_144/0.6)]' : 'border-rule-strong/70 bg-surface hover:border-ink-2',
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-sm text-ink-2">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </fieldset>
  );
}

// ---------- Status ----------

export type QualityState = 'reliable' | 'uncertain' | 'unavailable';

export const QUALITY_COPY: Record<QualityState, { label: string; description: string }> = {
  reliable: { label: 'Reliable', description: 'The needed body points are visible and the quality checks passed.' },
  uncertain: { label: 'Uncertain', description: 'Tracking quality is not good enough for dependable feedback.' },
  unavailable: { label: 'Unavailable', description: 'The movement cannot be measured under the current conditions.' },
};

export function QualityBadge({ state, size = 'md', className }: { state: QualityState; size?: 'sm' | 'md'; className?: string }) {
  const styles = {
    reliable: 'bg-ok-soft text-ok',
    uncertain: 'bg-warn-soft text-warn',
    unavailable: 'bg-surface-2 text-ink-2',
  }[state];
  const Icon = state === 'reliable' ? CheckCircle2 : state === 'uncertain' ? AlertTriangle : CircleHelp;
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap', size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm', styles, className)}>
      <Icon aria-hidden className={size === 'sm' ? 'size-3.5' : 'size-4'} />
      <span>Tracking {QUALITY_COPY[state].label.toLowerCase()}</span>
    </span>
  );
}

export function Tag({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'signal' | 'ok' | 'warn' | 'alert'; className?: string }) {
  const styles = {
    neutral: 'bg-surface-2 text-ink-2',
    accent: 'bg-accent-soft text-accent-strong',
    signal: 'bg-signal-soft text-signal-ink',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn',
    alert: 'bg-alert-soft text-alert',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.8rem] font-semibold whitespace-nowrap', styles, className)}>{children}</span>;
}

export function KeyValue({ items, className }: { items: Array<{ label: ReactNode; value: ReactNode; hint?: ReactNode }>; className?: string }) {
  return (
    <dl className={cx('divide-y divide-rule', className)}>
      {items.map((it, i) => (
        <div key={i} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2.5">
          <dt className="text-ink-2">{it.label}</dt>
          <dd className="text-right font-semibold tabular-nums">
            {it.value}
            {it.hint ? <span className="block text-sm font-normal text-ink-3">{it.hint}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
