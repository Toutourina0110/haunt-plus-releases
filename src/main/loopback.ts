type Koffi = typeof import('koffi');
type Pointer = unknown;
type Method = (...args: unknown[]) => number;

export const RATE = 48000;
const LOOPBACK = 0x00020000;
const SILENT = 0x2;
const CLSCTX_ALL = 0x17;
const POLL_MS = 10;
const RESCAN_MS = 5000;

function guid(s: string): Buffer {
  const h = s.replace(/-/g, '');
  const b = Buffer.alloc(16);
  b.writeUInt32LE(parseInt(h.slice(0, 8), 16), 0);
  b.writeUInt16LE(parseInt(h.slice(8, 12), 16), 4);
  b.writeUInt16LE(parseInt(h.slice(12, 16), 16), 6);
  for (let i = 0; i < 8; i++) b[8 + i] = parseInt(h.slice(16 + i * 2, 18 + i * 2), 16);
  return b;
}

const CLSID_MMDeviceEnumerator = guid('BCDE0395-E52F-467C-8E3D-C4579291692E');
const IID_IMMDeviceEnumerator = guid('A95664D2-9614-4F35-A746-DE8DB63617E6');
const IID_IAudioClient = guid('1CB9AD4C-DBFA-4C32-B178-C2F568A703B2');
const IID_IAudioCaptureClient = guid('C8ADBD64-E71E-48A0-A4DE-185C395CD317');

interface Api {
  k: Koffi;
  coTaskMemFree: (p: Pointer) => void;
  enumerator: Pointer;
  protos: Record<string, ReturnType<Koffi['proto']>>;
}

interface Device {
  id: string;
  client: Pointer;
  capture: Pointer;
  channels: number;
  rate: number;
  kind: 'float' | 'int16' | 'int32';
  frameBytes: number;
  getBuffer: Method;
  releaseBuffer: Method;
  nextPacket: Method;
}

let api: Api | null | undefined;

function method(a: Api, self: Pointer, n: number, proto: string): Method {
  const vtbl = a.k.decode(self, 'void *');
  const fn = a.k.decode(vtbl, n * 8, 'void *');
  return (...args) => a.k.call(fn, a.protos[proto], self, ...args) as number;
}

function load(): Api | null {
  if (api !== undefined) return api;
  try {
    const k = require('koffi') as Koffi;
    const ole32 = k.load('ole32.dll');
    const coInit = ole32.func('long __stdcall CoInitializeEx(void *res, uint32 flags)');
    const create = ole32.func('long __stdcall CoCreateInstance(const uint8_t *clsid, void *outer, uint32 ctx, const uint8_t *iid, _Out_ void **out)');
    const coTaskMemFree = ole32.func('void __stdcall CoTaskMemFree(void *p)');
    coInit(null, 2);
    const protos = {
      enumEndpoints: k.proto('long __stdcall EnumAudioEndpoints(void *self, int flow, uint32 mask, _Out_ void **out)'),
      getCount: k.proto('long __stdcall GetCount(void *self, _Out_ uint32 *n)'),
      item: k.proto('long __stdcall Item(void *self, uint32 i, _Out_ void **out)'),
      getId: k.proto('long __stdcall GetId(void *self, _Out_ void **id)'),
      activate: k.proto('long __stdcall Activate(void *self, const uint8_t *iid, uint32 ctx, void *params, _Out_ void **out)'),
      getMixFormat: k.proto('long __stdcall GetMixFormat(void *self, _Out_ void **fmt)'),
      initialize: k.proto('long __stdcall Initialize(void *self, int mode, uint32 flags, int64 duration, int64 period, void *fmt, void *session)'),
      getService: k.proto('long __stdcall GetService(void *self, const uint8_t *iid, _Out_ void **out)'),
      start: k.proto('long __stdcall Start(void *self)'),
      stop: k.proto('long __stdcall Stop(void *self)'),
      release: k.proto('uint32 __stdcall Release(void *self)'),
      getBuffer: k.proto('long __stdcall GetBuffer(void *self, _Out_ void **data, _Out_ uint32 *frames, _Out_ uint32 *flags, void *devpos, void *qpc)'),
      releaseBuffer: k.proto('long __stdcall ReleaseBuffer(void *self, uint32 frames)'),
      nextPacket: k.proto('long __stdcall GetNextPacketSize(void *self, _Out_ uint32 *n)'),
    };
    const out: Pointer[] = [null];
    if (create(CLSID_MMDeviceEnumerator, null, CLSCTX_ALL, IID_IMMDeviceEnumerator, out) < 0) throw new Error('no device enumerator');
    api = { k, coTaskMemFree, enumerator: out[0], protos };
  } catch (err) {
    console.warn('System sound cannot be read:', err);
    api = null;
  }
  return api;
}

