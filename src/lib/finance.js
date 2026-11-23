import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  return { owner, rpc, refresh, rememberCategory, rememberExpense, memory };
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
