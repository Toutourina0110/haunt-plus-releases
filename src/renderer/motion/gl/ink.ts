import { ROUND_POINT_FS } from './dust';
import type { GlEngine, Rgb } from './engine';

export const INK = { page: 0, sprite: 1, radial: 2, parallel: 3, halftone: 4, vignette: 5 } as const;

const VS = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUv;
layout(location = 2) in float aAlpha;
uniform vec2 uSize;
uniform vec4 uView;
uniform vec2 uFocus;
out vec2 vUv;
out float vAlpha;
out vec2 vPx;
void main() {
  vec2 s = uFocus + (aPos - uFocus) * uView.z + uView.xy;
  vec2 n = vec2(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0);
  gl_Position = vec4(n, 0.0, 1.0);
  vUv = aUv;
  vAlpha = aAlpha;
  vPx = aPos;
}`;

const FS = `#version 300 es
precision highp float;
uniform int uMode;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform vec2 uTexel;
uniform float uSat;
uniform float uManga;
uniform float uLevels;
uniform float uDot;
uniform vec3 uCol;
uniform vec3 uCol2;
uniform vec4 uA;
uniform vec4 uB;
uniform vec4 uTint;
in vec2 vUv;
in float vAlpha;
in vec2 vPx;
out vec4 outColor;

const mat2 TILT = mat2(0.7071, -0.7071, 0.7071, 0.7071);
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float tap(vec2 o) { return luma(texture(uTex, vUv + uTexel * o).rgb); }

vec3 manga(vec3 c) {
  vec3 poster = floor(c * (uLevels - 1.0) + 0.5) / (uLevels - 1.0);
  float gx = tap(vec2(1.0, -1.0)) + 2.0 * tap(vec2(1.0, 0.0)) + tap(vec2(1.0, 1.0))
    - tap(vec2(-1.0, -1.0)) - 2.0 * tap(vec2(-1.0, 0.0)) - tap(vec2(-1.0, 1.0));
  float gy = tap(vec2(-1.0, 1.0)) + 2.0 * tap(vec2(0.0, 1.0)) + tap(vec2(1.0, 1.0))
    - tap(vec2(-1.0, -1.0)) - 2.0 * tap(vec2(0.0, -1.0)) - tap(vec2(1.0, -1.0));
  float edge = smoothstep(0.1, 0.3, length(vec2(gx, gy)));
  float dark = 1.0 - smoothstep(0.08, 0.45, luma(c));
  float d = length(fract(TILT * vPx / uDot) - 0.5);
  float r = 0.62 * sqrt(dark);
  float dots = 1.0 - smoothstep(r - 0.05, r, d);
  vec3 m = mix(poster, uCol2, dots * dark);
  return mix(m, uCol2, edge);
}

void main() {
  vec4 o = vec4(0.0);
  if (uMode == 0) {
    vec3 c = texture(uTex, vUv).rgb;
    c = mix(vec3(luma(c)), c, uSat);
    if (uManga > 0.0) c = mix(c, manga(c), uManga);
    o = vec4(c, 1.0);
  } else if (uMode == 1) {
    vec4 t = texture(uTex, vUv);
    o = vec4(mix(t.rgb, uTint.rgb, uTint.a), t.a);
  } else if (uMode == 2) {
    vec2 d = vPx - uA.xy;
    float k = (atan(d.y, d.x) / 6.28318 + 0.5 + uA.z) * uA.w;
    float id = floor(k);
    float line = step(fract(k), 0.06 + 0.3 * hash(id)) * step(0.3, hash(id + 7.0));
    float r = length(d) / length(uSize);
    o = vec4(uCol, line * smoothstep(uB.x, uB.x + 0.2, r - 0.2 * hash(id + 3.0)));
  } else if (uMode == 3) {
    vec2 n = vec2(-uA.y, uA.x);
    float across = dot(vPx, n) / uA.w;
    float id = floor(across);
    float along = (dot(vPx, uA.xy) + uA.z * (0.6 + hash(id))) / (uB.x * (0.5 + hash(id + 2.0)));
    float on = step(0.45, hash(id + 5.0)) * step(fract(along), 0.55)
      * step(abs(fract(across) - 0.5), 0.08 + 0.18 * hash(id + 9.0));
    o = vec4(uCol, on);
  } else if (uMode == 4) {
    float d = length(fract(TILT * vPx / uA.x) - 0.5);
    float r = sqrt(mix(uA.y, uA.z, vUv.y) / 3.14159);
    o = vec4(uCol, 1.0 - smoothstep(r - 0.05, r, d));
  } else {
    vec2 q = (vPx / uSize - 0.5) * 2.0;
    o = vec4(uCol, smoothstep(uA.x, uA.y, length(q) / 1.4142) * uA.z);
  }
  float a = o.a * vAlpha;
  outColor = vec4(o.rgb * a, a);
}`;

const POINT_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in float aSize;
layout(location = 2) in vec4 aColor;
uniform vec2 uSize;
uniform vec4 uView;
uniform vec2 uFocus;
out vec4 vColor;
void main() {
  vec2 s = uFocus + (aPos - uFocus) * uView.z + uView.xy;
  gl_Position = vec4(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0, 0.0, 1.0);
  gl_PointSize = aSize;
  vColor = aColor;
}`;

