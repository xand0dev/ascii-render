import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { CHARSETS, DEFAULTS, FONTS, type Settings } from '../src/ascii';
import { BUILTIN_PRESETS } from '../src/presets';
import { buildLook, expandPath, findPreset, renderFrame, renderVideo, sanitize, videoInfo } from './render';

const EDITOR_URL = process.env.ASCII_EDITOR_URL ?? 'http://localhost:5173/';

/** What every look parameter does — shown to the model by list_styles. */
const SETTINGS_DOC: Partial<Record<keyof Settings, string>> = {
  columns: 'число символов по ширине, 40–400 (больше = детальнее)',
  charset: `набор символов: ${Object.keys(CHARSETS).join(' | ')}`,
  customChars: 'свои символы от пустого к плотному (при charset=custom)',
  font: `шрифт: ${Object.keys(FONTS).join(' | ')}`,
  fontWeight: "'300' | '500' | '700' | '800'",
  cellAspect: 'высота ячейки к ширине, 1–2.5',
  fontScale: 'масштаб глифа в ячейке, 0.6–1.6',
  contrast: '0.3–3', brightness: '-0.5–0.5', gamma: '0.3–2.5', invert: 'инверсия яркости',
  colorMode: "'original' (цвет из видео) | 'mono' | 'duotone' | 'accent' (всё графит, кроме оттенка accent) | 'thermal'",
  saturation: '0–3 (original)', colorNormalize: 'яркость цвета 0–1 (original)',
  fg: 'цвет символов (mono / база для accent)', duoA: 'тени (duotone)', duoB: 'свет (duotone)',
  accent: 'цвет акцента и цифрового дождя', accentTolerance: 'охват акцента 0.02–0.3',
  bg: 'цвет фона', bgVideo: 'прозрачность оригинала под символами 0–1',
  edges: 'контуры символами / \\ | -', edgeThreshold: 'порог контуров 0.1–1.5',
  noise: 'мерцание символов 0–0.3', glow: 'свечение 0–1.5', glowRadius: '1–30', scanlines: 'скан-линии 0–0.8',
  audioReact: 'реакция на бас 0–1', glitch: 'глитч 0–1', decode: 'интро «декодирование», секунды 0–4',
  rain: 'цифровой дождь 0–1', trails: 'шлейф 0–0.95', motion: 'только движение 0–1',
  overlayText: 'текст поверх видео, выложенный своими же буквами', overlaySize: '0.08–0.7',
  overlayPos: "'top' | 'center' | 'bottom'", overlayColor: 'цвет текста',
};

const lookShape = {
  preset: z.string().optional().describe('id или название пресета (см. list_styles), например "xand0dev", "matrix", "chrome"'),
  settings: z.record(z.string(), z.unknown()).optional()
    .describe('точечные переопределения параметров поверх пресета, например {"columns":200,"glow":0.8,"overlayText":"HELLO"}'),
};
const aspectEnum = z.enum(['source', '9:16', '1:1', '4:5', '16:9']);

const server = new McpServer(
  { name: 'ascii-render', version: '1.0.0' },
  {
    instructions: [
      'ASCII Render превращает обычные видео в ASCII-видео (цветные символы, контуры, свечение, глитч, дождь и т. д.).',
      'Типичный порядок: video_info → preview_frame (посмотри результат, подкрути preset/settings) → render_video.',
      'Пути к файлам — абсолютные или через ~. Вывод по умолчанию кладётся рядом с исходником.',
      'Перед долгим рендером покажи пользователю превью и уточни стиль, если запрос неоднозначен.',
    ].join(' '),
  },
);

