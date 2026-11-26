import { describe, expect, it } from 'vitest';
import {
  assignCategoryColors,
  buildCumulativeMonthly,
  buildDonutSlices,
  buildPeriodComparisonFromExpenses,
  buildPeriodComparisonFromStats,
  DONUT_TICKS,
  donutPeriodCopy,
  formatCents,
  OTHER_SLICE_COLOR,
  percentChange,
  resolveAnnualComparison,
  resolveCustomComparison,
  resolveMonthlyComparison,
  shiftMonthKey,
} from '../../src/features/stats/insights.js';

describe('aritmética exacta en centésimos (BigInt)', () => {
  it('formatea centésimos y calcula porcentajes sin coma flotante', () => {
    expect(formatCents(0n)).toBe('0.00');
    expect(formatCents(30030n)).toBe('300.30');
    expect(formatCents(-34969n)).toBe('-349.69');
    expect(percentChange(60000n, 50000n)).toBe('20.00');
    expect(percentChange(30030n, 39999n)).toBe('-24.92');
    expect(percentChange(0n, 50000n)).toBe('-100.00');
    expect(percentChange(50000n, 0n)).toBeNull();
    expect(percentChange(50000n, 50000n)).toBe('0.00');
  });
});

describe('1) comparación entre períodos: resolución de tramos y categorías', () => {
  it('alinea al mismo tramo cuando incluye el mes en curso y respeta meses más cortos', () => {
    // Hoy 23 nov: 1–23 nov vs 1–23 oct
    const novOct = resolveMonthlyComparison('2026-11', '2026-10', '2026-11-23');
    expect(novOct.rangeA).toEqual({ from: '2026-11-01', to: '2026-11-23' });
    expect(novOct.rangeB).toEqual({ from: '2026-10-01', to: '2026-10-23' });
    expect(novOct.alignedPartial).toBe(true);
    expect(novOct.clamped).toBe(false);
    expect(novOct.isDefaultCurrentVsPrevious).toBe(true);

    // Hoy 30 mar vs febrero (28 días): limita febrero al 28 sin inventar días
    const marFeb = resolveMonthlyComparison('2026-03', '2026-02', '2026-03-30');
    expect(marFeb.rangeA).toEqual({ from: '2026-03-01', to: '2026-03-30' });
    expect(marFeb.rangeB).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(marFeb.alignedPartial).toBe(true);
    expect(marFeb.clamped).toBe(true);

    // Dos meses cerrados se comparan completos
    const octSep = resolveMonthlyComparison('2026-10', '2026-09', '2026-11-23');
    expect(octSep.rangeA).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(octSep.rangeB).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(octSep.alignedPartial).toBe(false);
  });

  it('alinea el año en curso al mismo día del año anterior (incluye bisiestos)', () => {
    const ytd = resolveAnnualComparison('2026', '2025', '2026-11-23');
    expect(ytd.rangeA).toEqual({ from: '2026-01-01', to: '2026-11-23' });
    expect(ytd.rangeB).toEqual({ from: '2025-01-01', to: '2025-11-23' });
    expect(ytd.alignedPartial).toBe(true);

    // 29 de febrero de año bisiesto vs año no bisiesto → 28 de febrero
    const leap = resolveAnnualComparison('2024', '2023', '2024-02-29');
    expect(leap.rangeA).toEqual({ from: '2024-01-01', to: '2024-02-29' });
    expect(leap.rangeB).toEqual({ from: '2023-01-01', to: '2023-02-28' });

    // Años cerrados: completos
    const closed = resolveAnnualComparison('2025', '2024', '2026-11-23');
    expect(closed.rangeA).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(closed.rangeB).toEqual({ from: '2024-01-01', to: '2024-12-31' });
    expect(closed.alignedPartial).toBe(false);
  });

  it('detecta duraciones distintas en rangos personalizados', () => {
    const custom = resolveCustomComparison(
      { from: '2026-11-01', to: '2026-11-10' },
      { from: '2026-10-01', to: '2026-10-20' },
    );
    expect(custom.daysA).toBe(10);
    expect(custom.daysB).toBe(20);
    expect(custom.differentDuration).toBe(true);
  });

  it('ordena categorías por mayor impacto absoluto y coincide entre list_expenses y get_stats', () => {
    const expenses = [
      { spent_on: '2026-11-02', currency: 'UYU', amount: '100.00', category_id: 'food', category_name: 'Alimentación' },
      { spent_on: '2026-11-10', currency: 'UYU', amount: '200.00', category_id: 'food', category_name: 'Alimentación' },
      { spent_on: '2026-11-20', currency: 'UYU', amount: '50.00', category_id: 'trans', category_name: 'Transporte' },
      { spent_on: '2026-10-01', currency: 'UYU', amount: '300.00', category_id: 'food', category_name: 'Alimentación' },
      { spent_on: '2026-10-15', currency: 'UYU', amount: '99.99', category_id: 'home', category_name: 'Vivienda' },
      // Fuera del tramo 1–23 oct: no debe incluirse
      { spent_on: '2026-10-31', currency: 'UYU', amount: '250.00', category_id: 'food', category_name: 'Alimentación' },
    ];
    const fromExpenses = buildPeriodComparisonFromExpenses(
      expenses,
      { from: '2026-11-01', to: '2026-11-23' },
      { from: '2026-10-01', to: '2026-10-23' },
      'UYU',
    );
    expect(fromExpenses.periodA).toMatchObject({ count: 3, total: '350.00' });
    expect(fromExpenses.periodB).toMatchObject({ count: 2, total: '399.99' });
    expect(fromExpenses.deltaText).toBe('-49.99');
    expect(fromExpenses.percentText).toBe('-12.50');
    // Vivienda (−99.99) tiene mayor impacto que Transporte (+50.00) y Alimentación (0.00)
    expect(fromExpenses.categories.map((c) => [c.id, c.deltaText, c.status])).toEqual([
      ['home', '-99.99', 'gone'],
      ['trans', '50.00', 'new'],
      ['food', '0.00', 'same'],
    ]);
    expect(fromExpenses.topIncrease.id).toBe('trans');
    expect(fromExpenses.topDecrease.id).toBe('home');

    const fromStats = buildPeriodComparisonFromStats({
      filters: { currency: 'UYU' },
      indicator: {
        current: { count: 3, total: '350.00' },
        reference: { count: 2, total: '399.99' },
      },
      category_comparisons: [
        { id: 'food', name: 'Alimentación', current: { count: 2, total: '300.00' }, reference: { count: 1, total: '300.00' } },
        { id: 'trans', name: 'Transporte', current: { count: 1, total: '50.00' }, reference: { count: 0, total: null } },
        { id: 'home', name: 'Vivienda', current: { count: 0, total: null }, reference: { count: 1, total: '99.99' } },
      ],
    });
    expect(fromStats).toEqual(fromExpenses);
  });
});

