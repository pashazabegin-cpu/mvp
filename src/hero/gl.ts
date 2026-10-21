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
  /** загрузить картинку/canvas в текстурный слот (запоминается и заливается заново после восстановления контекста) */
  texture(unit: number, name: string, source: TexImageSource): void;
  /** пересчитать размер canvas под текущий масштаб макета на экране */
  resize(cover: number): void;
  draw(): void;
  /** контекст сейчас рабочий (не отобран браузером) */
  readonly alive: boolean;
}

export interface GLLayerHooks {
  /** браузер отобрал контекст (нехватка видеопамяти, сброс GPU) — показать HTML-версию */
  onLost?: () => void;
  /** контекст вернули, шейдер и текстуры уже собраны заново — задать постоянные uniform'ы и перерисовать */
  onRestored?: () => void;
}

export function createGLLayer(canvas: HTMLCanvasElement, fragment: string, maxScale = 2, hooks: GLLayerHooks = {}): GLLayer | null {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;

  const uniforms = new Map<string, WebGLUniformLocation | null>();
  const textures = new Map<number, { name: string; source: TexImageSource }>();
  let program: WebGLProgram | null = null;
  let size = { w: 0, h: 0, scale: 1 };

  const uniform = (name: string) => {
    if (!program) return null;
    if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(program, name));
    return uniforms.get(name)!;
  };

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

  const upload = (unit: number, name: string, source: TexImageSource) => {
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
  };

  const applySize = () => {
    gl.viewport(0, 0, size.w, size.h);
    gl.uniform2f(uniform('u_res'), size.w, size.h);
    gl.uniform1f(uniform('u_scale'), size.scale);
  };

  // программа, геометрия и текстуры; вызывается при создании и после восстановления контекста
  const build = (): boolean => {
    uniforms.clear();
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, fragment);
    if (!vs || !fs) return false;
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn('[hero gl]', gl.getProgramInfoLog(p));
      return false;
    }
    program = p;
    gl.useProgram(p);
    // один треугольник на весь экран
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    textures.forEach((t, unit) => upload(unit, t.name, t.source));
    if (size.w) applySize();
    return true;
  };
  if (!build()) return null;

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // разрешаем браузеру вернуть контекст
    hooks.onLost?.();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (build()) hooks.onRestored?.();
  });

  return {
    gl,
    uniform,
    texture(unit, name, source) {
      textures.set(unit, { name, source });
      upload(unit, name, source);
    },
    resize(cover) {
      const scale = Math.min(cover * (window.devicePixelRatio || 1), maxScale);
      size = { w: Math.round(1600 * scale), h: Math.round(900 * scale), scale };
      if (canvas.width !== size.w || canvas.height !== size.h) {
        canvas.width = size.w;
        canvas.height = size.h;
      }
      applySize();
    },
    draw() {
      if (!gl.isContextLost()) gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    get alive() {
      return !gl.isContextLost();
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
