/** Bass loudness over time, sampled at `rate` values per second, normalised to 0..1. */
export interface Envelope {
  rate: number;
  data: Float32Array;
}

/**
 * Decodes the file's audio once and extracts a punchy bass envelope.
 * Computed offline so preview and export react identically (and it works while muted).
 */
export async function buildEnvelope(file: File): Promise<Envelope | null> {
  try {
    const decodeCtx = new OfflineAudioContext(1, 1, 44100);
    const buf = await decodeCtx.decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / buf.numberOfChannels;
    }
    return envelopeFromSamples(mono, buf.sampleRate);
  } catch {
    return null;
  }
}

/** Pure analysis (shared by the browser and the MCP server): low-pass → RMS → normalise → attack/release. */
export function envelopeFromSamples(samples: Float32Array, sampleRate: number): Envelope | null {
  if (!samples.length) return null;
  const low = lowpass(samples, sampleRate, 160, 0.8);

  const rate = 60;
  const win = Math.max(1, Math.floor(sampleRate / rate));
  const n = Math.ceil(low.length / win);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const end = Math.min(low.length, (i + 1) * win);
    for (let j = i * win; j < end; j++) sum += low[j] * low[j];
    raw[i] = Math.sqrt(sum / Math.max(1, end - i * win));
  }
  const sorted = Float32Array.from(raw).sort();
  const p95 = sorted[Math.floor(n * 0.95)] || 1e-6;
  const floor = sorted[Math.floor(n * 0.3)] || 0;
  if (p95 - floor < 1e-5) return null; // silent track

  // instant attack, smooth release → reads as "hits"
  const data = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let v = (raw[i] - floor) / Math.max(1e-6, p95 - floor);
    v = Math.min(1, Math.max(0, v));
    v = Math.pow(v, 1.6);
    prev = v > prev ? v : prev * 0.86 + v * 0.14;
    data[i] = prev;
  }
  return { rate, data };
}

/** RBJ biquad low-pass. */
function lowpass(x: Float32Array, sr: number, freq: number, q: number): Float32Array {
  const w0 = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = (1 - cos) / 2 / a0, b1 = (1 - cos) / a0, b2 = b0;
  const a1 = (-2 * cos) / a0, a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i];
    y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

export function sampleEnvelope(env: Envelope | null | undefined, t: number): number {
  if (!env || !Number.isFinite(t)) return 0;
  const x = t * env.rate;
  const i = Math.floor(x);
  if (i < 0 || i >= env.data.length) return 0;
  const a = env.data[i];
  const b = env.data[Math.min(env.data.length - 1, i + 1)];
  return a + (b - a) * (x - i);
}

/** Onset times (seconds) of strong bass hits. Higher sensitivity → more beats, shorter minimum gap. */
export function detectBeats(env: Envelope | null, sensitivity: number): number[] {
  if (!env) return [];
  const d = env.data;
  const thr = 0.78 - sensitivity * 0.55;
  const minGap = Math.round(env.rate * (0.5 - sensitivity * 0.3));
  const beats: number[] = [];
  let last = -1e9;
  for (let i = 3; i < d.length - 1; i++) {
    const rise = d[i] - Math.min(d[i - 1], d[i - 2], d[i - 3]);
    if (d[i] >= thr && rise > 0.15 && d[i] >= d[i + 1] && i - last >= minGap) {
      beats.push(i / env.rate);
      last = i;
    }
  }
  return beats;
}

/** How many beats happened at or before time t (binary search). */
export function countBeats(beats: number[], t: number): number {
  let lo = 0, hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid + 1; else hi = mid;
  }
  return lo;
}
