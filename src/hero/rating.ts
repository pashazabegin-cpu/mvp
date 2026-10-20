/**
 * Слайд «Рейтинг»: «лесенки» (7 наклонных полос с градиентами и режимами наложения из Figma),
 * светящиеся эллипсы, затемнение снизу и свет за курсором — всё считается одним шейдером.
 * Полосы реагируют на курсор: сдвиг по глубине, ближние тянутся к курсору и подсвечиваются.
 * Если WebGL недоступен — работает HTML-версия из разметки (.stripe / [data-glow]).
 */
import { gsap } from 'gsap';
import { createGLLayer, GLSL_COMMON, type GLLayer } from './gl';
import type { Pointer } from './effects';

const ROT = (16.76 * Math.PI) / 180;
const TAN = Math.tan(ROT);
const M = { multiply: 1, screen: 2, overlay: 3, hardLight: 4, colorDodge: 5, plusLighter: 6 };

// left, top, width, height, угол градиента, начало и конец градиента, цвет, режим, глубина (для параллакса)
const STRIPES: [number, number, number, number, number, number, number, string, number, number][] = [
  [741.04, -83.76, 274.49, 1409.07, 265.28, 0.1327, 0.955, '#521d48', M.overlay, 0.9],
  [1387.44, -111.41, 82.74, 1409.07, 268.95, 0.0727, 0.996, '#08377c', M.hardLight, 1.4],
  [1476.65, -106.06, 119.82, 1409.07, -82.11, 0.3215, 0.7214, '#08377c', M.overlay, 1.1],
  [615.6, -171.33, 145, 1392.56, 268.13, 0.0727, 0.996, '#08377c', M.overlay, 1.25],
  [392.58, -169.62, 210, 1423.33, 267.36, 0.0727, 0.996, '#521d48', M.multiply, 0.7],
  [124.68, -253.93, 270, 1507.27, 266.79, 0.0727, 0.996, '#08377c', M.overlay, 1],
  [-296.16, -195.91, 403, 1410.49, 264.89, 0.0727, 0.996, '#08377c', M.hardLight, 0.6],
];
// эллипс x, y, w, h, sigma размытия, цвет, непрозрачность, режим
const GLOWS: [number, number, number, number, number, string, number, number][] = [
  [-765, -119, 1358.25, 1282, 300, '#821e64', 0.3, M.hardLight],
  [-597.66, 49.58, 1076.72, 982.91, 204.7, '#fa3294', 0.3, M.colorDodge],
  [1265, -36, 999.09, 943, 300, '#04285e', 1, M.plusLighter],
  [1388.09, 88, 792, 723, 204.7, '#164fa4', 1, M.colorDodge],
];

