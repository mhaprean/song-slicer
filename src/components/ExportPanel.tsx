import { memo } from 'react';
import {
  Download,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ChevronDown,
  SlidersHorizontal,
} from 'lucide-react';
import Switch from './Switch';
import { formatTime } from '../utils/audioExport';
import type { ExportFormat, ExportMode, ExportState, LoopRange, RegionInfo } from '../types/models';

interface ExportPanelProps {
  className?: string;
  format: ExportFormat;
  onFormatChange: (f: ExportFormat) => void;
  mode: ExportMode;
  onModeChange: (m: ExportMode) => void;
  gapMs: number;
  onGapMsChange: (v: number) => void;
  fadeInMs: number;
  onFadeInMsChange: (v: number) => void;
  fadeOutMs: number;
  onFadeOutMsChange: (v: number) => void;
  normalize: boolean;
  onNormalizeChange: (v: boolean) => void;
  regions: RegionInfo[];
  loop: LoopRange;
  isReady: boolean;
  exportState: ExportState;
  onExportLoop: () => void;
  onExportAll: () => void;
}

/** Step 06 — format/mode/processing settings + the app's primary action. */
function ExportPanel({
  className = '',
  format,
  onFormatChange,
  mode,
  onModeChange,
  gapMs,
  onGapMsChange,
  fadeInMs,
  onFadeInMsChange,
  fadeOutMs,
  onFadeOutMsChange,
  normalize,
  onNormalizeChange,
  regions,
  loop,
  isReady,
  exportState,
  onExportLoop,
  onExportAll,
}: ExportPanelProps) {
  const exporting = exportState.status === 'running';
  const count = regions.length;
  const total = regions.reduce((acc, r) => acc + (r.end - r.start), 0);
  const asZip = mode === 'separate' && count > 1;

  const allDisabled = !isReady || exporting;
  const allReason = !isReady ? 'Load an audio file first' : count === 0 ? 'Add at least one loop to the list first' : exporting ? 'An export is already running' : '';

  return (
    <section className={`panel px-4 py-3.5 sm:px-5 ${className}`} aria-label="Export">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="eyebrow">06 · Export</span>
        <span className="text-xs text-slate-500">WAV is lossless · MP3 is 192 kbps</span>
      </div>

      <div className="flex flex-col gap-3.5">
        {/* Format + output mode */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Format</span>
            <div className="seg" role="group" aria-label="Export format">
              {(['wav', 'mp3'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => onFormatChange(f)}
                  aria-pressed={format === f}
                  className={`seg-btn ${format === f ? 'bg-indigo-500 text-white' : ''}`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Multiple loops</span>
            <div className="seg" role="group" aria-label="How to export multiple loops">
              <button
                type="button"
                onClick={() => onModeChange('merged')}
                aria-pressed={mode === 'merged'}
                title="All loops concatenated into one file"
                className={`seg-btn ${mode === 'merged' ? 'bg-indigo-500 text-white' : ''}`}
              >
                One file
              </button>
              <button
                type="button"
                onClick={() => onModeChange('separate')}
                aria-pressed={mode === 'separate'}
                title="One file per loop, packaged as a ZIP"
                className={`seg-btn ${mode === 'separate' ? 'bg-indigo-500 text-white' : ''}`}
              >
                ZIP
              </button>
            </div>
          </div>

          {mode === 'merged' && (
            <label className="flex items-center gap-2 text-xs text-slate-400">
              Gap
              <input
                type="number"
                min={0}
                step={50}
                value={gapMs}
                disabled={count < 2}
                onChange={(e) => onGapMsChange(Math.max(0, Number(e.target.value) || 0))}
                className="field field-mono w-20 text-right"
                aria-label="Silence gap between merged loops in milliseconds"
                title={count < 2 ? 'Only applies when merging two or more loops' : 'Silence inserted between loops'}
              />
              ms
            </label>
          )}
        </div>
        {/* Processing options — folded away so the default view stays calm */}
        <details className="group rounded-xl border border-white/8 bg-black/20">
          <summary className="flex cursor-pointer list-none select-none items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-400 transition-colors hover:text-slate-200 [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal size={13} aria-hidden />
            Processing options
            <span className="ml-auto flex items-center gap-1.5 text-[10px] font-normal text-slate-600">
              {normalize && <span>Normalize</span>}
              {(fadeInMs > 0 || fadeOutMs > 0) && <span>Fades on</span>}
              <ChevronDown size={13} className="transition-transform group-open:rotate-180" aria-hidden />
            </span>
          </summary>
          <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-t border-white/5 px-3 pb-3 pt-2.5">
            <label className="block text-[11px] text-slate-400">
              Fade in
              <input
                type="number"
                min={0}
                max={10000}
                step={10}
                value={fadeInMs}
                onChange={(e) => onFadeInMsChange(Math.min(10000, Math.max(0, Number(e.target.value) || 0)))}
                className="field field-mono ml-2 w-20 text-right"
                aria-label="Fade in duration in milliseconds"
              />
              <span className="ml-1.5 font-mono text-[10px] text-slate-600">ms</span>
            </label>
            <label className="block text-[11px] text-slate-400">
              Fade out
              <input
                type="number"
                min={0}
                max={10000}
                step={10}
                value={fadeOutMs}
                onChange={(e) => onFadeOutMsChange(Math.min(10000, Math.max(0, Number(e.target.value) || 0)))}
                className="field field-mono ml-2 w-20 text-right"
                aria-label="Fade out duration in milliseconds"
              />
              <span className="ml-1.5 font-mono text-[10px] text-slate-600">ms</span>
            </label>
            <Switch
              checked={normalize}
              onChange={onNormalizeChange}
              label="Normalize to −1 dBFS"
              title="Peak-normalize every exported loop to −1 dBFS for consistent loudness"
            />
          </div>
        </details>

        {/* Summary + progress + primary action */}
        <div className="rounded-xl border border-white/8 bg-black/25 p-3.5">
          <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-slate-500">Loops</dt>
              <dd className="font-mono font-semibold text-slate-200">{count}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-slate-500">Total length</dt>
              <dd className="font-mono font-semibold text-slate-200">{formatTime(total)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-slate-500">Format</dt>
              <dd className="font-mono font-semibold text-slate-200">{format.toUpperCase()}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-slate-500">Output</dt>
              <dd className="font-semibold text-slate-200">{asZip ? 'ZIP' : mode === 'merged' ? '1 file' : '1 loop'}</dd>
            </div>
          </dl>
          {exportState.status === 'running' && (
            <div className="mb-3" role="status" aria-live="polite">
              <div className="mb-1.5 flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin text-indigo-300" aria-hidden />
                  {exportState.stage}
                </span>
                <span className="font-mono text-slate-500">{Math.round(exportState.progress * 100)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-indigo-500 transition-all duration-150"
                  style={{ width: `${Math.round(exportState.progress * 100)}%` }}
                />
              </div>
            </div>
          )}

          {exportState.status === 'done' && (
            <p className="mb-3 flex items-center gap-1.5 text-xs text-emerald-300">
              <CheckCircle2 size={13} aria-hidden />
              {exportState.message}
            </p>
          )}

          {exportState.status === 'error' && (
            <p className="mb-3 flex items-center gap-1.5 text-xs text-rose-300" role="alert">
              <AlertTriangle size={13} aria-hidden />
              {exportState.message}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onExportLoop}
              disabled={allDisabled}
              className="btn"
              title={isReady ? 'Export the current waveform selection' : 'Load an audio file first'}
            >
              <Download size={14} aria-hidden />
              Export loop
            </button>
            <button
              type="button"
              onClick={onExportAll}
              disabled={allDisabled || count === 0}
              title={allReason || `Export ${count} saved loop${count === 1 ? '' : 's'}`}
              aria-busy={exporting}
              className="btn btn-success min-h-[42px] flex-1 !text-sm !font-bold"
            >
              {exporting ? (
                <>
                  <span className="spinner h-4 w-4" aria-hidden />
                  {exportState.status === 'running' ? exportState.stage : 'Exporting…'}
                </>
              ) : (
                <>
                  <Download size={15} aria-hidden />
                  Export {count} {count === 1 ? 'loop' : 'loops'}
                  {asZip ? ' as ZIP' : ''}
                </>
              )}
            </button>
          </div>
          {count === 0 && isReady && (
            <p className="mt-2 text-[11px] text-slate-500">
              Add loops to the list to batch-export — or use “Export loop” for the current selection.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export default memo(ExportPanel);
