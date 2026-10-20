import type { Crop } from './looks';

/** Original on the left, ASCII on the right, with a slowly swinging divider. */
export function drawCompare(
  comp: HTMLCanvasElement, source: CanvasImageSource, ascii: HTMLCanvasElement, crop: Crop, t: number,
  labels: [string, string] = ['ORIGINAL', 'ASCII'],
) {
  const W = comp.width, H = comp.height;
  const ctx = comp.getContext('2d')!;
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
  const p = 0.5 + 0.36 * Math.sin(t * 0.9 - 0.6);
  const x = Math.round(p * W);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, 0, W - x, H);
  ctx.clip();
  ctx.drawImage(ascii, 0, 0);
  ctx.restore();

  const u = Math.min(W, H) / 1080;
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,.7)';
  ctx.shadowBlur = 14 * u;
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 1.5 * u, 0, 3 * u, H);
  ctx.beginPath();
  ctx.arc(x, H / 2, 22 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#111';
  ctx.font = `700 ${20 * u}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('‹ ›', x, H / 2 + u);

  const tag = (label: string, tx: number, align: 'left' | 'right', color: string) => {
    ctx.font = `700 ${18 * u}px "JetBrains Mono", monospace`;
    const w = ctx.measureText(label).width + 22 * u;
    const bx = align === 'left' ? tx : tx - w;
    ctx.fillStyle = 'rgba(0,0,0,.62)';
    ctx.beginPath();
    ctx.roundRect(bx, 24 * u, w, 36 * u, 8 * u);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(label, bx + 11 * u, 42 * u + u);
  };
  if (x > 200 * u) tag(labels[0], x - 16 * u, 'right', '#fff');
  if (W - x > 140 * u) tag(labels[1], x + 16 * u, 'left', '#ff4a52');
}
