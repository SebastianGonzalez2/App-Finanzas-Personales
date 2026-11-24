import { describe, expect, it } from 'vitest';
import { cents, figureSize, money, percentage, signedMoney } from '../../src/features/stats/format.js';
import { budgetState } from '../../src/features/budgets/budgets.js';
import { compact } from '../../src/features/overview/OverviewPage.jsx';

// IMP-06 · Precisión monetaria en la presentación: las sumas pueden superar 2^53 centésimos
// (por ejemplo, mil gastos del importe máximo); el texto exacto del servidor se formatea sin
// pasar por Number.
describe('importes enormes y precisión', () => {
  it('formatea sumas de 18 dígitos sin redondeo de coma flotante', () => {
    expect(money('999999999999999000.01')).toBe('999.999.999.999.999.000,01');
    expect(Number('999999999999999000.01').toFixed(2)).not.toBe('999999999999999000.01');
    expect(signedMoney('-90071992547409.93')).toBe('−90.071.992.547.409,93');
    expect(cents('90071992547409.93') + 1n).toBe(9007199254740994n);
  });
  it('estado del presupuesto por centésimos exactos aun por encima de 2^53', () => {
    expect(budgetState({ spent: '90071992547409.93', monthly_limit: '90071992547409.92' }).key).toBe('over');
    expect(budgetState({ spent: '90071992547409.92', monthly_limit: '90071992547409.92' }).key).toBe('reached');
  });
  it('porcentajes con miles y signo', () => {
    expect(percentage('100000.00')).toBe('100.000%');
    expect(percentage('-0.50', { sign: true })).toBe('−0,50%');
    expect(percentage('0.00', { sign: true })).toBe('0%');
  });
  it('rótulos compactos y tamaño de importes largos', () => {
    expect(compact(1_000_000_008_599.99)).toBe('1.000MM');
    expect(compact(32_000)).toBe('32k');
    expect(figureSize('123.456,78')).toBeUndefined();
    expect(figureSize('1.234.567,89')).toBe('l');
    expect(figureSize('+12.345.678,90')).toBe('xl');
    expect(figureSize('999.999.999.999,99')).toBe('xxl');
  });
});
