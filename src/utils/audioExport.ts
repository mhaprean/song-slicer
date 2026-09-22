// Audio export utilities for WAV and MP3 encoding

/** Find the nearest sample index where all channels cross ~zero (within `tolerance`). */
export function findZeroCrossing(
  audioBuffer: AudioBuffer,
  time: number,
  searchSeconds = 0.05,
  tolerance = 0.01
): number {
  const sr = audioBuffer.sampleRate;
  const center = Math.floor(time * sr);
  const radius = Math.max(1, Math.floor(searchSeconds * sr));
  const from = Math.max(0, center - radius);
  const to = Math.min(audioBuffer.length - 1, center + radius);

  let best = center;
  let bestDist = Infinity;
  for (let i = from; i <= to; i++) {
    let maxAbs = 0;
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const v = Math.abs(audioBuffer.getChannelData(ch)[i]);
      if (v > maxAbs) maxAbs = v;
    }
    if (maxAbs < tolerance) {
      const dist = Math.abs(i - center);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
  }
  return best / sr;
}

/** Apply a short linear fade at both edges of an AudioBuffer in place (de-click). */
export function applyEdgeFades(audioBuffer: AudioBuffer, seconds = 0.003): void {
  const n = Math.min(audioBuffer.length, Math.max(1, Math.floor(seconds * audioBuffer.sampleRate)));
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      const g = i / n;
      data[i] *= g;
      data[audioBuffer.length - 1 - i] *= g;
    }
  }
}

export async function encodeWAV(
  audioBuffer: AudioBuffer,
  onProgress?: (fraction: number) => void
): Promise<Blob> {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = audioBuffer.length * blockAlign;
  const bufferLength = 44 + dataLength;

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, bufferLength - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Interleave channels and write samples
  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }

  let offset = 44;
  const total = audioBuffer.length;
  const YIELD_EVERY = 1 << 19; // ~0.5M frames between yields (~10s of audio)
  for (let i = 0; i < total; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
    if (i % YIELD_EVERY === 0 && i > 0) {
      onProgress?.(i / total);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(1);

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export async function encodeMP3(
  audioBuffer: AudioBuffer,
  onProgress?: (fraction: number) => void
): Promise<Blob> {
  const lamejs = await import('lamejs');

  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const kbps = 192;

  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }

  // Convert float samples to 16-bit PCM
  function floatTo16Bit(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  }

  const blockSize = 1152;
  const Mp3Encoder = lamejs.Mp3Encoder;
  let mp3encoder: InstanceType<typeof Mp3Encoder>;

  if (numChannels === 1) {
    mp3encoder = new Mp3Encoder(1, sampleRate, kbps);
  } else {
    mp3encoder = new Mp3Encoder(2, sampleRate, kbps);
  }

  const left = floatTo16Bit(channels[0]);
  const right = numChannels > 1 ? floatTo16Bit(channels[1]) : floatTo16Bit(channels[0]);

  const mp3Data: Uint8Array[] = [];

  const totalBlocks = Math.ceil(left.length / blockSize);
  for (let i = 0, block = 0; i < left.length; i += blockSize, block++) {
    const leftChunk = left.subarray(i, i + blockSize);
    let mp3buf: Uint8Array;

    if (numChannels === 1) {
      mp3buf = mp3encoder.encodeBuffer(leftChunk);
    } else {
      const rightChunk = right.subarray(i, i + blockSize);
      mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    }

    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }

    // Yield to the UI every ~0.5s of audio so the browser can breathe
    if (onProgress && block % 20 === 0) {
      onProgress(block / totalBlocks);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const end = mp3encoder.flush();
  if (end.length > 0) {
    mp3Data.push(end);
  }
  onProgress?.(1);

  const totalLength = mp3Data.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of mp3Data) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return new Blob([result], { type: 'audio/mp3' });
}

export async function extractRegion(
  audioContext: AudioContext,
  audioBuffer: AudioBuffer,
  startTime: number,
  endTime: number
): Promise<AudioBuffer> {
  const startSample = Math.floor(startTime * audioBuffer.sampleRate);
  const endSample = Math.floor(endTime * audioBuffer.sampleRate);
  const length = endSample - startSample;

  if (length <= 0) {
    throw new Error('Invalid region: start must be before end');
  }

  const newBuffer = audioContext.createBuffer(
    audioBuffer.numberOfChannels,
    length,
    audioBuffer.sampleRate
  );

  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const sourceData = audioBuffer.getChannelData(ch);
    const targetData = newBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      targetData[i] = sourceData[startSample + i];
    }
  }

  return newBuffer;
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

/** Lowercase, filesystem-safe slug from a user-provided name. */
export function slugifyName(name: string | undefined | null): string {
  return (name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** "01_my-loop" style slug for export filenames. */
export function loopFileName(index: number, name: string | undefined, base: string, format: string): string {
  const slug = slugifyName(name);
  const parts = [String(index).padStart(2, '0'), slug || base];
  return parts.join('_');
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