describe('2) evolución acumulada del gasto mensual', () => {
  const sampleExpenses = [
    { spent_on: '2026-11-02', currency: 'UYU', amount: '100.00', category_id: 'food' },
    { spent_on: '2026-11-10', currency: 'UYU', amount: '200.00', category_id: 'food' },
    { spent_on: '2026-11-20', currency: 'UYU', amount: '50.00', category_id: 'trans' },
    // Gasto futuro en noviembre (después de hoy 23): no entra en el acumulado actual
    { spent_on: '2026-11-28', currency: 'UYU', amount: '999.00', category_id: 'food' },
    { spent_on: '2026-10-01', currency: 'UYU', amount: '300.00', category_id: 'food' },
    { spent_on: '2026-10-15', currency: 'UYU', amount: '99.99', category_id: 'home' },
    { spent_on: '2026-10-31', currency: 'UYU', amount: '250.00', category_id: 'food' },
  ];

  it('acumula día a día, corta el mes actual en hoy y compara al mismo día manteniendo el mes B completo', () => {
    const series = buildCumulativeMonthly({
      expensesA: sampleExpenses,
      expensesB: sampleExpenses,
      monthA: '2026-11',
      monthB: '2026-10',
      today: '2026-11-23',
      currency: 'UYU',
    });

    expect(series.maxDays).toBe(31);
    expect(series.lastDayA).toBe(23);
    expect(series.compareDayB).toBe(23);
    expect(series.clampedB).toBe(false);
    expect(series.current).toMatchObject({ total: '350.00', count: 3 });
    expect(series.refAtSameDay).toMatchObject({ total: '399.99', count: 2 });
    expect(series.refFullMonth).toMatchObject({ total: '649.99', count: 3 });
    expect(series.deltaText).toBe('-49.99');
    expect(series.percentText).toBe('-12.50');

    // Día 10: nov lleva 300, oct lleva 300 → diferencia 0
    expect(series.points[9]).toMatchObject({ day: 10, cumAText: '300.00', cumBText: '300.00', deltaText: '0.00' });
    // Día 24: nov ya terminó en hoy (null), oct sigue hasta el 31
    expect(series.points[23]).toMatchObject({ day: 24, cumAText: null, cumBText: '399.99', deltaText: null });
    expect(series.points[30]).toMatchObject({ day: 31, cumAText: null, cumBText: '649.99' });
  });

  it('filtra por categoría y maneja meses comparados con menos días sin inventar datos', () => {
    const filtered = buildCumulativeMonthly({
      expensesA: sampleExpenses,
      expensesB: sampleExpenses,
      monthA: '2026-11',
      monthB: '2026-10',
      today: '2026-11-23',
      currency: 'UYU',
      categoryId: 'food',
    });
    expect(filtered.current).toMatchObject({ total: '300.00', count: 2 });
    expect(filtered.refAtSameDay).toMatchObject({ total: '300.00', count: 1 });
    expect(filtered.deltaText).toBe('0.00');

    const shorter = buildCumulativeMonthly({
      expensesA: [{ spent_on: '2026-03-30', currency: 'UYU', amount: '120.00', category_id: 'food' }],
      expensesB: [{ spent_on: '2026-02-28', currency: 'UYU', amount: '100.00', category_id: 'food' }],
      monthA: '2026-03',
      monthB: '2026-02',
      today: '2026-03-30',
      currency: 'UYU',
    });
    expect(shorter.lastDayA).toBe(30);
    expect(shorter.compareDayB).toBe(28);
    expect(shorter.clampedB).toBe(true);
    expect(shorter.points[28].cumBText).toBeNull(); // Día 29 no existe en feb 2026
    expect(shorter.deltaText).toBe('20.00');
    expect(shorter.percentText).toBe('20.00');
  });
});

