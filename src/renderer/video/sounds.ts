export const SOUNDS = ['click', 'pop', 'tick', 'ding', 'success', 'error', 'whoosh', 'rise'] as const;
export type SoundName = (typeof SOUNDS)[number];

const RATE = 48000;
const PEAK = 0.125;

function noise(ctx: OfflineAudioContext, seconds: number): AudioBufferSourceNode {
  const buf = ctx.createBuffer(1, Math.ceil(seconds * RATE), RATE);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

function tone(ctx: OfflineAudioContext, type: OscillatorType, freq: number, at: number, length: number, level = 1): void {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(level, at + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(env).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

const MAKERS: Record<SoundName, [number, (ctx: OfflineAudioContext) => void]> = {
  click: [
    0.06,
    (ctx) => {
      const n = noise(ctx, 0.04);
      const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 2400, Q: 1.2 });
      const env = ctx.createGain();
      env.gain.setValueAtTime(1, 0);
      env.gain.exponentialRampToValueAtTime(0.001, 0.03);
      n.connect(band).connect(env).connect(ctx.destination);
      n.start(0);
    },
  ],
  pop: [
    0.12,
    (ctx) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.frequency.setValueAtTime(700, 0);
      osc.frequency.exponentialRampToValueAtTime(180, 0.08);
      env.gain.setValueAtTime(1, 0);
      env.gain.exponentialRampToValueAtTime(0.001, 0.1);
      osc.connect(env).connect(ctx.destination);
      osc.start(0);
      osc.stop(0.12);
    },
  ],
  tick: [0.05, (ctx) => tone(ctx, 'sine', 2600, 0, 0.03)],
  ding: [
    0.9,
    (ctx) => {
      tone(ctx, 'sine', 1318.5, 0, 0.85);
      tone(ctx, 'sine', 2637, 0, 0.4, 0.25);
    },
  ],
  success: [
    0.6,
    (ctx) => {
      tone(ctx, 'triangle', 659.3, 0, 0.25);
      tone(ctx, 'triangle', 987.8, 0.12, 0.45);
    },
  ],
  error: [
    0.45,
    (ctx) => {
      tone(ctx, 'triangle', 220, 0, 0.18);
      tone(ctx, 'triangle', 174.6, 0.16, 0.25);
    },
  ],
  whoosh: [
    0.6,
    (ctx) => {
      const n = noise(ctx, 0.6);
      const band = new BiquadFilterNode(ctx, { type: 'bandpass', Q: 0.8 });
      band.frequency.setValueAtTime(400, 0);
      band.frequency.exponentialRampToValueAtTime(2800, 0.45);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, 0);
      env.gain.exponentialRampToValueAtTime(1, 0.22);
      env.gain.exponentialRampToValueAtTime(0.0001, 0.58);
      n.connect(band).connect(env).connect(ctx.destination);
      n.start(0);
    },
  ],
  rise: [
    1.1,
    (ctx) => {
      const n = noise(ctx, 1.1);
      const band = new BiquadFilterNode(ctx, { type: 'bandpass', Q: 1.5 });
      band.frequency.setValueAtTime(250, 0);
      band.frequency.exponentialRampToValueAtTime(4000, 1);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, 0);
      env.gain.exponentialRampToValueAtTime(1, 0.95);
      env.gain.linearRampToValueAtTime(0, 1.08);
      n.connect(band).connect(env).connect(ctx.destination);
      n.start(0);
    },
  ],
};

export async function makeSound(name: SoundName): Promise<AudioBuffer> {
  const [seconds, make] = MAKERS[name];
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * RATE), RATE);
  make(ctx);
  const buf = await ctx.startRendering();
  const data = buf.getChannelData(0);
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < data.length; i++) data[i] *= PEAK / peak;
  return buf;
}

export function wav(buf: AudioBuffer): Uint8Array {
  const data = buf.getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + data.length * 2));
  const text = (at: number, s: string) => [...s].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  out.setUint32(4, 36 + data.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  text(36, 'data');
  out.setUint32(40, data.length * 2, true);
  data.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Uint8Array(out.buffer);
}
