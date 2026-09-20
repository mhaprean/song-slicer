# Song Slicer 🎵

A browser-based audio cutter and loop tool built with React, Vite, and Tailwind CSS. Load any audio file, visually select loop regions on a zoomable waveform, and export your cuts as WAV or MP3 — all processing happens locally in your browser, so your audio never leaves your machine.

## Features

- **Load audio via drag & drop or file browser** — supports MP3, WAV, OGG, FLAC, M4A, AAC, and WebM
- **Waveform visualization** — rendered with [WaveSurfer.js](https://wavesurfer.js.org/)
- **Loop selection** — draggable start/end pins stay anchored to their exact audio seconds at any zoom level
- **Playback with looping** — plays the selected range on repeat; toggle looping on/off
- **Zoom & pan** — scroll to zoom (cursor-anchored), Shift+wheel or trackpad swipe to pan, or use the zoom slider
- **Saved loops list** — store multiple loops, preview each one, and remove individually or clear all
- **Export** — batch-export all saved loops into a single file, or export just the current loop as:
  - **WAV** (16-bit PCM, hand-encoded)
  - **MP3** (192 kbps, encoded in-browser with [lamejs](https://github.com/zhuker/lamejs))
- **Fully client-side** — no uploads, no server, complete privacy

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

1. **Load a file** — drag an audio file onto the landing page or click *Browse Files*.
2. **Place the playhead** — click anywhere on the waveform.
3. **Set loop points** — press `[` to set the loop start and `]` to set the loop end at the playhead, drag the yellow/orange pins directly on the waveform, or type exact times into the Start/End fields.
4. **Fine-tune** — scroll to zoom in for sample-accurate precision; the pins stay locked to their exact seconds while zooming. Double-click the waveform to reset the loop to the full track.
5. **Audition** — press `Space` to play. With looping enabled, playback wraps around the selection automatically. Use *Loop On/Off* to toggle.
6. **Save loops** — click *Add to List* to save the current selection. Saved loops appear in the list below, where you can preview, delete, or clear them.
7. **Export** — choose WAV or MP3, then either *Export Loop* (current selection) or *Export N Loops* (all saved loops concatenated into one file).

### Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `[` | Set loop start at playhead |
| `]` | Set loop end at playhead |

## Tech Stack

- [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite 6](https://vite.dev/) — dev server & bundler
- [Tailwind CSS 4](https://tailwindcss.com/) — styling
- [WaveSurfer.js 7](https://wavesurfer.js.org/) — waveform rendering & playback
- [lamejs](https://github.com/zhuker/lamejs) — MP3 encoding
- Web Audio API — audio decoding, region extraction, and WAV encoding

## Project Structure

```
├── index.html              # App entry point
├── vite.config.js          # Vite config (React + Tailwind plugins)
├── src/
│   ├── main.tsx            # React bootstrap
│   ├── App.tsx             # Main app: waveform UI, loop editing, export flow
│   ├── index.css           # Global styles (Tailwind)
│   ├── types/
│   │   └── lamejs.d.ts     # Type declarations for lamejs
│   └── utils/
│       └── audioExport.ts  # WAV/MP3 encoders, region extraction, time formatting
```
