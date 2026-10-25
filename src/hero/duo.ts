/**
 * Слайд «Премия и форум» одним шейдером:
 *  - фон — рендер из Figma (без луча / с лучом), луч раскрывается кругом из точки внизу и «дышит»;
 *  - синий слой логотипа — честный Linear burn: max(0, фон + синий − 1);
 *  - розовый слой — Screen.
 * Оба логотипа двигаются за курсором и въезжают с разных сторон. Их положение и прозрачность
 * анимирует GSAP на невидимых HTML-элементах (.duo-logo), шейдер каждый кадр читает эти значения.
 * Пока текстуры не загружены или если WebGL недоступен — показывается HTML-версия.
 */
import { gsap } from 'gsap';
import { createGLLayer, GLSL_COMMON, loadImage, rasterize } from './gl';

// координаты холста 1600×900 (= кадр 1440 из Figma + 80 слева)
const BLUE = { x: 1045, y: 297.68, w: 328.16, h: 320.75, color: [0x34, 0xbc, 0xf7] };
const PINK = { x: 1069.93, y: 272.75, w: 328.16, h: 320.75, color: [0xfa, 0x32, 0x94] };
// точка, из которой растёт луч, и радиус до дальнего угла кадра (как у radial-gradient farthest-corner)
const RAY = { x: 769.56, y: 941.43, r: 1255.4 };

