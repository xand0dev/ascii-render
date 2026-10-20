import './style.css';
import { AsciiRenderer, DEFAULTS, FONT_FAMILY, fontFamily, type Settings } from './ascii';
import { cropFor, resolveLook } from './looks';
import { exportGif, exportMp4, type CompareMode, type Crop } from './export';
import { buildEnvelope, detectBeats, sampleEnvelope, type Envelope } from './audio';
import { BUILTIN_PRESETS, randomSettings, type Preset } from './presets';
import { Controls } from './ui/controls';
import { Hero } from './ui/hero';
import { hydrateIcons, icon } from './ui/icons';
import { Timeline, fmtTime } from './ui/timeline';
import { toast } from './ui/toast';
import { Viewer, type ViewMode } from './ui/viewer';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
hydrateIcons();

// ───────── state ─────────
const SETTINGS_KEY = 'ascii-render-settings';
const USER_PRESETS_KEY = 'ascii-render-user-presets';
const EXPORT_KEY = 'ascii-render-export';

const load = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch { return fallback; }
};
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

let settings: Settings = { ...DEFAULTS, ...load<Partial<Settings>>(SETTINGS_KEY, {}) };
let userPresets: Preset[] = load<Preset[]>(USER_PRESETS_KEY, []);
interface ExportPrefs {
  res: number; fps: number; q: number; audio: boolean;
  format: 'mp4' | 'gif'; gifW: number; gifFps: number; compare: CompareMode; aspect: string;
}
const exportOpts: ExportPrefs = {
  res: 1080, fps: 30, q: 0.25, audio: true, format: 'mp4', gifW: 480, gifFps: 15, compare: 'none', aspect: 'source',
  ...load<Partial<ExportPrefs>>(EXPORT_KEY, {}),
};

// keyframes A → B and beat-synced preset switching
const ANIM_KEY = 'ascii-render-anim';
const BEAT_KEY = 'ascii-render-beat';
const savedAnim = load<{ on?: boolean; a?: Partial<Settings> | null; b?: Partial<Settings> | null }>(ANIM_KEY, {});
const anim = {
  on: !!savedAnim.on,
  a: savedAnim.a ? ({ ...DEFAULTS, ...savedAnim.a } as Settings) : null,
  b: savedAnim.b ? ({ ...DEFAULTS, ...savedAnim.b } as Settings) : null,
};
const beatSync = {
  on: false,
  ids: BUILTIN_PRESETS.slice(0, 4).map((p) => p.id),
  sens: 0.5,
  ...load<Partial<{ on: boolean; ids: string[]; sens: number }>>(BEAT_KEY, {}),
};
let beats: number[] = [];

type Source = 'none' | 'file' | 'camera';
let source: Source = 'none';
let currentFile: File | null = null;
let currentUrl = '';
let camStream: MediaStream | null = null;
let envelope: Envelope | null = null;
let camStart = 0;
let loop = true;
const SPEEDS = [1, 2, 3, 4, 5, 8, 10, 15];
let speed = 1;

// ───────── elements ─────────
const video = $<HTMLVideoElement>('video');
const canvas = $<HTMLCanvasElement>('out');
const viewport = $('viewport');
const renderer = new AsciiRenderer(canvas);
const viewer = new Viewer(viewport, $('frame'), canvas, $('origLayer'), $('wipeHandle'));
const timeline = new Timeline($('timeline'));
const hero = new Hero($<HTMLCanvasElement>('heroCanvas'));
hero.start();

// ───────── history ─────────
const history = { stack: [JSON.stringify(settings)], idx: 0 };
let historyTimer = 0;
function pushHistory() {
  clearTimeout(historyTimer);
  historyTimer = window.setTimeout(() => {
    const snap = JSON.stringify(settings);
    if (snap === history.stack[history.idx]) return;
    history.stack = history.stack.slice(0, history.idx + 1);
    history.stack.push(snap);
    if (history.stack.length > 150) history.stack.shift();
    history.idx = history.stack.length - 1;
    syncHistoryButtons();
  }, 280);
}
function stepHistory(dir: -1 | 1) {
  const next = history.idx + dir;
  if (next < 0 || next >= history.stack.length) return;
  history.idx = next;
  settings = JSON.parse(history.stack[next]);
  applySettings(false);
  toast(dir < 0 ? 'Отменено' : 'Повторено', 'info', 1200);
}
function syncHistoryButtons() {
  $<HTMLButtonElement>('undoBtn').disabled = history.idx <= 0;
  $<HTMLButtonElement>('redoBtn').disabled = history.idx >= history.stack.length - 1;
}

// ───────── controls ─────────
let replayTimer = 0;
const controls = new Controls($('controls'), (key, value) => {
  (settings as unknown as Record<string, unknown>)[key] = value;
  applySettings();
  // show the intro right away while tuning it
  if (key === 'decode' && Number(value) > 0 && source === 'file') {
    clearTimeout(replayTimer);
    replayTimer = window.setTimeout(() => {
      video.currentTime = timeline.inPoint;
      video.play();
    }, 350);
  }
  if (key === 'font') ensureFont(settings).then(() => { requestRender(); renderPresetThumbs(); });
  if (key === 'audioReact' && Number(value) > 0 && source === 'file' && !envelope) {
    toast('В этом видео нет звука, реагировать не на что', 'info', 2500);
  }
});

function applySettings(record = true) {
  controls.sync(settings);
  save(SETTINGS_KEY, settings);
  if (record) pushHistory();
  syncHistoryButtons();
  markActivePreset();
  requestRender();
}

// ───────── presets ─────────
const presetsEl = $('presets');
const presetsMore = $<HTMLButtonElement>('presetsMore');
const PRESETS_VISIBLE = 4;
const PRESETS_OPEN_KEY = 'ascii-render-presets-open';
let presetsOpen = load<boolean>(PRESETS_OPEN_KEY, false);
presetsMore.addEventListener('click', () => {
  presetsOpen = !presetsOpen;
  save(PRESETS_OPEN_KEY, presetsOpen);
  presetsEl.classList.toggle('open', presetsOpen);
  syncPresetsMore();
});

