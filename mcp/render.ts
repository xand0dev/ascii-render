import './platform';
import { createCanvas, ImageData, type Canvas } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { AsciiRenderer, DEFAULTS, type Settings } from '../src/ascii';
import { detectBeats, envelopeFromSamples, sampleEnvelope, type Envelope } from '../src/audio';
import { drawCompare } from '../src/compare';
import { cropFor, resolveLook } from '../src/looks';
import { BUILTIN_PRESETS } from '../src/presets';
import { frameReader, probe, readAudioMono, spawnFf, writeFrame, type VideoInfo } from './ffmpeg';

type NodeCanvas = Canvas & HTMLCanvasElement;
const asNode = (c: HTMLCanvasElement) => c as unknown as Canvas;

// ───────── looks ─────────
export function findPreset(name: string) {
  const key = name.trim().toLowerCase();
  return BUILTIN_PRESETS.find((p) => p.id.toLowerCase() === key || p.name.toLowerCase() === key);
}

/** Keeps only known keys with the right type, so a model can't feed garbage into the renderer. */
export function sanitize(obj: unknown): Partial<Settings> {
  const out: Record<string, unknown> = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k in DEFAULTS && typeof v === typeof DEFAULTS[k as keyof Settings]) out[k] = v;
  }
  return out as Partial<Settings>;
}

export function buildLook(preset?: string, overrides?: unknown): Settings {
  let base: Settings = { ...DEFAULTS, ...BUILTIN_PRESETS[0].s };
  if (preset) {
    const p = findPreset(preset);
    if (!p) throw new Error(`Нет пресета «${preset}». Доступные: ${BUILTIN_PRESETS.map((x) => x.id).join(', ')}`);
    base = { ...DEFAULTS, ...p.s };
  }
  return { ...base, ...sanitize(overrides) };
}

// ───────── paths ─────────
export function expandPath(p: string) {
  return resolve(p.startsWith('~') ? join(homedir(), p.slice(1)) : p);
}

function freeOutputPath(input: string, ext: string, wanted?: string) {
  if (wanted) return expandPath(wanted);
  const base = join(dirname(input), `${basename(input, extname(input))}_ascii`);
  let candidate = `${base}.${ext}`;
  for (let i = 2; existsSync(candidate); i++) candidate = `${base}_${i}.${ext}`;
  return candidate;
}

const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);

async function envelopeOf(path: string, info: VideoInfo): Promise<Envelope | null> {
  if (!info.hasAudio) return null;
  const pcm = await readAudioMono(path);
  return pcm ? envelopeFromSamples(pcm, 22050) : null;
}

function pixels(c: HTMLCanvasElement): Buffer {
  const ctx = c.getContext('2d')!;
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  return Buffer.from(d.buffer, d.byteOffset, d.byteLength);
}

// ───────── single frame ─────────
export interface FrameJob {
  input: string;
  time: number;
  look: Settings;
  aspect?: string;
  /** Longest side of the returned image. */
  maxSide?: number;
  /** Seconds since the clip start for time-based effects (decode intro, rain, glitch). */
  effectTime?: number;
}

export async function renderFrame(job: FrameJob) {
  const input = expandPath(job.input);
  const info = await probe(input);
  const t = Math.min(Math.max(0, job.time), Math.max(0, info.duration - 0.05));
  const crop = cropFor(info.width, info.height, job.aspect ?? 'source');
  const side = job.maxSide ?? 1024;
  const scale = side / Math.max(crop.w, crop.h);
  const W = even(crop.w * scale), H = even(crop.h * scale);

  const { proc, done } = spawnFf([
    '-v', 'error', '-ss', String(t), '-i', input, '-frames:v', '1',
    '-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${W}:${H}:flags=area`,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ]);
  const next = frameReader(proc, W * H * 4);
  const raw = await next();
  await done;
  if (!raw) throw new Error('Не удалось прочитать кадр');

  const src = createCanvas(W, H);
  src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength), W, H), 0, 0);
  const env = job.look.audioReact > 0 ? await envelopeOf(input, info) : null;
  const out = createCanvas(W, H) as NodeCanvas;
  const renderer = new AsciiRenderer(out);
  renderer.setSize(W, H);
  renderer.render(src as unknown as HTMLCanvasElement, W, H, job.look, false, {
    time: job.effectTime ?? 99,
    audio: sampleEnvelope(env, t),
  });
  return {
    png: await asNode(out).encode('png'),
    text: renderer.asText(),
    width: W,
    height: H,
    grid: { cols: renderer.lastGrid.cols, rows: renderer.lastGrid.rows },
    info,
  };
}

// ───────── full video ─────────
export interface VideoJob {
  input: string;
  output?: string;
  format: 'mp4' | 'gif';
  look: Settings;
  start?: number;
  end?: number;
  speed?: number;
  aspect?: string;
  /** Short side for MP4 (720 / 1080 / 1440 / 2160). */
  resolution?: number;
  gifWidth?: number;
  fps?: number;
  audio?: boolean;
  compare?: 'none' | 'wipe';
  beatLooks?: Settings[];
  beatSensitivity?: number;
  animateTo?: Settings;
}

