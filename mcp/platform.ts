// Side-effect module: points the shared renderer at a Node (Skia) canvas instead of the DOM.
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { platform } from '../src/ascii';

platform.createCanvas = () => createCanvas(1, 1) as unknown as HTMLCanvasElement;
platform.fontReady = () => true;

// optional extra fonts (IBM Plex Mono, VT323, …): drop .ttf files into mcp/fonts/
for (const dir of [join(dirname(new URL(import.meta.url).pathname), '..', 'fonts'), join(process.cwd(), 'mcp', 'fonts')]) {
  if (existsSync(dir)) GlobalFonts.loadFontsFromDir(dir);
}
