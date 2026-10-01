import * as THREE from 'three';
import { type CardId, type Suit, SUIT_INFO, isJester, isWizard, suitOf, valueOf } from '../../shared/cards';

/**
 * Alle Texturen werden prozedural per Canvas gezeichnet – keine externen Bilddateien.
 */

export const CARD_W = 1;
export const CARD_H = 1.55;
export const CARD_R = 0.065;

const TW = 512;
const TH = Math.round((TW * CARD_H) / CARD_W);

let anisotropy = 8;
export function setAnisotropy(a: number): void {
  anisotropy = a;
}

// ───────────────────────── Rauschen ─────────────────────────

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Graustufen-Rauschen in niedriger Auflösung, beim Zeichnen weich hochskaliert. */
function noiseCanvas(w: number, h: number, scale: number, octaves: number, seed: number, contrast = 1): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = fbm(x / scale, y / scale, octaves, seed);
      n = Math.min(1, Math.max(0, 0.5 + (n - 0.5) * contrast));
      const i = (y * w + x) * 4;
      const g = Math.round(n * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const n = (hash(p % w, Math.floor(p / w), seed) - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function toTexture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// ───────────────────────── Zeichenhilfen ─────────────────────────

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, ro: number, ri: number, points = 5, rot = -Math.PI / 2): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = rot + (i * Math.PI) / points;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function goldGradient(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, '#7d5717');
  g.addColorStop(0.22, '#e3bb5c');
  g.addColorStop(0.45, '#fff0b0');
  g.addColorStop(0.62, '#d2a03c');
  g.addColorStop(0.82, '#f2d27e');
  g.addColorStop(1, '#86601c');
  return g;
}

type Mode = 'color' | 'mask';
// Maskenkanäle: G = Rauheit, B = Metall (three.js-Konvention)
const M_PAPER = 'rgb(0,238,0)';
const M_PANEL = 'rgb(0,224,0)';
const M_GOLD = 'rgb(0,135,205)';

function gold(ctx: CanvasRenderingContext2D, mode: Mode, x0 = 0, y0 = 0, x1 = TW, y1 = TH): string | CanvasGradient {
  return mode === 'mask' ? M_GOLD : goldGradient(ctx, x0, y0, x1, y1);
}

let fontsReady = false;
export async function ensureFonts(): Promise<void> {
  if (fontsReady) return;
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('900 100px "Cinzel"'),
        document.fonts.load('700 40px "Cinzel"'),
        document.fonts.load('700 40px "Cinzel Decorative"'),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* Fallback-Schrift */
  }
  fontsReady = true;
}

// ───────────────────────── Embleme ─────────────────────────

interface EmblemStyle {
  fill: string | CanvasGradient;
  stroke: string;
  detail: string | CanvasGradient;
  line: number;
}

