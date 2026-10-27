declare const registerProcessor: (name: string, ctor: unknown) => void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

interface Queue {
  pieces: Float32Array[];
  offset: number;
  frames: number;
  primed: boolean;
}

const PRIME = 2400;
const MOST = 14400;

class Feed extends AudioWorkletProcessor {
  private readonly queues = new Map<number, Queue>();

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<{ dev: number; pcm: Float32Array }>) => {
      const { dev, pcm } = event.data;
      let q = this.queues.get(dev);
      if (!q) {
        q = { pieces: [], offset: 0, frames: 0, primed: false };
        this.queues.set(dev, q);
      }
      q.pieces.push(pcm);
      q.frames += pcm.length / 2;
      while (q.frames > MOST && q.pieces.length > 1) {
        const first = q.pieces.shift()!;
        q.frames -= first.length / 2 - q.offset;
        q.offset = 0;
      }
      if (q.frames >= PRIME) q.primed = true;
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right] = outputs[0];
    const n = left.length;
    left.fill(0);
    right?.fill(0);
    for (const q of this.queues.values()) {
      if (!q.primed) continue;
      let i = 0;
      while (i < n && q.pieces.length) {
        const piece = q.pieces[0];
        const take = Math.min(piece.length / 2 - q.offset, n - i);
        for (let k = 0; k < take; k++) {
          left[i + k] += piece[(q.offset + k) * 2];
          if (right) right[i + k] += piece[(q.offset + k) * 2 + 1];
        }
        i += take;
        q.offset += take;
        q.frames -= take;
        if (q.offset >= piece.length / 2) {
          q.pieces.shift();
          q.offset = 0;
        }
      }
      if (!q.pieces.length) q.primed = false;
    }
    return true;
  }
}

registerProcessor('pcm-feed', Feed);
