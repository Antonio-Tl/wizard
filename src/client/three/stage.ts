import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Dust, Particles } from './particles';
import {
  backdropTexture,
  feltTextures,
  glowTexture,
  magicCircleTexture,
  setAnisotropy,
  woodTextures,
} from './textures';
import { Tweens, ease } from './tween';

export type Quality = 'low' | 'medium' | 'high';

export const TABLE_R = 6.6;

interface Orb {
  group: THREE.Group;
  light: THREE.PointLight;
  sprite: THREE.Sprite;
  radius: number;
  height: number;
  speed: number;
  phase: number;
}

/**
 * Renderer, Szene, Licht, Tisch und Kamera. Spielspezifisches liegt in TableView.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly tweens = new Tweens();
  readonly particles = new Particles();
  readonly handRoot = new THREE.Group();
  readonly table = new THREE.Group();
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private dust: Dust;
  private orbs: Orb[] = [];
  private magic: THREE.Mesh;
  private magicBoost = 0;
  private spot: THREE.SpotLight;
  private quality: Quality;
  private last = performance.now();
  private onFrame: ((dt: number, now: number) => void)[] = [];

  // Kamera-Steuerung
  private camMode: 'orbit' | 'seat' = 'orbit';
  private orbitAngle = 0;
  private camBlend = 1;
  private camFrom = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  readonly camTarget = new THREE.Vector3(0, 0, 0.6);
  private lookTarget = new THREE.Vector3();
  private mouse = new THREE.Vector2();

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality === 'low',
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
    this.camera.position.set(0, 14, 14);
    this.scene.add(this.camera);
    this.camera.add(this.handRoot);
    this.scene.background = new THREE.Color(0x05040a);
    this.scene.fog = new THREE.FogExp2(0x07050d, 0.022);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.32;
    pmrem.dispose();

    // ── Licht ──
    this.scene.add(new THREE.HemisphereLight(0x8a7cff, 0x1a0d08, 0.7));
    const spot = new THREE.SpotLight(0xffe2b8, 170, 40, Math.PI / 4.6, 0.8, 1.6);
    spot.position.set(2.5, 15, -2.5);
    spot.target.position.set(0, 0, 0);
    spot.castShadow = quality !== 'low';
    spot.shadow.mapSize.setScalar(quality === 'high' ? 2048 : 1024);
    spot.shadow.bias = -0.0002;
    spot.shadow.normalBias = 0.02;
    spot.shadow.radius = 4;
    spot.shadow.camera.near = 6;
    spot.shadow.camera.far = 24;
    this.scene.add(spot, spot.target);
    this.spot = spot;
    // weiches Fülllicht von der Kamera aus für die Handkarten
    const fill = new THREE.DirectionalLight(0xfff1dd, 0.55);
    fill.position.set(0, 2, 6);
    this.camera.add(fill);
    fill.target.position.set(0, 0, -5);
    this.camera.add(fill.target);

    this.buildTable();
    this.magic = this.buildMagicCircle();
    this.buildBackdrop();
    this.buildOrbs();
    this.dust = new Dust();
    this.scene.add(this.dust.points);
    this.scene.add(this.particles.points);

    this.setupComposer();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    });
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ───────────────────────── Aufbau ─────────────────────────

  private buildTable(): void {
    const felt = feltTextures();
    const feltMat = new THREE.MeshStandardMaterial({
      map: felt.map,
      normalMap: felt.normal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.94,
      metalness: 0,
      envMapIntensity: 0.4,
    });
    const top = new THREE.Mesh(new THREE.CircleGeometry(TABLE_R, 96), feltMat);
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    this.table.add(top);

    const wood = woodTextures();
    const woodMat = new THREE.MeshPhysicalMaterial({
      map: wood.map,
      bumpMap: wood.bump,
      bumpScale: 0.6,
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.22,
      envMapIntensity: 0.32,
    });
    // Profil der Holzkante (Drehkörper)
    const R = TABLE_R;
    const pts: THREE.Vector2[] = [];
    const profile: [number, number][] = [
      [R - 0.02, -0.02],
      [R - 0.02, 0.05],
      [R + 0.05, 0.16],
      [R + 0.25, 0.25],
      [R + 0.55, 0.24],
      [R + 0.78, 0.15],
      [R + 0.86, 0.0],
      [R + 0.84, -0.18],
      [R + 0.7, -0.32],
      [R + 0.6, -0.36],
    ];
    for (const [x, y] of profile) pts.push(new THREE.Vector2(x, y));
    const rim = new THREE.Mesh(new THREE.LatheGeometry(pts, 160), woodMat);
    rim.castShadow = true;
    rim.receiveShadow = true;
    this.table.add(rim);

    // goldene Einlage zwischen Filz und Holz
    const inlay = new THREE.Mesh(
      new THREE.TorusGeometry(R - 0.02, 0.035, 12, 160),
      new THREE.MeshStandardMaterial({ color: 0xd9ad55, metalness: 1, roughness: 0.28, envMapIntensity: 1.4 }),
    );
    inlay.rotation.x = Math.PI / 2;
    inlay.position.y = 0.035;
    this.table.add(inlay);

    // Zarge unter dem Tisch
    const apron = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.55, R + 0.3, 1.2, 96, 1, true), woodMat);
    apron.position.y = -0.95;
    this.table.add(apron);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.8, 6, 32), woodMat);
    pedestal.position.y = -4.5;
    this.table.add(pedestal);

    // Boden
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64),
      new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -7.5;
    floor.receiveShadow = true;
    this.table.add(floor);
    this.scene.add(this.table);
  }

  private buildMagicCircle(): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      map: magicCircleTexture(),
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: 0xffc977,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 7.2), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.004;
    m.renderOrder = 1;
    this.scene.add(m);
    return m;
  }

  private buildBackdrop(): void {
    const tex = backdropTexture();
    tex.repeat.set(2, 1);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false });
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(55, 55, 40, 64, 1, true), mat);
    cyl.position.y = 4;
    this.scene.add(cyl);
  }

  private buildOrbs(): void {
    const defs: [number, number, number][] = [
      [0xffb15c, 10.4, 0.06],
      [0x8f7bff, 11.2, -0.045],
      [0x5fd4ff, 10.0, 0.035],
    ];
    defs.forEach(([color, radius, speed], i) => {
      const group = new THREE.Group();
      const light = new THREE.PointLight(color, 26, 18, 1.7);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(),
          // HDR-Farbe: nur die Lichter selbst überschreiten die Bloom-Schwelle
          color: new THREE.Color(color).multiplyScalar(1.6),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      sprite.scale.setScalar(0.85);
      const core = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(),
          color: new THREE.Color(1, 1, 1).multiplyScalar(3),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      core.scale.setScalar(0.32);
      group.add(light, sprite, core);
      this.scene.add(group);
      this.orbs.push({ group, light, sprite, radius, height: 3.4 + i * 0.7, speed, phase: (i / defs.length) * Math.PI * 2 });
    });
  }

  private setupComposer(): void {
    if (this.quality === 'low') {
      this.composer = null;
      return;
    }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: this.quality === 'high' ? 4 : 2,
    });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.42, 0.5, 1.0);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.shadowMap.enabled = q !== 'low';
    this.spot.castShadow = q !== 'low';
    this.spot.shadow.mapSize.setScalar(q === 'high' ? 2048 : 1024);
    this.spot.shadow.map?.dispose();
    this.spot.shadow.map = null;
    this.composer?.dispose();
    this.setupComposer();
    this.resize();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
  }

  // ───────────────────────── Kamera ─────────────────────────

  /** Abstand so wählen, dass der Tisch auch im Hochformat gut ins Bild passt. */
  private seatDistance(): number {
    const aspect = this.camera.aspect;
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * aspect;
    // im Hochformat darf die Holzkante seitlich leicht angeschnitten sein
    const fitHalfWidth = aspect < 1 ? 6.1 : 8.4;
    return Math.max(15.2, fitHalfWidth / tanH);
  }

  seatCameraPose(): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const aspect = this.camera.aspect;
    const d = this.seatDistance();
    const elev = aspect < 1 ? 1.12 : aspect < 1.4 ? 0.98 : 0.9;
    const target = new THREE.Vector3(0, 0, aspect < 1 ? 2.2 : 0.85);
    const pos = new THREE.Vector3(0, Math.sin(elev) * d, Math.cos(elev) * d).add(new THREE.Vector3(0, 0, target.z));
    return { pos, target };
  }

  setCameraMode(mode: 'orbit' | 'seat', animate = true): void {
    if (this.camMode === mode) return;
    this.camFrom.pos.copy(this.camera.position);
    this.camFrom.target.copy(this.lookTarget);
    this.camMode = mode;
    this.camBlend = animate ? 0 : 1;
  }

  private updateCamera(dt: number): void {
    let pos: THREE.Vector3;
    let target: THREE.Vector3;
    // Im Menü auf breiten Bildschirmen die Szene nach rechts schieben (Menü links)
    const wantOffset = this.camMode === 'orbit' && this.camera.aspect > 1.25 ? -7.5 : 0;
    if (Math.abs(this.camera.filmOffset - wantOffset) > 0.01) {
      this.camera.filmOffset += (wantOffset - this.camera.filmOffset) * Math.min(1, dt * 2.5);
      this.camera.updateProjectionMatrix();
    }
    if (this.camMode === 'orbit') {
      this.orbitAngle += dt * 0.05;
      const d = 15.5;
      pos = new THREE.Vector3(Math.sin(this.orbitAngle) * d, 10.5, Math.cos(this.orbitAngle) * d);
      target = new THREE.Vector3(0, -0.3, 0);
    } else {
      const p = this.seatCameraPose();
      pos = p.pos;
      target = p.target;
      // leichte Parallaxe mit der Maus
      pos.x += this.mouse.x * 0.25;
      pos.y += -this.mouse.y * 0.12;
    }
    if (this.camBlend < 1) {
      this.camBlend = Math.min(1, this.camBlend + dt / 1.8);
      const k = ease.inOutCubic(this.camBlend);
      pos = this.camFrom.pos.clone().lerp(pos, k);
      target = this.camFrom.target.clone().lerp(target, k);
    }
    this.camera.position.copy(pos);
    this.lookTarget.copy(target);
    this.camera.lookAt(target);
    this.camTarget.copy(target);
  }

  get isSeatView(): boolean {
    return this.camMode === 'seat';
  }

  // ───────────────────────── Effekte ─────────────────────────

  pulseMagic(strength = 1): void {
    this.magicBoost = Math.max(this.magicBoost, strength);
  }

  addFrameCallback(cb: (dt: number, now: number) => void): void {
    this.onFrame.push(cb);
  }

  // ───────────────────────── Loop ─────────────────────────

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const maxDpr = this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 50 : 40;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.particles.setViewportHeight(h * this.renderer.getPixelRatio());
    for (const cb of this.resizeListeners) cb();
  }

  private resizeListeners: (() => void)[] = [];
  onResize(cb: () => void): void {
    this.resizeListeners.push(cb);
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.tweens.update(now);
    this.updateCamera(dt);

    // Magielichter
    const t = now / 1000;
    for (const o of this.orbs) {
      const a = o.phase + t * o.speed * 2;
      o.group.position.set(Math.cos(a) * o.radius, o.height + Math.sin(t * 0.9 + o.phase) * 0.45, Math.sin(a) * o.radius * 0.45 - 4.2);
      const flicker = 1 + Math.sin(t * 7.3 + o.phase * 5) * 0.06 + Math.sin(t * 13.1 + o.phase) * 0.04;
      o.light.intensity = 26 * flicker;
      o.sprite.scale.setScalar(0.85 * flicker);
    }
    // Magiekreis dreht sich langsam, pulsiert bei Ereignissen
    this.magicBoost = Math.max(0, this.magicBoost - dt * 0.9);
    this.magic.rotation.z = t * 0.03;
    (this.magic.material as THREE.MeshBasicMaterial).opacity = 0.1 + Math.sin(t * 1.3) * 0.02 + this.magicBoost * 0.4;

    this.dust.update(now);
    this.particles.update(dt);
    for (const cb of this.onFrame) cb(dt, now);

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
