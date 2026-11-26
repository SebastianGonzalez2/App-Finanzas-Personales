import { describe, expect, it } from 'vitest';
import {
  computeCurrencyTotals,
  computePreviewNextDate,
  formatBillingDay,
  formatNextBillingDate,
  validateRecurringDraft,
} from '../../src/features/recurring/recurring.js';

describe('pagos recurrentes · cálculos y validaciones en cliente', () => {
  it('calcula totales mensuales separados por moneda sin conversiones y con precisión exacta', () => {
    const items = [
      { currency: 'USD', amount: '7.99' },
      { currency: 'UYU', amount: '1500.00' },
      { currency: 'USD', amount: '12.01' },
      { currency: 'UYU', amount: '90071992547409.00' },
    ];
    expect(computeCurrencyTotals(items)).toEqual([
      { currency: 'UYU', total: '90071992548909.00', count: 2 },
      { currency: 'USD', total: '20.00', count: 2 },
    ]);
    expect(computeCurrencyTotals([])).toEqual([]);
  });

  it('calcula la próxima fecha considerando el mismo día, días pasados, meses cortos, bisiestos y cambio de año', () => {
    // Mismo día de cobro: se registra hoy
    expect(computePreviewNextDate(23, '2026-11-23')).toBe('2026-11-23');
    // Día ya pasado en el mes: pasa al mes siguiente
    expect(computePreviewNextDate(15, '2026-11-23')).toBe('2026-12-15');
    // Día 31 en noviembre (30 días): último día del mes
    expect(computePreviewNextDate(31, '2026-11-01')).toBe('2026-11-30');
    // Cambio de año diciembre -> enero
    expect(computePreviewNextDate(5, '2026-12-10')).toBe('2027-01-05');
    // Febrero no bisiesto vs bisiesto
    expect(computePreviewNextDate(30, '2026-01-31')).toBe('2026-02-28');
    expect(computePreviewNextDate(30, '2024-01-31')).toBe('2024-02-29');
  });

  it('formatea día de cobro y próxima fecha', () => {
    expect(formatBillingDay(15)).toBe('Día 15 de cada mes');
    expect(formatBillingDay(31)).toBe('Día 31 (o fin de mes)');
    expect(formatNextBillingDate('2026-11-23', '2026-11-23')).toBe('23/11/2026 · hoy');
    expect(formatNextBillingDate('2026-12-05', '2026-11-23')).toBe('05/12/2026');
  });

  it('valida campos requeridos y clasificaciones activas', () => {
    const catalog = {
      categories: [
        { id: 'c1', name: 'Servicios', archived: false },
        { id: 'c2', name: 'Archivada', archived: true },
      ],
      subcategories: [
        { id: 's1', category_id: 'c1', name: 'Streaming', archived: false },
        { id: 's2', category_id: 'c1', name: 'Vieja', archived: true },
      ],
    };

    expect(validateRecurringDraft({
      name: '  ', amount: '0', currency: 'ARS', category_id: 'c2', subcategory_id: 's2', billing_day: '32',
    }, catalog)).toMatchObject({
      name: expect.any(String),
      amount: expect.any(String),
      currency: expect.any(String),
      category_id: expect.any(String),
      subcategory_id: expect.any(String),
      billing_day: expect.any(String),
    });

    expect(validateRecurringDraft({
      name: 'Spotify', amount: '7,99', currency: 'USD', category_id: 'c1', subcategory_id: 's1', billing_day: '15',
    }, catalog)).toEqual({});
  });
});
