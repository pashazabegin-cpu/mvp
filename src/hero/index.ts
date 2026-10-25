/**
 * MVP — первый экран.
 *
 *   import { initHero } from './hero';
 *   initHero(document.querySelector('[data-hero]')!);
 *
 * Работает поверх серверной разметки (см. index.html): прелоадер → интро первого слайда →
 * автопрокрутка по 7 с с прогрессом в навигации → переход наклонными полосами.
 */
import { gsap } from 'gsap';
import { stripsPolygon, spansFor, type StripMode } from './strips';
import { initGlows } from './glow';
import { initProgressiveBlur } from './progressive-blur';
import { prepareLines, revealUI, hideUI, resetUI } from './reveal';
import { createMagnets, reducedMotion, type Pointer } from './effects';
import { createStripes } from './rating';
import { createRays } from './duo';
import { runPreloader } from './preloader';

export interface HeroOptions {
  /** длительность слайда, мс (по умолчанию data-autoplay или 7000) */
  autoplay?: number;
  /** наклон полос перехода, градусы (по умолчанию data-angle или 16.76) */
  angle?: number;
  /** параметры перехода — те же, что в промпте parallax-strip-slider */
  stripCount?: number;
  revealDuration?: number;
  stripStagger?: number;
  zoomFrom?: number;
  zoomDuration?: number;
  /** вызывается, когда прелоадер ушёл и интро закончилось */
  onReady?: () => void;
  /** вызывается при каждой смене слайда */
  onChange?: (index: number) => void;
}

type Dir = 'next' | 'prev';

/** Мобильная раскладка (кадр 320×700): вертикальные экраны. Тот же запрос — в hero.css. */
export const MOBILE_QUERY = '(max-aspect-ratio: 4/5)';