describe('3) gráfico circular segmentado de Principales categorías', () => {
  it('reparte exactamente 72 marcas radiales y agrupa excedentes en «Otras»', () => {
    const seven = [
      { id: 'c1', name: 'Vivienda', count: 1, total: '5000.00', share: '50.00' },
      { id: 'c2', name: 'Alimentación', count: 3, total: '2500.00', share: '25.00' },
      { id: 'c3', name: 'Transporte', count: 2, total: '1200.00', share: '12.00' },
      { id: 'c4', name: 'Servicios', count: 1, total: '800.00', share: '8.00' },
      { id: 'c5', name: 'Salud', count: 1, total: '300.00', share: '3.00' },
      { id: 'c6', name: 'Ocio', count: 1, total: '150.00', share: '1.50' },
      { id: 'c7', name: 'Otros', count: 1, total: '50.00', share: '0.50' },
    ];
    const slices = buildDonutSlices(seven, '10000.00');
    expect(slices).toHaveLength(6); // top 5 + Otras (2)
    expect(slices.at(-1)).toMatchObject({
      id: '__other__',
      name: 'Otras (2)',
      isOther: true,
      count: 2,
      total: '200.00',
      share: '2.00',
    });
    const totalTicks = slices.reduce((sum, slice) => sum + slice.tickCount, 0);
    expect(totalTicks).toBe(DONUT_TICKS);
    expect(slices.every((slice) => slice.tickCount >= 1)).toBe(true);
    expect(slices.at(-1).endTick).toBe(DONUT_TICKS);
  });

  it('soporta una única categoría (100 %) y lista vacía', () => {
    const single = buildDonutSlices(
      [{ id: 'c1', name: 'Alimentación', count: 1, total: '1280.00', share: '100.00' }],
      '1280.00',
    );
    expect(single).toHaveLength(1);
    expect(single[0].tickCount).toBe(DONUT_TICKS);
    expect(buildDonutSlices([], null)).toEqual([]);
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
  });

  it('asigna colores consistentes por id y preserva las categorías agrupadas en «Otras»', () => {
    const setA = [
      { id: 'cat-food', name: 'Alimentación', count: 2, total: '500.00', share: '50.00' },
      { id: 'cat-home', name: 'Vivienda', count: 1, total: '300.00', share: '30.00' },
      { id: 'cat-trans', name: 'Transporte', count: 1, total: '200.00', share: '20.00' },
    ];
    const setB = [
      { id: 'cat-trans', name: 'Transporte', count: 3, total: '700.00', share: '70.00' },
      { id: 'cat-food', name: 'Alimentación', count: 1, total: '300.00', share: '30.00' },
    ];
    const slicesA = buildDonutSlices(setA, '1000.00');
    const slicesB = buildDonutSlices(setB, '1000.00');
    expect(slicesA.find((s) => s.id === 'cat-food').color).toBe(slicesB.find((s) => s.id === 'cat-food').color);
    expect(slicesA.find((s) => s.id === 'cat-trans').color).toBe(slicesB.find((s) => s.id === 'cat-trans').color);

    const colors = assignCategoryColors([{ id: '__none__' }]);
    expect(colors.get('__none__')).toBe(OTHER_SLICE_COLOR);

    const seven = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i + 1}`,
      name: `Cat ${i + 1}`,
      count: 1,
      total: '100.00',
      share: '14.29',
    }));
    const grouped = buildDonutSlices(seven, '700.00');
    expect(grouped.at(-1).restItems.map((item) => item.id)).toEqual(['c6', 'c7']);
  });

  it('adapta los textos del gráfico circular al período seleccionado', () => {
    expect(donutPeriodCopy({ period: 'mes', range: { from: '2026-11-01', to: '2026-11-30' } }, 'UYU')).toEqual({
      eyebrow: 'Importe en UYU · % del mes',
      centerEyebrow: 'Total del mes',
      shareSuffix: 'del mes',
      legendLabel: 'Categorías del mes',
    });
    expect(donutPeriodCopy({ period: 'anio', range: { from: '2026-01-01', to: '2026-12-31' } }, 'USD')).toEqual({
      eyebrow: 'Importe en USD · % del año',
      centerEyebrow: 'Total 2026',
      shareSuffix: 'del año',
      legendLabel: 'Categorías del año',
    });
    expect(donutPeriodCopy({ period: 'personalizado', range: { from: '2026-01-10', to: '2026-03-15' } }, 'EUR')).toEqual({
      eyebrow: 'Importe en EUR · % del período',
      centerEyebrow: 'Total del período',
      shareSuffix: 'del período',
      legendLabel: 'Categorías del período',
    });
  });
});