server.registerTool('list_styles', {
  title: 'Пресеты и параметры ASCII',
  description: 'Список встроенных пресетов стиля и всех параметров, которые можно переопределить через settings.',
  annotations: { readOnlyHint: true },
}, async () => {
  const presets = BUILTIN_PRESETS.map((p) => `- ${p.id} — «${p.name}»`).join('\n');
  const params = (Object.keys(DEFAULTS) as (keyof Settings)[])
    .map((k) => `- ${k} (по умолчанию ${JSON.stringify(DEFAULTS[k])}): ${SETTINGS_DOC[k] ?? ''}`)
    .join('\n');
  return { content: [{ type: 'text', text: `ПРЕСЕТЫ:\n${presets}\n\nПАРАМЕТРЫ (settings):\n${params}` }] };
});

server.registerTool('video_info', {
  title: 'Информация о видео',
  description: 'Размер, длительность, fps и наличие звука у видеофайла.',
  inputSchema: { path: z.string().describe('путь к видео') },
  annotations: { readOnlyHint: true },
}, async ({ path }) => {
  const info = await videoInfo(path);
  return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
});

server.registerTool('preview_frame', {
  title: 'Превью кадра в ASCII',
  description: 'Рендерит один кадр видео в выбранном стиле и возвращает картинку, чтобы оценить стиль до полного рендера.',
  inputSchema: {
    path: z.string().describe('путь к видео'),
    time: z.number().optional().describe('секунда кадра (по умолчанию середина)'),
    ...lookShape,
    aspect: aspectEnum.optional().describe('формат кадра'),
    max_side: z.number().int().min(256).max(2048).optional().describe('длинная сторона картинки, по умолчанию 1024'),
    save_to: z.string().optional().describe('если указать путь .png — сохранить кадр туда'),
  },
  annotations: { readOnlyHint: true },
}, async (a) => {
  const info = await videoInfo(a.path);
  const look = buildLook(a.preset, a.settings);
  const r = await renderFrame({
    input: a.path, time: a.time ?? info.duration / 2, look, aspect: a.aspect, maxSide: a.max_side,
  });
  if (a.save_to) await writeFile(expandPath(a.save_to), r.png);
  return {
    content: [
      { type: 'image', data: r.png.toString('base64'), mimeType: 'image/png' },
      { type: 'text', text: `Кадр ${r.width}×${r.height}, сетка ${r.grid.cols}×${r.grid.rows} символов${a.save_to ? `, сохранён в ${expandPath(a.save_to)}` : ''}.` },
    ],
  };
});

server.registerTool('frame_to_text', {
  title: 'Кадр как ASCII-текст',
  description: 'Возвращает кадр видео как обычный текст (ASCII-арт) — для README, чатов, терминала.',
  inputSchema: {
    path: z.string().describe('путь к видео'),
    time: z.number().optional().describe('секунда кадра (по умолчанию середина)'),
    columns: z.number().int().min(20).max(300).optional().describe('ширина в символах, по умолчанию 100'),
    ...lookShape,
  },
  annotations: { readOnlyHint: true },
}, async (a) => {
  const info = await videoInfo(a.path);
  const look = { ...buildLook(a.preset, a.settings), columns: a.columns ?? 100, noise: 0 };
  const r = await renderFrame({ input: a.path, time: a.time ?? info.duration / 2, look, maxSide: 1200 });
  return { content: [{ type: 'text', text: '```\n' + r.text + '\n```' }] };
});

