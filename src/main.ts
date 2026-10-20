import './hero/hero.css';
import './demo.css';
import { gsap } from 'gsap';
import { initHero } from './hero';

const hero = document.querySelector<HTMLElement>('[data-hero]');
const params = new URLSearchParams(location.search);
if (params.has('nopreload')) hero?.querySelector('[data-hero-preloader]')?.remove();

const api = hero
  ? initHero(hero, {
      // демо: ?slide=3 — сразу перейти на слайд, ?pause — без автопрокрутки
      onReady() {
        if (params.has('pause')) api?.pause();
        const slide = Number(params.get('slide'));
        if (slide) api?.goTo(slide);
      },
      onChange() {
        if (params.has('pause')) requestAnimationFrame(() => api?.pause());
      },
    })
  : null;

// демо: ?static — мгновенно доигрывать все анимации (для скриншотов/сверки с макетом)
if (params.has('static')) {
  setInterval(() => {
    gsap.globalTimeline.getChildren(false, true, true).forEach((t) => {
      if (!t.paused() && t.totalDuration() < 30) t.progress(1);
    });
  }, 100);
}

// для отладки в консоли: __hero.goTo(3)
if (import.meta.env.DEV) Object.assign(window, { __hero: api, gsap });
