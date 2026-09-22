import { memo } from 'react';
import type { CSSProperties } from 'react';
import { Play, Pause, Repeat, Volume2, VolumeX, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { formatTime } from '../utils/audioExport';

interface PlaybackBarProps {
  isReady: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
  volume: number;
  onVolume: (v: number) => void;
  loopEnabled: boolean;
  onToggleLoop: () => void;
  zoom: number;
  onZoomBy: (factor: number) => void;
  /** Absolute zoom setter for the slider (0 = fit to screen). */
  onZoomSet: (pxPerSec: number) => void;
  onFit: () => void;
}

/** Step 04 — transport: play, time, seek progress, loop, volume, zoom. */
function PlaybackBar({
  isReady,
  isPlaying,
  onTogglePlay,
  currentTime,
  duration,
  onSeek,
  volume,
  onVolume,
  loopEnabled,
  onToggleLoop,
  zoom,
  onZoomBy,
  onZoomSet,
  onFit,
}: PlaybackBarProps) {
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <section
      className="panel sticky bottom-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-2.5 px-3 py-3 shadow-[0_-10px_30px_rgba(2,6,23,0.55)] sm:gap-x-4 sm:px-4 md:static md:shadow-none"
      aria-label="Playback controls"
    >
      {/* Play / pause — the one control that should be impossible to miss */}
      <button
        type="button"
        onClick={onTogglePlay}
        disabled={!isReady}
        className="btn btn-primary flex h-12 w-12 shrink-0 !rounded-full !border-0 !p-0 disabled:opacity-40"
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <Pause size={20} fill="currentColor" aria-hidden /> : <Play size={20} fill="currentColor" className="ml-0.5" aria-hidden />}
      </button>

      <span className="eyebrow hidden sm:inline">04 · Preview</span>

      {/* Time readout */}
      <div className="flex shrink-0 items-baseline gap-1 font-mono text-sm tabular-nums">
        <span className="sr-only">Current time</span>
        <span className="font-semibold text-cyan-300">{formatTime(currentTime)}</span>
        <span className="text-slate-600">/</span>
        <span className="text-slate-400">
          <span className="sr-only">of</span>
          {formatTime(duration)}
        </span>
      </div>

      {/* Seekable progress */}
      <input
        type="range"
        className="seek order-last h-6 w-full min-w-[140px] flex-none sm:order-none sm:min-w-[180px] sm:flex-1"
        min={0}
        max={duration || 0}
        step={0.01}
        value={Math.min(currentTime, duration)}
        disabled={!isReady}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Playback position"
        style={{ ['--pct' as string]: `${pct}%` } as CSSProperties}
      />

      {/* Loop toggle */}
      <button
        type="button"
        onClick={onToggleLoop}
        disabled={!isReady}
        aria-pressed={loopEnabled}
        title="Loop the selection during playback (L)"
        className={`btn ${loopEnabled ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-200' : 'text-slate-400'}`}
      >
        <Repeat size={15} aria-hidden />
        Loop
        <span className="sr-only">{loopEnabled ? ' on' : ' off'}</span>
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${loopEnabled ? 'bg-indigo-300' : 'bg-slate-600'}`} />
      </button>

      {/* Volume */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => onVolume(volume > 0 ? 0 : 1)}
          className="icon-btn"
          title={volume > 0 ? 'Mute' : 'Unmute'}
          aria-label={volume > 0 ? 'Mute' : 'Unmute'}
        >
          {volume > 0 ? <Volume2 size={16} aria-hidden /> : <VolumeX size={16} aria-hidden />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          className="hidden w-20 sm:block"
          aria-label="Volume"
        />
      </div>

      {/* Zoom */}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <span className="mr-1 hidden text-[11px] font-medium text-slate-500 md:inline">
          {zoom > 0 ? `${Math.round(zoom)} px/s` : 'Fit'}
        </span>
        <button type="button" onClick={() => onZoomBy(0.6)} disabled={!isReady} className="icon-btn" title="Zoom out" aria-label="Zoom out">
          <ZoomOut size={16} aria-hidden />
        </button>
        <input
          type="range"
          min={0}
          max={2000}
          step={5}
          value={Math.round(zoom)}
          disabled={!isReady}
          onChange={(e) => onZoomSet(Number(e.target.value))}
          className="hidden w-28 md:block"
          aria-label="Waveform zoom"
          title="Zoom level — the far left is fit-to-screen"
        />
        <button type="button" onClick={() => onZoomBy(1.6)} disabled={!isReady} className="icon-btn" title="Zoom in" aria-label="Zoom in">
          <ZoomIn size={16} aria-hidden />
        </button>
        <button type="button" onClick={onFit} disabled={!isReady} className="btn !py-1.5" title="Fit the whole waveform (F)">
          <Maximize2 size={13} aria-hidden />
          Fit
        </button>
      </div>

      <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-slate-600 lg:flex">
        <kbd className="kbd">Space</kbd> play / pause
      </span>
    </section>
  );
}

export default memo(PlaybackBar);
