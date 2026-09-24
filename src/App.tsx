import { useState, useRef, useCallback, useEffect, useMemo, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import WaveSurfer from 'wavesurfer.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js';
import { LayoutGrid, AlertTriangle, Upload, Timer } from 'lucide-react';
import {
  encodeWAV,
  encodeMP3,
  extractRegion,
  formatTime,
  findZeroCrossing,
  applyEdgeFades,
  applyFades,
  normalizeBuffer,
  loopFileName,
  slugifyName,
  downloadBlob,
} from './utils/audioExport';
import { createZipAsync } from './utils/zip';
import { detectBpm, type BpmDetection } from './utils/bpmDetect';
import {
  REGION_COLORS,
  MIN_LOOP,
  MAX_ZOOM,
  NUDGE,
  FADE,
  clamp,
  PREFS_KEY,
  regionsKey,
  DEFAULT_PREFS,
  LOAD_STAGE_LABEL,
  LOAD_ERROR_INFO,
  AUDIO_EXT_RE,
  alphaColor,
} from './constants';
import type {
  RegionInfo,
  LoopRange,
  ExportFormat,
  ExportMode,
  Prefs,
  LoadStage,
  LoadError,
  Toast,
  ToastAction,
  ExportState,
  SlotKey,
} from './types/models';
import Header from './components/Header';
import FileDropZone from './components/FileDropZone';
import FileInfo from './components/FileInfo';
import LoopPin from './components/LoopPin';
import LoopPanel from './components/LoopPanel';
import PlaybackBar from './components/PlaybackBar';
import SavedLoops from './components/SavedLoops';
import ExportPanel from './components/ExportPanel';
import ShortcutsModal from './components/ShortcutsModal';
import Toasts from './components/Toasts';

/** Time ruler label: m:ss everywhere (matches classic audio editors). */
function formatRulerTime(seconds: number): string {
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function loadPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}

const savedPrefs: Prefs = { ...DEFAULT_PREFS, ...loadPrefs() };

/** Full-screen drop feedback (events bubble to the app root handlers). */
function DropOverlay() {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#05070f]/80 p-6 backdrop-blur-md"
      aria-hidden
    >
      <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-indigo-400/70 bg-indigo-500/10 px-10 py-12 text-center">
        <Upload size={36} className="text-indigo-300" />
        <p className="text-lg font-bold text-white">Drop audio to load</p>
        <p className="text-sm leading-relaxed text-slate-400">
          Replaces the current file. Your saved loops are kept separately for each file.
        </p>
      </div>
    </div>
  );
}

