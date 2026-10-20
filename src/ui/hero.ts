import { FONT_FAMILY } from '../ascii';

const RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

/** Animated ASCII plasma for the empty state; reacts to the cursor. */
export class Hero {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private mx = -1e4;
  private my = -1e4;
  private running = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    const host = canvas.parentElement!;
    host.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mx = e.clientX - r.left;
      this.my = e.clientY - r.top;
    });
    host.addEventListener('pointerleave', () => { this.mx = this.my = -1e4; });
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = (ts: number) => {
      if (!this.running) return;
      this.draw(ts / 1000);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private draw(t: number) {
    const c = this.canvas;
    const dpr = Math.min(2, devicePixelRatio);
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const cw = 9;
    const ch = 15;
    const cols = Math.ceil(W / cw);
    const rows = Math.ceil(H / ch);
    ctx.font = `500 12px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const n = RAMP.length;
    const cx = W / 2;
    const cy = H / 2;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const px = x * cw + cw / 2;
        const py = y * ch + ch / 2;
        let v =
          Math.sin(x * 0.09 + t * 0.9) +
          Math.sin(y * 0.16 - t * 1.1) +
          Math.sin((x + y) * 0.05 + t * 0.6) +
          Math.sin(Math.hypot(px - cx, py - cy) * 0.018 - t * 1.4);
        v = (v + 4) / 8;
        const dm = Math.hypot(px - this.mx, py - this.my);
        if (dm < 180) v += (1 - dm / 180) * 0.55 * (0.6 + 0.4 * Math.sin(dm * 0.08 - t * 6));
        // fade towards the edges so the card in the middle reads clearly
        const vignette = Math.min(1, Math.hypot((px - cx) / (W * 0.62), (py - cy) / (H * 0.62)));
        v *= 0.25 + vignette * 0.75;
        if (v < 0.18) continue;
        const idx = Math.min(n - 1, Math.floor(v * n * 0.85));
        const a = Math.min(1, (v - 0.18) * 1.6);
        // graphite glyphs that heat up to blood red at the peaks
        const heat = Math.max(0, (v - 0.55) / 0.45);
        ctx.fillStyle = heat > 0
          ? `hsla(${356 + heat * 4}, ${70 + heat * 30}%, ${35 + heat * 22}%, ${a * 0.7})`
          : `hsla(240, 4%, ${40 + v * 30}%, ${a * 0.4})`;
        ctx.fillText(RAMP[idx], px, py);
      }
    }
  }
}
