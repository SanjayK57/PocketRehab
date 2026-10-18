# Google Drive backup: setup

PocketRehab can back up an account to the user's own Google Drive. It is off until the site owner supplies a Google OAuth client ID; without one, Settings shows the option as unavailable and everything else works.

## What it does (and doesn't)

- Uses Google Identity Services' token client in the browser. There is no PocketRehab server and no client secret.
- Asks for one scope: `https://www.googleapis.com/auth/drive.appdata`. That is a hidden per-app folder in the user's Drive; PocketRehab cannot see any of the user's own files, and other apps cannot see this folder.
- Uploads one file, `pocketrehab-backup.json`, that is encrypted on the device before upload: the account's data is sealed with its AES-256-GCM data key, and the data key travels only in its password-wrapped form (PBKDF2-SHA-256, 1,000,000 rounds). Google stores bytes it cannot read. Restoring on a new device needs the password the account had when the backup was made.
- Keeps the access token in memory only (it expires within an hour) and never stores anything about the Google account unencrypted.
- The production Content-Security-Policy (`vite.config.ts`) allows exactly `https://accounts.google.com` (script and consent frame) and `https://www.googleapis.com` (Drive API calls).

## Setup (about 10 minutes, free)

1. **Create a Google Cloud project.** Go to <https://console.cloud.google.com/>, create a project (for example "PocketRehab"), then open **APIs & Services → Library**, search for **Google Drive API** and click **Enable**.
2. **Configure the consent screen.** In **APIs & Services → OAuth consent screen** (shown as **Google Auth Platform → Branding / Audience / Data access** in newer consoles), choose **External**, enter the app name, a support email and the developer contact email. Under **Data access**, add the scope `.../auth/drive.appdata`. While the app is in **Testing**, add the Google accounts that may use it under **Audience → Test users** (up to 100). Publishing the app removes that limit; `drive.appdata` is not a restricted scope, so no security assessment is needed.
3. **Create the client ID.** In **APIs & Services → Credentials → Create credentials → OAuth client ID**, choose **Web application**. Under **Authorized JavaScript origins** add every origin the app is served from, for example `https://<your-github-username>.github.io` and, for local testing, `http://localhost:5173` and `http://localhost:4173`. No redirect URIs are needed. Copy the client ID (it ends in `.apps.googleusercontent.com`). It is not a secret.
4. **Give it to the build.** Put it in `.env` in the project root:
   `VITE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com`.
   A web client ID is public by design (it is visible in the page anyway), so `.env` can be committed and every build, including GitHub Pages, picks it up. Use `.env.local` (ignored by git) instead to override it on one machine. Vite reads `VITE_*` variables at build time, so rebuild and deploy after changing it.
5. **Check it.** Open the deployed site, create an account, go to **Settings → Google Drive backup**, press **Back up now** and pick a Google account. Then open the site in another browser, choose **Restore a backup → From Google Drive** on the sign-in screen, and enter the account's password. If the Google window doesn't appear, allow pop-ups for the site.

## Troubleshooting

- *"Google Drive backup isn't set up"*: the build had no `VITE_GOOGLE_CLIENT_ID`.
- *`origin_mismatch` in the Google window*: the page's origin is missing from **Authorized JavaScript origins** (step 3). Changes there can take a few minutes to apply.
- *`access_denied`*: the Google account is not a test user while the app is in Testing (step 2).
