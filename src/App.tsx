import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import WaveSurfer from 'wavesurfer.js';
import { encodeWAV, encodeMP3, extractRegion, formatTime } from './utils/audioExport';

interface RegionInfo {
  id: string;
  start: number;
  end: number;
  color: string;
}

interface LoopRange {
  start: number;
  end: number;
}

const REGION_COLORS = [
  'rgba(99, 102, 241, 0.4)',
  'rgba(16, 185, 129, 0.4)',
  'rgba(245, 158, 11, 0.4)',
  'rgba(239, 68, 68, 0.4)',
  'rgba(168, 85, 247, 0.4)',
  'rgba(6, 182, 212, 0.4)',
];

const MIN_LOOP = 0.01; // minimum loop length in seconds
const MAX_ZOOM = 2000; // max pixels per second

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Numeric text field that commits valid values live and reverts on blur. */
function TimeField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(value.toFixed(3));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value.toFixed(3));
  }, [value, focused]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={focused ? draft : value.toFixed(3)}
      onFocus={(e) => {
        setFocused(true);
        setDraft(value.toFixed(3));
        e.target.select();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = parseFloat(e.target.value);
        if (!isNaN(v) && v >= 0) onCommit(v);
      }}
      onBlur={() => {
        setFocused(false);
        setDraft(value.toFixed(3));
      }}
      className="w-24 bg-slate-900/70 border border-slate-600 rounded-md px-2 py-1 text-xs font-mono text-slate-200 focus:outline-none focus:border-yellow-500"
    />
  );
}

/**
 * A draggable loop marker rendered INSIDE the WaveSurfer wrapper element.
 * Positioned as a percentage of the timeline, so it stays anchored to the
 * same audio second when the view is zoomed or scrolled.
 * Uses native listeners because the WaveSurfer wrapper lives in a shadow root.
 */
