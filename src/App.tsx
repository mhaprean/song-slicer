import { useState, useRef, useCallback, useEffect } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
import { encodeWAV, encodeMP3, extractRegion, formatTime } from './utils/audioExport';

interface RegionInfo {
  id: string;
  start: number;
  end: number;
  color: string;
}

interface PendingRegion {
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

function App() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [pendingRegion, setPendingRegion] = useState<PendingRegion | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav');
  const [notification, setNotification] = useState<string | null>(null);
  const [pinDragging, setPinDragging] = useState<'start' | 'end' | null>(null);

  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsPluginRef = useRef<RegionsPlugin | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const colorCounterRef = useRef(0);
  const pendingRegionRef = useRef<PendingRegion | null>(null);

  const showNotification = useCallback((msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
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
    setPendingRegion(null);
    pendingRegionRef.current = null;

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
      minPxPerSec: 1,
      interact: true,
    });

    const regionsPlugin = RegionsPlugin.create();
    ws.registerPlugin(regionsPlugin);
    regionsPluginRef.current = regionsPlugin;

    regionsPlugin.enableDragSelection({
      color: 'rgba(250, 204, 21, 0.3)',
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
      setIsReady(true);
      setDuration(ws.getDuration());
    });

    ws.on('error', (err: unknown) => {
      clearTimeout(loadTimeout);
      console.error('WaveSurfer error:', err);
      showNotification('Error loading audio');
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('timeupdate', (time: number) => {
      setCurrentTime(time);
      
      const pending = pendingRegionRef.current;
      if (pending && ws.isPlaying()) {
        if (time >= pending.end - 0.01) {
          ws.setTime(pending.start);
        }
      }
    });

    regionsPlugin.on('region-created', (region) => {
      const pending = { start: region.start, end: region.end };
      setPendingRegion(pending);
      pendingRegionRef.current = pending;
      setTimeout(() => region.remove(), 0);
    });

    wavesurferRef.current = ws;

    try {
      await ws.loadBlob(blob);
    } catch (err) {
      console.error('WaveSurfer loadBlob error:', err);
      showNotification('Failed to load audio');
    }
  }, [showNotification]);

  const addPendingRegion = useCallback(() => {
    if (!pendingRegion) return;
    
    const colorIdx = colorCounterRef.current % REGION_COLORS.length;
    colorCounterRef.current++;
    const color = REGION_COLORS[colorIdx];
    
    const newRegion: RegionInfo = {
      id: `region-${Date.now()}`,
      start: pendingRegion.start,
      end: pendingRegion.end,
      color,
    };
    
    setRegions(prev => [...prev, newRegion]);
    setPendingRegion(null);
    pendingRegionRef.current = null;
    showNotification('Selection added');
  }, [pendingRegion, showNotification]);

  const cancelPendingRegion = useCallback(() => {
    setPendingRegion(null);
    pendingRegionRef.current = null;
  }, []);

  const updatePendingRegion = useCallback((start?: number, end?: number) => {
    if (!pendingRegionRef.current) return;
    
    const updated: PendingRegion = {
      start: start !== undefined ? Math.max(0, start) : pendingRegionRef.current.start,
      end: end !== undefined ? Math.min(duration, end) : pendingRegionRef.current.end,
    };
    
    if (updated.start >= updated.end) {
      if (start !== undefined) {
        updated.start = updated.end - 0.01;
      } else {
        updated.end = updated.start + 0.01;
      }
    }
    
    pendingRegionRef.current = updated;
    setPendingRegion(updated);
  }, [duration]);

  const handlePinDragStart = useCallback((pin: 'start' | 'end') => {
    setPinDragging(pin);
  }, []);

  const handlePinDrag = useCallback((e: MouseEvent) => {
    if (!pinDragging || !pendingRegionRef.current || !waveformRef.current) return;
    
    const ws = wavesurferRef.current;
    if (!ws) return;
    
    const container = waveformRef.current;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    
    const scrollLeft = container.scrollLeft;
    const totalWidth = container.scrollWidth;
    const time = (x + scrollLeft) / totalWidth * ws.getDuration();
    
    if (pinDragging === 'start') {
      updatePendingRegion(time, undefined);
    } else {
      updatePendingRegion(undefined, time);
    }
  }, [pinDragging, updatePendingRegion]);

  const handlePinDragEnd = useCallback(() => {
    setPinDragging(null);
  }, []);

  useEffect(() => {
    if (pinDragging) {
      window.addEventListener('mousemove', handlePinDrag);
      window.addEventListener('mouseup', handlePinDragEnd);
      return () => {
        window.removeEventListener('mousemove', handlePinDrag);
        window.removeEventListener('mouseup', handlePinDragEnd);
      };
    }
  }, [pinDragging, handlePinDrag, handlePinDragEnd]);

