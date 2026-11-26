import { useQuery } from '@tanstack/react-query';
import { currencies, displayDate, normalizeAmount } from '../expenses/draft.js';
import { cents } from '../stats/format.js';
import { formatCents } from '../stats/insights.js';

export const recurringKey = (owner) => [owner, 'recurring'];

export function useRecurringPayments(api, enabled = true) {
  return useQuery({
    queryKey: recurringKey(api.owner),
    queryFn: ({ signal }) => api.rpc('list_recurring_payments', {}, signal),
    enabled,
    staleTime: 30_000,
    retry: false,
    networkMode: 'always',
  });
}

export function normalizeRecurringName(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ');
}

export function editableRecurringAmount(amount) {
  return String(amount ?? '').replace('.', ',');
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function effectiveBillingDate(year, month, billingDay) {
  const maxDay = daysInMonth(year, month);
  const day = Math.min(billingDay, maxDay);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function computePreviewNextDate(billingDay, today) {
  const day = Number(billingDay);
  if (!Number.isInteger(day) || day < 1 || day > 31 || !today) return null;
  const [year, month] = today.split('-').map(Number);
  const currentMonthDate = effectiveBillingDate(year, month, day);
  if (currentMonthDate >= today) return currentMonthDate;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return effectiveBillingDate(nextYear, nextMonth, day);
}

export function computeCurrencyTotals(items) {
  const totals = new Map();
  for (const code of currencies) {
    totals.set(code, { currency: code, cents: 0n, count: 0 });
  }
  for (const item of items) {
    const entry = totals.get(item.currency);
    if (!entry) continue;
    entry.cents += cents(item.amount);
    entry.count += 1;
  }
  return currencies
    .map((code) => totals.get(code))
    .filter((entry) => entry.count > 0)
    .map((entry) => ({
      currency: entry.currency,
      total: formatCents(entry.cents),
      count: entry.count,
    }));
}

export function formatBillingDay(day) {
  return day >= 29
    ? `Día ${day} (o fin de mes)`
    : `Día ${day} de cada mes`;
}

export function formatNextBillingDate(iso, today) {
  if (!iso) return '—';
  const formatted = displayDate(iso);
  return iso === today ? `${formatted} · hoy` : formatted;
}

export function validateRecurringDraft(draft, catalog, original = null) {
  const errors = {};
  const name = normalizeRecurringName(draft.name);
  if (!name || [...name].length > 120) {
    errors.name = 'Ingresá un nombre o descripción de 1 a 120 caracteres.';
  }
  if (!normalizeAmount(draft.amount)) {
    errors.amount = 'Ingresá un importe mayor que cero, con hasta 12 enteros y 2 decimales.';
  }
  if (!currencies.includes(draft.currency)) {
    errors.currency = 'Elegí UYU, USD o EUR.';
  }
  const parent = catalog.categories.find((row) => row.id === draft.category_id);
  const sameParent = original?.category_id === draft.category_id;
  if (!parent || (parent.archived && !sameParent)) {
    errors.category_id = 'Elegí una categoría activa.';
  }
  if (draft.subcategory_id) {
    const child = catalog.subcategories.find((row) => row.id === draft.subcategory_id);
    const sameChild = sameParent && original?.subcategory_id === draft.subcategory_id;
    if (!child || child.category_id !== draft.category_id || (!sameChild && (child.archived || parent?.archived))) {
      errors.subcategory_id = 'Elegí una subcategoría activa de esta categoría.';
    }
  }
  const day = Number(draft.billing_day);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    errors.billing_day = 'Elegí un día del 1 al 31.';
  }
  return errors;
}
