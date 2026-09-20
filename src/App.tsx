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
  'rgba(99, 102, 241, 0.3)',
  'rgba(16, 185, 129, 0.3)',
  'rgba(245, 158, 11, 0.3)',
  'rgba(239, 68, 68, 0.3)',
  'rgba(168, 85, 247, 0.3)',
  'rgba(6, 182, 212, 0.3)',
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
  const [loopPending, setLoopPending] = useState(true);
  const loopPendingRef = useRef(true);
  const [, forceUpdate] = useState(0);

  const waveformRef = useRef<HTMLDivElement>(null);
  const waveformContainerRef = useRef<HTMLDivElement>(null);
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

  // Keep loopPendingRef in sync with state
  useEffect(() => {
    loopPendingRef.current = loopPending;
  }, [loopPending]);

  const initWaveSurfer = useCallback(async (file: File) => {
    // Clean up previous instance
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

    // Read file as ArrayBuffer
    let rawBuffer: ArrayBuffer;
    try {
      rawBuffer = await file.arrayBuffer();
    } catch (err) {
      console.error('Failed to read file:', err);
      showNotification('Failed to read audio file');
      return;
    }

    // IMPORTANT: decodeAudioData detaches the ArrayBuffer, so we need a copy for wavesurfer
    const bufferCopy = rawBuffer.slice(0);

    // Decode audio file to get AudioBuffer for export
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await audioContext.decodeAudioData(rawBuffer);
    } catch (err) {
      console.error('Failed to decode audio:', err);
      showNotification('Failed to decode audio file. The format may not be supported by your browser.');
      return;
    }
    audioBufferRef.current = audioBuffer;

    // Create blob for wavesurfer from the copy
    // Determine MIME type from file or extension
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

    // Create wavesurfer instance
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
      interact: true, // Enable click-to-seek
    });

    const regionsPlugin = RegionsPlugin.create();
    ws.registerPlugin(regionsPlugin);
    regionsPluginRef.current = regionsPlugin;

    // Enable drag selection for creating regions
    regionsPlugin.enableDragSelection({
      color: 'rgba(250, 204, 21, 0.3)', // Yellow for pending
    });

    // Timeout to detect stuck loading
    const loadTimeout = setTimeout(() => {
      if (!wavesurferRef.current) return;
      const dur = wavesurferRef.current.getDuration();
      if (dur === 0) {
        console.error('Loading timeout - wavesurfer did not become ready');
        showNotification('Audio loading timed out. The file may be too large or corrupted.');
      }
    }, 15000);

    // Event handlers
    ws.on('ready', () => {
      clearTimeout(loadTimeout);
      setIsReady(true);
      setDuration(ws.getDuration());
    });

    ws.on('error', (err: unknown) => {
      clearTimeout(loadTimeout);
      console.error('WaveSurfer error:', err);
      showNotification('Error loading audio waveform. Try a different file.');
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('timeupdate', (time: number) => {
      setCurrentTime(time);
      
      // Loop pending region if enabled
      const pending = pendingRegionRef.current;
      if (pending && loopPendingRef.current && ws.isPlaying()) {
        // If we've reached or passed the end of the pending region, seek back to start
        if (time >= pending.end - 0.01) {
          ws.setTime(pending.start);
        }
      }
    });

    // When a region is created via drag, store it as pending
    regionsPlugin.on('region-created', (region) => {
      const pending: PendingRegion = {
        start: region.start,
        end: region.end,
      };
      setPendingRegion(pending);
      pendingRegionRef.current = pending;
      
      // Remove the region from wavesurfer (we'll manage it manually)
      setTimeout(() => region.remove(), 0);
    });

    wavesurferRef.current = ws;

    // Load the audio blob directly
    try {
      await ws.loadBlob(blob);
    } catch (err) {
      console.error('WaveSurfer loadBlob error:', err);
      showNotification('Failed to load audio into waveform');
    }
  }, [showNotification]);

  // Confirm pending region - add it to the list
  const confirmPendingRegion = useCallback(() => {
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
    showNotification('Region added to selection');
  }, [pendingRegion, showNotification]);

  // Cancel pending region
  const cancelPendingRegion = useCallback(() => {
    setPendingRegion(null);
    pendingRegionRef.current = null;
  }, []);

  // Update pending region start/end
  const updatePendingRegion = useCallback((start?: number, end?: number) => {
    if (!pendingRegionRef.current) return;
    
    const updated: PendingRegion = {
      start: start !== undefined ? Math.max(0, start) : pendingRegionRef.current.start,
      end: end !== undefined ? Math.min(duration, end) : pendingRegionRef.current.end,
    };
    
    // Ensure start < end
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

  // Pin drag handlers
  const handlePinDragStart = useCallback((pin: 'start' | 'end') => {
    setPinDragging(pin);
  }, []);

  const handlePinDrag = useCallback((e: MouseEvent) => {
    if (!pinDragging || !pendingRegionRef.current || !waveformContainerRef.current) return;
    
    const ws = wavesurferRef.current;
    if (!ws) return;
    
    const container = waveformContainerRef.current;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    
    // Calculate time from pixel position
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

  // Add event listeners for pin dragging
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

  // Scroll wheel zoom and scroll sync
  useEffect(() => {
    const container = waveformContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      const delta = e.deltaY > 0 ? -50 : 50;
      const newZoom = Math.max(0, Math.min(500, zoom + delta));
      setZoom(newZoom);
      
      if (wavesurferRef.current) {
        wavesurferRef.current.zoom(newZoom);
        // Force re-render to update pin positions after DOM updates
        setTimeout(() => {
          requestAnimationFrame(() => {
            forceUpdate(n => n + 1);
          });
        }, 100);
      }
    };

    // Sync pins when scrolling
    const handleScroll = () => {
      forceUpdate(n => n + 1);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('scroll', handleScroll);
    };
  }, [zoom]);

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
      
      // If there's a pending region and loop is enabled, play in loop
      if (pendingRegionRef.current && loopPendingRef.current) {
        const { start } = pendingRegionRef.current;
        
        // If currently playing, pause
        if (ws.isPlaying()) {
          ws.pause();
        } else {
          // Start playing from the pending region start (without end, so it doesn't auto-stop)
          ws.play(start);
        }
      } else {
        // Normal play/pause
        ws.playPause();
      }
    }
  }, []);

  const handleZoom = useCallback((value: number) => {
    setZoom(value);
    if (wavesurferRef.current) {
      wavesurferRef.current.zoom(value);
      // Force re-render to update pin positions after DOM updates
      // Use multiple frames to ensure DOM has fully updated
      setTimeout(() => {
        requestAnimationFrame(() => {
          forceUpdate(n => n + 1);
        });
      }, 100);
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

      // Extract and concatenate all regions
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

      // Download
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
      showNotification('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [regions, exportFormat, audioFile, showNotification]);

  // Cleanup on unmount
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

  // Calculate pin positions - relative to waveform content (not visible area)
  const getPinPosition = useCallback((time: number) => {
    if (!waveformContainerRef.current || !wavesurferRef.current) return 0;
    const container = waveformContainerRef.current;
    const totalWidth = container.scrollWidth;
    const duration = wavesurferRef.current.getDuration();
    const position = (time / duration) * totalWidth;
    return position;
  }, []);

  // Drop zone UI (when no file loaded)
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
      {/* Notification */}
      {notification && (
        <div className="fixed top-4 right-4 z-50 bg-indigo-600 text-white px-6 py-3 rounded-xl shadow-lg animate-pulse">
          {notification}
        </div>
      )}

      {/* Header */}
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
        {/* File info */}
        <div className="flex items-center gap-4 bg-slate-800/50 rounded-xl px-5 py-3 border border-slate-700/50">
          <svg className="w-5 h-5 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          <span className="font-medium truncate">{audioFile.name}</span>
          <span className="text-slate-400 text-sm ml-auto shrink-0">
            {(audioFile.size / (1024 * 1024)).toFixed(2)} MB
          </span>
        </div>

        {/* Waveform with pins */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-slate-300">Waveform</h2>
            <span className="text-xs text-slate-500">
              Drag on waveform to select • Scroll to zoom • Drag pins to adjust
            </span>
          </div>
          
          {/* Pins overlay - positioned above waveform but synced with scroll */}
          {pendingRegion && isReady && (
            <div 
              className="relative h-8 mb-2 overflow-hidden"
              style={{ 
                width: waveformContainerRef.current?.clientWidth || '100%',
              }}
            >
              {/* Pins container - matches waveform content width */}
              <div 
                className="absolute top-0 h-full"
                style={{ 
                  width: waveformContainerRef.current?.scrollWidth || '100%',
                  transform: `translateX(-${waveformContainerRef.current?.scrollLeft || 0}px)`,
                }}
              >
                {/* Start pin */}
                <div
                  className="absolute top-0 w-6 h-8 cursor-ew-resize select-none"
                  style={{ left: `${getPinPosition(pendingRegion.start) - 12}px` }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handlePinDragStart('start');
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
                  className="absolute top-0 w-6 h-8 cursor-ew-resize select-none"
                  style={{ left: `${getPinPosition(pendingRegion.end) - 12}px` }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handlePinDragStart('end');
                  }}
                >
                  <div className="w-0.5 h-full bg-yellow-400 mx-auto" />
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-4 bg-yellow-400 rounded-full shadow-lg hover:bg-yellow-300 transition-colors" />
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-mono text-yellow-400 whitespace-nowrap">
                    {formatTime(pendingRegion.end)}
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <div
            ref={waveformContainerRef}
            className="relative rounded-lg overflow-x-auto overflow-y-hidden bg-slate-900/50"
            onScroll={() => forceUpdate(n => n + 1)}
          >
            <div
              ref={waveformRef}
              className="min-w-full"
            />
            {/* Pending region highlight overlay */}
            {pendingRegion && isReady && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none bg-yellow-400/20 border-l-2 border-r-2 border-yellow-400/50"
                style={{
                  left: `${getPinPosition(pendingRegion.start)}px`,
                  width: `${getPinPosition(pendingRegion.end) - getPinPosition(pendingRegion.start)}px`,
                  height: '100%',
                }}
              />
            )}
          </div>
          
          {!isReady && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
              <span className="ml-3 text-slate-400">Loading audio...</span>
            </div>
          )}
        </div>

        {/* Pending region controls */}
        {pendingRegion && isReady && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-yellow-400 mb-1">Pending Region</h3>
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
                  onClick={confirmPendingRegion}
                  className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-semibold text-sm rounded-lg transition-colors"
                >
                  Add to Selection
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Play/Pause */}
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

            {/* Loop toggle */}
            {pendingRegion && (
              <button
                onClick={() => setLoopPending(!loopPending)}
                className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${
                  loopPending
                    ? 'bg-yellow-500 hover:bg-yellow-400 text-slate-900'
                    : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                }`}
                title={loopPending ? 'Loop enabled - click to disable' : 'Loop disabled - click to enable'}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            )}

            {/* Time display */}
            <div className="flex items-center gap-2 font-mono text-sm">
              <span className="text-indigo-300">{formatTime(currentTime)}</span>
              <span className="text-slate-500">/</span>
              <span className="text-slate-400">{formatTime(duration)}</span>
            </div>

            {/* Zoom slider */}
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

          {/* Progress bar */}
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

        {/* Regions */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-slate-300">
              Selected Regions ({regions.length})
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
              <p className="text-sm">Drag on the waveform to create a region</p>
              <p className="text-xs mt-1 text-slate-600">Then adjust with pins and click "Add to Selection"</p>
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
                    style={{ backgroundColor: region.color.replace('0.3', '1') }}
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

        {/* Export */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
          <h2 className="text-sm font-medium text-slate-300 mb-4">Export</h2>
          <div className="flex flex-wrap items-center gap-4">
            {/* Format selection */}
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

            {/* Export button */}
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

        {/* Instructions */}
        <div className="bg-slate-800/30 rounded-xl border border-slate-700/30 p-4">
          <h3 className="text-sm font-medium text-slate-400 mb-3">How to use</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs text-slate-500">
            <div className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">1.</span>
              <span>Drag on the waveform to create a selection region</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">2.</span>
              <span>Use the yellow pins above to fine-tune the boundaries</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">3.</span>
              <span>Click "Add to Selection" to confirm the region</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">4.</span>
              <span>Scroll wheel zooms, then export as WAV or MP3</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
