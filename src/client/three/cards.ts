import * as THREE from 'three';
import { type CardId } from '../../shared/cards';
import { CARD_H, CARD_R, CARD_W, cardBackTextures, cardFaceTextures } from './textures';

export const CARD_T = 0.0055;

/** Karte mit abgerundeten Ecken: Gruppe 0 = Vorderseite, 1 = Rückseite, 2 = Kante. */
function buildCardGeometry(): THREE.BufferGeometry {
  const hw = CARD_W / 2;
  const hh = CARD_H / 2;
  const r = CARD_R;
  const seg = 8;
  const outline: [number, number][] = [];
  const corners: [number, number, number][] = [
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI],
    [hw - r, -hh + r, (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      outline.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const z = CARD_T / 2;
  const n = outline.length;

  // Vorderseite (Fächer um die Mitte)
  const f0 = 0;
  pos.push(0, 0, z);
  nor.push(0, 0, 1);
  uv.push(0.5, 0.5);
  for (const [x, y] of outline) {
    pos.push(x, y, z);
    nor.push(0, 0, 1);
    uv.push(x / CARD_W + 0.5, y / CARD_H + 0.5);
  }
  const frontStart = idx.length;
  for (let i = 0; i < n; i++) idx.push(f0, f0 + 1 + i, f0 + 1 + ((i + 1) % n));
  const frontCount = idx.length - frontStart;

  // Rückseite (gespiegelte UVs, damit die Textur von hinten richtig erscheint)
  const b0 = pos.length / 3;
  pos.push(0, 0, -z);
  nor.push(0, 0, -1);
  uv.push(0.5, 0.5);
  for (const [x, y] of outline) {
    pos.push(x, y, -z);
    nor.push(0, 0, -1);
    uv.push(0.5 - x / CARD_W, y / CARD_H + 0.5);
  }
  const backStart = idx.length;
  for (let i = 0; i < n; i++) idx.push(b0, b0 + 1 + ((i + 1) % n), b0 + 1 + i);
  const backCount = idx.length - backStart;

  // Kante
  const e0 = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const [x, y] = outline[i];
    const [px, py] = outline[(i - 1 + n) % n];
    const [nx, ny] = outline[(i + 1) % n];
    let tx = nx - px;
    let ty = ny - py;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    pos.push(x, y, z, x, y, -z);
    nor.push(ty, -tx, 0, ty, -tx, 0);
    uv.push(i / n, 1, i / n, 0);
  }
  const edgeStart = idx.length;
  for (let i = 0; i < n; i++) {
    const a = e0 + i * 2;
    const b = e0 + ((i + 1) % n) * 2;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const edgeCount = idx.length - edgeStart;

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.addGroup(frontStart, frontCount, 0);
  g.addGroup(backStart, backCount, 1);
  g.addGroup(edgeStart, edgeCount, 2);
  g.computeBoundingSphere();
  return g;
}

/**
 * Schärfere Mipmap-Auswahl für Kartentexturen: Kleine, schräg liegende Karten auf dem
 * Tisch würden sonst eine zu weiche Stufe bekommen. Ein leicht negativer LOD-Bias
 * hält Zahlen und Schrift lesbar, ohne sichtbares Flimmern.
 */
const CARD_LOD_BIAS = -0.65;
const MAP_SHARP = THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', `texture2D( map, vMapUv, ${CARD_LOD_BIAS.toFixed(2)} )`);
const EMISSIVE_SHARP = THREE.ShaderChunk.emissivemap_fragment.replace(
  'texture2D( emissiveMap, vEmissiveMapUv )',
  `texture2D( emissiveMap, vEmissiveMapUv, ${CARD_LOD_BIAS.toFixed(2)} )`,
);

function sharpen<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', MAP_SHARP)
      .replace('#include <emissivemap_fragment>', EMISSIVE_SHARP);
  };
  m.customProgramCacheKey = () => 'card-sharp';
  return m;
}

let geometry: THREE.BufferGeometry | null = null;
let backMaterial: THREE.MeshStandardMaterial | null = null;
let edgeMaterial: THREE.MeshStandardMaterial | null = null;
const faceMaterials = new Map<CardId, THREE.MeshStandardMaterial>();

function sharedGeometry(): THREE.BufferGeometry {
  return (geometry ??= buildCardGeometry());
}

function sharedBack(): THREE.MeshStandardMaterial {
  if (!backMaterial) {
    const t = cardBackTextures();
    backMaterial = sharpen(new THREE.MeshStandardMaterial({
      map: t.map,
      roughnessMap: t.pbr,
      metalnessMap: t.pbr,
      roughness: 1,
      metalness: 1,
      envMapIntensity: 0.45,
    }));
  }
  return backMaterial;
}

function sharedEdge(): THREE.MeshStandardMaterial {
  return (edgeMaterial ??= new THREE.MeshStandardMaterial({ color: 0xe9dfc6, roughness: 0.75 }));
}

export function faceMaterial(id: CardId): THREE.MeshStandardMaterial {
  let m = faceMaterials.get(id);
  if (!m) {
    const t = cardFaceTextures(id);
    m = sharpen(new THREE.MeshStandardMaterial({
      map: t.map,
      roughnessMap: t.pbr,
      metalnessMap: t.pbr,
      roughness: 1,
      metalness: 1,
      envMapIntensity: 0.45,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: t.emissive ?? t.map,
      emissiveIntensity: 0,
    }));
    m.userData.baseEmissive = t.emissive ? 0.55 : 0;
    m.emissiveIntensity = m.userData.baseEmissive;
    faceMaterials.set(id, m);
  }
  return m;
}

/** Erzeugt Texturen im Leerlauf vorab, damit beim Spielen nichts ruckelt. */
export function prewarmFaces(onDone?: () => void): void {
  const ids = Array.from({ length: 60 }, (_, i) => i);
  const step = (deadline?: IdleDeadline) => {
    const start = performance.now();
    while (ids.length) {
      if (deadline ? deadline.timeRemaining() < 4 : performance.now() - start > 12) break;
      faceMaterial(ids.shift()!);
    }
    if (ids.length) schedule();
    else onDone?.();
  };
  const schedule = () => {
    if ('requestIdleCallback' in window) requestIdleCallback(step, { timeout: 200 });
    else setTimeout(() => step(), 16);
  };
  schedule();
}

export class CardMesh extends THREE.Mesh<THREE.BufferGeometry, THREE.Material[]> {
  cardId: CardId | null = null;
  /** Zielzustand für Hover/Lift in der Hand */
  hover = 0;
  dim = false;

  constructor() {
    super(sharedGeometry(), [sharedBack(), sharedBack(), sharedEdge()]);
    this.castShadow = true;
    this.receiveShadow = true;
  }

  setCard(id: CardId | null): void {
    if (this.cardId === id) return;
    this.cardId = id;
    this.material[0] = id === null ? sharedBack() : faceMaterial(id);
  }

  get face(): THREE.MeshStandardMaterial | null {
    return this.cardId === null ? null : faceMaterial(this.cardId);
  }
}
