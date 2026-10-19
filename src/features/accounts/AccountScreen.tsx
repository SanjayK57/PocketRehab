import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ChevronRight, CloudDownload, FileUp, Plus } from 'lucide-react';
import {
  AccountError,
  DEMO_ACCOUNT_ID,
  PASSWORD_MIN,
  accountRetryAt,
  availableName,
  createAccount,
  isEncryptedBackup,
  legacyDataStatus,
  listAccounts,
  openEncryptedBackup,
  openGoogleAccount,
  passwordProblem,
  rememberedAccountId,
  unlockAccount,
  type Account,
  type LegacyStatus,
} from '@/lib/storage/accounts';
import { importAllData, readBackupFile } from '@/lib/storage/repositories';
import { usePreferencesEffect } from '@/app/usePreferencesEffect';
import { BrandMark } from '@/components/BrandMark';
import { SkipLink } from '@/components/SkipLink';
import { CheckboxRow, Field, LoadingBlock, Notice, TextInput, cx } from '@/components/ui';
import { AccountTab, PasswordInput, SealButton, StrengthMeter, errorText, formatWait, relativeDay, useAccountState, useCountdown } from './accountUi';
import { exploreDemo } from './demo';
import { connectGoogle, downloadBackup, findBackup, googleConfigured, preloadGoogle } from './google';

type View = { kind: 'list' } | { kind: 'unlock'; account: Account } | { kind: 'create'; restore?: { bundle: unknown; from: string } } | { kind: 'restore' };

/**
 * The door to the app: create an account, unlock one, restore a backup on a new
 * device, or open the password-less demo. Shown whenever no account is open.
 */
