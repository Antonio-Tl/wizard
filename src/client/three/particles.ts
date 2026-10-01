import * as THREE from 'three';

/**
 * Leichtgewichtiges Partikelsystem (Funken, Magie, Feuerwerk, Staub).
 * Ein einziger Draw-Call, additive Überblendung → wirkt zusammen mit Bloom.
 */
export class Particles {
  readonly points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private drag: Float32Array;
  private gravity: Float32Array;
  private cursor = 0;
  private geo: THREE.BufferGeometry;

  constructor(max = 2500) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float aLife;
        attribute float aSize;
        varying vec3 vColor;
        varying float vLife;
        uniform float uScale;
        void main() {
          vColor = color;
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / -mv.z * (0.35 + 0.65 * aLife);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vLife;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p);
          float a = smoothstep(0.5, 0.0, d);
          a *= a;
          if (vLife <= 0.0) discard;
          gl_FragColor = vec4(vColor * a * min(1.0, vLife * 2.0), 1.0);
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  setViewportHeight(h: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = h * 0.9;
  }

  emit(
    origin: THREE.Vector3,
    count: number,
    opts: {
      colors: THREE.ColorRepresentation[];
      speed?: number;
      spread?: number;
      up?: number;
      life?: number;
      size?: number;
      gravity?: number;
      drag?: number;
      radius?: number;
    },
  ): void {
    const { speed = 2, up = 1.5, life = 1.2, size = 0.12, gravity = -2.5, drag = 1.2, radius = 0.1 } = opts;
    const cols = opts.colors.map((c) => new THREE.Color(c));
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = Math.sqrt(1 - u * u);
      const sp = speed * (0.35 + Math.random() * 0.65);
      this.pos[i * 3] = origin.x + Math.cos(a) * s * radius;
      this.pos[i * 3 + 1] = origin.y + Math.abs(u) * radius;
      this.pos[i * 3 + 2] = origin.z + Math.sin(a) * s * radius;
      this.vel[i * 3] = Math.cos(a) * s * sp;
      this.vel[i * 3 + 1] = Math.abs(u) * sp * 0.6 + up * (0.5 + Math.random() * 0.5);
      this.vel[i * 3 + 2] = Math.sin(a) * s * sp;
      const c = cols[Math.floor(Math.random() * cols.length)];
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      this.maxLife[i] = life * (0.6 + Math.random() * 0.6);
      this.life[i] = this.maxLife[i];
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.gravity[i] = gravity;
      this.drag[i] = drag;
    }
  }

  update(dt: number): void {
    const lifeAttr = this.geo.getAttribute('aLife') as THREE.BufferAttribute;
    const la = lifeAttr.array as Float32Array;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        la[i] = 0;
        continue;
      }
      any = true;
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.gravity[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      la[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    if (any || lifeAttr.version === 0) {
      lifeAttr.needsUpdate = true;
      this.geo.getAttribute('position').needsUpdate = true;
      this.geo.getAttribute('color').needsUpdate = true;
      this.geo.getAttribute('aSize').needsUpdate = true;
    }
  }
}

/** Langsam schwebender Staub im Lichtkegel. */
export class Dust {
  readonly points: THREE.Points;
  private base: Float32Array;
  private phase: Float32Array;

  constructor(count = 260, radius = 9, height = 7) {
    const pos = new Float32Array(count * 3);
    this.base = new Float32Array(count * 3);
    this.phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      this.base[i * 3] = Math.cos(a) * r;
      this.base[i * 3 + 1] = 0.5 + Math.random() * height;
      this.base[i * 3 + 2] = Math.sin(a) * r;
      this.phase[i] = Math.random() * 100;
    }
    pos.set(this.base);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.035,
      color: 0xffe2b0,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  update(time: number): void {
    const attr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const p = attr.array as Float32Array;
    const t = time * 0.00015;
    for (let i = 0; i < this.phase.length; i++) {
      const ph = this.phase[i];
      p[i * 3] = this.base[i * 3] + Math.sin(t + ph) * 0.6;
      p[i * 3 + 1] = this.base[i * 3 + 1] + Math.sin(t * 0.7 + ph * 1.3) * 0.4;
      p[i * 3 + 2] = this.base[i * 3 + 2] + Math.cos(t * 0.8 + ph) * 0.6;
    }
    attr.needsUpdate = true;
  }
}
