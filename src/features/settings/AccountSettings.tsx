import { useEffect, useId, useState, type FormEvent } from 'react';
import { CloudDownload, CloudUpload, Lock, LogOut, Trash2 } from 'lucide-react';
import {
  AUTO_LOCK_CHOICES,
  AccountError,
  changePassword,
  createEncryptedBackup,
  deleteAccount,
  lockAccount,
  openEncryptedBackup,
  passwordProblem,
  renameAccount,
  setAutoLockMinutes,
  signOut,
  type Account,
} from '@/lib/storage/accounts';
import { exportAllData, getMeta, importAllData, removeDemoData, setMeta } from '@/lib/storage/repositories';
import { Button, Field, Notice, Section, Select, TextInput } from '@/components/ui';
import { Dialog } from '@/components/Dialog';
import { useToast } from '@/components/Toast';
import { PasswordInput, SealButton, StrengthMeter, errorText, relativeDay, useAccountState } from '@/features/accounts/accountUi';
import { connectGoogle, currentGoogleSession, disconnectGoogle, downloadBackup, findBackup, googleConfigured, preloadGoogle, uploadBackup, type DriveBackup, type GoogleSession } from '@/features/accounts/google';

/** Account controls in Settings: name, auto-lock, password, lock/sign out, delete. */
export function AccountSection() {
  const { account } = useAccountState();
  if (!account) return null;
  if (account.kind === 'google') return <GoogleAccountSection account={account} />;
  return account.kind === 'guest' ? <DemoAccountSection /> : <PasswordAccountSection key={account.id} account={account} />;
}

function GoogleAccountSection({ account }: { account: Account }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Section id="account" title="Account">
      <p className="max-w-[60ch] text-ink-2">
        Signed in with Google as <strong className="text-ink">{account.email}</strong>. A few seconds after each change, your data is backed up to a private app folder in your Google Drive, so signing in with Google on another device brings it back.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="secondary" icon={<LogOut aria-hidden className="size-4" />} onClick={() => void signOut()}>
          Sign out
        </Button>
        <Button variant="quiet" icon={<Trash2 aria-hidden className="size-4" />} onClick={() => setConfirming(true)}>
          Remove from this device
        </Button>
      </div>
      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Remove this account from this device?">
        <p>Its data on this device is deleted. The backup in your Google Drive stays, so you can sign in with Google again later to restore it.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="danger" onClick={() => void deleteAccount(null)}>
            Remove
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </Section>
  );
}

function DemoAccountSection() {
  const [busy, setBusy] = useState(false);
  return (
    <Section id="account" title="Account">
      <p className="max-w-[60ch] text-ink-2">You’re exploring the demo account. It has no password and holds only simulated sample data. Your own account keeps its data encrypted on this device.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => void signOut('create')}>Create your own account</Button>
        <Button
          variant="secondary"
          loading={busy}
          icon={<LogOut aria-hidden className="size-4" />}
          onClick={async () => {
            setBusy(true);
            await removeDemoData();
          }}
        >
          Leave the demo
        </Button>
      </div>
    </Section>
  );
}

