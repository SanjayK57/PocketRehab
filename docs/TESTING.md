# Testing and audit report

This report lists what was actually run on 2026-10-17, the real results, the bugs those runs found and fixed, and what was not tested. Nothing here claims clinical accuracy.

**Test machine:** MacBook Pro (Apple silicon), macOS, Node.js 24, Playwright 1.64 with Chromium (headless shell 156). No physical camera or real phone was used in automated runs.

## Commands

```bash
npm install                       # also copies the MediaPipe runtime into public/
npm run dev                       # http://localhost:5173
npm run typecheck                 # tsc -b, strict mode
npm run lint                      # eslint .
npm test                          # vitest (unit + integration)
npm run evaluate                  # writes docs/EVALUATION.md
npx playwright install chromium   # once
sh scripts/fetch-test-video.sh    # optional: real-person clip for tests/e2e/real-person.spec.ts
npm run test:e2e                  # builds, serves the production build, runs Playwright
npm run build                     # production build in dist/
```

## Results of the final run

| Check | Result |
|---|---|
| TypeScript (`tsc -b`, strict, `noUncheckedIndexedAccess`) | Pass, 0 errors |
| ESLint (recommended + typescript-eslint + React hooks v7 rules) | Pass, 0 problems |
| Unit and integration tests (Vitest) | **83 passed, 0 failed** (3 files) |
| Evaluation harness (`npm run evaluate`) | Pass; results in `docs/EVALUATION.md` |
| Production build (`vite build` + PWA) | Pass; service worker precaches 34 files (≈2.4 MB); pose model cached on first use |
| Browser tests (Playwright, desktop + phone + tablet viewports) | **13 passed, 0 failed**, 2 skipped (the keyboard test is skipped on the two touch-device emulations by design), 1.6 min |
| Impeccable design detector (`impeccable detect src`) | 0 findings |

### What the unit and integration tests cover (83)

- **Movement analysis (41):** angle maths for right/straight/acute angles, 2D and 3D, cosine clamping, explicit failures for missing / non-finite / zero-length points; pixel-space normalization on non-square frames; the synthetic skeleton reproducing exact angles for every exercise and side; body-view and trunk-lean estimates; frame quality states (reliable, uncertain, unavailable) for no person, inference errors, missing, hidden, partly visible and out-of-frame landmarks, and the wrong camera view; frame-rate-independent smoothing and gap reset; jump detection; statistics helpers; the repetition state machine on valid, incomplete, duplicated, noisy, interrupted, too-fast, never-returning and variable-speed movements; the full engine on synthetic sessions (accurate peaks, below-threshold movements, noise, glitches, missing landmarks, partial occlusion, camera interruption, repeated frames, hold timing, compensation only on reliable data, all four exercises); smoothness and fingerprint rules.
- **Session state machine (7):** full camera session with sets and rest, repetitions ignored while paused, rest time kept across a pause, urgent stop cannot continue, caution needs explicit acknowledgement, camera loss → reconnect or end (marked interrupted), ending early never adds repetitions.
- **Storage (9):** save/read after a simulated reload, append-only plan history, validation on write, corrupted records skipped on read, session deletion with its check-ins, interrupted-session recovery, export → clear → import round trip, invalid backup rejected without touching data, demo profile removal.
- **Validation (3), safety rules (4), coaching rules (5), scheduling and adherence (5, including a byte-level iCalendar check), progress analysis (7), report data (2).**

### Browser tests (Playwright)

| Test | What it proves |
|---|---|
| Core journey | Onboarding with validation → plan and restrictions → exercise detail → pre-check-in → simulated session to completion → post check-in → summary → reload keeps data → simulated data not shown as progress → PDF report is a real PDF file → .ics file contains events → reschedule form → text-size preference applied → session deleted → all data cleared |
| Warning sign | A checked warning sign shows "Stop and get help now" with no way to continue |
| Worsening symptoms | Caution screen; continue stays disabled until the acknowledgement is ticked; manual log saved |
| Interrupted session | Reloading mid-session keeps the data, marks it interrupted and shows a banner |
| Demo profile | Charts render from stored data, table view works, comparison warnings, weekly summary, capability list, demo removal |
| Plan versioning | Saving requires the clinician-source confirmation; new version with a recorded diff and note |
| Camera permission denied | Plain-language explanation plus simulated and manual fallbacks |
| Fake camera | The real MediaPipe WebAssembly model loads and processes frames; with no person the setup cannot report "ready"; leaving the page stops every camera track |
| Real person | A real person on video is detected, the "facing the camera" check passes, live angles and repetitions are measured with quality states (numbers in `docs/EVALUATION.md`) |
| Responsive | No horizontal overflow on 7 main screens at 1440 px, phone (Pixel 7) and tablet (Galaxy Tab S4) sizes; the right navigation is present and works at each size |
| Keyboard | Skip link is the first tab stop and moves focus into the main content |

