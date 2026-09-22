/** Shared app-wide types (kept separate from components to avoid cycles). */

export interface RegionInfo {
  id: string;
  start: number;
  end: number;
  color: string;
  name?: string;
}

export interface LoopRange {
  start: number;
  end: number;
}

export type ExportMode = 'merged' | 'separate';
export type ExportFormat = 'wav' | 'mp3';

/** Which phase of loading the UI is showing (empty = null at call sites). */
export type LoadStage = 'reading' | 'decoding' | 'rendering';

export type LoadErrorKind = 'unsupported' | 'read' | 'corrupt' | 'timeout';

export interface LoadError {
  kind: LoadErrorKind;
  detail?: string;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
  action?: ToastAction;
}

export type ExportState =
  | { status: 'idle' }
  | { status: 'running'; stage: string; progress: number }
  | { status: 'done'; message: string }
  | { status: 'error'; message: string };

export type SlotKey = 'a' | 'b';

export interface ABSelection {
  a: LoopRange | null;
  b: LoopRange | null;
}

export interface Prefs {
  exportFormat: ExportFormat;
  exportMode: ExportMode;
  gapMs: number;
  snap: boolean;
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
  normalize: boolean;
  grid: boolean;
  bpm: number;
  gridSnap: boolean;
}