function syncPresetsMore() {
  const list = allPresets();
  const hiddenCount = Math.max(0, list.length - PRESETS_VISIBLE);
  presetsMore.hidden = hiddenCount === 0;
  if (presetsOpen) {
    presetsMore.innerHTML = `<span>Свернуть</span>${icon('chevron', 14)}`;
  } else {
    const active = presetsEl.querySelector<HTMLElement>('.preset.extra.on');
    const name = active ? list.find((p) => p.id === active.dataset.id)?.name : '';
    presetsMore.innerHTML = `<span>Все пресеты</span><em>+${hiddenCount}</em>${name ? `<i class="pm-active">● ${name}</i>` : ''}${icon('chevron', 14)}`;
  }
  presetsMore.classList.toggle('open', presetsOpen);
}
const presetThumbs = new Map<string, HTMLCanvasElement>();

function allPresets(): Preset[] {
  return [...BUILTIN_PRESETS, ...userPresets];
}

function buildPresets() {
  presetsEl.innerHTML = '';
  presetThumbs.clear();
  presetsEl.classList.toggle('open', presetsOpen);
  allPresets().forEach((p, index) => {
    const card = document.createElement('button');
    card.className = index >= PRESETS_VISIBLE ? 'preset extra' : 'preset';
    card.style.setProperty('--i', String(Math.max(0, index - PRESETS_VISIBLE)));
    card.dataset.id = p.id;
    card.innerHTML = `<canvas></canvas><span class="p-name"></span>${p.user ? `<span class="p-del" title="Удалить">${icon('x', 12)}</span>` : ''}`;
    card.querySelector('.p-name')!.textContent = p.name;
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.p-del')) {
        userPresets = userPresets.filter((u) => u.id !== p.id);
        save(USER_PRESETS_KEY, userPresets);
        buildPresets();
        toast(`Пресет «${p.name}» удалён`);
        return;
      }
      settings = { ...DEFAULTS, ...p.s };
      applySettings();
    });
    presetsEl.appendChild(card);
    presetThumbs.set(p.id, card.querySelector('canvas')!);
  });
  markActivePreset();
  renderPresetThumbs();
  syncBeatUI();
}

function markActivePreset() {
  const cur = JSON.stringify({ ...DEFAULTS, ...settings });
  presetsEl.querySelectorAll<HTMLElement>('.preset').forEach((el) => {
    const p = allPresets().find((x) => x.id === el.dataset.id);
    el.classList.toggle('on', !!p && JSON.stringify({ ...DEFAULTS, ...p.s }) === cur);
  });
  syncPresetsMore();
}

const thumbRenderer = new AsciiRenderer(document.createElement('canvas'));
let thumbTimer = 0;
function renderPresetThumbs() {
  clearTimeout(thumbTimer);
  thumbTimer = window.setTimeout(() => {
    for (const p of allPresets()) {
      const c = presetThumbs.get(p.id);
      if (c) drawThumb(c, { ...DEFAULTS, ...p.s });
    }
    syncAnimSlots();
  }, 120);
}

/** Small preview of a look on the current frame (or on a placeholder gradient). */
function drawThumb(c: HTMLCanvasElement, look: Settings, w = 300, h = Math.round(300 * 0.62)) {
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const s = { ...look, noise: 0, trails: 0, motion: 0 };
  if (source !== 'none' && video.videoWidth && video.readyState >= 2) {
    const vw = video.videoWidth, vh = video.videoHeight;
    // render the full frame, then cover-crop it into the card
    const rw = 420;
    const rh = Math.round((rw * vh) / vw);
    thumbRenderer.setSize(rw, rh);
    thumbRenderer.render(video, vw, vh, { ...s, columns: Math.max(36, Math.round(s.columns * 0.42)) }, source === 'camera');
    const scale = Math.max(w / rw, h / rh);
    const dw = rw * scale, dh = rh * scale;
    ctx.fillStyle = s.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(thumbRenderer.out, (w - dw) / 2, (h - dh) / 2, dw, dh);
  } else {
    drawPresetSwatch(ctx, s, w, h);
  }
}

/** Placeholder thumbnail before any video is loaded: a gradient rendered with the preset's glyphs. */
function drawPresetSwatch(ctx: CanvasRenderingContext2D, s: Settings, w: number, h: number) {
  const g = document.createElement('canvas');
  g.width = 64;
  g.height = 40;
  const gc = g.getContext('2d')!;
  const grad = gc.createRadialGradient(32, 20, 2, 32, 20, 36);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.22, '#ff2030');
  grad.addColorStop(0.5, '#7a7a80');
  grad.addColorStop(1, '#000');
  gc.fillStyle = grad;
  gc.fillRect(0, 0, 64, 40);
  thumbRenderer.setSize(w, h);
  thumbRenderer.render(g, 64, 40, { ...s, columns: 46, noise: 0 });
  ctx.drawImage(thumbRenderer.out, 0, 0);
}

$('savePresetBtn').addEventListener('click', () => {
  const f = $('savePresetForm');
  f.hidden = !f.hidden;
  if (!f.hidden) $<HTMLInputElement>('presetName').focus();
});
$<HTMLFormElement>('savePresetForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('presetName');
  const name = input.value.trim() || `Мой стиль ${userPresets.length + 1}`;
  userPresets.push({ id: `u${Date.now()}`, name, s: { ...settings }, user: true });
  save(USER_PRESETS_KEY, userPresets);
  input.value = '';
  $('savePresetForm').hidden = true;
  buildPresets();
  toast(`Пресет «${name}» сохранён`, 'ok');
});
$('randomBtn').addEventListener('click', randomize);
function randomize() {
  settings = randomSettings(settings);
  applySettings();
  const btn = $('randomBtn');
  btn.classList.remove('spin');
  void btn.offsetWidth;
  btn.classList.add('spin');
}
$('resetBtn').addEventListener('click', () => {
  settings = { ...DEFAULTS };
  applySettings();
  toast('Настройки сброшены');
});

// ───────── rendering ─────────
/** Centered source region for the chosen frame format. */
function cropRect(): Crop {
  return cropFor(video.videoWidth || 1280, video.videoHeight || 720, exportOpts.aspect);
}

