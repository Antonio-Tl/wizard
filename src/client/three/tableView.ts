import * as THREE from 'three';
import { type CardId, SUIT_INFO, isJester, isWizard } from '../../shared/cards';
import { legalCards, trickWinnerIndex } from '../../shared/rules';
import type { GameEvent, View } from '../../shared/types';
import { sfx } from '../audio';
import { CARD_T, CardMesh, faceMaterial, prewarmFaces } from './cards';
import { type Stage, TABLE_R } from './stage';
import { CARD_H, CARD_W, cardGlowTexture, dealerCoinTexture, ringTexture } from './textures';
import { type Transform, ease, moveTo, setTransform } from './tween';

const TRICK_R = 2.4;
/** Karten, die im Menü aufgefächert auf dem Tisch liegen */
const SHOWCASE = [56, 38, 52, 12, 25];
const OPP_HAND_R = 5.25;
const HAND_DIST = 4;

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function jitter(a: number, b: number): number {
  let h = Math.imul(a + 1, 2654435761) ^ Math.imul(b + 7, 1597334677);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

function faceUp(yaw: number): THREE.Quaternion {
  const q = new THREE.Quaternion().setFromAxisAngle(X_AXIS, -Math.PI / 2);
  return new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw).multiply(q);
}

function faceDown(yaw: number): THREE.Quaternion {
  const q = new THREE.Quaternion().setFromAxisAngle(X_AXIS, Math.PI / 2);
  return new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw).multiply(q);
}

export class TableView {
  onPlay: (card: CardId) => void = () => {};

  private stage: Stage;
  private cards: CardMesh[] = [];
  private deck: CardMesh[] = [];
  private hands: CardMesh[][] = [];
  private trick: CardMesh[] = [];
  private piles: CardMesh[][] = [];
  private trump: CardMesh | null = null;
  private showcase: CardMesh[] = [];
  private n = 4;
  private me = 0;
  private round = 0;
  private view: View | null = null;

  private legal = new Set<CardId>();
  private canPlay = false;
  private hovered: CardMesh | null = null;
  private selected: CardMesh | null = null;
  private pending: CardId | null = null;
  private springOff = new Set<CardMesh>();

  private turnRing: THREE.Mesh;
  private dealerCoin: THREE.Mesh;
  private winGlow: THREE.Mesh;
  private trumpGlow: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerInside = false;

