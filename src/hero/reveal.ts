/**
 * Появление и уход интерфейса слайда. Тип анимации задаётся атрибутом data-anim:
 *   tag   — плашка «Москва, …»: строки шторкой слева направо
 *   parts — логотипы: каждая часть поднимается из-под «маски» (как буквы в промпте)
 *   lines — абзац: построчно из-под маски (SplitText)
 *   btn   — кнопка: подъём с небольшим масштабом
 */
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(SplitText);

const splits = new WeakMap<HTMLElement, SplitText>();

/** Разбить абзацы на строки один раз (после загрузки шрифтов). */
export function prepareLines(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-anim="lines"]').forEach((el) => {
    if (splits.has(el)) return;
    splits.set(el, new SplitText(el, { type: 'lines', mask: 'lines', linesClass: 'line' }));
  });
}

function items(slide: HTMLElement): HTMLElement[] {
  return Array.from(slide.querySelectorAll<HTMLElement>('.hero-content [data-anim]'));
}

/** Мгновенно спрятать интерфейс слайда (перед тем как он поедет внутрь). */
export function resetUI(slide: HTMLElement): void {
  items(slide).forEach((el) => {
    gsap.set(el, { autoAlpha: 1, y: 0 });
    switch (el.dataset.anim) {
      case 'tag':
        gsap.set(el.children, { clipPath: 'inset(0% 100% 0% 0%)' });
        break;
      case 'parts':
        gsap.set(el.children, { yPercent: 100, clipPath: 'inset(0% 0% 100% 0%)' });
        break;
      case 'lines': {
        const split = splits.get(el);
        if (split) gsap.set(split.lines, { yPercent: 105 });
        break;
      }
      case 'btn':
        gsap.set(el, { autoAlpha: 0, y: 24, scale: 0.94 });
        break;
    }
  });
}

export function revealUI(slide: HTMLElement): gsap.core.Timeline {
  resetUI(slide);
  const tl = gsap.timeline();
  items(slide).forEach((el, i) => {
    const at = i * 0.1;
    switch (el.dataset.anim) {
      case 'tag':
        tl.to(el.children, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.75, ease: 'power3.inOut', stagger: 0.1 }, at);
        break;
      case 'parts':
        // yPercent и clip-path двигаются синхронно → нижняя кромка стоит на месте, как у маски
        tl.to(el.children, { yPercent: 0, clipPath: 'inset(0% 0% 0% 0%)', duration: 0.9, ease: 'power3.out', stagger: 0.07 }, at);
        break;
      case 'lines': {
        const split = splits.get(el);
        if (split) tl.to(split.lines, { yPercent: 0, duration: 0.85, ease: 'power3.out', stagger: 0.08 }, at);
        break;
      }
      case 'btn':
        tl.to(el, { autoAlpha: 1, y: 0, scale: 1, duration: 0.9, ease: 'expo.out' }, at);
        break;
    }
  });
  return tl;
}

/** Уходящий слайд: тексты гаснут под полосами (как подпись в промпте). */
export function hideUI(slide: HTMLElement): gsap.core.Tween {
  return gsap.to(items(slide), { autoAlpha: 0, y: -6, duration: 0.35, ease: 'power2.in' });
}