function outputSize() {
  const { w: vw, h: vh } = cropRect();
  const q = exportOpts.res;
  const scale = q > 0 ? q / Math.min(vw, vh) : 1;
  const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);
  return { width: even(vw * scale), height: even(vh * scale) };
}

function applySize() {
  if (source === 'none') return;
  // live preview resolution: export size for files, 1080p cap for camera
  const { width, height } = source === 'camera'
    ? (() => {
      const { w: vw, h: vh } = cropRect();
      const s = Math.min(1, 1080 / Math.min(vw, vh));
      return { width: Math.round((vw * s) / 2) * 2, height: Math.round((vh * s) / 2) * 2 };
    })()
    : outputSize();
  renderer.setSize(width, height);
  renderer.resetTemporal();
  viewer.setAspect(width / height);
  video.style.objectFit = exportOpts.aspect === 'source' ? 'fill' : 'cover';
  $('statRes').textContent = `${width}×${height}`;
  requestRender();
}

let pending = false;
function requestRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    renderNow();
  });
}

let avgMs = 0;
function renderNow() {
  if (source === 'none' || !video.videoWidth || video.readyState < 2) return;
  const t = performance.now();
  const crop = cropRect();
  const fx = source === 'camera'
    ? { time: (performance.now() - camStart) / 1000, audio: 0, crop }
    : { time: Math.max(0, video.currentTime - timeline.inPoint) / speed, audio: sampleEnvelope(envelope, video.currentTime), crop };
  const look = source === 'file' ? lookAt(video.currentTime) : settings;
  renderer.render(video, video.videoWidth, video.videoHeight, look, source === 'camera', fx);
  updateMeter(fx.audio);
  const dt = performance.now() - t;
  avgMs = avgMs ? avgMs * 0.85 + dt * 0.15 : dt;
  const cols = Math.round(look.columns);
  const rows = Math.max(1, Math.round(canvas.height / ((canvas.width / cols) * look.cellAspect)));
  $('statGrid').textContent = `${cols}×${rows} симв.`;
  $('statMs').textContent = `${avgMs.toFixed(1)} мс`;
  $('statMs').classList.toggle('warn', avgMs > 33);
}

/** The look at a source time: beat-switched preset, A → B blend, or the static settings. */
function lookAt(srcT: number): Settings {
  const beatLooks = beatSync.on
    ? beatSync.ids.map((id) => allPresets().find((p) => p.id === id)?.s).filter((x): x is Settings => !!x)
    : [];
  return resolveLook({
    base: settings,
    start: timeline.inPoint,
    end: timeline.outPoint,
    beats: beatSync.on ? beats : [],
    beatLooks,
    animA: anim.on ? anim.a : null,
    animB: anim.on ? anim.b : null,
  }, srcT);
}

function ensureFont(s: Settings) {
  return document.fonts.load(`${s.fontWeight} 20px ${fontFamily(s)}`).catch(() => []);
}

const meterBars = Array.from(document.querySelectorAll<HTMLElement>('#audioMeter i'));
function updateMeter(level: number) {
  const on = settings.audioReact > 0 && !!envelope;
  $('audioMeter').hidden = !on;
  if (!on) return;
  meterBars.forEach((b, k) => {
    const v = Math.min(1, level * (1.25 - k * 0.12) + (k % 2) * 0.04);
    b.style.transform = `scaleY(${0.15 + v * 0.85})`;
    b.classList.toggle('hot', v > 0.7);
  });
}

function frameLoop() {
  if (video.paused || video.ended) return;
  if (source === 'file' && timeline.duration) {
    if (video.currentTime >= timeline.outPoint - 0.01 || video.currentTime < timeline.inPoint - 0.05) {
      if (loop || video.currentTime < timeline.inPoint) video.currentTime = timeline.inPoint;
      else { video.pause(); video.currentTime = timeline.outPoint; }
    }
  }
  renderNow();
  updateTime();
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(frameLoop);
  else requestAnimationFrame(frameLoop);
}

function updateTime() {
  $('tcCur').textContent = fmtTime(video.currentTime);
  timeline.setTime(video.currentTime);
}

video.addEventListener('play', () => { syncPlay(); frameLoop(); });
video.addEventListener('pause', syncPlay);
video.addEventListener('seeked', () => { renderer.resetTemporal(); requestRender(); updateTime(); renderPresetThumbsDebounced(); });
video.addEventListener('loadeddata', () => {
  requestRender();
  renderPresetThumbs();
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(() => requestRender());
});
video.addEventListener('canplay', requestRender);
video.addEventListener('loadstart', () => { if (source === 'file') video.playbackRate = speed; });
video.addEventListener('loadedmetadata', () => {
  applySize();
  if (source === 'file') {
    timeline.setDuration(video.duration);
    $('tcDur').textContent = fmtTime(video.duration);
    timeline.generateThumbs(currentUrl, video.videoWidth / video.videoHeight);
    refreshBeats();
    $('fileMeta').textContent = `${video.videoWidth}×${video.videoHeight} · ${fmtTime(video.duration, false)}`;
  }
});

let presetThumbTimer = 0;
function renderPresetThumbsDebounced() {
  clearTimeout(presetThumbTimer);
  presetThumbTimer = window.setTimeout(renderPresetThumbs, 400);
}

// ───────── transport ─────────
const playBtn = $('playBtn');
function syncPlay() {
  playBtn.innerHTML = icon(video.paused ? 'play' : 'pause', 18);
  playBtn.classList.toggle('playing', !video.paused);
}
syncPlay();
function togglePlay() {
  if (source !== 'file') return;
  if (video.paused) {
    if (video.currentTime >= timeline.outPoint - 0.02) video.currentTime = timeline.inPoint;
    video.play();
  } else video.pause();
}
playBtn.addEventListener('click', togglePlay);
const FRAME = 1 / 30;
function step(dt: number) {
  if (source !== 'file') return;
  video.pause();
  video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + dt));
}
$('stepBack').addEventListener('click', () => step(-FRAME));
$('stepFwd').addEventListener('click', () => step(FRAME));