function LoopPin({
  side,
  time,
  duration,
  onPointerDown,
}: {
  side: 'start' | 'end';
  time: number;
  duration: number;
  onPointerDown: (side: 'start' | 'end', e: PointerEvent) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    const down = (e: PointerEvent) => onPointerDown(side, e);
    el.addEventListener('pointerdown', down);
    // Keep WaveSurfer from seeking when clicking/double-clicking a pin
    el.addEventListener('click', stop);
    el.addEventListener('dblclick', stop);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('click', stop);
      el.removeEventListener('dblclick', stop);
    };
  }, [side, onPointerDown]);

  const pct = duration > 0 ? (time / duration) * 100 : 0;
  const isStart = side === 'start';
  const color = isStart ? '#facc15' : '#fb923c';

  return (
    <div
      ref={ref}
      data-pin={side}
      style={{
        position: 'absolute',
        top: 0,
        height: '100%',
        width: '16px',
        left: `calc(${pct}% - 8px)`,
        cursor: 'ew-resize',
        zIndex: 10,
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '50%',
          marginLeft: '-1px',
          top: 0,
          bottom: 0,
          width: '2px',
          background: color,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '2px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          background: color,
          border: '2px solid rgba(15, 23, 42, 0.9)',
          boxShadow: '0 1px 4px rgba(0, 0, 0, 0.5)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '18px',
          left: '50%',
          transform: 'translateX(-50%)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '10px',
          lineHeight: '14px',
          padding: '0 4px',
          borderRadius: '4px',
          background: 'rgba(15, 23, 42, 0.85)',
          color,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        {formatTime(time)}
      </div>
    </div>
  );
}

function App() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [zoom, setZoom] = useState(0); // px per second; 0 = fit to width
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [isFileDragging, setIsFileDragging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav');
  const [notification, setNotification] = useState<string | null>(null);
  const [loop, setLoop] = useState<LoopRange>({ start: 0, end: 0 });
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [waveWrapper, setWaveWrapper] = useState<HTMLElement | null>(null);

  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const colorCounterRef = useRef(0);
  const loopRef = useRef<LoopRange>({ start: 0, end: 0 });
  const loopEnabledRef = useRef(true);
  const durationRef = useRef(0);
  const zoomRef = useRef(0);
  const previewRef = useRef<LoopRange | null>(null);

  const showNotification = useCallback((msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  }, []);

  /** Single source of truth for loop changes: clamps and keeps the ref in sync. */
  const applyLoop = useCallback((next: LoopRange) => {
    const dur = durationRef.current;
    let s = clamp(next.start, 0, dur);
    let e = clamp(next.end, 0, dur);
    if (e - s < MIN_LOOP) {
      e = Math.min(dur, s + MIN_LOOP);
      if (e - s < MIN_LOOP) s = Math.max(0, e - MIN_LOOP);
    }
    const v = { start: s, end: e };
    loopRef.current = v;
    setLoop(v);
  }, []);

  const initWaveSurfer = useCallback(async (file: File) => {
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
      wavesurferRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }

    setIsReady(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setZoom(0);
    zoomRef.current = 0;
    setWaveWrapper(null);

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    let rawBuffer: ArrayBuffer;
    try {
      rawBuffer = await file.arrayBuffer();
    } catch (err) {
      console.error('Failed to read file:', err);
      showNotification('Failed to read audio file');
      return;
    }

    const bufferCopy = rawBuffer.slice(0);

    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await audioContext.decodeAudioData(rawBuffer);
    } catch (err) {
      console.error('Failed to decode audio:', err);
      showNotification('Failed to decode audio file');
      return;
    }
    audioBufferRef.current = audioBuffer;

    let mimeType = file.type;
    if (!mimeType || mimeType === '') {
      const ext = file.name.split('.').pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'ogg': 'audio/ogg',
        'flac': 'audio/flac',
        'm4a': 'audio/mp4',
        'aac': 'audio/aac',
        'webm': 'audio/webm',
      };
      mimeType = mimeMap[ext || ''] || 'audio/mpeg';
    }

    const blob = new Blob([bufferCopy], { type: mimeType });

    const ws = WaveSurfer.create({
      container: waveformRef.current!,
      waveColor: '#6366f1',
      progressColor: '#4f46e5',
      cursorColor: '#ef4444',
      cursorWidth: 2,
      height: 180,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      interact: true,
    });

    const loadTimeout = setTimeout(() => {
      if (!wavesurferRef.current) return;
      const dur = wavesurferRef.current.getDuration();
      if (dur === 0) {
        showNotification('Audio loading timed out');
      }
    }, 15000);

    ws.on('ready', () => {
      clearTimeout(loadTimeout);
      const dur = ws.getDuration();
      durationRef.current = dur;
      setDuration(dur);
      // Markers start at the beginning and the end of the track
      applyLoop({ start: 0, end: dur });
      loopEnabledRef.current = true;
      setLoopEnabled(true);
      setWaveWrapper(ws.getWrapper());
      setIsReady(true);
    });

    ws.on('error', (err: unknown) => {
      clearTimeout(loadTimeout);
      console.error('WaveSurfer error:', err);
      showNotification('Error loading audio');
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => {
      setIsPlaying(false);
      previewRef.current = null;
    });

    ws.on('timeupdate', (time: number) => {
      setCurrentTime(time);
      // Wrap at the end of the active range: a previewed saved loop while it's
      // playing, otherwise the loop selection when looping is enabled.
      const active = previewRef.current ?? (loopEnabledRef.current ? loopRef.current : null);
      if (active && ws.isPlaying() && active.end > active.start && time >= active.end - 0.005) {
        ws.setTime(active.start);
      }
    });

    wavesurferRef.current = ws;

    try {
      await ws.loadBlob(blob);
    } catch (err) {
      console.error('WaveSurfer loadBlob error:', err);
      showNotification('Failed to load audio');
    }
  }, [applyLoop, showNotification]);

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|ogg|flac|m4a|aac|webm)$/i)) {
        showNotification('Please select a valid audio file');
        return;
      }
      setAudioFile(file);
      setIsReady(false);
      setRegions([]);
      setCurrentTime(0);
      setDuration(0);
      setZoom(0);
      zoomRef.current = 0;
      initWaveSurfer(file);
    },
    [initWaveSurfer, showNotification]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsFileDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsFileDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsFileDragging(false);
  }, []);

  // ---- Loop editing -------------------------------------------------------

  const handlePinPointerDown = useCallback(
    (side: 'start' | 'end', e: PointerEvent) => {
      const el = e.currentTarget as HTMLElement;
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      let dragging: 'start' | 'end' = side;

      const onMove = (ev: PointerEvent) => {
        const ws = wavesurferRef.current;
        if (!ws) return;
        const wrapper = ws.getWrapper();
        const rect = wrapper.getBoundingClientRect();
        const dur = ws.getDuration();
        if (!rect.width || !dur) return;
        // Pointer position -> time, using the zoomed wrapper itself, so this
        // is correct at any zoom level and scroll offset.
        const t = clamp(((ev.clientX - rect.left) / rect.width) * dur, 0, dur);
        const cur = loopRef.current;
        if (dragging === 'start') {
          if (t <= cur.end - MIN_LOOP) {
            applyLoop({ start: t, end: cur.end });
          } else {
            // Crossed the other pin: the dragged pin becomes the end pin
            dragging = 'end';
            applyLoop({ start: cur.end, end: t });
          }
        } else {
          if (t >= cur.start + MIN_LOOP) {
            applyLoop({ start: cur.start, end: t });
          } else {
            dragging = 'start';
            applyLoop({ start: t, end: cur.start });
          }
        }
      };
      const onUp = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    },
    [applyLoop]
  );

  const setStartAtPlayhead = useCallback(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const t = ws.getCurrentTime();
    const { end } = loopRef.current;
    applyLoop({ start: clamp(t, 0, Math.max(0, end - MIN_LOOP)), end });
  }, [applyLoop]);

  const setEndAtPlayhead = useCallback(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const t = ws.getCurrentTime();
    const { start } = loopRef.current;
    applyLoop({ start, end: clamp(t, start + MIN_LOOP, durationRef.current) });
  }, [applyLoop]);

  const resetLoop = useCallback(() => {
    if (durationRef.current <= 0) return;
    applyLoop({ start: 0, end: durationRef.current });
  }, [applyLoop]);

  const toggleLoopEnabled = useCallback(() => {
    const next = !loopEnabledRef.current;
    loopEnabledRef.current = next;
    setLoopEnabled(next);
  }, []);

  // ---- Playback -----------------------------------------------------------

  const togglePlay = useCallback(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    previewRef.current = null;
    if (loopEnabledRef.current) {
      const { start, end } = loopRef.current;
      if (!ws.isPlaying()) {
        const t = ws.getCurrentTime();
        if (t < start - 0.001 || t >= end - 0.001) ws.setTime(start);
        ws.play();
      } else {
        ws.pause();
      }
    } else {
      ws.playPause();
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === '[') {
        setStartAtPlayhead();
      } else if (e.key === ']') {
        setEndAtPlayhead();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, setStartAtPlayhead, setEndAtPlayhead]);

  // ---- Zoom (cursor-anchored) ----------------------------------------------

  const zoomTo = useCallback((target: number, anchorClientX?: number) => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const wrapper = ws.getWrapper();
    const scroll = wrapper.parentElement as HTMLElement | null;
    if (!scroll) return;
    const dur = ws.getDuration();
    if (!dur) return;

    const viewW = scroll.clientWidth;
    const rect = scroll.getBoundingClientRect();
    const anchorX = anchorClientX != null ? anchorClientX - rect.left : viewW / 2;
    const curPps = scroll.scrollWidth / dur;
    const anchorTime = (scroll.scrollLeft + anchorX) / curPps;

    const t = clamp(target, 0, MAX_ZOOM);
    ws.zoom(t);

    // Keep the audio moment under `anchorX` at the same on-screen position,
    // so loop markers and the feature you aim at stay put while zooming.
    if (t > 0) {
      const maxScroll = Math.max(0, scroll.scrollWidth - viewW);
      scroll.scrollLeft = clamp(anchorTime * t - anchorX, 0, maxScroll);
    }
    zoomRef.current = t;
    setZoom(t);
  }, []);

  // Re-attach when a file loads: the waveform container is only mounted after
  // a file is selected, so the effect must re-run then or the listener would
  // be registered against nothing and never again.
  useEffect(() => {
    const container = waveformRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      const ws = wavesurferRef.current;
      if (!ws) return;
      const wrapper = ws.getWrapper();
      const scroll = wrapper.parentElement as HTMLElement | null;
      if (!scroll) return;
      const dur = ws.getDuration();
      if (!dur) return;

      e.preventDefault();

      // Horizontal pan: sideways trackpad swipe or Shift + wheel
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        scroll.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        return;
      }

      // Vertical wheel: zoom, anchored at the cursor
      const base = zoomRef.current > 0 ? zoomRef.current : scroll.scrollWidth / dur;
      let next = base * (e.deltaY < 0 ? 1.25 : 0.8);
      const fitPps = scroll.clientWidth / dur;
      if (next <= fitPps) next = 0;
      zoomTo(next, e.clientX);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoomTo, audioFile, isReady]);

  // ---- Saved regions & export ----------------------------------------------

  const addLoopToList = useCallback(() => {
    const { start, end } = loopRef.current;
    if (end - start < MIN_LOOP) return;
    const colorIdx = colorCounterRef.current % REGION_COLORS.length;
    colorCounterRef.current++;
    const newRegion: RegionInfo = {
      id: `region-${Date.now()}`,
      start,
      end,
      color: REGION_COLORS[colorIdx],
    };
    setRegions((prev) => [...prev, newRegion]);
    showNotification('Loop added to list');
  }, [showNotification]);

  const playRegion = useCallback((regionId: string) => {
    const region = regions.find((r) => r.id === regionId);
    const ws = wavesurferRef.current;
    if (!region || !ws) return;
    // Preview this saved loop with its own wrap-around
    previewRef.current = { start: region.start, end: region.end };
    if (!ws.isPlaying()) ws.setTime(region.start);
    ws.play();
  }, [regions]);

  const removeRegion = useCallback((regionId: string) => {
    setRegions((prev) => prev.filter((r) => r.id !== regionId));
  }, []);

  const clearAllRegions = useCallback(() => {
    setRegions([]);
  }, []);

  const runExport = useCallback(
    async (list: { start: number; end: number }[], suffix: string, format: 'wav' | 'mp3') => {
      if (!audioBufferRef.current || !audioContextRef.current || list.length === 0) {
        showNotification('Nothing to export');
        return;
      }

      setIsExporting(true);

      try {
        const ctx = audioContextRef.current;
        const audioBuffer = audioBufferRef.current;

        const totalLength = list.reduce((acc, r) => {
          return acc + Math.max(0, Math.floor((r.end - r.start) * audioBuffer.sampleRate));
        }, 0);

        const outputBuffer = ctx.createBuffer(audioBuffer.numberOfChannels, totalLength, audioBuffer.sampleRate);

        let offset = 0;
        for (const r of list) {
          const regionBuffer = await extractRegion(ctx, audioBuffer, r.start, r.end);
          for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
            const sourceData = regionBuffer.getChannelData(ch);
            const targetData = outputBuffer.getChannelData(ch);
            for (let i = 0; i < sourceData.length; i++) {
              targetData[offset + i] = sourceData[i];
            }
          }
          offset += regionBuffer.length;
        }

        let blob: Blob;
        if (format === 'wav') {
          blob = encodeWAV(outputBuffer);
        } else {
          blob = await encodeMP3(outputBuffer);
        }

        const base = audioFile?.name?.replace(/\.[^.]+$/, '') || 'audio';
        const filename = `${base}_${suffix}.${format}`;

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showNotification(`Exported as ${format.toUpperCase()} successfully!`);
      } catch (err) {
        console.error('Export error:', err);
        showNotification('Export failed');
      } finally {
        setIsExporting(false);
      }
    },
    [audioFile, showNotification]
  );

  const handleExportAll = useCallback(() => {
    if (regions.length === 0) {
      showNotification('Add at least one loop to the list first');
      return;
    }
    return runExport(
      regions.map((r) => ({ start: r.start, end: r.end })),
      'cut',
      exportFormat
    );
  }, [regions, exportFormat, runExport, showNotification]);

  const handleExportLoop = useCallback(() => {
    return runExport([{ start: loop.start, end: loop.end }], 'loop', exportFormat);
  }, [loop, exportFormat, runExport]);

  // ---- Cleanup ---------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // ---- Render ------------------------------------------------------------------

  if (!audioFile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
        <div
          className={`w-full max-w-2xl border-2 border-dashed rounded-2xl p-16 text-center transition-all duration-300 ${
            isFileDragging
              ? 'border-indigo-400 bg-indigo-500/10 scale-105'
              : 'border-slate-600 bg-slate-800/50 hover:border-indigo-500 hover:bg-slate-800/70'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div className="mb-6">
            <svg className="w-20 h-20 mx-auto text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">Audio Cutter</h1>
          <p className="text-slate-400 mb-8 text-lg">Drop your audio file here to start cutting</p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-indigo-500/25"
          >
            Browse Files
          </button>
          <p className="text-slate-500 mt-4 text-sm">Supports MP3, WAV, OGG, FLAC, M4A, AAC</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
          />
        </div>
      </div>
    );
  }

  const showPins = isReady && waveWrapper !== null && duration > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white">
      {notification && (
        <div className="fixed top-4 right-4 z-50 bg-indigo-600 text-white px-6 py-3 rounded-xl shadow-lg animate-pulse">
          {notification}
        </div>
      )}

      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            <h1 className="text-xl font-bold">Audio Cutter</h1>
          </div>
          <button
            onClick={() => {
              if (wavesurferRef.current) wavesurferRef.current.destroy();
              if (audioContextRef.current) audioContextRef.current.close();
              wavesurferRef.current = null;
              audioContextRef.current = null;
              setAudioFile(null);
              setIsReady(false);
              setRegions([]);
              setWaveWrapper(null);
              setCurrentTime(0);
              setDuration(0);
              setZoom(0);
              zoomRef.current = 0;
            }}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition-colors"
          >
            Load New File
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center gap-4 bg-slate-800/50 rounded-xl px-5 py-3 border border-slate-700/50">
          <svg className="w-5 h-5 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          <span className="font-medium truncate">{audioFile.name}</span>
          <span className="text-slate-400 text-sm ml-auto shrink-0">{(audioFile.size / (1024 * 1024)).toFixed(2)} MB</span>
        </div>

        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-slate-300">Waveform</h2>
            <span className="text-xs text-slate-500">
              Click to place playhead • [ / ] set loop points • Drag pins to adjust • Scroll to zoom • Double-click to reset loop
            </span>
          </div>

          <div
            ref={waveformRef}
            className="relative rounded-lg overflow-x-auto overflow-y-hidden bg-slate-900/50"
            onDoubleClick={() => {
              resetLoop();
            }}
          >
            {showPins &&
              createPortal(
                <>
                  {/* Loop highlight — positioned in % of the timeline so it stays
                      locked to the selected seconds at any zoom level */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `${(loop.start / duration) * 100}%`,
                      width: `${((loop.end - loop.start) / duration) * 100}%`,
                      background: 'rgba(250, 204, 21, 0.15)',
                      borderLeft: '2px solid rgba(250, 204, 21, 0.6)',
                      borderRight: '2px solid rgba(250, 204, 21, 0.6)',
                      pointerEvents: 'none',
                      zIndex: 4,
                    }}
                  />
                  <LoopPin side="start" time={loop.start} duration={duration} onPointerDown={handlePinPointerDown} />
                  <LoopPin side="end" time={loop.end} duration={duration} onPointerDown={handlePinPointerDown} />
                </>,
                waveWrapper
              )}
          </div>

          {!isReady && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
              <span className="ml-3 text-slate-400">Loading audio...</span>
            </div>
          )}
        </div>

        {isReady && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div>
                <h3 className="text-sm font-medium text-yellow-400 mb-1">Loop Selection</h3>
                <p className="text-xs text-slate-400 font-mono">
                  {formatTime(loop.start)} → {formatTime(loop.end)}
                  <span className="ml-2 text-slate-500">({formatTime(loop.end - loop.start)})</span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Start</span>
                <TimeField value={loop.start} onCommit={(v) => applyLoop({ start: v, end: loopRef.current.end })} />
                <span className="text-xs text-slate-400">End</span>
                <TimeField value={loop.end} onCommit={(v) => applyLoop({ start: loopRef.current.start, end: v })} />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={setStartAtPlayhead}
                  title="Set loop start at playhead ( [ )"
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-lg transition-colors"
                >
                  ⏴ Set Start
                </button>
                <button
                  onClick={setEndAtPlayhead}
                  title="Set loop end at playhead ( ] )"
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-lg transition-colors"
                >
                  Set End ⏵
                </button>
                <button
                  onClick={resetLoop}
                  title="Reset loop to the full track"
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-lg transition-colors"
                >
                  Reset
                </button>
              </div>

              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={handleExportLoop}
                  disabled={isExporting}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  Export Loop
                </button>
                <button
                  onClick={addLoopToList}
                  className="px-4 py-1.5 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-semibold text-xs rounded-lg transition-colors"
                >
                  Add to List
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={togglePlay}
              disabled={!isReady}
              className="w-12 h-12 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-colors shadow-lg shadow-indigo-500/25"
            >
              {isPlaying ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <div className="flex items-center gap-2 font-mono text-sm">
              <span className="text-indigo-300">{formatTime(currentTime)}</span>
              <span className="text-slate-500">/</span>
              <span className="text-slate-400">{formatTime(duration)}</span>
            </div>

            <button
              onClick={toggleLoopEnabled}
              title="Loop the selected range during playback"
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                loopEnabled ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 2l4 4-4 4M3 11v-1a4 4 0 014-4h14M7 22l-4-4 4-4m14 5v1a4 4 0 01-4 4H3" />
              </svg>
              Loop {loopEnabled ? 'On' : 'Off'}
            </button>

            <div className="flex items-center gap-3 ml-auto">
              <span className="text-xs text-slate-400">Zoom</span>
              <input
                type="range"
                min="0"
                max={MAX_ZOOM}
                step="5"
                value={Math.round(zoom)}
                disabled={!isReady}
                onChange={(e) => zoomTo(Number(e.target.value))}
                className="w-40 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <span className="text-xs text-slate-500 w-16">{zoom > 0 ? `${Math.round(zoom)} px/s` : 'Fit'}</span>
              <button
                onClick={() => zoomTo(0)}
                disabled={!isReady}
                className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs rounded-lg transition-colors"
              >
                Fit
              </button>
            </div>
          </div>

          {isReady && (
            <div className="mt-4">
              <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-100"
                  style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-slate-300">Saved Loops ({regions.length})</h2>
            {regions.length > 0 && (
              <button onClick={clearAllRegions} className="text-xs text-red-400 hover:text-red-300 transition-colors">
                Clear All
              </button>
            )}
          </div>

          {regions.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">Drag the pins on the waveform to set a loop</p>
              <p className="text-xs mt-1 text-slate-600">Then click "Add to List" to save it for export</p>
            </div>
          ) : (
            <div className="space-y-2">
              {regions.map((region, idx) => (
                <div
                  key={region.id}
                  className="flex items-center gap-3 bg-slate-900/50 rounded-lg px-4 py-3 border border-slate-700/30 hover:border-slate-600/50 transition-colors"
                >
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: region.color.replace('0.4', '1') }} />
                  <span className="text-sm font-medium text-slate-300 w-8">#{idx + 1}</span>
                  <span className="font-mono text-xs text-slate-400">
                    {formatTime(region.start)} → {formatTime(region.end)}
                  </span>
                  <span className="text-xs text-slate-500 ml-2">({formatTime(region.end - region.start)})</span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => playRegion(region.id)}
                      className="p-1.5 hover:bg-slate-700 rounded-md transition-colors"
                      title="Preview loop"
                    >
                      <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => removeRegion(region.id)}
                      className="p-1.5 hover:bg-slate-700 rounded-md transition-colors"
                      title="Remove loop"
                    >
                      <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
          <h2 className="text-sm font-medium text-slate-300 mb-4">Export</h2>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Format:</span>
              <div className="flex rounded-lg overflow-hidden border border-slate-600">
                <button
                  onClick={() => setExportFormat('wav')}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    exportFormat === 'wav' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  WAV
                </button>
                <button
                  onClick={() => setExportFormat('mp3')}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    exportFormat === 'mp3' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  MP3
                </button>
              </div>
            </div>

            <button
              onClick={handleExportAll}
              disabled={!isReady || regions.length === 0 || isExporting}
              className="px-6 py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors shadow-lg shadow-green-500/25 flex items-center gap-2"
            >
              {isExporting ? (
                <>
                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  Exporting...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export {regions.length} Loop{regions.length !== 1 ? 's' : ''}
                </>
              )}
            </button>

            {regions.length > 0 && (
              <span className="text-xs text-slate-500">
                Total duration: {formatTime(regions.reduce((acc, r) => acc + (r.end - r.start), 0))}
              </span>
            )}
          </div>
        </div>

        <div className="bg-slate-800/30 rounded-xl border border-slate-700/30 p-4">
          <h3 className="text-sm font-medium text-slate-400 mb-3">How to use</h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 text-xs text-slate-500">
            <div className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">1.</span>
              <span>Click the waveform to place the playhead (e.g. right where the kick starts)</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">2.</span>
              <span>
                Press <kbd className="text-slate-300">[</kbd> / <kbd className="text-slate-300">]</kbd> to set the loop start/end at the
                playhead, or drag the pins
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">3.</span>
              <span>Scroll to zoom in for precision — the pins stay locked to their exact seconds</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">4.</span>
              <span>
                <kbd className="text-slate-300">Space</kbd> plays and loops the selection
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">5.</span>
              <span>"Add to List" saves loops for batch export as WAV or MP3</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