const FRAG = `${GLSL_COMMON}
uniform sampler2D u_base;
uniform sampler2D u_rayImg;
uniform sampler2D u_blueMask;
uniform sampler2D u_pinkMask;
uniform vec2 u_ray;       // прогресс раскрытия луча, яркость луча
uniform vec4 u_blue;      // смещение x, y, прозрачность
uniform vec4 u_pink;
uniform vec3 u_blueColor;
uniform vec3 u_pinkColor;

float logo(sampler2D mask, vec2 p, vec2 pos, vec2 size) {
  vec2 uv = (p - pos) / size;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture2D(mask, uv).a;
}

void main() {
  vec2 p = designPos();
  vec2 uv = p / vec2(1600.0, 900.0);
  vec3 col = texture2D(u_base, uv).rgb;

  float d = distance(p, vec2(${RAY.x.toFixed(1)}, ${RAY.y.toFixed(1)}));
  float inner = (u_ray.x * 1.35 - 0.35) * ${RAY.r.toFixed(1)};
  float outer = u_ray.x * 1.35 * ${RAY.r.toFixed(1)};
  float m = 1.0 - clamp((d - inner) / max(outer - inner, 1.0), 0.0, 1.0);
  col = mix(col, texture2D(u_rayImg, uv).rgb, m * u_ray.y);

  float b = logo(u_blueMask, p, vec2(${BLUE.x}, ${BLUE.y}) + u_blue.xy, vec2(${BLUE.w}, ${BLUE.h})) * u_blue.z;
  col = mix(col, max(col + u_blueColor - 1.0, 0.0), b);

  float k = logo(u_pinkMask, p, vec2(${PINK.x}, ${PINK.y}) + u_pink.xy, vec2(${PINK.w}, ${PINK.h})) * u_pink.z;
  col = mix(col, bScreen(col, u_pinkColor), k);

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createRays(slide: HTMLElement, getCover: () => number) {
  const canvas = slide.querySelector<HTMLCanvasElement>('canvas[data-gl]');
  const blue = slide.querySelector<HTMLElement>('.duo-logo--blue');
  const pink = slide.querySelector<HTMLElement>('.duo-logo--pink');
  const domRays = slide.querySelectorAll<HTMLElement>('[data-ray]');
  const domRoot = slide.querySelector<HTMLElement>('[data-ray-root]');
  const state = { ray: 1, rayOpacity: 1 };

  const setColors = () => {
    if (!layer) return;
    layer.gl.uniform3f(layer.uniform('u_blueColor'), BLUE.color[0] / 255, BLUE.color[1] / 255, BLUE.color[2] / 255);
    layer.gl.uniform3f(layer.uniform('u_pinkColor'), PINK.color[0] / 255, PINK.color[1] / 255, PINK.color[2] / 255);
  };
  const layer = canvas
    ? createGLLayer(canvas, FRAG, 2, {
        // браузер отобрал видеокарту — на время показываем HTML-версию; текстуры GL-слой зальёт заново сам
        onLost: () => slide.classList.remove('is-gl'),
        onRestored: () => {
          setColors();
          if (!ready) return;
          slide.classList.add('is-gl');
          layer!.resize(getCover());
          frame();
        },
      })
    : null;
  let ready = false;
  let running = false;
  let idle: gsap.core.Tween | null = null;

  const read = (el: HTMLElement | null, w: number, h: number) => {
    if (!el) return [0, 0, 1];
    const g = (p: string) => Number(gsap.getProperty(el, p)) || 0;
    return [g('x') + (g('xPercent') / 100) * w, g('y') + (g('yPercent') / 100) * h, Number(gsap.getProperty(el, 'opacity'))];
  };

  const frame = () => {
    if (!layer || !ready || !layer.alive) {
      // HTML-версия: маска луча через CSS-переменную, прозрачность — на картинках с лучом
      domRoot?.style.setProperty('--ray', state.ray.toFixed(4));
      domRays.forEach((el) => (el.style.opacity = String(state.rayOpacity)));
      return;
    }
    const { gl, uniform } = layer;
    gl.uniform2f(uniform('u_ray'), state.ray, state.rayOpacity);
    const b = read(blue, BLUE.w, BLUE.h);
    const k = read(pink, PINK.w, PINK.h);
    gl.uniform4f(uniform('u_blue'), b[0], b[1], b[2], 0);
    gl.uniform4f(uniform('u_pink'), k[0], k[1], k[2], 0);
    layer.draw();
  };

  if (layer) {
    setColors();
    // текстуры: data-tex-* на canvas (фон без луча, с лучом, формы логотипов)
    const tex = canvas!.dataset;
    Promise.all([
      loadImage(tex.texBase ?? ''),
      loadImage(tex.texRay ?? ''),
      rasterize(tex.texBlue ?? '', BLUE.w * 2, BLUE.h * 2),
      rasterize(tex.texPink ?? '', PINK.w * 2, PINK.h * 2),
    ])
      .then(([base, ray, blueMask, pinkMask]) => {
        layer.texture(0, 'u_base', base);
        layer.texture(1, 'u_rayImg', ray);
        layer.texture(2, 'u_blueMask', blueMask);
        layer.texture(3, 'u_pinkMask', pinkMask);
        ready = true;
        slide.classList.add('is-gl');
        layer.resize(getCover());
        frame(); // первый кадр заранее: шейдер и текстуры готовы до показа слайда
      })
      .catch((e) => console.warn('[hero duo] WebGL off, HTML fallback', e));
  }

  return {
    play(): gsap.core.Timeline {
      idle?.kill();
      const tl = gsap.timeline();
      tl.fromTo(state, { ray: 0, rayOpacity: 1 }, { ray: 1, duration: 2.6, ease: 'power2.out' }, 0.1);
      // два слоя логотипа съезжаются с разных сторон — видно, что это два отдельных слоя
      if (blue) tl.fromTo(blue, { xPercent: -9, yPercent: 6, autoAlpha: 0 }, { xPercent: 0, yPercent: 0, autoAlpha: 1, duration: 1.6, ease: 'expo.out' }, 0.15);
      if (pink) tl.fromTo(pink, { xPercent: 9, yPercent: -6, autoAlpha: 0 }, { xPercent: 0, yPercent: 0, autoAlpha: 1, duration: 1.6, ease: 'expo.out' }, 0.22);
      tl.add(() => {
        idle = gsap.to(state, { rayOpacity: 0.84, duration: 3.2, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      });
      frame();
      if (!running) {
        running = true;
        gsap.ticker.add(frame);
      }
      return tl;
    },
    stop() {
      idle?.kill();
      idle = null;
      state.rayOpacity = 1;
      running = false;
      gsap.ticker.remove(frame);
    },
    resize() {
      if (!layer || !ready) return;
      layer.resize(getCover());
      frame();
    },
  };
}
