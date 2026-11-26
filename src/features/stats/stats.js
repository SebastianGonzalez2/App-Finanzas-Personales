import { useQuery } from '@tanstack/react-query';

// Claves: [uuid, recurso, argumentos]. Los argumentos incluyen la moneda, por lo
// que una respuesta tardía de otra moneda nunca se muestra con la clave actual, y
// sin placeholderData los importes anteriores se ocultan al cambiar de filtros
// (ARCH-01 §11–12). El período general solo forma parte de la clave de get_stats.
const options = { staleTime: 30_000, retry: false, networkMode: 'always' };

export function useStats(api, args, enabled = true) {
  return useQuery({
    queryKey: [api.owner, 'stats', args],
    queryFn: ({ signal }) => api.rpc('get_stats', args, signal),
    enabled, ...options,
  });
}

export function useAnnual(api, args, enabled = true) {
  return useQuery({
    queryKey: [api.owner, 'annual', args],
    queryFn: ({ signal }) => api.rpc('get_annual', args, signal),
    enabled, ...options,
  });
}

const MAX_EXPENSE_PAGES = 20;

// Lee todos los gastos de un rango acotado (p. ej. uno o dos meses) usando list_expenses
// con páginas de 100 filas. Para el volumen habitual de un mes basta una sola llamada RPC.
async function fetchExpensesWindow(api, filters, signal) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < MAX_EXPENSE_PAGES; page += 1) {
    const response = await api.rpc('list_expenses', {
      filters, q: null, sort: 'spent_on', direction: 'asc', limit: 100, cursor,
    }, signal);
    items.push(...response.items);
    if (!response.next_cursor) break;
    cursor = response.next_cursor;
  }
  return items;
}

export function useExpensesWindow(api, { from, to, currency }, enabled = true) {
  return useQuery({
    queryKey: [api.owner, 'expenses-window', { from, to, currency }],
    queryFn: ({ signal }) => fetchExpensesWindow(api, { from, to, currency }, signal),
    enabled: Boolean(enabled && from && to && currency),
    ...options,
  });
}
