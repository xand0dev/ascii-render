import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { AsciiRenderer, type Settings } from './ascii';
import { sampleEnvelope, type Envelope } from './audio';
import { drawCompare } from './compare';

export type CompareMode = 'none' | 'wipe';
export type { Crop } from './looks';
import type { Crop } from './looks';

interface CommonOptions {
  width: number;
  height: number;
  fps: number;
  start: number;
  end: number;
  /** Playback speed multiplier (timelapse): 1 = real time, 15 = 15× faster. */
  speed: number;
  /** Bass envelope of the source for audio-reactive effects. */
  envelope?: Envelope | null;
  /** Source region (9:16 / 1:1 / … reframing). */
  crop?: Crop;
  /** 'wipe' renders an animated before/after split over the original. */
  compare?: CompareMode;
  /** Look at a given source time (keyframes, beat switching). Falls back to the static settings. */
  settingsAt?: (srcTime: number) => Settings;
}

export interface ExportOptions extends CommonOptions {
  bitrate: number;
  audio: boolean;
}

export type GifOptions = CommonOptions;

type Progress = (p: number, label: string) => void;
type FrameHook = (canvas: HTMLCanvasElement, index: number) => void;

function waitEvent(el: EventTarget, name: string) {
  return new Promise<void>((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error(`Не удалось загрузить видео (${name})`)); };
    const cleanup = () => {
      el.removeEventListener(name, ok);
      el.removeEventListener('error', fail);
    };
    el.addEventListener(name, ok);
    el.addEventListener('error', fail);
  });
}

function seek(v: HTMLVideoElement, t: number) {
  const p = waitEvent(v, 'seeked');
  v.currentTime = t;
  return p;
}

async function pickVideoCodec(width: number, height: number, bitrate: number, fps: number) {
  for (const codec of ['avc1.640034', 'avc1.4d0034', 'avc1.640033', 'avc1.42003e']) {
    const config: VideoEncoderConfig = {
      codec, width, height, bitrate, framerate: fps,
      latencyMode: 'quality',
      avc: { format: 'avc' },
    };
    const res = await VideoEncoder.isConfigSupported(config);
    if (res.supported) return config;
  }
  throw new Error('Браузер не поддерживает H.264 кодирование для этого разрешения');
}

async function decodeAudio(file: File, start: number, end: number, speed: number) {
  try {
    const ctx = new OfflineAudioContext(2, 48000, 48000);
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const channels = Math.min(2, buf.numberOfChannels);
    const sr = buf.sampleRate;
    const config: AudioEncoderConfig = { codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: channels, bitrate: 192000 };
    if (!(await AudioEncoder.isConfigSupported(config)).supported) return null;
    const from = Math.floor(start * sr);
    const to = Math.min(buf.length, Math.floor(end * sr));
    if (to <= from) return null;
    if (speed === 1) {
      const data = Array.from({ length: channels }, (_, c) => buf.getChannelData(c).subarray(from, to));
      return { config, data, sr, channels, frames: to - from };
    }
    // Sped-up audio: resample through playbackRate, so it plays faster (and higher) in sync with the video.
    const frames = Math.max(1, Math.floor((to - from) / speed));
    const off = new OfflineAudioContext(channels, frames, sr);
    const node = off.createBufferSource();
    node.buffer = buf;
    node.playbackRate.value = speed;
    node.connect(off.destination);
    node.start(0, from / sr);
    const out = await off.startRendering();
    const data = Array.from({ length: channels }, (_, c) => out.getChannelData(c));
    return { config, data, sr, channels, frames: out.length };
  } catch {
    return null; // no audio track or undecodable
  }
}

