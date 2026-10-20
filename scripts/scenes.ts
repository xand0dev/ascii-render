// Procedural source footage for the demo reel, so the repo ships no third-party video.
import type { SKRSContext2D } from '@napi-rs/canvas';

type Ctx = SKRSContext2D;
type V3 = [number, number, number];

function rotate([x, y, z]: V3, ax: number, ay: number): V3 {
  // yaw around Y, then pitch around X
  const cy = Math.cos(ay), sy = Math.sin(ay);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cx = Math.cos(ax), sx = Math.sin(ax);
  return [x1, y * cx - z1 * sx, y * sx + z1 * cx];
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v: V3): V3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

interface Face { pts: V3[]; n: V3; color: [number, number, number]; emissive: number }

/** Axis-aligned box as 6 outward-facing quads. */
function box(c: V3, h: V3, color: [number, number, number], emissive = 0): Face[] {
  const [x0, y0, z0] = [c[0] - h[0], c[1] - h[1], c[2] - h[2]];
  const [x1, y1, z1] = [c[0] + h[0], c[1] + h[1], c[2] + h[2]];
  const f = (pts: V3[], n: V3): Face => ({ pts, n, color, emissive });
  return [
    f([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0]),
    f([[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]], [-1, 0, 0]),
    f([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [0, 1, 0]),
    f([[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]], [0, -1, 0]),
    f([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]),
    f([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]),
  ];
}

/** Hollow lattice cube of steel beams with a glowing red core and orbiting red blocks. */
export function drawCube(ctx: Ctx, W: number, H: number, t: number) {
  const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
  bg.addColorStop(0, '#1c0a0c');
  bg.addColorStop(0.5, '#0a0607');
  bg.addColorStop(1, '#000');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const faces: Face[] = [];
  const th = 0.24;
  const steel: [number, number, number] = [196, 198, 206];
  for (let axis = 0; axis < 3; axis++) {
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        const c: V3 = [0, 0, 0];
        const h: V3 = [th / 2, th / 2, th / 2];
        c[(axis + 1) % 3] = a;
        c[(axis + 2) % 3] = b;
        h[axis] = 1 + th / 2;
        faces.push(...box(c, h, steel));
      }
    }
  }
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
  faces.push(...box([0, 0, 0], [0.3, 0.3, 0.3], [255, 34, 44], 0.55 + 0.35 * pulse));
  for (let k = 0; k < 6; k++) {
    const a = t * 0.7 + (k / 6) * Math.PI * 2;
    const r = 1.95;
    faces.push(...box([Math.cos(a) * r, Math.sin(a * 2 + k) * 0.55, Math.sin(a) * r], [0.12, 0.12, 0.12], [255, 40, 50], 0.4));
  }

  const ay = t * 0.55;
  const ax = 0.55 + 0.18 * Math.sin(t * 0.5);
  const D = 4.6;
  const scale = Math.min(W, H) * 0.8;
  const light = norm([-0.45, 0.75, -0.55]);
  const project = (p: V3) => {
    const f = scale / (p[2] + D);
    return [W / 2 + p[0] * f, H / 2 - p[1] * f] as const;
  };

  const drawn = faces
    .map((f) => {
      const pts = f.pts.map((p) => rotate(p, ax, ay));
      const n = rotate(f.n, ax, ay);
      const c: V3 = [
        (pts[0][0] + pts[2][0]) / 2, (pts[0][1] + pts[2][1]) / 2, (pts[0][2] + pts[2][2]) / 2,
      ];
      return { f, pts, n, depth: c[2], visible: dot(n, [c[0], c[1], c[2] + D]) < 0 };
    })
    .filter((d) => d.visible)
    .sort((a, b) => b.depth - a.depth);

  let corePt: readonly [number, number] | null = null;
  for (const d of drawn) {
    const diff = Math.max(0, dot(d.n, light));
    const spec = Math.pow(Math.max(0, d.n[1] * 0.4 - d.n[2] * 0.6), 18) * 0.6;
    const k = Math.min(1.3, 0.16 + 0.84 * diff + d.f.emissive) ;
    const [r, g, b] = d.f.color.map((v) => Math.min(255, v * k + 255 * spec));
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    ctx.beginPath();
    d.pts.forEach((p, i) => {
      const [x, y] = project(p);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    if (d.f.emissive > 0.5 && !corePt) corePt = project([0, 0, 0]);
  }

  const cp = corePt ?? project(rotate([0, 0, 0], ax, ay));
  const glow = ctx.createRadialGradient(cp[0], cp[1], 0, cp[0], cp[1], Math.min(W, H) * 0.35);
  glow.addColorStop(0, `rgba(255,40,50,${0.55 + 0.25 * pulse})`);
  glow.addColorStop(0.35, 'rgba(255,20,35,0.18)');
  glow.addColorStop(1, 'rgba(255,0,0,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
}

/** The classic spinning torus (à la donut.c), shaded with a red → white ramp. */
export function drawDonut(ctx: Ctx, W: number, H: number, t: number) {
  const img = ctx.createImageData(W, H);
  const px = img.data;
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  const zbuf = new Float32Array(W * H);
  const A = 1.1 + t * 0.9, B = 0.6 + t * 0.45;
  const cA = Math.cos(A), sA = Math.sin(A), cB = Math.cos(B), sB = Math.sin(B);
  const R1 = 1, R2 = 2, K2 = 5;
  const K1 = (Math.min(W, H) * K2 * 3) / (8 * (R1 + R2)) * 1.05;
  const ramp = (L: number): [number, number, number] => {
    // dark crimson → red → hot white
    if (L < 0.5) { const k = L / 0.5; return [60 + 190 * k, 4 + 22 * k, 14 + 22 * k]; }
    const k = (L - 0.5) / 0.5;
    return [250 + 5 * k, 26 + 200 * k, 36 + 180 * k];
  };
  for (let th = 0; th < 6.283; th += 0.008) {
    const ct = Math.cos(th), st = Math.sin(th);
    for (let ph = 0; ph < 6.283; ph += 0.004) {
      const cp = Math.cos(ph), sp = Math.sin(ph);
      const cx = R2 + R1 * ct, cy = R1 * st;
      const x = cx * (cB * cp + sA * sB * sp) - cy * cA * sB;
      const y = cx * (sB * cp - sA * cB * sp) + cy * cA * cB;
      const z = K2 + cA * cx * sp + cy * sA;
      const ooz = 1 / z;
      const xp = Math.round(W / 2 + K1 * ooz * x);
      const yp = Math.round(H / 2 - K1 * ooz * y);
      const L = cp * ct * sB - cA * ct * sp - sA * st + cB * (cA * st - ct * sA * sp);
      if (xp < 0 || yp < 0 || xp >= W - 1 || yp >= H - 1) continue;
      const idx = yp * W + xp;
      if (ooz <= zbuf[idx]) continue;
      const [r, g, b] = ramp(Math.max(0, L) / 1.414);
      for (const o of [idx, idx + 1, idx + W, idx + W + 1]) {
        if (ooz <= zbuf[o]) continue;
        zbuf[o] = ooz;
        px[o * 4] = r; px[o * 4 + 1] = g; px[o * 4 + 2] = b;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Smooth-coloured Mandelbrot zoom into the seahorse valley. */
export function drawMandel(ctx: Ctx, W: number, H: number, t: number) {
  const img = ctx.createImageData(W, H);
  const px = img.data;
  const cx = -0.743643887037151, cy = 0.13182590420533;
  const span = 0.32 * Math.pow(0.5, t * 1.6);
  const maxIt = Math.round(220 + t * 110);
  const sx = span / W;
  for (let y = 0; y < H; y++) {
    const ci = cy + (y - H / 2) * sx;
    for (let x = 0; x < W; x++) {
      const cr = cx + (x - W / 2) * sx;
      let zr = 0, zi = 0, i = 0, zr2 = 0, zi2 = 0;
      while (zr2 + zi2 < 256 && i < maxIt) {
        zi = 2 * zr * zi + ci;
        zr = zr2 - zi2 + cr;
        zr2 = zr * zr;
        zi2 = zi * zi;
        i++;
      }
      const o = (y * W + x) * 4;
      px[o + 3] = 255;
      if (i >= maxIt) continue;
      const v = i + 1 - Math.log2(Math.log2(zr2 + zi2) / 2);
      // banded luminance with a crimson → white ramp, so every preset has structure to work with
      const L = Math.pow(0.5 + 0.5 * Math.cos(v * 0.22 - t * 2.2), 1.6) * Math.min(1, v / 18);
      px[o] = 40 + 215 * Math.min(1, L * 1.6);
      px[o + 1] = 6 + 230 * Math.max(0, L - 0.45) * 1.8;
      px[o + 2] = 14 + 220 * Math.max(0, L - 0.5) * 1.8;
    }
  }
  ctx.putImageData(img, 0, 0);
}
