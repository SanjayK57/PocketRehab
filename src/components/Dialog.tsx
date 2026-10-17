import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './ui';

/**
 * Native <dialog> (modal focus trap, Escape to close, backdrop) for the few
 * moments that need protected focus: destructive confirmations and safety stops.
 */
export function Dialog({ open, onClose, title, children, actions, dismissible = true, labelledBy }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions?: ReactNode; dismissible?: boolean; labelledBy?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = labelledBy ?? `dlg-${title.replace(/\W+/g, '-').toLowerCase()}`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      if (typeof el.showModal === 'function') el.showModal();
      else el.setAttribute('open', '');
    } else if (!open && el.open) {
      if (typeof el.close === 'function') el.close();
      else el.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (dismissible && e.target === ref.current) onClose();
      }}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-[var(--radius-card)] bg-surface p-0 text-ink shadow-[0_24px_64px_-16px_rgb(0_0_0/0.4)] backdrop:bg-[rgb(18_20_22/0.55)]"
    >
      {open ? (
        <div className="p-6">
          <div className="mb-3 flex items-start justify-between gap-4">
            <h2 id={headingId} className="text-xl font-bold">
              {title}
            </h2>
            {dismissible ? (
              <button type="button" onClick={onClose} className="-mr-2 -mt-1 rounded-full p-2 text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label="Close">
                <X aria-hidden className="size-5" />
              </button>
            ) : null}
          </div>
          <div className="space-y-3 text-ink-2">{children}</div>
          {actions ? <div className="mt-6 flex flex-wrap justify-end gap-2">{actions}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

export function ConfirmDialog({ open, onCancel, onConfirm, title, children, confirmLabel, danger, busy }: { open: boolean; onCancel: () => void; onConfirm: () => void; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean }) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