  constructor(stage: Stage) {
    this.stage = stage;
    for (let i = 0; i < 60; i++) {
      const m = new CardMesh();
      stage.scene.add(m);
      this.cards.push(m);
    }
    prewarmFaces();

    const ringMat = new THREE.MeshBasicMaterial({
      map: ringTexture(),
      color: 0xffcf6e,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.turnRing = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), ringMat);
    this.turnRing.rotation.x = -Math.PI / 2;
    this.turnRing.renderOrder = 2;
    stage.scene.add(this.turnRing);

    const coinTex = dealerCoinTexture();
    const coinSide = new THREE.MeshStandardMaterial({ color: 0xc8963a, metalness: 1, roughness: 0.3 });
    const coinTop = new THREE.MeshStandardMaterial({ map: coinTex, metalness: 0.85, roughness: 0.32 });
    this.dealerCoin = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.07, 40), [coinSide, coinTop, coinSide]);
    this.dealerCoin.castShadow = true;
    this.dealerCoin.visible = false;
    stage.scene.add(this.dealerCoin);

    const glowMat = new THREE.MeshBasicMaterial({
      map: cardGlowTexture(),
      color: 0xffd36b,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.winGlow = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 2.5, CARD_H * 2.15), glowMat);
    this.winGlow.renderOrder = 3;
    stage.scene.add(this.winGlow);
    this.trumpGlow = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 2.2, CARD_H * 1.9), glowMat.clone());
    this.trumpGlow.renderOrder = 3;
    stage.scene.add(this.trumpGlow);

    this.layoutLobby(false);
    stage.addFrameCallback((dt, now) => this.frame(dt, now));
    this.bindPointer();
  }

  // ───────────────────────── Geometrie der Plätze ─────────────────────────

  private rel(seat: number): number {
    return (seat - this.me + this.n) % this.n;
  }

  seatAngle(seat: number): number {
    const r = this.rel(seat);
    if (r === 0) return 0;
    const n = this.n;
    const step = n <= 4 ? (Math.PI * 2) / n : n === 5 ? THREE.MathUtils.degToRad(52.5) : THREE.MathUtils.degToRad(44);
    return Math.PI + (r - n / 2) * step;
  }

  private dir(seat: number): THREE.Vector3 {
    const a = this.seatAngle(seat);
    return new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
  }

  private tangent(seat: number): THREE.Vector3 {
    const a = this.seatAngle(seat);
    return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  }

  /** Bildschirmposition (Pixel) eines Spielers für HTML-Labels. */
  seatScreen(seat: number): { x: number; y: number } {
    const p = this.dir(seat).multiplyScalar(TABLE_R + 0.35);
    p.y = 0.9;
    p.project(this.stage.camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight };
  }

  pileScreen(seat: number): { x: number; y: number } {
    const p = this.pileBase(seat);
    p.y = 0.3;
    p.project(this.stage.camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight };
  }

  // ───────────────────────── Slots ─────────────────────────

  private deckSlot(i: number): Transform {
    return {
      pos: new THREE.Vector3(jitter(i, 3) * 0.015, 0.004 + i * CARD_T * 1.08, jitter(i, 5) * 0.015),
      quat: faceDown(jitter(i, 9) * 0.04),
      scale: 1,
    };
  }

  private trumpSlot(): Transform {
    const top = 0.004 + this.deck.length * CARD_T * 1.08;
    return { pos: new THREE.Vector3(0.3, top + 0.01, 0.2), quat: faceUp(0.32), scale: 1.15 };
  }

  private trickSlot(seat: number, order: number, card: number): Transform {
    const d = this.dir(seat);
    const t = this.tangent(seat);
    const pos = d
      .clone()
      .multiplyScalar(TRICK_R + jitter(card, this.round) * 0.08)
      .addScaledVector(t, jitter(card, this.round + 50) * 0.12);
    pos.y = 0.03 + order * 0.012;
    let a = this.seatAngle(seat);
    if (a > Math.PI) a -= Math.PI * 2;
    return { pos, quat: faceUp(-a * 0.12 + jitter(card, this.round + 9) * 0.22), scale: 1.3 };
  }

  private pileBase(seat: number): THREE.Vector3 {
    if (this.rel(seat) === 0) return new THREE.Vector3(2.0, 0, 2.95);
    return this.dir(seat).multiplyScalar(3.95).addScaledVector(this.tangent(seat), 0.85);
  }

  private pileSlot(seat: number, idx: number): Transform {
    const trickIdx = Math.floor(idx / this.n);
    const k = idx % this.n;
    const base = this.pileBase(seat);
    const pos = base.addScaledVector(this.tangent(seat), trickIdx * 0.16);
    pos.y = 0.012 + trickIdx * this.n * CARD_T * 0.6 + k * CARD_T * 0.8;
    const yaw = -this.seatAngle(seat) + jitter(idx, seat) * 0.05 + 0.08 * trickIdx * 0.2;
    return { pos, quat: faceDown(yaw), scale: 0.86 };
  }

  private oppHandSlot(seat: number, i: number, count: number): Transform {
    const d = this.dir(seat);
    const t = this.tangent(seat);
    const spacing = Math.min(0.26, 2.4 / Math.max(count, 1));
    const off = (i - (count - 1) / 2) * spacing;
    const pos = d.clone().multiplyScalar(OPP_HAND_R).addScaledVector(t, off);
    pos.y = 0.27 - Math.abs(off) * 0.03;
    // verdeckt, leicht angekippt (Rücken nach oben), damit man die Karten von jedem Platz aus sieht
    const tilt = 0.42;
    const normal = d.clone().multiplyScalar(Math.sin(tilt)).addScaledVector(Y_AXIS, -Math.cos(tilt));
    const up = d.clone().multiplyScalar(-Math.cos(tilt)).addScaledVector(Y_AXIS, -Math.sin(tilt));
    const right = new THREE.Vector3().crossVectors(up, normal);
    const m = new THREE.Matrix4().makeBasis(right, up, normal);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, -off * 0.22));
    // leicht nach vorne versetzt, damit sich die Karten nicht schneiden
    pos.addScaledVector(normal, -i * 0.004);
    return { pos, quat: q, scale: 0.62 };
  }

  /** Handkarten im Kamera-Raum (immer unten am Bildschirm). */
  private handSlot(i: number, count: number, card: CardMesh): Transform {
    const cam = this.stage.camera;
    const halfH = HAND_DIST * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const halfW = halfH * cam.aspect;
    let s = Math.min((2 * halfH * 0.245) / CARD_H, (2 * halfW * 0.19) / CARD_W);
    if (cam.aspect < 0.8) s = Math.min((2 * halfH * 0.17) / CARD_H, (2 * halfW * 0.25) / CARD_W);
    const cw = CARD_W * s;
    const ch = CARD_H * s;
    const avail = 2 * halfW * 0.94 - cw;
    let rows = 1;
    let perRow = count;
    let spacing = count > 1 ? Math.min(cw * 0.66, avail / (count - 1)) : 0;
    if (count > 8 && spacing < cw * 0.3) {
      rows = 2;
      perRow = Math.ceil(count / 2);
      spacing = Math.min(cw * 0.66, avail / Math.max(perRow - 1, 1));
    }
    const row = rows === 2 && i >= perRow ? 1 : 0;
    const inRow = row === 1 ? count - perRow : perRow;
    const j = row === 1 ? i - perRow : i;
    const x = (j - (inRow - 1) / 2) * spacing;
    const nx = x / halfW;
    let y = -halfH + ch * 0.54 + 0.02 - nx * nx * ch * 0.1;
    if (rows === 2) y += row === 0 ? ch * 0.36 : -ch * 0.12;
    let z = -HAND_DIST + i * 0.006 + row * 0.05;
    const hover = card.hover;
    y += hover * ch * 0.2;
    z += hover * 0.08;
    if (card.dim) y -= ch * 0.06;
    if (this.pending !== null && card.cardId === this.pending) y += ch * 0.3;
    const q = new THREE.Quaternion()
      .setFromAxisAngle(Z_AXIS, -nx * 0.14)
      .multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, -0.1));
    return { pos: new THREE.Vector3(x, y, z), quat: q, scale: s * (1 + hover * 0.06) };
  }

  /** Höhe der eigenen Hand vom unteren Bildschirmrand (px), damit Panels darüber Platz finden. */
  handHeightPx(count: number): number {
    if (count === 0) return window.innerHeight * 0.06;
    const cam = this.stage.camera;
    const halfH = HAND_DIST * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const dummy = { hover: 0, dim: false, cardId: null } as unknown as CardMesh;
    let top = -halfH;
    for (let i = 0; i < count; i++) {
      const t = this.handSlot(i, count, dummy);
      top = Math.max(top, t.pos.y + (CARD_H * t.scale) / 2);
    }
    return ((top / halfH) * 0.5 + 0.5) * window.innerHeight;
  }

  private coinSlot(seat: number): Transform {
    let pos: THREE.Vector3;
    if (this.rel(seat) === 0) pos = new THREE.Vector3(-2.3, 0, 3.15);
    else pos = this.dir(seat).multiplyScalar(4.55).addScaledVector(this.tangent(seat), -1.35);
    pos.y = 0.04;
    return { pos, quat: new THREE.Quaternion().setFromAxisAngle(Y_AXIS, -this.seatAngle(seat)), scale: 1 };
  }

  private ringPos(seat: number): THREE.Vector3 {
    if (this.rel(seat) === 0) return new THREE.Vector3(0, 0.02, 4.6);
    const p = this.dir(seat).multiplyScalar(OPP_HAND_R - 0.1);
    p.y = 0.02;
    return p;
  }

  // ───────────────────────── Aufbau ohne Animation ─────────────────────────

  private resetMesh(m: CardMesh): void {
    this.stage.tweens.cancel(m);
    m.userData.bob = null;
    if (m.parent !== this.stage.scene) this.stage.scene.attach(m);
    m.hover = 0;
    m.dim = false;
    m.castShadow = true;
    this.restoreFace(m);
  }

  private restoreFace(m: CardMesh): void {
    const f = m.face;
    if (f) {
      f.color.setScalar(1);
      f.emissiveIntensity = f.userData.baseEmissive ?? 0;
    }
  }

  layoutLobby(animate: boolean): void {
    this.hands = [];
    this.trick = [];
    this.piles = [];
    this.trump = null;
    this.deck = this.cards.slice();
    // Schaukarten im Menü: ein aufgefächertes Blatt vor dem Stapel
    const showcase = this.deck.splice(this.deck.length - SHOWCASE.length, SHOWCASE.length);
    this.deck.forEach((m, i) => {
      this.resetMesh(m);
      m.setCard(null);
      const t = this.deckSlot(i);
      if (animate) void moveTo(this.stage.tweens, m, t, { duration: 600, delay: i * 6, arc: 0.6 });
      else setTransform(m, t);
    });
    // Titelbild: Fächer schwebt über dem Tisch, zur Kamera gedreht, und wippt leicht
    this.showcase = showcase;
    showcase.forEach((m, i) => {
      this.resetMesh(m);
      m.setCard(SHOWCASE[i]);
      const f = m.face;
      if (f) f.emissiveIntensity = Math.max(f.userData.baseEmissive ?? 0, 0.05);
      const t = this.showcaseSlot(i);
      m.userData.bob = null;
      const done = () => {
        if (this.showcase.includes(m)) m.userData.bob = t.pos.y;
      };
      if (animate) void moveTo(this.stage.tweens, m, t, { duration: 900, delay: 250 + i * 110, arc: 1.2 }).then(done);
      else {
        setTransform(m, t);
        done();
      }
    });

    this.dealerCoin.visible = false;
    this.setRing(null);
    this.setTrumpGlow(null);
  }

  private showcaseSlot(i: number): Transform {
    const k = i - (SHOWCASE.length - 1) / 2;
    const pos = new THREE.Vector3(k * 0.86, 1.75 - k * k * 0.07, 1.1 - k * k * 0.1 + i * 0.03);
    const quat = new THREE.Quaternion()
      .setFromAxisAngle(Y_AXIS, -k * 0.09)
      .multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, -0.42))
      .multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, -k * 0.11));
    return { pos, quat, scale: 1.45 };
  }

  rebuild(view: View): void {
    this.view = view;
    this.n = Math.max(1, view.players.length);
    this.me = Math.max(0, view.you);
    this.round = view.round;
    this.pending = null;
    this.selected = null;
    if (view.phase === 'lobby') {
      this.layoutLobby(false);
      return;
    }
    this.showcase = [];
    const pool = this.cards.slice();
    for (const m of pool) {
      this.resetMesh(m);
      m.setCard(null);
    }
    this.hands = view.players.map(() => []);
    this.piles = view.players.map(() => []);
    this.hands[this.me] = view.hand.map((id) => {
      const m = pool.pop()!;
      m.setCard(id);
      return m;
    });
    view.players.forEach((p, s) => {
      if (s !== this.me) for (let i = 0; i < p.handCount; i++) this.hands[s].push(pool.pop()!);
      for (let i = 0; i < p.tricks * this.n; i++) this.piles[s].push(pool.pop()!);
    });
    this.trick = view.trick.map((t) => {
      const m = pool.pop()!;
      m.setCard(t.card);
      return m;
    });
    this.trump = null;
    if (view.trumpCard !== null) {
      this.trump = pool.pop()!;
      this.trump.setCard(view.trumpCard);
    }
    this.deck = pool;
    this.deck.forEach((m, i) => setTransform(m, this.deckSlot(i)));
    if (this.trump) setTransform(this.trump, this.trumpSlot());
    view.trick.forEach((t, i) => setTransform(this.trick[i], this.trickSlot(t.seat, i, t.card)));
    this.piles.forEach((pile, s) => pile.forEach((m, i) => setTransform(m, this.pileSlot(s, i))));
    this.hands.forEach((hand, s) => {
      if (s === this.me) return;
      hand.forEach((m, i) => setTransform(m, this.oppHandSlot(s, i, hand.length)));
    });
    for (const m of this.hands[this.me]) {
      this.stage.handRoot.add(m);
      m.castShadow = false;
    }
    this.layoutMyHand(true);
    this.applyView(view);
  }

  // ───────────────────────── Zustand anwenden ─────────────────────────

  applyView(view: View): void {
    this.view = view;
    this.round = view.round;
    const myTurn = view.turn === view.you && view.phase === 'playing';
    this.canPlay = myTurn;
    this.legal = new Set(myTurn ? legalCards(view.hand, view.trick) : view.hand);
    if (!myTurn) this.pending = null;
    if (this.pending !== null && !view.hand.includes(this.pending)) this.pending = null;

    // Reihenfolge der eigenen Hand an den Server angleichen (z. B. nach Trumpfwahl)
    const mine = this.hands[this.me] ?? [];
    if (mine.length === view.hand.length) {
      const byId = new Map(mine.map((m) => [m.cardId, m]));
      if (view.hand.every((id) => byId.has(id))) this.hands[this.me] = view.hand.map((id) => byId.get(id)!);
    }
    for (const m of this.hands[this.me] ?? []) {
      const f = m.face;
      m.dim = myTurn && !this.legal.has(m.cardId!);
      if (f) {
        f.color.setScalar(m.dim ? 0.45 : 1);
        f.emissiveIntensity = Math.max(f.userData.baseEmissive ?? 0, m.dim ? 0.02 : 0.14);
      }
    }
    if (!this.consistent(view)) {
      this.rebuild(view);
      return;
    }
    // Zug-Anzeige
    const active = view.phase === 'bidding' || view.phase === 'playing' || view.phase === 'trump';
    this.setRing(active && view.turn !== view.you ? view.turn : null);
    // Geber-Münze
    if (view.dealer >= 0 && view.phase !== 'lobby') {
      const t = this.coinSlot(view.dealer);
      if (!this.dealerCoin.visible) {
        this.dealerCoin.visible = true;
        setTransform(this.dealerCoin, t);
      } else if (this.dealerCoin.position.distanceTo(t.pos) > 0.01) {
        void moveTo(this.stage.tweens, this.dealerCoin, t, { duration: 700, arc: 0.8 });
      }
    } else this.dealerCoin.visible = false;
    // Trumpf-Leuchten, wenn ein Zauberer aufgedeckt und eine Farbe gewählt wurde
    this.setTrumpGlow(view.trumpCard !== null && isWizard(view.trumpCard) && view.trumpSuit !== null ? SUIT_INFO[view.trumpSuit].color : null);
  }

  private consistent(view: View): boolean {
    if (view.phase === 'lobby') return this.hands.length === 0 && this.trump === null;
    if (this.hands.length !== view.players.length || view.you !== this.me) return false;
    const mine = this.hands[this.me];
    if (mine.length !== view.hand.length || !view.hand.every((id, i) => mine[i].cardId === id)) return false;
    for (let s = 0; s < view.players.length; s++) {
      if (s !== this.me && this.hands[s].length !== view.players[s].handCount) return false;
      if (this.piles[s].length !== view.players[s].tricks * this.n) return false;
    }
    if (this.trick.length !== view.trick.length || !view.trick.every((t, i) => this.trick[i].cardId === t.card)) return false;
    if ((this.trump?.cardId ?? null) !== view.trumpCard) return false;
    return true;
  }

  private setRing(seat: number | null): void {
    const mat = this.turnRing.material as THREE.MeshBasicMaterial;
    if (seat === null) {
      this.turnRing.userData.target = 0;
      return;
    }
    this.turnRing.userData.target = 1;
    const p = this.ringPos(seat);
    if (mat.opacity < 0.05) this.turnRing.position.copy(p);
    else if (this.turnRing.position.distanceTo(p) > 0.01) {
      const from = this.turnRing.position.clone();
      void this.stage.tweens.run(450, (t) => this.turnRing.position.lerpVectors(from, p, ease.inOutCubic(t)), 0, this.turnRing);
    }
  }

  private setTrumpGlow(color: string | null): void {
    const mat = this.trumpGlow.material as THREE.MeshBasicMaterial;
    if (!color || !this.trump) {
      this.trumpGlow.userData.target = 0;
      return;
    }
    mat.color.set(color);
    this.trumpGlow.userData.target = 0.9;
  }

  // ───────────────────────── Ereignisse animieren ─────────────────────────

  async animate(ev: GameEvent, view: View): Promise<void> {
    const tw = this.stage.tweens;
    switch (ev.e) {
      case 'roundStart':
        this.n = view.players.length;
        this.me = view.you;
        this.round = ev.round;
        await this.collectAll();
        await this.deal(view, ev.handSize);
        return;
      case 'trump': {
        if (ev.card === null) return;
        const m = this.deck.pop();
        if (!m) return;
        m.setCard(ev.card);
        this.trump = m;
        this.restoreFace(m);
        sfx.flip();
        await moveTo(tw, m, this.trumpSlot(), { duration: 650, arc: 0.9, ease: ease.inOutCubic });
        if (isWizard(ev.card)) this.magicBurst(m.position, ['#b69cff', '#ffd27a', '#7fd4ff'], 90);
        else if (isJester(ev.card)) this.magicBurst(m.position, ['#ffffff', '#c9b6a0'], 30);
        else this.magicBurst(m.position, [SUIT_INFO[Math.floor(ev.card / 13)].color, '#ffe3a0'], 40);
        return;
      }
      case 'trumpChosen': {
        if (this.trump) {
          this.magicBurst(this.trump.position, [SUIT_INFO[ev.suit].color, SUIT_INFO[ev.suit].light, '#fff2c0'], 120);
        }
        this.stage.pulseMagic(1);
        sfx.magic();
        await tw.wait(500);
        return;
      }
      case 'bid':
        sfx.bid();
        await tw.wait(260);
        return;
      case 'play':
        await this.animatePlay(ev.seat, ev.card);
        return;
      case 'trickWon':
        await this.animateTrickWon(ev.seat);
        return;
      case 'roundEnd': {
        ev.record.results.forEach((r, s) => {
          if (r.bid === r.tricks) {
            const p = this.pileBase(s);
            p.y = 0.5;
            this.stage.particles.emit(p, 50, { colors: ['#ffe08a', '#fff6d0', '#9cff9c'], speed: 2.2, up: 2.5, life: 1.4, size: 0.14 });
          }
        });
        await tw.wait(300);
        return;
      }
      case 'gameEnd':
        void this.fireworks(view);
        return;
      default:
        return;
    }
  }

  private async collectAll(): Promise<void> {
    const tw = this.stage.tweens;
    const all = this.cards.slice();
    const anyAway = all.some((m) => m.parent !== this.stage.scene || this.deck.indexOf(m) < 0);
    this.hands = [];
    this.trick = [];
    this.piles = [];
    this.trump = null;
    this.showcase = [];
    this.pending = null;
    this.hovered = null;
    this.selected = null;
    // Karten nach Höhe sortiert einsammeln, damit der Stapel natürlich wirkt
    const order = all.slice().sort((a, b) => a.getWorldPosition(new THREE.Vector3()).y - b.getWorldPosition(new THREE.Vector3()).y);
    this.deck = order;
    const jobs: Promise<void>[] = [];
    order.forEach((m, i) => {
      this.resetMesh(m);
      const t = this.deckSlot(i);
      if (m.position.distanceTo(t.pos) < 0.02) {
        m.setCard(null);
        return;
      }
      jobs.push(
        moveTo(tw, m, t, { duration: 520, delay: anyAway ? i * 5 : 0, arc: 0.7 }).then(() => {
          m.setCard(null);
        }),
      );
    });
    if (jobs.length) {
      sfx.shuffle();
      await Promise.all(jobs);
    }
    // Mischen: zwei Hälften auseinander und wieder zusammen
    const half = Math.floor(this.deck.length / 2);
    const riffle = this.deck.map((m, i) => {
      const t = this.deckSlot(i);
      const side = i < half ? -1 : 1;
      const out: Transform = { pos: t.pos.clone().add(new THREE.Vector3(side * 0.75, 0.05, 0)), quat: faceDown(side * 0.15), scale: 1 };
      return moveTo(tw, m, out, { duration: 170, delay: (i % half) * 1.5 }).then(() => moveTo(tw, m, t, { duration: 210 }));
    });
    sfx.shuffle();
    await Promise.all(riffle);
  }

  private async deal(view: View, handSize: number): Promise<void> {
    const tw = this.stage.tweens;
    const n = view.players.length;
    this.hands = view.players.map(() => []);
    this.piles = view.players.map(() => []);
    const dealer = view.dealer;
    const total = n * handSize;
    const interval = Math.max(40, Math.min(140, 2400 / Math.max(total, 1)));
    const jobs: Promise<void>[] = [];
    let k = 0;
    let myIdx = 0;
    for (let r = 0; r < handSize; r++) {
      for (let j = 0; j < n; j++) {
        const seat = (dealer + 1 + j) % n;
        const m = this.deck.pop();
        if (!m) continue;
        const delay = k * interval;
        k++;
        if (seat === this.me) {
          const id = view.hand[myIdx++];
          this.hands[seat].push(m);
          m.setCard(id ?? null);
          m.castShadow = false;
          const slotIdx = this.hands[seat].length - 1;
          this.springOff.add(m);
          jobs.push(
            tw.wait(delay).then(() => {
              this.stage.handRoot.attach(m);
              const f = m.face;
              if (f) f.emissiveIntensity = Math.max(f.userData.baseEmissive ?? 0, 0.14);
              sfx.deal();
              return moveTo(tw, m, this.handSlot(slotIdx, handSize, m), { duration: 430, ease: ease.outCubic }).then(() => {
                this.springOff.delete(m);
              });
            }),
          );
        } else {
          const i = this.hands[seat].length;
          this.hands[seat].push(m);
          jobs.push(
            tw.wait(delay).then(() => {
              sfx.deal();
              return moveTo(tw, m, this.oppHandSlot(seat, i, handSize), { duration: 430, arc: 0.4, ease: ease.outCubic });
            }),
          );
        }
      }
    }
    await Promise.all(jobs);
  }

  private async animatePlay(seat: number, card: CardId): Promise<void> {
    const tw = this.stage.tweens;
    this.setRing(null);
    const hand = this.hands[seat];
    if (!hand) return;
    let m: CardMesh | undefined;
    if (seat === this.me) {
      m = hand.find((c) => c.cardId === card);
    } else {
      m = hand[Math.floor(hand.length / 2)];
    }
    if (!m) return;
    hand.splice(hand.indexOf(m), 1);
    if (this.hovered === m) this.hovered = null;
    if (this.selected === m) this.selected = null;
    if (this.pending === card) this.pending = null;
    this.springOff.delete(m);
    if (m.parent !== this.stage.scene) this.stage.scene.attach(m);
    m.setCard(card);
    m.hover = 0;
    m.dim = false;
    m.castShadow = true;
    this.restoreFace(m);
    const order = this.trick.length;
    this.trick.push(m);
    const target = this.trickSlot(seat, order, card);
    if (seat !== this.me) {
      // restliche Karten des Gegners nachrücken
      hand.forEach((c, i) => void moveTo(tw, c, this.oppHandSlot(seat, i, hand.length), { duration: 350 }));
    }
    sfx.play();
    await moveTo(tw, m, target, {
      duration: seat === this.me ? 420 : 520,
      arc: seat === this.me ? 0.4 : 0.9,
      ease: ease.inOutCubic,
      spin: seat === this.me ? 0 : 0.3,
    });
    sfx.place();
    if (isWizard(card)) {
      this.magicBurst(m.position, ['#b69cff', '#ffd27a', '#7fd4ff', '#ffffff'], 110);
      this.stage.pulseMagic(0.8);
      sfx.magic();
    } else if (isJester(card)) {
      this.stage.particles.emit(m.position.clone().setY(0.2), 26, { colors: ['#ff8de0', '#8de1ff', '#fff38d'], speed: 1.6, up: 1.4, life: 0.8, size: 0.09 });
    }
  }

  private async animateTrickWon(winner: number): Promise<void> {
    const tw = this.stage.tweens;
    const view = this.view;
    await tw.wait(380);
    // gewinnende Karte bestimmen (gleiche Logik wie der Server)
    const cards = this.trick.map((m) => m.cardId!);
    const wi = trickWinnerIndex(cards, view?.trumpSuit ?? null);
    const wm = this.trick[wi];
    const glowMat = this.winGlow.material as THREE.MeshBasicMaterial;
    if (wm) {
      this.winGlow.position.copy(wm.position).setY(wm.position.y - 0.004);
      this.winGlow.quaternion.copy(wm.quaternion);
      // Gewinnerkarte leicht anheben
      const lifted: Transform = { pos: wm.position.clone().setY(wm.position.y + 0.18), quat: wm.quaternion.clone(), scale: 1.08 };
      void moveTo(tw, wm, lifted, { duration: 260, ease: ease.outBack });
      await tw.run(320, (t) => (glowMat.opacity = t * 0.95));
      this.stage.particles.emit(wm.position.clone(), 30, { colors: ['#ffe39a', '#ffffff'], speed: 1.2, up: 0.8, life: 0.7, size: 0.08 });
      await tw.wait(480);
    }
    void tw.run(260, (t) => (glowMat.opacity = (1 - t) * 0.95));
    const pile = this.piles[winner];
    const trick = this.trick;
    this.trick = [];
    const start = pile.length;
    const jobs = trick.map((m, i) => {
      pile.push(m);
      return moveTo(tw, m, this.pileSlot(winner, start + i), { duration: 520, delay: i * 55, arc: 0.5, ease: ease.inOutCubic });
    });
    sfx.collect(winner === this.me);
    this.stage.pulseMagic(winner === this.me ? 0.7 : 0.3);
    await Promise.all(jobs);
    for (const m of trick) m.setCard(null);
    if (winner === this.me) {
      const p = this.pileBase(winner);
      p.y = 0.25;
      this.stage.particles.emit(p, 60, { colors: ['#ffd36b', '#fff2c4', '#ffb347'], speed: 2.4, up: 2.2, life: 1.1, size: 0.12 });
    }
  }

  private magicBurst(at: THREE.Vector3, colors: string[], count: number): void {
    const p = at.clone();
    p.y += 0.1;
    this.stage.particles.emit(p, count, { colors, speed: 2.6, up: 1.8, life: 1.3, size: 0.13, gravity: -1.2, drag: 1.6, radius: 0.4 });
  }

  private async fireworks(view: View): Promise<void> {
    const tw = this.stage.tweens;
    const palette = [
      ['#ffd36b', '#fff1c1'],
      ['#b69cff', '#e2d6ff'],
      ['#7fd4ff', '#d7f4ff'],
      ['#ff8f8f', '#ffd6d6'],
      ['#8fffb0', '#e0ffe9'],
    ];
    sfx.fanfare();
    for (let i = 0; i < 14; i++) {
      const p = new THREE.Vector3((Math.random() - 0.5) * 7, 3 + Math.random() * 3, (Math.random() - 0.5) * 5 - 0.5);
      const col = palette[i % palette.length];
      this.stage.particles.emit(p, 140, { colors: col, speed: 4.5, up: 0.3, life: 1.8, size: 0.13, gravity: -1.6, drag: 1.1, radius: 0.05 });
      sfx.pop();
      await tw.wait(260 + Math.random() * 260);
      if (this.view !== view && this.view?.phase !== 'gameEnd') break;
    }
  }

  // ───────────────────────── Eigene Hand ─────────────────────────

  private layoutMyHand(instant: boolean): void {
    const hand = this.hands[this.me] ?? [];
    hand.forEach((m, i) => {
      if (this.springOff.has(m)) return;
      const t = this.handSlot(i, hand.length, m);
      if (instant) setTransform(m, t);
    });
  }

  private frame(dt: number, now: number): void {
    this.showcase.forEach((m, i) => {
      const base = m.userData.bob as number | null;
      if (base !== null && base !== undefined) m.position.y = base + Math.sin(now / 900 + i * 0.9) * 0.05;
    });
    // Handkarten weich an ihre Zielposition ziehen
    const hand = this.hands[this.me] ?? [];
    const k = 1 - Math.exp(-dt * 14);
    hand.forEach((m, i) => {
      if (this.springOff.has(m) || m.parent !== this.stage.handRoot) return;
      const target = (this.hovered === m || this.selected === m) && !m.dim ? 1 : 0;
      m.hover += (target - m.hover) * Math.min(1, dt * 16);
      const t = this.handSlot(i, hand.length, m);
      m.position.lerp(t.pos, k);
      m.quaternion.slerp(t.quat, k);
      m.scale.setScalar(m.scale.x + (t.scale - m.scale.x) * k);
    });
    // Zug-Ring pulsieren lassen
    const ringMat = this.turnRing.material as THREE.MeshBasicMaterial;
    const rt = (this.turnRing.userData.target as number) ?? 0;
    const pulse = 0.55 + Math.sin(now / 260) * 0.2;
    ringMat.opacity += (rt * pulse - ringMat.opacity) * Math.min(1, dt * 6);
    this.turnRing.scale.setScalar(1 + Math.sin(now / 260) * 0.04);
    // Trumpf-Leuchten
    const tg = this.trumpGlow.material as THREE.MeshBasicMaterial;
    const tt = (this.trumpGlow.userData.target as number) ?? 0;
    tg.opacity += (tt * (0.75 + Math.sin(now / 400) * 0.25) - tg.opacity) * Math.min(1, dt * 4);
    if (this.trump) {
      this.trumpGlow.position.copy(this.trump.position).setY(this.trump.position.y - 0.003);
      this.trumpGlow.quaternion.copy(this.trump.quaternion);
    }
    if (this.pointerInside) this.updateHover();
  }

  private bindPointer(): void {
    const el = this.stage.renderer.domElement;
    el.addEventListener('pointermove', (e) => {
      this.pointerInside = e.pointerType === 'mouse';
      this.setPointer(e);
    });
    el.addEventListener('pointerleave', () => {
      this.pointerInside = false;
      this.hovered = null;
    });
    el.addEventListener('pointerup', (e) => {
      this.setPointer(e);
      const hit = this.pick();
      if (!hit) {
        this.selected = null;
        return;
      }
      if (e.pointerType === 'mouse' || this.selected === hit) this.tryPlay(hit);
      else {
        this.selected = hit;
        sfx.hover();
      }
    });
  }

  private setPointer(e: PointerEvent): void {
    this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  }

  private pick(): CardMesh | null {
    const hand = this.hands[this.me] ?? [];
    if (!hand.length) return null;
    this.raycaster.setFromCamera(this.pointer, this.stage.camera);
    const hits = this.raycaster.intersectObjects(hand, false);
    return hits.length ? (hits[0].object as CardMesh) : null;
  }

  private updateHover(): void {
    const hit = this.pick();
    if (hit !== this.hovered) {
      this.hovered = hit;
      if (hit && !hit.dim) sfx.hover();
      this.stage.renderer.domElement.style.cursor = hit && this.canPlay && this.legal.has(hit.cardId!) ? 'pointer' : 'default';
    }
  }

  private tryPlay(m: CardMesh): void {
    if (!this.canPlay || this.pending !== null || m.cardId === null) return;
    if (!this.legal.has(m.cardId)) {
      sfx.deny();
      this.onIllegal?.();
      return;
    }
    this.pending = m.cardId;
    this.selected = null;
    this.canPlay = false;
    this.onPlay(m.cardId);
  }

  onIllegal?: () => void;

  /** Wird bei einem Fehler vom Server aufgerufen, damit die Karte wieder spielbar ist. */
  clearPending(): void {
    this.pending = null;
    if (this.view) this.applyView(this.view);
  }

  /** Für die Wiedergabe von Animationen: Material vorwärmen, damit nichts ruckelt. */
  warm(id: CardId): void {
    faceMaterial(id);
  }
}
