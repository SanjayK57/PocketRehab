/** PocketRehab mark: a single strip of cyan tape. Authored SVG, decorative (the wordmark carries the name). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 24" className={className} aria-hidden focusable="false">
      <path d="M8 16 L24 8" stroke="var(--color-tape)" strokeWidth="12" strokeLinecap="round" />
      <path d="M8 16 L24 8" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="1.5" strokeDasharray="1.5 3" strokeLinecap="round" />
    </svg>
  );
}
