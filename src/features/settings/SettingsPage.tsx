import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, CircleHelp, Download, FileUp, MinusCircle, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import type { Preferences, Profile } from '@/lib/validation/schemas';
import { useAppData } from '@/app/AppData';
import { clearAllData, exportAllData, importAllData, readBackupFile, saveProfile } from '@/lib/storage/repositories';
import { isEncryptedBackup } from '@/lib/storage/accounts';
import { detectCapabilities, type Capability } from '@/lib/capabilities/detect';
import { downloadJson, fileStamp } from '@/lib/export/download';
import { exploreDemo } from '@/features/accounts/demo';
import { AccountSection, DriveBackupSection, RestoreSealedDialog } from './AccountSettings';
import { Button, ChoiceGroup, Field, LoadingBlock, Notice, PageHeader, Section, Select, TextInput, cx } from '@/components/ui';
import { ConfirmDialog } from '@/components/Dialog';
import { useToast } from '@/components/Toast';
import { PreferenceFields } from './PreferenceFields';

export function SettingsPage() {
  const { profile } = useAppData();
  if (!profile) return null;
  return (
    <div>
      <PageHeader title="Profile & Settings" description="Your preferences, privacy controls, and what this device supports." actions={<Link to="/settings/about" className="font-bold text-accent-strong underline underline-offset-4">About PocketRehab and safety</Link>} />
      <nav aria-label="Settings sections" className="mb-10 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-accent-strong">
        <a href="#account" className="underline-offset-4 hover:underline">Account</a>
        <a href="#profile" className="underline-offset-4 hover:underline">Profile</a>
        <a href="#coaching" className="underline-offset-4 hover:underline">Coaching & accessibility</a>
        <a href="#tracking" className="underline-offset-4 hover:underline">Camera tracking</a>
        <a href="#privacy" className="underline-offset-4 hover:underline">Privacy & data</a>
        <a href="#capabilities" className="underline-offset-4 hover:underline">This device</a>
      </nav>
      <div className="max-w-3xl space-y-14">
        <AccountSection />
        <ProfileSection key={`p-${profile.updatedAt}`} profile={profile} />
        <PreferencesSection key={`c-${profile.updatedAt}`} profile={profile} />
        <TrackingSection profile={profile} />
        <PrivacySection profile={profile} />
        <DriveBackupSection />
        <CapabilitiesSection />
      </div>
    </div>
  );
}

