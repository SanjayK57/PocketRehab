/**
 * "Skip to content" link. With hash-based routing a plain href="#main" would
 * change the route, so it moves focus to the target element instead.
 */
export function SkipLink({ targetId }: { targetId: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="skip-link"
      onClick={(e) => {
        e.preventDefault();
        const el = document.getElementById(targetId);
        el?.focus();
        el?.scrollIntoView();
      }}
    >
      Skip to content
    </a>
  );
}