  const handleFileSelect = useCallback((file: File) => {
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
    setPendingRegion(null);
    pendingRegionRef.current = null;
    initWaveSurfer(file);
  }, [initWaveSurfer, showNotification]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (wavesurferRef.current) {
      const ws = wavesurferRef.current;
      
      if (pendingRegionRef.current) {
        if (ws.isPlaying()) {
          ws.pause();
        } else {
          ws.play(pendingRegionRef.current.start);
        }
      } else {
        ws.playPause();
      }
    }
  }, []);

  const handleZoom = useCallback((value: number) => {
    setZoom(value);
    if (wavesurferRef.current) {
      wavesurferRef.current.zoom(value);
    }
  }, []);

  const playRegion = useCallback((regionId: string) => {
    const region = regions.find(r => r.id === regionId);
    if (region && wavesurferRef.current) {
      wavesurferRef.current.play(region.start, region.end);
    }
  }, [regions]);

  const removeRegion = useCallback((regionId: string) => {
    setRegions(prev => prev.filter(r => r.id !== regionId));
  }, []);

  const clearAllRegions = useCallback(() => {
    setRegions([]);
  }, []);

  const handleExport = useCallback(async () => {
    if (!audioBufferRef.current || !audioContextRef.current || regions.length === 0) {
      showNotification('Please select at least one region to export');
      return;
    }

    setIsExporting(true);

    try {
      const ctx = audioContextRef.current;
      const audioBuffer = audioBufferRef.current;

      const totalLength = regions.reduce((acc, r) => {
        return acc + Math.floor((r.end - r.start) * audioBuffer.sampleRate);
      }, 0);

      const outputBuffer = ctx.createBuffer(
        audioBuffer.numberOfChannels,
        totalLength,
        audioBuffer.sampleRate
      );

      let offset = 0;
      for (const region of regions) {
        const regionBuffer = await extractRegion(ctx, audioBuffer, region.start, region.end);
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
      let filename: string;

      if (exportFormat === 'wav') {
        blob = encodeWAV(outputBuffer);
        filename = `${audioFile?.name?.replace(/\.[^.]+$/, '') || 'audio'}_cut.wav`;
      } else {
        blob = await encodeMP3(outputBuffer);
        filename = `${audioFile?.name?.replace(/\.[^.]+$/, '') || 'audio'}_cut.mp3`;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showNotification(`Exported as ${exportFormat.toUpperCase()} successfully!`);
    } catch (err) {
      console.error('Export error:', err);
      showNotification('Export failed');
    } finally {
      setIsExporting(false);
    }
  }, [regions, exportFormat, audioFile, showNotification]);

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

  useEffect(() => {
    const container = waveformRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      const delta = e.deltaY > 0 ? -50 : 50;
      const newZoom = Math.max(0, Math.min(500, zoom + delta));
      setZoom(newZoom);
      
      if (wavesurferRef.current) {
        wavesurferRef.current.zoom(newZoom);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoom]);

  const getPinPosition = useCallback((time: number) => {
    if (!waveformRef.current || !wavesurferRef.current) return 0;
    const container = waveformRef.current;
    const totalWidth = container.scrollWidth;
    const duration = wavesurferRef.current.getDuration();
    return (time / duration) * totalWidth;
  }, []);

  if (!audioFile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
        <div
          className={`w-full max-w-2xl border-2 border-dashed rounded-2xl p-16 text-center transition-all duration-300 ${
            isDragging
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
          <p className="text-slate-400 mb-8 text-lg">
            Drop your audio file here to start cutting
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-indigo-500/25"
          >
            Browse Files
          </button>
          <p className="text-slate-500 mt-4 text-sm">
            Supports MP3, WAV, OGG, FLAC, M4A, AAC
          </p>
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
              setAudioFile(null);
              setIsReady(false);
              setRegions([]);
              setPendingRegion(null);
              pendingRegionRef.current = null;
              setCurrentTime(0);
              setDuration(0);
              setZoom(0);
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
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          <span className="font-medium truncate">{audioFile.name}</span>
          <span className="text-slate-400 text-sm ml-auto shrink-0">
            {(audioFile.size / (1024 * 1024)).toFixed(2)} MB
          </span>
        </div>

        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-slate-300">Waveform</h2>
            <span className="text-xs text-slate-500">
              Drag to select • Double-click to clear • Scroll to zoom • Drag pins to adjust
            </span>
          </div>
          
          <div
            ref={waveformRef}
            className="relative rounded-lg overflow-x-auto overflow-y-hidden bg-slate-900/50"
            onDoubleClick={() => {
              if (pendingRegion) {
                cancelPendingRegion();
                showNotification('Selection cleared');
              }
            }}
          >
            {/* Pins and highlight overlay - inside waveform container so they scroll/zoom with it */}
            {pendingRegion && isReady && (
              <>
                {/* Highlight overlay */}
                <div
                  className="absolute top-0 bottom-0 pointer-events-none bg-yellow-400/20 border-l-2 border-r-2 border-yellow-400/50"
                  style={{
                    left: `${getPinPosition(pendingRegion.start)}px`,
                    width: `${getPinPosition(pendingRegion.end) - getPinPosition(pendingRegion.start)}px`,
                    height: '100%',
                  }}
                />
                
                {/* Start pin */}
                <div
                  className="absolute top-0 w-6 h-8 cursor-ew-resize select-none z-10"
                  style={{ left: `${getPinPosition(pendingRegion.start) - 12}px` }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handlePinDragStart('start');
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <div className="w-0.5 h-full bg-yellow-400 mx-auto" />
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-4 bg-yellow-400 rounded-full shadow-lg hover:bg-yellow-300 transition-colors" />
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-mono text-yellow-400 whitespace-nowrap">
                    {formatTime(pendingRegion.start)}
                  </div>
                </div>
                
                {/* End pin */}
                <div
                  className="absolute top-0 w-6 h-8 cursor-ew-resize select-none z-10"
                  style={{ left: `${getPinPosition(pendingRegion.end) - 12}px` }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handlePinDragStart('end');
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <div className="w-0.5 h-full bg-yellow-400 mx-auto" />
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-4 bg-yellow-400 rounded-full shadow-lg hover:bg-yellow-300 transition-colors" />
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-mono text-yellow-400 whitespace-nowrap">
                    {formatTime(pendingRegion.end)}
                  </div>
                </div>
              </>
            )}
          </div>
          
          {!isReady && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
              <span className="ml-3 text-slate-400">Loading audio...</span>
            </div>
          )}
        </div>

        {pendingRegion && isReady && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-yellow-400 mb-1">Current Selection</h3>
                <p className="text-xs text-slate-400">
                  {formatTime(pendingRegion.start)} → {formatTime(pendingRegion.end)} 
                  <span className="ml-2 text-slate-500">
                    ({formatTime(pendingRegion.end - pendingRegion.start)})
                  </span>
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={cancelPendingRegion}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={addPendingRegion}
                  className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-semibold text-sm rounded-lg transition-colors"
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

            <div className="flex items-center gap-3 ml-auto">
              <span className="text-xs text-slate-400">Zoom</span>
              <input
                type="range"
                min="0"
                max="500"
                value={zoom}
                onChange={(e) => handleZoom(Number(e.target.value))}
                className="w-32 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <span className="text-xs text-slate-500 w-10">{zoom > 0 ? `${zoom}%` : 'Auto'}</span>
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
            <h2 className="text-sm font-medium text-slate-300">
              Saved Regions ({regions.length})
            </h2>
            {regions.length > 0 && (
              <button
                onClick={clearAllRegions}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Clear All
              </button>
            )}
          </div>

          {regions.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">Drag on the waveform to select a region</p>
              <p className="text-xs mt-1 text-slate-600">Drag pins to adjust, then click "Add to List"</p>
            </div>
          ) : (
            <div className="space-y-2">
              {regions.map((region, idx) => (
                <div
                  key={region.id}
                  className="flex items-center gap-3 bg-slate-900/50 rounded-lg px-4 py-3 border border-slate-700/30 hover:border-slate-600/50 transition-colors"
                >
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: region.color.replace('0.4', '1') }}
                  />
                  <span className="text-sm font-medium text-slate-300 w-8">#{idx + 1}</span>
                  <span className="font-mono text-xs text-slate-400">
                    {formatTime(region.start)} → {formatTime(region.end)}
                  </span>
                  <span className="text-xs text-slate-500 ml-2">
                    ({formatTime(region.end - region.start)})
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => playRegion(region.id)}
                      className="p-1.5 hover:bg-slate-700 rounded-md transition-colors"
                      title="Preview region"
                    >
                      <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => removeRegion(region.id)}
                      className="p-1.5 hover:bg-slate-700 rounded-md transition-colors"
                      title="Remove region"
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
                    exportFormat === 'wav'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  WAV
                </button>
                <button
                  onClick={() => setExportFormat('mp3')}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    exportFormat === 'mp3'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  MP3
                </button>
              </div>
            </div>

            <button
              onClick={handleExport}
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
                  Export {regions.length} Region{regions.length !== 1 ? 's' : ''}
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
              <span>Drag on waveform to select a region</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">2.</span>
              <span>Drag yellow pins to fine-tune boundaries</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">3.</span>
              <span>Click "Add to List" to save the selection</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">4.</span>
              <span>Double-click to clear current selection</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">5.</span>
              <span>Export as WAV or MP3</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
