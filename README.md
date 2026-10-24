# PocketRehab — Rehab done right.

A free app that helps you do your physical therapy exercises at home, correctly. It uses your phone or laptop camera to count repetitions, measure joint angles and check your form as you move, then turns each session into progress you and your therapist can read.

**Open the app: [PocketRehab]([url](https://sanjayk57.github.io/PocketRehab/))**

Built by Sanjay Koripelli for the 2026 Congressional App Challenge (KY-3).

> PocketRehab supports a plan from, or approved by, a qualified healthcare professional. It does not diagnose or treat any condition, and its camera measurements can be inaccurate. Stop and contact your clinician if something hurts or feels wrong.

## Install it (free, no app store)

PocketRehab installs straight from the website. Once installed it has its own icon, opens full screen and works offline. You can also tap **Install app** inside PocketRehab.

| Device | How |
|---|---|
| iPhone / iPad | Open the link in **Safari** → tap **Share** → **Add to Home Screen** |
| Android | Open the link in **Chrome** → **⋮** menu → **Install app** |
| Windows / Chromebook | Open the link in **Chrome** or **Edge** → click the install icon at the right of the address bar |
| Mac | **Chrome/Edge:** install icon in the address bar. **Safari:** **File → Add to Dock** |

## Get started in two minutes

1. **Make an account.** Tap **Continue with Google** to keep a backup in your own Google Drive and use it on any device, or create a private account (name, email, password) that stays encrypted in this browser. Just looking? Tap **Explore the demo**.
2. **Add your plan.** Enter the exercises, sets, reps, holds and target angles your therapist gave you, or start from the exercise library.
3. **Start a session.** Set your phone or laptop 2–3 m (7–10 ft) away, follow the on-screen camera checklist, and move. The coach counts out loud, tells you when to hold or slow down, and points out form problems like a bent elbow or a leaning body.
4. **See your progress.** After every repetition it shows which form checks passed and what to work on. The Progress tab shows your range of motion over time, and **Report** makes a PDF for your next appointment.

No camera? Every exercise has a simulated demo and a manual log.

## What it does

- **Form checks on every repetition:** elbow straight, arm to the side, shoulder relaxed, no leaning or swinging, hold time, controlled lowering and pace, each with a short spoken cue.
- **Accurate angles:** blends the camera image with the pose model's 3D estimate, so measurements hold up when you're turned away from the camera.
- **Honest tracking:** every measurement is marked reliable or uncertain. Uncertain data never counts as progress and never triggers form feedback.
- **3D demonstrations** of each exercise, and an augmented-reality overlay that shows your joint angle, target range and the next move on top of the live video.
- **Exercise library** of 10 camera-measured movements for shoulders, elbows, hips, knees and legs.
- **Safety check-ins** before and after each session. Warning signs stop the session and point you to help.
- **Schedule and reminders**, with a calendar file you can import.

## Privacy

- Camera video is processed on your device and is never recorded or uploaded.
- Your data is encrypted in your browser. With Google sign-in, a backup is saved in a hidden app folder in **your own** Google Drive that other apps and people can't see. Backups made from a password account are also encrypted with that password.
- No ads, no analytics, no tracking. Full policy: [privacy.html](https://sanjayk57.github.io/PocketRehab/privacy.html).

## Run it on your computer

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/SanjayK57/PocketRehab.git
cd PocketRehab
npm install
npm run dev
```

Open http://localhost:5173. Useful commands: `npm test` (unit tests), `npm run test:e2e` (browser tests), `npm run evaluate` (measurement accuracy report in [docs/EVALUATION.md](docs/EVALUATION.md)), `npm run deploy` (publish to GitHub Pages).

More detail: [architecture](docs/ARCHITECTURE.md) · [features](docs/FEATURES.md) · [testing](docs/TESTING.md) · [design](docs/DESIGN.md) · [Google sign-in setup](docs/GOOGLE_SIGN_IN.md)

## Credits

- Code: MIT License © 2026 Sanjay Koripelli
- Pose tracking: [MediaPipe](https://ai.google.dev/edge/mediapipe) Pose Landmarker by Google (Apache 2.0)
- 3D rendering: [three.js](https://threejs.org) (MIT)
- Coach voice: recorded with [ElevenLabs](https://elevenlabs.io)
- Typefaces: Atkinson Hyperlegible Next and Mono by the Braille Institute (SIL Open Font License)
- Test footage (not in the repository): "Jumping jacks and burpees" by Taco fleur, CC BY-SA 4.0, via Wikimedia Commons
