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
  columns: 'glyphs across, 40–400 (more = more detail)',
  charset: `glyph set: ${Object.keys(CHARSETS).join(' | ')}`,
  customChars: 'your own glyphs from empty to dense (with charset=custom)',
  font: `font: ${Object.keys(FONTS).join(' | ')}`,
  fontWeight: "'300' | '500' | '700' | '800'",
  cellAspect: 'cell height relative to width, 1–2.5',
  fontScale: 'glyph scale inside a cell, 0.6–1.6',
  contrast: '0.3–3', brightness: '-0.5–0.5', gamma: '0.3–2.5', invert: 'invert brightness',
  colorMode: "'original' (colors from the video) | 'mono' | 'duotone' | 'accent' (everything graphite except the accent hue) | 'thermal'",
  saturation: '0–3 (original)', colorNormalize: 'color brightness 0–1 (original)',
  fg: 'glyph color (mono / base for accent)', duoA: 'shadows (duotone)', duoB: 'highlights (duotone)',
  accent: 'accent and digital-rain color', accentTolerance: 'accent hue range 0.02–0.3',
  bg: 'background color', bgVideo: 'opacity of the original under the glyphs 0–1',
  edges: 'draw edges with / \\ | -', edgeThreshold: 'edge threshold 0.1–1.5',
  noise: 'glyph flicker 0–0.3', glow: 'glow 0–1.5', glowRadius: '1–30', scanlines: 'scanlines 0–0.8',
  audioReact: 'react to bass 0–1', glitch: 'glitch 0–1', decode: '"decode" intro, seconds 0–4',
  rain: 'digital rain 0–1', trails: 'trails 0–0.95', motion: 'motion only 0–1',
  overlayText: 'text over the video, drawn out of its own letters', overlaySize: '0.08–0.7',
  overlayPos: "'top' | 'center' | 'bottom'", overlayColor: 'text color',
};

const lookShape = {
  preset: z.string().optional().describe('preset id or name (see list_styles), e.g. "xand0dev", "matrix", "chrome"'),
  settings: z.record(z.string(), z.unknown()).optional()
    .describe('parameter overrides on top of the preset, e.g. {"columns":200,"glow":0.8,"overlayText":"HELLO"}'),
};
const aspectEnum = z.enum(['source', '9:16', '1:1', '4:5', '16:9']);

const server = new McpServer(
  { name: 'ascii-render', version: '1.0.0' },
  {
    instructions: [
      'ASCII Render turns ordinary videos into ASCII-art videos (colored glyphs, edges, glow, glitch, digital rain and more).',
      'Typical flow: video_info → preview_frame (look at the result, tweak preset/settings) → render_video.',
      'File paths are absolute or start with ~. Output goes next to the source by default.',
      'Before a long render, show the user a preview and confirm the style if the request is ambiguous.',
    ].join(' '),
  },
);

server.registerTool('list_styles', {
  title: 'ASCII presets and parameters',
  description: 'Lists the built-in style presets and every parameter that can be overridden via settings.',
  annotations: { readOnlyHint: true },
}, async () => {
  const presets = BUILTIN_PRESETS.map((p) => `- ${p.id} — ${p.name}`).join('\n');
  const params = (Object.keys(DEFAULTS) as (keyof Settings)[])
    .map((k) => `- ${k} (default ${JSON.stringify(DEFAULTS[k])}): ${SETTINGS_DOC[k] ?? ''}`)
    .join('\n');
  return { content: [{ type: 'text', text: `PRESETS:\n${presets}\n\nPARAMETERS (settings):\n${params}` }] };
});

server.registerTool('video_info', {
  title: 'Video info',
  description: 'Resolution, duration, fps and whether a video file has sound.',
  inputSchema: { path: z.string().describe('path to the video') },
  annotations: { readOnlyHint: true },
}, async ({ path }) => {
  const info = await videoInfo(path);
  return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
});

