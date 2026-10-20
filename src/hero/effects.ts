/**
 * Интерактив внутри слайдов:
 *  - magnetic: слой тянется за курсором (data-magnetic="сила")
 *  - stripes:  «лесенки» рейтинга сдвигаются с разной глубиной и переливаются
 *  - rays:     луч на «Премии и форуме» вырастает из одной точки и «дышит»
 */
import { gsap } from 'gsap';

export interface Pointer {
  /** смещение курсора от центра экрана, px экрана */
  dx: number;
  dy: number;
  /** то же в долях полуширины/полувысоты, -1…1 */
  nx: number;
  ny: number;
  /** позиция внутри hero, px экрана */
  x: number;
  y: number;
  /** размер hero и масштаб холста 1600×900 — чтобы перевести курсор в координаты макета */
  w: number;
  h: number;
  cover: number;
  inside: boolean;
}

export const canHover = (): boolean => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── магнит ─────────────────────────────────────────────── */

export function createMagnets(slide: HTMLElement, getCover: () => number) {
  const magnets = Array.from(slide.querySelectorAll<HTMLElement>('[data-magnetic]')).map((el) => ({
    k: Number(el.dataset.magnetic),
    x: gsap.quickTo(el, 'x', { duration: 1.1, ease: 'power3' }),
    y: gsap.quickTo(el, 'y', { duration: 1.1, ease: 'power3' }),
  }));
  return {
    update(p: Pointer) {
      // элементы лежат в масштабированном холсте → переводим смещение в px макета
      const c = getCover();
      magnets.forEach((m) => {
        m.x(p.inside ? (p.dx * m.k) / c : 0);
        m.y(p.inside ? (p.dy * m.k) / c : 0);
      });
    },
  };
}