const loopBtn = $('loopBtn');
function toggleLoop() {
  loop = !loop;
  loopBtn.classList.toggle('on', loop);
  toast(loop ? 'Зацикливание включено' : 'Зацикливание выключено', 'info', 1200);
}
loopBtn.addEventListener('click', toggleLoop);

// ───────── speed ─────────
const speedPop = $('speedPop');
const speedRange = $<HTMLInputElement>('speedRange');
function chips(host: HTMLElement) {
  host.innerHTML = SPEEDS.map((v) => `<button data-v="${v}">${v}×</button>`).join('');
  host.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (b) setSpeed(Number(b.dataset.v));
  });
}
chips($('speedChips'));
chips($('optSpeed'));
function setSpeed(v: number, announce = false) {
  speed = Math.min(15, Math.max(1, Math.round(v)));
  video.defaultPlaybackRate = speed;
  video.playbackRate = speed;
  speedRange.value = String(speed);
  speedRange.style.setProperty('--p', `${((speed - 1) / 14) * 100}%`);
  $('speedVal').textContent = `${speed}×`;
  $('speedPopVal').textContent = `${speed}×`;
  $('speedBtn').classList.toggle('on', speed > 1);
  document.querySelectorAll<HTMLElement>('#speedChips button, #optSpeed button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.v) === speed);
  });
  timeline.onTrim?.(timeline.inPoint, timeline.outPoint);
  if (dlg.open) updateSummary();
  if (announce) toast(`Скорость ${speed}×`, 'info', 1000);
}
speedRange.addEventListener('input', () => setSpeed(Number(speedRange.value)));
$('speedBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  speedPop.hidden = !speedPop.hidden;
});
speedPop.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { speedPop.hidden = true; });
function stepSpeed(dir: 1 | -1) {
  const i = SPEEDS.findIndex((v) => v >= speed);
  const idx = dir > 0 ? (SPEEDS[i] === speed ? i + 1 : i) : (i <= 0 ? 0 : i - 1);
  setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, idx))], true);
}

const muteBtn = $('muteBtn');
function syncMute() { muteBtn.innerHTML = icon(video.muted ? 'volumeX' : 'volume', 16); }
muteBtn.addEventListener('click', () => { video.muted = !video.muted; syncMute(); });
syncMute();

timeline.onSeek = (t) => { video.currentTime = t; updateTime(); };
let wasPlaying = false;
timeline.onScrubStart = () => { wasPlaying = !video.paused; video.pause(); };
timeline.onScrubEnd = () => { if (wasPlaying) video.play(); };
timeline.onTrim = (a, b) => {
  $('inBtn').textContent = fmtTime(a);
  $('outBtn').textContent = fmtTime(b);
  $('trimLen').textContent = speed > 1 ? `${(b - a).toFixed(2)} с → ${((b - a) / speed).toFixed(2)} с` : `${(b - a).toFixed(2)} с`;
};
$('inBtn').addEventListener('click', () => timeline.setTrim(video.currentTime, timeline.outPoint));
$('outBtn').addEventListener('click', () => timeline.setTrim(timeline.inPoint, video.currentTime));

// ───────── view ─────────
const viewSeg = $('viewSeg');
function setMode(m: ViewMode) {
  viewer.setMode(m);
  viewSeg.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
}
viewSeg.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (b?.dataset.mode) setMode(b.dataset.mode as ViewMode);
});
viewer.onZoom = (s) => { $('zoomVal').textContent = `${Math.round(s * 100)}%`; };
$('zoomIn').addEventListener('click', () => viewer.zoomAt(1.5));
$('zoomOut').addEventListener('click', () => viewer.zoomAt(1 / 1.5));
$('zoomFit').addEventListener('click', () => viewer.fit());
$('zoomVal').addEventListener('click', () => viewer.oneToOne());
$('fullBtn').addEventListener('click', toggleFull);
function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen();
  else viewport.requestFullscreen?.();
}

async function copyAsText() {
  if (source === 'none') return;
  renderNow();
  const txt = renderer.asText();
  try {
    await navigator.clipboard.writeText(txt);
    const { cols, rows } = renderer.lastGrid;
    toast(`Скопировано: ${cols}×${rows} символов, вставляй куда угодно`, 'ok');
  } catch {
    download(new Blob([txt], { type: 'text/plain' }), `${baseName()}_ascii.txt`);
    toast('Буфер обмена недоступен, сохранил .txt', 'info');
  }
}
$('copyTxtBtn').addEventListener('click', copyAsText);

$('pngBtn').addEventListener('click', () => {
  canvas.toBlob((b) => {
    if (!b) return;
    download(b, `${baseName()}_ascii_${Math.round(video.currentTime * 100)}.png`);
    toast('Кадр сохранён', 'ok');
  }, 'image/png');
});

// ───────── sources ─────────
function setSourceUI() {
  const has = source !== 'none';
  document.body.classList.toggle('has-source', has);
  document.body.classList.toggle('is-camera', source === 'camera');
  $('hero').classList.toggle('gone', has);
  if (has) hero.stop(); else hero.start();
  for (const id of ['hudStats', 'hudZoom', 'hudSnap', 'hudAspect']) $(id).hidden = !has;
  $('fileChip').hidden = !has;
  $<HTMLButtonElement>('exportBtn').disabled = source !== 'file';
  $('liveDot').hidden = source !== 'camera';
  $('recBtn').hidden = source !== 'camera';
  $('origLayer').classList.toggle('mirror', source === 'camera');
}

function stopCamera() {
  camStream?.getTracks().forEach((t) => t.stop());
  camStream = null;
  if (recorder?.state === 'recording') recorder.stop();
}

