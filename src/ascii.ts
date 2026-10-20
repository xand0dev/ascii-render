/**
 * Where canvases come from. Defaults to the DOM; the MCP server swaps in a Node canvas (see mcp/platform.ts).
 */
export const platform = {
  createCanvas: (): HTMLCanvasElement => document.createElement('canvas'),
  fontReady: (font: string): boolean => document.fonts.check(font),
};

export type ColorMode = 'original' | 'mono' | 'duotone' | 'accent' | 'thermal';

export interface Settings {
  columns: number;
  charset: string;
  customChars: string;
  sortDensity: boolean;
  cellAspect: number;
  fontScale: number;
  fontWeight: string;
  contrast: number;
  brightness: number;
  gamma: number;
  invert: boolean;
  colorMode: ColorMode;
  saturation: number;
  colorNormalize: number;
  fg: string;
  duoA: string;
  duoB: string;
  accent: string;
  accentTolerance: number;
  bg: string;
  bgVideo: number;
  edges: boolean;
  edgeThreshold: number;
  noise: number;
  glow: number;
  glowRadius: number;
  scanlines: number;
  audioReact: number;
  glitch: number;
  decode: number;
  overlayText: string;
  overlaySize: number;
  overlayPos: string;
  overlayColor: string;
  font: string;
  rain: number;
  trails: number;
  motion: number;
}

/** Per-frame inputs that are not part of the look itself. */
export interface FrameFx {
  /** Seconds since the start of the clip (drives the decode intro and glitch timing). */
  time?: number;
  /** Bass level 0..1 at this moment (drives audio reactivity). */
  audio?: number;
  /** Source region to use (for 9:16 / 1:1 / … reframing). Defaults to the full frame. */
  crop?: { x: number; y: number; w: number; h: number };
}

export const DEFAULTS: Settings = {
  columns: 170,
  charset: 'detailed',
  customChars: ' .:-=+*#%@',
  sortDensity: true,
  cellAspect: 1.75,
  fontScale: 1.0,
  fontWeight: '500',
  contrast: 1.25,
  brightness: 0,
  gamma: 0.95,
  invert: false,
  colorMode: 'original',
  saturation: 1.4,
  colorNormalize: 0.55,
  fg: '#e8e8e8',
  duoA: '#002b0c',
  duoB: '#9dffb0',
  accent: '#ff1a1a',
  accentTolerance: 0.08,
  bg: '#000000',
  bgVideo: 0,
  edges: true,
  edgeThreshold: 0.6,
  noise: 0.02,
  glow: 0.45,
  glowRadius: 6,
  scanlines: 0,
  audioReact: 0,
  glitch: 0,
  decode: 0,
  overlayText: '',
  overlaySize: 0.32,
  overlayPos: 'center',
  overlayColor: '#ff1f2d',
  font: 'jetbrains',
  rain: 0,
  trails: 0,
  motion: 0,
};

export const CHARSETS: Record<string, { label: string; chars: string }> = {
  detailed: {
    label: 'Detailed (70 glyphs)',
    chars: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  },
  standard: { label: 'Classic', chars: ' .:-=+*#%@' },
  letters: { label: 'Letters', chars: ' .,:;ilcvunxzjftrXYUJCLQ0OZmwqpdbkhaoMW' },
  blocks: { label: 'Blocks', chars: ' ░▒▓█' },
  binary: { label: 'Binary', chars: ' 01' },
  dots: { label: 'Dots', chars: ' .·:•●' },
  braille: { label: 'Braille', chars: ' ⠁⠃⠇⠏⠟⠿⡿⣿' },
  geo: { label: 'Geometry', chars: ' .-+x*#▪■' },
  katakana: { label: 'Matrix (katakana)', chars: ' ｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ012345' },
  custom: { label: 'Custom', chars: '' },
};

// Per-glyph fallback for katakana / box-drawing / braille when the main font lacks them (matters in Node/Skia).
const GLYPH_FALLBACK = '"Hiragino Sans", "Noto Sans CJK JP", "Arial Unicode MS", monospace';

