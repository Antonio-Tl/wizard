/**
 * Prozedurale Soundeffekte mit der WebAudio-API (keine Audiodateien nötig).
 */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastHover = 0;
  enabled = true;
  volume = 0.7;

  /** Muss nach einer Benutzerinteraktion aufgerufen werden. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private ready(): AudioContext | null {
    if (!this.enabled || !this.ctx || !this.master || document.hidden) return null;
    return this.ctx;
  }

  private noise(dur: number, freq: number, q: number, gain: number, delay = 0, type: BiquadFilterType = 'bandpass', sweep?: number): void {
    const ctx = this.ready();
    if (!ctx || !this.noiseBuf) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, delay = 0, type: OscillatorType = 'sine', glideTo?: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  deal(): void {
    this.noise(0.09, 2600, 0.9, 0.16, 0, 'bandpass', 5200);
  }
  play(): void {
    this.noise(0.16, 1800, 0.8, 0.22, 0, 'bandpass', 4200);
  }
  place(): void {
    this.noise(0.05, 900, 1.2, 0.28, 0, 'lowpass');
  }
  flip(): void {
    this.noise(0.07, 3200, 1.5, 0.14);
    this.noise(0.06, 1400, 1.2, 0.18, 0.08, 'lowpass');
  }
  shuffle(): void {
    for (let i = 0; i < 9; i++) this.noise(0.05, 2000 + Math.random() * 1500, 1, 0.08, i * 0.028);
  }
  hover(): void {
    const now = performance.now();
    if (now - this.lastHover < 45) return;
    this.lastHover = now;
    this.noise(0.035, 4200, 2, 0.035);
  }
  deny(): void {
    this.tone(180, 0.18, 0.12, 0, 'triangle', 120);
  }
  bid(): void {
    this.tone(660, 0.18, 0.08, 0, 'sine');
    this.tone(990, 0.22, 0.05, 0.04, 'sine');
  }
  turn(): void {
    this.tone(784, 0.5, 0.09, 0, 'sine');
    this.tone(1175, 0.6, 0.06, 0.09, 'sine');
    this.tone(1568, 0.7, 0.03, 0.18, 'sine');
  }
  collect(mine: boolean): void {
    this.noise(0.22, 1400, 0.7, 0.18, 0, 'bandpass', 600);
    if (mine) {
      [1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.45, 0.07, 0.12 + i * 0.07, 'triangle'));
    }
  }
  magic(): void {
    for (let i = 0; i < 7; i++) this.tone(1200 + i * 260 + Math.random() * 80, 0.6, 0.035, i * 0.045, 'sine');
    this.noise(0.6, 6000, 0.5, 0.05, 0, 'highpass');
  }
  success(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, 0.08, i * 0.09, 'triangle'));
  }
  fail(): void {
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.4, 0.07, i * 0.12, 'triangle'));
  }
  pop(): void {
    this.noise(0.4, 300, 0.6, 0.25, 0, 'lowpass', 80);
    this.noise(0.6, 5000, 0.4, 0.05, 0.05, 'highpass');
  }
  fanfare(): void {
    const seq: [number, number][] = [
      [523, 0],
      [659, 0.14],
      [784, 0.28],
      [1047, 0.42],
      [784, 0.62],
      [1047, 0.76],
    ];
    for (const [f, d] of seq) {
      this.tone(f, 0.5, 0.08, d, 'triangle');
      this.tone(f * 2, 0.4, 0.025, d, 'sine');
    }
  }
  chat(): void {
    this.tone(1400, 0.12, 0.05, 0, 'sine');
  }
}

export const sfx = new Sfx();
