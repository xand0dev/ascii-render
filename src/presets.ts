import { DEFAULTS, type Settings } from './ascii';

export interface Preset {
  id: string;
  name: string;
  s: Settings;
  user?: boolean;
}

export const BUILTIN_PRESETS: Preset[] = [
  {
    id: 'xand0dev', name: 'xand0dev',
    s: {
      ...DEFAULTS, colorMode: 'accent', fg: '#d9d9de', accent: '#ff1a1a', accentTolerance: 0.09,
      charset: 'detailed', columns: 180, contrast: 1.45, gamma: 1.05, edges: true, edgeThreshold: 0.55,
      glow: 0.7, glowRadius: 7, noise: 0.015, fontWeight: '700', bg: '#050505',
    },
  },
  { id: 'reference', name: 'Reference', s: { ...DEFAULTS } },
  {
    id: 'blood', name: 'Blood',
    s: {
      ...DEFAULTS, colorMode: 'duotone', duoA: '#120000', duoB: '#ff2a2a', charset: 'letters',
      glow: 1.1, glowRadius: 10, contrast: 1.6, edges: true, edgeThreshold: 0.6, scanlines: 0.18, noise: 0.03,
    },
  },
  {
    id: 'chrome', name: 'Chrome',
    s: {
      ...DEFAULTS, colorMode: 'duotone', duoA: '#141418', duoB: '#ffffff', charset: 'detailed', fontWeight: '700',
      contrast: 1.7, gamma: 1.1, edges: true, edgeThreshold: 0.45, glow: 0.35, glowRadius: 5, noise: 0,
    },
  },
  {
    id: 'matrix', name: 'Matrix',
    s: {
      ...DEFAULTS, charset: 'katakana', colorMode: 'duotone', duoA: '#002b0c', duoB: '#a8ffbc',
      edges: false, glow: 0.7, glowRadius: 8, noise: 0.06, columns: 130, cellAspect: 1.6, contrast: 1.4,
      rain: 0.55, accent: '#5dff8a',
    },
  },
  {
    id: 'redrain', name: 'Red rain',
    s: {
      ...DEFAULTS, colorMode: 'accent', fg: '#b8b8c0', accent: '#ff1a1a', charset: 'letters', rain: 0.7,
      contrast: 1.3, glow: 0.8, glowRadius: 8, edges: false, noise: 0, columns: 150, font: 'fira',
    },
  },
  {
    id: 'echo', name: 'Echo',
    s: {
      ...DEFAULTS, trails: 0.86, motion: 0.55, colorNormalize: 0.8, saturation: 1.8, glow: 0.8, glowRadius: 9,
      edges: false, noise: 0, columns: 150,
    },
  },
  {
    id: 'pixel', name: 'Pixel terminal',
    s: {
      ...DEFAULTS, font: 'vt323', charset: 'standard', colorMode: 'duotone', duoA: '#001a06', duoB: '#7dff9e',
      columns: 120, cellAspect: 1.5, fontScale: 1.2, scanlines: 0.3, glow: 0.6, glowRadius: 7, edges: false, noise: 0.02,
    },
  },
  {
    id: 'thermal', name: 'Thermal',
    s: { ...DEFAULTS, colorMode: 'thermal', charset: 'geo', columns: 140, contrast: 1.3, edges: false, glow: 0.6, glowRadius: 8, noise: 0 },
  },
  {
    id: 'braille', name: 'Braille',
    s: { ...DEFAULTS, charset: 'braille', columns: 220, cellAspect: 1.6, edges: false, glow: 0.4, noise: 0, contrast: 1.4, colorNormalize: 0.7 },
  },
  {
    id: 'halftone', name: 'Halftone',
    s: {
      ...DEFAULTS, charset: 'dots', colorMode: 'mono', fg: '#111111', bg: '#f1ede4', invert: true,
      columns: 120, cellAspect: 1.15, fontScale: 1.25, edges: false, glow: 0, noise: 0, contrast: 1.3, fontWeight: '800',
    },
  },
  {
    id: 'newspaper', name: 'Newspaper',
    s: {
      ...DEFAULTS, charset: 'detailed', colorMode: 'mono', fg: '#1a1a1a', bg: '#ece6d6', invert: true,
      columns: 170, edges: true, edgeThreshold: 0.5, glow: 0, noise: 0, contrast: 1.35,
    },
  },
  {
    id: 'terminal', name: 'Terminal',
    s: { ...DEFAULTS, charset: 'standard', colorMode: 'mono', fg: '#f2f2f2', glow: 0.2, edges: false, columns: 140, noise: 0 },
  },
  {
    id: 'amber', name: 'Amber CRT',
    s: { ...DEFAULTS, colorMode: 'duotone', duoA: '#140900', duoB: '#ffb000', scanlines: 0.35, glow: 0.6, glowRadius: 9 },
  },
  {
    id: 'ice', name: 'Ice',
    s: {
      ...DEFAULTS, colorMode: 'duotone', duoA: '#00101c', duoB: '#c4f3ff', charset: 'letters',
      glow: 0.8, glowRadius: 9, edges: true, edgeThreshold: 0.6, contrast: 1.4, fontWeight: '300', columns: 190,
    },
  },
  {
    id: 'neon', name: 'Neon',
    s: {
      ...DEFAULTS, charset: 'letters', colorMode: 'duotone', duoA: '#12002b', duoB: '#ff4fd8',
      glow: 1, glowRadius: 12, edges: true, edgeThreshold: 0.7, contrast: 1.5, columns: 150,
    },
  },
  {
    id: 'ghost', name: 'Ghost',
    s: {
      ...DEFAULTS, bgVideo: 0.22, colorNormalize: 0.8, saturation: 1.6, glow: 0.6, glowRadius: 8,
      columns: 150, edges: false, noise: 0.03,
    },
  },
  {
    id: 'blocks', name: 'Blocks',
    s: { ...DEFAULTS, charset: 'blocks', columns: 120, cellAspect: 2, edges: false, glow: 0.25, noise: 0, fontScale: 1.15 },
  },
  {
    id: 'binary', name: 'Binary',
    s: {
      ...DEFAULTS, charset: 'binary', colorMode: 'duotone', duoA: '#001626', duoB: '#4fd8ff',
      columns: 160, edges: false, glow: 0.5, noise: 0.1, fontWeight: '700',
    },
  },
  { id: 'dense', name: 'Dense 4K', s: { ...DEFAULTS, columns: 300, glow: 0.35, glowRadius: 4 } },
];