server.registerTool('preview_frame', {
  title: 'Preview a frame in ASCII',
  description: 'Renders one frame of the video in the chosen style and returns the image, so the style can be judged before a full render.',
  inputSchema: {
    path: z.string().describe('path to the video'),
    time: z.number().optional().describe('frame time in seconds (default: middle of the video)'),
    ...lookShape,
    aspect: aspectEnum.optional().describe('frame format'),
    max_side: z.number().int().min(256).max(2048).optional().describe('longest side of the image, default 1024'),
    save_to: z.string().optional().describe('a .png path to also save the frame to'),
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
      { type: 'text', text: `Frame ${r.width}×${r.height}, grid ${r.grid.cols}×${r.grid.rows} glyphs${a.save_to ? `, saved to ${expandPath(a.save_to)}` : ''}.` },
    ],
  };
});

server.registerTool('frame_to_text', {
  title: 'Frame as ASCII text',
  description: 'Returns a video frame as plain text (ASCII art) — for READMEs, chats and terminals.',
  inputSchema: {
    path: z.string().describe('path to the video'),
    time: z.number().optional().describe('frame time in seconds (default: middle of the video)'),
    columns: z.number().int().min(20).max(300).optional().describe('width in characters, default 100'),
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
  title: 'Render an ASCII video',
  description: 'Full ASCII render of a video: MP4 (with sound) or GIF. Supports trimming, speed-up, reframing, before/after comparison, beat-synced style switching and a smooth transition between styles.',
  inputSchema: {
    path: z.string().describe('path to the source video'),
    output: z.string().optional().describe('where to save; default is next to the source: <name>_ascii.mp4/.gif'),
    format: z.enum(['mp4', 'gif']).optional().describe('default mp4'),
    ...lookShape,
    aspect: aspectEnum.optional().describe('frame format: source / 9:16 (Reels, TikTok) / 1:1 / 4:5 / 16:9'),
    start: z.number().optional().describe('clip start, seconds'),
    end: z.number().optional().describe('clip end, seconds'),
    speed: z.number().min(1).max(15).optional().describe('speed-up 1–15×'),
    resolution: z.number().int().optional().describe('MP4: short side, 720 / 1080 / 1440 / 2160 (default 1080)'),
    gif_width: z.number().int().min(160).max(1200).optional().describe('GIF: width, default 480'),
    fps: z.number().int().min(5).max(60).optional().describe('frames per second (default MP4 30, GIF 15)'),
    audio: z.boolean().optional().describe('MP4: keep the sound (default yes)'),
    compare: z.enum(['none', 'wipe']).optional().describe('wipe — original and ASCII with a before/after divider'),
    beat_presets: z.array(z.string()).optional().describe('presets to cycle through on every beat of the music'),
    beat_sensitivity: z.number().min(0).max(1).optional().describe('beat sensitivity, default 0.5'),
    animate_to_preset: z.string().optional().describe('smoothly transition to this preset by the end of the clip'),
    animate_to_settings: z.record(z.string(), z.unknown()).optional().describe('overrides for the transition target style'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
}, async (a, extra) => {
  const look = buildLook(a.preset, a.settings);
  const beatLooks = a.beat_presets?.map((id) => {
    const p = findPreset(id);
    if (!p) throw new Error(`Unknown preset "${id}" in beat_presets`);
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
      params: { progressToken: token, progress: done, total, message: `frame ${done}/${total}` },
    }).catch(() => {});
  });

  const mb = (res.bytes / 1e6).toFixed(1);
  const lines = [
    `Done: ${res.output}`,
    `${res.width}×${res.height}, ${res.fps} fps, ${res.duration.toFixed(2)} s (${res.frames} frames), ${mb} MB, rendered in ${res.seconds.toFixed(1)} s.`,
    `Clip ${res.start.toFixed(2)}–${res.end.toFixed(2)} s${res.speed > 1 ? `, ${res.speed}× speed` : ''}${beatLooks ? `, beats: ${res.beats}` : ''}.`,
  ];
  return { content: [{ type: 'text', text: lines.join('\n') }] };
});

server.registerTool('editor_link', {
  title: 'Open a style in the editor',
  description: 'A link to the ASCII Render web editor with the style already applied, so the user can fine-tune it by hand.',
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
      text: `${EDITOR_URL}#style=${hash}\n(the editor must be running: npm run dev in the project folder — or set ASCII_EDITOR_URL to a hosted copy)`,
    }],
  };
});

await server.connect(new StdioServerTransport());
console.error('ascii-render MCP server ready');
