export type ViewMode = 'ascii' | 'compare';

/** Fit-to-viewport frame with wheel zoom, drag pan and a before/after wipe. */
export class Viewer {
  scale = 1;
  private tx = 0;
  private ty = 0;
  private baseW = 0;
  private baseH = 0;
  private aspect = 16 / 9;
  private wipe = 0.5;
  mode: ViewMode = 'ascii';
  onZoom?: (scale: number) => void;

  constructor(
    private viewport: HTMLElement,
    private frame: HTMLElement,
    private canvas: HTMLCanvasElement,
    private origLayer: HTMLElement,
    private handle: HTMLElement,
  ) {
    new ResizeObserver(() => this.layout()).observe(viewport);

    viewport.addEventListener('wheel', (e) => {
      if (!this.baseW) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
      this.zoomAt(factor, e.clientX, e.clientY);
    }, { passive: false });

    let pan: { x: number; y: number; tx: number; ty: number } | null = null;
    viewport.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('.wipe-handle, .hud, .hero-card')) return;
      if (this.scale <= 1.001) return;
      pan = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
      viewport.setPointerCapture(e.pointerId);
      viewport.classList.add('panning');
    });
    viewport.addEventListener('pointermove', (e) => {
      if (!pan) return;
      this.tx = pan.tx + e.clientX - pan.x;
      this.ty = pan.ty + e.clientY - pan.y;
      this.clamp();
      this.apply();
    });
    const endPan = () => { pan = null; viewport.classList.remove('panning'); };
    viewport.addEventListener('pointerup', endPan);
    viewport.addEventListener('pointercancel', endPan);
    viewport.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.wipe-handle, .hud, .hero-card')) return;
      if (this.scale > 1.001) this.fit();
      else this.zoomAt(3, e.clientX, e.clientY);
    });

    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const r = frame.getBoundingClientRect();
        this.setWipe((ev.clientX - r.left) / r.width);
      };
      move(e);
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', () => handle.removeEventListener('pointermove', move), { once: true });
    });
  }

  setAspect(a: number) {
    this.aspect = a;
    this.layout();
  }

  layout() {
    const pad = 28;
    const vw = Math.max(10, this.viewport.clientWidth - pad * 2);
    const vh = Math.max(10, this.viewport.clientHeight - pad * 2);
    const w = Math.min(vw, vh * this.aspect);
    this.baseW = w;
    this.baseH = w / this.aspect;
    this.frame.style.width = `${this.baseW}px`;
    this.frame.style.height = `${this.baseH}px`;
    this.clamp();
    this.apply();
  }

  private clamp() {
    const mx = Math.max(0, (this.baseW * this.scale - this.viewport.clientWidth) / 2 + 40);
    const my = Math.max(0, (this.baseH * this.scale - this.viewport.clientHeight) / 2 + 40);
    this.tx = Math.min(mx, Math.max(-mx, this.tx));
    this.ty = Math.min(my, Math.max(-my, this.ty));
    if (this.scale <= 1.001) { this.tx = 0; this.ty = 0; }
  }

  private apply() {
    this.frame.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    this.viewport.classList.toggle('zoomed', this.scale > 1.001);
    this.onZoom?.(this.scale);
  }

  zoomAt(factor: number, cx?: number, cy?: number) {
    const r = this.viewport.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - (r.left + r.width / 2);
    const py = (cy ?? r.top + r.height / 2) - (r.top + r.height / 2);
    const ns = Math.min(24, Math.max(1, this.scale * factor));
    this.tx = px - (px - this.tx) * (ns / this.scale);
    this.ty = py - (py - this.ty) * (ns / this.scale);
    this.scale = ns;
    this.clamp();
    this.apply();
  }

  fit() {
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.apply();
  }

  oneToOne() {
    const target = this.canvas.width / devicePixelRatio / this.baseW;
    this.zoomAt(target / this.scale);
  }

  setMode(m: ViewMode) {
    this.mode = m;
    this.frame.classList.toggle('compare', m === 'compare');
    this.setWipe(this.wipe);
  }

  setWipe(p: number) {
    this.wipe = Math.min(1, Math.max(0, p));
    this.origLayer.style.clipPath = `inset(0 ${(1 - this.wipe) * 100}% 0 0)`;
    this.handle.style.left = `${this.wipe * 100}%`;
  }
}
