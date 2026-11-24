import { describe, expect, it } from 'vitest';
import { listArgs, readBack, readQuery } from '../../src/features/history/query.js';
import { cents, compactAxis, expensesCount, money, percentage, signedMoney } from '../../src/features/stats/format.js';
import { categoryFilters, childFilters, historyHref, periodFilters, yearFilters } from '../../src/features/stats/links.js';
import {
  annualArgs, defaultReference, presetRange, rangeShort, rangeTitle, readStatsQuery, statsArgs, writeStatsQuery,
} from '../../src/features/stats/query.js';
import { describeStats } from '../../src/features/stats/summary.js';

const TODAY = '2026-11-23';
const read = (search, today = TODAY) => readStatsQuery(new URLSearchParams(search), today);
const FOOD = '00000000-0000-4000-8000-000000000010';
const MARKET = '00000000-0000-4000-8000-000000000011';

describe('períodos de Estadísticas (ARCH-01 §9)', () => {
  it('calcula los preajustes en el calendario civil, con cambio de año', () => {
    expect(presetRange('mes', TODAY)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(presetRange('mes-anterior', TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('3m', TODAY)).toEqual({ from: '2026-09-01', to: '2026-11-30' });
    expect(presetRange('6m', TODAY)).toEqual({ from: '2026-06-01', to: '2026-11-30' });
    expect(presetRange('12m', TODAY)).toEqual({ from: '2025-12-01', to: '2026-11-30' });
    expect(presetRange('anio', TODAY)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(presetRange('mes-anterior', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('mes', '2024-02-10')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(presetRange('3m', '2026-02-01')).toEqual({ from: '2025-12-01', to: '2026-02-28' });
  });

  it('propone la referencia: bloque anterior de igual número de meses, año anterior o N días previos', () => {
    expect(defaultReference('mes', presetRange('mes', TODAY))).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(defaultReference('mes-anterior', presetRange('mes-anterior', TODAY))).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(defaultReference('6m', presetRange('6m', TODAY))).toEqual({ from: '2025-12-01', to: '2026-05-31' });
    expect(defaultReference('12m', presetRange('12m', TODAY))).toEqual({ from: '2024-12-01', to: '2025-11-30' });
    expect(defaultReference('anio', presetRange('anio', TODAY))).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(defaultReference('personalizado', { from: '2026-03-01', to: '2026-03-10' })).toEqual({ from: '2026-02-19', to: '2026-02-28' });
    expect(defaultReference('personalizado', { from: '2024-03-01', to: '2024-03-01' })).toEqual({ from: '2024-02-29', to: '2024-02-29' });
    expect(defaultReference('personalizado', { from: '0001-01-01', to: '0001-01-05' })).toBeNull();
    expect(defaultReference('anio', { from: '0001-01-01', to: '0001-12-31' })).toBeNull();
    expect(defaultReference('mes', { from: '0001-01-01', to: '0001-01-31' })).toBeNull();
  });

  it('lee y escribe la URL con valores por defecto omitidos y descarta valores inválidos', () => {
    const initial = read('');
    expect(initial).toMatchObject({ period: 'mes', range: { from: '2026-11-01', to: '2026-11-30' },
      reference: { from: '2026-10-01', to: '2026-10-31' }, customReference: false, category: '', subcategory: '', breakdown: '',
      annualEnd: null, view: 'todas' });
    expect(writeStatsQuery(initial).toString()).toBe('');
    const full = read(`vista=favoritos&periodo=6m&ref-desde=2025-01-01&ref-hasta=2025-06-30&categoria=${FOOD}&subcategoria=${MARKET}&anual=2021`);
    expect(full).toMatchObject({ view: 'favoritos', period: '6m', customReference: true, reference: { from: '2025-01-01', to: '2025-06-30' },
      category: FOOD, subcategory: MARKET, annualEnd: 2021 });
    expect(read(writeStatsQuery(full).toString())).toEqual(full);
    const custom = read('desde=2016-12-15&hasta=2026-11-23&periodo=3m');
    expect(custom).toMatchObject({ period: 'personalizado', range: { from: '2016-12-15', to: '2026-11-23' } });
    expect(writeStatsQuery(custom).toString()).toBe('desde=2016-12-15&hasta=2026-11-23');
    for (const search of ['periodo=7m', 'desde=2026-02-30&hasta=2026-03-01', 'desde=2026-12-01&hasta=2026-11-01', 'desde=2026-11-01',
      'categoria=x', `subcategoria=${MARKET}`, 'anual=0', 'anual=2026', 'anual=2027', 'anual=abc', 'vista=otra',
      'ref-desde=2026-01-01', 'ref-desde=2026-02-01&ref-hasta=2026-01-01']) {
      const parsed = read(search);
      expect(parsed.period === 'mes' || search.startsWith('periodo')).toBe(true);
      expect(writeStatsQuery(parsed).toString(), search).toBe('');
    }
    expect(read(`categoria=${FOOD}&desglose=${MARKET}`).breakdown).toBe('');
    expect(read(`desglose=${FOOD}`).breakdown).toBe(FOOD);
  });

  it('la ventana anual es independiente del período general', () => {
    const older = read('anual=2021');
    for (const period of ['mes', 'mes-anterior', '3m', '6m', '12m', 'anio']) {
      const changed = read(writeStatsQuery({ ...older, period, range: presetRange(period, TODAY), reference: null }).toString());
      expect(annualArgs(changed, 'UYU')).toEqual({ currency: 'UYU', end_year: 2021, category_id: null, subcategory_id: null });
    }
    expect(annualArgs(read(`anual=2021&categoria=${FOOD}&subcategoria=${MARKET}`), 'EUR'))
      .toEqual({ currency: 'EUR', end_year: 2021, category_id: FOOD, subcategory_id: MARKET });
  });

  it('construye los argumentos exactos de get_stats', () => {
    expect(statsArgs(read(`periodo=12m&categoria=${FOOD}`), 'USD')).toEqual({
      filters: { from: '2025-12-01', to: '2026-11-30', currency: 'USD', category_id: FOOD },
      reference: { from: '2024-12-01', to: '2025-11-30' }, month_offset: 0,
    });
    expect(statsArgs(read(''), 'UYU', 60).month_offset).toBe(60);
  });

  it('rotula los períodos como UI-01', () => {
    expect(rangeTitle({ from: '2026-05-01', to: '2026-10-31' })).toBe('Del 1 de mayo al 31 de octubre de 2026');
    expect(rangeTitle({ from: '2025-12-01', to: '2026-11-30' })).toBe('Del 1 de diciembre de 2025 al 30 de noviembre de 2026');
    expect(rangeShort({ from: '2026-05-01', to: '2026-10-31' })).toBe('May — Oct 2026');
    expect(rangeShort({ from: '2026-11-01', to: '2026-11-30' })).toBe('Nov 2026');
    expect(rangeShort({ from: '2025-12-01', to: '2026-11-30' })).toBe('Dic 2025 — Nov 2026');
    expect(rangeShort({ from: '2026-01-01', to: '2026-12-31' })).toBe('2026');
    expect(rangeShort({ from: '2016-12-15', to: '2026-11-23' })).toBe('15/12/2016 – 23/11/2026');
  });
});

describe('formato de importes y porcentajes exactos', () => {
  it('presenta el decimal del servidor con dos decimales sin pasar por Number', () => {
    expect(money('999999999999.99')).toBe('999.999.999.999,99');
    expect(money('0.30')).toBe('0,30');
    expect(signedMoney('-299.70')).toBe('−299,70');
    expect(signedMoney('1000.00')).toBe('+1.000,00');
    expect(signedMoney('0.00')).toBe('0,00');
    expect(percentage('62.50')).toBe('62,50%');
    expect(percentage('20.00', { sign: true })).toBe('+20%');
    expect(percentage('-10.00', { sign: true })).toBe('−10%');
    expect(percentage('1550.17', { sign: true })).toBe('+1.550,17%');
    expect(percentage('0.00', { sign: true })).toBe('0%');
    expect(cents('0.10') + cents('0.20')).toBe(cents('0.30'));
    expect(cents('-60.00')).toBe(-6000n);
    expect(expensesCount(1)).toBe('1 gasto');
    expect(expensesCount(1234)).toBe('1.234 gastos');
    expect(compactAxis(40000)).toBe('40k');
    expect(compactAxis(2500000)).toBe('2,5M');
    expect(compactAxis(5000)).toBe('5.000');
  });
});

describe('enlaces al Historial con los filtros exactos del agregado', () => {
  const back = '/estadisticas?periodo=6m&anual=2021';
  const filters = { from: '2025-12-01', to: '2026-11-30', currency: 'UYU', category_id: null, subcategory_id: null, unclassified_child: false };
  const args = (href) => {
    const params = new URLSearchParams(href.split('?')[1]);
    return { list: listArgs(readQuery(params)), back: readBack(params) };
  };

  it('traduce cada agregado a list_expenses y conserva la vuelta a Estadísticas', () => {
    expect(args(historyHref(filters, back))).toEqual({
      list: { filters: { from: '2025-12-01', to: '2026-11-30', currency: 'UYU' }, q: null, sort: 'spent_on', direction: 'desc' }, back,
    });
    const month = periodFilters(filters, { from: '2026-10-01', to: '2026-10-31' });
    expect(args(historyHref(month, back)).list.filters).toEqual({ from: '2026-10-01', to: '2026-10-31', currency: 'UYU' });
    expect(args(historyHref(categoryFilters(filters, FOOD), back)).list.filters).toEqual({ from: filters.from, to: filters.to, currency: 'UYU', category_id: FOOD });
    expect(args(historyHref(childFilters(filters, FOOD, MARKET), back)).list.filters)
      .toEqual({ from: filters.from, to: filters.to, currency: 'UYU', category_id: FOOD, subcategory_id: MARKET });
    expect(args(historyHref(childFilters(filters, FOOD, null), back)).list.filters)
      .toEqual({ from: filters.from, to: filters.to, currency: 'UYU', category_id: FOOD, unclassified_child: true });
    expect(args(historyHref(yearFilters({ currency: 'EUR', category_id: FOOD, subcategory_id: MARKET }, 2024), back)).list.filters)
      .toEqual({ from: '2024-01-01', to: '2024-12-31', currency: 'EUR', category_id: FOOD, subcategory_id: MARKET });
    expect(args(historyHref(yearFilters({ currency: 'USD', category_id: null, subcategory_id: null }, 7), back)).list.filters)
      .toEqual({ from: '0007-01-01', to: '0007-12-31', currency: 'USD' });
  });

  it('solo acepta como vuelta una ruta interna de Estadísticas', () => {
    for (const value of ['https://example.test/estadisticas', '//example.test', '/historial', '/estadisticas/../x', '/estadisticasx',
      '/estadisticas?x#y', '/estadisticas?\\evil', 'javascript:alert(1)']) {
      expect(readBack(new URLSearchParams({ volver: value })), value).toBe('');
    }
    expect(readBack(new URLSearchParams({ volver: '/estadisticas' }))).toBe('/estadisticas');
    expect(readBack(new URLSearchParams({ volver: '/estadisticas?vista=favoritos&anual=2021' }))).toBe('/estadisticas?vista=favoritos&anual=2021');
  });
});

describe('resumen inteligente determinista', () => {
  const base = (patch = {}) => ({
    filters: { from: '2026-05-01', to: '2026-10-31', currency: 'UYU', category_id: null, subcategory_id: null, unclassified_child: false },
    reference: { from: '2025-11-01', to: '2026-04-30' }, comparable: true,
    indicator: { current: { count: 144, total: '168000.00' }, reference: { count: 120, total: '150000.00' }, delta: '18000.00', percent: '12.00' },
    months: [['05', '23600.00'], ['06', '27200.00'], ['07', '24800.00'], ['08', '30400.00'], ['09', '30000.00'], ['10', '32000.00']]
      .map(([month, total]) => ({ month: '2026-' + month, from: `2026-${month}-01`, to: `2026-${month}-${['06', '09'].includes(month) ? '30' : '31'}`, count: 20, total })),
    month_next_offset: null,
    categories: [{ id: FOOD, name: 'Alimentación', count: 70, total: '75600.00', share: '45.00' },
      { id: 'b', name: 'Vivienda', count: 6, total: '55200.00', share: '32.86' }],
    children: [], category_comparisons: [],
    ...patch,
  });
  const text = (data) => {
    const { headline, lines } = describeStats(data, TODAY);
    return [headline && headline.before + headline.strong + headline.after, ...lines].filter(Boolean);
  };

  it('describe el ejemplo de UI-01 con valores del servidor', () => {
    expect(text(base())).toEqual([
      'Alimentación concentró el 45% del gasto registrado.',
      'En el período registraste 144 gastos por UYU 168.000,00.',
      'El total aumentó UYU 18.000,00 frente al período de referencia (UYU 150.000,00), una variación de +12%.',
      'El mes de mayor gasto fue octubre de 2026, con UYU 32.000,00.',
      'En los 6 meses cerrados, de mayo de 2026 a octubre de 2026, el gasto subió y bajó sin una tendencia sostenida.',
    ]);
  });

  it('identifica empates y no inventa porcentajes no comparables', () => {
    const tied = base({
      categories: [{ id: 'a', name: 'Alimentación', count: 2, total: '500.00', share: '50.00' }, { id: 'b', name: 'Transporte', count: 1, total: '500.00', share: '50.00' }],
      comparable: false, indicator: { current: { count: 3, total: '1000.00' }, reference: { count: 1, total: '1200.00' }, delta: '-200.00', percent: null },
      filters: { ...base().filters, from: '2026-11-01', to: '2026-11-30' }, reference: { from: '2026-10-01', to: '2026-10-31' },
      months: [{ month: '2026-11', from: '2026-11-01', to: '2026-11-30', count: 3, total: '1000.00' }],
    });
    expect(text(tied)).toEqual([
      'Alimentación y Transporte empatan como categorías de mayor gasto, con UYU 500,00 y el 50% del total cada una.',
      'En el período registraste 3 gastos por UYU 1.000,00.',
      'El total disminuyó UYU 200,00 frente al período de referencia (UYU 1.200,00). La variación porcentual no se calcula porque uno de los períodos sigue en curso.',
      'No hay datos suficientes para describir una tendencia: hacen falta al menos tres meses cerrados con registros.',
    ]);
  });

  it('explica la falta de base, la tendencia sostenida y el período vacío', () => {
    const rising = base({
      indicator: { current: { count: 3, total: '600.00' }, reference: { count: 0, total: null }, delta: null, percent: null },
      months: base().months.slice(0, 3).map((month, index) => ({ ...month, count: 1, total: ['100.00', '200.00', '300.00'][index] })),
      categories: [{ id: FOOD, name: 'Alimentación', count: 3, total: '600.00', share: '100.00' }],
    });
    expect(text(rising)).toEqual([
      'Todo el gasto registrado corresponde a Alimentación.',
      'En el período registraste 3 gastos por UYU 600,00.',
      'El período de referencia no tiene gastos registrados en UYU, así que no hay base para comparar.',
      'El mes de mayor gasto fue julio de 2026, con UYU 300,00.',
      'El gasto aumentó en cada uno de los 3 meses cerrados, de mayo de 2026 a julio de 2026.',
    ]);
    const gap = base({ months: base().months.map((month, index) => index === 2 ? { ...month, count: 0, total: null } : month) });
    expect(text(gap).at(-1)).toBe('No hay datos suficientes para describir una tendencia: hacen falta al menos tres meses cerrados con registros.');
    const empty = base({ indicator: { current: { count: 0, total: null }, reference: { count: 4, total: '10.00' }, delta: null, percent: null }, categories: [] });
    expect(describeStats(empty, TODAY)).toEqual({ headline: null, lines: ['No hay gastos registrados en UYU en este período.'] });
  });

  it('dentro de una categoría describe sus subcategorías, incluida «Sin subcategoría»', () => {
    const scoped = base({
      filters: { ...base().filters, category_id: FOOD },
      categories: [{ id: FOOD, name: 'Alimentación', count: 3, total: '350.00', share: '100.00' }],
      children: [{ id: null, name: null, count: 1, total: '200.00', share: '57.14' }, { id: MARKET, name: 'Supermercado', count: 2, total: '150.00', share: '42.86' }],
    });
    expect(text(scoped)[0]).toBe('Sin subcategoría concentró el 57,14% del gasto de Alimentación.');
    const lone = base({ ...scoped, filters: scoped.filters, categories: scoped.categories, children: [{ id: null, name: null, count: 3, total: '350.00', share: '100.00' }] });
    expect(text(lone)[0]).toBe('Ningún gasto de Alimentación tiene subcategoría.');
  });
});