export const DUO_PALETTES: [string, string][] = [
  ['#120000', '#ff2a2a'],
  ['#141418', '#ffffff'],
  ['#002b0c', '#a8ffbc'],
  ['#140900', '#ffb000'],
  ['#12002b', '#ff4fd8'],
  ['#001626', '#4fd8ff'],
  ['#1a0000', '#ff5a3c'],
  ['#0d0d0d', '#f4f1e8'],
  ['#0a1a00', '#d4ff3c'],
];

export function randomSettings(base: Settings): Settings {
  const r = (a: number, b: number) => a + Math.random() * (b - a);
  const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
  const [duoA, duoB] = pick(DUO_PALETTES);
  return {
    ...base,
    columns: Math.round(r(90, 240)),
    charset: pick(['detailed', 'detailed', 'standard', 'letters', 'blocks', 'binary', 'katakana', 'braille', 'geo', 'dots']),
    colorMode: pick(['original', 'original', 'duotone', 'duotone', 'mono', 'accent', 'thermal']),
    accent: pick(['#ff1a1a', '#ff1a1a', '#ff7a1a', '#1affd5', '#ff2bd6']),
    contrast: +r(1, 1.7).toFixed(2),
    gamma: +r(0.75, 1.15).toFixed(2),
    saturation: +r(1, 2).toFixed(2),
    colorNormalize: +r(0.3, 0.8).toFixed(2),
    edges: Math.random() < 0.5,
    glow: +r(0.1, 1).toFixed(2),
    glowRadius: +r(3, 12).toFixed(1),
    noise: +r(0, 0.08).toFixed(3),
    scanlines: Math.random() < 0.25 ? +r(0.2, 0.45).toFixed(2) : 0,
    duoA,
    duoB,
    fg: pick(['#f2f2f2', '#d9d9de', '#9dffb0', '#ffb000']),
    bg: '#000000',
    invert: false,
    bgVideo: 0,
  };
}