export interface InkDraw {
  tex?: WebGLTexture | null;
  texel?: [number, number];
  sat?: number;
  manga?: number;
  levels?: number;
  dot?: number;
  col?: Rgb;
  col2?: Rgb;
  a?: [number, number, number, number];
  b?: [number, number, number, number];
  tint?: [number, number, number, number];
}

const NAMES = ['uMode', 'uTex', 'uSize', 'uTexel', 'uSat', 'uManga', 'uLevels', 'uDot', 'uCol', 'uCol2', 'uA', 'uB', 'uTint', 'uView', 'uFocus'];

export class Ink {
  private readonly prog: WebGLProgram;
  private readonly points: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buf: WebGLBuffer;
  private readonly pvao: WebGLVertexArrayObject;
  private readonly pbuf: WebGLBuffer;
  private readonly u: Record<string, WebGLUniformLocation | null>;
  private readonly pu: Record<string, WebGLUniformLocation | null>;
  private data = new Float32Array(5 * 2048);
  private count = 0;

  constructor(private readonly engine: GlEngine) {
    const gl = engine.gl;
    this.prog = inkProgram(engine);
    this.points = pointProgram(engine);
    this.u = Object.fromEntries(NAMES.map((n) => [n, gl.getUniformLocation(this.prog, n)]));
    this.pu = Object.fromEntries(['uSize', 'uView', 'uFocus'].map((n) => [n, gl.getUniformLocation(this.points, n)]));
    [this.vao, this.buf] = layout(gl, [2, 2, 1]);
    [this.pvao, this.pbuf] = layout(gl, [2, 1, 4]);
  }

  rect(x: number, y: number, w: number, h: number, alpha = 1, uv: [number, number, number, number] = [0, 0, 1, 1]): void {
    const [u0, v0, u1, v1] = uv;
    this.quad([x, y], [x + w, y], [x + w, y + h], [x, y + h], [u0, v0], [u1, v0], [u1, v1], [u0, v1], alpha);
  }

  quad(
    a: [number, number],
    b: [number, number],
    c: [number, number],
    d: [number, number],
    ua: [number, number],
    ub: [number, number],
    uc: [number, number],
    ud: [number, number],
    alpha = 1,
  ): void {
    this.vertex(a, ua, alpha);
    this.vertex(b, ub, alpha);
    this.vertex(c, uc, alpha);
    this.vertex(a, ua, alpha);
    this.vertex(c, uc, alpha);
    this.vertex(d, ud, alpha);
  }

  vertex(p: [number, number], uv: [number, number], alpha: number): void {
    if (this.count + 5 > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data.set([p[0], p[1], uv[0], uv[1], alpha], this.count);
    this.count += 5;
  }

  draw(mode: number, o: InkDraw = {}): void {
    const n = this.count / 5;
    if (!n) return;
    const { gl, w, h, view } = this.engine;
    const u = this.u;
    gl.useProgram(this.prog);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, o.tex ?? null);
    gl.uniform1i(u.uTex, 0);
    gl.uniform1i(u.uMode, mode);
    gl.uniform2f(u.uSize, w, h);
    gl.uniform2fv(u.uTexel, o.texel ?? [0, 0]);
    gl.uniform1f(u.uSat, o.sat ?? 1);
    gl.uniform1f(u.uManga, o.manga ?? 0);
    gl.uniform1f(u.uLevels, o.levels ?? 4);
    gl.uniform1f(u.uDot, o.dot ?? 6);
    gl.uniform3fv(u.uCol, o.col ?? [0, 0, 0]);
    gl.uniform3fv(u.uCol2, o.col2 ?? [0, 0, 0]);
    gl.uniform4fv(u.uA, o.a ?? [0, 0, 0, 0]);
    gl.uniform4fv(u.uB, o.b ?? [0, 0, 0, 0]);
    gl.uniform4fv(u.uTint, o.tint ?? [0, 0, 0, 0]);
    gl.uniform4f(u.uView, view[0], view[1], view[2], 0);
    gl.uniform2f(u.uFocus, view[3], view[4]);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.count), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, n);
    gl.bindVertexArray(null);
    this.count = 0;
  }

  dots(data: Float32Array, n: number): void {
    if (!n) return;
    const { gl, w, h, view } = this.engine;
    gl.useProgram(this.points);
    gl.uniform2f(this.pu.uSize, w, h);
    gl.uniform4f(this.pu.uView, view[0], view[1], view[2], 0);
    gl.uniform2f(this.pu.uFocus, view[3], view[4]);
    gl.bindVertexArray(this.pvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pbuf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 7), gl.STREAM_DRAW);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.engine.gl;
    gl.deleteBuffer(this.buf);
    gl.deleteBuffer(this.pbuf);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.pvao);
  }
}

export const inkProgram = (engine: GlEngine): WebGLProgram => engine.program('ink', VS, FS);
export const pointProgram = (engine: GlEngine): WebGLProgram => engine.program('ink-points', POINT_VS, ROUND_POINT_FS);

function layout(gl: WebGL2RenderingContext, sizes: number[]): [WebGLVertexArrayObject, WebGLBuffer] {
  const vao = gl.createVertexArray()!;
  const buf = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const stride = sizes.reduce((a, b) => a + b, 0) * 4;
  let at = 0;
  sizes.forEach((size, i) => {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, size, gl.FLOAT, false, stride, at * 4);
    at += size;
  });
  gl.bindVertexArray(null);
  return [vao, buf];
}
