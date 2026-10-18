import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronsUpDown, Lock, LogOut, Settings, Users } from 'lucide-react';
import { lockAccount, signOut } from '@/lib/storage/accounts';
import { removeDemoData } from '@/lib/storage/repositories';
import { cx } from '@/components/ui';
import { AccountTab, useAccountState } from './accountUi';

/**
 * The signed-in account in the app shell: who is using the app, and the quick
 * way to lock it or hand the device to someone else. `compact` is the phone
 * header (just the tab); the full version sits at the foot of the dark rail.
 */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { account } = useAccountState();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    items()[0]?.focus();
    const away = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  if (!account) return null;
  const guest = account.kind === 'guest';

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'Tab') close(false);
  };

  const select = (fn: () => unknown) => {
    close(false);
    void fn();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={compact ? `Account: ${account.name}` : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'flex items-center rounded-[var(--radius-control)] text-left transition-colors duration-150',
          compact ? 'size-11 justify-center hover:bg-ink/[0.06]' : 'min-h-14 w-full gap-3 px-2 hover:bg-rail-2 focus-visible:outline-rail-ink',
          open && (compact ? 'bg-ink/[0.06]' : 'bg-rail-2'),
        )}
      >
        <AccountTab account={account} size="sm" tone={compact ? 'paper' : 'rail'} />
        {compact ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-rail-ink">{account.name}</span>
              <span className="block truncate text-footnote text-rail-ink-2">{guest ? 'Demo · sample data' : 'Encrypted locally'}</span>
            </span>
            <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-rail-ink-2" />
          </>
        )}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`${account.name}’s account`}
          onKeyDown={onMenuKey}
          className={cx(
            'absolute z-50 w-64 origin-bottom animate-pop rounded-[var(--radius-card)] border border-rule bg-surface p-1.5 text-ink shadow-[var(--shadow-float)] [animation-duration:220ms]',
            compact ? 'right-0 top-full mt-2 origin-top-right' : 'bottom-full left-0 mb-2',
          )}
        >
          <div className="px-3 pb-2.5 pt-2">
            <p className="truncate font-semibold">{account.name}</p>
            <p className="text-footnote text-ink-2">{guest ? 'Simulated sample data. No password.' : 'Data on this device is encrypted with your password.'}</p>
          </div>
          <div className="my-1 border-t border-rule" />
          {guest ? null : <Item icon={<Lock aria-hidden className="size-4" />} onSelect={() => select(() => lockAccount())} hint="Your password opens it again">Lock now</Item>}
          <Item icon={<Users aria-hidden className="size-4" />} onSelect={() => select(() => signOut())}>
            Switch account
          </Item>
          <Item icon={<Settings aria-hidden className="size-4" />} onSelect={() => select(() => navigate('/settings#account'))}>
            Account settings
          </Item>
          {guest ? (
            <Item icon={<LogOut aria-hidden className="size-4" />} onSelect={() => select(() => removeDemoData())} hint="Deletes the sample data">
              Leave the demo
            </Item>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Item({ icon, children, hint, onSelect }: { icon: ReactNode; children: ReactNode; hint?: string; onSelect: () => void }) {
  return (
    <button type="button" role="menuitem" tabIndex={-1} onClick={onSelect} className="flex min-h-11 w-full items-center gap-3 rounded-[calc(var(--radius-card)-6px)] px-3 py-2 text-left outline-none transition-colors duration-100 hover:bg-surface-2 focus-visible:bg-surface-2">
      <span className="text-ink-2">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{children}</span>
        {hint ? <span className="block text-footnote text-ink-3">{hint}</span> : null}
      </span>
    </button>
  );
}