export const FONTS: Record<string, { label: string; family: string }> = {
  jetbrains: { label: 'JetBrains', family: `"JetBrains Mono", Menlo, Consolas, ${GLYPH_FALLBACK}` },
  plex: { label: 'IBM Plex', family: `"IBM Plex Mono", Menlo, ${GLYPH_FALLBACK}` },
  space: { label: 'Space Mono', family: `"Space Mono", Menlo, ${GLYPH_FALLBACK}` },
  fira: { label: 'Fira Code', family: `"Fira Code", Menlo, ${GLYPH_FALLBACK}` },
  courier: { label: 'Courier', family: `"Courier Prime", "Courier New", ${GLYPH_FALLBACK}` },
  vt323: { label: 'VT323 pixel', family: `VT323, Menlo, ${GLYPH_FALLBACK}` },
};

export const FONT_FAMILY = FONTS.jetbrains.family;

export function fontFamily(s: Pick<Settings, 'font'>): string {
  return (FONTS[s.font] ?? FONTS.jetbrains).family;
}

function lerpHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/** Blend two looks: numbers and colors interpolate, everything else switches halfway. */
export function lerpSettings(a: Settings, b: Settings, t: number): Settings {
  const out: Record<string, unknown> = { ...a };
  const hex = /^#[0-9a-f]{6}$/i;
  for (const k of Object.keys(b) as (keyof Settings)[]) {
    const va = a[k], vb = b[k];
    if (typeof va === 'number' && typeof vb === 'number') out[k] = va + (vb - va) * t;
    else if (typeof va === 'string' && typeof vb === 'string' && hex.test(va) && hex.test(vb)) out[k] = lerpHex(va, vb, t);
    else out[k] = t < 0.5 ? va : vb;
  }
  return out as unknown as Settings;
}

const densityCache = new Map<string, string>();

