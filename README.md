# Song Slicer 🎵 — Audio Cutter

A browser-based audio cutter and loop tool built with React, Vite, and Tailwind CSS. Load any
audio file, select loop regions on a zoomable waveform, and export your cuts as WAV or MP3 —
all processing happens locally in your browser, so your audio never leaves your machine.

## Features

- **Load audio via drag & drop or file browser** — supports MP3, WAV, OGG, FLAC, M4A, AAC, WebM
  (replace or clear the current file at any time; dropping anywhere on the page swaps files)
- **Waveform centerpiece** rendered with [WaveSurfer.js](https://wavesurfer.js.org/):
  time ruler, dimmed unselected audio, highlighted selection, visible playhead,
  floating time labels on the handles, beat grid with BPM markers (optional)
- **Loop selection** — draggable start/end pins stay anchored to their exact audio seconds at
  any zoom level; click anywhere to move the playhead; precise numeric start/end/duration fields
- **Playback with looping** — play/pause, loop the selection, seekable progress bar, volume,
  cursor-anchored mouse-wheel zoom, zoom buttons, fit-to-screen
- **Saved loops list** — number, custom name, start/end/duration, color badge, Active marker,
  plus play, edit/jump, rename, duplicate, reorder and delete (delete & clear are undoable)
- **Export** — current loop or all saved loops, as one merged file or a per-loop ZIP, with a
  configurable gap between merged loops, optional fade-in/fade-out and peak normalization:
  - **WAV** (16-bit PCM, hand-encoded)
  - **MP3** (192 kbps, encoded in-browser with [lamejs](https://github.com/zhuker/lamejs))
- **Quality of life** — undo/redo for loop edits, zero-crossing snap (click-free cuts),
  snap-to-grid, A/B selection slots, toasts with undo actions, full keyboard control
- **Fully client-side** — no uploads, no server, complete privacy

### Not included (and why)

- **FLAC/OGG export** — reliable browser encoders for these formats only exist as large
  WASM/native dependencies or partial WebCodecs implementations. WAV is lossless and MP3 covers
  compatibility, so those two stay the supported formats.
- **Automatic BPM/transient detection** — naive browser detection is unreliable on real music.
  Instead the app provides a manual BPM beat grid (visual markers + optional snap-to-grid).

## Getting Started

### Prerequisites

- Node.js 18+

### Install & Run

```bash
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

### Production Build

```bash
npm run build    # outputs to dist/
npm run typecheck
```

## How to Use

1. **Load a file** — drag an audio file anywhere on the page or click *Browse files*.
2. **Place the playhead** — click anywhere on the waveform.
3. **Set loop points** — press `[` / `]` to set the loop start/end at the playhead, drag the
   handles, or type exact seconds into the Start/End fields (arrow keys nudge by 1 ms).
4. **Fine-tune** — scroll to zoom (pins stay locked to their seconds), optionally enable the
   beat grid and snap-to-grid. Double-click resets zoom (or the loop when already fitted).
5. **Audition** — press `Space` to play. With *Loop* on, playback wraps around the selection.
6. **Save loops** — *Add to list* stores the selection (persisted per file) and focuses the
   name field so you can label it. Manage everything from the Saved Loops panel.
7. **Export** — pick WAV/MP3, then *Export loop* (current selection) or *Export N loops*
   (merged file or ZIP), with optional fades/normalize under *Processing options*.

### Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `[` / `]` | Set loop start / end at playhead |
| `←` / `→` | Move playhead by 10 ms (or nudge the focused handle) |
| `Shift` + `←` / `→` | Extend loop edges outward |
| `Alt` + `←` / `→` | Shrink loop edges inward |
| `L` | Loop playback on/off |
| `G` | Toggle beat grid |
| `F` | Fit waveform to screen |
| `M` | Add selection to the list |
| `1` / `2` | Switch to A/B selection slot |
| `Ctrl/Cmd+Z` | Undo loop change |
| `Ctrl/Cmd+Shift+Z` | Redo loop change |
| `?` | Open the shortcuts dialog |

Mouse: click = seek · wheel = zoom · Shift+wheel = pan · double-click = fit/reset ·
Alt+click an A/B slot = store current selection.

## Tech Stack

- [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite 6](https://vite.dev/) — dev server & bundler
- [Tailwind CSS 4](https://tailwindcss.com/) — styling + design-system component classes
- [WaveSurfer.js 7](https://wavesurfer.js.org/) — waveform rendering, playback & time ruler
- [lucide-react](https://lucide.dev/) — iconography
- [lamejs](https://github.com/zhuker/lamejs) — MP3 encoding
- Web Audio API — audio decoding, region extraction, fades, normalization, WAV encoding

## Project Structure

```
├── index.html              # App entry point (flash-free dark shell)
├── vite.config.js          # Vite config (React + Tailwind plugins)
├── src/
│   ├── main.tsx            # React bootstrap
│   ├── App.tsx             # Orchestrator: state, WaveSurfer lifecycle, keyboard, export flow
│   ├── index.css           # Design system: panels, buttons, chips, inputs, motion
│   ├── constants.ts        # Colors, limits, default prefs, friendly error copy
│   ├── types/
│   │   ├── models.ts       # Shared types (loops, prefs, toasts, export state)
│   │   └── lamejs.d.ts     # Type declarations for lamejs
│   ├── components/
│   │   ├── Header.tsx          # Brand bar + shortcuts button
│   │   ├── FileDropZone.tsx    # Empty state / drag target + workflow strip
│   │   ├── FileInfo.tsx        # Step 01: filename, metadata chips, Loaded status
│   │   ├── LoopPin.tsx         # Draggable handles (portal into WaveSurfer shadow DOM)
│   │   ├── LoopPanel.tsx       # Step 03: selection readouts, markers, snap, A/B, save
│   │   ├── PlaybackBar.tsx     # Step 04: transport, progress, volume, zoom (sticky on mobile)
│   │   ├── SavedLoops.tsx      # Step 05: saved loop list with full row actions
│   │   ├── ExportPanel.tsx     # Step 06: format, mode, gap, processing, progress
│   │   ├── ShortcutsModal.tsx  # Keyboard reference dialog (?)
│   │   ├── Switch.tsx          # Accessible toggle used across panels
│   │   ├── TimeField.tsx       # Precise numeric seconds editor
│   │   └── Toasts.tsx          # Stacked notifications with undo actions
│   └── utils/
│       ├── audioExport.ts  # WAV/MP3 encoders, region extraction, fades, normalize, time utils
│       └── zip.ts          # Minimal dependency-free ZIP writer
```

