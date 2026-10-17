# PocketRehab architecture

PocketRehab is a static, installable web app (PWA). There is no server: the pose model, the movement analysis, storage and report generation all run in the browser on the user's device.

```
 Camera frames ──▶ Pose estimation ──▶ Landmarks + visibility ──▶ Quality checks ──▶ Joint angle
 (getUserMedia)    (MediaPipe, WASM)    (33 points, normalized)   (per frame)        (degrees or null)
                                                                        │
         Feedback ◀── Coaching rules ◀── Repetitions ◀── Segmenter ◀── Glitch filter + smoothing
         (captions,     (deterministic,    (with validity,  (finite-state
          voice, AR)     quality-gated)     timing, flags)    machine)
                                                │
                     IndexedDB ◀── Session record + Movement Fingerprint ──▶ Progress, comparison, reports
```

## Stack and why

| Concern | Choice | Reason |
|---|---|---|
| UI | React 19 + TypeScript (strict) + Vite 8 | One codebase for Mac, Windows, Linux, iOS and Android browsers. |
| Styling | Tailwind CSS v4 with design tokens in `src/index.css` | Every colour is a named token, so the visual system lives in one place. |
| Pose model | `@mediapipe/tasks-vision` Pose Landmarker (lite or full) | Maintained, Apache-2.0, runs locally in WebAssembly with a GPU (WebGL) or CPU delegate. Model files and runtime are served from the app's own origin. |
| Storage | IndexedDB via `idb`, validated with `zod` | Structured local storage that survives reloads; every read and write is validated. |
| Reports | `jsPDF` + `jspdf-autotable`, loaded on demand | PDF generated on the device; a print view is the fallback. |
| Offline | `vite-plugin-pwa` (Workbox) | App shell precached; the pose model is cached the first time it is used. |
| Routing | `react-router` with hash URLs | Works on static hosting (GitHub Pages) without server rewrites. |

No dependency is a paid service, and no API keys exist anywhere.

## Folder layout

```
src/
  app/                 shell, routing, global data provider, error boundary, preferences
  components/          UI building blocks (ui.tsx), charts, tape signature marks, dialogs, toasts
  features/
    onboarding/        10-step onboarding with save-and-resume; demo profile generator
    dashboard/         Home
    exercises/         exercise library, plan pages, plan editor and history, demo animation
    camera/            camera access and error mapping
    pose-estimation/   PoseProvider interface, MediaPipe provider, simulated provider, synthetic skeletons
    movement-analysis/ geometry, quality checks, filters, repetition segmenter, metrics, engine
    live-coaching/     session state machine, live stage, AR renderer, coaching rules, voice
    session-history/   history list, session detail timeline
    analytics/         progress analysis, comparison, weekly summary, milestones
    scheduling/        schedule builder, adherence, .ics export, reminders
    check-ins/         check-in form, safety stop, between-session check-in
    reports/           report data, preview, PDF
    settings/          preferences, privacy and data controls, capabilities, about
    equipment/         equipment checklist
  lib/
    storage/           IndexedDB schema + migrations, repositories, live query hook
    validation/        zod schemas (the single source of the data model's types)
    safety/            check-in questionnaires and deterministic safety rules
    capabilities/      browser feature detection
    export/            download helpers
    time/              local-date helpers
  types/               pose and exercise types
tests/
  unit/, src/**/*.test.ts   Vitest unit and integration tests
  e2e/                      Playwright browser tests
  eval/                     evaluation harness that writes docs/EVALUATION.md
```

## Pose estimation

`PoseProvider` (`src/features/pose-estimation/provider.ts`) is the only interface the rest of the app sees:

```ts
interface PoseProvider {
  info: { name; model; version; kind: 'camera-model' | 'simulated'; delegate? };
  init(): Promise<void>;
  estimate(input: HTMLVideoElement | null, timestampMs: number): PoseFrame; // never throws
  close(): void;
}
```

A `PoseFrame` carries the timestamp, 33 landmarks (normalized x/y, relative z, visibility) or `null` when no person is found, the image size, provider metadata and an inference status (`ok`, `no-pose`, `error`). Landmarks are never invented when the model fails.

- `MediaPipePoseProvider` loads the WASM runtime from `/mediapipe/wasm` (copied from `node_modules` at install time) and the model from `/models/`. It tries the GPU delegate first and falls back to the CPU.
- `SimulatedPoseProvider` produces a clearly labelled synthetic person for the "Simulated demo" mode. Its sessions are saved with `mode: "simulated"`, labelled everywhere, and never count as the user's progress (except inside the demo profile, which is itself labelled).

