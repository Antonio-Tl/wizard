import * as THREE from 'three';

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.4;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
};

interface Job {
  start: number;
  duration: number;
  update: (t: number) => void;
  resolve: () => void;
  owner?: object;
}

/** Minimaler Tween-Manager, läuft im Render-Loop (Zeit in ms). */
export class Tweens {
  private jobs: Job[] = [];
  now = 0;
  speed = 1;

  update(now: number): void {
    this.now = now;
    const done: Job[] = [];
    for (const j of this.jobs) {
      const t = j.duration <= 0 ? 1 : Math.min(1, (now - j.start) / j.duration);
      if (t < 0) continue;
      j.update(t);
      if (t >= 1) done.push(j);
    }
    if (done.length) {
      this.jobs = this.jobs.filter((j) => !done.includes(j));
      for (const j of done) j.resolve();
    }
  }

  run(duration: number, update: (t: number) => void, delay = 0, owner?: object): Promise<void> {
    if (owner) this.cancel(owner);
    return new Promise((resolve) => {
      this.jobs.push({ start: this.now + delay / this.speed, duration: duration / this.speed, update, resolve, owner });
    });
  }

  wait(ms: number): Promise<void> {
    return this.run(ms, () => {});
  }

  /** Bricht laufende Animationen eines Objekts ab (ohne Endzustand anzuwenden). */
  cancel(owner: object): void {
    const kept: Job[] = [];
    for (const j of this.jobs) {
      if (j.owner === owner) j.resolve();
      else kept.push(j);
    }
    this.jobs = kept;
  }

  finishAll(): void {
    const jobs = this.jobs;
    this.jobs = [];
    for (const j of jobs) {
      j.update(1);
      j.resolve();
    }
  }

  get busy(): boolean {
    return this.jobs.length > 0;
  }
}

export interface Transform {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
}

export interface MoveOpts {
  duration?: number;
  delay?: number;
  arc?: number;
  ease?: Ease;
  /** zusätzliche Drehung um die Längsachse während des Flugs (Flip-Wirbel) */
  spin?: number;
}

const tmpQ = new THREE.Quaternion();
const axisY = new THREE.Vector3(0, 1, 0);

export function moveTo(tw: Tweens, obj: THREE.Object3D, to: Transform, opts: MoveOpts = {}): Promise<void> {
  const from: Transform = { pos: obj.position.clone(), quat: obj.quaternion.clone(), scale: obj.scale.x };
  const { duration = 450, delay = 0, arc = 0, ease: e = ease.inOutCubic, spin = 0 } = opts;
  return tw.run(
    duration,
    (t) => {
      const k = e(t);
      obj.position.lerpVectors(from.pos, to.pos, k);
      if (arc) obj.position.y += Math.sin(Math.PI * Math.min(1, Math.max(0, k))) * arc;
      obj.quaternion.slerpQuaternions(from.quat, to.quat, Math.min(1, Math.max(0, k)));
      if (spin) {
        tmpQ.setFromAxisAngle(axisY, Math.sin(Math.PI * k) * spin);
        obj.quaternion.premultiply(tmpQ);
      }
      obj.scale.setScalar(from.scale + (to.scale - from.scale) * k);
    },
    delay,
    obj,
  );
}

export function setTransform(obj: THREE.Object3D, t: Transform): void {
  obj.position.copy(t.pos);
  obj.quaternion.copy(t.quat);
  obj.scale.setScalar(t.scale);
}
