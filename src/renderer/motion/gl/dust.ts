import { DUST, type DustParams } from '../../../shared/dust-params';
import { MARK_MAP, sampleCells } from '../../tiles';
import { KIND, type GlEngine } from './engine';
import { hilbert, smooth, span } from './math';
import type { SceneMaker } from './morph';

const VS = `#version 300 es
layout(location = 0) in vec2 aStart;
layout(location = 1) in vec2 aLogo;
layout(location = 2) in vec2 aEnd;
layout(location = 3) in vec2 aSeed;
uniform float uT;
uniform vec2 uSize;
uniform float uDir;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec4 uFlow;
uniform vec4 uA;
uniform vec4 uB;
uniform float uStagger;
uniform sampler2D uFrom;
uniform sampler2D uTo;
out vec4 vColor;

float ease(float u) { return u < 0.5 ? 4.0 * u * u * u : 1.0 - pow(-2.0 * u + 2.0, 3.0) / 2.0; }

vec2 curl(vec2 p, float t) {
  float a = p.x * 1.7 + t;
  float b = p.y * 1.3 - t * 0.8;
  float c = p.x * 0.9 - p.y * 1.1 + t * 1.4;
  float dx = 1.7 * cos(a) * cos(b) + 0.45 * cos(c);
  float dy = -1.3 * sin(a) * sin(b) - 0.55 * cos(c);
  return vec2(dy, -dx);
}

void main() {
  float key = uDir > 0.0 ? aStart.x / uSize.x : 1.0 - aStart.x / uSize.x;
  float release = mix(uA.x, uA.y, (key + uB.x * 0.5) / (1.0 + uB.x));
  float age = max(0.0, uT - release);
  vec2 flow = aStart + curl(aStart / uSize.y * 3.0 + aSeed.x * 7.0, age * uFlow.w) * uFlow.x * age * (0.6 + 0.8 * aSeed.x)
    + vec2(uDir * uFlow.y * age * age * 4.0, -uFlow.y * 0.25 * age);

  float from = max(uA.z, release + 0.03);
  float a = ease(clamp((uT - from) / max(0.01, uA.w - from), 0.0, 1.0));

  float centre = length((aEnd - uSize * 0.5) / (uSize * 0.5)) / 1.4142;
  float start = uB.y + centre * uStagger;
  float d = clamp((uT - start) / max(0.01, uB.z - uB.y - uStagger), 0.0, 1.0);

  vec2 shiver = vec2(sin(uT * 240.0 + aSeed.x * 40.0), cos(uT * 211.0 + aSeed.x * 31.0)) * uFlow.z;
  vec2 logo = aLogo + shiver * smoothstep(uA.w - 0.02, uA.w, uT) * (1.0 - d);
  vec2 pos = mix(mix(flow, logo, a), aEnd, ease(d));
  pos += curl(aEnd / uSize.y * 3.0 + aSeed.x * 5.0, uT * 4.0) * uFlow.x * 0.35 * sin(3.14159 * d);

  vec3 pixel = texture(uFrom, aStart / uSize).rgb;
  vec3 brand = mix(uColA, uColB, floor(a * 64.0) / 64.0);
  vec3 colour = mix(pixel, brand, smoothstep(0.0, 0.4, a));
  colour = mix(colour, texture(uTo, aEnd / uSize).rgb, smoothstep(0.3, 1.0, d));

  float size = aSeed.y * (1.0 - smoothstep(uB.w, 1.0, uT));
  gl_PointSize = size;
  vec2 n = vec2(pos.x / uSize.x * 2.0 - 1.0, 1.0 - pos.y / uSize.y * 2.0);
  gl_Position = vec4(n, 0.0, 1.0);
  vColor = vec4(colour, step(release, uT) * step(0.01, size));
}`;

