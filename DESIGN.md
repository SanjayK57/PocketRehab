# PocketRehab design system: "Applied Tape"

Chosen through the Impeccable design process (concept roll, six outside challengers, user choice on 2026-10-17). The world is **kinesiology tape laid on a physio's printed backing paper**. It lends PocketRehab four things only: type, palette, density and one signature move. Navigation, controls and layout stay ordinary web-app patterns.

## Signature move

**Measurements are laid down as rounded-end strips of tape on a numbered backing grid.**

- A reliable measurement is a solid cyan strip from the start angle to the peak angle.
- An unreliable one is an "unstuck" strip: amber hatching, never cyan, labelled "Tracking uncertain — not used for trends".
- The same rounded strip is the AR target zone on the live camera, the ghost guide limb, the chart mark, the repetition strip and the legend swatch.
- The numbered grid appears only behind measurements (it is a measuring surface, never decoration).
- Done days get one hand-drawn cyan ring; missed days a short pink strip.

## Palette (`src/index.css`)

| Token | Value | Job |
|---|---|---|
| `ground` | `#f7f5f0` | Backing paper: page background |
| `surface` | `#fffdf8` | Form fields, dialogs |
| `surface-2` | `#e9e3d6` | Tape beige: the one raised surface (next-session panel, today cell, selected rows) |
| `ink` / `ink-2` / `ink-3` | `#1d1f22` / `#4a4e55` / `#62666d` | Text levels (all ≥ 4.5:1 on ground) |
| `rail` | `#1d1f22` | Black tape: navigation rail and phone tab bar |
| `tape` | `#0a8fb8` | Cyan tape: reliable data marks |
| `accent` / `accent-strong` | `#0a7ea4` / `#086f90` | Actions and links (white text on accent passes AA) |
| `signal` / `signal-ink` | `#d83a7c` / `#a8285d` | Pink tape: a configured criterion was not met, missed days. Never "danger". |
| `warn-mark` / `warn` | `#b7791f` / `#7a5210` | Amber hatch for uncertain tracking / amber text |
| `ok` | `#2c7048` | "Criteria met", "tracking reliable" text |
| `alert` | `#b3261e` | Errors, urgent safety stop, destructive actions only |
| `stage` | `#121416` | Camera stage behind live video |

High-contrast mode darkens secondary text, rules and accents. Colour never carries meaning alone: every state also has a label, an icon or a pattern.

## Type

One family for everything: **Atkinson Hyperlegible Next** (Braille Institute, designed for low-vision readers), with **Atkinson Hyperlegible Mono** only for measurements and counts. Fixed rem scale with about 1.2 between steps; body 16 px minimum; text-size setting scales the whole interface (100–150%).

## Density and structure

- Modules are separated by a 1 px ink rule on top (`Section`), not by cards with shadows. Elevation is declared once: the beige surface. No nested cards.
- Radii: 12 px for panels, 10 px for controls, full round only for small tags.
- Live session screen: large readouts (rep count and angle at 48 px) and 24 px captions, readable from 2 m.

## Motion

State changes only, 150–250 ms ease-out. No page-load choreography. The demonstration figure and AR ghost are the only continuous animation, and the demonstration starts paused when reduced motion is on.

## Browser surfaces

Selection, caret, focus ring (3 px accent), scrollbars, underline offset and tabular numerals are themed from the palette.