export class SystemAudio {
  private devices = new Map<string, Device>();
  private timers: NodeJS.Timeout[] = [];
  private ids = new Map<string, number>();

  constructor(private readonly onSound: (dev: number, pcm: Float32Array) => void) {}

  get available(): boolean {
    return !!load();
  }

  start(): void {
    const a = load();
    if (!a || this.timers.length) return;
    this.scan(a);
    this.timers.push(setInterval(() => this.poll(a), POLL_MS), setInterval(() => this.scan(a), RESCAN_MS));
  }

  stop(): void {
    this.timers.forEach((timer) => clearInterval(timer));
    this.timers = [];
    const a = api;
    if (!a) return;
    for (const d of this.devices.values()) this.close(a, d);
    this.devices.clear();
  }

  private scan(a: Api): void {
    try {
      const colOut: Pointer[] = [null];
      if (method(a, a.enumerator, 3, 'enumEndpoints')(0 , 1 , colOut) < 0) return;
      const col = colOut[0];
      const n = [0];
      method(a, col, 3, 'getCount')(n);
      for (let i = 0; i < n[0]; i++) {
        const devOut: Pointer[] = [null];
        if (method(a, col, 4, 'item')(i, devOut) < 0) continue;
        const dev = devOut[0];
        const idOut: Pointer[] = [null];
        method(a, dev, 5, 'getId')(idOut);
        const id = String(a.k.decode(idOut[0], 'char16_t', -1));
        a.coTaskMemFree(idOut[0]);
        if (!this.devices.has(id)) {
          const opened = this.open(a, dev, id);
          if (opened) this.devices.set(id, opened);
        }
        method(a, dev, 2, 'release')();
      }
      method(a, col, 2, 'release')();
    } catch (err) {
      console.warn('Output devices cannot be listed:', err);
    }
  }

  private open(a: Api, dev: Pointer, id: string): Device | null {
    const clientOut: Pointer[] = [null];
    if (method(a, dev, 3, 'activate')(IID_IAudioClient, CLSCTX_ALL, null, clientOut) < 0) return null;
    const client = clientOut[0];
    const fmtOut: Pointer[] = [null];
    if (method(a, client, 8, 'getMixFormat')(fmtOut) < 0) {
      method(a, client, 2, 'release')();
      return null;
    }
    const head = Buffer.from(a.k.decode(fmtOut[0], a.k.array('uint8_t', 40, 'Typed')) as Uint8Array);
    const tag = head.readUInt16LE(0);
    const channels = head.readUInt16LE(2);
    const rate = head.readUInt32LE(4);
    const frameBytes = head.readUInt16LE(12);
    const bits = head.readUInt16LE(14);
    const sub = tag === 0xfffe ? head.readUInt16LE(24) : tag;
    const kind = sub === 3 && bits === 32 ? 'float' : sub === 1 && bits === 16 ? 'int16' : sub === 1 && bits === 32 ? 'int32' : null;
    const hr = kind ? method(a, client, 3, 'initialize')(0, LOOPBACK, 10000000n, 0n, fmtOut[0], null) : -1;
    a.coTaskMemFree(fmtOut[0]);
    const captureOut: Pointer[] = [null];
    if (!kind || hr < 0 || method(a, client, 14, 'getService')(IID_IAudioCaptureClient, captureOut) < 0 || method(a, client, 10, 'start')() < 0) {
      method(a, client, 2, 'release')();
      return null;
    }
    const capture = captureOut[0];
    if (!this.ids.has(id)) this.ids.set(id, this.ids.size);
    return {
      id,
      client,
      capture,
      channels,
      rate,
      kind,
      frameBytes,
      getBuffer: method(a, capture, 3, 'getBuffer'),
      releaseBuffer: method(a, capture, 4, 'releaseBuffer'),
      nextPacket: method(a, capture, 5, 'nextPacket'),
    };
  }