`usePoseStage` runs the capture loop outside React state: at most one inference per animation frame, no frame queue, a 30 fps cap that drops to 15 fps if median inference time exceeds 45 ms. Measured frame rate and inference time are shown in the setup panel and saved with the session. The camera stream is stopped when the session ends, the component unmounts, or the camera disconnects.

## Movement analysis (`src/features/movement-analysis`)

All of this is plain TypeScript with no DOM or React, so it runs the same on live frames, simulated frames and test fixtures.

### Joint angle

For points A, B, C the angle at B is

```
cos θ = (BA · BC) / (|BA| |BC|),   θ = acos(clamp(cos θ, −1, 1))
```

computed in 3D when every point has a finite z, otherwise in 2D. Landmarks are first converted to **pixel space** (x × width, y × height); computing on normalized coordinates would distort angles on non-square frames. Missing, non-finite or zero-length inputs return an explicit failure, never 0°.

Each exercise defines its landmarks per side and a transform: `interior` (arm raise, knee angle) or `supplement` (elbow flexion = 180° − interior angle, so more bend reads as a larger number).

A 2D projected angle can differ from the true anatomical angle because of perspective, body rotation and depth. This is stated in the app wherever angles appear.

### Frame quality

`evaluateFrame` classifies every frame:

| State | Conditions |
|---|---|
| unavailable | inference error; no person; a required landmark missing, outside the frame, or with visibility < 0.3 |
| uncertain | a required landmark with visibility 0.3–0.65; landmark within 2% of the frame edge; body view contradicts the exercise (front vs side, from shoulder-width ÷ torso-length); an implausibly fast angle jump |
| reliable | none of the above |

MediaPipe's visibility values are treated as tracking-quality signals, not calibrated probabilities. A rolling one-second window gives the live indicator (reliable ≥ 80% reliable frames; uncertain ≥ 50% usable).

### Filtering

- **Glitch rejection:** an angle change faster than 720°/s between frames less than 250 ms apart is flagged `implausible-jump` and excluded from segmentation.
- **Smoothing:** exponential smoothing with a time constant (α = 1 − e^(−Δt/70 ms)), so behaviour is the same at 15 or 60 fps. The filter resets after a 400 ms gap.

### Repetition segmentation

A finite-state machine (`segmenter.ts`):

```
waiting ──(value ≤ neutralMax)──▶ ready
ready ──(value > neutralMax + hysteresis)──▶ outbound
outbound ──(value < peak − returnHysteresis)──▶ returning
returning ──(value > peak)──▶ outbound
returning ──(value ≤ neutralMax)──▶ ready   → evaluate repetition
```

A repetition is **counted** only if its peak reached `countMin` and its duration is within [`minRepMs`, `maxRepMs`]. Otherwise it is logged as an incomplete attempt with a reason (`below-count-threshold`, `too-fast`, `too-slow`). A gap in usable samples longer than `maxGapMs` during a repetition aborts it (`tracking-lost`) and the machine waits for the start position again. Duplicate or out-of-order timestamps are ignored. All parameters live in the exercise definition and are labelled as software parameters, not clinical thresholds.

### Per-repetition measurements

