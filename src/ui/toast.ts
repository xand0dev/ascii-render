import { icon } from './icons';

let host: HTMLElement | null = null;

export function toast(message: string, kind: 'info' | 'ok' | 'err' = 'info', ms = 2600) {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const ic = kind === 'ok' ? 'check' : kind === 'err' ? 'x' : 'sparkles';
  el.innerHTML = `${icon(ic, 14)}<span></span>`;
  el.querySelector('span')!.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 300);
  }, ms);
}
