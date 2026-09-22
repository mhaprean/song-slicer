import type { LoadErrorKind, LoadStage, Prefs } from './types/models';

/** Palette cycled through when saving loops (indigo, emerald, amber, rose, violet, cyan). */
export const REGION_COLORS = [
  'rgba(99, 102, 241, 0.4)',
  'rgba(16, 185, 129, 0.4)',
  'rgba(245, 158, 11, 0.4)',
  'rgba(239, 68, 68, 0.4)',
  'rgba(168, 85, 247, 0.4)',
  'rgba(6, 182, 212, 0.4)',
];

/** Same color at full opacity — used for badges and borders. */
export function solidColor(color: string): string {
  return color.replace(/[\d.]+\)$/, '1)');
}

/** Same color at a custom alpha — used for region overlay tints. */
export function alphaColor(color: string, alpha: string): string {
  return color.replace(/[\d.]+\)$/, `${alpha})`);
}

export const MIN_LOOP = 0.01; // minimum loop length in seconds
export const MAX_ZOOM = 2000; // max pixels per second
export const NUDGE = 0.01; // keyboard nudge step (10 ms)
export const FADE = 0.003; // de-click fade length in seconds

export const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

export const PREFS_KEY = 'song-slicer:prefs:v1';
export const regionsKey = (fileName: string, size: number) =>
  `song-slicer:regions:v1:${fileName}:${size}`;

export const DEFAULT_PREFS: Prefs = {
  exportFormat: 'wav',
  exportMode: 'merged',
  gapMs: 500,
  snap: true,
  volume: 1,
  fadeInMs: 0,
  fadeOutMs: 0,
  normalize: false,
  grid: false,
  bpm: 120,
  gridSnap: false,
};

export const LOAD_STAGE_LABEL: Record<LoadStage, string> = {
  reading: 'Reading file…',
  decoding: 'Decoding audio…',
  rendering: 'Rendering waveform…',
};

/** Friendly copy for every failure mode — never a bare "Error". */
export const LOAD_ERROR_INFO: Record<
  LoadErrorKind,
  { title: string; message: string }
> = {
  unsupported: {
    title: 'Unsupported file',
    message:
      "This file doesn't look like audio your browser can decode. Try MP3, WAV, OGG, FLAC, M4A, AAC or WebM.",
  },
  read: {
    title: "Couldn't read the file",
    message:
      'The file may have moved, or your browser blocked access to it. Try selecting it again.',
  },
  corrupt: {
    title: "This audio file couldn't be decoded",
    message:
      'The file may be damaged, or your browser does not support its codec. Re-saving it as WAV or MP3 usually fixes this.',
  },
  timeout: {
    title: 'Loading took too long',
    message:
      'The file may be too large for this device to process. Try a smaller file, or a desktop browser with more memory.',
  },
};

export const AUDIO_EXT_RE = /\.(mp3|wav|ogg|flac|m4a|aac|webm)$/i;