- Start, peak and range (smoothed values).
- Timing: outbound (start → first sample within `holdTolerance` of the peak), hold (time within tolerance of the peak), return (last such sample → end), plus rest between repetitions.
- Validity: `reliable` when ≥ 80% of the repetition's frames were reliable; otherwise `uncertain`, which keeps the count but excludes the repetition from all measurements.
- Target met: whether the peak fell inside the configured target range (clinician-entered or a labelled demo example).
- **Smoothness:** the smoothed angle is resampled to 30 Hz, differentiated, lightly averaged, and distinct speed peaks are counted (a peak must exceed 20% of the repetition's top speed and be separated from the previous one by a dip below 60% of the smaller peak). One smooth out-and-back movement shows about 2 peaks; hesitations add more. Unavailable for sparse data or gaps over 200 ms. This is an explainable software metric, not a validated recovery measure.
- **Compensation:** exercise-specific rules only (arm raise: lateral trunk lean; knee straightening: leaning back). The trunk angle (hip midpoint → shoulder midpoint from vertical) is compared with its value at the start of the repetition, so a tilted camera does not trigger it; the change must exceed the rule's threshold for 4 consecutive reliable frames. Thresholds are configurable demonstration parameters and are labelled unvalidated.

### Movement Fingerprint

Each session stores a compact fingerprint built only from reliable repetitions: medians of peak, start, range, duration, phase times, hold, rest and speed peaks; coefficient of variation of peak and duration (needs ≥ 3 reliable reps); compensation counts; reps reaching target; and plain-language notes on exclusions. A fingerprint is `valid` (usable for trends) only with ≥ 2 reliable repetitions.

## Progress analysis (`src/features/analytics/analysis.ts`)

- Trends use only sessions with a valid fingerprint, from camera mode (simulated sessions only inside the labelled demo profile).
- Smoothed values are a 3-session rolling median and are always labelled as smoothed.
- `interpretChange`: fewer than 3 comparable sessions → "Not enough reliable, comparable measurements to determine whether a meaningful change occurred." Otherwise the observed change is reported, and because `MEASUREMENT_ERROR_MODEL` is `null` (no repeatability study has been done), the message says it may reflect camera or tracking variation. The code path for a real minimal detectable change exists and is unit-tested, but is not used.
- Stability rule (shown with its definition): the last 4 comparable sessions all within ±5° of their median.
- Session comparison checks exercise, side, definition version, mode, validity, camera view, aspect ratio, subject scale (torso length ÷ frame height, warning above 25% difference) and model, and lists every exclusion.

## Coaching and safety

- `coach.ts` maps events to fixed messages in three styles (calm, encouraging, minimal). No language model is involved. Form feedback (target or compensation messages, red light) is only produced for repetitions with reliable tracking; otherwise a camera/visibility message is given. A throttle stops the coach talking over every movement.
- Traffic light: green = configured criteria met with reliable tracking; amber = tracking not reliable; red = a configured criterion not met (described as a camera estimate, never as "dangerous" or "injured"). Each state has an icon-like tape swatch and a text label.
- `lib/safety/checkins.ts`: any checked warning sign → urgent (stop, call 911 or local emergency number, contact care team; no way to continue); new or worse symptoms → caution (pause; continue only with an explicit "my clinician said I can" acknowledgement before a session). No numeric pain cutoff is used.
- `sessionMachine.ts` is a pure reducer for the session workflow (intro → check-in → safety → setup → countdown → active ⇄ paused/rest → camera-lost → post check-in → summary). It never repeats a session or carries missed repetitions forward.

## Data model and storage

Types are inferred from zod schemas in `src/lib/validation/schemas.ts`: Profile, Preferences, ScheduleSettings, Plan (versioned), PrescribedExercise, TargetRange (with `source: clinician | demo-example`), Session, Repetition, IncompleteAttempt, QualitySummary, MovementFingerprint, CameraConditions, SessionEvent, CheckIn, ScheduleOverride, FrictionReport, and export bundle shapes.

IndexedDB database `pocketrehab` (version 1) has stores: `meta`, `profile`, `planVersions` (append-only history), `sessions`, `checkIns`, `scheduleOverrides`, `friction`. Migrations are numbered functions run in order inside the upgrade transaction. Invalid records are skipped and counted rather than crashing the app; writes are validated first; quota errors become a readable message. Sessions left "in progress" (tab closed mid-session) are marked interrupted on the next start, with their data intact.

Distinct sources are kept distinct: user-entered information, clinician-provided instructions (as entered by the user, with who approved them), camera-derived measurements (with quality metadata), and software-generated summaries.

## Privacy

Camera frames are processed in memory and discarded. No video or images are stored or uploaded. The only network requests are for the app's own files and the pose model from the same origin. If the user turns on voice commands, some browsers send audio to their own speech service; the setting says so and is off by default. There are no accounts, analytics or ads.

## Performance notes

- High-frequency data never goes through React state; the canvas is drawn directly each frame and the visible readouts update about 8 times a second.
- The live session and report screens are code-split; the PDF library and the MediaPipe bundle load only when needed.
- Measured in headless Chromium on the development Mac (see `docs/TESTING.md`): the camera pipeline processed frames at the rate shown in the test log. No other performance claim is made.

## Known limitations

- Angles are 2D estimates from one camera and are not clinically validated.
- Only four movements have tested definitions; other exercises can only be logged manually.
- Reminders only work while the app is open; the .ics export covers closed-app reminders.
- Data lives in one browser on one device; there is no sync.
- Safari and real iOS/Android devices were not tested in this build (see `docs/TESTING.md`).