function ProfileSection({ profile }: { profile: Profile }) {
  const toast = useToast();
  const [name, setName] = useState(profile.displayName);
  const [context, setContext] = useState(profile.rehabContext);
  const [area, setArea] = useState(profile.affectedArea);
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== profile.displayName || context !== profile.rehabContext || area !== profile.affectedArea;
  return (
    <Section id="profile" title="Profile">
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) {
            setError('Enter a name or nickname.');
            return;
          }
          setError(null);
          await saveProfile({ ...profile, displayName: name.trim(), rehabContext: context, affectedArea: area });
          toast.show('Profile saved.');
        }}
      >
        <Field label="Name shown in the app" htmlFor="s-name" error={error}>
          <TextInput id="s-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={error ? true : undefined} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Recovering from" htmlFor="s-ctx" optional>
            <Select id="s-ctx" value={context ?? ''} onChange={(e) => setContext((e.target.value || null) as Profile['rehabContext'])}>
              <option value="">Not set</option>
              <option value="post-surgery">Surgery</option>
              <option value="injury">An injury</option>
              <option value="condition">A longer-term condition</option>
              <option value="other">Something else</option>
              <option value="prefer-not">Prefer not to say</option>
            </Select>
          </Field>
          <Field label="Main area" htmlFor="s-area" optional>
            <Select id="s-area" value={area ?? ''} onChange={(e) => setArea((e.target.value || null) as Profile['affectedArea'])}>
              <option value="">Not set</option>
              {['shoulder', 'elbow', 'knee', 'hip', 'back', 'other', 'prefer-not'].map((a) => (
                <option key={a} value={a}>
                  {a === 'prefer-not' ? 'Prefer not to say' : a[0]?.toUpperCase() + a.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button type="submit" disabled={!dirty}>
          Save profile
        </Button>
      </form>
    </Section>
  );
}

function PreferencesSection({ profile }: { profile: Profile }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState<Preferences>(profile.preferences);
  const dirty = JSON.stringify(prefs) !== JSON.stringify(profile.preferences);
  return (
    <Section id="coaching" title="Coaching & accessibility">
      <PreferenceFields value={prefs} onChange={setPrefs} />
      <div className="sticky bottom-20 mt-6 flex gap-2 lg:bottom-4">
        <Button
          disabled={!dirty}
          onClick={async () => {
            await saveProfile({ ...profile, preferences: prefs });
            toast.show('Preferences saved.');
          }}
        >
          Save preferences
        </Button>
        {dirty ? (
          <Button variant="secondary" onClick={() => setPrefs(profile.preferences)}>
            Discard
          </Button>
        ) : null}
      </div>
    </Section>
  );
}

function TrackingSection({ profile }: { profile: Profile }) {
  const toast = useToast();
  return (
    <Section id="tracking" title="Camera tracking">
      <ChoiceGroup
        name="model"
        legend="Pose model"
        help="Both run entirely on this device. Changing this applies to your next session."
        value={profile.preferences.poseModel}
        onChange={async (v) => {
          await saveProfile({ ...profile, preferences: { ...profile.preferences, poseModel: v } });
          toast.show('Pose model updated.');
        }}
        options={[
          { value: 'lite', label: 'Faster (recommended for laptops)', description: 'MediaPipe Pose Landmarker Lite, about 6 MB.' },
          { value: 'full', label: 'More detailed', description: 'MediaPipe Pose Landmarker Full, about 9 MB. Slower on older devices.' },
        ]}
      />
      <p className="mt-4 text-ink-2">
        Need to re-check your setup? Every camera session starts with a setup check, or you can{' '}
        <Link to="/session" className="font-semibold text-accent-strong underline underline-offset-4">
          start a session
        </Link>
        .
      </p>
    </Section>
  );
}

function PrivacySection({ profile }: { profile: Profile }) {
  const toast = useToast();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState<null | 'clear' | 'import'>(null);
  const [pendingImport, setPendingImport] = useState<unknown>(null);
  const [sealedImport, setSealedImport] = useState<{ file: unknown; from: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persist, setPersist] = useState<boolean | null>(null);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersist).catch(() => setPersist(null));
  }, []);

  const doExport = async () => {
    const bundle = await exportAllData();
    downloadJson(bundle, `pocketrehab-backup-${fileStamp()}.json`);
    toast.show('Backup downloaded. Keep it somewhere private: it contains health information.');
  };

  return (
    <Section id="privacy" title="Privacy & data">
      <div className="space-y-4 text-[1.02rem]">
        <p className="flex gap-2.5">
          <ShieldCheck aria-hidden className="mt-1 size-5 shrink-0 text-tape" />
          <span>
            <strong>Camera:</strong> frames are analysed by an on-device model and immediately discarded. PocketRehab never records, saves or uploads video or images. Only numbers (angles, repetition times, tracking quality) are stored.
          </span>
        </p>
        <p className="flex gap-2.5">
          <ShieldCheck aria-hidden className="mt-1 size-5 shrink-0 text-tape" />
          <span>
            <strong>Storage:</strong> everything is kept in this browser on this device (IndexedDB), encrypted with your account’s password (AES-256-GCM). It doesn’t sync to other devices unless you back it up, and it isn’t a medical record system. Clearing your browser’s site data deletes it.
          </span>
        </p>
        <p className="flex gap-2.5">
          <ShieldCheck aria-hidden className="mt-1 size-5 shrink-0 text-tape" />
          <span>
            <strong>Network:</strong> PocketRehab has no server, no analytics and no ads; accounts exist only on this device. It downloads its own app files and the pose model from the same website. It contacts Google only when you use Google Drive backup, and sends only encrypted data. If you turn on voice commands, some browsers send the audio to their own speech service.
          </span>
        </p>
        <p className="text-sm text-ink-2">
          PocketRehab is a student project, not a certified medical device, and makes no HIPAA or other regulatory claims. {persist === false ? 'Your browser may clear this data when space runs low, so export a backup regularly.' : persist ? 'Your browser has marked this data as persistent.' : ''}
        </p>
      </div>

      <div className="mt-6 space-y-3 border-t border-rule pt-5">
        <h3 className="font-bold">Your data</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void doExport()} icon={<Download aria-hidden className="size-4" />}>
            Export a backup (JSON)
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()} icon={<FileUp aria-hidden className="size-4" />}>
            Restore from backup
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Choose a backup file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const raw = await readBackupFile(f);
                if (isEncryptedBackup(raw)) setSealedImport({ file: raw, from: f.name });
                else {
                  setPendingImport(raw);
                  setConfirm('import');
                }
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          />
        </div>
        <p className="text-sm text-ink-2">
          Readings from your clinic or your own notes go in{' '}
          <Link to="/progress/measurements" className="font-semibold text-accent-strong underline underline-offset-4">
            Your measurements
          </Link>
          . Delete single sessions from{' '}
          <Link to="/progress/history" className="font-semibold text-accent-strong underline underline-offset-4">
            Session history
          </Link>
          .
        </p>
        {profile.isDemo ? null : (
          <p className="text-sm text-ink-2">
            Want to see PocketRehab with a few weeks of sample data?{' '}
            <button type="button" className="font-semibold text-accent-strong underline underline-offset-4" onClick={() => void exploreDemo().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}>
              Explore the demo
            </button>
            . It opens as a separate account; your data stays as it is.
          </p>
        )}
        <div className="pt-2">
          <Button variant="danger" onClick={() => setConfirm('clear')} icon={<Trash2 aria-hidden className="size-4" />}>
            Delete my profile and all data
          </Button>
        </div>
        {error ? <Notice tone="alert" title="That didn’t work">{error}</Notice> : null}
      </div>

      <ConfirmDialog
        open={confirm === 'clear'}
        onCancel={() => setConfirm(null)}
        title="Delete everything?"
        confirmLabel="Delete all data"
        danger
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          await clearAllData();
          setBusy(false);
          setConfirm(null);
          navigate('/welcome');
        }}
      >
        <p>This removes your profile, plan history, sessions, check-ins and measurements from this account. The account itself stays (to remove it too, use Delete account at the top of Settings). This can’t be undone unless you made a backup.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'import'}
        onCancel={() => setConfirm(null)}
        title="Restore this backup?"
        confirmLabel="Replace my data"
        danger
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await importAllData(pendingImport);
            toast.show('Backup restored.');
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
          setBusy(false);
          setConfirm(null);
        }}
      >
        <p>Everything currently on this device will be replaced by the backup. The file is checked first; if it isn’t a valid PocketRehab backup, nothing changes.</p>
      </ConfirmDialog>
      <RestoreSealedDialog backup={sealedImport} onClose={() => setSealedImport(null)} />
    </Section>
  );
}

function CapabilitiesSection() {
  const [caps, setCaps] = useState<Capability[] | null>(null);
  useEffect(() => {
    detectCapabilities().then(setCaps).catch(() => setCaps([]));
  }, []);
  return (
    <Section id="capabilities" title="What this device supports" description="Checked live in this browser. Anything missing has a fallback, so the rest of PocketRehab keeps working.">
      {!caps ? (
        <LoadingBlock label="Checking this device" />
      ) : (
        <ul className="divide-y divide-rule">
          {caps.map((c) => (
            <li key={c.id} className="flex gap-3 py-3">
              {c.status === 'available' ? <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-ok" /> : c.status === 'limited' ? <MinusCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" /> : c.status === 'unavailable' ? <XCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-signal-ink" /> : <CircleHelp aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-3" />}
              <div className="min-w-0">
                <p className="font-semibold">
                  {c.label} <span className={cx('text-sm font-normal', c.status === 'available' ? 'text-ok' : c.status === 'unavailable' ? 'text-signal-ink' : 'text-ink-2')}>· {c.status}</span>
                </p>
                <p className="text-sm text-ink-2">{c.detail}</p>
                {c.status !== 'available' ? <p className="text-sm text-ink-2">Fallback: {c.fallback}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