function App() {
  // ---- File / playback state ---------------------------------------------
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [zoom, setZoom] = useState(0); // px per second; 0 = fit to width
  const [waveHeight, setWaveHeight] = useState(180);

  // ---- Editing state -------------------------------------------------------
  const [loop, setLoop] = useState<LoopRange>({ start: 0, end: 0 });
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [grid, setGrid] = useState(savedPrefs.grid);
  const [bpm, setBpm] = useState(savedPrefs.bpm);
  const [gridSnap, setGridSnap] = useState(savedPrefs.gridSnap);
  const [bpmDetection, setBpmDetection] = useState<BpmDetection | null>(null);
  const [detectingBpm, setDetectingBpm] = useState(false);
  const [snap, setSnap] = useState(savedPrefs.snap);
  const [abSlots, setAbSlots] = useState<{ a: LoopRange | null; b: LoopRange | null }>({
    a: null,
    b: null,
  });
  const [activeSlot, setActiveSlot] = useState<SlotKey | null>(null);

  // ---- Saved loops ---------------------------------------------------------
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [playingRegionId, setPlayingRegionId] = useState<string | null>(null);

  // ---- Export --------------------------------------------------------------
  const [exportFormat, setExportFormat] = useState<ExportFormat>(savedPrefs.exportFormat);
  const [exportMode, setExportMode] = useState<ExportMode>(savedPrefs.exportMode);
  const [gapMs, setGapMs] = useState(savedPrefs.gapMs);
  const [fadeInMs, setFadeInMs] = useState(savedPrefs.fadeInMs);
  const [fadeOutMs, setFadeOutMs] = useState(savedPrefs.fadeOutMs);
  const [normalize, setNormalize] = useState(savedPrefs.normalize);
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });

  // ---- UI chrome -----------------------------------------------------------
  const [volume, setVolume] = useState(savedPrefs.volume);
  const [isFileDragging, setIsFileDragging] = useState(false);
  const [loadStage, setLoadStage] = useState<LoadStage | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [waveWrapper, setWaveWrapper] = useState<HTMLElement | null>(null);
  const [, setHistoryVersion] = useState(0);

  // ---- Refs ----------------------------------------------------------------
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
  const previewIdRef = useRef<string | null>(null);
  const snapRef = useRef(snap);
  const volumeRef = useRef(volume);
  const regionsRef = useRef<RegionInfo[]>([]);
  const gridRef = useRef(grid);
  const bpmRef = useRef(bpm);
  const bpmTouchedRef = useRef(false); // user set a BPM for the current file
  const bpmDetectionRef = useRef<BpmDetection | null>(null);
  const detectingBpmRef = useRef(false);
  const gridSnapRef = useRef(gridSnap);
  const focusedPinRef = useRef<'start' | 'end' | null>(null);
  const undoStackRef = useRef<LoopRange[]>([]);
  const redoStackRef = useRef<LoopRange[]>([]);
  const lastCheckpointRef = useRef(0);
  const toastIdRef = useRef(0);
  const dragEnterRef = useRef(0);

  // ---- Notifications -------------------------------------------------------
  const notify = useCallback(
    (message: string, kind: Toast['kind'] = 'info', action?: ToastAction) => {
      const id = ++toastIdRef.current;
      const wrapped: Toast = {
        id,
        kind,
        message,
        action: action
          ? {
              label: action.label,
              run: () => {
                action.run();
                setToasts((prev) => prev.filter((t) => t.id !== id));
              },
            }
          : undefined,
      };
      setToasts((prev) => [...prev.slice(-2), wrapped]);
      const ttl = kind === 'error' ? 6000 : action ? 7000 : 3200;
      window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ttl);
    },
    []
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ---- Persistence ----------------------------------------------------------
  useEffect(() => {
    const prefs: Prefs = {
      exportFormat,
      exportMode,
      gapMs,
      snap,
      volume,
      fadeInMs,
      fadeOutMs,
      normalize,
      grid,
      bpm,
      gridSnap,
    };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* storage may be unavailable */
    }
  }, [exportFormat, exportMode, gapMs, snap, volume, fadeInMs, fadeOutMs, normalize, grid, bpm, gridSnap]);

  const setRegionsAndPersist = useCallback(
    (updater: (prev: RegionInfo[]) => RegionInfo[]) => {
      setRegions((prev) => {
        const next = updater(prev);
        try {
          if (audioFile) {
            localStorage.setItem(regionsKey(audioFile.name, audioFile.size), JSON.stringify(next));
          }
        } catch {
          /* storage may be unavailable */
        }
        return next;
      });
    },
    [audioFile]
  );

  const handleUnload = useCallback((e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = '';
  }, []);

  useEffect(() => {
    if (regions.length === 0) return;
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [regions.length, handleUnload]);

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

  // ---- Loop-edit history (undo / redo) ---------------------------------------
  /** Snapshot the current selection before a change. Rapid repeats coalesce (450 ms). */
  const checkpointLoop = useCallback((coalesceMs = 450) => {
    const stack = undoStackRef.current;
    const cur = loopRef.current;
    const top = stack[stack.length - 1];
    const unchanged =
      top !== undefined &&
      Math.abs(top.start - cur.start) < 1e-6 &&
      Math.abs(top.end - cur.end) < 1e-6;
    const now = performance.now();
    if (!unchanged && (coalesceMs === 0 || now - lastCheckpointRef.current >= coalesceMs)) {
      stack.push({ ...cur });
      if (stack.length > 120) stack.shift();
      lastCheckpointRef.current = now;
    }
    if (redoStackRef.current.length > 0) redoStackRef.current = [];
    setHistoryVersion((v) => v + 1);
  }, []);

  const undoLoop = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    redoStackRef.current.push({ ...loopRef.current });
    const prev = stack.pop()!;
    lastCheckpointRef.current = 0;
    applyLoop(prev);
    setHistoryVersion((v) => v + 1);
  }, [applyLoop]);

  const redoLoop = useCallback(() => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    undoStackRef.current.push({ ...loopRef.current });
    const next = stack.pop()!;
    lastCheckpointRef.current = 0;
    applyLoop(next);
    setHistoryVersion((v) => v + 1);
  }, [applyLoop]);

  // ---- BPM detection ----------------------------------------------------------
  const runBpmDetection = useCallback(
    async (buffer: AudioBuffer, forceApply = false) => {
      if (detectingBpmRef.current) return;
      detectingBpmRef.current = true;
      setDetectingBpm(true);
      try {
        // Yield a frame so the UI never stalls while analyzing.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (audioBufferRef.current !== buffer) return; // file swapped mid-analysis
        const result = detectBpm(buffer);
        if (result) {
          bpmDetectionRef.current = result;
          setBpmDetection(result);
          // Manual clicks always apply; on load only apply if the user hasn't
          // already set a BPM for this file (covers edits made mid-analysis).
          if (forceApply || !bpmTouchedRef.current) {
            setBpm(clamp(Math.round(result.bpm), 20, 300));
            bpmTouchedRef.current = false;
            notify(`Detected ~${Math.round(result.bpm)} BPM — beat grid updated`);
          } else {
            notify(`Detected ~${Math.round(result.bpm)} BPM — your setting was kept`);
          }
        } else {
          bpmDetectionRef.current = null;
          setBpmDetection(null);
          notify('Could not detect a steady tempo — set the BPM manually');
        }
      } catch (err) {
        console.error('BPM detection failed:', err);
      } finally {
        detectingBpmRef.current = false;
        setDetectingBpm(false);
      }
    },
    [notify]
  );

  // ---- WaveSurfer lifecycle --------------------------------------------------
  const initWaveSurfer = useCallback(
    async (file: File) => {
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
        wavesurferRef.current = null;
      }
      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch {
          /* already closed */
        }
        audioContextRef.current = null;
      }

      // Shorter waveform on phones keeps the editor usable on small screens
      const waveH = typeof window !== 'undefined' && window.innerWidth < 640 ? 140 : 200;
      setWaveHeight(waveH);

      setIsReady(false);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      durationRef.current = 0;
      setZoom(0);
      zoomRef.current = 0;
      setWaveWrapper(null);
      setLoadError(null);
      setLoadStage('reading');
      setExportState({ status: 'idle' });
      setBpmDetection(null);
      bpmDetectionRef.current = null;
      setDetectingBpm(false);
      bpmTouchedRef.current = false;
      setPlayingRegionId(null);
      previewRef.current = null;
      previewIdRef.current = null;
      undoStackRef.current = [];
      redoStackRef.current = [];
      setHistoryVersion((v) => v + 1);

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      let rawBuffer: ArrayBuffer;
      try {
        rawBuffer = await file.arrayBuffer();
      } catch (err) {
        console.error('Failed to read file:', err);
        setLoadStage(null);
        setLoadError({ kind: 'read' });
        notify(LOAD_ERROR_INFO.read.message, 'error');
        return;
      }

      const bufferCopy = rawBuffer.slice(0);
      setLoadStage('decoding');

      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await audioContext.decodeAudioData(rawBuffer);
      } catch (err) {
        console.error('Failed to decode audio:', err);
        setLoadStage(null);
        setLoadError({ kind: 'corrupt', detail: err instanceof Error ? err.message : String(err) });
        notify(LOAD_ERROR_INFO.corrupt.message, 'error');
        return;
      }
      audioBufferRef.current = audioBuffer;
      durationRef.current = audioBuffer.duration;

      let mimeType = file.type;
      if (!mimeType || mimeType === '') {
        const ext = file.name.split('.').pop()?.toLowerCase();
        const mimeMap: Record<string, string> = {
          mp3: 'audio/mpeg',
          wav: 'audio/wav',
          ogg: 'audio/ogg',
          flac: 'audio/flac',
          m4a: 'audio/mp4',
          aac: 'audio/aac',
          webm: 'audio/webm',
        };
        mimeType = mimeMap[ext || ''] || 'audio/mpeg';
      }
      const blob = new Blob([bufferCopy], { type: mimeType });
      void volumeRef.current; // volume is applied right after creation below

      setLoadStage('rendering');
      const ws = WaveSurfer.create({
        container: waveformRef.current!,
        waveColor: '#7c86f7',
        progressColor: '#22d3ee',
        cursorColor: '#f8fafc',
        cursorWidth: 2,
        height: waveH,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
        interact: true,
        plugins: [
          TimelinePlugin.create({
            height: 26,
            style: {
              color: '#6d7c9c',
              fontSize: '11px',
              borderTop: '1px solid rgba(148,163,184,0.10)',
            },
            formatTimeCallback: formatRulerTime,
          }),
        ],
      });
      ws.setVolume(volumeRef.current);

      const loadTimeout = setTimeout(() => {
        if (!wavesurferRef.current) return;
        if (wavesurferRef.current.getDuration() === 0) {
          setLoadStage(null);
          setLoadError({ kind: 'timeout' });
          notify(LOAD_ERROR_INFO.timeout.message, 'error');
        }
      }, 15000);

      ws.on('ready', () => {
        clearTimeout(loadTimeout);
        const dur = ws.getDuration();
        durationRef.current = dur;
        setDuration(dur);
        // Selection starts at the full track
        applyLoop({ start: 0, end: dur });
        loopEnabledRef.current = true;
        setLoopEnabled(true);
        setWaveWrapper(ws.getWrapper());
        setLoadStage(null);
        setIsReady(true);
      });

      ws.on('error', (err: unknown) => {
        clearTimeout(loadTimeout);
        console.error('WaveSurfer error:', err);
        setLoadStage(null);
        setLoadError({
          kind: 'corrupt',
          detail: err instanceof Error ? err.message : typeof err === 'string' ? err : undefined,
        });
        notify(LOAD_ERROR_INFO.corrupt.message, 'error');
      });

      ws.on('play', () => setIsPlaying(true));
      ws.on('pause', () => {
        setIsPlaying(false);
        previewRef.current = null;
        previewIdRef.current = null;
        setPlayingRegionId(null);
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
        // Tempo detection is cheap (no deps, everything stays local). It runs
        // after the waveform is up, so a ~50 ms analysis never delays first paint.
        void runBpmDetection(audioBuffer);
      } catch (err) {
        console.error('WaveSurfer loadBlob error:', err);
        clearTimeout(loadTimeout);
        setLoadStage(null);
        setLoadError({ kind: 'corrupt', detail: err instanceof Error ? err.message : undefined });
        notify('Failed to load audio.', 'error');
      }
    },
    [applyLoop, notify, runBpmDetection]
  );

  // ---- File handling ---------------------------------------------------------
  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith('audio/') && !AUDIO_EXT_RE.test(file.name)) {
        notify(
          `“${file.name}” doesn't look like an audio file. Supported: MP3, WAV, OGG, FLAC, M4A, AAC, WebM.`,
          'error'
        );
        return;
      }
      setAudioFile(file);
      setRegions([]);
      setRenamingId(null);
      setAbSlots({ a: null, b: null });
      setActiveSlot(null);
      void initWaveSurfer(file);
      // Restore previously saved loops for this exact file
      try {
        const raw = localStorage.getItem(regionsKey(file.name, file.size));
        const list: RegionInfo[] = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list) && list.length > 0) {
          setRegions(list);
          colorCounterRef.current = list.length;
          notify(`Restored ${list.length} saved loop${list.length !== 1 ? 's' : ''}`);
        }
      } catch {
        /* ignore malformed storage */
      }
    },
    [initWaveSurfer, notify]
  );

  const clearFile = useCallback(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
      wavesurferRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {
        /* already closed */
      }
      audioContextRef.current = null;
    }
    audioBufferRef.current = null;
    setAudioFile(null);
    setIsReady(false);
    setIsPlaying(false);
    setRegions([]);
    setWaveWrapper(null);
    setCurrentTime(0);
    setDuration(0);
    durationRef.current = 0;
    setZoom(0);
    zoomRef.current = 0;
    setLoadStage(null);
    setLoadError(null);
    setExportState({ status: 'idle' });
    setLoop({ start: 0, end: 0 });
    loopRef.current = { start: 0, end: 0 };
    setLoopEnabled(true);
    loopEnabledRef.current = true;
    setRenamingId(null);
    setPlayingRegionId(null);
    setAbSlots({ a: null, b: null });
    setActiveSlot(null);
    setBpmDetection(null);
    bpmDetectionRef.current = null;
    setDetectingBpm(false);
    bpmTouchedRef.current = false;
    colorCounterRef.current = 0;
    previewRef.current = null;
    previewIdRef.current = null;
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryVersion((v) => v + 1);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // ---- Drag & drop (handled once at the root; children just reflect state) ----
  const handleDragEnter = useCallback((e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragEnterRef.current += 1;
    setIsFileDragging(true);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragEnterRef.current = Math.max(0, dragEnterRef.current - 1);
    if (dragEnterRef.current === 0) setIsFileDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      dragEnterRef.current = 0;
      setIsFileDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const browse = useCallback(() => fileInputRef.current?.click(), []);

  // ---- Loop editing ----------------------------------------------------------
  const quantizeToGrid = useCallback((t: number) => {
    if (!gridSnapRef.current || !gridRef.current || durationRef.current <= 0) return t;
    const beat = 60 / clamp(bpmRef.current, 20, 300);
    return clamp(Math.round(t / beat) * beat, 0, durationRef.current);
  }, []);

  const handlePinPointerDown = useCallback(
    (side: 'start' | 'end', e: PointerEvent) => {
      const el = e.currentTarget as HTMLElement;
      e.preventDefault();
      checkpointLoop(0); // every new drag is its own undo step
      focusedPinRef.current = side;
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
        const raw = clamp(((ev.clientX - rect.left) / rect.width) * dur, 0, dur);
        const t = quantizeToGrid(raw);
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
        // Snap to the nearest zero-crossing on release for click-free loops
        if (snapRef.current) {
          const ws = wavesurferRef.current;
          const buf = audioBufferRef.current;
          if (ws && buf) {
            const { start, end } = loopRef.current;
            const s2 = findZeroCrossing(buf, start);
            const e2 = findZeroCrossing(buf, end);
            if (e2 - s2 >= MIN_LOOP) applyLoop({ start: s2, end: e2 });
          }
        }
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    },
    [applyLoop, checkpointLoop, quantizeToGrid]
  );

  const handlePinFocus = useCallback((side: 'start' | 'end') => {
    focusedPinRef.current = side;
  }, []);

  const handlePinBlur = useCallback((side: 'start' | 'end') => {
    if (focusedPinRef.current === side) focusedPinRef.current = null;
  }, []);

  const setStartAtPlayhead = useCallback(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    checkpointLoop();
    const t = ws.getCurrentTime();
    const { end } = loopRef.current;
    applyLoop({ start: clamp(t, 0, Math.max(0, end - MIN_LOOP)), end });
  }, [applyLoop, checkpointLoop]);

  const setEndAtPlayhead = useCallback(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    checkpointLoop();
    const t = ws.getCurrentTime();
    const { start } = loopRef.current;
    applyLoop({ start, end: clamp(t, start + MIN_LOOP, durationRef.current) });
  }, [applyLoop, checkpointLoop]);

  const resetLoop = useCallback(() => {
    if (durationRef.current <= 0) return;
    checkpointLoop();
    applyLoop({ start: 0, end: durationRef.current });
  }, [applyLoop, checkpointLoop]);

  const toggleLoopEnabled = useCallback(() => {
    const next = !loopEnabledRef.current;
    loopEnabledRef.current = next;
    setLoopEnabled(next);
  }, []);

  // ---- A/B selection slots ----------------------------------------------------
  const handleSlot = useCallback(
    (key: SlotKey, store: boolean) => {
      const slot = abSlots[key];
      if (store || !slot) {
        checkpointLoop(150);
        const range = { ...loopRef.current };
        setAbSlots((prev) => ({ ...prev, [key]: range }));
        setActiveSlot(key);
        notify(`Selection stored in slot ${key.toUpperCase()}`, 'success');
        return;
      }
      checkpointLoop(150);
      applyLoop(slot);
      setActiveSlot(key);
      const ws = wavesurferRef.current;
      if (ws?.isPlaying()) ws.setTime(slot.start);
    },
    [abSlots, applyLoop, checkpointLoop, notify]
  );

  // ---- Playback ---------------------------------------------------------------
  const togglePlay = useCallback(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    previewRef.current = null;
    previewIdRef.current = null;
    setPlayingRegionId(null);
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

  const seekTo = useCallback((t: number) => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    // Manual seeking cancels a saved-loop preview so wrapping can't yank the playhead back
    previewRef.current = null;
    previewIdRef.current = null;
    setPlayingRegionId(null);
    ws.setTime(clamp(t, 0, durationRef.current));
  }, []);

  // ---- Zoom (cursor-anchored) --------------------------------------------------
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

    const value = clamp(target, 0, MAX_ZOOM);
    ws.zoom(value);

    // Keep the audio moment under `anchorX` at the same on-screen position,
    // so loop markers and the feature you aim at stay put while zooming.
    if (value > 0) {
      const maxScroll = Math.max(0, scroll.scrollWidth - viewW);
      scroll.scrollLeft = clamp(anchorTime * value - anchorX, 0, maxScroll);
    }
    zoomRef.current = value;
    setZoom(value);
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const ws = wavesurferRef.current;
      if (!ws) return;
      const dur = ws.getDuration();
      if (!dur) return;
      const scroll = ws.getWrapper().parentElement as HTMLElement | null;
      if (!scroll) return;
      const fit = scroll.clientWidth / dur;
      const cur = zoomRef.current > 0 ? zoomRef.current : fit;
      const next = clamp(cur * factor, fit, MAX_ZOOM);
      if (next <= fit * 1.02) zoomTo(0);
      else zoomTo(next);
    },
    [zoomTo]
  );

  /** Absolute zoom from the slider: anything at/below fit collapses to fit (0). */
  const zoomSet = useCallback(
    (pxPerSec: number) => {
      const ws = wavesurferRef.current;
      if (!ws) return;
      const dur = ws.getDuration();
      if (!dur) return;
      const scroll = ws.getWrapper().parentElement as HTMLElement | null;
      const fit = scroll ? scroll.clientWidth / dur : 0;
      if (pxPerSec <= fit * 1.02) zoomTo(0);
      else zoomTo(pxPerSec);
    },
    [zoomTo]
  );

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
  }, [zoomTo, audioFile]);

  // ---- Saved regions -----------------------------------------------------------
  const addLoopToList = useCallback(() => {
    const { start, end } = loopRef.current;
    if (end - start < MIN_LOOP) return;
    const colorIdx = colorCounterRef.current % REGION_COLORS.length;
    colorCounterRef.current++;
    const newRegion: RegionInfo = {
      id: `region-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      start,
      end,
      color: REGION_COLORS[colorIdx],
    };
    setRegionsAndPersist((prev) => [...prev, newRegion]);
    setRenamingId(newRegion.id); // prompt for a real name right away
    notify('Loop added — give it a name', 'success');
  }, [setRegionsAndPersist, notify]);

  const playRegion = useCallback((regionId: string) => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const region = regionsRef.current.find((r) => r.id === regionId);
    if (!region) return;
    // Tapping Play on the loop that is already previewing stops it
    if (previewIdRef.current === regionId && ws.isPlaying()) {
      ws.pause();
      return;
    }
    // Preview this saved loop with its own wrap-around
    previewRef.current = { start: region.start, end: region.end };
    previewIdRef.current = regionId;
    setPlayingRegionId(regionId);
    ws.setTime(region.start);
    ws.play();
  }, []);

  const recallRegion = useCallback(
    (regionId: string) => {
      const region = regions.find((r) => r.id === regionId);
      const ws = wavesurferRef.current;
      if (!region || !ws) return;
      ws.pause();
      previewRef.current = null;
      previewIdRef.current = null;
      setPlayingRegionId(null);
      checkpointLoop(150);
      applyLoop({ start: region.start, end: region.end });
      setActiveSlot(null);
      if (!loopEnabledRef.current) toggleLoopEnabled();
      // Bring the loop start into view when zoomed in
      const scroll = ws.getWrapper().parentElement as HTMLElement | null;
      if (scroll && zoomRef.current > 0) {
        scroll.scrollLeft = clamp(
          region.start * zoomRef.current - scroll.clientWidth / 3,
          0,
          Math.max(0, scroll.scrollWidth - scroll.clientWidth)
        );
      }
    },
    [regions, applyLoop, checkpointLoop, toggleLoopEnabled]
  );

  const renameRegion = useCallback(
    (regionId: string, name: string) => {
      setRegionsAndPersist((prev) =>
        prev.map((r) => (r.id === regionId ? { ...r, name: name.trim() || undefined } : r))
      );
    },
    [setRegionsAndPersist]
  );

  const duplicateRegion = useCallback(
    (regionId: string) => {
      const idx = regionsRef.current.findIndex((r) => r.id === regionId);
      if (idx < 0) return;
      const src = regionsRef.current[idx];
      const colorIdx = colorCounterRef.current % REGION_COLORS.length;
      colorCounterRef.current++;
      const copy: RegionInfo = {
        id: `region-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        start: src.start,
        end: src.end,
        color: REGION_COLORS[colorIdx],
        name: src.name ? `${src.name} copy` : undefined,
      };
      setRegionsAndPersist((prev) => {
        const at = prev.findIndex((r) => r.id === regionId);
        if (at < 0) return prev;
        const next = [...prev];
        next.splice(at + 1, 0, copy);
        return next;
      });
      notify('Loop duplicated', 'success');
    },
    [setRegionsAndPersist, notify]
  );

  const removeRegion = useCallback(
    (regionId: string) => {
      const prev = regions;
      const idx = prev.findIndex((r) => r.id === regionId);
      if (idx < 0) return;
      const removed = prev[idx];
      setRegionsAndPersist((list) => list.filter((r) => r.id !== regionId));
      notify(`Deleted “${removed.name || `Loop ${idx + 1}`}”`, 'info', {
        label: 'Undo',
        run: () => setRegionsAndPersist(() => prev),
      });
    },
    [regions, setRegionsAndPersist, notify]
  );

  const moveRegion = useCallback(
    (regionId: string, dir: -1 | 1) => {
      setRegionsAndPersist((prev) => {
        const idx = prev.findIndex((r) => r.id === regionId);
        const target = idx + dir;
        if (idx < 0 || target < 0 || target >= prev.length) return prev;
        const next = [...prev];
        const [item] = next.splice(idx, 1);
        next.splice(target, 0, item);
        return next;
      });
    },
    [setRegionsAndPersist]
  );

  const clearAllRegions = useCallback(() => {
    if (regions.length === 0) return;
    const prev = regions;
    setRegionsAndPersist(() => []);
    notify(`Cleared ${prev.length} loop${prev.length !== 1 ? 's' : ''}`, 'info', {
      label: 'Undo',
      run: () => {
        setRegionsAndPersist(() => prev);
        colorCounterRef.current = Math.max(colorCounterRef.current, prev.length);
      },
    });
  }, [regions, setRegionsAndPersist, notify]);

  // ---- Derived render values -----------------------------------------------------
  const activeRegionId = useMemo(() => {
    const match = regions.find(
      (r) => Math.abs(r.start - loop.start) < 0.005 && Math.abs(r.end - loop.end) < 0.005
    );
    return match ? match.id : null;
  }, [regions, loop]);

  /** Adaptive beat grid: steps grow ×4 until line count stays manageable. */
  const gridLines = useMemo(() => {
    if (!grid || duration <= 0 || bpm <= 0) return [] as { pct: number; major: boolean }[];
    const beat = 60 / clamp(bpm, 20, 300);
    const bar = beat * 4;
    let step = beat;
    const maxLines = 480;
    while (duration / step > maxLines) step *= 4;
    const lines: { pct: number; major: boolean }[] = [];
    for (let i = 1; i * step <= duration && lines.length <= maxLines; i++) {
      const t = i * step;
      const bars = t / bar;
      const major = Math.abs(bars - Math.round(bars)) < 1e-6;
      lines.push({ pct: (t / duration) * 100, major });
    }
    return lines;
  }, [grid, duration, bpm]);

  // ---- Keyboard shortcuts --------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

      if (showShortcuts) {
        if (e.key === 'Escape') setShowShortcuts(false);
        return;
      }

      // History — only outside text fields so native field undo still works there
      if (!typing && (e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redoLoop();
        else undoLoop();
        return;
      }
      if (!typing && (e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redoLoop();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.key === '[') { setStartAtPlayhead(); return; }
      if (e.key === ']') { setEndAtPlayhead(); return; }
      if (e.key === 'l' || e.key === 'L') { toggleLoopEnabled(); return; }
      if (e.key === 'g' || e.key === 'G') { setGrid((v) => !v); return; }
      if (e.key === 'f' || e.key === 'F') { zoomTo(0); return; }
      if (e.key === 'm' || e.key === 'M') { addLoopToList(); return; }
      if (e.key === '?') { setShowShortcuts(true); return; }
      if (e.key === '1') { handleSlot('a', false); return; }
      if (e.key === '2') { handleSlot('b', false); return; }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const left = e.key === 'ArrowLeft';
        const pin = focusedPinRef.current;
        if (pin) {
          // A focused handle nudges itself (Shift = 100 ms steps)
          e.preventDefault();
          checkpointLoop(250);
          const step = e.shiftKey ? NUDGE * 10 : NUDGE;
          const { start, end } = loopRef.current;
          if (pin === 'start') {
            applyLoop({ start: clamp(start + (left ? -step : step), 0, end - MIN_LOOP), end });
          } else {
            applyLoop({
              start,
              end: clamp(end + (left ? -step : step), start + MIN_LOOP, durationRef.current),
            });
          }
          return;
        }
        const ws = wavesurferRef.current;
        if (!ws) return;
        e.preventDefault();
        const dur = durationRef.current;
        const { start, end } = loopRef.current;
        if (e.shiftKey) {
          // Shift extends: start moves left / end moves right
          checkpointLoop(250);
          if (left) applyLoop({ start: clamp(start - NUDGE, 0, end - MIN_LOOP), end });
          else applyLoop({ start, end: clamp(end + NUDGE, start + MIN_LOOP, dur) });
        } else if (e.altKey) {
          // Alt shrinks: end moves left / start moves right
          checkpointLoop(250);
          if (left) applyLoop({ start, end: clamp(end - NUDGE, start + MIN_LOOP, dur) });
          else applyLoop({ start: clamp(start + NUDGE, 0, end - MIN_LOOP), end });
        } else {
          ws.setTime(clamp(ws.getCurrentTime() + (left ? -NUDGE : NUDGE), 0, dur));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    showShortcuts,
    togglePlay,
    setStartAtPlayhead,
    setEndAtPlayhead,
    toggleLoopEnabled,
    zoomTo,
    addLoopToList,
    handleSlot,
    checkpointLoop,
    applyLoop,
    undoLoop,
    redoLoop,
  ]);

  // ---- Export --------------------------------------------------------------------
  const runExport = useCallback(
    async (list: { start: number; end: number; name?: string }[], suffix: string, format: ExportFormat) => {
      if (!audioBufferRef.current || !audioContextRef.current || list.length === 0) {
        notify('Nothing to export yet', 'info');
        return;
      }
      if (exportState.status === 'running') return;

      setExportState({ status: 'running', stage: 'Preparing…', progress: 0 });
      const setProgress = (stage: string, fraction: number) =>
        setExportState({ status: 'running', stage, progress: clamp(fraction, 0, 1) });

      try {
        const ctx = audioContextRef.current;
        const audioBuffer = audioBufferRef.current;
        const base = audioFile?.name?.replace(/\.[^.]+$/, '') || 'audio';

        /** Shared per-region processing: de-click, then optional user fades/normalize. */
        const processRegion = (regionBuffer: AudioBuffer) => {
          if (snapRef.current) applyEdgeFades(regionBuffer, FADE);
          if (fadeInMs > 0 || fadeOutMs > 0) {
            applyFades(regionBuffer, fadeInMs / 1000, fadeOutMs / 1000);
          }
          if (normalize) normalizeBuffer(regionBuffer);
        };

        const encodeOne = async (
          r: { start: number; end: number; name?: string },
          index: number,
          total: number
        ): Promise<Blob> => {
          const regionBuffer = await extractRegion(ctx, audioBuffer, r.start, r.end);
          processRegion(regionBuffer);

          if (format === 'wav') {
            return encodeWAV(regionBuffer, (f) => {
              setProgress(`Encoding ${index + 1}/${total}…`, (index + f) / total);
            });
          }
          return encodeMP3(regionBuffer, (f) => {
            setProgress(`Encoding ${index + 1}/${total}…`, (index + f) / total);
          });
        };

        if (exportMode === 'separate' && list.length > 1) {
          // One file per loop, indexed and zipped
          const files: { name: string; blob: Blob }[] = [];
          const used = new Set<string>();
          for (let i = 0; i < list.length; i++) {
            const blob = await encodeOne(list[i], i, list.length);
            let filename = `${loopFileName(i + 1, list[i].name, base, format)}.${format}`;
            let n = 2;
            while (used.has(filename)) {
              filename = `${loopFileName(i + 1, list[i].name, base, format)}_${n++}.${format}`;
            }
            used.add(filename);
            files.push({ name: filename, blob });
          }
          setProgress('Packing ZIP…', 1);
          const zip = await createZipAsync(files);
          downloadBlob(zip, `${base}_loops.zip`);
          const msg = `Exported ${files.length} files as ZIP`;
          setExportState({ status: 'done', message: msg });
          notify(msg, 'success');
        } else {
          // Single merged file, with optional silence between loops
          setProgress(list.length > 1 ? 'Merging loops…' : 'Encoding…', 0);
          const gapSamples = list.length > 1 ? Math.round((gapMs / 1000) * audioBuffer.sampleRate) : 0;
          // Must match extractRegion's sample math exactly: floor(end*sr) - floor(start*sr),
          // NOT floor((end-start)*sr) — the two can differ by 1 sample and overflow the copy.
          const totalLength =
            gapSamples * (list.length - 1) +
            list.reduce((acc, r) => {
              return (
                acc +
                Math.max(
                  0,
                  Math.floor(r.end * audioBuffer.sampleRate) - Math.floor(r.start * audioBuffer.sampleRate)
                )
              );
            }, 0);

          const outputBuffer = ctx.createBuffer(
            audioBuffer.numberOfChannels,
            totalLength,
            audioBuffer.sampleRate
          );

          let offset = 0;
          for (let i = 0; i < list.length; i++) {
            const r = list[i];
            const regionBuffer = await extractRegion(ctx, audioBuffer, r.start, r.end);
            processRegion(regionBuffer);
            for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
              const dst = outputBuffer.getChannelData(ch);
              const src = regionBuffer.getChannelData(ch);
              const len = Math.min(src.length, dst.length - offset);
              if (len > 0) dst.set(src.subarray(0, len), offset);
            }
            offset += regionBuffer.length + gapSamples;
          }

          let blob: Blob;
          if (format === 'wav') {
            blob = await encodeWAV(outputBuffer, (f) => setProgress('Encoding…', f));
          } else {
            blob = await encodeMP3(outputBuffer, (f) => setProgress('Encoding…', f));
          }

          // Name single exports after the loop when there's exactly one named loop
          let exportName = `${base}_${suffix}`;
          if (list.length === 1) {
            const slug = slugifyName(list[0].name);
            if (slug) exportName = slug;
          }
          downloadBlob(blob, `${exportName}.${format}`);
          const msg = `Exported ${exportName}.${format}`;
          setExportState({ status: 'done', message: msg });
          notify(msg, 'success');
        }
      } catch (err) {
        console.error('Export error:', err);
        const message =
          err instanceof Error && err.message ? err.message.slice(0, 140) : 'Export failed unexpectedly';
        setExportState({ status: 'error', message });
        notify(`Export failed — ${message}`, 'error');
      }
    },
    [audioFile, exportMode, gapMs, fadeInMs, fadeOutMs, normalize, exportState, notify]
  );

  const handleExportAll = useCallback(() => {
    if (regions.length === 0) {
      notify('Add at least one loop to the list first', 'info');
      return;
    }
    return runExport(
      regions.map((r) => ({ start: r.start, end: r.end, name: r.name })),
      'cut',
      exportFormat
    );
  }, [regions, exportFormat, runExport, notify]);

  const handleExportLoop = useCallback(() => {
    // If the current loop matches a saved one, export under that loop's name
    const saved = regionsRef.current.find(
      (r) => Math.abs(r.start - loop.start) < 0.005 && Math.abs(r.end - loop.end) < 0.005
    );
    return runExport([{ start: loop.start, end: loop.end, name: saved?.name }], 'loop', exportFormat);
  }, [loop, exportFormat, runExport]);

  // ---- Lifecycle & ref sync -------------------------------------------------------
  useEffect(() => {
    return () => {
      if (wavesurferRef.current) wavesurferRef.current.destroy();
      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch {
          /* already closed */
        }
      }
    };
  }, []);

  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);

  useEffect(() => {
    volumeRef.current = volume;
    wavesurferRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    regionsRef.current = regions;
  }, [regions]);

  useEffect(() => {
    gridRef.current = grid;
    bpmRef.current = bpm;
    gridSnapRef.current = gridSnap;
  }, [grid, bpm, gridSnap]);

  // ---- Render ------------------------------------------------------------------------
  const showPins = isReady && waveWrapper !== null && duration > 0;
  const errorInfo = loadError ? LOAD_ERROR_INFO[loadError.kind] : null;

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="audio/*"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) handleFileSelect(file);
        e.target.value = '';
      }}
    />
  );

  if (!audioFile) {
    return (
      <div
        className="flex min-h-screen flex-col"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Header onShortcuts={() => setShowShortcuts(true)} />
        <main className="flex flex-1 items-center justify-center px-4 py-10">
          <FileDropZone dragging={isFileDragging} onBrowse={browse} />
        </main>
        {fileInput}
        {isFileDragging && <DropOverlay />}
        <Toasts toasts={toasts} onDismiss={dismissToast} />
        <ShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Header onShortcuts={() => setShowShortcuts(true)} />

      <main className="mx-auto w-full max-w-[1440px] space-y-4 px-3 pb-28 pt-4 sm:space-y-5 sm:px-6 sm:pb-10 sm:pt-6">
        <FileInfo
          file={audioFile}
          duration={duration}
          isReady={isReady}
          loadStage={loadStage}
          loadError={loadError}
          onLoadNew={browse}
          onClear={clearFile}
        />

        {/* 02 · Waveform — the centerpiece */}
        <section className="panel px-3 py-3.5 sm:px-5 sm:py-4" aria-label="Waveform editor">
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="eyebrow">02 · Waveform</span>
            <span className="hidden text-xs text-slate-500 lg:inline">
              Click to place the playhead · drag the handles · scroll to zoom · double-click to fit
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setGrid((g) => !g)}
                aria-pressed={grid}
                title="Toggle the beat grid (G)"
                className={`btn !py-1.5 ${
                  grid ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-200' : 'text-slate-400'
                }`}
              >
                <LayoutGrid size={14} aria-hidden />
                Grid
              </button>
              {grid && (
                <label className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={20}
                    max={300}
                    step={1}
                    value={bpm}
                    onChange={(e) => {
                      setBpm(clamp(Number(e.target.value) || 120, 20, 300));
                      bpmTouchedRef.current = true;
                      bpmDetectionRef.current = null;
                      setBpmDetection(null);
                    }}
                    className="field field-mono w-16 text-right text-xs"
                    aria-label="Tempo in BPM for the beat grid"
                  />
                  <span className="font-mono text-[10px] text-slate-500">BPM</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (audioBufferRef.current) void runBpmDetection(audioBufferRef.current, true);
                    }}
                    disabled={!audioBufferRef.current || detectingBpm}
                    title={
                      bpmDetection
                        ? `Detected ~${Math.round(bpmDetection.bpm)} BPM — click to re-run`
                        : 'Estimate the tempo from the audio'
                    }
                    className="btn !py-1.5 text-slate-400"
                  >
                    <Timer size={14} aria-hidden />
                    {detectingBpm ? 'Detecting…' : 'Detect'}
                  </button>
                </label>
              )}
            </div>
          </div>

          <div
            ref={waveformRef}
            className="waveform-container relative overflow-x-auto overflow-y-hidden rounded-xl bg-[#070b19]/80 ring-1 ring-white/5"
            onDoubleClick={() => {
              // Zoomed: fit the view. Already fitted: reset the loop to the full track.
              if (zoomRef.current > 0) zoomTo(0);
              else resetLoop();
            }}
          >
            {showPins &&
              createPortal(
                <>
                  {/* Saved-loop overlays so coverage and overlaps are visible */}
                  {regions.map((r) => (
                    <div
                      key={`overlay-${r.id}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        height: waveHeight,
                        left: `${(r.start / duration) * 100}%`,
                        width: `${Math.max(0.1, ((r.end - r.start) / duration) * 100)}%`,
                        background: alphaColor(r.color, '0.16'),
                        borderTop: `2px solid ${alphaColor(r.color, '0.8')}`,
                        pointerEvents: 'none',
                        zIndex: 2,
                      }}
                    />
                  ))}

                  {/* Dim everything outside the selection so it pops */}
                  {loop.start > 0.02 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        height: waveHeight,
                        left: 0,
                        width: `${(loop.start / duration) * 100}%`,
                        background: 'rgba(4, 7, 18, 0.55)',
                        pointerEvents: 'none',
                        zIndex: 3,
                      }}
                    />
                  )}
                  {loop.end < duration - 0.02 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        height: waveHeight,
                        left: `${(loop.end / duration) * 100}%`,
                        right: 0,
                        background: 'rgba(4, 7, 18, 0.55)',
                        pointerEvents: 'none',
                        zIndex: 3,
                      }}
                    />
                  )}

                  {/* Active selection — cyan start edge, violet end edge (matches handles) */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      height: waveHeight,
                      left: `${(loop.start / duration) * 100}%`,
                      width: `${((loop.end - loop.start) / duration) * 100}%`,
                      boxSizing: 'border-box',
                      background: 'rgba(129, 140, 248, 0.13)',
                      borderLeft: '2px solid #38bdf8',
                      borderRight: '2px solid #a78bfa',
                      pointerEvents: 'none',
                      zIndex: 4,
                    }}
                  />

                  {/* Beat grid (adaptive density handled in gridLines) */}
                  {gridLines.map((line, i) => (
                    <div
                      key={`grid-${i}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        height: waveHeight,
                        left: `${line.pct}%`,
                        width: 1,
                        background: line.major
                          ? 'rgba(148, 163, 184, 0.30)'
                          : 'rgba(148, 163, 184, 0.12)',
                        pointerEvents: 'none',
                        zIndex: 5,
                      }}
                    />
                  ))}
                  <LoopPin
                    side="start"
                    time={loop.start}
                    duration={duration}
                    height={waveHeight}
                    onPointerDown={handlePinPointerDown}
                    onFocus={handlePinFocus}
                    onBlur={handlePinBlur}
                  />
                  <LoopPin
                    side="end"
                    time={loop.end}
                    duration={duration}
                    height={waveHeight}
                    onPointerDown={handlePinPointerDown}
                    onFocus={handlePinFocus}
                    onBlur={handlePinBlur}
                  />

                </>,
                waveWrapper
              )}

            {/* Friendly failure card — never a bare error */}
            {loadError && errorInfo && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#05070f]/92 p-5 backdrop-blur-sm">
                <div className="max-w-md text-center">
                  <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-rose-500/25 bg-rose-500/10">
                    <AlertTriangle size={20} className="text-rose-300" aria-hidden />
                  </div>
                  <h3 className="font-semibold text-slate-100">{errorInfo.title}</h3>
                  <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-slate-400">
                    {errorInfo.message}
                  </p>
                  {loadError.detail && (
                    <p className="mx-auto mt-2 max-w-sm break-all font-mono text-[10px] text-slate-600">
                      {loadError.detail}
                    </p>
                  )}
                  <button type="button" onClick={browse} className="btn btn-primary mt-4">
                    Choose another file
                  </button>
                </div>
              </div>
            )}

            {/* Loading overlay with the current stage */}
            {!isReady && !loadError && (
              <div
                className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#05070f]/85 backdrop-blur-[2px]"
                role="status"
                aria-live="polite"
              >
                <span className="spinner h-7 w-7 text-indigo-400" aria-hidden />
                <p className="text-sm font-medium text-slate-300">
                  {loadStage ? LOAD_STAGE_LABEL[loadStage] : 'Loading audio…'}
                </p>
                <p className="max-w-xs truncate px-4 text-xs text-slate-500">{audioFile.name}</p>
              </div>
            )}
          </div>

          {/* Keyboard hints — compact, scannable, hidden on tiny screens */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <kbd className="kbd">Click</kbd> move playhead
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="kbd">[</kbd>
              <kbd className="kbd">]</kbd> set start / end
            </span>
            <span className="hidden items-center gap-1.5 sm:flex">
              <kbd className="kbd">←</kbd>
              <kbd className="kbd">→</kbd> nudge
              <span className="text-slate-600">(Shift resize · Alt shrink)</span>
            </span>
            <span className="hidden items-center gap-1.5 md:flex">
              <kbd className="kbd">Scroll</kbd> zoom
            </span>
            <span className="hidden items-center gap-1.5 md:flex">
              <kbd className="kbd">Dbl-click</kbd> fit / reset loop
            </span>
            <button
              type="button"
              onClick={() => setShowShortcuts(true)}
              className="ml-auto hidden text-[11px] text-indigo-400 transition-colors hover:text-indigo-300 sm:block"
            >
              All shortcuts (?)
            </button>
          </div>

        </section>
        {/* 03 · Loop selection */}
        <LoopPanel
          loop={loop}
          duration={duration}
          snap={snap}
          gridSnap={gridSnap}
          gridOn={grid}
          onApplyLoop={(r) => {
            checkpointLoop();
            applyLoop(r);
          }}
          onSetStart={setStartAtPlayhead}
          onSetEnd={setEndAtPlayhead}
          onReset={resetLoop}
          onSnapChange={setSnap}
          onGridSnapChange={setGridSnap}
          onAdd={addLoopToList}
          onExport={handleExportLoop}
          exporting={exportState.status === 'running'}
          canUndo={undoStackRef.current.length > 0}
          canRedo={redoStackRef.current.length > 0}
          onUndo={undoLoop}
          onRedo={redoLoop}
          abSlots={abSlots}
          activeSlot={activeSlot}
          onSlot={handleSlot}
        />

        {/* 04 · Transport — sticky at the bottom on small screens */}
        <PlaybackBar
          isReady={isReady}
          isPlaying={isPlaying}
          onTogglePlay={togglePlay}
          currentTime={currentTime}
          duration={duration}
          onSeek={seekTo}
          volume={volume}
          onVolume={setVolume}
          loopEnabled={loopEnabled}
          onToggleLoop={toggleLoopEnabled}
          zoom={zoom}
          onZoomBy={zoomBy}
          onZoomSet={zoomSet}
          onFit={() => zoomTo(0)}
        />

        {/* 05 + 06 — saved loops beside export on wide screens */}
        <div className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-5">
          <SavedLoops
            className="xl:col-span-3"
            regions={regions}
            activeRegionId={activeRegionId}
            playingRegionId={playingRegionId}
            renamingId={renamingId}
            onRenamingChange={setRenamingId}
            onPlay={playRegion}
            onRecall={recallRegion}
            onRename={renameRegion}
            onDuplicate={duplicateRegion}
            onRemove={removeRegion}
            onMove={moveRegion}
            onClearAll={clearAllRegions}
          />
          <ExportPanel
            className="xl:col-span-2"
            format={exportFormat}
            onFormatChange={setExportFormat}
            mode={exportMode}
            onModeChange={setExportMode}
            gapMs={gapMs}
            onGapMsChange={setGapMs}
            fadeInMs={fadeInMs}
            onFadeInMsChange={setFadeInMs}
            fadeOutMs={fadeOutMs}
            onFadeOutMsChange={setFadeOutMs}
            normalize={normalize}
            onNormalizeChange={setNormalize}
            regions={regions}
            loop={loop}
            isReady={isReady}
            exportState={exportState}
            onExportLoop={handleExportLoop}
            onExportAll={handleExportAll}
          />
        </div>

        <footer className="pb-4 text-center text-[11px] text-slate-600">
          All processing happens locally in your browser — your audio never leaves this device.
        </footer>

      </main>
      {fileInput}
      {isFileDragging && <DropOverlay />}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
      <ShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />

    </div>
  );
}

export default App;