function loadFile(file: File) {
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name)) {
    toast('Это не видеофайл', 'err');
    return;
  }
  stopCamera();
  video.srcObject = null;
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentFile = file;
  currentUrl = URL.createObjectURL(file);
  source = 'file';
  envelope = null;
  beats = [];
  buildEnvelope(file).then((env) => { if (currentFile === file) { envelope = env; refreshBeats(); requestRender(); } });
  video.src = currentUrl;
  video.loop = false;
  $('fileName').textContent = file.name;
  $('fileMeta').textContent = '';
  setSourceUI();
  viewer.fit();
  toast(`Загружено: ${file.name}`, 'ok');
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.pause();
    if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = ''; }
    video.removeAttribute('src');
    currentFile = null;
    camStream = stream;
    source = 'camera';
    envelope = null;
    camStart = performance.now();
    video.srcObject = stream;
    timeline.clear();
    $('fileName').textContent = 'Камера';
    $('fileMeta').textContent = 'в реальном времени';
    setSourceUI();
    viewer.fit();
    await video.play();
  } catch (err) {
    toast(`Нет доступа к камере: ${(err as Error).message}`, 'err', 4000);
  }
}

const fileInput = $<HTMLInputElement>('file');
const openPicker = () => fileInput.click();
fileInput.addEventListener('change', () => {
  if (fileInput.files?.[0]) loadFile(fileInput.files[0]);
  fileInput.value = '';
});
$('openBtn').addEventListener('click', openPicker);
$('heroOpen').addEventListener('click', openPicker);
$('camBtn').addEventListener('click', startCamera);
$('heroCam').addEventListener('click', startCamera);

