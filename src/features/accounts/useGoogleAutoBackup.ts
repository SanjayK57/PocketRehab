import { useEffect } from 'react';
import type { Account } from '@/lib/storage/accounts';
import { dataEvents, exportAllData } from '@/lib/storage/repositories';
import { currentGoogleSession, findBackup, uploadBackup } from './google';

/**
 * Google accounts back up to Drive shortly after each change (batched, so a
 * session's many saves become one upload). Skipped quietly when the Google
 * token has expired; the next sign-in uploads again.
 */
export function useGoogleAutoBackup(account: Account | null): void {
  const googleName = account?.kind === 'google' ? account.name : null;
  useEffect(() => {
    if (googleName === null) return;
    let timer = 0;
    let busy = false;
    let fileId: string | null = null;
    const upload = async () => {
      const s = currentGoogleSession();
      if (!s || busy) return;
      busy = true;
      try {
        fileId ??= (await findBackup(s))?.id ?? null;
        await uploadBackup(s, await exportAllData(), googleName, fileId);
        fileId ??= (await findBackup(s))?.id ?? null;
      } catch {
        // Network or token trouble: the next change tries again.
      } finally {
        busy = false;
      }
    };
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void upload(), 6000);
    };
    dataEvents.addEventListener('change', onChange);
    void upload();
    return () => {
      window.clearTimeout(timer);
      dataEvents.removeEventListener('change', onChange);
    };
  }, [googleName]);
}
