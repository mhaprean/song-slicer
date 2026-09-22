import { memo, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Crosshair,
  Pencil,
  Copy,
  Trash2,
  ChevronUp,
  ChevronDown,
  Scissors,
} from 'lucide-react';
import { formatTime } from '../utils/audioExport';
import { solidColor, alphaColor } from '../constants';
import type { RegionInfo } from '../types/models';

interface SavedLoopsProps {
  regions: RegionInfo[];
  /** Id of the saved loop matching the current editor selection (shown as Active). */
  activeRegionId: string | null;
  /** Id of the loop currently being previewed. */
  playingRegionId: string | null;
  renamingId: string | null;
  onRenamingChange: (id: string | null) => void;
  className?: string;
  onPlay: (id: string) => void;
  onRecall: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onClearAll: () => void;
}

/** Step 05 — compact, scannable list of saved loops with full row actions. */
function SavedLoops({
  regions,
  activeRegionId,
  playingRegionId,
  renamingId,
  onRenamingChange,
  className = '',
  onPlay,
  onRecall,
  onRename,
  onDuplicate,
  onRemove,
  onMove,
  onClearAll,
}: SavedLoopsProps) {
  const renameRef = useRef<HTMLInputElement | null>(null);

  // Focus the rename box without scrolling the waveform out of view
  useEffect(() => {
    if (renamingId) renameRef.current?.focus({ preventScroll: true });
  }, [renamingId]);

  return (
    <section className={`panel px-4 py-3.5 sm:px-5 ${className}`} aria-label="Saved loops">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="eyebrow">05 · Saved loops</span>
        <span className="chip" aria-label={`${regions.length} loops saved`}>
          {regions.length} {regions.length === 1 ? 'loop' : 'loops'}
        </span>
        {regions.length > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="btn btn-danger ml-auto !min-h-0 !px-2.5 !py-1.5 !text-xs"
            title="Remove every saved loop (you can undo from the notification)"
          >
            <Trash2 size={13} aria-hidden />
            Clear all
          </button>
        )}
      </div>

      {regions.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-9 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5" aria-hidden>
            <Scissors size={19} className="text-slate-500" />
          </div>
          <p className="text-sm font-medium text-slate-300">No saved loops yet</p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
            Drag the handles on the waveform (or press <kbd className="kbd">[</kbd> /{' '}
            <kbd className="kbd">]</kbd>), then press <strong className="font-semibold text-slate-400">Add to list</strong>.
          </p>
        </div>
      ) : (
        <ol className="space-y-1.5">
          {regions.map((region, idx) => {
            const isActive = region.id === activeRegionId;
            const isPlaying = region.id === playingRegionId;
            const solid = solidColor(region.color);
            return (
              <li
                key={region.id}
                className="row-in flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-xl border border-white/5 bg-white/[0.03] px-2.5 py-2 transition-colors hover:border-white/10 hover:bg-white/[0.05]"
                style={{ animationDelay: `${Math.min(idx, 8) * 25}ms` }}
              >
                {/* Loop number + color (number carries meaning, not color alone) */}
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-slate-100"
                  style={{ background: alphaColor(region.color, '0.16'), boxShadow: `inset 0 0 0 1px ${alphaColor(region.color, '0.55')}` }}
                  aria-hidden
                >
                  {idx + 1}
                </span>

                {renamingId === region.id ? (
                  <input
                    ref={renameRef}
                    type="text"
                    defaultValue={region.name || ''}
                    onFocus={(e) => e.target.select()}
                    onBlur={(e) => {
                      onRename(region.id, e.target.value);
                      onRenamingChange(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') onRenamingChange(null);
                    }}
                    placeholder="Name this loop…"
                    aria-label={`Rename loop ${idx + 1}`}
                    className="field w-40 flex-1 text-sm"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onRenamingChange(region.id)}
                    title="Click to rename"
                    aria-label={`Loop ${idx + 1}: ${region.name || 'Untitled'}. Click to rename.`}
                    className={`max-w-[9rem] truncate text-left text-sm font-medium transition-colors hover:text-white sm:max-w-[14rem] ${
                      region.name ? 'text-slate-200' : 'italic text-slate-500'
                    }`}
                  >
                    {region.name || 'Untitled'}
                  </button>
                )}

                <span className="hidden font-mono text-xs tabular-nums text-slate-400 sm:inline">
                  {formatTime(region.start)} → {formatTime(region.end)}
                </span>
                <span className="chip field-mono !font-semibold">{formatTime(region.end - region.start)}</span>
                {isActive && <span className="chip chip-accent">Active</span>}

                <span className="ml-auto flex flex-wrap items-center justify-end gap-0.5">
                  <button
                    type="button"
                    onClick={() => onPlay(region.id)}
                    className="icon-btn !h-8 !w-8"
                    title={isPlaying ? 'Stop preview' : 'Preview this loop'}
                    aria-label={`${isPlaying ? 'Stop' : 'Play'} loop ${idx + 1}`}
                    aria-pressed={isPlaying}
                  >
                    {isPlaying ? (
                      <Pause size={14} className="text-emerald-300" fill="currentColor" aria-hidden />
                    ) : (
                      <Play size={14} className="text-emerald-400" fill="currentColor" aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRecall(region.id)}
                    className="icon-btn !h-8 !w-8"
                    title="Load into the editor"
                    aria-label={`Edit loop ${idx + 1} in the editor`}
                  >
                    <Crosshair size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRenamingChange(region.id)}
                    className="icon-btn !h-8 !w-8"
                    title="Rename"
                    aria-label={`Rename loop ${idx + 1}`}
                  >
                    <Pencil size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDuplicate(region.id)}
                    className="icon-btn !h-8 !w-8"
                    title="Duplicate"
                    aria-label={`Duplicate loop ${idx + 1}`}
                  >
                    <Copy size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(region.id, -1)}
                    disabled={idx === 0}
                    className="icon-btn !h-8 !w-8"
                    title="Move up"
                    aria-label={`Move loop ${idx + 1} up`}
                  >
                    <ChevronUp size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(region.id, 1)}
                    disabled={idx === regions.length - 1}
                    className="icon-btn !h-8 !w-8"
                    title="Move down"
                    aria-label={`Move loop ${idx + 1} down`}
                  >
                    <ChevronDown size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(region.id)}
                    className="icon-btn !h-8 !w-8 hover:!bg-rose-500/10 hover:!text-rose-400"
                    title="Delete (undoable from the notification)"
                    aria-label={`Delete loop ${idx + 1}`}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>

                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export default memo(SavedLoops);