/** Procedural demo clip shipped in public/ (regenerate with `npm run assets`). */
async function loadDemo(at = 0) {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}demo.mp4`);
    if (!res.ok) throw new Error(String(res.status));
    const file = new File([await res.blob()], 'demo.mp4', { type: 'video/mp4' });
    loadFile(file);
    video.addEventListener('loadeddata', () => {
      if (at > 0) video.currentTime = at;
      else video.play().catch(() => {});
    }, { once: true });
  } catch {
    toast('Демо-видео не найдено', 'err');
  }
}
$('heroDemo').addEventListener('click', () => loadDemo());

const dragOverlay = $('dragOverlay');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  dragOverlay.classList.add('on');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dragOverlay.classList.remove('on');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dragOverlay.classList.remove('on');
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  if (f.name.toLowerCase().endsWith('.json')) importStyle(f);
  else loadFile(f);
});

// ───────── camera recording ─────────
let recorder: MediaRecorder | null = null;
let recStart = 0;
let recTimer = 0;
$('recBtn').addEventListener('click', () => {
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const stream = canvas.captureStream(30);
  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16e6 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    clearInterval(recTimer);
    $('recBtn').classList.remove('on');
    $('recLabel').textContent = 'Запись';
    const type = recorder?.mimeType || 'video/webm';
    const blob = new Blob(chunks, { type });
    download(blob, `camera_ascii_${Date.now()}.${type.includes('mp4') ? 'mp4' : 'webm'}`);
    toast(`Запись сохранена · ${(blob.size / 1e6).toFixed(1)} МБ`, 'ok');
  };
  recorder.start(250);
  recStart = performance.now();
  $('recBtn').classList.add('on');
  recTimer = window.setInterval(() => {
    $('recLabel').textContent = fmtTime((performance.now() - recStart) / 1000, false);
  }, 250);
  $('recLabel').textContent = '00:00';
});

// ───────── export dialog ─────────
const dlg = $<HTMLDialogElement>('exportDlg');
const exportPreview = $<HTMLCanvasElement>('exportPreview');
const resultVideo = $<HTMLVideoElement>('resultVideo');
let abort: AbortController | null = null;
let resultBlob: Blob | null = null;
let resultUrl = '';

function setDlgState(state: 'config' | 'running' | 'done') {
  dlg.dataset.state = state;
  dlg.querySelectorAll<HTMLElement>('.dlg-state').forEach((el) => { el.hidden = el.dataset.state !== state; });
  $('ring').hidden = state !== 'running';
  const gifDone = state === 'done' && resultBlob?.type === 'image/gif';
  resultVideo.hidden = state !== 'done' || gifDone;
  $('resultImg').hidden = !gifDone;
  exportPreview.hidden = state === 'done';
  dlg.classList.toggle('fmt-gif', exportOpts.format === 'gif');
  const go = $<HTMLButtonElement>('dlgGo');
  const cancel = $<HTMLButtonElement>('dlgCancel');
  if (state === 'config') { go.hidden = false; go.innerHTML = `${icon('zap')}Рендерить`; cancel.textContent = 'Отмена'; }
  if (state === 'running') { go.hidden = true; cancel.textContent = 'Остановить'; }
  if (state === 'done') { go.hidden = false; go.innerHTML = `${icon('download')}Скачать ${gifDone ? 'GIF' : 'MP4'}`; cancel.textContent = 'Закрыть'; }
  if (state !== 'running') document.title = baseTitle;
}

const baseTitle = document.title;

function bindStrSeg<K extends 'format' | 'compare'>(id: string, key: K) {
  const seg = $(id);
  const sync = () => seg.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === exportOpts[key]));
  seg.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    (exportOpts as unknown as Record<string, unknown>)[key] = b.dataset.v;
    save(EXPORT_KEY, exportOpts);
    sync();
    dlg.classList.toggle('fmt-gif', exportOpts.format === 'gif');
    updateSummary();
  });
  sync();
}

function bindSeg(id: string, key: 'res' | 'fps' | 'q' | 'gifW' | 'gifFps') {
  const seg = $(id);
  const sync = () => seg.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === exportOpts[key]));
  seg.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    exportOpts[key] = Number(b.dataset.v);
    save(EXPORT_KEY, exportOpts);
    sync();
    updateSummary();
    if (key === 'res') applySize();
  });
  sync();
}
bindSeg('optRes', 'res');
bindSeg('optFps', 'fps');
bindSeg('optQ', 'q');
bindSeg('optGifW', 'gifW');
bindSeg('optGifFps', 'gifFps');
bindStrSeg('optFormat', 'format');
bindStrSeg('optCompare', 'compare');
const optAudio = $<HTMLInputElement>('optAudio');
optAudio.checked = exportOpts.audio;
optAudio.addEventListener('change', () => { exportOpts.audio = optAudio.checked; save(EXPORT_KEY, exportOpts); updateSummary(); });

function exportParams() {
  const out = outputSize();
  const gif = exportOpts.format === 'gif';
  const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);
  const width = gif ? even(exportOpts.gifW) : out.width;
  const height = gif ? even((exportOpts.gifW * out.height) / out.width) : out.height;
  const fps = gif ? exportOpts.gifFps : exportOpts.fps;
  const bitrate = Math.round(width * height * fps * exportOpts.q);
  const srcDur = Math.max(0, timeline.outPoint - timeline.inPoint);
  const dur = srcDur / speed;
  return { width, height, fps, bitrate, dur, srcDur, speed, gif, start: timeline.inPoint, end: timeline.outPoint };
}

function updateSummary() {
  const p = exportParams();
  const frames = Math.round(p.dur * p.fps);
  const sizeMb = p.gif
    ? (p.width * p.height * frames * 0.32) / 1e6
    : ((p.bitrate + (exportOpts.audio ? 192000 : 0)) * p.dur) / 8 / 1e6;
  const extras = [
    exportOpts.aspect !== 'source' ? `формат ${exportOpts.aspect}` : '',
    exportOpts.compare === 'wipe' ? 'до/после' : '',
    beatSync.on && beats.length ? 'смена в такт' : '',
    anim.on && anim.a && anim.b ? 'A → B' : '',
  ].filter(Boolean).join(' · ');
  $('summary').innerHTML = `
    <div><span>Размер кадра</span><b>${p.width}×${p.height}${p.gif ? ' · GIF' : ''}</b></div>
    ${extras ? `<div><span>Особое</span><b class="hl">${extras}</b></div>` : ''}
    <div><span>Фрагмент</span><b>${fmtTime(p.start)} → ${fmtTime(p.end)}</b></div>
    ${p.speed > 1 ? `<div><span>Ускорение</span><b class="hl">${p.speed}× · ${p.srcDur.toFixed(2)} с → ${p.dur.toFixed(2)} с</b></div>` : ''}
    <div><span>Длительность</span><b>${p.dur.toFixed(2)} с · ${Math.round(p.dur * p.fps)} кадров</b></div>
    ${p.gif ? '' : `<div><span>Битрейт</span><b>${(p.bitrate / 1e6).toFixed(1)} Мбит/с</b></div>`}
    <div class="big"><span>${p.gif ? 'Файл ≈' : 'Файл, не более'}</span><b>${sizeMb < 1 ? sizeMb.toFixed(2) : sizeMb.toFixed(1)} МБ</b></div>
    ${p.gif && sizeMb > 25 ? '<div class="warn-line">GIF выйдет тяжёлым: укороти фрагмент, уменьши ширину или fps</div>' : ''}`;
}

function drawPreview(src: CanvasImageSource, w: number, h: number) {
  const box = exportPreview.parentElement!.getBoundingClientRect();
  const s = Math.min(box.width / w, box.height / h);
  const dw = Math.round(w * s * Math.min(2, devicePixelRatio));
  const dh = Math.round(h * s * Math.min(2, devicePixelRatio));
  if (exportPreview.width !== dw || exportPreview.height !== dh) {
    exportPreview.width = dw;
    exportPreview.height = dh;
    exportPreview.style.width = `${w * s}px`;
    exportPreview.style.height = `${h * s}px`;
  }
  const ctx = exportPreview.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, dw, dh);
}

function openExport() {
  if (source !== 'file' || !currentFile) return;
  video.pause();
  setDlgState('config');
  updateSummary();
  dlg.showModal();
  requestAnimationFrame(() => drawPreview(canvas, canvas.width, canvas.height));
}

async function runExport() {
  if (!currentFile) return;
  const p = exportParams();
  if (p.dur <= 0) { toast('Пустой фрагмент', 'err'); return; }
  if (!p.gif && typeof VideoEncoder === 'undefined') {
    toast('MP4 требует WebCodecs: открой в Chrome, Edge или Arc, или выбери GIF', 'err', 5000);
    return;
  }
  // make sure every font that can appear is loaded before the first frame
  const looks = [settings, anim.a, anim.b, ...beatSync.ids.map((id) => allPresets().find((x) => x.id === id)?.s)]
    .filter((x): x is Settings => !!x)
    .map((x) => ({ ...DEFAULTS, ...x }));
  await Promise.all(looks.map(ensureFont));
  abort = new AbortController();
  setDlgState('running');
  const ringFg = $<SVGCircleElement & HTMLElement>('ringFg');
  const C = 2 * Math.PI * 52;
  ringFg.style.strokeDasharray = `${C}`;
  ringFg.style.strokeDashoffset = `${C}`;
  const t0 = performance.now();
  try {
    const snapshot = { ...settings };
    const common = {
      width: p.width, height: p.height, fps: p.fps, start: p.start, end: p.end, speed: p.speed, envelope,
      crop: cropRect(), compare: exportOpts.compare,
      settingsAt: (beatSync.on && beats.length) || (anim.on && anim.a && anim.b) ? lookAt : undefined,
    };
    const onProg = (prog: number, label: string) => {
      document.title = `${Math.floor(prog * 100)}% · рендер · ASCII Render`;
      $('ringPct').textContent = `${Math.floor(prog * 100)}%`;
      ringFg.style.strokeDashoffset = `${C * (1 - prog)}`;
      $('runBar').style.width = `${prog * 100}%`;
      $('runLabel').textContent = label;
      const m = label.match(/~(\d+)с/);
      $('ringEta').textContent = m ? `~${m[1]} с` : '';
    };
    const onFrame = (c: HTMLCanvasElement, i: number) => { if (i % 2 === 0) drawPreview(c, c.width, c.height); };
    const blob = p.gif
      ? await exportGif(currentUrl, snapshot, common, onProg, abort.signal, onFrame)
      : await exportMp4(currentUrl, currentFile, snapshot, { ...common, bitrate: p.bitrate, audio: exportOpts.audio }, onProg, abort.signal, onFrame);
    resultBlob = blob;
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(blob);
    if (p.gif) $<HTMLImageElement>('resultImg').src = resultUrl;
    else resultVideo.src = resultUrl;
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    $('doneLabel').textContent = `${(blob.size / 1e6).toFixed(1)} МБ · ${p.width}×${p.height} · ${p.fps} fps${p.speed > 1 ? ` · ${p.speed}×` : ''} · рендер ${secs} с`;
    setDlgState('done');
    document.title = `✓ Готово · ASCII Render`;
    if (!p.gif) resultVideo.play().catch(() => {});
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      toast('Экспорт остановлен');
      setDlgState('config');
    } else {
      console.error(err);
      toast(`Ошибка экспорта: ${(err as Error).message}`, 'err', 6000);
      setDlgState('config');
    }
  } finally {
    abort = null;
  }
}

$('exportBtn').addEventListener('click', openExport);
$('dlgGo').addEventListener('click', () => {
  if (dlg.dataset.state === 'done' && resultBlob) {
    const ext = resultBlob.type === 'image/gif' ? 'gif' : 'mp4';
    download(resultBlob, `${baseName()}_ascii${speed > 1 ? `_${speed}x` : ''}.${ext}`);
    toast('Скачивание началось', 'ok');
  } else runExport();
});
const closeDlg = () => {
  if (abort) { abort.abort(); return; }
  resultVideo.pause();
  dlg.close();
};
$('dlgCancel').addEventListener('click', closeDlg);
$('dlgClose').addEventListener('click', closeDlg);
dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeDlg(); });

const helpDlg = $<HTMLDialogElement>('helpDlg');
$('helpBtn').addEventListener('click', () => helpDlg.showModal());
helpDlg.querySelector('[data-close]')!.addEventListener('click', () => helpDlg.close());
for (const d of [dlg, helpDlg]) {
  d.addEventListener('click', (e) => { if (e.target === d) (d === dlg ? closeDlg() : d.close()); });
}

// ───────── helpers ─────────
function baseName() {
  return (currentFile?.name ?? 'video').replace(/\.[^.]+$/, '');
}
function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}

// ───────── keyboard ─────────
document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.matches('input[type=text], input[type=number], textarea') || dlg.open) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); stepHistory(e.shiftKey ? 1 : -1); return; }
  if (mod) return;
  switch (e.key) {
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'ArrowLeft': e.preventDefault(); step(e.shiftKey ? -1 : -FRAME); break;
    case 'ArrowRight': e.preventDefault(); step(e.shiftKey ? 1 : FRAME); break;
    case 'i': case 'I': if (source === 'file') timeline.setTrim(video.currentTime, timeline.outPoint); break;
    case 'o': case 'O': if (source === 'file') timeline.setTrim(timeline.inPoint, video.currentTime); break;
    case 'c': case 'C': if (source !== 'none') setMode(viewer.mode === 'ascii' ? 'compare' : 'ascii'); break;
    case 'f': case 'F': if (source !== 'none') toggleFull(); break;
    case 'r': case 'R': randomize(); break;
    case 'l': case 'L': toggleLoop(); break;
    case 'm': case 'M': video.muted = !video.muted; syncMute(); break;
    case 'e': case 'E': openExport(); break;
    case 't': case 'T': copyAsText(); break;
    case '+': case '=': viewer.zoomAt(1.5); break;
    case '-': case '_': viewer.zoomAt(1 / 1.5); break;
    case '0': viewer.fit(); break;
    case '?': helpDlg.showModal(); break;
    case '[': stepSpeed(-1); break;
    case ']': stepSpeed(1); break;
    case 'a': case 'A': if (source !== 'none') cycleAspect(); break;
  }
});

// ───────── frame format ─────────
const aspectSeg = $('aspectSeg');
function setAspect(a: string, announce = true) {
  exportOpts.aspect = a;
  save(EXPORT_KEY, exportOpts);
  aspectSeg.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.a === a));
  applySize();
  viewer.fit();
  if (dlg.open) updateSummary();
  if (announce) toast(a === 'source' ? 'Исходный формат кадра' : `Формат кадра ${a}`, 'info', 1200);
}
aspectSeg.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (b?.dataset.a) setAspect(b.dataset.a);
});
function cycleAspect() {
  const order = ['source', '9:16', '1:1', '4:5', '16:9'];
  setAspect(order[(order.indexOf(exportOpts.aspect) + 1) % order.length]);
}

// ───────── share / import / export styles ─────────
function styleDiff(s: Settings) {
  const diff: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) if (s[k] !== DEFAULTS[k]) diff[k] = s[k];
  return diff;
}
const b64url = {
  enc: (str: string) => btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))),
};
function sanitize(obj: unknown): Partial<Settings> {
  const out: Record<string, unknown> = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k in DEFAULTS && typeof v === typeof DEFAULTS[k as keyof Settings]) out[k] = v;
  }
  return out as Partial<Settings>;
}
$('shareBtn').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#style=${b64url.enc(JSON.stringify(styleDiff(settings)))}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Ссылка на стиль скопирована: открой её, и стиль применится', 'ok', 3200);
  } catch {
    prompt('Скопируй ссылку на стиль:', url);
  }
});
$('jsonBtn').addEventListener('click', () => {
  const active = allPresets().find((p) => presetsEl.querySelector(`.preset.on[data-id="${p.id}"]`));
  const name = active?.name ?? 'Мой стиль';
  const data = { app: 'ascii-render', v: 1, name, settings: styleDiff(settings) };
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${name.replace(/[^\wа-яё-]+/gi, '_')}.ascii-style.json`);
  toast('Стиль сохранён в .json', 'ok');
});
const importInput = document.createElement('input');
importInput.type = 'file';
importInput.accept = '.json,application/json';
importInput.addEventListener('change', () => { if (importInput.files?.[0]) importStyle(importInput.files[0]); importInput.value = ''; });
$('importBtn').addEventListener('click', () => importInput.click());
async function importStyle(file: File) {
  try {
    const data = JSON.parse(await file.text());
    const s = sanitize(data.settings ?? data.s ?? data);
    if (!Object.keys(s).length && !data.settings) throw new Error('нет настроек');
    const name = String(data.name || file.name.replace(/\.(ascii-style\.)?json$/i, '')).slice(0, 24);
    userPresets.push({ id: `u${Date.now()}`, name, s: { ...DEFAULTS, ...s }, user: true });
    save(USER_PRESETS_KEY, userPresets);
    settings = { ...DEFAULTS, ...s };
    buildPresets();
    applySettings();
    toast(`Стиль «${name}» импортирован`, 'ok');
  } catch (err) {
    toast(`Не получилось прочитать стиль: ${(err as Error).message}`, 'err', 4000);
  }
}
function applyStyleFromHash() {
  const m = location.hash.match(/^#style=([\w-]+)/);
  if (!m) return;
  try {
    settings = { ...DEFAULTS, ...sanitize(JSON.parse(b64url.dec(m[1]))) };
    applySettings();
    toast('Стиль из ссылки применён', 'ok', 3000);
  } catch {
    toast('Ссылка на стиль повреждена', 'err');
  }
  window.history.replaceState(null, '', location.pathname + location.search);
}

// ───────── animation A → B ─────────
const animSec = $('animSec');
const ANIM_OPEN_KEY = 'ascii-render-anim-open';
animSec.classList.toggle('collapsed', !load<boolean>(ANIM_OPEN_KEY, false));
$('animHead').addEventListener('click', () => {
  animSec.classList.toggle('collapsed');
  save(ANIM_OPEN_KEY, !animSec.classList.contains('collapsed'));
});
const saveAnim = () => save(ANIM_KEY, { on: anim.on, a: anim.a ? styleDiff(anim.a) : null, b: anim.b ? styleDiff(anim.b) : null });
function syncAnimSlots() {
  for (const k of ['a', 'b'] as const) {
    const slot = $(k === 'a' ? 'slotA' : 'slotB');
    const look = anim[k];
    slot.classList.toggle('filled', !!look);
    slot.querySelector('span')!.textContent = look ? 'задано' : 'пусто';
    const c = slot.querySelector('canvas')!;
    if (look) drawThumb(c, look, 200, 124);
    else c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  }
  const on = $<HTMLInputElement>('animOn');
  on.checked = anim.on;
  on.disabled = !(anim.a && anim.b);
}
for (const k of ['a', 'b'] as const) {
  $(k === 'a' ? 'setA' : 'setB').addEventListener('click', () => {
    anim[k] = { ...settings };
    if (anim.a && anim.b && !anim[k === 'a' ? 'b' : 'a']) anim.on = false;
    saveAnim();
    syncAnimSlots();
    toast(`Текущий стиль записан в ${k.toUpperCase()}`, 'ok', 1500);
    if (anim.a && anim.b && !anim.on) toast('A и B заданы: включи «Анимировать по фрагменту»', 'info', 2600);
  });
  $(k === 'a' ? 'slotA' : 'slotB').addEventListener('click', () => {
    const look = anim[k];
    if (!look) return;
    settings = { ...look };
    applySettings();
    toast(`${k.toUpperCase()} загружен в редактор`, 'info', 1200);
  });
}
$<HTMLInputElement>('animOn').addEventListener('change', (e) => {
  anim.on = (e.target as HTMLInputElement).checked;
  if (anim.on && beatSync.on) { beatSync.on = false; save(BEAT_KEY, beatSync); syncBeatUI(); }
  saveAnim();
  requestRender();
  if (anim.on && source === 'file') { video.currentTime = timeline.inPoint; video.play(); }
});

// ───────── beat-synced preset switching ─────────
function refreshBeats() {
  beats = detectBeats(envelope, beatSync.sens);
  syncBeatUI();
  requestRender();
}
function syncBeatUI() {
  $<HTMLInputElement>('beatOn').checked = beatSync.on;
  const sens = $<HTMLInputElement>('beatSens');
  sens.value = String(beatSync.sens);
  sens.style.setProperty('--p', `${beatSync.sens * 100}%`);
  $('beatSensVal').textContent = beatSync.sens.toFixed(2);
  const chipsEl = $('beatChips');
  chipsEl.innerHTML = '';
  for (const p of allPresets()) {
    const b = document.createElement('button');
    b.textContent = p.name;
    b.classList.toggle('on', beatSync.ids.includes(p.id));
    b.addEventListener('click', () => {
      beatSync.ids = beatSync.ids.includes(p.id) ? beatSync.ids.filter((x) => x !== p.id) : [...beatSync.ids, p.id];
      save(BEAT_KEY, beatSync);
      syncBeatUI();
      requestRender();
    });
    chipsEl.appendChild(b);
  }
  const info = $('beatInfo');
  if (source !== 'file') info.textContent = 'Загрузи видео со звуком.';
  else if (!envelope) info.textContent = 'Анализирую звук… (или в видео нет звука)';
  else info.innerHTML = `Найдено <b>${beats.length}</b> битов · выбрано стилей: <b>${beatSync.ids.length}</b>`;
  timeline.setMarkers(beatSync.on ? beats : []);
}
$<HTMLInputElement>('beatOn').addEventListener('change', (e) => {
  beatSync.on = (e.target as HTMLInputElement).checked;
  if (beatSync.on && anim.on) { anim.on = false; saveAnim(); syncAnimSlots(); }
  save(BEAT_KEY, beatSync);
  syncBeatUI();
  requestRender();
  if (beatSync.on && !envelope) toast('Нужно видео со звуком', 'info');
  else if (beatSync.on && source === 'file' && video.paused) video.play();
});
$<HTMLInputElement>('beatSens').addEventListener('input', (e) => {
  beatSync.sens = Number((e.target as HTMLInputElement).value);
  save(BEAT_KEY, beatSync);
  refreshBeats();
});

// ───────── init ─────────
controls.sync(settings);
syncHistoryButtons();
buildPresets();
setSourceUI();
viewer.setMode('ascii');
setSpeed(1);
setAspect(exportOpts.aspect, false);
syncAnimSlots();
syncBeatUI();
applyStyleFromHash();
// ?demo plays the bundled clip, ?demo=7 opens it paused at 7 s
const demoParam = new URLSearchParams(location.search).get('demo');
if (demoParam !== null) loadDemo(Number(demoParam) || 0);
document.fonts.load(`500 16px ${FONT_FAMILY}`).then(() => { requestRender(); renderPresetThumbs(); });
ensureFont(settings).then(() => requestRender());
