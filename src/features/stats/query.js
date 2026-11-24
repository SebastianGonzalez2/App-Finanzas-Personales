import { validDate } from '../expenses/draft.js';

// Estado navegable de /estadisticas (ARCH-01 §10): período, referencia, clasificación,
// desglose, ventana anual y vista. La moneda es una preferencia del usuario, no un filtro de URL.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PANELS = [
  { id: 'metrics', title: 'Indicadores del período', span: true },
  { id: 'monthly', title: 'Gastos por mes' },
  { id: 'categories', title: 'Gastos por categoría' },
  { id: 'comparison', title: 'Comparación por categoría', span: true },
  { id: 'annual', title: 'Evolución anual por categoría' },
  { id: 'summary', title: 'Resumen inteligente' },
];

export const PERIODS = [
  { value: 'mes', label: 'Mes actual', months: 1 },
  { value: 'mes-anterior', label: 'Mes anterior', months: 1 },
  { value: '3m', label: 'Últimos 3 meses', months: 3 },
  { value: '6m', label: 'Últimos 6 meses', months: 6 },
  { value: '12m', label: 'Últimos 12 meses', months: 12 },
  { value: 'anio', label: 'Año actual' },
];

// ── Fechas civiles como números de día (proleptic gregoriano, años 1–9999).
const pad = (value, size = 2) => String(value).padStart(size, '0');
export function toDay(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.round(date.getTime() / 86_400_000);
}
export function fromDay(number) {
  const date = new Date(number * 86_400_000);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
const FIRST_DAY = toDay('0001-01-01');
const monthIndex = (iso) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const monthStart = (index) => `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}-01`;
const monthEnd = (index) => fromDay(toDay(monthStart(index + 1)) - 1);
const monthsRange = (first, last) => first < 12 ? null : { from: monthStart(first), to: monthEnd(last) };
export const yearOf = (today) => Number(today.slice(0, 4));

export function presetRange(value, today) {
  const now = monthIndex(today);
  if (value === 'anio') return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  if (value === 'mes-anterior') return monthsRange(now - 1, now - 1);
  const period = PERIODS.find((option) => option.value === value) ?? PERIODS[0];
  return monthsRange(now - period.months + 1, now);
}

// ARCH-01 §9: bloque calendario anterior del mismo número de meses, año anterior
// para el anual y los N días inmediatamente anteriores para un rango libre.
export function defaultReference(period, range) {
  if (!range) return null;
  if (period === 'anio') {
    const year = Number(range.from.slice(0, 4)) - 1;
    return year < 1 ? null : { from: `${pad(year, 4)}-01-01`, to: `${pad(year, 4)}-12-31` };
  }
  if (period !== 'personalizado') {
    const first = monthIndex(range.from);
    const count = monthIndex(range.to) - first + 1;
    return monthsRange(first - count, first - 1);
  }
  const days = toDay(range.to) - toDay(range.from) + 1;
  const start = toDay(range.from) - days;
  return start < FIRST_DAY ? null : { from: fromDay(start), to: fromDay(toDay(range.from) - 1) };
}

function readRange(params, fromName, toName) {
  const from = params.get(fromName) ?? '';
  const to = params.get(toName) ?? '';
  return validDate(from) && validDate(to) && from <= to ? { from, to } : null;
}

export function readStatsQuery(params, today) {
  const get = (name) => params.get(name) ?? '';
  const custom = readRange(params, 'desde', 'hasta');
  let period = custom ? 'personalizado' : PERIODS.some(({ value }) => value === get('periodo')) ? get('periodo') : 'mes';
  let range = custom ?? presetRange(period, today);
  if (!range) { period = 'mes'; range = presetRange('mes', today); }
  const customReference = readRange(params, 'ref-desde', 'ref-hasta');
  const category = uuid.test(get('categoria')) ? get('categoria').toLowerCase() : '';
  const subcategory = category && uuid.test(get('subcategoria')) ? get('subcategoria').toLowerCase() : '';
  const annual = /^\d{1,4}$/.test(get('anual')) ? Number(get('anual')) : null;
  return {
    period, range,
    reference: customReference ?? defaultReference(period, range),
    customReference: Boolean(customReference),
    category, subcategory,
    breakdown: !category && uuid.test(get('desglose')) ? get('desglose').toLowerCase() : '',
    annualEnd: annual && annual >= 1 && annual < yearOf(today) ? annual : null,
    view: get('vista') === 'favoritos' ? 'favoritos' : 'todas',
  };
}

export function writeStatsQuery(query) {
  const params = new URLSearchParams();
  const set = (name, value) => { if (value) params.set(name, String(value)); };
  set('vista', query.view === 'favoritos' && 'favoritos');
  if (query.period === 'personalizado') {
    set('desde', query.range.from);
    set('hasta', query.range.to);
  } else {
    set('periodo', query.period !== 'mes' && query.period);
  }
  if (query.customReference && query.reference) {
    set('ref-desde', query.reference.from);
    set('ref-hasta', query.reference.to);
  }
  set('categoria', query.category);
  set('subcategoria', query.category && query.subcategory);
  set('desglose', !query.category && query.breakdown);
  set('anual', query.annualEnd);
  return params;
}

// Argumentos exactos de api.get_stats y api.get_annual (ARCH-01 §8).
export function statsArgs(query, currency, monthOffset = 0) {
  const filters = { from: query.range.from, to: query.range.to, currency };
  if (query.category) filters.category_id = query.category;
  if (query.category && query.subcategory) filters.subcategory_id = query.subcategory;
  return { filters, reference: query.reference, month_offset: monthOffset };
}

export function breakdownArgs(query, currency) {
  const filters = { from: query.range.from, to: query.range.to, currency, category_id: query.breakdown };
  return { filters, reference: null, month_offset: 0 };
}

export function annualArgs(query, currency) {
  return {
    currency,
    end_year: query.annualEnd,
    category_id: query.category || null,
    subcategory_id: (query.category && query.subcategory) || null,
  };
}

// ── Rótulos de períodos.
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
  'octubre', 'noviembre', 'diciembre'];
const SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
const parts = (iso) => iso.split('-').map(Number);

export function monthShort(month, withYear = false) {
  const [year, number] = parts(month);
  return SHORT[number - 1] + (withYear ? ' ' + String(year).slice(-2) : '');
}
export function monthLong(month) {
  const [year, number] = parts(month);
  return `${MONTHS[number - 1]} de ${year}`;
}
export function dayLong(iso, withYear = true) {
  const [year, month, day] = parts(iso);
  return `${day} de ${MONTHS[month - 1]}${withYear ? ' de ' + year : ''}`;
}
export function dayShort(iso) {
  const [year, month, day] = parts(iso);
  return `${day} ${SHORT[month - 1].toLowerCase()} ${year}`;
}

// «Del 1 de mayo al 31 de octubre de 2026» (UI-01).
export function rangeTitle({ from, to }) {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `Del ${dayLong(from, !sameYear)} al ${dayLong(to)}`;
}

const wholeMonths = ({ from, to }) => from.endsWith('-01') && fromDay(toDay(to) + 1).endsWith('-01');
// «Nov 2026», «May — Oct 2026», «Dic 2025 — Nov 2026», «2026», «15/12/2016 – 23/11/2026».
export function rangeShort(range) {
  const [fromYear, fromMonth] = parts(range.from);
  const [toYear, toMonth] = parts(range.to);
  if (!wholeMonths(range)) return `${range.from.split('-').reverse().join('/')} – ${range.to.split('-').reverse().join('/')}`;
  if (fromYear === toYear && fromMonth === 1 && toMonth === 12) return String(fromYear);
  if (fromYear === toYear && fromMonth === toMonth) return `${SHORT[fromMonth - 1]} ${fromYear}`;
  if (fromYear === toYear) return `${SHORT[fromMonth - 1]} — ${SHORT[toMonth - 1]} ${toYear}`;
  return `${SHORT[fromMonth - 1]} ${fromYear} — ${SHORT[toMonth - 1]} ${toYear}`;
}

export const isOpen = (range, today) => range.to >= today;
export const isPartial = (range, today) => range.from <= today && today <= range.to;
export const yearRange = (year) => ({ from: `${pad(year, 4)}-01-01`, to: `${pad(year, 4)}-12-31` });