/** Orders glyphs from emptiest to densest by measuring their real pixel coverage in the font. */
function sortByDensity(chars: string, weight: string, family: string): string {
  const key = weight + '|' + family + '|' + chars;
  const hit = densityCache.get(key);
  if (hit) return hit;
  const glyphs = Array.from(new Set(Array.from(chars)));
  const size = 48;
  const c = platform.createCanvas();
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.font = `${weight} ${size * 0.8}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const scored = glyphs.map((ch) => {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#fff';
    ctx.fillText(ch, size / 2, size / 2);
    const d = ctx.getImageData(0, 0, size, size).data;
    let sum = 0;
    for (let i = 3; i < d.length; i += 4) sum += d[i];
    return { ch, sum };
  });
  scored.sort((a, b) => a.sum - b.sum);
  const out = scored.map((s) => s.ch).join('');
  // only remember the order once the real font is in, otherwise we'd cache the fallback's metrics
  if (platform.fontReady(ctx.font)) densityCache.set(key, out);
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const THERMAL_STOPS: [number, string][] = [
  [0, '#000000'], [0.18, '#1a0a4a'], [0.38, '#7a0f7a'], [0.58, '#e8222a'], [0.8, '#ffb020'], [1, '#ffffe8'],
];
const THERMAL = (() => {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < THERMAL_STOPS.length - 2 && t > THERMAL_STOPS[k + 1][0]) k++;
    const [t0, c0] = THERMAL_STOPS[k];
    const [t1, c1] = THERMAL_STOPS[k + 1];
    const f = (t - t0) / (t1 - t0);
    const a = hexToRgb(c0), b = hexToRgb(c1);
    for (let j = 0; j < 3; j++) lut[i * 3 + j] = a[j] + (b[j] - a[j]) * f;
  }
  return lut;
})();

/** Deterministic 0..1 hash so effects look the same in preview and export. */
function hash01(a: number, b = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

const SCRAMBLE = '!<>-_\\/[]{}=+*^?#%&@$01ABCDEFXYZ';
const RAIN = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎ012345789Z:.=*+-<>';

function hue01(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d === 0) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return h < 0 ? h + 1 : h;
}

export function resolveChars(s: Settings): string[] {
  let chars = s.charset === 'custom' ? s.customChars : CHARSETS[s.charset]?.chars ?? CHARSETS.detailed.chars;
  if (!chars) chars = CHARSETS.standard.chars;
  if (s.sortDensity) chars = sortByDensity(chars, s.fontWeight, fontFamily(s));
  const arr = Array.from(chars);
  // Darkest slot must be empty so black areas stay black.
  if (arr[0] !== ' ') arr.unshift(' ');
  return arr;
}

export class AsciiRenderer {
  private sample = platform.createCanvas();
  private sctx = this.sample.getContext('2d', { willReadFrequently: true })!;
  private text = platform.createCanvas();
  private tctx = this.text.getContext('2d')!;
  private octx: CanvasRenderingContext2D;
  private lum = new Float32Array(0);
  private colorCache: string[] = new Array(32768);
  private mask = platform.createCanvas();
  private maskKey = '';
  private maskData: Uint8ClampedArray | null = null;
  private tintR = platform.createCanvas();
  private tintC = platform.createCanvas();
  private trail = platform.createCanvas();
  private trailFresh = true;
  private prevLum: Float32Array | null = null;

  /** Forget frame-to-frame state (trails, motion) — call after a seek. */
  resetTemporal() {
    this.trailFresh = true;
    this.prevLum = null;
  }
  /** Glyph grid of the last rendered frame (for "copy as text"). */
  lastGrid: { cols: number; rows: number; chars: string[] } = { cols: 0, rows: 0, chars: [] };

  /** Text as plain ASCII art, one line per row. */
  asText(): string {
    const { cols, rows, chars } = this.lastGrid;
    const lines: string[] = [];
    for (let y = 0; y < rows; y++) lines.push(chars.slice(y * cols, y * cols + cols).join('').replace(/\s+$/, ''));
    return lines.join('\n');
  }

  /** Alpha mask of the overlay text, sampled on the character grid (cells are not square, so y is squashed). */
  private overlayMask(s: Settings, cols: number, rows: number, cellW: number, cellH: number) {
    const key = [s.overlayText, s.overlaySize, s.overlayPos, cols, rows, cellW.toFixed(3), cellH.toFixed(3)].join('|');
    if (key === this.maskKey) return this.maskData;
    this.maskKey = key;
    const c = this.mask;
    c.width = cols;
    c.height = rows;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.clearRect(0, 0, cols, rows);
    const ky = cellW / cellH;
    const vh = rows / ky; // grid height in "cell-width" units
    ctx.setTransform(1, 0, 0, ky, 0, 0);
    let size = vh * s.overlaySize;
    ctx.font = `900 ${size}px Inter, "Helvetica Neue", Arial, sans-serif`;
    const w = ctx.measureText(s.overlayText).width;
    if (w > cols * 0.92) {
      size *= (cols * 0.92) / w;
      ctx.font = `900 ${size}px Inter, "Helvetica Neue", Arial, sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = s.overlayPos === 'top' ? vh * 0.08 + size / 2 : s.overlayPos === 'bottom' ? vh * 0.92 - size / 2 : vh / 2;
    ctx.fillStyle = '#fff';
    ctx.fillText(s.overlayText, cols / 2, y);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.maskData = ctx.getImageData(0, 0, cols, rows).data;
    return this.maskData;
  }

  private tinted(which: 'r' | 'c', W: number, H: number, layer: HTMLCanvasElement) {
    const c = which === 'r' ? this.tintR : this.tintC;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d')!;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(layer, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = which === 'r' ? '#ff0000' : '#00ffff';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(layer, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    return c;
  }

  constructor(public out: HTMLCanvasElement) {
    this.octx = out.getContext('2d')!;
  }

  setSize(w: number, h: number) {
    if (this.out.width !== w || this.out.height !== h) {
      this.out.width = w;
      this.out.height = h;
    }
    if (this.text.width !== w || this.text.height !== h) {
      this.text.width = w;
      this.text.height = h;
    }
  }

  private color(r: number, g: number, b: number): string {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let c = this.colorCache[key];
    if (!c) {
      c = `rgb(${(r >> 3) << 3},${(g >> 3) << 3},${(b >> 3) << 3})`;
      this.colorCache[key] = c;
    }
    return c;
  }

  render(src: CanvasImageSource, srcW: number, srcH: number, s: Settings, mirror = false, fx: FrameFx = {}) {
    const W = this.out.width;
    const H = this.out.height;
    const cols = Math.max(8, Math.round(s.columns));
    const cellW = W / cols;
    const rows = Math.max(1, Math.round(H / (cellW * s.cellAspect)));
    const cellH = H / rows;

    if (this.sample.width !== cols || this.sample.height !== rows) {
      this.sample.width = cols;
      this.sample.height = rows;
    }
    const sctx = this.sctx;
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    const cr = fx.crop ?? { x: 0, y: 0, w: srcW, h: srcH };
    if (mirror) sctx.setTransform(-1, 0, 0, 1, cols, 0);
    sctx.drawImage(src, cr.x, cr.y, cr.w, cr.h, 0, 0, cols, rows);
    if (mirror) sctx.setTransform(1, 0, 0, 1, 0, 0);
    const px = sctx.getImageData(0, 0, cols, rows).data;

    const n = cols * rows;
    const time = fx.time ?? 1e6;
    const beat = Math.min(1, Math.max(0, fx.audio ?? 0)) * s.audioReact;
    const boost = beat * 0.32;
    // glitch: a burst happens on some 1/12 s ticks, more often with higher intensity
    const gTick = Math.floor(time * 12);
    const glitchOn = s.glitch > 0 && hash01(gTick, 7) < s.glitch * 0.55;
    const gStrength = glitchOn ? s.glitch * (0.4 + 0.6 * hash01(gTick, 8)) : 0;
    const gBandY = hash01(gTick, 9) * rows;
    const gBandH = rows * (0.04 + 0.18 * hash01(gTick, 10)) * gStrength * 2;
    const decodeP = s.decode > 0 ? time / s.decode : 9;
    const scrTick = Math.floor(time * 24);
    const mask = s.overlayText.trim() ? this.overlayMask(s, cols, rows, cellW, cellH) : null;
    const ovChars = Array.from(s.overlayText.replace(/\s+/g, '') || '#');
    const ov = hexToRgb(s.overlayColor);
    if (this.lastGrid.chars.length !== n) this.lastGrid = { cols, rows, chars: new Array(n).fill(' ') };
    this.lastGrid.cols = cols;
    this.lastGrid.rows = rows;
    const grid = this.lastGrid.chars;
    if (this.lum.length !== n) this.lum = new Float32Array(n);
    const lum = this.lum;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      let l = (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) / 255;
      l = (l - 0.5) * s.contrast + 0.5 + s.brightness + boost;
      l = l < 0 ? 0 : l > 1 ? 1 : l;
      if (s.gamma !== 1) l = Math.pow(l, s.gamma);
      if (s.invert) l = 1 - l;
      lum[i] = l;
    }
    if (s.motion > 0) {
      // motion map: per-cell brightness change since the previous frame
      const prev = this.prevLum;
      if (!prev || prev.length !== n) {
        this.prevLum = Float32Array.from(lum);
        for (let i = 0; i < n; i++) lum[i] *= 1 - s.motion;
      } else {
        for (let i = 0; i < n; i++) {
          const raw = lum[i];
          const m = Math.min(1, Math.abs(raw - prev[i]) * 5);
          prev[i] = raw;
          lum[i] = raw * (1 - s.motion) + m * s.motion;
        }
      }
    } else {
      this.prevLum = null;
    }

    // digital rain: per-column falling streams
    const rainOn = s.rain > 0;
    const rHead = new Float32Array(rainOn ? cols : 0);
    const rLen = new Float32Array(rainOn ? cols : 0);
    if (rainOn) {
      for (let c = 0; c < cols; c++) {
        if (hash01(c, 104) > s.rain) { rLen[c] = 0; continue; }
        const spd = rows * (0.22 + 0.6 * hash01(c, 101));
        const len = rows * (0.07 + 0.25 * hash01(c, 102));
        const cycle = rows + len;
        rLen[c] = len;
        rHead[c] = (time * spd + hash01(c, 103) * cycle) % cycle;
      }
    }

    const chars = resolveChars(s);
    const nc = chars.length;
    const fg = hexToRgb(s.fg);
    const da = hexToRgb(s.duoA);
    const db = hexToRgb(s.duoB);
    const ac = hexToRgb(s.accent);
    const acHue = hue01(ac[0], ac[1], ac[2]);
    const tol = Math.max(0.005, s.accentTolerance);
    const sat = s.saturation;
    const norm = s.colorNormalize;

    const t = this.tctx;
    t.clearRect(0, 0, W, H);
    t.font = `${s.fontWeight} ${cellH * s.fontScale * (1 + beat * 0.18)}px ${fontFamily(s)}`;
    t.textAlign = 'center';
    t.textBaseline = 'middle';
    let lastFill = '';

    for (let y = 0; y < rows; y++) {
      const cy = (y + 0.5) * cellH;
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const l = lum[i];
        let ch: string | null = null;
        grid[i] = ' ';
        // special overrides: overlay text, decode intro, glitch band
        let force: [number, number, number] | null = null;
        if (rainOn && rLen[x] > 0) {
          const dist = rHead[x] - y;
          if (dist >= 0 && dist < rLen[x]) {
            const tr = 1 - dist / rLen[x];
            if (tr > 0.06) {
              ch = RAIN[Math.floor(hash01(i, Math.floor(time * 9 + hash01(i, 5) * 9)) * RAIN.length)];
              if (dist < 1) force = [235 + ac[0] * 0.08, 235 + ac[1] * 0.08, 235 + ac[2] * 0.08];
              else {
                const k = Math.min(1, 0.18 + tr * (0.6 + 0.4 * l) + beat * 0.2);
                force = [ac[0] * k, ac[1] * k, ac[2] * k];
              }
            }
          }
        }
        if (mask && mask[i * 4 + 3] > 110) {
          ch = ovChars[(x + y * 3) % ovChars.length];
          const k = 0.85 + 0.15 * beat;
          force = [ov[0] * k, ov[1] * k, ov[2] * k];
        }
        if (decodeP < 1.2) {
          const h = hash01(i, 3);
          const front = decodeP * 1.2 - h;
          if (front < 0) {
            // not revealed yet: running random glyphs (sparser over dark areas)
            if (l < 0.08 && hash01(i, 4) > 0.35) continue;
            ch = SCRAMBLE[Math.floor(hash01(i, scrTick) * SCRAMBLE.length)];
            const k = 0.35 + 0.4 * hash01(i, scrTick + 1);
            force = [ac[0] * k, ac[1] * k, ac[2] * k];
          } else if (front < 0.07) {
            ch ??= SCRAMBLE[Math.floor(hash01(i, scrTick) * SCRAMBLE.length)];
            force = [255, 255, 255];
          }
        }
        if (glitchOn && y >= gBandY && y < gBandY + gBandH && hash01(i, gTick) < 0.6) {
          ch = SCRAMBLE[Math.floor(hash01(i, gTick + 2) * SCRAMBLE.length)];
        }

        if (ch === null && s.edges && x > 0 && y > 0 && x < cols - 1 && y < rows - 1 && l > 0.12) {
          const a = lum[i - cols - 1], b = lum[i - cols], c = lum[i - cols + 1];
          const d = lum[i - 1], f = lum[i + 1];
          const g = lum[i + cols - 1], h = lum[i + cols], k = lum[i + cols + 1];
          const gx = c + 2 * f + k - a - 2 * d - g;
          const gy = g + 2 * h + k - a - 2 * b - c;
          if (gx * gx + gy * gy > s.edgeThreshold * s.edgeThreshold) {
            const ang = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180;
            ch = ang < 22.5 || ang >= 157.5 ? '|' : ang < 67.5 ? '/' : ang < 112.5 ? '-' : '\\';
          }
        }

        if (ch === null) {
          let idx = Math.min(nc - 1, Math.floor(l * nc));
          if (idx > 0 && s.noise > 0 && Math.random() < s.noise) {
            idx += (Math.random() < 0.5 ? -1 : 1) * (1 + ((Math.random() * 3) | 0));
            idx = idx < 1 ? 1 : idx > nc - 1 ? nc - 1 : idx;
          }
          if (idx === 0) continue;
          ch = chars[idx];
        }

        grid[i] = ch;
        let r: number, g: number, b: number;
        if (force) {
          [r, g, b] = force;
        } else if (s.colorMode === 'original') {
          const p = i * 4;
          r = px[p]; g = px[p + 1]; b = px[p + 2];
          if (norm > 0) {
            const m = Math.max(r, g, b, 1);
            const kk = 255 / m;
            r += (r * kk - r) * norm;
            g += (g * kk - g) * norm;
            b += (b * kk - b) * norm;
          }
          if (sat !== 1) {
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            r = gray + (r - gray) * sat;
            g = gray + (g - gray) * sat;
            b = gray + (b - gray) * sat;
          }
          r = r < 0 ? 0 : r > 255 ? 255 : r;
          g = g < 0 ? 0 : g > 255 ? 255 : g;
          b = b < 0 ? 0 : b > 255 ? 255 : b;
        } else if (s.colorMode === 'mono') {
          [r, g, b] = fg;
        } else if (s.colorMode === 'accent') {
          // Selective color: everything is graphite/chrome except hues near the accent.
          const p = i * 4;
          const R = px[p], G = px[p + 1], B = px[p + 2];
          const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          const sv = mx ? (mx - mn) / mx : 0;
          let dh = Math.abs(hue01(R, G, B) - acHue);
          if (dh > 0.5) dh = 1 - dh;
          const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
          const w = clamp01(1 - dh / tol) * clamp01((sv - 0.22) / 0.3) * clamp01((mx / 255 - 0.06) / 0.18);
          const k = 0.22 + 0.78 * l;
          const br = 0.72 + 0.28 * Math.min(1, (mx / 255) * 2);
          r = fg[0] * k + (ac[0] * br - fg[0] * k) * w;
          g = fg[1] * k + (ac[1] * br - fg[1] * k) * w;
          b = fg[2] * k + (ac[2] * br - fg[2] * k) * w;
        } else if (s.colorMode === 'thermal') {
          const j = Math.round(l * 255) * 3;
          r = THERMAL[j]; g = THERMAL[j + 1]; b = THERMAL[j + 2];
        } else {
          r = da[0] + (db[0] - da[0]) * l;
          g = da[1] + (db[1] - da[1]) * l;
          b = da[2] + (db[2] - da[2]) * l;
        }

        const fill = this.color(r | 0, g | 0, b | 0);
        if (fill !== lastFill) {
          t.fillStyle = fill;
          lastFill = fill;
        }
        t.fillText(ch, (x + 0.5) * cellW, cy);
      }
    }

    const o = this.octx;
    o.save();
    o.globalCompositeOperation = 'source-over';
    o.globalAlpha = 1;
    o.filter = 'none';
    o.fillStyle = s.bg;
    o.fillRect(0, 0, W, H);
    if (s.bgVideo > 0) {
      o.globalAlpha = s.bgVideo;
      if (mirror) o.setTransform(-1, 0, 0, 1, W, 0);
      o.drawImage(src, cr.x, cr.y, cr.w, cr.h, 0, 0, W, H);
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.globalAlpha = 1;
    }
    // trails: keep fading copies of previous frames
    let layer: HTMLCanvasElement = this.text;
    if (s.trails > 0) {
      const tr = this.trail;
      if (tr.width !== W || tr.height !== H) { tr.width = W; tr.height = H; this.trailFresh = true; }
      const tc = tr.getContext('2d')!;
      if (this.trailFresh) { tc.clearRect(0, 0, W, H); this.trailFresh = false; }
      tc.globalCompositeOperation = 'destination-out';
      tc.globalAlpha = 1 - Math.min(0.97, s.trails);
      tc.fillRect(0, 0, W, H);
      tc.globalCompositeOperation = 'source-over';
      tc.globalAlpha = 1;
      tc.drawImage(this.text, 0, 0);
      layer = tr;
    } else {
      this.trailFresh = true;
    }

    if (gStrength > 0) {
      // chromatic split: red and cyan copies pushed apart, summing back to the original where they overlap
      const dx = Math.round(W * 0.012 * gStrength * (hash01(gTick, 11) < 0.5 ? -1 : 1));
      o.globalCompositeOperation = 'lighter';
      o.drawImage(this.tinted('r', W, H, layer), -dx, 0);
      o.drawImage(this.tinted('c', W, H, layer), dx, 0);
      o.globalCompositeOperation = 'source-over';
    } else {
      o.drawImage(layer, 0, 0);
    }
    const glow = s.glow * (1 + beat * 1.6);
    if (glow > 0) {
      o.globalCompositeOperation = 'lighter';
      o.globalAlpha = Math.min(2, glow);
      o.filter = `blur(${(s.glowRadius * Math.min(W, H)) / 1080}px)`;
      o.drawImage(layer, 0, 0);
      o.filter = 'none';
      o.globalCompositeOperation = 'source-over';
    }
    if (s.scanlines > 0) {
      o.globalAlpha = s.scanlines;
      o.fillStyle = '#000';
      const step = Math.max(2, Math.round(H / 540));
      for (let y = 0; y < H; y += step * 2) o.fillRect(0, y, W, step);
    }
    if (gStrength > 0) {
      // displaced horizontal slices
      o.globalAlpha = 1;
      const slices = 2 + Math.floor(hash01(gTick, 12) * 6 * gStrength);
      for (let k = 0; k < slices; k++) {
        const sy = Math.floor(hash01(gTick, 20 + k) * H);
        const sh = Math.max(2, Math.floor(H * (0.008 + 0.05 * hash01(gTick, 40 + k))));
        const dx = Math.round((hash01(gTick, 60 + k) - 0.5) * W * 0.09 * gStrength);
        o.drawImage(this.out, 0, sy, W, sh, dx, sy, W, sh);
      }
    }
    o.restore();
  }
}
