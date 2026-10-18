/**
 * Google Drive backup, entirely in the browser (PocketRehab has no server).
 *
 * Google Identity Services' token client asks for one narrow scope,
 * drive.appdata: a hidden per-app folder in the user's Drive that PocketRehab
 * can see and nothing else can (not the user's files, not other apps). What is
 * uploaded is already encrypted with the account's key (see accounts.ts), so
 * Google stores a file it cannot read. Tokens live in memory only and expire
 * within an hour; nothing about Google is stored unencrypted.
 *
 * Setup (OAuth client id, allowed origins): docs/GOOGLE_SIGN_IN.md.
 */

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || null;
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com';
export const BACKUP_FILE = 'pocketrehab-backup.json';
/** Same ceiling as file backups: refuse anything larger before reading it. */
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export function googleConfigured(): boolean {
  return CLIENT_ID !== null;
}

export class GoogleError extends Error {
  constructor(
    public readonly kind: 'not-configured' | 'cancelled' | 'blocked' | 'network' | 'auth' | 'not-found' | 'too-large',
    message: string,
  ) {
    super(message);
    this.name = 'GoogleError';
  }
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
interface GoogleOAuth2 {
  initTokenClient(config: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type?: string }) => void }): TokenClient;
  revoke(token: string, done?: () => void): void;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

let gis: Promise<GoogleOAuth2> | null = null;

/**
 * Loads Google's sign-in script once. Call it ahead of time (when the backup
 * section appears): browsers only allow the consent popup during a click, and a
 * script still downloading at click time would use that moment up.
 */
export function preloadGoogle(): Promise<GoogleOAuth2> {
  if (!CLIENT_ID) return Promise.reject(new GoogleError('not-configured', 'Google Drive backup isn’t set up for this copy of PocketRehab.'));
  if (!gis) {
    gis = new Promise<GoogleOAuth2>((resolve, reject) => {
      const ready = () => {
        const o = window.google?.accounts?.oauth2;
        if (o) resolve(o);
        else reject(new GoogleError('network', 'Google sign-in didn’t load. Check your connection and try again.'));
      };
      if (window.google?.accounts?.oauth2) return ready();
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = ready;
      s.onerror = () => reject(new GoogleError('network', 'Google sign-in couldn’t be reached. Check your connection and try again.'));
      document.head.appendChild(s);
      setTimeout(() => reject(new GoogleError('network', 'Google sign-in is taking too long to load.')), 20_000);
    }).catch((err: unknown) => {
      gis = null; // allow a retry after a network failure
      throw err;
    });
  }
  return gis;
}

export interface GoogleSession {
  token: string;
  expiresAt: number;
  email: string | null;
}

let session: GoogleSession | null = null;

export function currentGoogleSession(): GoogleSession | null {
  return session && session.expiresAt > Date.now() + 30_000 ? session : null;
}

/** Forgets the token (on lock or sign-out). It expires on Google's side within the hour anyway. */
export function forgetGoogle(): void {
  session = null;
}

/** Opens Google's consent popup. Must run from a click. */
export async function connectGoogle(): Promise<GoogleSession> {
  const oauth2 = await preloadGoogle();
  const token = await new Promise<TokenResponse>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID as string,
      scope: SCOPE,
      callback: (r) => (r.error ? reject(new GoogleError('auth', r.error_description || 'Google didn’t allow access.')) : resolve(r)),
      error_callback: (e) =>
        reject(e.type === 'popup_failed_to_open' ? new GoogleError('blocked', 'Your browser blocked the Google window. Allow pop-ups for this site, then try again.') : new GoogleError('cancelled', 'Google sign-in was closed before it finished.')),
    });
    client.requestAccessToken({ prompt: session ? '' : 'select_account' });
  });
  if (!token.access_token) throw new GoogleError('auth', 'Google didn’t return access.');
  const next: GoogleSession = { token: token.access_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000, email: null };
  try {
    const about = (await api(next, '/drive/v3/about?fields=user(emailAddress)')) as { user?: { emailAddress?: unknown } };
    next.email = typeof about.user?.emailAddress === 'string' ? about.user.emailAddress : null;
  } catch {
    // The address is only shown for reassurance; backup works without it.
  }
  session = next;
  return next;
}

export async function disconnectGoogle(): Promise<void> {
  const s = session;
  session = null;
  if (!s) return;
  const oauth2 = await preloadGoogle().catch(() => null);
  oauth2?.revoke(s.token);
}

async function request(s: GoogleSession, path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${s.token}` }, referrerPolicy: 'no-referrer' });
  } catch {
    throw new GoogleError('network', 'Couldn’t reach Google Drive. Check your connection and try again.');
  }
  if (res.status === 401) {
    session = null;
    throw new GoogleError('auth', 'Google access expired. Connect again to continue.');
  }
  if (res.status === 404) throw new GoogleError('not-found', 'That backup is no longer in Google Drive.');
  if (!res.ok) throw new GoogleError('network', `Google Drive answered with an error (${res.status}). Try again in a moment.`);
  return res;
}

async function api(s: GoogleSession, path: string, init?: RequestInit): Promise<unknown> {
  return (await request(s, path, init)).json() as Promise<unknown>;
}

export interface DriveBackup {
  id: string;
  modifiedAt: number;
  size: number;
  /** The local account id that wrote it (random; lets us warn before one account overwrites another's backup). */
  account: string | null;
}

export async function findBackup(s: GoogleSession): Promise<DriveBackup | null> {
  const q = encodeURIComponent(`name='${BACKUP_FILE}' and trashed=false`);
  const res = (await api(s, `/drive/v3/files?spaces=appDataFolder&q=${q}&orderBy=modifiedTime desc&pageSize=1&fields=files(id,modifiedTime,size,appProperties)`)) as {
    files?: Array<{ id?: unknown; modifiedTime?: unknown; size?: unknown; appProperties?: { account?: unknown } }>;
  };
  const f = res.files?.[0];
  if (!f || typeof f.id !== 'string') return null;
  return {
    id: f.id,
    modifiedAt: typeof f.modifiedTime === 'string' ? Date.parse(f.modifiedTime) || 0 : 0,
    size: Number(f.size) || 0,
    account: typeof f.appProperties?.account === 'string' ? f.appProperties.account : null,
  };
}

/** Creates or replaces the backup file. `body` is the encrypted backup. */
export async function uploadBackup(s: GoogleSession, body: object, account: string, existingId: string | null): Promise<void> {
  const metadata = existingId ? { appProperties: { account } } : { name: BACKUP_FILE, parents: ['appDataFolder'], mimeType: 'application/json', appProperties: { account } };
  const boundary = `pocketrehab-${crypto.randomUUID()}`;
  const payload = [`--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(metadata), `--${boundary}`, 'Content-Type: application/json', '', JSON.stringify(body), `--${boundary}--`, ''].join('\r\n');
  await request(s, existingId ? `/upload/drive/v3/files/${encodeURIComponent(existingId)}?uploadType=multipart` : '/upload/drive/v3/files?uploadType=multipart', {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: payload,
  });
}

export async function downloadBackup(s: GoogleSession, file: DriveBackup): Promise<unknown> {
  if (file.size > MAX_DOWNLOAD_BYTES) throw new GoogleError('too-large', 'That backup is larger than PocketRehab accepts (25 MB).');
  const text = await (await request(s, `/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`)).text();
  if (text.length > MAX_DOWNLOAD_BYTES) throw new GoogleError('too-large', 'That backup is larger than PocketRehab accepts (25 MB).');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GoogleError('not-found', 'The file in Google Drive isn’t a PocketRehab backup.');
  }
}