const FRAG = `${GLSL_COMMON}
uniform vec4 u_sGeo[7];   // центр x, y, ширина, высота
uniform vec4 u_sGrad[7];  // направление градиента / длина, начало, конец
uniform vec4 u_sCol[7];   // цвет, режим
uniform vec4 u_sDyn[7];   // сдвиг x, центр перелива (доля ширины), сила перелива
uniform vec4 u_gGeo[4];   // центр, радиусы с запасом под размытие
uniform vec4 u_gPar[4];   // радиус эллипса, sigma, охват, непрозрачность
uniform vec4 u_gCol[4];   // цвет, режим
uniform vec4 u_light;     // x, y, радиус, сила
uniform vec2 u_rot;       // cos, sin наклона полос

void main() {
  vec2 p = designPos();
  float px = 1.0 / u_scale;
  vec3 col = vec3(13.0, 21.0, 41.0) / 255.0;

  for (int i = 0; i < 7; i++) {
    vec4 g = u_sGeo[i];
    vec4 dyn = u_sDyn[i];
    vec2 q = p - vec2(g.x + dyn.x, g.y);
    vec2 l = vec2(u_rot.x * q.x + u_rot.y * q.y, -u_rot.y * q.x + u_rot.x * q.y);
    float cov = clamp((g.z * 0.5 - abs(l.x)) / px + 0.5, 0.0, 1.0) * clamp((g.w * 0.5 - abs(l.y)) / px + 0.5, 0.0, 1.0);
    if (cov <= 0.0) continue;
    vec4 gr = u_sGrad[i];
    float a = clamp((dot(l, gr.xy) + 0.5 - gr.z) / (gr.w - gr.z), 0.0, 1.0);
    float sh = max(0.0, 1.0 - abs(l.x / g.z - dyn.y) / 0.4) * 0.28 * dyn.z;
    float sa = sh + (1.0 - sh) * a;
    vec3 premul = vec3(140.0, 190.0, 255.0) / 255.0 * sh + u_sCol[i].rgb * a * (1.0 - sh);
    vec3 src = sa > 0.0 ? premul / sa : u_sCol[i].rgb;
    col = blendMode(col, src, sa * cov, u_sCol[i].w);
  }

  for (int i = 0; i < 4; i++) {
    vec4 g = u_gGeo[i];
    vec4 pr = u_gPar[i];
    float t = length((p - g.xy) / g.zw);
    if (t >= 1.0) continue;
    float d = t * pr.z;
    float v = 0.5 * (erf1((pr.x - d) / (pr.y * 1.41421)) + erf1((pr.x + d) / (pr.y * 1.41421)));
    col = blendMode(col, u_gCol[i].rgb, max(v, 0.0) * pr.w, u_gCol[i].w);
  }

  // затемнение снизу (multiply)
  if (p.y > 322.0 && p.y < 983.0) {
    float t = (983.0 - p.y) / 661.0;
    float a = 0.7 * (1.0 - clamp((t - 0.03694) / (0.80607 - 0.03694), 0.0, 1.0));
    col = blendMode(col, vec3(3.0, 21.0, 40.0) / 255.0, a, 1.0);
  }

  // свет за курсором (screen)
  if (u_light.w > 0.001) {
    float t = length(p - u_light.xy) / u_light.z;
    if (t < 1.0) {
      vec3 pm0 = vec3(66.0, 140.0, 255.0) / 255.0 * 0.4;
      vec3 pm1 = vec3(150.0, 40.0, 120.0) / 255.0 * 0.15;
      vec3 pm; float a;
      if (t < 0.55) { pm = mix(pm0, pm1, t / 0.55); a = mix(0.4, 0.15, t / 0.55); }
      else { pm = mix(pm1, vec3(0.0), (t - 0.55) / 0.45); a = mix(0.15, 0.0, (t - 0.55) / 0.45); }
      if (a > 0.0) col = blendMode(col, pm / a, a * u_light.w, 2.0);
    }
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

function setupStatic(layer: GLLayer) {
  const { gl, uniform } = layer;
  const geo: number[] = [], grad: number[] = [], col: number[] = [];
  STRIPES.forEach(([l, t, w, h, deg, t0, t1, c, mode]) => {
    const a = (deg * Math.PI) / 180;
    const len = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
    geo.push(l + w / 2, t + h / 2, w, h);
    grad.push(Math.sin(a) / len, -Math.cos(a) / len, t0, t1);
    col.push(...rgb(c), mode);
  });
  gl.uniform4fv(uniform('u_sGeo'), geo);
  gl.uniform4fv(uniform('u_sGrad'), grad);
  gl.uniform4fv(uniform('u_sCol'), col);

  const gGeo: number[] = [], gPar: number[] = [], gCol: number[] = [];
  GLOWS.forEach(([x, y, w, h, s, c, op, mode]) => {
    const pad = 2.2 * s;
    const r = (w + h) / 4;
    gGeo.push(x + w / 2, y + h / 2, w / 2 + pad, h / 2 + pad);
    gPar.push(r, s, r + pad, op);
    gCol.push(...rgb(c), mode);
  });
  gl.uniform4fv(uniform('u_gGeo'), gGeo);
  gl.uniform4fv(uniform('u_gPar'), gPar);
  gl.uniform4fv(uniform('u_gCol'), gCol);
  gl.uniform2f(uniform('u_rot'), Math.cos(ROT), Math.sin(ROT));
}

export function createStripes(slide: HTMLElement, getCover: () => number) {
  const canvas = slide.querySelector<HTMLCanvasElement>('canvas[data-gl]');
  const layer = canvas ? createGLLayer(canvas, FRAG, 1.5) : null;
  if (layer) {
    setupStatic(layer);
    slide.classList.add('is-gl');
  }

  // HTML-запасной вариант
  const domStripes = Array.from(slide.querySelectorAll<HTMLElement>('.stripe')).map((el) => ({ el, inner: el.firstElementChild as HTMLElement }));
  const light = slide.querySelector<HTMLElement>('[data-stripes-light]');

  const stripes = STRIPES.map(([l, t, w, h, , , , , , depth], i) => ({ cx: l + w / 2, cy: t + h / 2, depth, phase: i * 1.7 }));
  const target = { nx: 0, x: 0, y: 0, dx: 800, dy: 450, on: 0 };
  const cur = { ...target };
  const dyn = new Float32Array(28);
  let running = false;
  let t0 = 0;

  const frame = (time: number) => {
    const t = time - t0;
    cur.nx += (target.nx - cur.nx) * 0.075;
    cur.dx += (target.dx - cur.dx) * 0.09;
    cur.dy += (target.dy - cur.dy) * 0.09;
    cur.x += (target.x - cur.x) * 0.12;
    cur.y += (target.y - cur.y) * 0.12;
    cur.on += (target.on - cur.on) * 0.05;

    stripes.forEach((s, i) => {
      // расстояние от курсора до оси наклонной полосы на высоте курсора
      const d = cur.dx - (s.cx + (s.cy - cur.dy) * TAN);
      const near = Math.exp(-(d * d) / (2 * 230 * 230)) * cur.on;
      // дрейф (живёт без курсора) + параллакс по глубине + ближние полосы тянутся к курсору
      const x = cur.nx * 72 * s.depth + Math.sin(t * 0.35 + s.phase) * 10 * s.depth + d * 0.12 * near;
      const sheen = -60 + cur.nx * 80 * s.depth + Math.sin(t * 0.5 + s.phase) * 18;
      const glow = Math.min(1.6, 0.45 + 0.35 * cur.on * (0.5 + 0.5 * Math.cos(t * 0.8 + s.phase)) + 0.55 * near);
      dyn.set([x, sheen * 0.02, glow, 0], i * 4);

      if (!layer && domStripes[i]) {
        domStripes[i].el.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
        domStripes[i].inner.style.setProperty('--sheen', `${sheen.toFixed(1)}%`);
        domStripes[i].inner.style.setProperty('--sheen-o', glow.toFixed(3));
      }
    });

    if (layer) {
      layer.gl.uniform4fv(layer.uniform('u_sDyn'), dyn);
      layer.gl.uniform4f(layer.uniform('u_light'), cur.dx, cur.dy, 450 / getCover(), cur.on);
      layer.draw();
    } else if (light) {
      light.style.transform = `translate3d(${cur.x.toFixed(1)}px,${cur.y.toFixed(1)}px,0)`;
      light.style.opacity = cur.on.toFixed(3);
    }
  };

  const api = {
    update(p: Pointer) {
      target.nx = p.inside ? p.nx : 0;
      target.x = p.x;
      target.y = p.y;
      target.dx = (p.x - p.w / 2) / p.cover + 800;
      target.dy = (p.y - p.h / 2) / p.cover + 450;
      target.on = p.inside ? 1 : 0;
      if (cur.on < 0.01 && p.inside) Object.assign(cur, { x: target.x, y: target.y, dx: target.dx, dy: target.dy });
    },
    resize() {
      if (!layer) return;
      layer.resize(getCover());
      frame(gsap.ticker.time);
    },
    start() {
      if (running) return;
      running = true;
      t0 = gsap.ticker.time;
      frame(t0); // первый кадр сразу, чтобы слайд не появился пустым
      gsap.ticker.add(frame);
    },
    stop() {
      running = false;
      gsap.ticker.remove(frame);
    },
  };
  api.resize(); // компиляция шейдера и первый кадр — заранее, ещё под прелоадером
  return api;
}
