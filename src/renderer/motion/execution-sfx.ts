import type { Cue } from './execution';

const AHEAD = 0.06;

export class ExecutionSfx {
  private readonly ctx = new AudioContext();
  private readonly master: GainNode;
  private readonly noise: AudioBuffer;
  private next = 0;
  private closed = false;

  constructor(
    private readonly cues: Cue[],
    volume: number,
  ) {
    const ctx = this.ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    this.master = ctx.createGain();
    this.master.gain.value = Math.max(0, Math.min(1, volume)) * 0.9;
    this.master.connect(limiter).connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.cues = [...cues].sort((a, b) => a.at - b.at);
  }

  tick(sec: number): void {
    if (this.closed) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const now = this.ctx.currentTime;
    while (this.next < this.cues.length && this.cues[this.next].at <= sec + AHEAD) {
      const cue = this.cues[this.next++];
      if (cue.at < sec - 0.05) continue;
      this.play(cue, now + Math.max(0, cue.at - sec));
    }
  }

  fade(ms: number): void {
    if (this.closed) return;
    const g = this.master.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + ms / 1000);
    this.closeAfter(ms + 40);
  }

  finish(): void {
    this.closeAfter(1400);
  }

  private closeAfter(ms: number): void {
    this.closed = true;
    window.setTimeout(() => void this.ctx.close().catch(() => {}), ms);
  }

  private play(cue: Cue, at: number): void {
    switch (cue.sound) {
      case 'whoosh':
        return this.whoosh(at);
      case 'tension':
        return this.tension(at, cue.length ?? 2);
      case 'tac':
        return this.tac(at);
      case 'stamp':
        return this.impact(at, 0.7, 0.6);
      case 'fsht':
        return this.fsht(at);
      case 'impact':
        return this.impact(at, 1, 2.2);
      case 'breath':
        return this.breath(at, cue.length ?? 0.6);
      case 'click':
        return this.click(at);
      case 'collapse':
        return this.collapse(at);
      case 'chord':
        return this.chord(at, [55, 82.41, 110, 164.81], 1.6, 0.22, 'sine');
      case 'final':
        return this.chord(at, [523.25, 659.25, 783.99], 0.7, 0.12, 'triangle');
    }
  }

  private source(at: number, length: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(at, Math.random() * 1.5);
    src.stop(at + length + 0.05);
    return src;
  }

  private envelope(at: number, peak: number, attack: number, length: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    g.connect(this.master);
    return g;
  }

  private filter(type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private whoosh(at: number): void {
    const f = this.filter('bandpass', 300, 1.2);
    f.frequency.setValueAtTime(300, at);
    f.frequency.exponentialRampToValueAtTime(2000, at + 0.32);
    this.source(at, 0.4).connect(f).connect(this.envelope(at, 0.55, 0.06, 0.38));
  }

  private tension(at: number, length: number): void {
    const end = at + length;
    const f = this.filter('lowpass', 250, 4);
    f.frequency.setValueAtTime(250, at);
    f.frequency.exponentialRampToValueAtTime(3200, end);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.3, end - 0.02);
    g.gain.linearRampToValueAtTime(0, end);
    g.connect(this.master);
    f.connect(g);
    this.source(at, length).connect(f);
    const saw = this.ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.setValueAtTime(55, at);
    saw.frequency.linearRampToValueAtTime(82, end);
    const sg = this.ctx.createGain();
    sg.gain.value = 0.5;
    saw.connect(sg).connect(f);
    saw.start(at);
    saw.stop(end);
  }

  private tac(at: number): void {
    this.source(at, 0.012).connect(this.filter('highpass', 3200)).connect(this.envelope(at, 0.7, 0.001, 0.012));
  }

  private fsht(at: number): void {
    const f = this.filter('bandpass', 1500, 2);
    f.frequency.setValueAtTime(1500, at);
    f.frequency.exponentialRampToValueAtTime(7500, at + 0.08);
    this.source(at, 0.1).connect(f).connect(this.envelope(at, 0.55, 0.01, 0.1));
  }

  private impact(at: number, level: number, drive: number): void {
    const shaper = this.ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * drive);
    }
    shaper.curve = curve;
    const out = this.envelope(at, level, 0.004, 0.42);
    shaper.connect(out);
    const sine = this.ctx.createOscillator();
    sine.frequency.setValueAtTime(120, at);
    sine.frequency.exponentialRampToValueAtTime(40, at + 0.18);
    sine.connect(shaper);
    sine.start(at);
    sine.stop(at + 0.45);
    const burst = this.ctx.createGain();
    burst.gain.setValueAtTime(0.6, at);
    burst.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    this.source(at, 0.08).connect(this.filter('lowpass', 1400)).connect(burst).connect(shaper);
  }

  private breath(at: number, length: number): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.07, at + length * 0.4);
    g.gain.linearRampToValueAtTime(0, at + length);
    g.connect(this.master);
    this.source(at, length).connect(this.filter('lowpass', 260)).connect(g);
  }

  private click(at: number): void {
    const out = this.envelope(at, 0.3, 0.001, 0.14);
    for (const freq of [2400, 2537]) {
      const o = this.ctx.createOscillator();
      o.frequency.value = freq;
      o.connect(out);
      o.start(at);
      o.stop(at + 0.16);
    }
  }

  private collapse(at: number): void {
    const f = this.filter('lowpass', 2600, 0.8);
    f.frequency.setValueAtTime(2600, at);
    f.frequency.exponentialRampToValueAtTime(110, at + 0.95);
    const grain = this.ctx.createGain();
    const lfo = this.ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 19;
    const depth = this.ctx.createGain();
    depth.gain.value = 0.45;
    lfo.connect(depth).connect(grain.gain);
    grain.gain.value = 0.55;
    lfo.start(at);
    lfo.stop(at + 1.05);
    this.source(at, 1).connect(f).connect(grain).connect(this.envelope(at, 0.5, 0.02, 1.0));
  }

  private chord(at: number, freqs: number[], length: number, level: number, type: OscillatorType): void {
    const out = this.envelope(at, level, 0.05, length);
    for (const freq of freqs) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.connect(out);
      o.start(at);
      o.stop(at + length + 0.05);
    }
  }
}
