import { CHARSETS, DEFAULTS, FONTS, type Settings } from '../ascii';
import { t, tryT } from '../i18n';
import { icon } from './icons';

type Key = keyof Settings;
// Labels come from i18n: `c.<key>`, optional `c.<key>.hint` and `c.<key>.ph`; seg option labels are i18n keys or raw text.
type Ctl =
  | { key: Key; type: 'range'; min: number; max: number; step: number }
  | { key: Key; type: 'seg'; options: [string, string][] }
  | { key: Key; type: 'toggle' }
  | { key: Key; type: 'color' }
  | { key: Key; type: 'text'; placeholder?: string }
  | { key: Key; type: 'charset' }
  | { key: Key; type: 'font' };

interface Section { id: string; icon: string; badge?: string; ctls: Ctl[] }

const SECTIONS: Section[] = [
  {
    id: 'wow', icon: 'sparkles', badge: 'NEW', ctls: [
      { key: 'audioReact', type: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'glitch', type: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'decode', type: 'range', min: 0, max: 4, step: 0.1 },
      { key: 'rain', type: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'trails', type: 'range', min: 0, max: 0.95, step: 0.01 },
      { key: 'motion', type: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'overlayText', type: 'text' },
      { key: 'overlaySize', type: 'range', min: 0.08, max: 0.7, step: 0.01 },
      { key: 'overlayPos', type: 'seg', options: [['top', 'opt.top'], ['center', 'opt.center'], ['bottom', 'opt.bottom']] },
      { key: 'overlayColor', type: 'color' },
    ],
  },
  {
    id: 'grid', icon: 'grid', ctls: [
      { key: 'columns', type: 'range', min: 40, max: 400, step: 1 },
      { key: 'cellAspect', type: 'range', min: 1, max: 2.5, step: 0.05 },
      { key: 'fontScale', type: 'range', min: 0.6, max: 1.6, step: 0.05 },
      { key: 'font', type: 'font' },
      { key: 'fontWeight', type: 'seg', options: [['300', 'Light'], ['500', 'Med'], ['700', 'Bold'], ['800', 'Black']] },
    ],
  },
  {
    id: 'chars', icon: 'type', ctls: [
      { key: 'charset', type: 'charset' },
      { key: 'customChars', type: 'text', placeholder: ' .:-=+*#%@' },
      { key: 'sortDensity', type: 'toggle' },
      { key: 'edges', type: 'toggle' },
      { key: 'edgeThreshold', type: 'range', min: 0.1, max: 1.5, step: 0.01 },
      { key: 'noise', type: 'range', min: 0, max: 0.3, step: 0.005 },
    ],
  },
  {
    id: 'tone', icon: 'sun', ctls: [
      { key: 'contrast', type: 'range', min: 0.3, max: 3, step: 0.01 },
      { key: 'brightness', type: 'range', min: -0.5, max: 0.5, step: 0.01 },
      { key: 'gamma', type: 'range', min: 0.3, max: 2.5, step: 0.01 },
      { key: 'invert', type: 'toggle' },
    ],
  },
  {
    id: 'color', icon: 'palette', ctls: [
      { key: 'colorMode', type: 'seg', options: [['original', 'opt.original'], ['mono', 'opt.mono'], ['duotone', 'opt.duotone'], ['accent', 'opt.accent'], ['thermal', 'opt.thermal']] },
      { key: 'saturation', type: 'range', min: 0, max: 3, step: 0.01 },
      { key: 'colorNormalize', type: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'fg', type: 'color' },
      { key: 'duoA', type: 'color' },
      { key: 'duoB', type: 'color' },
      { key: 'accent', type: 'color' },
      { key: 'accentTolerance', type: 'range', min: 0.02, max: 0.3, step: 0.005 },
      { key: 'bg', type: 'color' },
      { key: 'bgVideo', type: 'range', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    id: 'fx', icon: 'zap', ctls: [
      { key: 'glow', type: 'range', min: 0, max: 1.5, step: 0.01 },
      { key: 'glowRadius', type: 'range', min: 1, max: 30, step: 0.5 },
      { key: 'scanlines', type: 'range', min: 0, max: 0.8, step: 0.01 },
    ],
  },
];

const label = (k: Key) => tryT(`c.${k}`, k);
const hint = (k: Key) => tryT(`c.${k}.hint`, '');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const COLLAPSE_KEY = 'ascii-render-collapsed';

function fmt(v: number, step: number) {
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return v.toFixed(d);
}

export class Controls {
  private syncers: ((s: Settings) => void)[] = [];
  private rows = new Map<Key, HTMLElement>();
  private collapsed: Set<string>;

  constructor(root: HTMLElement, private onChange: (key: Key, value: unknown) => void) {
    let saved: string[] = [];
    try { saved = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'); } catch { /* ignore */ }
    this.collapsed = new Set(saved);
    for (const sec of SECTIONS) root.appendChild(this.buildSection(sec));
  }

  private buildSection(sec: Section) {
    const el = document.createElement('section');
    el.className = 'sec';
    if (this.collapsed.has(sec.id)) el.classList.add('collapsed');
    const head = document.createElement('button');
    head.className = 'sec-head';
    head.innerHTML = `${icon(sec.icon, 14)}<span>${tryT(`sec.${sec.id}`, sec.id)}${sec.badge ? `<em class="badge">${sec.badge}</em>` : ''}</span>${icon('chevron', 14)}`;
    head.addEventListener('click', () => {
      el.classList.toggle('collapsed');
      if (el.classList.contains('collapsed')) this.collapsed.add(sec.id); else this.collapsed.delete(sec.id);
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...this.collapsed])); } catch { /* ignore */ }
    });
    const body = document.createElement('div');
    body.className = 'sec-body';
    const inner = document.createElement('div');
    inner.className = 'sec-inner';
    for (const c of sec.ctls) {
      const row = this.buildCtl(c);
      this.rows.set(c.key, row);
      inner.appendChild(row);
    }
    body.appendChild(inner);
    el.append(head, body);
    return el;
  }

  private buildCtl(c: Ctl): HTMLElement {
    const row = document.createElement('div');
    row.className = `ctl ctl-${c.type}`;
    const reset = () => this.onChange(c.key, DEFAULTS[c.key]);

    if (c.type === 'range') {
      row.innerHTML = `
        <div class="ctl-head">
          <span class="ctl-label" title="${esc(hint(c.key) || t('ctl.dblReset'))}">${label(c.key)}</span>
          <input class="ctl-num" type="text" inputmode="decimal" spellcheck="false" />
        </div>
        <input type="range" min="${c.min}" max="${c.max}" step="${c.step}" />`;
      const range = row.querySelector<HTMLInputElement>('input[type=range]')!;
      const num = row.querySelector<HTMLInputElement>('.ctl-num')!;
      range.addEventListener('input', () => this.onChange(c.key, Number(range.value)));
      const commitNum = () => {
        const v = Number(num.value.replace(',', '.'));
        if (Number.isFinite(v)) this.onChange(c.key, Math.min(c.max * 4, Math.max(c.min, v)));
      };
      num.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { commitNum(); num.blur(); }
        if (e.key === 'Escape') num.blur();
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const mult = e.shiftKey ? 10 : 1;
          const v = Number(range.value) + (e.key === 'ArrowUp' ? 1 : -1) * c.step * mult;
          this.onChange(c.key, Math.min(c.max, Math.max(c.min, v)));
        }
      });
      num.addEventListener('blur', commitNum);
      num.addEventListener('focus', () => num.select());
      row.querySelector('.ctl-label')!.addEventListener('dblclick', reset);
      range.addEventListener('dblclick', reset);
      this.syncers.push((s) => {
        const v = Number(s[c.key]);
        range.value = String(v);
        const p = ((v - c.min) / (c.max - c.min)) * 100;
        range.style.setProperty('--p', `${Math.min(100, Math.max(0, p))}%`);
        if (document.activeElement !== num) num.value = fmt(v, c.step);
        row.classList.toggle('modified', Math.abs(v - Number(DEFAULTS[c.key])) > 1e-9);
      });
    } else if (c.type === 'seg') {
      row.innerHTML = `<div class="ctl-head"><span class="ctl-label">${label(c.key)}</span></div><div class="seg${c.options.length > 4 ? ' wrap' : ''}"></div>`;
      const seg = row.querySelector('.seg')!;
      const btns = c.options.map(([v, l]) => {
        const b = document.createElement('button');
        b.textContent = tryT(l, l);
        b.addEventListener('click', () => this.onChange(c.key, v));
        seg.appendChild(b);
        return [v, b] as const;
      });
      this.syncers.push((s) => btns.forEach(([v, b]) => b.classList.toggle('on', String(s[c.key]) === v)));
    } else if (c.type === 'toggle') {
      row.innerHTML = `<label class="switch" title="${esc(hint(c.key))}"><span class="ctl-label">${label(c.key)}</span><input type="checkbox" /><i></i></label>`;
      const cb = row.querySelector<HTMLInputElement>('input')!;
      cb.addEventListener('change', () => this.onChange(c.key, cb.checked));
      this.syncers.push((s) => { cb.checked = Boolean(s[c.key]); });
    } else if (c.type === 'color') {
      const canPick = 'EyeDropper' in window;
      row.innerHTML = `<div class="color-row${canPick ? ' pick' : ''}"><span class="ctl-label">${label(c.key)}</span>${canPick ? `<button class="icon-btn sm eyedrop" title="${esc(t('ctl.eyedrop'))}">${icon('pipette', 14)}</button>` : ''}<label class="swatch"><input type="color" /><i></i></label><input class="hex" type="text" spellcheck="false" maxlength="7" /></div>`;
      row.querySelector('.eyedrop')?.addEventListener('click', async () => {
        try {
          const ED = (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
          const res = await new ED().open();
          this.onChange(c.key, res.sRGBHex.toLowerCase());
        } catch { /* cancelled */ }
      });
      const col = row.querySelector<HTMLInputElement>('input[type=color]')!;
      const hex = row.querySelector<HTMLInputElement>('.hex')!;
      const sw = row.querySelector<HTMLElement>('.swatch i')!;
      col.addEventListener('input', () => this.onChange(c.key, col.value));
      hex.addEventListener('change', () => {
        const v = hex.value.startsWith('#') ? hex.value : '#' + hex.value;
        if (/^#[0-9a-f]{6}$/i.test(v)) this.onChange(c.key, v.toLowerCase());
      });
      this.syncers.push((s) => {
        const v = String(s[c.key]);
        col.value = v;
        sw.style.background = v;
        if (document.activeElement !== hex) hex.value = v;
      });
    } else if (c.type === 'text') {
      row.innerHTML = `<div class="ctl-head"><span class="ctl-label">${label(c.key)}</span></div><input class="text" type="text" spellcheck="false" placeholder="${esc(tryT(`c.${c.key}.ph`, c.placeholder ?? ''))}" />`;
      const t = row.querySelector<HTMLInputElement>('input')!;
      t.addEventListener('input', () => this.onChange(c.key, t.value));
      this.syncers.push((s) => { if (document.activeElement !== t) t.value = String(s[c.key]); });
    } else if (c.type === 'font') {
      row.innerHTML = `<div class="ctl-head"><span class="ctl-label">${label(c.key)}</span></div><div class="fonts"></div>`;
      const grid = row.querySelector('.fonts')!;
      const btns = Object.entries(FONTS).map(([id, f]) => {
        const b = document.createElement('button');
        b.className = 'font-card';
        b.innerHTML = `<span class="f-sample">Aa@#</span><span class="f-name">${tryT(`font.${id}`, f.label)}</span>`;
        (b.querySelector('.f-sample') as HTMLElement).style.fontFamily = f.family;
        b.addEventListener('click', () => this.onChange('font', id));
        grid.appendChild(b);
        return [id, b] as const;
      });
      this.syncers.push((s) => btns.forEach(([id, b]) => b.classList.toggle('on', s.font === id)));
    } else {
      row.innerHTML = `<div class="charsets"></div>`;
      const grid = row.querySelector('.charsets')!;
      const btns = Object.entries(CHARSETS).map(([id, cs]) => {
        const b = document.createElement('button');
        b.className = 'charset';
        const sample = id === 'custom' ? 'Aa…' : Array.from(cs.chars).reverse().filter((ch) => ch !== ' ').slice(0, 9).join('');
        b.innerHTML = `<span class="cs-sample"></span><span class="cs-name">${tryT(`cs.${id}`, cs.label)}</span>`;
        b.querySelector('.cs-sample')!.textContent = sample;
        b.addEventListener('click', () => this.onChange('charset', id));
        grid.appendChild(b);
        return [id, b] as const;
      });
      this.syncers.push((s) => btns.forEach(([id, b]) => b.classList.toggle('on', s.charset === id)));
    }
    return row;
  }

  sync(s: Settings) {
    for (const f of this.syncers) f(s);
    const show = (k: Key, on: boolean) => this.rows.get(k)?.classList.toggle('hidden', !on);
    show('customChars', s.charset === 'custom');
    show('edgeThreshold', s.edges);
    show('saturation', s.colorMode === 'original');
    show('colorNormalize', s.colorMode === 'original');
    show('fg', s.colorMode === 'mono' || s.colorMode === 'accent');
    show('accent', s.colorMode === 'accent' || s.rain > 0);
    show('accentTolerance', s.colorMode === 'accent');
    show('duoA', s.colorMode === 'duotone');
    show('duoB', s.colorMode === 'duotone');
    show('glowRadius', s.glow > 0);
    const hasText = s.overlayText.trim().length > 0;
    show('overlaySize', hasText);
    show('overlayPos', hasText);
    show('overlayColor', hasText);
  }
}
