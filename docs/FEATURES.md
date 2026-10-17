# Feature status

What PocketRehab actually does today, what is partial, and what is not built. "Verified" means covered by an automated test or checked by hand in a browser; see `docs/TESTING.md` for the exact runs.

## Implemented and working end to end

| Area | What works | How it was verified |
|---|---|---|
| Onboarding | 10 steps with progress bar, validation, save-and-resume (draft stored on the device), optional steps skippable, demo profile entry | Playwright journey test; manual browser check |
| Plans | Clinician-entered or clearly labelled demonstration plan; per-exercise side, sets, reps, hold, rest, optional clinician target (labelled by source), camera on/off, notes; restrictions; status (active / needs review / unavailable); append-only version history with diffs; JSON export and validated import | Unit tests (validation, diff); Playwright plan-version test |
| Exercise library | 4 tested definitions: arm raise to the side (front view), bicep curl (side), seated knee straightening (side), sit to stand (side, side facing camera chosen automatically) with instructions, phases, measurement method, limitations, equipment, version and source | Unit tests run every exercise through the engine |
| Camera | Permission requested only on an explicit click; errors mapped to plain-language help (denied, missing, busy, insecure, unsupported); disconnect detection; stream stopped on exit | Playwright: permission denied, fake camera, real-person clip |
| Pose estimation | MediaPipe Pose Landmarker (lite or full) in the browser, GPU with CPU fallback, served from the app's origin, cached for offline after first use | Playwright: real model runs on Chromium's fake camera and on a real person clip |
| AR overlay | Skeleton (dimmed when uncertain), live angle arc, target zone anchored to the joint, ghost guide limb, floating rep counter and tracking badge, mirrored with the preview | Real-person screenshots in `docs/screenshots/` |
| Movement analysis | Pixel-space joint angles, frame quality states, glitch rejection, frame-rate-independent smoothing, repetition state machine, timing phases, hold, smoothness (speed peaks), consistency (CV), compensation rules, left/right comparison, Movement Fingerprint | 40+ unit tests and the evaluation harness (`docs/EVALUATION.md`) |
| Live coaching | Pre-session check-in, camera setup checklist, countdown, sets, rest timer, pause/resume, repeat instruction, end with confirmation, traffic light with text, captions, speech synthesis with three styles, optional voice commands, keyboard shortcuts, demonstration panel (play/pause/step/enlarge), auto-pause when the tab is hidden | Unit tests (state machine, coaching rules); Playwright simulated session |
| Safety | Deterministic check-in rules: warning sign → stop and get help (no continue); new/worse symptoms → pause, continue only with explicit acknowledgement; no invented numeric thresholds | Unit + Playwright tests |
| Session records | Saved during and after the session; interrupted sessions recovered and labelled; per-repetition timeline with quality flags; coaching log; deletion | Unit + Playwright tests |
| Progress | Range strips per session, peak-angle trend (raw + labelled smoothed), repetition time, hold time, tracking quality history, sessions and adherence per week, self-reported symptoms, left/right, milestones; every chart has a text summary and a table view; nothing shown without saved data | Playwright demo-profile test; manual check |
| Honest change reporting | Insufficient-data message under 3 comparable sessions; observed change never called improvement because measurement error is not established; documented stability rule | Unit tests |
| Session comparison | Two sessions side by side with comparability warnings and exclusions | Unit + Playwright tests |
| Weekly summary | Sessions, adherence, valid measurements, limitations, self-reports, observed changes, clinician topics, practical suggestions | Unit + Playwright tests |
| Scheduling | Weekly days/time, week view, reschedule (no stacking), skip, mark unavailable, undo, missed-session handling without catch-up, adherence, .ics export with reminders | Unit tests (schedule, adherence, iCalendar validity); Playwright download test |
| Reminders | In-app banner while open; browser notifications after explicit permission; limitations explained | Manual check (logic reviewed); not automated |
| Barriers | "What got in the way" check-in with logistical suggestions only | Manual check |
| Reports | Options (period, exercises, sections), on-screen preview, PDF download generated on the device, print view, JSON data download; missing information labelled | Unit test (report data); Playwright checks the downloaded file is a real PDF |
| Settings and data | Profile, coaching and accessibility, pose model, privacy explanation, backup export/restore (validated), delete single sessions, delete everything, demo profile load/remove, live capability check | Playwright tests; unit tests for export/import/clear |
| Accessibility | Semantic landmarks, skip link, visible focus, labels, text size (4 levels), higher contrast, reduced motion (system or override), captions, non-colour status, large targets, table views of charts, full use without camera or voice | Playwright keyboard + responsive tests; manual review |
| PWA / offline | Installable manifest and icons, service worker precaching the app shell, runtime caching of the pose model, offline banner | Build output; manual check |

## Partially implemented

- **Voice commands:** implemented with the browser's speech recognition where available (mainly Chrome and Edge), off by default. Not covered by automated tests.
- **Demonstration media:** an original animated stick-figure demonstration drawn from the same geometry the analysis uses. There is no video of a real person demonstrating the exercises.
- **Reminders:** reliable only while PocketRehab is open in a tab or installed window; browsers cannot run it in the background.
- **Equipment:** a checklist from the exercise definitions and clinician notes. No shopping (deliberately).
- **Tablet and phone layouts:** responsive and checked at phone and tablet viewport sizes in Chromium; not tested on real iOS or Android devices.

## Not implemented

- Video recording or replay (by design: a timeline of measurements is provided instead, and nothing is recorded).
- Accounts, cloud sync, or a clinician portal. Sharing is by downloading a report or plan file.
- Clinician-validated targets or any clinical validation of measurements.
- A measured minimal detectable change (needs a real repeatability study).
- Exercises beyond the four tested definitions (other exercises can be logged manually only).
- Languages other than English.
