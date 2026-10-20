import { DEFAULTS, lerpSettings, type Settings } from './ascii';
import { countBeats } from './audio';

export interface Crop { x: number; y: number; w: number; h: number }

export const ASPECTS: Record<string, number> = { '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5, '16:9': 16 / 9 };

/** Centered source region for a frame format ('source' keeps the whole frame). */
export function cropFor(vw: number, vh: number, aspect: string): Crop {
  const R = ASPECTS[aspect];
  if (!R) return { x: 0, y: 0, w: vw, h: vh };
  if (vw / vh > R) {
    const w = Math.round(vh * R);
    return { x: Math.round((vw - w) / 2), y: 0, w, h: vh };
  }
  const h = Math.round(vw / R);
  return { x: 0, y: Math.round((vh - h) / 2), w: vw, h };
}

/** Effects that belong to the user, not to a preset: they stay on when beat-switching swaps the look. */
export const KEEP_FX: (keyof Settings)[] = ['audioReact', 'glitch', 'decode', 'overlayText', 'overlaySize', 'overlayPos', 'overlayColor'];

export interface LookPlan {
  base: Settings;
  /** Fragment bounds in source seconds (for the A → B blend). */
  start: number;
  end: number;
  /** Beat-synced switching: on every beat the next look from the list is used. */
  beats?: number[];
  beatLooks?: Partial<Settings>[];
  /** Keyframes: A at `start` smoothly blends into B at `end`. */
  animA?: Settings | null;
  animB?: Settings | null;
}

/** The look at a source time: beat-switched preset, A → B blend, or the static settings. */
export function resolveLook(plan: LookPlan, srcT: number): Settings {
  const { beats, beatLooks } = plan;
  if (beats?.length && beatLooks?.length) {
    const p = beatLooks[countBeats(beats, srcT) % beatLooks.length];
    const out = { ...DEFAULTS, ...p } as unknown as Record<string, unknown>;
    for (const k of KEEP_FX) out[k] = plan.base[k];
    return out as unknown as Settings;
  }
  if (plan.animA && plan.animB) {
    const span = Math.max(0.001, plan.end - plan.start);
    let t = Math.min(1, Math.max(0, (srcT - plan.start) / span));
    t = t * t * (3 - 2 * t);
    return lerpSettings(plan.animA, plan.animB, t);
  }
  return plan.base;
}