export async function renderVideo(job: VideoJob, onProgress?: (done: number, total: number) => void) {
  const t0 = Date.now();
  const input = expandPath(job.input);
  const info = await probe(input);
  const start = Math.min(Math.max(0, job.start ?? 0), info.duration);
  const end = Math.min(info.duration, Math.max(start + 0.05, job.end ?? info.duration));
  const speed = Math.min(15, Math.max(1, job.speed ?? 1));
  const gif = job.format === 'gif';
  const fps = Math.min(60, Math.max(1, job.fps ?? (gif ? 15 : 30)));
  const crop = cropFor(info.width, info.height, job.aspect ?? 'source');

  // output size, and the (bigger) size we render at
  let W: number, H: number;
  if (gif) {
    W = even(job.gifWidth ?? 480);
    H = even((W * crop.h) / crop.w);
  } else {
    const q = job.resolution ?? 1080;
    const s = q / Math.min(crop.w, crop.h);
    W = even(crop.w * s);
    H = even(crop.h * s);
  }
  const rs = gif ? Math.min(2, 1600 / Math.max(W, H)) : 1;
  const RW = even(W * rs), RH = even(H * rs);

  const needEnv = job.look.audioReact > 0 || !!job.beatLooks?.length;
  const env = needEnv ? await envelopeOf(input, info) : null;
  const beats = job.beatLooks?.length ? detectBeats(env, job.beatSensitivity ?? 0.5) : [];
  const plan = {
    base: job.look, start, end,
    beats, beatLooks: job.beatLooks,
    animA: job.animateTo ? job.look : null,
    animB: job.animateTo ?? null,
  };

  const output = freeOutputPath(input, gif ? 'gif' : 'mp4', job.output);
  const dur = end - start;
  const total = Math.max(1, Math.round((dur / speed) * fps));

  const decoder = spawnFf([
    '-v', 'error', '-ss', String(start), '-t', String(dur), '-i', input, '-an',
    '-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${RW}:${RH}:flags=area,setpts=(PTS-STARTPTS)/${speed},fps=${fps}`,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ]);

  const withAudio = !gif && (job.audio ?? true) && info.hasAudio;
  const encArgs = ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${RW}x${RH}`, '-r', String(fps), '-i', 'pipe:0'];
  if (gif) {
    encArgs.push(
      '-vf', `scale=${W}:${H}:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a`,
      '-loop', '0', output,
    );
  } else {
    if (withAudio) encArgs.push('-ss', String(start), '-t', String(dur), '-i', input);
    encArgs.push('-map', '0:v');
    if (withAudio) {
      encArgs.push('-map', '1:a:0');
      // same "sped-up tape" sound as the web editor
      if (speed > 1) encArgs.push('-af', `asetrate=${info.sampleRate * speed},aresample=${info.sampleRate}`);
      encArgs.push('-c:a', 'aac', '-b:a', '192k');
    }
    encArgs.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-shortest', output);
  }
  const encoder = spawnFf(encArgs);

  const src = createCanvas(RW, RH);
  const sctx = src.getContext('2d');
  const out = createCanvas(RW, RH) as NodeCanvas;
  const renderer = new AsciiRenderer(out);
  renderer.setSize(RW, RH);
  const comp = job.compare === 'wipe' ? (createCanvas(RW, RH) as NodeCanvas) : null;
  const full = { x: 0, y: 0, w: RW, h: RH };
  const next = frameReader(decoder.proc, RW * RH * 4);

  let i = 0;
  try {
    for (;;) {
      const raw = await next();
      if (!raw) break;
      sctx.putImageData(new ImageData(new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength), RW, RH), 0, 0);
      const srcT = start + (i * speed) / fps;
      renderer.render(src as unknown as HTMLCanvasElement, RW, RH, resolveLook(plan, srcT), false, {
        time: i / fps,
        audio: sampleEnvelope(env, srcT),
      });
      let frame: HTMLCanvasElement = out;
      if (comp) {
        drawCompare(comp, src as unknown as HTMLCanvasElement, out, full, i / fps);
        frame = comp;
      }
      await writeFrame(encoder.proc, pixels(frame));
      i++;
      onProgress?.(Math.min(i, total), total);
    }
  } finally {
    encoder.proc.stdin.end();
  }
  await decoder.done;
  await encoder.done;

  const bytes = (await stat(output)).size;
  return {
    output, width: W, height: H, fps, frames: i, speed, start, end,
    duration: i / fps, beats: beats.length, bytes, seconds: (Date.now() - t0) / 1000,
  };
}

export async function videoInfo(path: string) {
  return probe(expandPath(path));
}
