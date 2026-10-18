import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, OctagonAlert, X } from 'lucide-react';
import { cx } from './ui';

type ToastTone = 'ok' | 'info' | 'alert';
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  show: (message: string, tone?: ToastTone, action?: ToastItem['action']) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

let counter = 0;

/** Short, non-blocking confirmations ("Saved", "Report downloaded"). Announced to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (message: string, tone: ToastTone = 'ok', action?: ToastItem['action']) => {
      const id = ++counter;
      setItems((xs) => [...xs.slice(-2), { id, tone, message, action }]);
      setTimeout(() => dismiss(id), tone === 'alert' ? 9000 : 5000);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'alert' ? 'alert' : 'status'}
            className={cx('pointer-events-auto flex max-w-md animate-pop items-start gap-3 rounded-[var(--radius-card)] bg-ink px-4 py-3 text-ground shadow-[var(--shadow-float)]')}
          >
            {t.tone === 'ok' ? <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-ok-soft" /> : t.tone === 'alert' ? <OctagonAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-alert-soft" /> : <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-accent-soft" />}
            <p className="flex-1 text-[0.95rem]">{t.message}</p>
            {t.action ? (
              <button
                type="button"
                className="font-semibold text-accent-soft underline"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            ) : null}
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="-mr-1 rounded p-0.5 text-ground/70 hover:text-ground">
              <X aria-hidden className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
