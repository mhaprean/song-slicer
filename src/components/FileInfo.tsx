import { FileAudio, Upload, X, Loader2, AlertTriangle } from 'lucide-react';
import { formatTime } from '../utils/audioExport';
import { LOAD_STAGE_LABEL } from '../constants';
import type { LoadError, LoadStage } from '../types/models';

interface FileInfoProps {
  file: File;
  duration: number;
  isReady: boolean;
  loadStage: LoadStage | null;
  loadError: LoadError | null;
  onLoadNew: () => void;
  onClear: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fileFormat(file: File): string {
  const m = file.name.match(/\.([^.]+)$/);
  if (m) return m[1].toUpperCase();
  return (file.type.split('/')[1] || 'AUDIO').toUpperCase();
}

/** Step 01 — prominent file identity, metadata chips and a live status pill. */
export default function FileInfo({
  file,
  duration,
  isReady,
  loadStage,
  loadError,
  onLoadNew,
  onClear,
}: FileInfoProps) {
  const status = loadStage ? (
    <span className="chip chip-warn">
      <Loader2 size={11} className="animate-spin" aria-hidden />
      {LOAD_STAGE_LABEL[loadStage]}
    </span>
  ) : loadError ? (
    <span className="chip chip-danger">
      <AlertTriangle size={11} aria-hidden />
      Error
    </span>
  ) : isReady ? (
    <span className="chip chip-ok">
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
      </span>
      Loaded
    </span>
  ) : null;

  return (
    <section className="panel flex flex-wrap items-center gap-3 px-4 py-3" aria-label="Loaded audio file">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/90 to-cyan-500/80 shadow-md shadow-indigo-500/20"
        aria-hidden
      >
        <FileAudio size={19} className="text-white" />
      </div>

      <div className="min-w-0 flex-1 basis-56">
        <p className="eyebrow">01 · Load audio</p>
        <p
          className="mt-0.5 truncate text-sm font-semibold text-slate-100 sm:text-base"
          title={file.name}
        >
          {file.name}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="chip">{fileFormat(file)}</span>
          <span className="chip">{formatBytes(file.size)}</span>
          <span className="chip field-mono">{duration > 0 ? formatTime(duration) : '—:——'}</span>
          {status}
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button type="button" onClick={onLoadNew} className="btn" title="Replace the current file">
          <Upload size={15} aria-hidden />
          <span className="hidden sm:inline">Load new file</span>
          <span className="sm:hidden">Load</span>
        </button>
        <button
          type="button"
          onClick={onClear}
          className="btn btn-ghost"
          title="Clear the current file and return to the start screen"
          aria-label="Clear loaded file"
        >
          <X size={15} aria-hidden />
          <span className="hidden sm:inline">Clear</span>
        </button>
      </div>
    </section>
  );
}
