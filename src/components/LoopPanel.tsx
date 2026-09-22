import { memo } from 'react';
import { Undo2, Redo2, RotateCcw, Download, Plus, Flag } from 'lucide-react';
import TimeField from './TimeField';
import Switch from './Switch';
import { formatTimeMs } from '../utils/audioExport';
import type { LoopRange, SlotKey } from '../types/models';

interface LoopPanelProps {
  loop: LoopRange;
  duration: number;
  snap: boolean;
  gridSnap: boolean;
  gridOn: boolean;
  onApplyLoop: (r: LoopRange) => void;
  onSetStart: () => void;
  onSetEnd: () => void;
  onReset: () => void;
  onSnapChange: (v: boolean) => void;
  onGridSnapChange: (v: boolean) => void;
  onAdd: () => void;
  onExport: () => void;
  exporting: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  abSlots: { a: LoopRange | null; b: LoopRange | null };
  activeSlot: SlotKey | null;
  onSlot: (key: SlotKey, store: boolean) => void;
}

/** Step 03 — the live selection: numeric readouts, marker controls, A/B, save/export. */
function LoopPanel({
  loop,
  duration,
  snap,
  gridSnap,
  gridOn,
  onApplyLoop,
  onSetStart,
  onSetEnd,
  onReset,
  onSnapChange,
  onGridSnapChange,
  onAdd,
  onExport,
  exporting,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  abSlots,
  activeSlot,
  onSlot,
}: LoopPanelProps) {
  const length = Math.max(0, loop.end - loop.start);

  const slotBtn = (key: SlotKey) => {
    const slot = abSlots[key];
    const active = activeSlot === key;
    return (
      <button
        key={key}
        type="button"
        onClick={(e) => onSlot(key, e.altKey)}
        title={
          slot
            ? `Loop slot ${key.toUpperCase()} — click to switch, Alt+click to store the current selection`
            : `Loop slot ${key.toUpperCase()} is empty — click to store the current selection`
        }
        aria-pressed={active}
        className={`seg-btn flex items-center gap-1.5 ${active ? 'bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-400/40' : ''}`}
      >
        <span className="font-bold">{key.toUpperCase()}</span>
        <span className="hidden font-mono text-[9px] font-normal opacity-75 md:inline">
          {slot ? formatTimeMs(slot.start) : 'empty'}
        </span>
      </button>
    );
  };

  return (
    <section className="panel relative overflow-hidden px-4 py-3.5 sm:px-5" aria-label="Loop selection controls">
      {/* Left accent marks this card as the live selection */}
      <span
        aria-hidden
        className="absolute bottom-4 left-0 top-4 w-1 rounded-r-full bg-gradient-to-b from-cyan-400 to-indigo-500"
      />

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 pl-2.5">
        <span className="eyebrow">03 · Loop selection</span>
        <span className="chip chip-accent">Active selection</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className="icon-btn"
            title="Undo loop change (Ctrl+Z)"
            aria-label="Undo loop change"
          >
            <Undo2 size={16} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            className="icon-btn"
            title="Redo loop change (Ctrl+Shift+Z)"
            aria-label="Redo loop change"
          >
            <Redo2 size={16} aria-hidden />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 pl-2.5">
        {/* Numeric time editing */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-400">Start (s)</span>
            <TimeField
              value={loop.start}
              ariaLabel="Loop start time in seconds"
              onCommit={(v) => onApplyLoop({ start: v, end: loop.end })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-400">End (s)</span>
            <TimeField
              value={loop.end}
              ariaLabel="Loop end time in seconds"
              onCommit={(v) => onApplyLoop({ start: loop.start, end: v })}
            />
          </label>
          <div className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-400">Duration</span>
            <div
              className="flex h-[34px] w-28 items-center justify-end rounded-[10px] border border-cyan-400/25 bg-cyan-400/10 px-2.5 font-mono text-sm font-semibold tabular-nums text-cyan-300"
              title="Selected loop length"
            >
              {formatTimeMs(length)}
            </div>
          </div>
        </div>

        {/* Marker controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onSetStart} className="btn !py-1.5" title="Set loop start at the playhead ([)">
            <Flag size={13} className="rotate-180" aria-hidden />
            Set start
            <kbd className="kbd">[</kbd>
          </button>
          <button type="button" onClick={onSetEnd} className="btn !py-1.5" title="Set loop end at the playhead (])">
            <Flag size={13} aria-hidden />
            Set end
            <kbd className="kbd">]</kbd>
          </button>
          <button type="button" onClick={onReset} className="btn !py-1.5" title="Reset the loop to the full track">
            <RotateCcw size={13} aria-hidden />
            Reset
          </button>
        </div>

        {/* Snapping + A/B */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Switch
            checked={snap}
            onChange={onSnapChange}
            label="Snap zero-x"
            title="Snap loop edges to the nearest zero-crossing on release, so cuts don't click"
          />
          <Switch
            checked={gridSnap}
            onChange={onGridSnapChange}
            disabled={!gridOn}
            label="Snap to grid"
            title={
              gridOn
                ? 'Quantize handle drags to the beat grid'
                : 'Enable the Grid toggle above the waveform first'
            }
          />
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500" title="A/B compare two selections (keys 1 / 2)">
              A/B
            </span>
            <div className="seg">
              {slotBtn('a')}
              {slotBtn('b')}
            </div>
          </div>
        </div>

        {/* Primary actions for this selection */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onExport}
            disabled={exporting || duration <= 0}
            className="btn"
            title="Export the current selection only"
          >
            <Download size={14} aria-hidden />
            Export loop
          </button>
          <button
            type="button"
            onClick={onAdd}
            disabled={length <= 0}
            className="btn btn-primary"
            title="Save this selection to the list below (M)"
          >
            <Plus size={14} aria-hidden />
            Add to list
          </button>
        </div>
      </div>

    </section>
  );
}

export default memo(LoopPanel);
