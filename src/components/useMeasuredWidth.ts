import { useEffect, useRef, useState } from 'react';

/** Tracks an element's rendered width so SVG charts can keep readable text at any screen size. */
export function useMeasuredWidth<T extends HTMLElement>(fallback = 720) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth((prev) => (Math.abs(w - prev) > 1 ? Math.round(w) : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}
