import { NO_CHILD, RETURN_PARAM, writeQuery } from '../history/query.js';
import { yearRange } from './query.js';

// El Historial recibe exactamente los filtros que produjo el agregado: los que
// devolvió el servidor en la respuesta (filters, months, points), nunca el estado
// de la pantalla, y sin trasladar el intervalo de referencia por error (ARCH-01 §10).
export function historyHref({ from, to, currency, category_id = null, subcategory_id = null, unclassified_child = false }, back) {
  const params = writeQuery({
    q: '', from, to, currency, category: category_id ?? '',
    subcategory: category_id ? (unclassified_child ? NO_CHILD : subcategory_id ?? '') : '',
    sort: 'spent_on', direction: 'desc',
  }, { [RETURN_PARAM]: back });
  return '/historial?' + params;
}

// Filtros de período sobre otro intervalo (referencia, mes) con la misma clasificación.
export function periodFilters(filters, range) {
  return { ...filters, from: range.from, to: range.to };
}

export function categoryFilters(filters, categoryId) {
  return { ...filters, category_id: categoryId, subcategory_id: null, unclassified_child: false };
}

export function childFilters(filters, categoryId, childId) {
  return { ...filters, category_id: categoryId, subcategory_id: childId, unclassified_child: childId === null };
}

export function yearFilters(annual, year) {
  return { ...yearRange(year), currency: annual.currency, category_id: annual.category_id, subcategory_id: annual.subcategory_id };
}