  private close(a: Api, d: Device): void {
    try {
      method(a, d.client, 11, 'stop')();
      method(a, d.capture, 2, 'release')();
      method(a, d.client, 2, 'release')();
    } catch {
    }
  }

  private poll(a: Api): void {
    for (const d of [...this.devices.values()]) {
      try {
        const pieces: Float32Array[] = [];
        const next = [0];
        if (d.nextPacket(next) < 0) throw new Error('gone');
        while (next[0] > 0) {
          const data: Pointer[] = [null];
          const frames = [0];
          const flags = [0];
          if (d.getBuffer(data, frames, flags, null, null) < 0) throw new Error('gone');
          if (frames[0]) pieces.push(toStereo(a, d, data[0], frames[0], (flags[0] & SILENT) !== 0));
          d.releaseBuffer(frames[0]);
          if (d.nextPacket(next) < 0) throw new Error('gone');
        }
        if (!pieces.length) continue;
        const pcm = pieces.length === 1 ? pieces[0] : concat(pieces);
        this.onSound(this.ids.get(d.id) ?? 0, d.rate === RATE ? pcm : resample(pcm, d.rate));
      } catch {
        this.close(a, d);
        this.devices.delete(d.id);
      }
    }
  }
}

function toStereo(a: Api, d: Device, data: Pointer, frames: number, silent: boolean): Float32Array {
  const out = new Float32Array(frames * 2);
  if (silent) return out;
  const ch = d.channels;
  const type = d.kind === 'float' ? 'float' : d.kind === 'int16' ? 'int16_t' : 'int32_t';
  const src = a.k.decode(data, a.k.array(type, frames * ch, 'Typed')) as Float32Array | Int16Array | Int32Array;
  const scale = d.kind === 'float' ? 1 : d.kind === 'int16' ? 1 / 32768 : 1 / 2147483648;
  for (let f = 0; f < frames; f++) {
    const o = f * ch;
    let l = src[o];
    let r = ch > 1 ? src[o + 1] : l;
    if (ch >= 3) {
      l += 0.707 * src[o + 2];
      r += 0.707 * src[o + 2];
    }
    if (ch >= 6) {
      l += 0.5 * src[o + 4];
      r += 0.5 * src[o + 5];
    }
    if (ch >= 8) {
      l += 0.5 * src[o + 6];
      r += 0.5 * src[o + 7];
    }
    out[f * 2] = l * scale;
    out[f * 2 + 1] = r * scale;
  }
  return out;
}

function concat(pieces: Float32Array[]): Float32Array {
  const out = new Float32Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pieces) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function resample(pcm: Float32Array, rate: number): Float32Array {
  const frames = pcm.length / 2;
  const outFrames = Math.max(1, Math.round((frames * RATE) / rate));
  const out = new Float32Array(outFrames * 2);
  for (let i = 0; i < outFrames; i++) {
    const pos = (i * (frames - 1)) / Math.max(1, outFrames - 1);
    const i0 = Math.floor(pos);
    const i1 = Math.min(frames - 1, i0 + 1);
    const t = pos - i0;
    out[i * 2] = pcm[i0 * 2] * (1 - t) + pcm[i1 * 2] * t;
    out[i * 2 + 1] = pcm[i0 * 2 + 1] * (1 - t) + pcm[i1 * 2 + 1] * t;
  }
  return out;
}