server.registerTool('render_video', {
  title: 'Рендер ASCII-видео',
  description: 'Полный рендер видео в ASCII: MP4 (со звуком) или GIF. Поддерживает обрезку, ускорение, формат кадра, сравнение до/после, смену стилей в такт музыке и плавный переход между стилями.',
  inputSchema: {
    path: z.string().describe('путь к исходному видео'),
    output: z.string().optional().describe('куда сохранить; по умолчанию рядом с исходником: <имя>_ascii.mp4/.gif'),
    format: z.enum(['mp4', 'gif']).optional().describe('по умолчанию mp4'),
    ...lookShape,
    aspect: aspectEnum.optional().describe('формат кадра: source / 9:16 (Reels, TikTok) / 1:1 / 4:5 / 16:9'),
    start: z.number().optional().describe('начало фрагмента, сек'),
    end: z.number().optional().describe('конец фрагмента, сек'),
    speed: z.number().min(1).max(15).optional().describe('ускорение 1–15×'),
    resolution: z.number().int().optional().describe('MP4: короткая сторона, 720 / 1080 / 1440 / 2160 (по умолчанию 1080)'),
    gif_width: z.number().int().min(160).max(1200).optional().describe('GIF: ширина, по умолчанию 480'),
    fps: z.number().int().min(5).max(60).optional().describe('кадров в секунду (MP4 30, GIF 15 по умолчанию)'),
    audio: z.boolean().optional().describe('MP4: сохранить звук (по умолчанию да)'),
    compare: z.enum(['none', 'wipe']).optional().describe('wipe — оригинал и ASCII со шторкой до/после'),
    beat_presets: z.array(z.string()).optional().describe('пресеты, которые переключаются на каждом бите музыки'),
    beat_sensitivity: z.number().min(0).max(1).optional().describe('чувствительность к битам, по умолчанию 0.5'),
    animate_to_preset: z.string().optional().describe('плавно перейти к этому пресету к концу фрагмента'),
    animate_to_settings: z.record(z.string(), z.unknown()).optional().describe('переопределения для конечного стиля перехода'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
}, async (a, extra) => {
  const look = buildLook(a.preset, a.settings);
  const beatLooks = a.beat_presets?.map((id) => {
    const p = findPreset(id);
    if (!p) throw new Error(`Нет пресета «${id}» для beat_presets`);
    return { ...DEFAULTS, ...p.s };
  });
  const animateTo = a.animate_to_preset || a.animate_to_settings
    ? { ...(a.animate_to_preset ? buildLook(a.animate_to_preset) : look), ...sanitize(a.animate_to_settings) }
    : undefined;

  const token = extra._meta?.progressToken;
  let lastSent = 0;
  const res = await renderVideo({
    input: a.path, output: a.output, format: a.format ?? 'mp4', look,
    start: a.start, end: a.end, speed: a.speed, aspect: a.aspect, resolution: a.resolution,
    gifWidth: a.gif_width, fps: a.fps, audio: a.audio, compare: a.compare,
    beatLooks, beatSensitivity: a.beat_sensitivity, animateTo,
  }, (done, total) => {
    if (token === undefined || (Date.now() - lastSent < 400 && done < total)) return;
    lastSent = Date.now();
    extra.sendNotification({
      method: 'notifications/progress',
      params: { progressToken: token, progress: done, total, message: `кадр ${done}/${total}` },
    }).catch(() => {});
  });

  const mb = (res.bytes / 1e6).toFixed(1);
  const lines = [
    `Готово: ${res.output}`,
    `${res.width}×${res.height}, ${res.fps} fps, ${res.duration.toFixed(2)} с (${res.frames} кадров), ${mb} МБ, рендер ${res.seconds.toFixed(1)} с.`,
    `Фрагмент ${res.start.toFixed(2)}–${res.end.toFixed(2)} с${res.speed > 1 ? `, ускорение ${res.speed}×` : ''}${beatLooks ? `, битов: ${res.beats}` : ''}.`,
  ];
  return { content: [{ type: 'text', text: lines.join('\n') }] };
});

server.registerTool('editor_link', {
  title: 'Открыть стиль в редакторе',
  description: 'Ссылка на веб-редактор ASCII Render с уже применённым стилем — чтобы пользователь докрутил его руками.',
  inputSchema: { ...lookShape },
  annotations: { readOnlyHint: true },
}, async (a) => {
  const look = buildLook(a.preset, a.settings);
  const diff: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) if (look[k] !== DEFAULTS[k]) diff[k] = look[k];
  const hash = Buffer.from(JSON.stringify(diff)).toString('base64url');
  return {
    content: [{
      type: 'text',
      text: `${EDITOR_URL}#style=${hash}\n(редактор должен быть запущен: npm run dev в папке проекта)`,
    }],
  };
});

await server.connect(new StdioServerTransport());
console.error('ascii-render MCP server ready');
