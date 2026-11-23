import { describe, expect, it } from 'vitest';
import {
  activeFilters, isFiltered, listArgs, listTitle, NO_CHILD, periodOf, periods, readQuery, rowDate, rowTitle, writeQuery,
} from '../../src/features/history/query.js';

const cat = '3f1c2a8e-6b0d-4e7a-9c11-2b4d5e6f7a80';
const sub = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const read = (search) => readQuery(new URLSearchParams(search));

describe('consulta del historial en la URL', () => {
  it('parte de fecha descendente sin filtros', () => {
    const query = read('');
    expect(query).toEqual({ q: '', from: '', to: '', currency: '', category: '', subcategory: '', sort: 'spent_on', direction: 'desc' });
    expect(listArgs(query)).toEqual({ filters: {}, q: null, sort: 'spent_on', direction: 'desc' });
    expect(writeQuery(query).toString()).toBe('');
    expect(isFiltered(query)).toBe(false);
  });

  it('ida y vuelta de todos los filtros combinados', () => {
    const search = `q=caf%C3%A9+100%25&desde=2026-11-01&hasta=2026-11-30&moneda=USD&categoria=${cat}&subcategoria=${sub}&orden=importe&sentido=asc`;
    const query = read(search);
    expect(query).toMatchObject({ q: 'café 100%', currency: 'USD', category: cat, subcategory: sub, sort: 'amount', direction: 'asc' });
    expect(new URLSearchParams(writeQuery(query)).toString()).toBe(new URLSearchParams(search).toString());
    expect(listArgs(query)).toEqual({
      filters: { from: '2026-11-01', to: '2026-11-30', currency: 'USD', category_id: cat, subcategory_id: sub },
      q: 'café 100%', sort: 'amount', direction: 'asc',
    });
    expect(activeFilters(query)).toBe(4);
  });

  it('«Sin subcategoría» se traduce a unclassified_child', () => {
    const query = read(`categoria=${cat}&subcategoria=${NO_CHILD}`);
    expect(listArgs(query).filters).toEqual({ category_id: cat, unclassified_child: true });
  });

  it.each([
    ['desde=2026-02-30', { from: '' }], ['moneda=ARS', { currency: '' }], ['categoria=1;drop', { category: '' }],
    [`subcategoria=${sub}`, { subcategory: '' }], ['orden=descripcion&sentido=arriba', { sort: 'spent_on', direction: 'desc' }],
    ['desde=2026-12-01&hasta=2026-11-01', { from: '', to: '2026-11-01' }], ['q=' + 'x'.repeat(140), { q: 'x'.repeat(100) }],
  ])('descarta valores inválidos de un enlace: %s', (search, expected) => {
    expect(read(search)).toMatchObject(expected);
  });

  it('una búsqueda de espacios no filtra', () => {
    const query = read('q=%20%20');
    expect(listArgs(query).q).toBeNull();
    expect(isFiltered(query)).toBe(false);
    expect(writeQuery(query).has('q')).toBe(false);
  });
});

describe('períodos de calendario', () => {
  const today = '2026-11-23';
  it('cubren los límites del mes, año y últimos meses', () => {
    const byValue = Object.fromEntries(periods(today).map((period) => [period.value, period]));
    expect(byValue.mes).toMatchObject({ from: '2026-11-01', to: '2026-11-30', label: 'Noviembre 2026' });
    expect(byValue['mes-anterior']).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(byValue['3m']).toMatchObject({ from: '2026-09-01', to: '2026-11-30' });
    expect(byValue['12m']).toMatchObject({ from: '2025-12-01', to: '2026-11-30' });
    expect(byValue.anio).toMatchObject({ from: '2026-01-01', to: '2026-12-31' });
  });
  it('cruzan el cambio de año y febrero bisiesto', () => {
    const byValue = Object.fromEntries(periods('2024-03-05').map((period) => [period.value, period]));
    expect(byValue['mes-anterior']).toMatchObject({ from: '2024-02-01', to: '2024-02-29', title: 'Gastos de febrero' });
    const january = Object.fromEntries(periods('2027-01-10').map((period) => [period.value, period]));
    expect(january['mes-anterior']).toMatchObject({ from: '2026-12-01', to: '2026-12-31', title: 'Gastos de diciembre 2026' });
    expect(periods('2025-03-01').find((p) => p.value === 'mes-anterior').to).toBe('2025-02-28');
  });
  it('titulan la lista según el período o el rango', () => {
    expect(listTitle(read(''), today)).toBe('Todos los gastos');
    expect(listTitle(read('desde=2026-11-01&hasta=2026-11-30'), today)).toBe('Gastos de noviembre');
    expect(periodOf(read('desde=2026-11-01&hasta=2026-11-30'), today).value).toBe('mes');
    expect(listTitle(read('desde=2026-11-02&hasta=2026-11-30'), today)).toBe('Gastos del 02/11/2026 al 30/11/2026');
    expect(listTitle(read('desde=2026-11-02'), today)).toBe('Gastos desde el 02/11/2026');
    expect(listTitle(read('hasta=2026-11-02'), today)).toBe('Gastos hasta el 02/11/2026');
  });
});

describe('filas', () => {
  it('usan la clasificación como título si falta la descripción', () => {
    expect(rowTitle({ description: 'Feria', subcategory_name: 'Super', category_name: 'Alimentación' })).toBe('Feria');
    expect(rowTitle({ description: null, subcategory_name: 'Super', category_name: 'Alimentación' })).toBe('Super');
    expect(rowTitle({ description: null, subcategory_name: null, category_name: 'Alimentación' })).toBe('Alimentación');
  });
  it('abrevian la fecha y muestran el año cuando no es el actual', () => {
    expect(rowDate('2026-11-03', '2026-11-23')).toBe('3 nov');
    expect(rowDate('2025-01-31', '2026-11-23')).toBe('31 ene 2025');
    expect(rowDate('2026-11-03', '2026-11-23', true)).toBe('3 nov 2026');
  });
});