export function AccountScreen() {
  const state = useAccountState();
  usePreferencesEffect(null); // the last account's text size and contrast don't carry over to this screen
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [legacy, setLegacy] = useState<LegacyStatus>('none');
  const [view, setView] = useState<View | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([listAccounts(), legacyDataStatus()])
      .then(([list, legacyStatus]) => {
        if (!live) return;
        setAccounts(list);
        setLegacy(legacyStatus);
        const remembered = list.find((a) => a.id === rememberedAccountId());
        if (remembered?.id === DEMO_ACCOUNT_ID && state.next === null && state.lockReason === null) {
          // The demo has no password: reopening it after a reload needs no screen at all.
          void exploreDemo().catch((err: unknown) => live && setDemoError(errorText(err)));
          return;
        }
        setView(state.next === 'create' || !list.length ? { kind: 'create' } : remembered?.kind === 'password' ? { kind: 'unlock', account: remembered } : { kind: 'list' });
      })
      .catch((err: unknown) => live && setFatal(errorText(err)));
    return () => {
      live = false;
    };
    // Decided once per visit to this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDemo = async () => {
    setDemoBusy(true);
    setDemoError(null);
    try {
      await exploreDemo();
    } catch (err) {
      setDemoError(errorText(err));
      setDemoBusy(false);
    }
  };

  // Google accounts: the same address always opens the same account, and a new
  // device restores the latest Drive backup before the app opens.
  const continueWithGoogle = async () => {
    setGoogleBusy(true);
    setGoogleError(null);
    try {
      const s = await connectGoogle();
      if (!s.email) throw new Error('Google didn’t share your email address, so PocketRehab couldn’t match your account. Please try again.');
      const fallbackName = s.email.split('@')[0] ?? 'You';
      await openGoogleAccount(s.email, s.name ?? fallbackName, async (isNew) => {
        if (!isNew) return;
        const file = await findBackup(s);
        const data = file ? await downloadBackup(s, file) : null;
        if (data && !isEncryptedBackup(data)) await importAllData(data);
      });
    } catch (err) {
      setGoogleError(errorText(err));
      setGoogleBusy(false);
    }
  };

  if (fatal) {
    return (
      <Frame title="PocketRehab can’t open its storage" intro="Accounts and data live in this browser’s local storage, which isn’t available right now.">
        <Notice tone="alert" title="Storage unavailable">
          {fatal}
        </Notice>
        <p className="mt-4 text-ink-2">Private browsing or blocked site data can cause this. Try a normal window, or allow site data for this page, then reload.</p>
      </Frame>
    );
  }

  if (state.pending === 'demo' || !accounts || !view) {
    return (
      <Frame title={state.pending === 'demo' ? 'Preparing the demo' : 'Opening PocketRehab'} intro={state.pending === 'demo' ? 'Simulating a few weeks of sample sessions. This takes a few seconds the first time.' : undefined}>
        {demoError ? <Notice tone="alert" title="The demo didn’t open">{demoError}</Notice> : <LoadingBlock label={state.pending === 'demo' ? 'Preparing the demo' : 'Opening'} lines={2} />}
      </Frame>
    );
  }

  const hasAccounts = accounts.some((a) => a.kind === 'password');
  const demoRow = (
    <DemoRow busy={demoBusy} error={demoError} onOpen={() => void openDemo()} />
  );

  if (view.kind === 'unlock') {
    return (
      <Frame
        title={`Welcome back, ${view.account.name}`}
        intro="Enter your password to unlock your plan and progress."
        notice={state.lockReason === 'idle' ? `Locked after ${view.account.autoLockMinutes} minutes without activity. Your data is safe.` : state.lockReason === 'closed-elsewhere' ? 'This account was changed in another tab, so it was locked here.' : null}
      >
        <UnlockForm account={view.account} onSwitch={() => setView({ kind: 'list' })} />
      </Frame>
    );
  }

  if (view.kind === 'create') {
    return (
      <Frame
        title={view.restore ? 'Restore into a new account' : hasAccounts ? 'Add an account' : 'Set up PocketRehab'}
        intro={
          view.restore
            ? `Choose a name and password. The backup “${view.restore.from}” is restored into this account, encrypted.`
            : 'Follow your clinician’s plan at home with on-device movement tracking. Sign in with Google to keep your progress backed up and with you on every device, or make a private account that stays in this browser.'
        }
        back={accounts.length ? () => setView({ kind: 'list' }) : undefined}
      >
        {view.restore || !googleConfigured() ? null : (
          <div className="mb-8">
            <GoogleButton busy={googleBusy} onClick={() => void continueWithGoogle()} />
            {googleError ? <p className="mt-2 text-sm font-semibold text-alert" role="alert">{googleError}</p> : null}
            <p className="mt-6 flex items-center gap-3 text-sm text-ink-3" aria-hidden>
              <span className="h-px flex-1 bg-rule" />
              or make a private account on this device
              <span className="h-px flex-1 bg-rule" />
            </p>
          </div>
        )}
        {hasAccounts || view.restore ? null : (
          <p className="-mt-2 mb-8 text-ink-2">
            Just looking around?{' '}
            <button type="button" onClick={() => void openDemo()} disabled={demoBusy} className="font-semibold text-accent-strong underline underline-offset-4 hover:text-ink disabled:cursor-wait">
              {demoBusy ? 'Opening the demo…' : 'Explore the demo'}
            </button>
            , no password needed.
          </p>
        )}
        {demoError ? <p className="-mt-6 mb-6 text-sm font-semibold text-alert" role="alert">{demoError}</p> : null}
        {legacy === 'data' && !view.restore ? (
          <Notice tone="info" title="We found your earlier data" className="mb-6">
            This browser has plans and sessions saved before accounts existed. They move into the account you create now and are encrypted with its password.
          </Notice>
        ) : null}
        <CreateForm restore={view.restore} />
        {view.restore ? null : (
          <div className="mt-10 divide-y divide-rule border-y border-rule">
            {hasAccounts ? demoRow : null}
            <ActionRow icon={<CloudDownload aria-hidden className="size-5" />} title="Restore a backup" detail="Moving from another device? Bring your data with you." onClick={() => setView({ kind: 'restore' })} />
          </div>
        )}
      </Frame>
    );
  }

  if (view.kind === 'restore') {
    return (
      <Frame title="Restore a backup" intro="Bring your plan and history from another device or browser." back={() => setView(accounts.length ? { kind: 'list' } : { kind: 'create' })}>
        <RestorePanel onPlainBackup={(bundle, from) => setView({ kind: 'create', restore: { bundle, from } })} />
      </Frame>
    );
  }

  return (
    <Frame title="Who’s exercising?" intro="Each account’s data is separate and encrypted with its own password.">
      <ul className="-mx-2 space-y-1" aria-label="Accounts on this device">
        {accounts.map((a, i) => (
          <li key={a.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}>
            <button
              type="button"
              onClick={() => (a.kind === 'guest' ? void openDemo() : a.kind === 'google' ? void continueWithGoogle() : setView({ kind: 'unlock', account: a }))}
              className="group flex w-full items-center gap-4 rounded-[var(--radius-card)] px-2 py-3 text-left transition-colors duration-150 hover:bg-surface-2/70"
            >
              <AccountTab account={a} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-headline">{a.name}</span>
                <span className="block text-callout text-ink-2">{a.kind === 'guest' ? 'Sample data · no password' : a.kind === 'google' ? `Google · ${a.email ?? ''}` : `${a.email ? `${a.email} · ` : ''}last opened ${relativeDay(a.lastUsedAt)}`}</span>
              </span>
              <ChevronRight aria-hidden className="size-5 text-ink-3 transition-transform duration-200 ease-[var(--ease-out)] group-hover:translate-x-0.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-8 divide-y divide-rule border-y border-rule">
        <ActionRow icon={<Plus aria-hidden className="size-5" />} title="Add an account" detail="For someone else using this device." onClick={() => setView({ kind: 'create' })} />
        {accounts.some((a) => a.kind === 'guest') ? null : demoRow}
        <ActionRow icon={<CloudDownload aria-hidden className="size-5" />} title="Restore a backup" detail="From Google Drive or a backup file." onClick={() => setView({ kind: 'restore' })} />
      </div>
      {demoError ? <p className="mt-3 text-sm font-semibold text-alert" role="alert">{demoError}</p> : null}
      {googleError ? <p className="mt-3 text-sm font-semibold text-alert" role="alert">{googleError}</p> : null}
    </Frame>
  );
}

// ---------- Layout ----------

function Frame({ title, intro, children, back, notice }: { title: string; intro?: ReactNode; children: ReactNode; back?: () => void; notice?: string | null }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Each view is a new "page" for screen readers and keyboard users.
  useEffect(() => headingRef.current?.focus({ preventScroll: true }), [title]);
  return (
    <div className="min-h-dvh bg-ground">
      <SkipLink targetId="account-main" />
      <div className="mx-auto grid min-h-dvh max-w-6xl content-start gap-x-16 px-4 sm:px-8 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:px-12">
        <header className="flex items-center gap-2.5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-10 lg:col-span-2 lg:pb-16 lg:pt-10">
          <BrandMark className="h-6 w-8" />
          <span className="text-lg font-bold tracking-[-0.02em]">PocketRehab</span>
        </header>
        <main id="account-main" tabIndex={-1} className="pb-12 outline-none" key={title}>
          {back ? (
            <button type="button" onClick={back} className="-ml-2 mb-4 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-2 font-semibold text-accent-strong hover:bg-accent-soft">
              <ArrowLeft aria-hidden className="size-4" />
              Back
            </button>
          ) : null}
          <h1 ref={headingRef} tabIndex={-1} className="animate-rise text-display text-balance outline-none">
            {title}
          </h1>
          {intro ? <p className="mt-3 max-w-[46ch] animate-rise text-[1.0625rem] text-ink-2 [animation-delay:40ms]">{intro}</p> : null}
          {notice ? (
            <Notice tone="neutral" role="status" className="mt-6">
              {notice}
            </Notice>
          ) : null}
          <div className="mt-8 animate-rise [animation-delay:80ms]">{children}</div>
        </main>
        <DataPromise />
      </div>
    </div>
  );
}

/** What an account here means, said once, plainly. Beside the form on wide screens, after it on phones. */
function DataPromise() {
  return (
    <aside aria-label="How your data is kept" className="pb-16 pt-4 lg:self-start lg:border-l lg:border-rule lg:pb-0 lg:pl-12 lg:pt-1">
      <svg viewBox="0 0 220 40" aria-hidden className="mb-8 hidden h-10 w-auto lg:block">
        <path d="M14 26 L206 14" stroke="var(--color-tape)" strokeWidth="20" strokeLinecap="round" pathLength={1} className="tape-lay" />
        <path d="M14 26 L206 14" stroke="#fff" strokeOpacity="0.32" strokeWidth="1.5" strokeDasharray="2 5" strokeLinecap="round" />
      </svg>
      <dl className="max-w-[38ch] space-y-7">
        <div>
          <dt className="text-headline">Encrypted before it’s saved</dt>
          <dd className="mt-1.5 text-ink-2">Your password unlocks a key that seals every record. Without it, the data on this device can’t be read by anyone, including us.</dd>
        </div>
        <div>
          <dt className="text-headline">Google or private, your choice</dt>
          <dd className="mt-1.5 text-ink-2">With Google, a backup goes to a private app folder in your own Drive so you can pick up on any device. Either way there are no ads or tracking, and the camera video never leaves your device.</dd>
        </div>
        <div>
          <dt className="text-headline">No password reset</dt>
          <dd className="mt-1.5 text-ink-2">No copy of your key exists anywhere else, so a forgotten password can’t be recovered. A backup from Settings keeps you covered.</dd>
        </div>
      </dl>
    </aside>
  );
}

function ActionRow({ icon, title, detail, onClick, busy, bare }: { icon: ReactNode; title: string; detail: string; onClick: () => void; busy?: boolean; bare?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} aria-busy={busy || undefined} className="group flex w-full items-center gap-4 px-1 py-4 text-left transition-colors duration-150 hover:bg-surface-2/50 disabled:cursor-wait">
      <span className={cx('grid w-10 shrink-0 place-items-center text-ink-2 transition-colors group-hover:text-ink', !bare && 'size-10 rounded-full border border-rule-strong/50 group-hover:border-ink-2')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-callout text-ink-2">{detail}</span>
      </span>
      <ChevronRight aria-hidden className="size-5 text-ink-3 transition-transform duration-200 ease-[var(--ease-out)] group-hover:translate-x-0.5" />
    </button>
  );
}

function DemoRow({ busy, error, onOpen }: { busy: boolean; error: string | null; onOpen: () => void }) {
  return (
    <div>
      <ActionRow
        icon={<AccountTab account={{ name: 'Demo', kind: 'guest' }} size="sm" />}
        bare
        title={busy ? 'Opening the demo…' : 'Explore the demo'}
        detail="No password. Simulated sample data, clearly labelled."
        onClick={onOpen}
        busy={busy}
      />
      {error ? <p className="pb-3 text-sm font-semibold text-alert" role="alert">{error}</p> : null}
    </div>
  );
}

// ---------- Unlock ----------

function UnlockForm({ account, onSwitch }: { account: Account; onSwitch: () => void }) {
  const id = useId();
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const wait = useCountdown(retryAt);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void accountRetryAt(account.id).then(setRetryAt).catch(() => undefined);
  }, [account.id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || phase === 'running' || wait > 0) return;
    setError(null);
    setPhase('running');
    try {
      await unlockAccount(account.id, password);
      setPhase('done');
    } catch (err) {
      setPhase('idle');
      setError(errorText(err));
      if (err instanceof AccountError) setRetryAt(err.retryAt);
      setPassword('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {/* Lets password managers file the password under this account's name. */}
      <input type="text" name="username" autoComplete="username" value={account.name} readOnly hidden />
      <Field label="Password" htmlFor={`${id}-pw`} error={wait > 0 ? null : error}>
        <PasswordInput
          ref={inputRef}
          id={`${id}-pw`}
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-pw-error` : undefined}
          disabled={phase === 'running'}
        />
      </Field>
      {wait > 0 ? (
        <Notice tone="warn" role="status" title={`Try again in ${formatWait(wait)}`}>
          Several wrong passwords in a row, so each new try waits a little longer. This protects your data if someone else is guessing.
        </Notice>
      ) : null}
      <SealButton phase={phase} busyLabel="Unlocking…" className="w-full" disabled={!password || wait > 0}>
        Unlock
      </SealButton>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <button type="button" onClick={onSwitch} className="-ml-1 min-h-11 rounded-[var(--radius-control)] px-1 font-semibold text-accent-strong underline-offset-4 hover:underline">
          Use another account
        </button>
        <button type="button" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp} aria-controls={`${id}-forgot`} className="-mr-1 min-h-11 rounded-[var(--radius-control)] px-1 text-ink-2 underline-offset-4 hover:text-ink hover:underline">
          Forgot your password?
        </button>
      </div>
      {showHelp ? (
        <div id={`${id}-forgot`} className="animate-rise rounded-[var(--radius-card)] bg-surface-2 px-5 py-4 text-[0.95rem] text-ink-2">
          <p className="font-semibold text-ink">It can’t be reset.</p>
          <p className="mt-1">
            Your password is the only key to this account’s data, and no copy of it exists anywhere else. That’s what keeps it private. If you have a backup, add a new account and restore it there. Otherwise, start a new account; the old one can be deleted after you sign in to it.
          </p>
        </div>
      ) : null}
    </form>
  );
}

// ---------- Create ----------

function CreateForm({ restore }: { restore?: { bundle: unknown; from: string } }) {
  const id = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<'name' | 'email' | 'password' | 'confirm' | 'understood' | 'form', string>>>({});
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (phase === 'running') return;
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Enter a name for this account.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'Enter an email address, like name@example.com.';
    const problem = passwordProblem(password);
    if (problem) next.password = problem;
    else if (confirm !== password) next.confirm = 'The two passwords don’t match.';
    if (!understood) next.understood = 'Please confirm you understand this before continuing.';
    setErrors(next);
    if (Object.keys(next).length) {
      document.getElementById(`${id}-${Object.keys(next)[0]}`)?.focus();
      return;
    }
    setPhase('running');
    try {
      await createAccount(name, password, restore ? () => importAllData(restore.bundle) : undefined, email);
      setPhase('done');
    } catch (err) {
      setPhase('idle');
      setErrors(err instanceof AccountError && /email/i.test(err.message) ? { email: err.message } : err instanceof AccountError && /already an account|name/i.test(err.message) ? { name: err.message } : { form: errorText(err) });
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <Field label="Account name" htmlFor={`${id}-name`} help="Shown on this device’s sign-in screen, so it isn’t encrypted. A first name is enough." error={errors.name}>
        <TextInput id={`${id}-name`} autoComplete="name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={errors.name ? true : undefined} aria-describedby={`${id}-name-help`} />
      </Field>
      <Field label="Email" htmlFor={`${id}-email`} help="Identifies your account on this device and matches it if you later sign in with Google. PocketRehab has no server, so it never emails you and can’t reset a password." error={errors.email}>
        <TextInput id={`${id}-email`} type="email" inputMode="email" autoComplete="username email" maxLength={120} value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={errors.email ? true : undefined} aria-describedby={`${id}-email-help`} />
      </Field>
      <Field label="Password" htmlFor={`${id}-password`} help={`At least ${PASSWORD_MIN} characters. A short sentence is easy to remember and hard to guess.`} error={errors.password}>
        <PasswordInput id={`${id}-password`} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={errors.password ? true : undefined} aria-describedby={`${id}-password-help ${id}-strength`} />
        <div className="pt-1">
          <StrengthMeter password={password} id={`${id}-strength`} />
        </div>
      </Field>
      <Field label="Type it again" htmlFor={`${id}-confirm`} error={errors.confirm}>
        <PasswordInput id={`${id}-confirm`} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={errors.confirm ? true : undefined} />
      </Field>
      <div className="rounded-[var(--radius-card)] bg-surface-2 px-4 pb-1 pt-3">
        <p className="px-1 text-callout text-ink-2">There’s no way to reset a forgotten password. Not by us, not by anyone. That’s what keeps your data private.</p>
        <CheckboxRow id={`${id}-understood`} checked={understood} onChange={setUnderstood} label="I understand that if I forget this password, my data can’t be recovered." />
        {errors.understood ? <p className="px-1 pb-2 text-sm font-semibold text-alert" role="alert">{errors.understood}</p> : null}
      </div>
      {errors.form ? <Notice tone="alert" title="The account wasn’t created">{errors.form}</Notice> : null}
      <SealButton phase={phase} busyLabel={restore ? 'Creating and restoring…' : 'Creating your key…'} className="w-full">
        {restore ? 'Create account and restore' : 'Create account'}
      </SealButton>
    </form>
  );
}

// ---------- Restore on a new device ----------

function RestorePanel({ onPlainBackup }: { onPlainBackup: (bundle: unknown, from: string) => void }) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sealed, setSealed] = useState<{ file: unknown; from: string } | null>(null);
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [busy, setBusy] = useState<'google' | 'file' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const google = googleConfigured();

  useEffect(() => {
    if (google) void preloadGoogle().catch(() => undefined);
  }, [google]);

  const take = (raw: unknown, from: string) => {
    if (isEncryptedBackup(raw)) setSealed({ file: raw, from });
    else onPlainBackup(raw, from);
  };

  const fromGoogle = async () => {
    setBusy('google');
    setError(null);
    try {
      const s = await connectGoogle();
      const found = await findBackup(s);
      if (!found) throw new AccountError('missing', `There’s no PocketRehab backup in ${s.email ?? 'this Google account'}’s Drive. Back up from Settings on your other device first.`);
      take(await downloadBackup(s, found), `Google Drive, ${relativeDay(found.modifiedAt)}`);
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(null);
  };

  const open = async (e: FormEvent) => {
    e.preventDefault();
    if (!sealed || !password || phase === 'running') return;
    setError(null);
    setPhase('running');
    try {
      const { name, bundle } = await openEncryptedBackup(sealed.file, password);
      await createAccount(await availableName(name), password, () => importAllData(bundle));
      setPhase('done');
    } catch (err) {
      setPhase('idle');
      setError(errorText(err));
    }
  };

  if (sealed) {
    return (
      <form onSubmit={open} className="space-y-5" noValidate>
        <p className="text-ink-2">
          Found an encrypted backup <span className="font-semibold text-ink">({sealed.from})</span>. Enter the password the account had when this backup was made. It becomes this account’s password here too.
        </p>
        <Field label="Backup password" htmlFor={`${id}-pw`} error={error}>
          <PasswordInput id={`${id}-pw`} autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} disabled={phase === 'running'} />
        </Field>
        <SealButton phase={phase} busyLabel="Opening the backup…" className="w-full" disabled={!password}>
          Restore
        </SealButton>
        <button type="button" className="min-h-11 font-semibold text-accent-strong underline-offset-4 hover:underline" onClick={() => (setSealed(null), setError(null))}>
          Choose a different backup
        </button>
      </form>
    );
  }

  return (
    <div>
      <div className="divide-y divide-rule border-y border-rule">
        {google ? (
          <ActionRow icon={<CloudDownload aria-hidden className="size-5" />} title={busy === 'google' ? 'Waiting for Google…' : 'From Google Drive'} detail="The encrypted backup saved from Settings on your other device." onClick={() => void fromGoogle()} busy={busy !== null} />
        ) : null}
        <ActionRow icon={<FileUp aria-hidden className="size-5" />} title="From a backup file" detail="A .json backup exported from PocketRehab." onClick={() => fileRef.current?.click()} busy={busy !== null} />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label="Choose a backup file"
        tabIndex={-1}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy('file');
          setError(null);
          try {
            take(await readBackupFile(f), f.name);
          } catch (err) {
            setError(errorText(err));
          }
          setBusy(null);
        }}
      />
      {!google ? <p className="mt-4 text-callout text-ink-3">Google Drive backup isn’t set up for this copy of PocketRehab, so backups move as files.</p> : null}
      {error ? (
        <p className={cx('mt-4 text-sm font-semibold text-alert')} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function GoogleButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex h-13 w-full items-center justify-center gap-3 rounded-[var(--radius-control)] border border-ink/25 bg-surface px-4 text-headline text-ink transition-colors duration-150 hover:border-ink/50 hover:bg-white disabled:cursor-wait disabled:opacity-70"
    >
      <svg aria-hidden viewBox="0 0 48 48" className="size-5">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      {busy ? 'Opening Google…' : 'Continue with Google'}
    </button>
  );
}