export const ROUND_POINT_FS = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() {
  float a = vColor.a * (1.0 - smoothstep(0.35, 0.5, length(gl_PointCoord - 0.5)));
  if (a <= 0.0) discard;
  outColor = vec4(vColor.rgb * a, a);
}`;

export const dustProgram = (engine: GlEngine): WebGLProgram => engine.program('dust', VS, ROUND_POINT_FS);

const UNIFORMS = ['uT', 'uSize', 'uDir', 'uColA', 'uColB', 'uFlow', 'uA', 'uB', 'uStagger', 'uFrom', 'uTo'];

export const dust: SceneMaker = (kit, tune) => {
  const p: DustParams = { ...(kit.dark ? DUST.dark : DUST.light), ...tune };
  const { engine, w, h, rng, dir } = kit;
  const gl = engine.gl;
  const n = Math.max(100, Math.round(p.particles));
  let count = n;

  const strata = (): Float32Array => {
    const cols = Math.ceil(Math.sqrt((n * w) / h));
    const rows = Math.ceil(n / cols);
    const cells = Array.from({ length: cols * rows }, (_, i) => i);
    shuffle(cells, rng);
    const out = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      out[i * 2] = ((c % cols) + rng()) * (w / cols);
      out[i * 2 + 1] = (Math.floor(c / cols) + rng()) * (h / rows);
    }
    return out;
  };
  const starts = strata();
  const ends = strata();
  const logo = kit.logo(kit.to.mark);
  const k = logo.size / MARK_MAP;
  const squares = sampleCells(kit.to.mark, p.logoCells);
  const logos = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const c = squares[Math.floor(rng() * squares.length)];
    logos[i * 2] = logo.x + (c.x + (rng() - 0.5) * c.s) * k;
    logos[i * 2 + 1] = logo.y + (c.y + (rng() - 0.5) * c.s) * k;
  }

  const rank = (pts: Float32Array) => {
    const keys = new Float64Array(n);
    for (let i = 0; i < n; i++) keys[i] = hilbert((pts[i * 2] / w) * 1023, (pts[i * 2 + 1] / h) * 1023) * 65536 + i;
    keys.sort();
    return Array.from(keys, (k) => k % 65536);
  };
  const [rs, rl, re] = [rank(starts), rank(logos), rank(ends)];
  const order = Array.from({ length: n }, (_, i) => i);
  shuffle(order, rng);
  const data = new Float32Array(n * 8);
  order.forEach((j, slot) => {
    const o = slot * 8;
    data.set([starts[rs[j] * 2], starts[rs[j] * 2 + 1], logos[rl[j] * 2], logos[rl[j] * 2 + 1], ends[re[j] * 2], ends[re[j] * 2 + 1]], o);
    data[o + 6] = rng();
    data[o + 7] = p.sizeMin + rng() * (p.sizeMax - p.sizeMin);
  });

  const program = dustProgram(engine);
  const u = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]));
  const vao = gl.createVertexArray()!;
  const buffer = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  for (let i = 0; i < 4; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 2, gl.FLOAT, false, 32, i * 8);
  }
  gl.bindVertexArray(null);

  engine.tex.fromBlur = kit.blur(kit.fromShot, kit.from.bg, p.blur);
  engine.tex.toBlur = engine.flatTexture(kit.to.bg);
  const tex = (unit: number, t: WebGLTexture | undefined) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t ?? null);
  };

  return {
    camera: 2.2,
    need: p.hold,
    count: n,
    target: () => {
      if (engine.tex.toBlur) gl.deleteTexture(engine.tex.toBlur);
      engine.tex.toBlur = kit.blur(kit.toShot, kit.to.bg, p.blur);
    },
    reduce: () => {
      if (count <= 200) return null;
      count = Math.floor(count / 2);
      return `${count} grains`;
    },
    draw: (t) => {
      const soft = smooth(p.frontStart, p.frontStart + 0.14, t) * (1 - smooth(p.fixStart, 1, t));
      const front = -p.frontSoft + span(t, p.frontStart, p.frontEnd) * (1 + p.frontSoft);
      engine.rect(0, 0, w, h, [0, 0, 1, 1], { kind: KIND.fromBlur });
      engine.rect(0, 0, w, h, [0, 0, 1, 1], { kind: KIND.toBlur, alpha: smooth(p.attractEnd - 0.02, p.logoEnd, t) });
      engine.rect(0, 0, w, h, [0, 0, 1, 1], { kind: KIND.flat, col: [0, 0, 0], alpha: p.darken * soft });
      engine.rect(0, 0, w, h, [0, 0, 1, 1], { kind: KIND.fromFront });
      engine.rect(0, 0, w, h, [0, 0, 1, 1], { kind: KIND.to, alpha: smooth(p.fixStart, 1, t) });
      engine.flush({ front: [front, p.frontSoft, dir] });

      if (t <= p.frontStart || t >= 1) return;
      gl.useProgram(program);
      tex(0, engine.tex.from);
      tex(1, engine.tex.to);
      gl.uniform1i(u.uFrom, 0);
      gl.uniform1i(u.uTo, 1);
      gl.uniform1f(u.uT, t);
      gl.uniform2f(u.uSize, w, h);
      gl.uniform1f(u.uDir, dir);
      gl.uniform3fv(u.uColA, kit.from.color);
      gl.uniform3fv(u.uColB, kit.to.color);
      gl.uniform4f(u.uFlow, p.curl, p.drift, p.jitter, p.swirl);
      gl.uniform4f(u.uA, p.frontStart, p.frontEnd, p.attractStart, p.attractEnd);
      gl.uniform4f(u.uB, p.frontSoft, p.depositStart, p.depositEnd, p.fixStart);
      gl.uniform1f(u.uStagger, p.depositStagger);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.bindVertexArray(null);
    },
    dispose: () => {
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
    },
  };
};

function shuffle<T>(list: T[], rng: () => number): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}