function PasswordAccountSection({ account }: { account: Account }) {
  const id = useId();
  const toast = useToast();
  const [name, setName] = useState(account.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <Section id="account" title="Account" description={<>Signed in as <strong className="font-semibold text-ink">{account.name}</strong>. Everything in this account is encrypted on this device with your password.</>}>
      <div className="space-y-8">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await renameAccount(name);
              setNameError(null);
              toast.show('Account name saved.');
            } catch (err) {
              setNameError(errorText(err));
            }
          }}
        >
          <div className="min-w-0 flex-1 basis-60">
            <Field label="Account name" htmlFor={`${id}-name`} help="Shown on this device’s sign-in screen, so it isn’t encrypted." error={nameError}>
              <TextInput id={`${id}-name`} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" variant="secondary" disabled={name.trim() === account.name || !name.trim()}>
            Save name
          </Button>
        </form>

        <Field label="Lock automatically" htmlFor={`${id}-lock`} help="After this long without activity. Never during an exercise session.">
          <Select
            id={`${id}-lock`}
            className="max-w-xs"
            value={String(account.autoLockMinutes)}
            onChange={async (e) => {
              await setAutoLockMinutes(Number(e.target.value));
              toast.show('Auto-lock updated.');
            }}
          >
            {AUTO_LOCK_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `After ${m} minutes` : 'After 1 hour'}
              </option>
            ))}
          </Select>
        </Field>

        <div>
          <h3 className="font-semibold">Password</h3>
          <p className="mt-1 max-w-[60ch] text-ink-2">
            There’s no way to reset a forgotten password, not by us and not by anyone. Keep a{' '}
            <a href="#privacy" className="font-semibold text-accent-strong underline underline-offset-4">
              backup
            </a>{' '}
            somewhere safe.
          </p>
          {changing ? <ChangePasswordForm onDone={() => setChanging(false)} /> : (
            <Button variant="secondary" className="mt-3" onClick={() => setChanging(true)}>
              Change password
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-rule pt-5">
          <Button variant="secondary" icon={<Lock aria-hidden className="size-4" />} onClick={() => void lockAccount()}>
            Lock now
          </Button>
          <Button variant="quiet" icon={<LogOut aria-hidden className="size-4" />} onClick={() => void signOut()}>
            Sign out of this device
          </Button>
          <Button variant="quiet" className="text-alert hover:bg-alert-soft hover:text-alert" icon={<Trash2 aria-hidden className="size-4" />} onClick={() => setDeleting(true)}>
            Delete account…
          </Button>
        </div>
      </div>
      <DeleteAccountDialog open={deleting} name={account.name} onClose={() => setDeleting(false)} />
    </Section>
  );
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const id = useId();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const accountName = useAccountState().account?.name ?? '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(next) ?? (next !== confirm ? 'The two new passwords don’t match.' : null);
    if (problem) return setError(problem);
    setError(null);
    setPhase('running');
    try {
      await changePassword(current, next);
      setPhase('done');
      toast.show('Password changed. Backups made before today still open with the old one.');
      onDone();
    } catch (err) {
      setPhase('idle');
      setError(errorText(err));
    }
  };

  return (
    <form onSubmit={submit} className="mt-4 max-w-md animate-rise space-y-4" noValidate>
      <input type="text" name="username" autoComplete="username" value={accountName} readOnly hidden />
      <Field label="Current password" htmlFor={`${id}-cur`}>
        <PasswordInput id={`${id}-cur`} autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="New password" htmlFor={`${id}-new`}>
        <PasswordInput id={`${id}-new`} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-describedby={`${id}-strength`} />
        <div className="pt-1">
          <StrengthMeter password={next} id={`${id}-strength`} />
        </div>
      </Field>
      <Field label="Type the new password again" htmlFor={`${id}-confirm`}>
        <PasswordInput id={`${id}-confirm`} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {error ? (
        <p className="text-sm font-semibold text-alert" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <SealButton phase={phase} busyLabel="Re-locking your key…" disabled={!current || !next}>
          Change password
        </SealButton>
        <Button variant="secondary" size="lg" onClick={onDone} disabled={phase === 'running'}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DeleteAccountDialog({ open, name, onClose }: { open: boolean; name: string; onClose: () => void }) {
  const id = useId();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={() => (busy ? undefined : (setPassword(''), setError(null), onClose()))} title={`Delete “${name}”?`}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await deleteAccount(password);
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <p>This deletes the account and everything in it from this device: plan, sessions, check-ins and measurements. It can’t be undone. Backups you exported or saved to Google Drive are not affected.</p>
        <Field label="Enter your password to confirm" htmlFor={`${id}-pw`} error={error}>
          <PasswordInput id={`${id}-pw`} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={busy} disabled={!password}>
            Delete account
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------- Google Drive ----------

interface DriveMeta {
  lastBackupAt: number;
  email: string | null;
}
const DRIVE_META = 'googleDrive';

export function DriveBackupSection() {
  const { account } = useAccountState();
  const toast = useToast();
  const [session, setSession] = useState<GoogleSession | null>(currentGoogleSession);
  const [meta, setDriveMeta] = useState<DriveMeta | null>(null);
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState<{ s: GoogleSession; found: DriveBackup } | null>(null);
  const [restore, setRestore] = useState<{ file: unknown; from: string } | null>(null);
  const configured = googleConfigured();

  useEffect(() => {
    void getMeta<DriveMeta>(DRIVE_META).then(setDriveMeta).catch(() => undefined);
    if (configured) void preloadGoogle().catch(() => undefined);
  }, [configured]);

  if (!account) return null;

  const ensureSession = async () => {
    const s = currentGoogleSession() ?? (await connectGoogle());
    setSession(s);
    return s;
  };

  const upload = async (s: GoogleSession, existing: DriveBackup | null) => {
    const sealed = await createEncryptedBackup(await exportAllData());
    await uploadBackup(s, sealed, account.id, existing?.id ?? null);
    const next = { lastBackupAt: Date.now(), email: s.email };
    await setMeta(DRIVE_META, next);
    setDriveMeta(next);
    toast.show('Backed up to Google Drive.');
  };

  const backUp = async () => {
    setBusy('backup');
    setError(null);
    try {
      const s = await ensureSession();
      const found = await findBackup(s);
      if (found && found.account && found.account !== account.id) setOverwrite({ s, found });
      else await upload(s, found);
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(null);
  };

  const startRestore = async () => {
    setBusy('restore');
    setError(null);
    try {
      const s = await ensureSession();
      const found = await findBackup(s);
      if (!found) throw new AccountError('missing', `There’s no PocketRehab backup in ${s.email ?? 'this Google account'}’s Drive yet.`);
      setRestore({ file: await downloadBackup(s, found), from: `Google Drive, ${relativeDay(found.modifiedAt)}` });
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(null);
  };

  return (
    <Section id="google-drive" title="Google Drive backup">
      {!configured ? (
        <p className="max-w-[62ch] text-ink-2">Not available in this copy of PocketRehab. Use “Export a backup” below to keep a copy of your data.</p>
      ) : account.kind === 'guest' ? (
        <p className="max-w-[62ch] text-ink-2">Create your own account to back up to Google Drive. The demo account only holds sample data.</p>
      ) : (
        <>
          <p className="max-w-[62ch] text-ink-2">
            Your data is encrypted on this device before it’s uploaded, into a hidden folder in your Drive that only PocketRehab can open. Google stores a file it can’t read. To restore it on another device, you’ll need this account’s password.
          </p>
          <p className="mt-3 text-callout text-ink-2" aria-live="polite">
            {meta ? `Last backed up ${relativeDay(meta.lastBackupAt)}${meta.email ? ` to ${meta.email}` : ''}.` : 'Not backed up to Google Drive yet.'}
            {session?.email && session.email !== meta?.email ? ` Connected as ${session.email}.` : ''}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button icon={<CloudUpload aria-hidden className="size-4" />} loading={busy === 'backup'} disabled={busy !== null} onClick={() => void backUp()}>
              Back up now
            </Button>
            <Button variant="secondary" icon={<CloudDownload aria-hidden className="size-4" />} loading={busy === 'restore'} disabled={busy !== null} onClick={() => void startRestore()}>
              Restore from Drive
            </Button>
            {session ? (
              <Button variant="quiet" onClick={() => void disconnectGoogle().then(() => setSession(null))}>
                Disconnect Google
              </Button>
            ) : null}
          </div>
          {error ? (
            <Notice tone="alert" className="mt-4" role="alert">
              {error}
            </Notice>
          ) : null}
        </>
      )}
      <Dialog open={overwrite !== null} onClose={() => setOverwrite(null)} title="Replace another account’s backup?">
        <p>This Google account already holds a PocketRehab backup made by a different account. Backing up now replaces it, and that backup can’t be brought back.</p>
        <div className="flex flex-wrap justify-end gap-2 pt-4">
          <Button variant="secondary" onClick={() => setOverwrite(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              const o = overwrite;
              setOverwrite(null);
              if (!o) return;
              setBusy('backup');
              try {
                await upload(o.s, o.found);
              } catch (err) {
                setError(errorText(err));
              }
              setBusy(null);
            }}
          >
            Replace it
          </Button>
        </div>
      </Dialog>
      <RestoreSealedDialog backup={restore} onClose={() => setRestore(null)} />
    </Section>
  );
}

/** Asks for the backup's password, then replaces this account's data with it (all or nothing). */
export function RestoreSealedDialog({ backup, onClose }: { backup: { file: unknown; from: string } | null; onClose: () => void }) {
  const id = useId();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    if (phase === 'running') return;
    setPassword('');
    setError(null);
    setPhase('idle');
    onClose();
  };
  return (
    <Dialog open={backup !== null} onClose={close} title="Restore this backup?">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!backup || !password) return;
          setError(null);
          setPhase('running');
          try {
            const { bundle } = await openEncryptedBackup(backup.file, password);
            await importAllData(bundle);
            setPhase('done');
            toast.show('Backup restored.');
            setPassword('');
            setPhase('idle');
            onClose();
          } catch (err) {
            setPhase('idle');
            setError(errorText(err));
          }
        }}
      >
        <p>
          Everything in this account is replaced by the backup <span className="font-semibold text-ink">({backup?.from})</span>. If the password doesn’t open it, nothing changes.
        </p>
        <Field label="Password the account had when the backup was made" htmlFor={`${id}-pw`} error={error}>
          <PasswordInput id={`${id}-pw`} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="lg" onClick={close} disabled={phase === 'running'}>
            Cancel
          </Button>
          <SealButton phase={phase} busyLabel="Opening the backup…" variant="danger" disabled={!password}>
            Replace my data
          </SealButton>
        </div>
      </form>
    </Dialog>
  );
}
