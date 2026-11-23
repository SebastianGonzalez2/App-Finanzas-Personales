import { describe, expect, it } from 'vitest';
import {
  changeField, expensePayload, newDraft, normalizeAmount, normalizeName, validDate, validateDraft,
} from '../../src/features/expenses/draft.js';

describe('importe exacto', () => {
  it.each([
    ['0,01', '0.01'], ['00012,3', '12.30'], [' 12.00 ', '12.00'], ['9', '9.00'],
    ['999999999999,99', '999999999999.99'],
  ])('normaliza %s', (input, expected) => expect(normalizeAmount(input)).toBe(expected));
  it.each(['0', '-1', '', null, '0.00', '2.001', '1e4', 'NaN', 'Infinity', '1.234,56', '1000000000000'])(
    'rechaza %s', (input) => expect(normalizeAmount(input)).toBeNull(),
  );
});

describe('fecha civil', () => {
  it.each(['0001-01-01', '2000-02-29', '2024-02-29', '9999-12-31'])(
    'acepta %s', (input) => expect(validDate(input)).toBe(true),
  );
  it.each(['0000-01-01', '1900-02-29', '2025-02-29', '2020-02-30', '2025-04-31', '2026-13-01', '2026-10-00', '2026-1-03', ''])(
    'rechaza %s', (input) => expect(validDate(input)).toBe(false),
  );
});

describe('catálogo y borradores', () => {
  const preferences = { currency: 'EUR', today: '2026-11-23' };
  const catalog = {
    categories: [{ id: 'a', archived: false }, { id: 'b', archived: true }],
    subcategories: [
      { id: 'a1', category_id: 'a', archived: true }, { id: 'b1', category_id: 'b', archived: false },
      { id: 'b2', category_id: 'b', archived: false },
    ],
  };
  const draft = { ...newDraft(preferences), amount: '2,4', category_id: 'a' };

  it('compacta espacios, conserva el nombre visible y respeta 80 caracteres Unicode', () => {
    expect(normalizeName('  Café\t con   leche  ')).toBe('Café con leche');
    expect(normalizeName('x'.repeat(81))).toBe('');
    expect(normalizeName('🌽'.repeat(80))).toBe('🌽'.repeat(80));
    expect(normalizeName('   ')).toBe('');
  });
  it('inicia dos altas independientes con la preferencia y el día civil del servidor', () => {
    expect(draft).toMatchObject({ currency: 'EUR', spent_on: '2026-11-23' });
    expect(draft.id).not.toBe(newDraft(preferences).id);
  });
  it('cambiar de categoría limpia la hija y conserva UUID y campos del borrador', () => {
    expect(changeField({ ...draft, subcategory_id: 'a1' }, 'category_id', 'b'))
      .toEqual({ ...draft, category_id: 'b', subcategory_id: '' });
  });
  it('prepara decimales textuales, descripción recortada y opcionales nulos', () => {
    expect(expensePayload(draft)).toMatchObject({ id: draft.id, amount: '2.40', description: null, subcategory_id: null });
    expect(expensePayload({ ...draft, description: '  Feria  ' }).description).toBe('Feria');
  });
  it('rechaza mezclar padres, hijas, archivadas y moneda desconocida', () => {
    expect(validateDraft(draft, catalog)).toEqual({});
    expect(validateDraft({ ...draft, category_id: '' }, catalog)).toHaveProperty('category_id');
    for (const child of ['b1', 'a1']) {
      expect(validateDraft({ ...draft, subcategory_id: child }, catalog)).toHaveProperty('subcategory_id');
    }
    expect(validateDraft({ ...draft, category_id: 'b' }, catalog)).toHaveProperty('category_id');
    expect(validateDraft({ ...draft, currency: 'GBP' }, catalog)).toHaveProperty('currency');
    expect(validateDraft({ ...draft, description: 'x'.repeat(501) }, catalog)).toHaveProperty('description');
  });
  it('admite conservar la clasificación histórica o quitar la hija, y rechaza asignar otra', () => {
    const item = { ...draft, amount: '2.40', category_id: 'b', subcategory_id: 'b1' };
    const edit = newDraft(preferences, item);
    expect(edit.id).toBe(item.id);
    expect(validateDraft(edit, catalog, item)).toEqual({});
    expect(validateDraft({ ...edit, subcategory_id: '' }, catalog, item)).toEqual({});
    expect(validateDraft({ ...edit, subcategory_id: 'b2' }, catalog, item)).toHaveProperty('subcategory_id');
  });
});
