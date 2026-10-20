export function fmtTime(t: number, withFrac = true) {
  if (!Number.isFinite(t)) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${withFrac ? '.' + String(cs).padStart(2, '0') : ''}`;
}

/** Filmstrip timeline with draggable in/out handles and a scrubbable playhead. */
export class Timeline {
  duration = 0;
  inPoint = 0;
  outPoint = 0;
  onSeek?: (t: number) => void;
  onTrim?: (a: number, b: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;

  private ruler: HTMLElement;
  private track: HTMLElement;
  private strip: HTMLElement;
  private shadeL: HTMLElement;
  private shadeR: HTMLElement;
  private range: HTMLElement;
  private head: HTMLElement;
  private hover: HTMLElement;
  private thumbToken = 0;
  private markers: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="tl-ruler"></div>
      <div class="tl-track">
        <div class="tl-strip"></div>
        <div class="tl-markers"></div>
        <div class="tl-shade l"></div><div class="tl-shade r"></div>
        <div class="tl-range"><div class="tl-h in"><i></i></div><div class="tl-h out"><i></i></div></div>
        <div class="tl-head"><div class="tl-knob"></div></div>
        <div class="tl-hover"><span></span></div>
      </div>`;
    this.ruler = root.querySelector('.tl-ruler')!;
    this.track = root.querySelector('.tl-track')!;
    this.strip = root.querySelector('.tl-strip')!;
    this.shadeL = root.querySelector('.tl-shade.l')!;
    this.shadeR = root.querySelector('.tl-shade.r')!;
    this.range = root.querySelector('.tl-range')!;
    this.head = root.querySelector('.tl-head')!;
    this.hover = root.querySelector('.tl-hover')!;
    this.markers = root.querySelector('.tl-markers')!;

    const timeAt = (clientX: number) => {
      const r = this.track.getBoundingClientRect();
      return Math.min(this.duration, Math.max(0, ((clientX - r.left) / r.width) * this.duration));
    };

    this.track.addEventListener('pointermove', (e) => {
      if (!this.duration) return;
      const t = timeAt(e.clientX);
      this.hover.style.left = `${(t / this.duration) * 100}%`;
      this.hover.querySelector('span')!.textContent = fmtTime(t);
    });

    this.track.addEventListener('pointerdown', (e) => {
      if (!this.duration || e.button !== 0) return;
      const target = e.target as HTMLElement;
      const h = target.closest('.tl-h');
      this.track.setPointerCapture(e.pointerId);
      let move: (ev: PointerEvent) => void;
      if (h) {
        const isIn = h.classList.contains('in');
        this.track.classList.add('trimming');
        move = (ev) => {
          const t = timeAt(ev.clientX);
          const minGap = Math.min(0.1, this.duration / 10);
          if (isIn) this.inPoint = Math.min(t, this.outPoint - minGap);
          else this.outPoint = Math.max(t, this.inPoint + minGap);
          this.layoutTrim();
          this.onSeek?.(isIn ? this.inPoint : this.outPoint);
          this.onTrim?.(this.inPoint, this.outPoint);
        };
      } else {
        this.onScrubStart?.();
        this.track.classList.add('scrubbing');
        move = (ev) => this.onSeek?.(timeAt(ev.clientX));
        move(e);
      }
      this.track.addEventListener('pointermove', move);
      this.track.addEventListener('pointerup', () => {
        this.track.removeEventListener('pointermove', move);
        if (this.track.classList.contains('scrubbing')) this.onScrubEnd?.();
        this.track.classList.remove('trimming', 'scrubbing');
      }, { once: true });
    });

    new ResizeObserver(() => this.renderRuler()).observe(this.track);
  }

  setDuration(d: number) {
    this.duration = d;
    this.inPoint = 0;
    this.outPoint = d;
    this.layoutTrim();
    this.renderRuler();
    this.onTrim?.(this.inPoint, this.outPoint);
  }

  setTrim(a: number, b: number) {
    this.inPoint = Math.max(0, Math.min(a, this.duration));
    this.outPoint = Math.max(this.inPoint, Math.min(b, this.duration));
    this.layoutTrim();
    this.onTrim?.(this.inPoint, this.outPoint);
  }

  /** Small ticks over the filmstrip (e.g. detected beats). */
  setMarkers(times: number[]) {
    if (!this.duration || !times.length) { this.markers.innerHTML = ''; return; }
    this.markers.innerHTML = times
      .filter((t) => t <= this.duration)
      .map((t) => `<i style="left:${(t / this.duration) * 100}%"></i>`)
      .join('');
  }

  setTime(t: number) {
    if (!this.duration) return;
    this.head.style.left = `${(t / this.duration) * 100}%`;
  }

  private layoutTrim() {
    if (!this.duration) return;
    const a = (this.inPoint / this.duration) * 100;
    const b = (this.outPoint / this.duration) * 100;
    this.shadeL.style.width = `${a}%`;
    this.shadeR.style.width = `${100 - b}%`;
    this.range.style.left = `${a}%`;
    this.range.style.width = `${b - a}%`;
  }

  private renderRuler() {
    const w = this.track.clientWidth;
    if (!this.duration || !w) { this.ruler.innerHTML = ''; return; }
    const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find((s) => (s / this.duration) * w >= 64) ?? 600;
    let html = '';
    for (let t = 0; t <= this.duration + 1e-6; t += step) {
      html += `<span style="left:${(t / this.duration) * 100}%">${fmtTime(t, step < 1)}</span>`;
    }
    const minor = step / 4;
    for (let t = 0; t <= this.duration + 1e-6; t += minor) {
      html += `<i style="left:${(t / this.duration) * 100}%"></i>`;
    }
    this.ruler.innerHTML = html;
  }

  async generateThumbs(src: string, aspect: number) {
    const token = ++this.thumbToken;
    this.strip.innerHTML = '';
    const h = this.strip.clientHeight || 52;
    const w = this.strip.clientWidth || 800;
    const tw = Math.max(24, h * aspect);
    const n = Math.max(1, Math.ceil(w / tw));
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = src;
    await new Promise((r) => { v.onloadeddata = r; v.onerror = r; });
    if (!v.videoWidth) return;
    const dpr = Math.min(2, devicePixelRatio);
    const cells: HTMLCanvasElement[] = [];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas');
      c.width = Math.round(tw * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${tw}px`;
      this.strip.appendChild(c);
      cells.push(c);
    }
    for (let i = 0; i < n; i++) {
      if (token !== this.thumbToken) return;
      await new Promise<void>((r) => {
        v.onseeked = () => r();
        v.currentTime = ((i + 0.5) / n) * v.duration;
      });
      const c = cells[i];
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
      c.classList.add('ready');
    }
    v.removeAttribute('src');
    v.load();
  }

  clear() {
    this.thumbToken++;
    this.strip.innerHTML = '';
    this.markers.innerHTML = '';
    this.duration = 0;
    this.ruler.innerHTML = '';
  }
}
