/**
 * Переход «полосами» из промпта (parallax-strip-slider), переписанный без React
 * и без клонирования слайда: вместо 10 копий картинки — одна маска clip-path: polygon(),
 * в которой N наклонных полос. Так переход работает для любого содержимого слайда
 * (видео, интерактивные слои, backdrop-filter) и стоит одну перерисовку маски за кадр.
 *
 * Полосы наклонены на angle градусов (наклон «/», как «лесенки» на слайде «Рейтинг»).
 */

/** Видимая часть каждой полосы: [начало, конец] в долях ширины полосы (0…1). */
export type StripSpan = [number, number];

export function stripsPolygon(width: number, height: number, spans: StripSpan[], angleDeg: number): string {
  // горизонтальный сдвиг верха/низа полосы относительно её середины
  const shift = (height / 2) * Math.tan((angleDeg * Math.PI) / 180);
  const reach = Math.abs(shift);
  const stripWidth = (width + 2 * reach) / spans.length;
  const points: string[] = [];

  spans.forEach(([from, to], i) => {
    if (to - from <= 0.0005) return;
    const start = -reach + i * stripWidth;
    // полпикселя внахлёст, чтобы между соседними полосами не было шва
    const a = start + from * stripWidth - 0.5;
    const b = start + to * stripWidth + 0.5;
    // обход: низ-лево → верх-лево → верх-право → низ-право; соседние полосы соединяются
    // по нижней кромке (нулевая площадь), поэтому вся маска — один многоугольник
    points.push(
      `${(a - shift).toFixed(1)}px ${height}px`,
      `${(a + shift).toFixed(1)}px 0px`,
      `${(b + shift).toFixed(1)}px 0px`,
      `${(b - shift).toFixed(1)}px ${height}px`,
    );
  });

  return points.length ? `polygon(${points.join(',')})` : 'polygon(0 0, 0 0, 0 0)';
}

export type StripMode = 'reveal-next' | 'reveal-prev' | 'hide-next';

/** Значения прогресса полос (0…1) → видимые отрезки для нужного режима. */
export function spansFor(progress: number[], mode: StripMode): StripSpan[] {
  switch (mode) {
    case 'reveal-next': return progress.map((p) => [0, p]);      // открываются слева направо
    case 'reveal-prev': return progress.map((p) => [1 - p, 1]);  // открываются справа налево
    case 'hide-next': return progress.map((p) => [p, 1]);        // закрываются слева направо
  }
}