## Bugs found by testing and fixed

1. **Demo profile opened before its data existed** and later jumped the user back to Home. The profile is now written last (`demoProfile.ts`); onboarding also saves the plan before the profile.
2. **Demo week showed "Missed" for days with sessions**, because simulated sessions never counted. Adherence now counts simulated sessions only inside the labelled demo profile (`schedule.ts`, all callers).
3. **Escape never ended a session.** The key press opened the "End session?" dialog and the same press closed it again (browser close request). Fixed by consuming the key and opening on the next tick; shortcuts also now work when a button has focus.
4. **Simulated session showed a black stage in development** (React's double-mount stopped the simulator and a guard blocked the restart). The stage now restarts cleanly.
5. **"Skip to content" changed the route** under hash routing. Replaced with a focus-moving skip link.
6. **Chart text became tiny on phones.** Charts now size their drawing to the container so labels stay readable.
7. **Target label clipped at the chart edge**; strip value labels overlapped the frame.
8. **The navigation `aria-label` was on the wrong element** (the complementary landmark instead of the `nav`).
9. **AR overlay was cramped** on small figures; the target zone and counter were enlarged and the counter moved to the side away from the moving limb.
10. React hooks lint findings (refs written during render, a self-referencing animation loop, a state update inside an effect) were fixed by moving ref updates into layout effects, restructuring the loop and deriving state.
11. The PDF text filter used a control-character regex; replaced with an explicit allow list.
12. Dead code removed (unused helpers and components); the reduced-motion preference is now applied to the exercise demonstration.

## Audit checklist

| Requirement | Status |
|---|---|
| App starts; checks, tests and build pass | Yes (see results) |
| Every visible button does what it says | Reviewed screen by screen; the main flows are exercised by the browser tests. No empty handlers (`grep` for empty `onClick` returns nothing). |
| Charts and summaries use stored data only | Yes; new profiles show empty states; the sample data lives only in the labelled demo profile |
| Permission denied, disconnection, unsupported APIs, model failure, missing landmarks, uncertain tracking | Each has a specific message and fallback; denial, fake camera, real person, missing and uncertain landmarks are tested; disconnection is covered by the state-machine test and the `ended` track handler (not simulated in a browser test) |
| Invalid or incomplete movements are not counted | Yes (unit tests and evaluation section 3) |
| No form feedback without reliable tracking | Yes (unit tests on the coaching rules and traffic light) |
| No diagnosis, prescription, healing claims or fabricated validation | Reviewed all copy; safety rules are deterministic and tested |
| Responsive and keyboard accessible | Tested at three viewport sizes and with the keyboard; focus rings visible |
| No placeholder buttons, fake integrations, hard-coded credentials or unnecessary dependencies | None found. No API keys exist; every dependency has a stated purpose (`docs/ARCHITECTURE.md`) |
| Camera footage never stored or uploaded | Frames are only drawn to the screen and passed to the in-browser model; there is no upload code and no recording code |
| Installable and runnable from the README | `npm install && npm run dev` was used throughout; the GitHub Pages build is produced by the workflow |

## Not tested

- **Safari, Firefox and Edge**, and **real iPhones, iPads and Android phones**. Only Chromium was automated, at phone and tablet sizes.
- **A physical webcam with a live person.** Camera behaviour was tested with Chromium's fake camera and a recorded real person; the developer's own webcam was not used in automated runs.
- **Frame rate on real laptops.** Headless Chromium has no GPU and ran the model at about 3 frames per second; the app's reduced-rate mode handled it.
- **Voice commands and browser notifications** (both depend on permissions and browser services).
- **Offline use after installing** the PWA (the service worker is built and configured, but going offline was not automated).
- **Screen readers** (labels and landmarks were checked in code and via the accessibility tree, not with VoiceOver or NVDA).
- **Clinical accuracy** of any measurement.

## Highest-priority remaining work

1. Test on Safari (macOS and iOS), Firefox and a real Android phone; fix any browser-specific camera or speech issues.
2. A small consented repeatability study with a clinician's goniometer to estimate real measurement error and set a minimal detectable change.
3. Have a physical therapist review the four exercise definitions, instructions and safety wording.
4. Screen-reader testing (VoiceOver and NVDA).
5. More exercises, each with its own tested definition.
