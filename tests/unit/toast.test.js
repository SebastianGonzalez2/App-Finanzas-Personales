import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  appendToast,
  catalogToastMessage,
  createToastEntry,
  DEFAULT_TOAST_DURATION,
  MAX_VISIBLE_TOASTS,
  normalizeVariant,
  toastAriaProps,
  TOAST_VARIANTS,
} from '../../src/app/toastContext.js';

const css = readFileSync(new URL('../../src/components/ToastViewport.css', import.meta.url), 'utf8');

describe('sistema global de toasts', () => {
  it('usa 4 segundos por defecto y normaliza las cuatro variantes', () => {
    expect(DEFAULT_TOAST_DURATION).toBe(4000);
    expect(TOAST_VARIANTS).toEqual(['success', 'error', 'warning', 'info']);
    for (const variant of TOAST_VARIANTS) {
      expect(normalizeVariant(variant)).toBe(variant);
    }
    expect(normalizeVariant('otra')).toBe('info');
    expect(normalizeVariant(undefined)).toBe('info');
  });

  it('asigna propiedades ARIA adecuadas según la severidad de la variante', () => {
    expect(toastAriaProps('success')).toEqual({ role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    expect(toastAriaProps('info')).toEqual({ role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    expect(toastAriaProps('error')).toEqual({ role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'true' });
    expect(toastAriaProps('warning')).toEqual({ role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'true' });
  });

  it('crea entradas válidas y descarta mensajes vacíos', () => {
    expect(createToastEntry(1, '')).toBeNull();
    expect(createToastEntry(1, { message: '   ' })).toBeNull();
    expect(createToastEntry(2, {
      message: '  Gasto guardado  ',
      variant: 'success',
      action: { label: 'Ver gasto', to: '/gastos/123/editar' },
    })).toEqual({
      id: 2,
      variant: 'success',
      message: 'Gasto guardado',
      action: { label: 'Ver gasto', to: '/gastos/123/editar' },
      duration: 4000,
      exiting: false,
    });
  });

  it('limita la pila visible al máximo configurado conservando las más recientes', () => {
    let list = [];
    for (let i = 1; i <= MAX_VISIBLE_TOASTS + 2; i += 1) {
      list = appendToast(list, createToastEntry(i, { message: `Aviso ${i}`, variant: 'success' }));
    }
    expect(list.map((item) => item.id)).toEqual([3, 4, 5]);
  });

  it('genera el mensaje exacto para todas las operaciones de categorías y subcategorías', () => {
    expect(catalogToastMessage('category', null, { name: 'Viajes' })).toBe('Categoría creada');
    expect(catalogToastMessage('category', { id: '1' }, { name: 'Viajes cortos' })).toBe('Categoría actualizada');
    expect(catalogToastMessage('category', { id: '1' }, { archived: true })).toBe('Categoría archivada');
    expect(catalogToastMessage('category', { id: '1' }, { archived: false })).toBe('Categoría restaurada');

    expect(catalogToastMessage('subcategory', null, { name: 'Vuelos' })).toBe('Subcategoría creada');
    expect(catalogToastMessage('subcategory', { id: '2' }, { name: 'Pasajes' })).toBe('Subcategoría actualizada');
    expect(catalogToastMessage('subcategory', { id: '2' }, { archived: true })).toBe('Subcategoría archivada');
    expect(catalogToastMessage('subcategory', { id: '2' }, { archived: false })).toBe('Subcategoría restaurada');
  });

  it('define variantes coherentes, centrado en el área principal, reduced-motion y área táctil móvil', () => {
    expect(css).toMatch(/\.toast-viewport\s*\{[\s\S]*position:\s*fixed;[\s\S]*pointer-events:\s*none;/);
    expect(css).toMatch(/body:has\(\.shell\)\s*\.toast-viewport\s*\{\s*--toast-rail:\s*224px;/);
    expect(css).toMatch(/body:has\(\.shell\.compact\)\s*\.toast-viewport\s*\{\s*--toast-rail:\s*72px;/);
    expect(css).toMatch(/\.toast\s*\{[\s\S]*pointer-events:\s*auto;[\s\S]*font-family:\s*var\(--sans\);/);
    for (const variant of TOAST_VARIANTS) {
      expect(css).toContain(`.toast--${variant}`);
    }
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/\.toast-close\s*\{\s*width:\s*44px;\s*height:\s*44px;/);
  });
});
