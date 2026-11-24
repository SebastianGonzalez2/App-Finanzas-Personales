import { useEffect } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../app/sessionContext.js';

const messages = {
  INVALID_AMOUNT: ['amount', 'Revisá el importe y sus decimales.'],
  INVALID_DATE: ['spent_on', 'Ingresá una fecha válida.'],
  INVALID_CURRENCY: ['currency', 'Elegí una moneda válida.'],
  INVALID_DESCRIPTION: ['description', 'La descripción admite hasta 500 caracteres.'],
  INVALID_CATEGORY: ['category_id', 'Elegí una categoría.'],
  CATEGORY_NOT_FOUND: ['category_id', 'La categoría ya no está disponible.'],
  CATEGORY_ARCHIVED: ['category_id', 'La categoría está archivada.'],
  INVALID_SUBCATEGORY: ['subcategory_id', 'La subcategoría debe pertenecer a la categoría elegida.'],
  SUBCATEGORY_NOT_FOUND: ['subcategory_id', 'La subcategoría ya no está disponible.'],
  SUBCATEGORY_ARCHIVED: ['subcategory_id', 'La subcategoría está archivada.'],
  DUPLICATE_NAME: ['name', 'Ya existe una clasificación con ese nombre.'],
  INVALID_NAME: ['name', 'Ingresá un nombre de 1 a 80 caracteres.'],
  EXPENSE_NOT_FOUND: [null, 'Este gasto ya no está disponible.'],
  EXPENSE_REMOVED: [null, 'Este gasto ya fue eliminado.'],
  ID_REUSED: [null, 'Este envío ya corresponde a otro gasto.'],
  STALE_VERSION: [null, 'El gasto cambió desde que lo abriste.'],
  INVALID_FILTERS: [null, 'Los filtros de esta consulta no son válidos.'],
  INVALID_DATE_RANGE: [null, 'La fecha inicial debe ser anterior o igual a la final.'],
  INVALID_QUERY: [null, 'La búsqueda admite hasta 100 caracteres.'],
  INVALID_SORT: [null, 'El orden elegido no es válido.'],
  INVALID_LIMIT: [null, 'El tamaño de página no es válido.'],
  INVALID_CURSOR: [null, 'La consulta cambió. Volvé a cargar el historial.'],
  INVALID_REFERENCE: [null, 'El período de referencia no es válido.'],
  INVALID_OFFSET: [null, 'El bloque de meses pedido no existe en este período.'],
  INVALID_YEAR: [null, 'El año elegido no es válido.'],
  INVALID_PANEL: [null, 'Ese panel no existe.'],
  INVALID_FAVORITE: [null, 'No pudimos actualizar el favorito.'],
};

export function useFinance() {
  const { client, snapshot, memory } = useSession();
  const cache = useQueryClient();
  const owner = snapshot.session.user.id;
  const token = snapshot.session.access_token;
  async function rpc(name, args = {}, signal) {
    let query = client.schema('api').rpc(name, args).setHeader('Authorization', 'Bearer ' + token);
    if (signal) query = query.abortSignal(signal);
    const { data, error, status } = await query;
    if (error || !data) {
      const code = error?.message;
      const [field, message] = messages[code] ?? [];
      const fallback = status === 401 || status === 403 ? 'Tu sesión ya no permite esta operación.'
        : status === 400 ? 'Revisá los campos e intentá de nuevo.'
        : 'No pudimos completar la solicitud. Revisá tu conexión.';
      if (status === 401 || status === 403) {
        void cache.invalidateQueries({ queryKey: ['session-preferences', snapshot.revision] });
      }
      throw Object.assign(new Error(message ?? fallback), { status, code, field });
    }
    return data;
  }
  function refresh(catalogChanged = false) {
    void cache.invalidateQueries({
      predicate: ({ queryKey }) => queryKey[0] === owner && (catalogChanged || queryKey[1] !== 'catalog'),
      // Expense writes return to the origin. Refresh its data when that view mounts.
      refetchType: catalogChanged ? 'active' : 'none',
    });
  }
  function rememberCategory(entry) {
    const key = entry.category_id ? 'subcategories' : 'categories';
    cache.setQueryData([owner, 'catalog'], (current) => {
      if (!current) return current;
      const rows = current[key].filter(({ id }) => id !== entry.id).concat(entry);
      rows.sort((a, b) => a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id));
      return { ...current, [key]: rows };
    });
    refresh(true);
  }
  function rememberExpense(id, expense) {
    const queryKey = [owner, 'expense', id];
    void cache.cancelQueries({ queryKey, exact: true }, { revert: false });
    refresh();
    if (expense) {
      memory.lastExpenseId = id;
      cache.setQueryData(queryKey, expense);
    } else {
      if (memory.lastExpenseId === id) memory.lastExpenseId = null;
      cache.removeQueries({ queryKey, exact: true });
    }
  }
  // Mutations made from the history refetch its loaded pages immediately.
  function reloadExpenses() {
    return cache.invalidateQueries({ queryKey: [owner, 'expenses'] });
  }
  return { owner, rpc, refresh, rememberCategory, rememberExpense, reloadExpenses, memory };
}

export const HISTORY_PAGE_SIZE = 30;

// One cache entry per exact query. Each page carries the server cursor of the next one;
// a refetch restarts from the first page and rebuilds the following cursors.
export function useExpenseList(api, args) {
  return useInfiniteQuery({
    queryKey: [api.owner, 'expenses', args],
    queryFn: ({ pageParam, signal }) =>
      api.rpc('list_expenses', { ...args, limit: HISTORY_PAGE_SIZE, cursor: pageParam }, signal),
    initialPageParam: null,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000, retry: false, networkMode: 'always',
  });
}

export function useCatalog(api) {
  return useQuery({
    queryKey: [api.owner, 'catalog'], queryFn: ({ signal }) => api.rpc('get_catalog', {}, signal),
    staleTime: 30_000, retry: false, networkMode: 'always',
  });
}

export function useExpense(api, id) {
  const query = useQuery({
    queryKey: [api.owner, 'expense', id], queryFn: ({ signal }) => api.rpc('get_expense', { id }, signal),
    enabled: Boolean(id), staleTime: 30_000, retry: false, networkMode: 'always',
  });
  const found = query.data?.id;
  const missing = query.error?.code === 'EXPENSE_NOT_FOUND';
  const { memory } = api;
  useEffect(() => {
    if (missing && memory.lastExpenseId === id) memory.lastExpenseId = null;
    else if (found && !missing) memory.lastExpenseId = found;
  }, [id, memory, found, missing]);
  return query;
}