export function initHero(root: HTMLElement, options: HeroOptions = {}) {
  const o = {
    autoplay: Number(root.dataset.autoplay ?? 7000),
    angle: Number(root.dataset.angle ?? 16.76),
    stripCount: 10,
    revealDuration: 0.5,
    stripStagger: 0.04,
    zoomFrom: 1.2,
    zoomDuration: 0.9,
    ...options,
  };
  const reduce = reducedMotion();

  /* ── масштаб ──
     Десктоп: фон — холст 1600×900 (кадр 1440 из Figma + по 80 запаса с боков) по «cover»;
     интерфейс — кадр 1440×900 целиком влезает в экран, а по ширине тянется сетка (14 колонок, поля 60).
     Мобильный: кадр 320×700, фон и интерфейс в одном масштабе, интерфейс тоже тянется по ширине. */
  let cover = 1;
  const mobileQuery = window.matchMedia(MOBILE_QUERY);
  let mobile = mobileQuery.matches;
  const onFit: Array<() => void> = [];
  const slideEls = Array.from(root.querySelectorAll<HTMLElement>('.hero-slide'));
  const fit = () => {
    if (mobileQuery.matches !== mobile) switchLayout(mobileQuery.matches);
    const w = root.clientWidth;
    const h = root.clientHeight;
    const s = mobile ? Math.min(w / 320, h / 700) : Math.min(w / 1440, h / 900);
    cover = mobile ? s : Math.max(w / 1600, h / 900);
    root.style.setProperty('--hero-cover', cover.toFixed(4));
    root.style.setProperty('--ui-s', s.toFixed(4));
    root.style.setProperty('--ui-w', `${(w / s).toFixed(2)}px`);
    root.style.setProperty('--ui-h', `${(h / s).toFixed(2)}px`);
    // на вертикальном экране в десктопной раскладке кадрируем фон не по центру, а по data-focus (x в px холста)
    const maxShift = mobile ? 0 : Math.max(0, (1600 * cover - w) / 2);
    slideEls.forEach((el) => {
      const focus = Number(el.dataset.focus ?? 800);
      const shift = w < h ? Math.max(-maxShift, Math.min(maxShift, (800 - focus) * cover)) : 0;
      el.style.setProperty('--hero-shift', `${shift.toFixed(1)}px`);
    });
    onFit.forEach((f) => f());
  };
  fit();
  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(root);

  initGlows(root);
  initProgressiveBlur(root);

  const slides = slideEls.map((el) => ({
    el,
    zoom: el.querySelector<HTMLElement>('.hero-slide__zoom')!,
    video: el.querySelector<HTMLVideoElement>('video[data-hero-video]'),
    accent: el.dataset.accent ?? '#31a8f3',
    magnets: createMagnets(el, () => cover),
    stripes: null as ReturnType<typeof createStripes> | null,
    rays: null as ReturnType<typeof createRays> | null,
  }));
  // WebGL-слои («Рейтинг», «Премия и форум») — только в десктопной раскладке; на мобильном там картинки
  const ensureGL = () => {
    if (mobile) return;
    slides.forEach((s) => {
      if (!s.stripes && s.el.querySelector('[data-stripes]')) {
        s.stripes = createStripes(s.el, () => cover);
        onFit.push(s.stripes.resize);
      }
      if (!s.rays && s.el.querySelector('[data-ray]')) {
        s.rays = createRays(s.el, () => cover);
        onFit.push(s.rays.resize);
      }
    });
  };
  ensureGL();
  const count = slides.length;

  // заранее декодируем картинки слайдов, чтобы большие фоны не «вспыхивали» при первом показе
  const decodeSlide = (el: HTMLElement) => {
    el.querySelectorAll('img').forEach((img) => { img.decode?.().catch(() => {}); });
  };
  const navItems = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-goto]'));
  const preloaderEl = root.querySelector<HTMLElement>('[data-hero-preloader]');

  let current = 0;
  let incoming = -1;
  let busy = false;
  let started = false;
  let inView = true;
  let progress: gsap.core.Tween | null = null;

  /* ── курсор ── */
  const pointer: Pointer = { dx: 0, dy: 0, nx: 0, ny: 0, x: 0, y: 0, w: 1, h: 1, cover: 1, inside: false };
  const updatePointer = () => {
    [current, incoming].forEach((i) => {
      if (i < 0) return;
      slides[i].magnets.update(pointer);
      slides[i].stripes?.update(pointer);
    });
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const r = root.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
    pointer.w = r.width;
    pointer.h = r.height;
    pointer.cover = cover;
    pointer.dx = pointer.x - r.width / 2;
    pointer.dy = pointer.y - r.height / 2;
    pointer.nx = pointer.dx / (r.width / 2);
    pointer.ny = pointer.dy / (r.height / 2);
    pointer.inside = true;
    updatePointer();
  };
  const onPointerLeave = () => {
    pointer.inside = false;
    updatePointer();
  };
  // слушаем всегда (тач отсекается по pointerType в onPointerMove): если страница открылась на таче или в мобильной
  // эмуляции, а потом появилась мышь (планшет с тачпадом, переключение эмуляции), магнит всё равно включится
  if (!reduce) {
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerleave', onPointerLeave);
  }

  /* ── жизненный цикл слайда ── */
  const startGL = (i: number) => {
    if (mobile) return;
    slides[i].stripes?.start();
    if (!reduce) slides[i].rays?.play();
  };
  const stopGL = (i: number) => {
    slides[i].stripes?.stop();
    slides[i].rays?.stop();
  };
  const enter = (i: number) => {
    const s = slides[i];
    if (s.video) {
      s.video.currentTime = 0;
      if (inView) s.video.play().catch(() => {});
    }
    startGL(i);
    s.magnets.update(pointer);
    s.stripes?.update(pointer);
  };
  const leave = (i: number) => {
    slides[i].video?.pause();
    stopGL(i);
  };
  // поворот планшета и т. п.: при уходе в мобильную раскладку шейдеры останавливаются, при возврате — создаются и идут дальше
  function switchLayout(toMobile: boolean) {
    mobile = toMobile;
    if (mobile) {
      stopGL(current);
    } else {
      ensureGL();
      if (started) startGL(current);
    }
  }
  const onLayoutChange = () => fit();
  mobileQuery.addEventListener('change', onLayoutChange);

  /* ── навигация и прогресс ── */
  const setActiveNav = (i: number) => {
    navItems.forEach((b, j) => {
      const active = j === i;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-current', active ? 'true' : 'false');
      if (!active) gsap.to(b, { '--p': 0, duration: 0.45, ease: 'power2.out', overwrite: true });
    });
    gsap.to(root, { '--accent': slides[i].accent, duration: 0.6, ease: 'power2.out' });
  };

  const runProgress = (i: number) => {
    progress?.kill();
    const item = navItems[i];
    if (!item) return;
    progress = gsap.fromTo(
      item,
      { '--p': 0 },
      { '--p': 1, duration: o.autoplay / 1000, ease: 'none', overwrite: true, onComplete: () => go(i + 1, 'next') },
    );
    if (!inView) progress.pause();
  };

  /* ── переход ── */
  function go(target: number, dir: Dir) {
    const next = (target + count) % count;
    if (!started || busy || next === current) return;
    busy = true;

    const from = slides[current];
    const to = slides[next];
    const fromIndex = current;
    incoming = next;

    setActiveNav(next);
    runProgress(next);
    o.onChange?.(next);
    resetUI(to.el);
    decodeSlide(to.el);
    to.el.classList.add('is-incoming');
    enter(next);

    const settle = () => {
      to.el.style.clipPath = '';
      to.el.classList.remove('is-incoming');
      to.el.classList.add('is-current');
      from.el.classList.remove('is-current');
      gsap.set(from.zoom, { scale: 1 });
      leave(fromIndex);
      current = next;
      incoming = -1;
      busy = false;
    };

    if (reduce) {
      gsap.fromTo(to.el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, onComplete: () => { gsap.set(to.el, { clearProps: 'opacity,visibility' }); settle(); } });
      revealUI(to.el).progress(1);
      return;
    }

    const w = root.clientWidth;
    const h = root.clientHeight;
    const strips = Array.from({ length: o.stripCount }, () => ({ p: 0 }));
    const mode: StripMode = dir === 'next' ? 'reveal-next' : 'reveal-prev';
    const render = () => {
      to.el.style.clipPath = stripsPolygon(w, h, spansFor(strips.map((s) => s.p), mode), o.angle);
    };
    render();

    const tl = gsap.timeline({ onComplete: settle });
    tl.to(dir === 'next' ? strips : [...strips].reverse(), {
      p: 1,
      duration: o.revealDuration,
      ease: 'power3.out',
      stagger: o.stripStagger,
      onUpdate: render,
    }, 0);
    tl.fromTo(to.zoom, { scale: o.zoomFrom }, { scale: 1, duration: o.zoomDuration, ease: 'power3.out' }, 0);
    tl.add(hideUI(from.el), 0.15);
    tl.call(() => { revealUI(to.el); }, [], 0.45);
  }

  const onNavClick = (e: Event) => {
    const i = Number((e.currentTarget as HTMLElement).dataset.goto);
    if (i !== current) go(i, i > current ? 'next' : 'prev');
  };
  navItems.forEach((b) => b.addEventListener('click', onNavClick));

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(current + 1, 'next');
    if (e.key === 'ArrowLeft') go(current - 1, 'prev');
  };
  root.addEventListener('keydown', onKey);

  // свайп на тач-устройствах
  let swipeX = 0;
  const onDown = (e: PointerEvent) => { if (e.pointerType !== 'mouse') swipeX = e.clientX; };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || !swipeX) return;
    const dx = e.clientX - swipeX;
    swipeX = 0;
    if (Math.abs(dx) > 50) go(current + (dx < 0 ? 1 : -1), dx < 0 ? 'next' : 'prev');
  };
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointerup', onUp);

  // пауза, когда экран ушёл из вида
  const io = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (inView) {
      progress?.resume();
      const v = slides[current].video;
      if (started && v && !v.ended) v.play().catch(() => {});
    } else {
      progress?.pause();
      slides.forEach((s) => s.video?.pause());
    }
  }, { threshold: 0.15 });
  io.observe(root);

  /* ── старт: прелоадер → интро ── */
  const intro = async () => {
    const first = slides[0];
    first.el.classList.add('is-current');
    resetUI(first.el);
    setActiveNav(0);

    const removePreloader = await runPreloader(preloaderEl, first.video);
    slides.forEach((s) => decodeSlide(s.el));
    prepareLines(root);
    resetUI(first.el);
    enter(0);
    // видео остальных слайдов начинают грузиться только сейчас, чтобы не отнимать канал у первого
    root.querySelectorAll<HTMLVideoElement>('video[data-deferred]').forEach((v) => {
      v.preload = 'auto';
      v.load();
    });
    root.classList.add('is-ready');

    const chrome = root.querySelector<HTMLElement>('.hero-chrome');
    const intro = gsap.timeline({ defaults: { ease: 'expo.out' } });

    if (preloaderEl && !reduce) {
      const strips = Array.from({ length: o.stripCount }, () => ({ p: 0 }));
      const render = () => {
        preloaderEl.style.clipPath = stripsPolygon(root.clientWidth, root.clientHeight, spansFor(strips.map((s) => s.p), 'hide-next'), o.angle);
      };
      intro.to(strips, { p: 1, duration: 0.8, ease: 'power3.inOut', stagger: 0.05, onUpdate: render, onComplete: removePreloader }, 0);
    } else {
      removePreloader();
    }

    intro.fromTo(first.zoom, { scale: 1.22 }, { scale: 1, duration: 2.4 }, 0);
    intro.call(() => { revealUI(first.el); }, [], 0.45);

    if (chrome) {
      const mark = chrome.querySelector('[data-intro="mark"]');
      intro.from(chrome.querySelectorAll('[data-intro]:not([data-intro="mark"])'), { autoAlpha: 0, y: -16, duration: 1.2, stagger: 0.07 }, 0.55);
      if (mark) intro.from(mark.children, { autoAlpha: 0, x: (i: number) => (i === 1 ? -18 : 18), duration: 1.3, stagger: 0.08 }, 0.6);
      intro.from(chrome.querySelectorAll('.hero-nav__bar'), { scaleX: 0, transformOrigin: '0% 50%', duration: 1.2, ease: 'power3.inOut', stagger: 0.08 }, 0.7);
      intro.from(chrome.querySelectorAll('.hero-nav__label'), { autoAlpha: 0, y: 10, duration: 1, stagger: 0.08 }, 0.9);
    }

    intro.call(() => {
      started = true;
      runProgress(0);
    }, [], 1.3);
    // после интро возвращаем шапку под управление CSS (ховеры)
    intro.eventCallback('onComplete', () => {
      if (chrome) gsap.set(chrome.querySelectorAll('[data-intro], [data-intro] > span, .hero-nav__bar, .hero-nav__label'), { clearProps: 'transform,opacity,visibility' });
      o.onReady?.();
    });
  };
  intro();

  return {
    next: () => go(current + 1, 'next'),
    prev: () => go(current - 1, 'prev'),
    goTo: (i: number) => go(i, i > current ? 'next' : 'prev'),
    /** остановить/продолжить автопрокрутку (например, пока открыта модалка) */
    pause: () => progress?.pause(),
    play: () => progress?.resume(),
    destroy() {
      progress?.kill();
      slides.forEach((_, i) => leave(i));
      resizeObserver.disconnect();
      mobileQuery.removeEventListener('change', onLayoutChange);
      io.disconnect();
      navItems.forEach((b) => b.removeEventListener('click', onNavClick));
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerleave', onPointerLeave);
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointerup', onUp);
    },
  };
}
