// Talks to the MCP server exactly like Claude would: `npm run mcp:test -- /path/to/video.mp4 [outDir]`
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [video, outDir = '.'] = process.argv.slice(2);
if (!video) {
  console.error('usage: npm run mcp:test -- <video> [outDir]');
  process.exit(1);
}

const client = new Client({ name: 'smoke-test', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [new URL('./dist/server.mjs', import.meta.url).pathname] }));

const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));

const call = async (name, args) => {
  const t = Date.now();
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name}: ${res.content.map((c) => c.text).join(' ')}`);
  console.log(`\n▶ ${name} (${Date.now() - t} ms)`);
  return res;
};

const info = await call('video_info', { path: video });
console.log(info.content[0].text);

const styles = await call('list_styles', {});
console.log(styles.content[0].text.split('\n').slice(0, 6).join('\n'), '…');

const prev = await call('preview_frame', { path: video, preset: 'xand0dev', settings: { overlayText: 'MCP' }, aspect: '1:1', max_side: 640 });
const img = prev.content.find((c) => c.type === 'image');
await writeFile(join(outDir, 'mcp_preview.png'), Buffer.from(img.data, 'base64'));
console.log(prev.content.find((c) => c.type === 'text').text, '→ mcp_preview.png');

const txt = await call('frame_to_text', { path: video, columns: 60, preset: 'terminal' });
console.log(txt.content[0].text.split('\n').slice(10, 18).join('\n'));

const mp4 = await call('render_video', {
  path: video, output: join(outDir, 'mcp_render.mp4'), preset: 'blood', start: 3, end: 7, speed: 2,
  aspect: '9:16', resolution: 720, beat_presets: ['xand0dev', 'chrome', 'blood'],
});
console.log(mp4.content[0].text);

const gif = await call('render_video', {
  path: video, output: join(outDir, 'mcp_render.gif'), format: 'gif', preset: 'matrix', start: 8, end: 10, compare: 'wipe', gif_width: 360,
});
console.log(gif.content[0].text);

const link = await call('editor_link', { preset: 'neon', settings: { columns: 222 } });
console.log(link.content[0].text);

await client.close();
