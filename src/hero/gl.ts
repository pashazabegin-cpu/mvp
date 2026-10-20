/**
 * Минимальный WebGL-слой: один полноэкранный шейдер на <canvas> размером с макет (1600×900).
 * Нужен для слайдов, где фон собран из режимов наложения (overlay, hard-light, color-dodge, linear burn…):
 * CSS mix-blend-mode внутри анимированной маски перехода Chrome рисует с артефактами,
 * а шейдер считает те же формулы сам и для браузера это обычная картинка.
 */

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/** Общие функции для фрагментных шейдеров: координаты макета и режимы наложения как в CSS/Figma. */
export const GLSL_COMMON = `
precision highp float;
uniform vec2 u_res;     // размер canvas в пикселях
uniform float u_scale;  // пикселей canvas на 1px макета
vec2 designPos() { return vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_scale; }

float erf1(float x) {
  float s = sign(x); x = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * x);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return s * y;
}
vec3 bMultiply(vec3 b, vec3 s) { return b * s; }
vec3 bScreen(vec3 b, vec3 s) { return b + s - b * s; }
vec3 bHardLight(vec3 b, vec3 s) {
  vec3 lo = b * 2.0 * s;
  vec3 hi = bScreen(b, 2.0 * s - 1.0);
  return mix(lo, hi, step(0.5, s));
}
vec3 bOverlay(vec3 b, vec3 s) { return bHardLight(s, b); }
vec3 bColorDodge(vec3 b, vec3 s) {
  vec3 r = min(vec3(1.0), b / max(vec3(1e-4), 1.0 - s));
  r = mix(r, vec3(1.0), step(1.0, s));
  return mix(r, vec3(0.0), step(b, vec3(0.0)));
}
// mode: 0 normal, 1 multiply, 2 screen, 3 overlay, 4 hard-light, 5 color-dodge, 6 plus-lighter
vec3 blendMode(vec3 b, vec3 s, float a, float mode) {
  if (mode > 5.5) return min(vec3(1.0), b + s * a);
  vec3 r = s;
  if (mode > 4.5) r = bColorDodge(b, s);
  else if (mode > 3.5) r = bHardLight(b, s);
  else if (mode > 2.5) r = bOverlay(b, s);
  else if (mode > 1.5) r = bScreen(b, s);
  else if (mode > 0.5) r = bMultiply(b, s);
  return mix(b, r, a);
}
`;

export interface GLLayer {
  gl: WebGLRenderingContext;
  uniform(name: string): WebGLUniformLocation | null;
  /** загрузить картинку/canvas в текстурный слот */
  texture(unit: number, name: string, source: TexImageSource): void;
  /** пересчитать размер canvas под текущий масштаб макета на экране */
  resize(cover: number): void;
  draw(): void;
}

export function createGLLayer(canvas: HTMLCanvasElement, fragment: string, maxScale = 2): GLLayer | null {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;

  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[hero gl]', gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) return null;
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[hero gl]', gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);

  // один треугольник на весь экран
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uniforms = new Map<string, WebGLUniformLocation | null>();
  const uniform = (name: string) => {
    if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(program, name));
    return uniforms.get(name)!;
  };

  let scale = 1;
  return {
    gl,
    uniform,
    texture(unit, name, source) {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(uniform(name), unit);
    },
    resize(cover) {
      scale = Math.min(cover * (window.devicePixelRatio || 1), maxScale);
      const w = Math.round(1600 * scale);
      const h = Math.round(900 * scale);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uniform('u_res'), w, h);
      gl.uniform1f(uniform('u_scale'), scale);
    },
    draw() {
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

export const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

/** SVG/картинку → canvas нужного размера (для текстуры-маски логотипа) */
export async function rasterize(src: string, w: number, h: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(src);
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return c;
}