/** Renders every output frame in order and hands it to `consume`. */
async function renderFrames(
  src: string,
  settings: Settings,
  o: CommonOptions,
  consume: (frame: HTMLCanvasElement, index: number) => Promise<void> | void,
  onProgress: Progress,
  signal: AbortSignal,
  onFrame?: FrameHook,
) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = src;
  await waitEvent(video, 'loadeddata');

  const vw = video.videoWidth, vh = video.videoHeight;
  const crop = o.crop ?? { x: 0, y: 0, w: vw, h: vh };
  const canvas = document.createElement('canvas');
  const renderer = new AsciiRenderer(canvas);
  renderer.setSize(o.width, o.height);
  let comp: HTMLCanvasElement | null = null;
  if (o.compare === 'wipe') {
    comp = document.createElement('canvas');
    comp.width = o.width;
    comp.height = o.height;
  }

  const speed = Math.max(1, o.speed || 1);
  const total = Math.max(1, Math.round(((o.end - o.start) / speed) * o.fps));
  const t0 = performance.now();
  try {
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new DOMException('Отменено', 'AbortError');
      const srcT = Math.min(o.start + (i * speed) / o.fps, video.duration - 0.001);
      await seek(video, srcT);
      const look = o.settingsAt ? o.settingsAt(srcT) : settings;
      renderer.render(video, vw, vh, look, false, {
        time: i / o.fps,
        audio: sampleEnvelope(o.envelope, srcT),
        crop,
      });
      let frame = canvas;
      if (comp) {
        drawCompare(comp, video, canvas, crop, i / o.fps);
        frame = comp;
      }
      onFrame?.(frame, i);
      await consume(frame, i);
      const elapsed = (performance.now() - t0) / 1000;
      const eta = (elapsed / (i + 1)) * (total - i - 1);
      onProgress((i + 1) / total, `Кадр ${i + 1}/${total} · осталось ~${Math.ceil(eta)}с`);
    }
  } finally {
    video.removeAttribute('src');
    video.load();
  }
  return total;
}

export async function exportMp4(
  src: string,
  file: File,
  settings: Settings,
  opts: ExportOptions,
  onProgress: Progress,
  signal: AbortSignal,
  onFrame?: FrameHook,
): Promise<Blob> {
  const { width, height, fps, start, end, bitrate } = opts;
  const vconfig = await pickVideoCodec(width, height, bitrate, fps);
  onProgress(0, 'Аудио…');
  const speed = Math.max(1, opts.speed || 1);
  const audio = opts.audio ? await decodeAudio(file, start, end, speed) : null;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: audio ? { codec: 'aac', numberOfChannels: audio.channels, sampleRate: audio.sr } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let encodeError: Error | null = null;

  if (audio) {
    const aenc = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => { encodeError = e as Error; },
    });
    aenc.configure(audio.config);
    const block = 4096;
    for (let off = 0; off < audio.frames; off += block) {
      const len = Math.min(block, audio.frames - off);
      const planar = new Float32Array(len * audio.channels);
      for (let c = 0; c < audio.channels; c++) planar.set(audio.data[c].subarray(off, off + len), c * len);
      const ad = new AudioData({
        format: 'f32-planar',
        sampleRate: audio.sr,
        numberOfFrames: len,
        numberOfChannels: audio.channels,
        timestamp: Math.round((off / audio.sr) * 1e6),
        data: planar,
      });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    aenc.close();
  }

  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e as Error; },
  });
  venc.configure(vconfig);
  const frameDur = 1e6 / fps;

  try {
    await renderFrames(src, settings, opts, async (frame, i) => {
      if (encodeError) throw encodeError;
      const vf = new VideoFrame(frame, { timestamp: Math.round(i * frameDur), duration: Math.round(frameDur) });
      venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1));
    }, onProgress, signal, onFrame);
  } catch (err) {
    if (venc.state !== 'closed') venc.close();
    throw err;
  }
  await venc.flush();
  venc.close();
  if (encodeError) throw encodeError;
  muxer.finalize();
  return new Blob([target.buffer], { type: 'video/mp4' });
}

/** Animated GIF: renders at up to 2× and downsamples for crisper glyphs, one palette per frame. */
export async function exportGif(
  src: string,
  settings: Settings,
  opts: GifOptions,
  onProgress: Progress,
  signal: AbortSignal,
  onFrame?: FrameHook,
): Promise<Blob> {
  const { width, height } = opts;
  const scale = Math.min(2, 1600 / Math.max(width, height));
  const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);
  const gif = GIFEncoder();
  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.imageSmoothingQuality = 'high';
  const delay = 1000 / opts.fps;

  await renderFrames(src, settings, { ...opts, width: even(width * scale), height: even(height * scale) }, async (frame) => {
    sctx.drawImage(frame, 0, 0, width, height);
    const rgba = sctx.getImageData(0, 0, width, height).data;
    const palette = quantize(rgba, 256, { format: 'rgb444' });
    const index = applyPalette(rgba, palette, 'rgb444');
    gif.writeFrame(index, width, height, { palette, delay });
    await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
  }, onProgress, signal, onFrame);

  gif.finish();
  return new Blob([gif.bytes().slice()], { type: 'image/gif' });
}
