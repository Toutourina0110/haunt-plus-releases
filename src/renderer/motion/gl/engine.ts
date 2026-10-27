export type Rgb = [number, number, number];

export const KIND = {
  from: 0,
  to: 1,
  logoA: 2,
  logoB: 3,
  flat: 4,
  fromBlur: 5,
  toBlur: 6,
  fromFront: 7,
} as const;

export type TexName = 'from' | 'to' | 'logoA' | 'logoB' | 'fromBlur' | 'toBlur';
const TEX_NAMES: TexName[] = ['from', 'to', 'logoA', 'logoB', 'fromBlur', 'toBlur'];

const STRIDE = 15;

const QUAD_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUv;
layout(location = 2) in vec4 aLook;
layout(location = 3) in vec3 aCol;
layout(location = 4) in vec3 aBg;
uniform vec2 uSize;
uniform float uCam;
uniform vec4 uView;
uniform vec2 uFocus;
out vec2 vUv;
out vec4 vLook;
out vec3 vCol;
out vec3 vBg;
void main() {
  float w = (uCam - aPos.z) / uCam;
  vec2 s = uSize * 0.5 + (aPos.xy - uSize * 0.5) / w;
  s = uFocus + (s - uFocus) * uView.z + uView.xy;
  vec2 n = vec2(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0);
  gl_Position = vec4(n * w, clamp(-aPos.z / uCam, -1.0, 1.0) * w, w);
  vUv = aUv;
  vLook = aLook;
  vCol = aCol;
  vBg = aBg;
}`;

const QUAD_FS = `#version 300 es
precision highp float;
uniform sampler2D uFrom, uTo, uLogoA, uLogoB, uFromBlur, uToBlur;
uniform vec3 uFront;
uniform bool uBack;
in vec2 vUv;
in vec4 vLook;
in vec3 vCol;
in vec3 vBg;
out vec4 outColor;
float mask(sampler2D t, vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture(t, uv).a;
}
void main() {
  float kind = vLook.z;
  vec3 rgb;
  float a = 1.0;
  if (uBack && !gl_FrontFacing) rgb = vCol;
  else if (kind < 0.5) rgb = mix(texture(uFrom, vUv).rgb, texture(uTo, vUv).rgb, vLook.w);
  else if (kind < 1.5) rgb = texture(uTo, vUv).rgb;
  else if (kind < 2.5) rgb = mix(vBg, vCol, mask(uLogoA, vUv));
  else if (kind < 3.5) rgb = mix(vBg, vCol, mask(uLogoB, vUv));
  else if (kind < 4.5) rgb = vCol;
  else if (kind < 5.5) rgb = texture(uFromBlur, vUv).rgb;
  else if (kind < 6.5) rgb = texture(uToBlur, vUv).rgb;
  else {
    rgb = texture(uFrom, vUv).rgb;
    float x = uFront.z > 0.0 ? vUv.x : 1.0 - vUv.x;
    a = smoothstep(uFront.x, uFront.x + uFront.y, x);
  }
  a *= vLook.y;
  outColor = vec4(rgb * vLook.x * a, a);
}`;

export interface Look {
  shade?: number;
  alpha?: number;
  kind: number;
  toMix?: number;
  col?: Rgb;
  bg?: Rgb;
}

type V3 = [number, number, number];
type V2 = [number, number];

export interface FlushOptions {
  lines?: boolean;
  depth?: boolean;
  cull?: boolean;
  back?: boolean;
  front?: [number, number, number];
}

export class GlEngine {
  lost = false;
  w = 1;
  h = 1;
  cam = 1;
  view: [number, number, number, number, number] = [0, 0, 1, 0, 0];
  readonly tex: Partial<Record<TexName, WebGLTexture>> = {};
  private readonly quad: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private readonly u: Record<string, WebGLUniformLocation | null> = {};
  private data = new Float32Array(STRIDE * 4096);
  private count = 0;
  private readonly programs = new Map<string, WebGLProgram>();
  private readonly blank: WebGLTexture;

  private constructor(
    readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    readonly gl: WebGL2RenderingContext,
  ) {
    this.quad = this.program('quad', QUAD_VS, QUAD_FS);
    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const f = 4;
    const attr = (loc: number, size: number, at: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * f, at * f);
    };
    attr(0, 3, 0);
    attr(1, 2, 3);
    attr(2, 4, 5);
    attr(3, 3, 9);
    attr(4, 3, 12);
    gl.bindVertexArray(null);
    gl.useProgram(this.quad);
    for (const name of ['uSize', 'uCam', 'uFront', 'uBack', 'uView', 'uFocus']) this.u[name] = gl.getUniformLocation(this.quad, name);
    TEX_NAMES.forEach((name, i) => gl.uniform1i(gl.getUniformLocation(this.quad, `u${name[0].toUpperCase()}${name.slice(1)}`), i));
    this.blank = this.flatTexture([0, 0, 0]);
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.lost = true;
    });
  }

  static create(canvas: HTMLCanvasElement | OffscreenCanvas): GlEngine | null {
    try {
      const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true, depth: true }) as WebGL2RenderingContext | null;
      return gl && !gl.isContextLost() ? new GlEngine(canvas, gl) : null;
    } catch {
      return null;
    }
  }

  get ok(): boolean {
    return !this.lost && !this.gl.isContextLost();
  }

  resize(w: number, h: number, dpr: number, camera: number): void {
    this.w = w;
    this.h = h;
    this.cam = camera * w;
    const cw = Math.max(1, Math.round(w * dpr));
    const ch = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.gl.viewport(0, 0, cw, ch);
  }

  program(key: string, vs: string, fs: string): WebGLProgram {
    const cached = this.programs.get(key);
    if (cached) return cached;
    const gl = this.gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program');
    this.programs.set(key, p);
    return p;
  }

  texture(src: TexImageSource): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ]) {
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    }
    return t;
  }

  flatTexture(rgb: Rgb): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    const px = new Uint8Array([rgb[0] * 255, rgb[1] * 255, rgb[2] * 255, 255]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return t;
  }

  release(): void {
    for (const name of TEX_NAMES) {
      const t = this.tex[name];
      if (t) this.gl.deleteTexture(t);
      delete this.tex[name];
    }
  }

  begin(): void {
    const gl = this.gl;
    this.view = [0, 0, 1, 0, 0];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.frontFace(gl.CW);
  }

  clear(): void {
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
  }

  vertex(p: V3, uv: V2, look: Look): void {
    if (this.count + STRIDE > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const d = this.data;
    let i = this.count;
    const col = look.col ?? [0, 0, 0];
    const bg = look.bg ?? col;
    d[i++] = p[0];
    d[i++] = p[1];
    d[i++] = p[2];
    d[i++] = uv[0];
    d[i++] = uv[1];
    d[i++] = look.shade ?? 1;
    d[i++] = look.alpha ?? 1;
    d[i++] = look.kind;
    d[i++] = look.toMix ?? 0;
    d[i++] = col[0];
    d[i++] = col[1];
    d[i++] = col[2];
    d[i++] = bg[0];
    d[i++] = bg[1];
    d[i++] = bg[2];
    this.count = i;
  }

  quad4(p: [V3, V3, V3, V3], uv: [V2, V2, V2, V2], look: Look): void {
    for (const k of [0, 1, 2, 0, 2, 3]) this.vertex(p[k], uv[k], look);
  }

  rect(x: number, y: number, w: number, h: number, uv: [number, number, number, number], look: Look): void {
    const [u0, v0, u1, v1] = uv;
    this.quad4(
      [
        [x, y, 0],
        [x + w, y, 0],
        [x + w, y + h, 0],
        [x, y + h, 0],
      ],
      [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ],
      look,
    );
  }

  line(a: V2, b: V2, look: Look): void {
    this.vertex([a[0], a[1], 0], [0, 0], look);
    this.vertex([b[0], b[1], 0], [0, 0], look);
  }

  flush(o: FlushOptions = {}): void {
    const n = this.count / STRIDE;
    if (!n) return;
    const gl = this.gl;
    gl.useProgram(this.quad);
    TEX_NAMES.forEach((name, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[name] ?? this.blank);
    });
    gl.uniform2f(this.u.uSize, this.w, this.h);
    gl.uniform1f(this.u.uCam, this.cam);
    gl.uniform3fv(this.u.uFront, o.front ?? [0, 0, 1]);
    gl.uniform1i(this.u.uBack, o.back ? 1 : 0);
    gl.uniform4f(this.u.uView, this.view[0], this.view[1], this.view[2], 0);
    gl.uniform2f(this.u.uFocus, this.view[3], this.view[4]);
    if (o.depth) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    if (o.cull) gl.enable(gl.CULL_FACE);
    else gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.count), gl.STREAM_DRAW);
    gl.drawArrays(o.lines ? gl.LINES : gl.TRIANGLES, 0, n);
    gl.bindVertexArray(null);
    this.count = 0;
  }
}
