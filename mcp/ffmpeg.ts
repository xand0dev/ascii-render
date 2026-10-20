import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { once } from 'node:events';

/** Claude Desktop starts servers with a minimal PATH, so look in the usual Homebrew/system places too. */
export function bin(name: 'ffmpeg' | 'ffprobe'): string {
  const fromEnv = process.env[`${name.toUpperCase()}_PATH`];
  if (fromEnv) return fromEnv;
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) {
    const p = `${dir}/${name}`;
    if (existsSync(p)) return p;
  }
  return name;
}

export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
  fps: number;
  hasAudio: boolean;
  sampleRate: number;
}

/** Runs a command to completion and collects stdout. */
export function run(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    const out: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (c: Buffer) => out.push(c));
    p.stderr.on('data', (c: Buffer) => { err += c.toString(); });
    p.on('error', (e) => reject(new Error(`${cmd}: ${e.message}. Установлен ли ffmpeg? (brew install ffmpeg)`)));
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim().split('\n').slice(-3).join('\n') || `${cmd} exited ${code}`))));
  });
}

export async function probe(path: string): Promise<VideoInfo> {
  const json = JSON.parse((await run(bin('ffprobe'), [
    '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path,
  ])).toString());
  const v = json.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
  if (!v) throw new Error('В файле нет видеодорожки');
  const a = json.streams?.find((s: { codec_type: string }) => s.codec_type === 'audio');
  const [num, den] = String(v.avg_frame_rate || v.r_frame_rate || '30/1').split('/').map(Number);
  // honour rotation metadata from phones
  const rot = Math.abs(Number(v.tags?.rotate ?? v.side_data_list?.find((d: { rotation?: number }) => d.rotation !== undefined)?.rotation ?? 0));
  const swap = rot === 90 || rot === 270;
  return {
    width: swap ? v.height : v.width,
    height: swap ? v.width : v.height,
    duration: Number(json.format?.duration ?? v.duration ?? 0),
    fps: den ? num / den : num || 30,
    hasAudio: !!a,
    sampleRate: a ? Number(a.sample_rate) || 48000 : 0,
  };
}

/** Mono float PCM of the whole file, for the bass envelope. */
export async function readAudioMono(path: string, sampleRate = 22050): Promise<Float32Array | null> {
  try {
    const buf = await run(bin('ffmpeg'), ['-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1']);
    if (!buf.length) return null;
    const copy = new Uint8Array(buf.length);
    copy.set(buf);
    return new Float32Array(copy.buffer, 0, Math.floor(buf.length / 4));
  } catch {
    return null;
  }
}

/** Pulls fixed-size raw frames out of an ffmpeg stdout stream with backpressure. */
export function frameReader(proc: ChildProcessWithoutNullStreams, frameBytes: number) {
  const chunks: Buffer[] = [];
  let buffered = 0;
  let ended = false;
  let wake: (() => void) | null = null;
  proc.stdout.on('data', (c: Buffer) => {
    chunks.push(c);
    buffered += c.length;
    if (buffered > frameBytes * 3) proc.stdout.pause();
    wake?.();
  });
  proc.stdout.on('end', () => { ended = true; wake?.(); });

  return async function next(): Promise<Buffer | null> {
    while (buffered < frameBytes) {
      if (ended) return null;
      proc.stdout.resume();
      await new Promise<void>((r) => { wake = r; });
      wake = null;
    }
    const out = Buffer.allocUnsafe(frameBytes);
    let off = 0;
    while (off < frameBytes) {
      const c = chunks[0];
      const take = Math.min(c.length, frameBytes - off);
      c.copy(out, off, 0, take);
      off += take;
      if (take === c.length) chunks.shift();
      else chunks[0] = c.subarray(take);
    }
    buffered -= frameBytes;
    if (buffered < frameBytes * 2) proc.stdout.resume();
    return out;
  };
}

export async function writeFrame(proc: ChildProcessWithoutNullStreams, buf: Buffer) {
  if (!proc.stdin.write(buf)) await once(proc.stdin, 'drain');
}

export function spawnFf(args: string[]) {
  const p = spawn(bin('ffmpeg'), args);
  let stderr = '';
  p.stderr.on('data', (c: Buffer) => { stderr += c.toString(); if (stderr.length > 20000) stderr = stderr.slice(-10000); });
  const done = new Promise<void>((resolve, reject) => {
    p.on('error', (e) => reject(new Error(`ffmpeg: ${e.message}. Установлен ли ffmpeg? (brew install ffmpeg)`)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim().split('\n').slice(-4).join('\n') || `ffmpeg exited ${code}`))));
  });
  return { proc: p, done };
}
