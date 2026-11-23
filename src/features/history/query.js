import { currencies, validDate } from '../expenses/draft.js';

// URL ↔ consulta del historial. Los parámetros visibles usan nombres en español;
// los valores por defecto se omiten para que el enlace sea corto y estable.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NO_CHILD = 'ninguna';
export const sorts = [
  { value: 'fecha-desc', sort: 'spent_on', direction: 'desc', label: 'Fecha ↓ · recientes', short: 'Fecha ↓' },
  { value: 'fecha-asc', sort: 'spent_on', direction: 'asc', label: 'Fecha ↑ · antiguos', short: 'Fecha ↑' },
  { value: 'importe-desc', sort: 'amount', direction: 'desc', label: 'Importe ↓ · mayores', short: 'Importe ↓' },
  { value: 'importe-asc', sort: 'amount', direction: 'asc', label: 'Importe ↑ · menores', short: 'Importe ↑' },
];
const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
  'octubre', 'noviembre', 'diciembre'];

export const emptyFilters = { from: '', to: '', currency: '', category: '', subcategory: '' };

export function readQuery(params) {
  const get = (name) => params.get(name) ?? '';
  const from = validDate(get('desde')) ? get('desde') : '';
  const to = validDate(get('hasta')) ? get('hasta') : '';
  const category = uuid.test(get('categoria')) ? get('categoria').toLowerCase() : '';
  const child = get('subcategoria');
  const order = sorts.find(({ sort, direction }) =>
    sort === (get('orden') === 'importe' ? 'amount' : 'spent_on') && direction === (get('sentido') === 'asc' ? 'asc' : 'desc'));
  return {
    q: get('q').slice(0, 100),
    from: from && to && from > to ? '' : from,
    to,
    currency: currencies.includes(get('moneda')) ? get('moneda') : '',
    category,
    subcategory: category && (child === NO_CHILD || uuid.test(child)) ? child.toLowerCase() : '',
    sort: order.sort,
    direction: order.direction,
  };
}

export function writeQuery(query, extra = {}) {
  const params = new URLSearchParams();
  const set = (name, value) => { if (value) params.set(name, value); };
  set('q', query.q.trim() ? query.q : '');
  set('desde', query.from);
  set('hasta', query.to);
  set('moneda', query.currency);
  set('categoria', query.category);
  set('subcategoria', query.category && query.subcategory);
  if (query.sort === 'amount') params.set('orden', 'importe');
  if (query.direction === 'asc') params.set('sentido', 'asc');
  for (const [name, value] of Object.entries(extra)) set(name, value);
  return params;
}

// Argumentos exactos de api.list_expenses; los ausentes quedan fuera del JSON.
export function listArgs(query) {
  const filters = {};
  if (query.from) filters.from = query.from;
  if (query.to) filters.to = query.to;
  if (query.currency) filters.currency = query.currency;
  if (query.category) filters.category_id = query.category;
  if (query.category && query.subcategory === NO_CHILD) filters.unclassified_child = true;
  else if (query.category && query.subcategory) filters.subcategory_id = query.subcategory;
  return { filters, q: query.q.trim() || null, sort: query.sort, direction: query.direction };
}

export function activeFilters(query) {
  return Number(Boolean(query.from || query.to)) + Number(Boolean(query.currency)) +
    Number(Boolean(query.category)) + Number(Boolean(query.category && query.subcategory));
}

export function isFiltered(query) {
  return Boolean(query.q.trim()) || activeFilters(query) > 0;
}

function shift(today, months) {
  const [year, month] = today.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}
const pad = (value) => String(value).padStart(2, '0');
const isoYear = (year) => String(year).padStart(4, '0');
function monthStart({ year, month }) { return `${isoYear(year)}-${pad(month)}-01`; }
function monthEnd({ year, month }) {
  const days = new Date(Date.UTC(2000, month, 0)).getUTCDate();
  const leap = month === 2 && (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0));
  return `${isoYear(year)}-${pad(month)}-${month === 2 ? (leap ? 29 : 28) : days}`;
}
const capital = (text) => text[0].toUpperCase() + text.slice(1);

// Períodos de calendario relativos a la fecha civil del servidor.
export function periods(today) {
  const current = shift(today, 0);
  const previous = shift(today, -1);
  const last = (count) => ({ from: monthStart(shift(today, 1 - count)), to: monthEnd(current) });
  return [
    { value: 'todo', label: 'Todo el historial', from: '', to: '' },
    { value: 'mes', label: `${capital(months[current.month - 1])} ${current.year}`, from: monthStart(current), to: monthEnd(current),
      title: `Gastos de ${months[current.month - 1]}` },
    { value: 'mes-anterior', label: `${capital(months[previous.month - 1])} ${previous.year}`, from: monthStart(previous),
      to: monthEnd(previous), title: `Gastos de ${months[previous.month - 1]}${previous.year === current.year ? '' : ' ' + previous.year}` },
    { value: '3m', label: 'Últimos 3 meses', ...last(3) },
    { value: '6m', label: 'Últimos 6 meses', ...last(6) },
    { value: '12m', label: 'Últimos 12 meses', ...last(12) },
    { value: 'anio', label: `Año ${current.year}`, from: `${isoYear(current.year)}-01-01`, to: `${isoYear(current.year)}-12-31`,
      title: `Gastos de ${current.year}` },
  ];
}

export function periodOf(query, today) {
  return periods(today).find(({ from, to }) => from === query.from && to === query.to) ?? null;
}

export function displayDay(date) {
  return date.split('-').reverse().join('/');
}

export function rangeLabel({ from, to }) {
  if (from && to) return `${displayDay(from)} – ${displayDay(to)}`;
  if (from) return `Desde ${displayDay(from)}`;
  return `Hasta ${displayDay(to)}`;
}

export function listTitle(query, today) {
  const period = periodOf(query, today);
  if (!period) {
    if (query.from && query.to) return `Gastos del ${displayDay(query.from)} al ${displayDay(query.to)}`;
    return query.from ? `Gastos desde el ${displayDay(query.from)}` : `Gastos hasta el ${displayDay(query.to)}`;
  }
  if (period.value === 'todo') return 'Todos los gastos';
  return period.title ?? period.label;
}

const shortMonths = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function rowDate(date, today, full = false) {
  const [year, month, day] = date.split('-');
  const short = `${Number(day)} ${shortMonths[Number(month) - 1]}`;
  return full || year !== today.slice(0, 4) ? `${short} ${Number(year)}` : short;
}

export function rowTitle(expense) {
  return expense.description ?? expense.subcategory_name ?? expense.category_name;
}
