/**
 * Hand-rolled tempo estimation — no dependencies.
 *
 * Pipeline:
 *   1. mono downmix → RMS energy envelope (512-sample hop)
 *   2. half-wave-rectified difference → onset-strength curve
 *   3. local-mean removal → loudness-agnostic novelty function
 *   4. autocorrelation over the 40–240 BPM lag range → raw period
 *   5. comb-filter scoring of octave/multiple candidates (with a log-normal
 *      tempo prior) → resolves half/double-tempo ambiguity
 *
 * Costs well under 100 ms for a 4-minute track, so it runs inline on load.
 */

const MIN_BPM = 40;
const MAX_BPM = 240;
const HOP = 512; // envelope resolution in samples
const MIN_DURATION = 8; // seconds — too short to establish a pulse
const MAX_ANALYSIS_SECONDS = 240; // cap the work on very long files

export interface BpmDetection {
  bpm: number;
  /** Peak-vs-average phase alignment of the winning grid (≈1 = no pulse). */
  confidence: number;
}

/** Estimate the tempo of a decoded AudioBuffer; null when nothing rhythmic stands out. */
export function detectBpm(buffer: AudioBuffer): BpmDetection | null {
  const { sampleRate, duration } = buffer;
  if (duration < MIN_DURATION || buffer.numberOfChannels === 0) return null;

  // Long files: analyze up to MAX_ANALYSIS_SECONDS starting 15% in (skips intro silence).
  const startSec =
    duration > MAX_ANALYSIS_SECONDS ? Math.min(duration * 0.15, duration - MAX_ANALYSIS_SECONDS) : 0;
  const startSample = Math.floor(startSec * sampleRate);
  const endSample = Math.min(buffer.length, startSample + Math.floor(MAX_ANALYSIS_SECONDS * sampleRate));
  const hopTime = HOP / sampleRate;

  const frames = Math.floor((endSample - startSample) / HOP);
  if (frames < 32) return null;

  // ---- 1. Mono RMS energy envelope ----------------------------------------
  const channelData: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channelData.push(buffer.getChannelData(c));
  const invChannels = 1 / channelData.length;
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sumSq = 0;
    const base = startSample + f * HOP;
    for (let i = 0; i < HOP; i++) {
      let sample = 0;
      for (let c = 0; c < channelData.length; c++) sample += channelData[c][base + i];
      sample *= invChannels;
      sumSq += sample * sample;
    }
    env[f] = Math.sqrt(sumSq / HOP);
  }

  // Silence gate — nothing measurable to find a pulse in.
  let meanEnv = 0;
  for (let f = 0; f < frames; f++) meanEnv += env[f];
  if (meanEnv / frames < 1e-4) return null;

  // ---- 2–3. Onset strength, then local-mean removal ------------------------
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const rise = env[f] - env[f - 1];
    if (rise > 0) flux[f] = rise; // attacks only — decays don't count
  }

  const novelty = new Float32Array(frames);
  const smoothSpan = Math.max(4, Math.round(0.5 / hopTime)); // ~0.5 s local window
  let windowSum = 0;
  for (let f = 0; f < frames; f++) {
    windowSum += flux[f];
    if (f >= smoothSpan) windowSum -= flux[f - smoothSpan];
    novelty[f] = Math.max(0, flux[f] - windowSum / Math.min(f + 1, smoothSpan));
  }

  // ---- 4. Autocorrelation over the tempo lag range --------------------------
  const minLag = Math.max(2, Math.round(60 / MAX_BPM / hopTime));
  const maxLag = Math.min(frames >> 1, Math.round(60 / MIN_BPM / hopTime));
  if (maxLag <= minLag + 4) return null;

  const acf = new Float32Array(maxLag + 1);
  let acfSum = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const limit = frames - lag;
    for (let i = 0; i < limit; i++) sum += novelty[i] * novelty[i + lag];
    acf[lag] = sum / limit; // normalize so long lags stay comparable
    acfSum += acf[lag];
  }
  const acfMean = acfSum / (maxLag - minLag + 1);

  let bestLag = 0;
  let bestAcf = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (acf[lag] > bestAcf) {
      bestAcf = acf[lag];
      bestLag = lag;
    }
  }
  // No clear periodicity — better to keep the manual BPM than guess.
  if (bestLag === 0 || acfMean <= 0 || bestAcf < acfMean * 1.5) return null;

  const rawBpm = 60 / (bestLag * hopTime);

  // ---- 5. Comb scoring resolves tempo-octave ambiguity -----------------------
  // The ACF peaks at every multiple of the true period; score each plausible
  // multiple (plus thirds) against the novelty curve and let a log-normal
  // tempo prior centered near 120 BPM break ties between them.
  const candidates = new Set<number>();
  for (const mult of [0.25, 1 / 3, 0.5, 2 / 3, 1, 1.5, 2, 3, 4]) {
    const bpm = rawBpm * mult;
    if (bpm >= MIN_BPM && bpm <= MAX_BPM) candidates.add(Math.round(bpm));
  }

  let bestBpm = 0;
  let bestWeighted = 0;
  let winnerConfidence = 0;
  for (const bpm of candidates) {
    const comb = combScore(novelty, 60 / bpm / hopTime);
    if (!comb) continue;
    const ratio = comb.best / comb.mean;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    if (ratio * prior > bestWeighted) {
      bestWeighted = ratio * prior;
      winnerConfidence = ratio;
      bestBpm = bpm;
    }
  }

  if (bestBpm === 0 || winnerConfidence < 1.25) return null;

  // Half/double tempo is inherently ambiguous; fold the winner into the
  // 70–180 band so the grid is never uselessly sparse (a 60 BPM ballad
  // reports 120) and only rarely needs a manual nudge.
  let folded = bestBpm;
  while (folded < 70) folded *= 2;
  while (folded >= 180) folded /= 2;

  return { bpm: folded, confidence: winnerConfidence };
}

/**
 * Average novelty along a beat grid of `periodFrames` over every phase,
 * plus the best single phase. The best/mean ratio is self-normalizing, so
 * dense and sparse novelty curves are comparable.
 */
export function combScore(
  novelty: Float32Array,
  periodFrames: number
): { best: number; mean: number } | null {
  const n = novelty.length;
  if (!(periodFrames >= 2) || n < periodFrames * 4) return null;

  const PHASES = 48;
  let best = 0;
  let total = 0;
  for (let s = 0; s < PHASES; s++) {
    const phase = (s / PHASES) * periodFrames;
    let sum = 0;
    let beats = 0;
    for (let t = phase; t < n; t += periodFrames) {
      const i = Math.round(t);
      // Small max-window so slight drift doesn't miss the onset.
      const lo = i > 0 ? i - 1 : 0;
      const hi = i < n - 1 ? i + 1 : n - 1;
      sum += Math.max(novelty[lo], novelty[i], novelty[hi]);
      beats++;
    }
    if (beats === 0) continue;
    const score = sum / beats;
    total += score;
    if (score > best) best = score;
  }
  const mean = total / PHASES;
  if (mean <= 0 || best <= 0) return null;
  return { best, mean };
}
