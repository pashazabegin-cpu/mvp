/**
 * Progressive blur из макета: сверху резко, книзу размытие нарастает до max.
 *
 * <div data-pblur="50" data-pblur-from="0.5" data-pblur-to="0.9"> <img|video> </div>
 *   from/to — где размытие начинается и где достигает максимума (доли высоты блока).
 *
 * Картинки: поверх кладём несколько копий с filter: blur() и маской-градиентом —
 * статичный блюр кэшируется браузером и дёшево двигается вместе с блоком (магнит).
 * Видео: слои с backdrop-filter, потому что кадр всё равно меняется каждый раз.
 */

export function initProgressiveBlur(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-pblur]').forEach((box) => {
    const media = box.querySelector<HTMLImageElement | HTMLVideoElement>('img, video');
    if (!media) return;

    const max = Number(box.dataset.pblur);
    const from = Number(box.dataset.pblurFrom ?? 0.5);
    const to = Number(box.dataset.pblurTo ?? 1);
    const isVideo = media instanceof HTMLVideoElement;
    const steps = isVideo ? 3 : 4;

    for (let k = 1; k <= steps; k++) {
      const radius = max / 2 ** (steps - k);
      const start = (from + ((to - from) * (k - 1)) / steps) * 100;
      const end = (from + ((to - from) * k) / steps) * 100;
      const mask = `linear-gradient(to bottom, transparent ${start.toFixed(1)}%, #000 ${end.toFixed(1)}%)`;

      let layer: HTMLElement;
      if (isVideo) {
        layer = document.createElement('div');
        layer.style.backdropFilter = `blur(${radius}px)`;
        layer.style.setProperty('-webkit-backdrop-filter', `blur(${radius}px)`);
      } else {
        layer = media.cloneNode() as HTMLImageElement;
        layer.removeAttribute('alt');
        layer.setAttribute('aria-hidden', 'true');
        layer.style.filter = `blur(${radius}px)`;
      }
      layer.classList.add('pblur-layer');
      layer.style.maskImage = mask;
      layer.style.setProperty('-webkit-mask-image', mask);
      box.appendChild(layer);
    }
  });
}
