import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { buttonClass } from '@/components/ui';

/** Catches unexpected rendering errors in one section so the rest of the app keeps working. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('PocketRehab section error', error, info.componentStack);
  }

  override componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="max-w-xl animate-rise py-12">
        {/* An unstuck (hatched) strip: the same mark the app uses for "this couldn't be measured". */}
        <svg width="72" height="24" viewBox="0 0 72 24" aria-hidden className="mb-6">
          <defs>
            <pattern id="eb-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--color-ground)" />
              <path d="M1 0V6" stroke="var(--color-warn-mark)" strokeWidth="1.6" />
            </pattern>
          </defs>
          <path d="M12 12H60" stroke="var(--color-warn-mark)" strokeWidth="20" strokeLinecap="round" />
          <path d="M12 12H60" stroke="url(#eb-hatch)" strokeWidth="15" strokeLinecap="round" />
        </svg>
        <h1 className="text-title">This section ran into a problem</h1>
        <p className="mt-2 text-ink-2">Your saved data is not affected. You can try this section again or go back to Home.</p>
        <p className="mt-4 rounded-[var(--radius-control)] bg-surface-2 px-3 py-2 font-mono text-sm break-words text-ink-2">{this.state.error.message}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" className={buttonClass('primary')} onClick={() => this.setState({ error: null })}>
            <RotateCcw aria-hidden className="size-4" />
            Try again
          </button>
          <a href="#/" className={buttonClass('secondary')}>
            Go to Home
          </a>
        </div>
      </div>
    );
  }
}
