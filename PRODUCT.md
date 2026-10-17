# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated (Sanjay asked for something that runs on both Mac and Windows; the build prompt recommended this stack): React + TypeScript (strict) + Vite, Tailwind CSS v4, installable PWA, MediaPipe Pose Landmarker running in the browser, IndexedDB for local storage. Deployed as a static site on GitHub Pages (HTTPS, so the camera works).

## Users

People following a rehabilitation plan that a qualified clinician gave them or approved, doing exercises at home in front of a laptop webcam or a phone/tablet camera, usually alone and standing or sitting 1.5–3 m from the screen. They may be recovering from a musculoskeletal injury or surgery, may forget exercises, may find written instructions hard to follow, and may want to show their physical therapist something more concrete than "I did them, I think."

Secondary audience: the physical therapist who receives a short report instead of hours of video.

Evaluation audience for this build: Congressional App Challenge (KY-3) judges who open the live link or watch a demo video.

## Product Purpose

PocketRehab helps people follow prescribed rehabilitation at home by turning compatible camera recordings into measurable movement feedback, personalized coaching, and progress reports they can share with their physical therapist. Success: the user does the plan their clinician set, understands what was measured and how trustworthy it was, and arrives at their next appointment with an honest report.

## Positioning

Confidence-aware measurement. PocketRehab estimates joint angles on-device, attaches a tracking-quality state (reliable / uncertain / unavailable) to every measurement, and refuses to present unreliable numbers as form feedback or progress. It reports observed differences without calling them improvement unless measurement error has been established. A rep counter or fitness app cannot truthfully claim this.

## Operating Context

- Live sessions happen at home, often in a living room or bedroom, with the screen viewed from a distance; captions, large readouts and voice prompts matter more than dense controls during a session.
- Planning, progress review and report export happen up close at a desk or on a phone.
- Camera footage is processed locally and never uploaded or stored.
- The plan comes from a clinician; PocketRehab never generates, changes or progresses treatment.

## Capabilities and Constraints

- Four demonstration exercises with tested movement definitions: arm raise to the side (front view), bicep curl (side view), seated knee extension (side view), sit to stand (side view).
- AR overlay on the live camera: skeleton, live joint-angle arc, target zone anchored to the joint, ghost guide limb, floating rep counter and quality badge.
- Deterministic coaching rules (no language model); voice via browser speech synthesis when available; captions always available.
- Symptom check-ins with deterministic escalation; no numeric clinical cutoffs are invented.
- Local-only data, exportable and deletable; no accounts, no backend, no analytics.
- Must not diagnose, prescribe, claim healing, claim clinical validation, or claim HIPAA or other compliance.
- Every number shown is either measured, entered by the user, or labeled as a demonstration example.

## Brand Commitments

- Name: PocketRehab (renamed from the working name "RecoverAI" by Sanjay on 2026-10-17).
- Slogan: "Rehab done right." (set by Sanjay on 2026-10-17; use verbatim).
- Credit: built by Sanjay Koripelli.
- Voice: calm, plain-language, non-judgmental, never shaming, never hyping progress.

## Evidence on Hand

- Sanjay has a personal/family connection to home physical therapy (confirmed 2026-10-17; details not provided — do not invent specifics).
- No clinician partnership, user study, testimonials, accuracy benchmarks or clinical validation exist. Never fabricate them.
- Quantitative results exist only for synthetic test data (docs/EVALUATION.md once generated).

## Product Principles

1. Safety before engagement: when in doubt, pause and point to the care team.
2. Evidence before claims: show uncertainty instead of false precision.
3. The clinician's plan is the authority; PocketRehab only helps follow it.
4. Privacy by default: nothing leaves the device unless the user exports it.
5. Usable without a camera, without voice, and without standing.

## Accessibility & Inclusion

Target WCAG 2.1 AA: keyboard navigation, visible focus, screen-reader labels, non-color status cues, adjustable text size, reduced motion, captions and text alternatives for spoken coaching, large touch targets, and full use without camera access.
