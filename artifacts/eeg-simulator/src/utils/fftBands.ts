/**
 * Shared frequency-band definitions and band-power DSP for the spectrum panels.
 *
 * Both the bottom FFT panel (one channel, vertical bars) and the right-side panel
 * (one horizontal strip per channel) must colour the same band the same way and
 * measure its power the same way, or the two views would disagree about the same
 * signal. Keeping the band list, colours, and the Goertzel band-power here is what
 * guarantees they don't drift apart.
 */

export type BandDef = {
  key: string;
  /** Full label for the legend, e.g. "Alpha (8-13 Hz)". */
  name: string;
  /** One-glyph label for compact per-row legends. */
  short: string;
  /** Bar colour, shared by every panel. */
  color: string;
  /** Band edges, Hz (inclusive of `lo`, up to `hi`). */
  lo: number;
  hi: number;
};

/**
 * The five standard clinical EEG bands. Alpha keeps the app's existing emerald so
 * the recolouring doesn't move the one band a learner is usually hunting for; the
 * other four take distinct, colour-blind-legible hues that read on the dark panel.
 */
export const FFT_BANDS: BandDef[] = [
  { key: 'delta', name: 'Delta (0.5-4 Hz)', short: 'δ', color: '#818cf8', lo: 0.5, hi: 4 },
  { key: 'theta', name: 'Theta (4-8 Hz)',   short: 'θ', color: '#22d3ee', lo: 4,   hi: 8 },
  { key: 'alpha', name: 'Alpha (8-13 Hz)',  short: 'α', color: '#34d399', lo: 8,   hi: 13 },
  { key: 'beta',  name: 'Beta (13-30 Hz)',  short: 'β', color: '#fbbf24', lo: 13,  hi: 30 },
  { key: 'gamma', name: 'Gamma (30-50 Hz)', short: 'γ', color: '#f87171', lo: 30,  hi: 50 },
];

/** Analysis epoch, in samples — 8 s at 250 Hz. See SpectrumPanel for the rationale. */
export const EPOCH_SAMPLES = 2000;

/** Single-frequency magnitude by the Goertzel algorithm (one O(N) pass per bin). */
export function goertzelMag(data: number[], sampleRate: number, targetFreq: number): number {
  const k = Math.floor(0.5 + (data.length * targetFreq) / sampleRate);
  const omega = (2 * Math.PI * k) / data.length;
  const cosine = Math.cos(omega);
  const coeff = 2 * cosine;
  let q1 = 0, q2 = 0;
  for (let i = 0; i < data.length; i++) {
    const q0 = coeff * q1 - q2 + data[i];
    q2 = q1;
    q1 = q0;
  }
  const mag2 = q1 * q1 + q2 * q2 - q1 * q2 * coeff;
  return Math.sqrt(mag2) / data.length;
}

/**
 * Band power: the sum of |X(f)|² over the band (power is amplitude squared), so a
 * narrow tall peak outweighs a wide flat shelf rather than band width dominating.
 * See SpectrumPanel's original note for why summing magnitude was wrong.
 */
export function calculateBandPower(
  data: number[], sampleRate: number, startFreq: number, endFreq: number,
): number {
  if (!data || data.length === 0) return 0;
  let power = 0;
  for (let f = startFreq; f <= endFreq; f += 0.5) {
    const m = goertzelMag(data, sampleRate, f);
    power += m * m;
  }
  return power;
}

/** Most-recent-epoch band powers for one channel's buffer, in FFT_BANDS order. */
export function channelBandPowers(channelData: number[], sampleRate = 250): number[] {
  if (!channelData || channelData.length === 0) return FFT_BANDS.map(() => 0);
  const epoch = channelData.length > EPOCH_SAMPLES
    ? channelData.slice(channelData.length - EPOCH_SAMPLES)
    : channelData;
  return FFT_BANDS.map(b => calculateBandPower(epoch, sampleRate, b.lo, b.hi));
}
