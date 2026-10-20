// Regenerates every README / social / in-app demo asset from procedural scenes:
//   npm run assets            → all
//   npm run assets -- logo    → just one (logo | presets | social | reel | demo-source)
import '../mcp/platform';
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { AsciiRenderer, DEFAULTS, type Settings } from '../src/ascii';
import { drawCompare } from '../src/compare';
import { BUILTIN_PRESETS } from '../src/presets';
import { run, bin, spawnFf, writeFrame } from '../mcp/ffmpeg';
import { drawCube, drawDonut, drawMandel } from './scenes';

type Ctx = SKRSContext2D;
type Scene = (ctx: Ctx, W: number, H: number, t: number) => void;

const ASSETS = 'docs/assets';
mkdirSync(ASSETS, { recursive: true });

const MONO = '"JetBrains Mono", Menlo, monospace';
const RED = '#ff1f2d';

const preset = (id: string, extra: Partial<Settings> = {}): Settings => {
  const p = BUILTIN_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown preset ${id}`);
  return { ...DEFAULTS, ...p.s, ...extra };
};

const LABELS: Record<string, string> = {
  xand0dev: 'xand0dev', reference: 'Reference', blood: 'Blood', chrome: 'Chrome', matrix: 'Matrix',
  thermal: 'Thermal', braille: 'Braille', halftone: 'Halftone', newspaper: 'Newspaper', amber: 'Amber CRT',
  ice: 'Ice', neon: 'Neon', ghost: 'Ghost', redrain: 'Red rain', echo: 'Echo', binary: 'Binary',
};

const asCanvas = (c: Canvas) => c as unknown as HTMLCanvasElement;
const size = (p: string) => `${(statSync(p).size / 1e6).toFixed(2)} MB`;

/** Scenes are drawn at a working resolution, then scaled into the frame (the mandelbrot is the expensive one). */
function sceneSource(scene: Scene, W: number, H: number, work = 1) {
  const w = Math.round(W * work), h = Math.round(H * work);
  const small = createCanvas(w, h);
  const full = createCanvas(W, H);
  return (t: number) => {
    scene(small.getContext('2d'), w, h, t);
    const ctx = full.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, W, H);
    return full;
  };
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Small "preset: name" tag in the corner of a frame. */
function pill(ctx: Ctx, text: string, x: number, y: number, u: number) {
  ctx.font = `700 ${15 * u}px ${MONO}`;
  const w = ctx.measureText(text).width + 34 * u;
  const h = 32 * u;
  ctx.fillStyle = 'rgba(8,8,10,.78)';
  roundRect(ctx, x, y - h, w, h, 8 * u);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,31,45,.55)';
  ctx.lineWidth = 1.2 * u;
  ctx.stroke();
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.arc(x + 14 * u, y - h / 2, 3.5 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2f2f4';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, x + 24 * u, y - h / 2 + u);
}

async function encodeMp4(path: string, W: number, H: number, fps: number, frames: number, draw: (i: number) => Canvas, crf = 20) {
  const enc = spawnFf([
    '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path,
  ]);
  for (let i = 0; i < frames; i++) {
    const c = draw(i);
    const d = c.getContext('2d').getImageData(0, 0, W, H).data;
    await writeFrame(enc.proc, Buffer.from(d.buffer, d.byteOffset, d.byteLength));
    if (i % 30 === 0) process.stdout.write(`\r  ${path}: ${Math.round((i / frames) * 100)}%   `);
  }
  enc.proc.stdin.end();
  await enc.done;
  process.stdout.write(`\r  ${path}: ${size(path)}            \n`);
}

// ───────── logo ─────────
function makeLogo() {
  const S = 512;
  const c = createCanvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, '#7a0009');
  g.addColorStop(0.45, '#d90b1c');
  g.addColorStop(1, '#ff3b45');
  roundRect(ctx, 0, 0, S, S, 116);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // faint glyph texture
  ctx.font = `700 22px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const ramp = " .:-=+*#%@";
  for (let y = 0; y < 22; y++) {
    for (let x = 0; x < 30; x++) {
      const v = 0.5 + 0.5 * Math.sin(x * 0.45 + y * 0.3) * Math.cos(y * 0.25 - x * 0.12);
      ctx.fillStyle = `rgba(255,255,255,${0.05 + v * 0.07})`;
      ctx.fillText(ramp[Math.floor(v * (ramp.length - 1))], x * 17 + 8, y * 24 + 10);
    }
  }
  const shine = ctx.createRadialGradient(S * 0.3, S * 0.2, 0, S * 0.3, S * 0.2, S * 0.8);
  shine.addColorStop(0, 'rgba(255,255,255,.22)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.fillRect(0, 0, S, S);
  ctx.restore();
  ctx.shadowColor = 'rgba(60,0,4,.55)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#fff';
  ctx.font = `800 360px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('@', S / 2, S / 2 + 18);
  writeFileSync(`${ASSETS}/logo.png`, c.toBuffer('image/png'));
  console.log(`  ${ASSETS}/logo.png`);
  return c;
}

// ───────── preset gallery ─────────
function makePresets() {
  const ids = ['xand0dev', 'matrix', 'thermal', 'chrome', 'neon', 'halftone', 'braille', 'amber', 'blood', 'ice', 'newspaper', 'redrain'];
  const TW = 480, TH = 270, GAP = 12, COLS = 4;
  const rows = Math.ceil(ids.length / COLS);
  const sheet = createCanvas(COLS * TW + (COLS - 1) * GAP, rows * TH + (rows - 1) * GAP);
  const sc = sheet.getContext('2d');
  const src = sceneSource(drawDonut, TW * 2, TH * 2, 0.7);
  const frame = src(0.5);
  ids.forEach((id, k) => {
    const out = createCanvas(TW * 2, TH * 2);
    const r = new AsciiRenderer(asCanvas(out));
    r.setSize(TW * 2, TH * 2);
    r.render(asCanvas(frame), TW * 2, TH * 2, preset(id, { columns: 110, noise: 0 }), false, { time: 2.2 });
    const x = (k % COLS) * (TW + GAP), y = Math.floor(k / COLS) * (TH + GAP);
    sc.save();
    roundRect(sc, x, y, TW, TH, 14);
    sc.clip();
    sc.drawImage(out, x, y, TW, TH);
    sc.restore();
    pill(sc, LABELS[id] ?? id, x + 14, y + TH - 14, 1);
  });
  writeFileSync(`${ASSETS}/presets.png`, sheet.toBuffer('image/png'));
  console.log(`  ${ASSETS}/presets.png`);
}

// ───────── social preview (GitHub → Settings → Social preview) ─────────
function makeSocial(logo: Canvas) {
  const W = 1280, H = 640;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, W, H);
  const AW = 600;
  const src = sceneSource(drawCube, AW, H)(1.15);
  const art = createCanvas(AW, H);
  const r = new AsciiRenderer(asCanvas(art));
  r.setSize(AW, H);
  r.render(asCanvas(src), AW, H, preset('xand0dev', { columns: 78, noise: 0, bg: '#050505' }), false, { time: 3 });
  ctx.drawImage(art, W - AW, 0);
  const fade = ctx.createLinearGradient(W - AW, 0, W - AW + 120, 0);
  fade.addColorStop(0, '#050505');
  fade.addColorStop(1, 'rgba(5,5,5,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(W - AW, 0, 120, H);

  ctx.drawImage(logo, 80, 112, 104, 104);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.font = `800 80px ${MONO}`;
  ctx.fillText('ASCII', 80, 330);
  ctx.fillStyle = RED;
  ctx.fillText('render', 80 + ctx.measureText('ASCII ').width, 330);
  ctx.fillStyle = '#b4b4bc';
  ctx.font = `500 26px ${MONO}`;
  ctx.fillText('Turn any video into living ASCII art.', 80, 392);
  const chips = ['browser editor', 'AI tool · MCP', 'MP4 · GIF', '100% local'];
  let x = 80;
  ctx.font = `600 20px ${MONO}`;
  for (const chip of chips) {
    const w = ctx.measureText(chip).width + 32;
    roundRect(ctx, x, 440, w, 44, 22);
    ctx.fillStyle = 'rgba(255,31,45,.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,31,45,.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffb3b7';
    ctx.textBaseline = 'middle';
    ctx.fillText(chip, x + 16, 463);
    x += w + 12;
  }
  writeFileSync(`${ASSETS}/social-preview.png`, c.toBuffer('image/png'));
  console.log(`  ${ASSETS}/social-preview.png`);
}

// ───────── demo reel ─────────
interface Shot {
  dur: number;
  source: (t: number) => Canvas;
  look: (t: number) => Settings;
  label?: (t: number) => string | null;
  compare?: boolean;
}

async function makeReel() {
  const W = 1280, H = 720, FPS = 30;
  const cycle = ['xand0dev', 'matrix', 'thermal', 'chrome', 'neon', 'braille', 'amber', 'halftone'];
  const step = 0.75;
  const shots: Shot[] = [
    {
      dur: 4.2, source: sceneSource(drawCube, W, H), compare: true,
      look: () => preset('xand0dev', { columns: 140, noise: 0 }),
    },
    {
      dur: cycle.length * step, source: sceneSource(drawDonut, W, H, 0.6),
      look: (t) => preset(cycle[Math.floor(t / step) % cycle.length], { columns: 132, noise: 0 }),
      label: (t) => `preset · ${LABELS[cycle[Math.floor(t / step) % cycle.length]]}`,
    },
    {
      dur: 3.6, source: sceneSource(drawMandel, W, H, 0.42),
      look: () => preset('thermal', { columns: 150, noise: 0 }),
      label: () => 'thermal · fractal zoom',
    },
    {
      dur: 4.4, source: sceneSource(drawCube, W, H),
      look: () => preset('xand0dev', {
        columns: 170, decode: 1.3, overlayText: 'ASCII RENDER', overlaySize: 0.24, overlayPos: 'bottom', glitch: 0.18, rain: 0.22,
      }),
      label: (t) => (t > 1.6 ? 'decode · rain · glitch · text' : null),
    },
  ];
  const out = createCanvas(W, H);
  const comp = createCanvas(W, H);
  const renderer = new AsciiRenderer(asCanvas(out));
  renderer.setSize(W, H);
  const plan: { shot: Shot; t: number; first: boolean }[] = [];
  for (const shot of shots) {
    const n = Math.round(shot.dur * FPS);
    for (let i = 0; i < n; i++) plan.push({ shot, t: i / FPS, first: i === 0 });
  }
  await encodeMp4(`${ASSETS}/demo.mp4`, W, H, FPS, plan.length, (i) => {
    const { shot, t, first } = plan[i];
    if (first) renderer.resetTemporal();
    const src = shot.source(t);
    renderer.render(asCanvas(src), W, H, shot.look(t), false, { time: t });
    let frame = out;
    if (shot.compare) {
      // offset so the divider sweeps right → left across the cube during the shot
      drawCompare(asCanvas(comp), asCanvas(src), asCanvas(out), { x: 0, y: 0, w: W, h: H }, t + 2.4, ['ORIGINAL', 'ASCII']);
      frame = comp;
    }
    const label = shot.label?.(t);
    if (label) pill(frame.getContext('2d'), label, 24, H - 24, 1.25);
    return frame;
  }, 25);

  // GIF for the README (GitHub only plays videos that are uploaded through its UI)
  await run(bin('ffmpeg'), [
    '-y', '-v', 'error', '-i', `${ASSETS}/demo.mp4`,
    '-vf', 'fps=10,scale=600:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    '-loop', '0', `${ASSETS}/demo.gif`,
  ]);
  console.log(`  ${ASSETS}/demo.gif: ${size(`${ASSETS}/demo.gif`)}`);
}

// ───────── source footage for the in-app "Try the demo" button ─────────
async function makeDemoSource() {
  // small on purpose: it is downloaded by every visitor of the live demo, and the ASCII grid doesn't need more pixels
  const W = 960, H = 540, FPS = 30;
  const parts: [Scene, number, number][] = [[drawCube, 6, 1], [drawDonut, 5, 0.6], [drawMandel, 4, 0.42]];
  const sources = parts.map(([scene, dur, work]) => ({ src: sceneSource(scene, W, H, work), dur }));
  const plan: { k: number; t: number }[] = [];
  sources.forEach((s, k) => { for (let i = 0; i < s.dur * FPS; i++) plan.push({ k, t: i / FPS }); });
  mkdirSync('public', { recursive: true });
  await encodeMp4('public/demo.mp4', W, H, FPS, plan.length, (i) => sources[plan[i].k].src(plan[i].t), 28);
}

const only = process.argv[2];
const want = (name: string) => !only || only === name;
console.log('Generating assets…');
const logo = makeLogo();
if (want('presets')) makePresets();
if (want('social')) makeSocial(logo);
if (want('reel')) await makeReel();
if (want('demo-source')) await makeDemoSource();
console.log('Done.');
