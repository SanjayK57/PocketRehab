import { Component, type ErrorInfo, type ReactNode } from 'react';

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
      <div role="alert" className="max-w-xl space-y-3 py-10">
        <h1 className="text-2xl font-bold">This section ran into a problem</h1>
        <p className="text-ink-2">Your saved data is not affected. You can try this section again or go back to Home.</p>
        <p className="rounded-[var(--radius-control)] bg-surface-2 px-3 py-2 font-mono text-sm text-ink-2">{this.state.error.message}</p>
        <div className="flex gap-2">
          <button type="button" className="min-h-11 rounded-[var(--radius-control)] bg-accent px-4 font-semibold text-accent-ink" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <a href="#/" className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-rule-strong px-4 font-semibold">
            Go to Home
          </a>
        </div>
      </div>
    );
  }
}
