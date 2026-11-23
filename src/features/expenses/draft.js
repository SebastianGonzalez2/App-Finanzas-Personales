export const currencies = ['UYU', 'USD', 'EUR'];

export function normalizeAmount(value) {
  const match = /^(\d{1,12})(?:[.,](\d{1,2}))?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const whole = match[1].replace(/^0+(?=\d)/, '');
  const cents = (match[2] ?? '').padEnd(2, '0');
  return whole === '0' && cents === '00' ? null : whole + '.' + cents;
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function normalizeName(value) {
  const name = String(value ?? '').trim().replace(/\s+/gu, ' ');
  return [...name].length <= 80 ? name : '';
}

export function newDraft(preferences, expense = null) {
  return {
    id: expense?.id ?? crypto.randomUUID(),
    amount: expense?.amount.replace('.', ',') ?? '',
    currency: expense?.currency ?? preferences.currency,
    spent_on: expense?.spent_on ?? preferences.today,
    category_id: expense?.category_id ?? '',
    subcategory_id: expense?.subcategory_id ?? '',
    description: expense?.description ?? '',
  };
}

export function changeField(draft, field, value) {
  if (draft[field] === value) return draft;
  if (field === 'category_id') return { ...draft, category_id: value, subcategory_id: '' };
  return { ...draft, [field]: value };
}

export function validateDraft(draft, catalog, original = null) {
  const errors = {};
  if (!normalizeAmount(draft.amount)) {
    errors.amount = 'Ingresá un importe mayor que cero, con hasta 12 enteros y 2 decimales.';
  }
  if (!currencies.includes(draft.currency)) errors.currency = 'Elegí UYU, USD o EUR.';
  if (!validDate(draft.spent_on)) errors.spent_on = 'Ingresá una fecha válida.';
  const parent = catalog.categories.find(({ id }) => id === draft.category_id);
  const sameParent = original?.category_id === draft.category_id;
  if (!parent || (parent.archived && !sameParent)) {
    errors.category_id = 'Elegí una categoría activa para este gasto.';
  }
  if (draft.subcategory_id) {
    const child = catalog.subcategories.find(({ id }) => id === draft.subcategory_id);
    const historical = sameParent && original.subcategory_id === draft.subcategory_id;
    if (!child || child.category_id !== draft.category_id || (!historical && (child.archived || parent?.archived))) {
      errors.subcategory_id = 'Elegí una subcategoría activa de esta categoría.';
    }
  }
  if ([...draft.description.trim()].length > 500) errors.description = 'Usá hasta 500 caracteres.';
  return errors;
}

export function expensePayload(draft) {
  return {
    ...draft,
    amount: normalizeAmount(draft.amount),
    subcategory_id: draft.subcategory_id || null,
    description: draft.description.trim() || null,
  };
}

export function displayAmount(amount) {
  const [whole, cents] = amount.split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + cents;
}

export function displayDate(date) {
  return date.split('-').reverse().join('/');
}
