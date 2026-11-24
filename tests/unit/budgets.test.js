import { describe, expect, it } from 'vitest';
import { barWidth, budgetMargin, budgetState, countsLine, monthTitle, normalizeLimit } from '../../src/features/budgets/budgets.js';
import { overviewArgs } from '../../src/features/overview/OverviewPage.jsx';
import { readStatsQuery, statsArgs } from '../../src/features/stats/query.js';

const item = (spent, monthly_limit, remaining, percent) => ({ spent, monthly_limit, remaining, percent });

describe('IMP-05 · estados de presupuesto (UI-01)', () => {
  it('umbrales exactos en centésimos, no sobre el porcentaje redondeado', () => {
    expect(budgetState(item('0.00', '500.00')).label).toBe('Dentro del límite');
    expect(budgetState(item('5000.00', '15000.00')).label).toBe('Dentro del límite');
    // 89,99 % → dentro; 90 % exacto → cerca.
    expect(budgetState(item('8999.00', '10000.00')).label).toBe('Dentro del límite');
    expect(budgetState(item('9000.00', '10000.00')).label).toBe('Cerca del límite');
    expect(budgetState(item('9600.00', '10000.00')).label).toBe('Cerca del límite');
    // 99,999 % se muestra «100%» pero aún no alcanzó el límite.
    expect(budgetState(item('99999.99', '100000.00')).label).toBe('Cerca del límite');
    expect(budgetState(item('3600.00', '3600.00')).label).toBe('Límite alcanzado');
    expect(budgetState(item('3600.01', '3600.00')).label).toBe('Superado');
    expect(budgetState(item('3840.00', '3600.00'))).toEqual({ key: 'over', label: 'Superado', tone: 'neg' });
  });

  it('restante o exceso a partir de remaining, sin recalcular', () => {
    expect(budgetMargin(item('5000.00', '15000.00', '10000.00'))).toEqual({ over: false, label: 'Restante', amount: '10000.00' });
    expect(budgetMargin(item('3840.00', '3600.00', '-240.00'))).toEqual({ over: true, label: 'Exceso', amount: '240.00' });
    expect(budgetMargin(item('3600.00', '3600.00', '0.00'))).toEqual({ over: false, label: 'Restante', amount: '0.00' });
  });

  it('la barra se satura al 100 % y conserva el porcentaje real en el texto', () => {
    expect(barWidth('106.67')).toBe(100);
    expect(barWidth('33.33')).toBe(33.33);
    expect(barWidth('0.00')).toBe(0);
  });

  it('conteos, mes y límite tecleado', () => {
    expect(countsLine([item('3840.00', '3600.00'), item('1.00', '2.00'), item('0.00', '1.00')])).toBe('3 límites activos · 1 superado');
    expect(countsLine([item('0.00', '1.00')])).toBe('1 límite activo');
    expect(monthTitle('2026-11')).toBe('Noviembre de 2026');
    expect(monthTitle('2027-01-15')).toBe('Enero de 2027');
    // Sin separadores de miles (ARCH-01 §5): «15.000» tiene tres decimales y se rechaza.
    expect(normalizeLimit('15.000')).toBeNull();
    expect(normalizeLimit('15000.5')).toBe('15000.50');
    expect(normalizeLimit('15000,5')).toBe('15000.50');
    for (const invalid of ['0', '0,00', '-1', '1,234', 'abc', '', '1000000000000']) expect(normalizeLimit(invalid)).toBeNull();
  });
});

describe('IMP-05 · argumentos del Resumen', () => {
  it('mes actual y seis meses usan exactamente las claves de Estadísticas', () => {
    const args = overviewArgs('2026-11-23', 'UYU');
    expect(args.month).toEqual(statsArgs(readStatsQuery(new URLSearchParams(), '2026-11-23'), 'UYU'));
    expect(args.month).toEqual({ filters: { from: '2026-11-01', to: '2026-11-30', currency: 'UYU' },
      reference: { from: '2026-10-01', to: '2026-10-31' }, month_offset: 0 });
    expect(args.six.filters).toEqual({ from: '2026-06-01', to: '2026-11-30', currency: 'UYU' });
    expect(args.recent).toEqual({ filters: { from: '2026-11-01', to: '2026-11-30', currency: 'UYU' }, q: null,
      sort: 'spent_on', direction: 'desc', limit: 5, cursor: null });
  });

  it('seis meses cruzan el cambio de año y febrero bisiesto', () => {
    const january = overviewArgs('2027-01-05', 'EUR');
    expect(january.six.filters).toEqual({ from: '2026-08-01', to: '2027-01-31', currency: 'EUR' });
    expect(january.month.reference).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(overviewArgs('2028-02-29', 'USD').month.filters).toEqual({ from: '2028-02-01', to: '2028-02-29', currency: 'USD' });
  });
});
