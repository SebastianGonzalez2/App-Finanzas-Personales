import { useQuery } from '@tanstack/react-query';
import { normalizeAmount } from '../expenses/draft.js';
import { cents, money } from '../stats/format.js';
import { monthLong } from '../stats/query.js';

// Presupuestos (RF-024 a RF-026). La clave incluye UUID, recurso y moneda: Resumen y
// Presupuestos comparten la misma caché y una respuesta tardía de otra moneda nunca se
// muestra con la clave vigente. Consumo, restante y porcentaje llegan calculados de
// PostgreSQL como texto decimal exacto; aquí solo se elige su presentación.
export function useBudgets(api, currency, enabled = true) {
  return useQuery({
    queryKey: [api.owner, 'budgets', currency],
    queryFn: ({ signal }) => api.rpc('get_budgets', { currency }, signal),
    enabled, staleTime: 30_000, retry: false, networkMode: 'always',
  });
}

export const budgetsKey = (owner) => [owner, 'budgets'];

// Estados visuales de UI-01, decididos por comparación exacta en centésimos y no por el
// porcentaje redondeado: 3.600,01 de 3.600 se muestra «100%» pero está «Superado».
export function budgetState({ spent, monthly_limit: limit }) {
  const used = cents(spent);
  const top = cents(limit);
  if (used > top) return { key: 'over', label: 'Superado', tone: 'neg' };
  if (used === top) return { key: 'reached', label: 'Límite alcanzado', tone: 'warn' };
  if (used * 10n >= top * 9n) return { key: 'near', label: 'Cerca del límite', tone: 'warn' };
  return { key: 'within', label: 'Dentro del límite', tone: 'ok' };
}

// Restante o exceso: remaining es negativo cuando el consumo supera el límite.
export function budgetMargin({ remaining }) {
  const over = remaining.startsWith('-');
  return { over, label: over ? 'Exceso' : 'Restante', amount: over ? remaining.slice(1) : remaining };
}

// La barra se satura al 100 %; el texto conserva el porcentaje real. Number solo para el ancho.
export function barWidth(percent) {
  return Math.min(100, Number(percent));
}

export function budgetCounts(items) {
  return {
    total: items.length,
    over: items.filter((item) => budgetState(item).key === 'over').length,
  };
}

// «3 límites activos · 1 superado».
export function countsLine(items) {
  const { total, over } = budgetCounts(items);
  const active = `${total} ${total === 1 ? 'límite activo' : 'límites activos'}`;
  return over ? `${active} · ${over} ${over === 1 ? 'superado' : 'superados'}` : active;
}

export const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
// «Noviembre de 2026» a partir de «2026-11» o de una fecha civil.
export const monthTitle = (value) => capital(monthLong(value.slice(0, 7)));

// Límite tecleado (coma o punto, hasta 12 enteros y 2 decimales) → texto decimal del RPC.
export function normalizeLimit(value) {
  return normalizeAmount(value);
}

// «15000.00» → «15000,00» para editar con coma decimal.
export const editableLimit = (limit) => limit.replace('.', ',');

export function describeBudget(item) {
  const state = budgetState(item);
  const margin = budgetMargin(item);
  return `${item.category_name}: ${state.label}. ${item.currency} ${money(item.spent)} de ${money(item.monthly_limit)}, `
    + `${margin.over ? 'exceso' : 'restan'} ${money(margin.amount)}.`;
}