function drawEmblem(ctx: CanvasRenderingContext2D, suit: Suit, cx: number, cy: number, size: number, st: EmblemStyle): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(size, size);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = st.line / size;
  ctx.strokeStyle = st.stroke;
  const fs = () => {
    ctx.fillStyle = st.fill;
    ctx.fill();
    ctx.stroke();
  };
  if (suit === 0) {
    // Krone – Menschen
    ctx.beginPath();
    ctx.moveTo(-0.82, 0.42);
    ctx.lineTo(-0.95, -0.42);
    ctx.lineTo(-0.48, -0.02);
    ctx.lineTo(0, -0.72);
    ctx.lineTo(0.48, -0.02);
    ctx.lineTo(0.95, -0.42);
    ctx.lineTo(0.82, 0.42);
    ctx.closePath();
    fs();
    rr(ctx, -0.88, 0.36, 1.76, 0.32, 0.07);
    fs();
    ctx.fillStyle = st.detail;
    for (const [x, y, r] of [
      [-0.95, -0.42, 0.12],
      [0, -0.72, 0.14],
      [0.95, -0.42, 0.12],
      [-0.48, 0.52, 0.075],
      [0, 0.52, 0.095],
      [0.48, 0.52, 0.075],
    ]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (suit === 2) {
    // Blatt – Elfen
    ctx.beginPath();
    ctx.moveTo(0, 0.72);
    ctx.bezierCurveTo(-0.98, 0.42, -0.72, -0.5, 0, -0.98);
    ctx.bezierCurveTo(0.72, -0.5, 0.98, 0.42, 0, 0.72);
    ctx.closePath();
    fs();
    ctx.beginPath();
    ctx.moveTo(0, 0.7);
    ctx.quadraticCurveTo(0.05, 0.9, 0.16, 1.02);
    ctx.stroke();
    ctx.strokeStyle = st.detail as string;
    ctx.lineWidth = (st.line * 0.7) / size;
    ctx.beginPath();
    ctx.moveTo(0, 0.66);
    ctx.lineTo(0, -0.8);
    for (const t of [0.4, 0.1, -0.2, -0.48]) {
      const w = 0.52 - Math.abs(t + 0.1) * 0.35;
      ctx.moveTo(0, t + 0.12);
      ctx.quadraticCurveTo(-w * 0.5, t - 0.02, -w, t - 0.18);
      ctx.moveTo(0, t + 0.12);
      ctx.quadraticCurveTo(w * 0.5, t - 0.02, w, t - 0.18);
    }
    ctx.stroke();
  } else if (suit === 1) {
    // Kriegshammer – Zwerge
    rr(ctx, -0.11, -0.3, 0.22, 1.28, 0.07);
    fs();
    ctx.beginPath();
    ctx.moveTo(-0.86, -0.6);
    ctx.lineTo(-0.72, -0.8);
    ctx.lineTo(0.72, -0.8);
    ctx.lineTo(0.86, -0.6);
    ctx.lineTo(0.86, -0.2);
    ctx.lineTo(0.72, -0.02);
    ctx.lineTo(-0.72, -0.02);
    ctx.lineTo(-0.86, -0.2);
    ctx.closePath();
    fs();
    ctx.fillStyle = st.detail;
    rr(ctx, -0.2, -0.86, 0.4, 0.9, 0.06);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = (st.line * 0.8) / size;
    ctx.beginPath();
    for (const y of [0.5, 0.64, 0.78]) {
      ctx.moveTo(-0.13, y);
      ctx.lineTo(0.13, y - 0.07);
    }
    ctx.stroke();
  } else {
    // Berge – Riesen
    ctx.beginPath();
    ctx.moveTo(-0.98, 0.66);
    ctx.lineTo(-0.4, -0.32);
    ctx.lineTo(-0.14, 0.04);
    ctx.lineTo(0.3, -0.86);
    ctx.lineTo(0.98, 0.66);
    ctx.closePath();
    fs();
    ctx.fillStyle = st.detail;
    ctx.beginPath();
    ctx.moveTo(0.3, -0.86);
    ctx.lineTo(0.53, -0.4);
    ctx.lineTo(0.4, -0.47);
    ctx.lineTo(0.3, -0.34);
    ctx.lineTo(0.18, -0.5);
    ctx.lineTo(0.07, -0.38);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.4, -0.32);
    ctx.lineTo(-0.26, -0.08);
    ctx.lineTo(-0.35, -0.13);
    ctx.lineTo(-0.42, -0.05);
    ctx.lineTo(-0.52, -0.12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function wizardHat(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, robe: string, robeDark: string, mode: Mode): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(size, size);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5 / size;
  ctx.strokeStyle = '#0b0820';
  const g = gold(ctx, mode, -1, -1, 1, 1);
  if (mode === 'color') {
    // Krempe
    ctx.beginPath();
    ctx.ellipse(0, 0.56, 0.98, 0.21, 0, 0, Math.PI * 2);
    const gb = ctx.createLinearGradient(0, 0.35, 0, 0.77);
    gb.addColorStop(0, robe);
    gb.addColorStop(1, robeDark);
    ctx.fillStyle = gb;
    ctx.fill();
    ctx.stroke();
    // Spitze
    ctx.beginPath();
    ctx.moveTo(-0.56, 0.54);
    ctx.quadraticCurveTo(-0.3, -0.1, 0.06, -0.56);
    ctx.quadraticCurveTo(0.32, -0.86, 0.7, -0.7);
    ctx.quadraticCurveTo(0.4, -0.64, 0.27, -0.36);
    ctx.quadraticCurveTo(0.42, 0.06, 0.58, 0.54);
    ctx.closePath();
    const gc = ctx.createLinearGradient(-0.6, 0, 0.6, 0);
    gc.addColorStop(0, robeDark);
    gc.addColorStop(0.45, robe);
    gc.addColorStop(1, robeDark);
    ctx.fillStyle = gc;
    ctx.fill();
    ctx.stroke();
  }
  // Hutband
  ctx.beginPath();
  ctx.moveTo(-0.52, 0.36);
  ctx.quadraticCurveTo(0, 0.47, 0.54, 0.36);
  ctx.lineTo(0.58, 0.53);
  ctx.quadraticCurveTo(0, 0.65, -0.57, 0.53);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  if (mode === 'color') ctx.stroke();
  // Sterne
  for (const [x, y, r] of [
    [-0.08, 0.04, 0.1],
    [0.16, -0.3, 0.065],
    [0.24, 0.18, 0.075],
    [-0.28, 0.3, 0.05],
  ]) {
    starPath(ctx, x, y, r, r * 0.45);
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.restore();
}

function jesterHat(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, c1: string, c2: string, mode: Mode): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(size, size);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5 / size;
  ctx.strokeStyle = '#1d1022';
  const g = gold(ctx, mode, -1, -1, 1, 1);
  const lobes: [number[], string][] = [
    [[-0.56, 0.48, -0.72, -0.05, -0.97, -0.2, -0.45, -0.1, -0.14, 0.5], c1],
    [[0.56, 0.48, 0.72, -0.05, 0.97, -0.2, 0.45, -0.1, 0.14, 0.5], c1],
    [[-0.27, 0.52, -0.25, -0.38, 0.02, -0.94, 0.16, -0.34, 0.27, 0.52], c2],
  ];
  if (mode === 'color') {
    for (const [p, col] of lobes) {
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.quadraticCurveTo(p[2], p[3], p[4], p[5]);
      ctx.quadraticCurveTo(p[6], p[7], p[8], p[9]);
      ctx.closePath();
      const lg = ctx.createLinearGradient(p[4], p[5], p[0], p[1]);
      lg.addColorStop(0, col);
      lg.addColorStop(1, shade(col, -0.35));
      ctx.fillStyle = lg;
      ctx.fill();
      ctx.stroke();
    }
    // Stirnband
    ctx.beginPath();
    ctx.moveTo(-0.62, 0.44);
    ctx.quadraticCurveTo(0, 0.62, 0.62, 0.44);
    ctx.lineTo(0.64, 0.72);
    ctx.quadraticCurveTo(0, 0.92, -0.64, 0.72);
    ctx.closePath();
    ctx.fillStyle = '#f3e6c4';
    ctx.fill();
    ctx.stroke();
  }
  // Rauten auf dem Band + Glöckchen
  ctx.fillStyle = g;
  for (const x of [-0.4, 0, 0.4]) {
    ctx.beginPath();
    const y = 0.6 + (x === 0 ? 0.08 : 0.03);
    ctx.moveTo(x, y - 0.09);
    ctx.lineTo(x + 0.08, y);
    ctx.lineTo(x, y + 0.09);
    ctx.lineTo(x - 0.08, y);
    ctx.closePath();
    ctx.fill();
  }
  for (const [x, y] of [
    [-0.97, -0.2],
    [0.97, -0.2],
    [0.02, -0.94],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 0.12, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    if (mode === 'color') {
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y + 0.03, 0.03, 0, Math.PI * 2);
      ctx.fillStyle = '#3a2a10';
      ctx.fill();
    }
  }
  ctx.restore();
}

function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  if (amt < 0) c.lerp(new THREE.Color(0, 0, 0), -amt);
  else c.lerp(new THREE.Color(1, 1, 1), amt);
  return `#${c.getHexString()}`;
}

// ───────────────────────── Kartenbausteine ─────────────────────────

let parchmentCache: HTMLCanvasElement | null = null;
function parchment(): HTMLCanvasElement {
  if (parchmentCache) return parchmentCache;
  const [c, ctx] = makeCanvas(TW, TH);
  ctx.fillStyle = '#efe2c2';
  ctx.fillRect(0, 0, TW, TH);
  const n = noiseCanvas(96, 150, 14, 4, 7, 1.6);
  ctx.globalAlpha = 0.22;
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(n, 0, 0, TW, TH);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const vg = ctx.createRadialGradient(TW / 2, TH / 2, TH * 0.25, TW / 2, TH / 2, TH * 0.65);
  vg.addColorStop(0, 'rgba(120,80,30,0)');
  vg.addColorStop(1, 'rgba(120,80,30,0.25)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, TW, TH);
  grain(ctx, TW, TH, 14, 3);
  parchmentCache = c;
  return c;
}

const PANEL = { x: 24, y: 24, w: TW - 48, h: TH - 48, r: 22 };

function panelPath(ctx: CanvasRenderingContext2D): void {
  rr(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, PANEL.r);
}

function drawBase(ctx: CanvasRenderingContext2D, mode: Mode): void {
  if (mode === 'color') ctx.drawImage(parchment(), 0, 0);
  else {
    ctx.fillStyle = M_PAPER;
    ctx.fillRect(0, 0, TW, TH);
  }
}

function drawFrame(ctx: CanvasRenderingContext2D, mode: Mode): void {
  const g = gold(ctx, mode);
  ctx.save();
  ctx.strokeStyle = g;
  ctx.lineWidth = 7;
  rr(ctx, PANEL.x + 3, PANEL.y + 3, PANEL.w - 6, PANEL.h - 6, PANEL.r - 2);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  rr(ctx, PANEL.x + 15, PANEL.y + 15, PANEL.w - 30, PANEL.h - 30, PANEL.r - 10);
  ctx.stroke();
  // Eckornamente
  ctx.fillStyle = g;
  const corners = [
    [PANEL.x + 15, PANEL.y + 15],
    [PANEL.x + PANEL.w - 15, PANEL.y + 15],
    [PANEL.x + 15, PANEL.y + PANEL.h - 15],
    [PANEL.x + PANEL.w - 15, PANEL.y + PANEL.h - 15],
  ];
  for (const [x, y] of corners) {
    ctx.beginPath();
    ctx.moveTo(x, y - 9);
    ctx.lineTo(x + 9, y);
    ctx.lineTo(x, y + 9);
    ctx.lineTo(x - 9, y);
    ctx.closePath();
    ctx.fill();
  }
  // Mittelmarken oben/unten
  for (const y of [PANEL.y + 15, PANEL.y + PANEL.h - 15]) {
    starPath(ctx, TW / 2, y, 11, 4.5, 4, 0);
    ctx.fill();
  }
  ctx.restore();
}

function lattice(ctx: CanvasRenderingContext2D, color: string, step: number, alpha: number): void {
  ctx.save();
  panelPath(ctx);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let d = -TH; d < TW + TH; d += step) {
    ctx.moveTo(d, 0);
    ctx.lineTo(d + TH, TH);
    ctx.moveTo(d, 0);
    ctx.lineTo(d - TH, TH);
  }
  ctx.stroke();
  ctx.restore();
}

function panelShading(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  panelPath(ctx);
  ctx.clip();
  const vg = ctx.createRadialGradient(TW / 2, TH * 0.45, TH * 0.1, TW / 2, TH / 2, TH * 0.62);
  vg.addColorStop(0, 'rgba(255,255,255,0.10)');
  vg.addColorStop(0.6, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, TW, TH);
  ctx.globalAlpha = 0.18;
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(parchment(), 0, 0);
  ctx.restore();
}

function drawIndex(ctx: CanvasRenderingContext2D, text: string, fill: string | CanvasGradient | 'gold', stroke: string, mode: Mode): void {
  for (const flip of [false, true]) {
    ctx.save();
    if (flip) {
      ctx.translate(TW, TH);
      ctx.rotate(Math.PI);
    }
    ctx.font = '900 104px "Cinzel", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const w = ctx.measureText(text).width;
    const sx = Math.min(1, 98 / w);
    ctx.translate(84, 150);
    ctx.scale(sx, 1);
    if (mode === 'color') {
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 11;
      ctx.strokeText(text, 0, 0);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = fill === 'gold' ? (mode === 'mask' ? M_GOLD : goldGradient(ctx, -45, -90, 40, 8)) : fill;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

function drawRibbon(ctx: CanvasRenderingContext2D, text: string, color: string, mode: Mode, y = TH - 168): void {
  const w = 268;
  const h = 50;
  const x = (TW - w) / 2;
  ctx.save();
  if (mode === 'color') {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    // umgeschlagene Enden
    ctx.fillStyle = shade('#e9d9b0', -0.25);
    for (const dir of [-1, 1]) {
      const ex = dir < 0 ? x - 26 : x + w + 26;
      ctx.beginPath();
      ctx.moveTo(dir < 0 ? x + 8 : x + w - 8, y + 10);
      ctx.lineTo(ex, y + 10);
      ctx.lineTo(ex + dir * -14, y + 10 + h / 2);
      ctx.lineTo(ex, y + 10 + h);
      ctx.lineTo(dir < 0 ? x + 8 : x + w - 8, y + 10 + h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#efe0b8';
    rr(ctx, x, y, w, h, 6);
    ctx.fill();
    ctx.shadowColor = 'transparent';
  }
  ctx.strokeStyle = gold(ctx, mode, x, y, x + w, y + h);
  ctx.lineWidth = 3;
  rr(ctx, x + 4, y + 4, w - 8, h - 8, 4);
  ctx.stroke();
  if (mode === 'color') {
    ctx.fillStyle = color;
    ctx.font = '700 29px "Cinzel", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '3px';
    ctx.fillText(text.toUpperCase(), TW / 2, y + h / 2 + 2);
  }
  ctx.restore();
}

function medallion(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, light: string, mid: string, mode: Mode): void {
  ctx.save();
  if (mode === 'color') {
    const rg = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
    rg.addColorStop(0, light);
    rg.addColorStop(0.7, mid);
    rg.addColorStop(1, shade(mid, -0.35));
    ctx.fillStyle = rg;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
  }
  const g = gold(ctx, mode, cx - r, cy - r, cx + r, cy + r);
  ctx.strokeStyle = g;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 15, 0, Math.PI * 2);
  ctx.stroke();
  // Perlen auf dem Ring
  ctx.fillStyle = g;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * (r + 13), cy + Math.sin(a) * (r + 13), 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ───────────────────────── Kartenlayouts ─────────────────────────

const MED = { x: TW / 2, y: TH * 0.47, r: 138 };

function drawNumberCard(ctx: CanvasRenderingContext2D, id: CardId, mode: Mode): void {
  const s = suitOf(id)!;
  const info = SUIT_INFO[s];
  drawBase(ctx, mode);
  panelPath(ctx);
  if (mode === 'color') {
    const g = ctx.createLinearGradient(0, PANEL.y, 0, PANEL.y + PANEL.h);
    g.addColorStop(0, shade(info.color, 0.12));
    g.addColorStop(0.55, info.color);
    g.addColorStop(1, info.dark);
    ctx.fillStyle = g;
    ctx.fill();
    lattice(ctx, '#ffffff', 34, 0.07);
    panelShading(ctx);
  } else {
    ctx.fillStyle = M_PANEL;
    ctx.fill();
  }
  drawFrame(ctx, mode);
  medallion(ctx, MED.x, MED.y, MED.r, info.light, info.color, mode);
  if (mode === 'color') {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    drawEmblem(ctx, s, MED.x, MED.y + 4, 92, { fill: '#fbf2da', stroke: info.dark, detail: shade(info.color, -0.1), line: 6 });
    ctx.restore();
    const v = String(valueOf(id));
    drawIndex(ctx, v, '#fdf6e3', info.dark, mode);
    // kleines Emblem unter der Zahl (oben links & unten rechts)
    for (const flip of [false, true]) {
      ctx.save();
      if (flip) {
        ctx.translate(TW, TH);
        ctx.rotate(Math.PI);
      }
      drawEmblem(ctx, s, 84, 196, 26, { fill: '#fdf6e3', stroke: info.dark, detail: info.color, line: 3.5 });
      ctx.restore();
    }
  }
  drawRibbon(ctx, info.people, info.dark, mode);
}

const STAR_SEED = 4242;

function nightSky(ctx: CanvasRenderingContext2D, emissive: boolean): void {
  ctx.save();
  panelPath(ctx);
  ctx.clip();
  if (!emissive) {
    const g = ctx.createLinearGradient(0, PANEL.y, 0, PANEL.y + PANEL.h);
    g.addColorStop(0, '#24185e');
    g.addColorStop(0.5, '#140f3c');
    g.addColorStop(1, '#07061a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TW, TH);
    for (const [x, y, r, col] of [
      [TW * 0.3, TH * 0.35, 260, 'rgba(120,70,220,0.35)'],
      [TW * 0.75, TH * 0.65, 220, 'rgba(40,120,220,0.25)'],
    ] as const) {
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, col);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, TW, TH);
    }
  }
  const rnd = seeded(STAR_SEED);
  for (let i = 0; i < 140; i++) {
    const x = PANEL.x + rnd() * PANEL.w;
    const y = PANEL.y + rnd() * PANEL.h;
    const r = rnd() < 0.9 ? 0.6 + rnd() * 1.3 : 2 + rnd() * 1.5;
    const a = 0.4 + rnd() * 0.6;
    ctx.fillStyle = emissive ? `rgba(255,240,210,${a})` : `rgba(255,248,230,${a})`;
    if (r > 2) {
      starPath(ctx, x, y, r * 2.4, r * 0.5, 4, 0);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.restore();
}

function moon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | CanvasGradient): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.arc(x + r * 0.42, y - r * 0.2, r * 0.82, 0, Math.PI * 2, true);
  ctx.fillStyle = fill;
  ctx.fill('evenodd');
  ctx.restore();
}

function drawWizardCard(ctx: CanvasRenderingContext2D, id: CardId, mode: Mode): void {
  const variant = (id - 52) as Suit;
  const info = SUIT_INFO[variant];
  drawBase(ctx, mode);
  panelPath(ctx);
  if (mode === 'color') {
    ctx.fillStyle = '#0d0a2a';
    ctx.fill();
    nightSky(ctx, false);
    panelShading(ctx);
  } else {
    ctx.fillStyle = M_PANEL;
    ctx.fill();
  }
  drawFrame(ctx, mode);
  const g = gold(ctx, mode);
  // Magischer Kreis hinter dem Hut
  ctx.save();
  ctx.strokeStyle = g;
  ctx.lineWidth = 3;
  ctx.globalAlpha = mode === 'color' ? 0.85 : 1;
  ctx.beginPath();
  ctx.arc(MED.x, MED.y, MED.r + 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(MED.x, MED.y, MED.r - 8, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    starPath(ctx, MED.x + Math.cos(a) * (MED.r - 1), MED.y + Math.sin(a) * (MED.r - 1), 6, 2.4, 4, a);
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.restore();
  moon(ctx, MED.x + 70, MED.y - 92, 34, g);
  wizardHat(ctx, MED.x - 6, MED.y + 10, 118, info.color, info.dark, mode);
  drawIndex(ctx, 'Z', 'gold', '#0b0820', mode);
  drawRibbon(ctx, 'Zauberer', '#2a1b5e', mode);
}

function drawJesterCard(ctx: CanvasRenderingContext2D, id: CardId, mode: Mode): void {
  const variant = (id - 56) as Suit;
  const info = SUIT_INFO[variant];
  drawBase(ctx, mode);
  panelPath(ctx);
  if (mode === 'color') {
    ctx.fillStyle = '#3b2a4d';
    ctx.fill();
    // Harlekin-Rauten
    ctx.save();
    panelPath(ctx);
    ctx.clip();
    const dw = 64;
    const dh = 92;
    for (let row = -1; row < TH / (dh / 2) + 1; row++) {
      for (let col = -1; col < TW / dw + 1; col++) {
        const x = col * dw + (row % 2 ? dw / 2 : 0);
        const y = row * (dh / 2);
        ctx.beginPath();
        ctx.moveTo(x, y - dh / 2);
        ctx.lineTo(x + dw / 2, y);
        ctx.lineTo(x, y + dh / 2);
        ctx.lineTo(x - dw / 2, y);
        ctx.closePath();
        ctx.fillStyle = Math.abs(row) % 2 ? '#4a2f5c' : '#2b4f5a';
        ctx.fill();
      }
    }
    ctx.restore();
    panelShading(ctx);
  } else {
    ctx.fillStyle = M_PANEL;
    ctx.fill();
  }
  drawFrame(ctx, mode);
  medallion(ctx, MED.x, MED.y, MED.r, '#fff4d6', '#d9c49a', mode);
  jesterHat(ctx, MED.x, MED.y + 4, 104, info.color, shade(info.color, 0.15), mode);
  drawIndex(ctx, 'N', mode === 'color' ? '#fdf6e3' : M_GOLD, '#2a1630', mode);
  drawRibbon(ctx, 'Narr', '#4a2a55', mode);
}

function drawBack(ctx: CanvasRenderingContext2D, mode: Mode): void {
  drawBase(ctx, mode);
  panelPath(ctx);
  if (mode === 'color') {
    const rg = ctx.createRadialGradient(TW / 2, TH / 2, 40, TW / 2, TH / 2, TH * 0.6);
    rg.addColorStop(0, '#2a2f7a');
    rg.addColorStop(0.6, '#161a4d');
    rg.addColorStop(1, '#0a0c2a');
    ctx.fillStyle = rg;
    ctx.fill();
  } else {
    ctx.fillStyle = M_PANEL;
    ctx.fill();
  }
  // Rautengitter in Gold
  ctx.save();
  panelPath(ctx);
  ctx.clip();
  ctx.strokeStyle = mode === 'color' ? 'rgba(226,190,110,0.32)' : 'rgb(0,190,110)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const step = 40;
  for (let d = -TH; d < TW + TH; d += step) {
    ctx.moveTo(d, 0);
    ctx.lineTo(d + TH, TH);
    ctx.moveTo(d, 0);
    ctx.lineTo(d - TH, TH);
  }
  ctx.stroke();
  // kleine Sterne in den Rauten
  ctx.fillStyle = mode === 'color' ? 'rgba(240,210,140,0.55)' : 'rgb(0,170,150)';
  for (let y = 0; y < TH + step; y += step) {
    for (let x = 0; x < TW + step; x += step) {
      starPath(ctx, x + step / 2, y, 3, 1.2, 4, 0);
      ctx.fill();
    }
  }
  ctx.restore();
  if (mode === 'color') panelShading(ctx);
  drawFrame(ctx, mode);
  const cx = TW / 2;
  const cy = TH / 2;
  const g = gold(ctx, mode, cx - 160, cy - 160, cx + 160, cy + 160);
  ctx.save();
  // dunkles Feld unter dem Emblem
  if (mode === 'color') {
    ctx.fillStyle = '#0c0f33';
    ctx.beginPath();
    ctx.arc(cx, cy, 150, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = g;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(cx, cy, 150, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  for (const r of [134, 98]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Runen zwischen den Ringen
  ctx.lineWidth = 2.2;
  const rnd = seeded(99);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * 116, cy + Math.sin(a) * 116);
    ctx.rotate(a + Math.PI / 2);
    ctx.beginPath();
    const k = Math.floor(rnd() * 4);
    ctx.moveTo(0, -8);
    ctx.lineTo(0, 8);
    if (k === 0) {
      ctx.moveTo(0, -8);
      ctx.lineTo(5, -2);
    } else if (k === 1) {
      ctx.moveTo(-5, -4);
      ctx.lineTo(5, 4);
    } else if (k === 2) {
      ctx.moveTo(0, 0);
      ctx.lineTo(5, -6);
      ctx.moveTo(0, 0);
      ctx.lineTo(-5, -6);
    } else {
      ctx.moveTo(0, 2);
      ctx.lineTo(5, 8);
    }
    ctx.stroke();
    ctx.restore();
  }
  // Achtstrahliger Stern
  starPath(ctx, cx, cy, 92, 30, 8, -Math.PI / 2);
  ctx.fillStyle = g;
  ctx.fill();
  if (mode === 'color') {
    ctx.strokeStyle = '#5a3f10';
    ctx.lineWidth = 2;
    ctx.stroke();
    starPath(ctx, cx, cy, 52, 20, 8, -Math.PI / 2 + Math.PI / 8);
    ctx.fillStyle = '#1b2066';
    ctx.fill();
  }
  moon(ctx, cx - 4, cy, 22, g);
  ctx.restore();
  // Sterne in den Ecken
  for (const [x, y] of [
    [cx, PANEL.y + 80],
    [cx, PANEL.y + PANEL.h - 80],
  ]) {
    starPath(ctx, x, y, 22, 8, 4, 0);
    ctx.fillStyle = g;
    ctx.fill();
  }
}

// ───────────────────────── Öffentliche API ─────────────────────────

function render(draw: (ctx: CanvasRenderingContext2D, mode: Mode) => void, mode: Mode, scale = 1): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(Math.round(TW * scale), Math.round(TH * scale));
  ctx.scale(scale, scale);
  draw(ctx, mode);
  return c;
}

export interface CardTextures {
  map: THREE.Texture;
  pbr: THREE.Texture;
  emissive?: THREE.Texture;
}

const maskCache = new Map<string, THREE.Texture>();
function maskFor(key: string, draw: (ctx: CanvasRenderingContext2D, mode: Mode) => void): THREE.Texture {
  let t = maskCache.get(key);
  if (!t) {
    t = toTexture(render(draw, 'mask', 0.5), false);
    maskCache.set(key, t);
  }
  return t;
}

let wizardEmissive: THREE.Texture | null = null;
function wizardGlow(): THREE.Texture {
  if (wizardEmissive) return wizardEmissive;
  const [c, ctx] = makeCanvas(TW / 2, TH / 2);
  ctx.scale(0.5, 0.5);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, TW, TH);
  nightSky(ctx, true);
  moon(ctx, MED.x + 70, MED.y - 92, 34, '#ffe9a8');
  ctx.save();
  ctx.translate(MED.x - 6, MED.y + 10);
  ctx.scale(118, 118);
  for (const [x, y, r] of [
    [-0.08, 0.04, 0.1],
    [0.16, -0.3, 0.065],
    [0.24, 0.18, 0.075],
    [-0.28, 0.3, 0.05],
  ]) {
    starPath(ctx, x, y, r, r * 0.45);
    ctx.fillStyle = '#ffe4a0';
    ctx.fill();
  }
  ctx.restore();
  wizardEmissive = toTexture(c);
  return wizardEmissive;
}

export function cardFaceTextures(id: CardId): CardTextures {
  if (isWizard(id)) {
    const draw = (ctx: CanvasRenderingContext2D, m: Mode) => drawWizardCard(ctx, id, m);
    return { map: toTexture(render(draw, 'color')), pbr: maskFor('wizard', draw), emissive: wizardGlow() };
  }
  if (isJester(id)) {
    const draw = (ctx: CanvasRenderingContext2D, m: Mode) => drawJesterCard(ctx, id, m);
    return { map: toTexture(render(draw, 'color')), pbr: maskFor('jester', draw) };
  }
  const draw = (ctx: CanvasRenderingContext2D, m: Mode) => drawNumberCard(ctx, id, m);
  return { map: toTexture(render(draw, 'color')), pbr: maskFor(`suit${suitOf(id)}`, draw) };
}

export function cardBackTextures(): CardTextures {
  return { map: toTexture(render(drawBack, 'color')), pbr: toTexture(render(drawBack, 'mask', 0.5), false) };
}

/** Kleine Kartenvorschau als Data-URL (für HUD/Scoreboard). */
const previewCache = new Map<CardId, string>();
export function cardPreview(id: CardId): string {
  let url = previewCache.get(id);
  if (!url) {
    const draw = isWizard(id) ? drawWizardCard : isJester(id) ? drawJesterCard : drawNumberCard;
    const [c, ctx] = makeCanvas(TW / 4, TH / 4);
    ctx.scale(0.25, 0.25);
    rr(ctx, 0, 0, TW, TH, 34);
    ctx.clip();
    draw(ctx, id, 'color');
    url = c.toDataURL('image/png');
    previewCache.set(id, url);
  }
  return url;
}

export function emblemIcon(suit: Suit, px = 64): string {
  const [c, ctx] = makeCanvas(px, px);
  const info = SUIT_INFO[suit];
  drawEmblem(ctx, suit, px / 2, px / 2, px * 0.4, { fill: '#fbf2da', stroke: info.dark, detail: info.color, line: px * 0.05 });
  return c.toDataURL('image/png');
}

// ───────────────────────── Tisch & Umgebung ─────────────────────────

export function feltTextures(S = 2048): { map: THREE.Texture; normal: THREE.Texture } {
  const k = S / 1024;
  const [c, ctx] = makeCanvas(S, S);
  const base = ctx.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S * 0.5);
  base.addColorStop(0, '#3a2c6e');
  base.addColorStop(0.7, '#2a1f55');
  base.addColorStop(1, '#170f33');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  const n = noiseCanvas(128, 128, 18, 5, 11, 1.8);
  ctx.globalAlpha = 0.28;
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(n, 0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  // eingeprägter Ring
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 10 * k;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.455, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(214,176,96,0.18)';
  ctx.lineWidth = 2 * k;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.445, 0, Math.PI * 2);
  ctx.stroke();
  grain(ctx, S, S, 16, 5);

  // Normalmap aus feinem Faserrauschen (gekachelt → feine Struktur auch aus der Nähe)
  const N = S >= 2048 ? 1024 : 512;
  const [nc, nctx] = makeCanvas(N, N);
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      h[y * N + x] = hash(x, y, 77) * 0.6 + fbm(x / 6, y / 6, 2, 21) * 0.4;
    }
  }
  const img = nctx.createImageData(N, N);
  const strength = 1.6;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const l = h[y * N + ((x - 1 + N) % N)];
      const r = h[y * N + ((x + 1) % N)];
      const u = h[((y - 1 + N) % N) * N + x];
      const d = h[((y + 1) % N) * N + x];
      const nx = (l - r) * strength;
      const ny = (u - d) * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * N + x) * 4;
      img.data[i] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  nctx.putImageData(img, 0, 0);
  const normal = toTexture(nc, false);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.repeat.set(S >= 2048 ? 7 : 6, S >= 2048 ? 7 : 6);
  return { map: toTexture(c), normal };
}

export function woodTextures(): { map: THREE.Texture; bump: THREE.Texture } {
  const W = 1024;
  const H = 256;
  const [c, ctx] = makeCanvas(W, H);
  const [bc, bctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const bimg = bctx.createImageData(W, H);
  const dark = [58, 28, 14];
  const light = [128, 70, 36];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const warp = fbm(x / 180, y / 40, 3, 5) * 7;
      const t = y / 18 + warp;
      let ring = t - Math.floor(t);
      ring = Math.pow(Math.sin(ring * Math.PI), 0.6);
      const streak = hash(Math.floor(x / 3), y, 9) * 0.25 + fbm(x / 6, y / 1.5, 2, 13) * 0.35;
      const k = Math.min(1, Math.max(0, ring * 0.7 + streak * 0.5));
      const i = (y * W + x) * 4;
      img.data[i] = dark[0] + (light[0] - dark[0]) * k;
      img.data[i + 1] = dark[1] + (light[1] - dark[1]) * k;
      img.data[i + 2] = dark[2] + (light[2] - dark[2]) * k;
      img.data[i + 3] = 255;
      const b = Math.round(k * 255);
      bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = b;
      bimg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  bctx.putImageData(bimg, 0, 0);
  const map = toTexture(c);
  const bump = toTexture(bc, false);
  for (const t of [map, bump]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(6, 1);
  }
  return { map, bump };
}

/** Leuchtender Magiekreis (transparent, für additive Darstellung). */
export function magicCircleTexture(S = 2048): THREE.Texture {
  const [c, ctx] = makeCanvas(S, S);
  // Zeichnung im 1024er-Raster, auf die Zielauflösung skaliert
  const k = S / 1024;
  ctx.scale(k, k);
  ctx.translate(512, 512);
  ctx.strokeStyle = '#ffd98a';
  ctx.fillStyle = '#ffd98a';
  ctx.shadowColor = '#ffb84a';
  ctx.shadowBlur = 12 * k;
  const ring = (r: number, w: number) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  };
  ring(500, 5);
  ring(478, 2);
  ring(400, 3);
  ring(388, 1.5);
  ring(250, 3);
  ring(236, 1.5);
  // Runenband
  const rnd = seeded(1234);
  ctx.lineWidth = 3;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(0, -439);
    ctx.beginPath();
    const strokes = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < strokes; k++) {
      const x1 = (rnd() - 0.5) * 22;
      const y1 = (rnd() - 0.5) * 34;
      const x2 = (rnd() - 0.5) * 22;
      const y2 = (rnd() - 0.5) * 34;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    ctx.restore();
  }
  // Hexagramm
  ctx.lineWidth = 2.5;
  for (const off of [0, Math.PI / 3]) {
    ctx.beginPath();
    for (let i = 0; i <= 3; i++) {
      const a = off + (i / 3) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * 388;
      const y = Math.sin(a) * 388;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 388, Math.sin(a) * 388, 16, 0, Math.PI * 2);
    ctx.stroke();
    starPath(ctx, Math.cos(a) * 318, Math.sin(a) * 318, 14, 5, 4, a);
    ctx.fill();
  }
  // Punkte im Innenring
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 243, Math.sin(a) * 243, i % 3 === 0 ? 4 : 2, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = toTexture(c);
  return t;
}

export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.Texture {
  const S = 128;
  const [c, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.6)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c);
}

/** Weicher, abgerundeter Schein um eine Karte (für den Gewinner eines Stichs). */
export function cardGlowTexture(): THREE.Texture {
  const W = 256;
  const H = Math.round(W * 1.4);
  const [c, ctx] = makeCanvas(W, H);
  ctx.filter = 'blur(18px)';
  ctx.fillStyle = 'rgba(255,255,255,1)';
  rr(ctx, 44, 44, W - 88, H - 88, 20);
  ctx.fill();
  return toTexture(c);
}

export function ringTexture(): THREE.Texture {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.28, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,1)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c);
}

/** Dunkler Hintergrund mit unscharfen, warmen Lichtpunkten (Taverne). */
export function backdropTexture(): THREE.Texture {
  const W = 2048;
  const H = 512;
  const [c, ctx] = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#040309');
  g.addColorStop(0.55, '#0d0816');
  g.addColorStop(1, '#05040a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const rnd = seeded(77);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W;
    const y = H * (0.25 + rnd() * 0.45);
    const r = 8 + rnd() * 40;
    const warm = rnd() < 0.75;
    const a = 0.05 + rnd() * 0.16;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = warm ? `255,170,80` : `140,120,255`;
    rg.addColorStop(0, `rgba(${col},${a})`);
    rg.addColorStop(0.7, `rgba(${col},${a * 0.6})`);
    rg.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Geber-Marker: goldene Münze mit Zaubererhut. */
export function dealerCoinTexture(): THREE.Texture {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const cx = S / 2;
  const g = goldGradient(ctx, 0, 0, S, S);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cx, cx, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6b4a12';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 14, 0, Math.PI * 2);
  ctx.stroke();
  wizardHat(ctx, cx, cx + 6, 70, '#3b2a7a', '#1a1240', 'color');
  return toTexture(c);
}
