import { useState } from 'react';
import { Download, Share, SquarePlus } from 'lucide-react';
import { Dialog } from '@/components/Dialog';
import { cx } from '@/components/ui';
import { promptInstall, useInstallMode } from './install';

/**
 * "Install app": one tap where the browser supports it (Chrome, Edge, Android),
 * otherwise the two Safari steps. Hidden once PocketRehab runs as an installed app.
 */
export function InstallButton({ tone = 'light', className }: { tone?: 'light' | 'rail'; className?: string }) {
  const install = useInstallMode();
  const [open, setOpen] = useState(false);
  if (install === 'installed') return null;

  const onClick = () => {
    if (install === 'prompt') void promptInstall();
    else setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={cx(
          'inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors duration-150',
          tone === 'rail' ? 'bg-rail-3 text-rail-ink hover:bg-tape hover:text-white' : 'bg-accent text-white hover:bg-accent-strong',
          className,
        )}
      >
        <Download aria-hidden className="size-4" />
        Install app
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Install PocketRehab">
        {install === 'ios' ? (
          <ol className="space-y-4">
            <li className="flex gap-3">
              <Share aria-hidden className="mt-0.5 size-5 shrink-0 text-accent-strong" />
              <span>
                In Safari, tap the <strong>Share</strong> button (the square with an arrow, at the bottom or top of the screen).
              </span>
            </li>
            <li className="flex gap-3">
              <SquarePlus aria-hidden className="mt-0.5 size-5 shrink-0 text-accent-strong" />
              <span>
                Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
              </span>
            </li>
          </ol>
        ) : install === 'mac-safari' ? (
          <p>
            In Safari’s menu bar, choose <strong>File → Add to Dock</strong>. PocketRehab opens in its own window like any other app.
          </p>
        ) : (
          <p>
            Open this page in <strong>Chrome</strong>, <strong>Edge</strong> or <strong>Safari</strong>, then use this button again. On Android, Chrome’s ⋮ menu also has <strong>Install app</strong>.
          </p>
        )}
        <p className="mt-4 text-sm text-ink-2">The installed app has its own icon, opens full screen and works offline after your first session. It’s free, with no store and no account required.</p>
      </Dialog>
    </>
  );
}
