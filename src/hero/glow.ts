/**
 * Светящиеся эллипсы из макета (в Figma это эллипсы с Gaussian blur 200–300px).
 * Живой SVG-фильтр такого радиуса тяжёлый, поэтому рисуем то же самое радиальным
 * градиентом с профилем настоящего гауссова размытия — выглядит так же, стоит ноль.
 *
 * <i data-glow="x y w h sigma color [opacity] [blend]"></i>  — координаты эллипса в px макета.
 */

function erf(x: number): number {
  // аппроксимация Абрамовица–Стиган, точности хватает с запасом
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function initGlows(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-glow]').forEach((el) => {
    const [x, y, w, h, sigma, color, opacity = '1', blend] = (el.dataset.glow ?? '').trim().split(/\s+/);
    const s = Number(sigma);
    const pad = 2.2 * s;
    const r = (Number(w) + Number(h)) / 4;
    const reach = r + pad;
    const [cr, cg, cb] = hexToRgb(color);

    const stops: string[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const d = t * reach;
      const v = 0.5 * (erf((r - d) / (s * Math.SQRT2)) + erf((r + d) / (s * Math.SQRT2)));
      stops.push(`rgba(${cr},${cg},${cb},${Math.max(0, v).toFixed(3)}) ${(t * 100).toFixed(1)}%`);
    }

    Object.assign(el.style, {
      left: `${Number(x) - pad}px`,
      top: `${Number(y) - pad}px`,
      width: `${Number(w) + 2 * pad}px`,
      height: `${Number(h) + 2 * pad}px`,
      background: `radial-gradient(closest-side, ${stops.join(', ')})`,
      opacity,
      mixBlendMode: blend ?? '',
    });
  });
}
