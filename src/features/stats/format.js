import { displayAmount } from '../expenses/draft.js';

// Los importes y porcentajes llegan de PostgreSQL como texto decimal exacto con dos
// decimales. Aquí solo se cambia su presentación; nunca se recalculan con Number.
export const MINUS = '−';

export function money(text) {
  return displayAmount(text);
}

export function signedMoney(text) {
  if (text.startsWith('-')) return MINUS + displayAmount(text.slice(1));
  return (/^0+\.00$/.test(text) ? '' : '+') + displayAmount(text);
}

// «62,50%», «+20%», «−10%». Los centésimos nulos se omiten, como en UI-01.
export function percentage(text, { sign = false } = {}) {
  const negative = text.startsWith('-');
  const [whole, cents] = (negative ? text.slice(1) : text).split('.');
  const body = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (cents === '00' ? '' : ',' + cents);
  const zero = /^0+$/.test(whole) && cents === '00';
  return (negative ? MINUS : sign && !zero ? '+' : '') + body + '%';
}

// Cantidad entera con separador de miles (es-UY).
export function count(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function expensesCount(value) {
  return `${count(value)} ${value === 1 ? 'gasto' : 'gastos'}`;
}

// Solo para la coordenada del gráfico: el valor exacto se muestra con money().
export function chartNumber(text) {
  return text === null ? null : Number(text);
}

const axis = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 1 });
export function compactAxis(value) {
  const size = Math.abs(value);
  if (size >= 1e9) return axis.format(value / 1e9) + 'MM';
  if (size >= 1e6) return axis.format(value / 1e6) + 'M';
  if (size >= 1e4) return axis.format(value / 1e3) + 'k';
  return axis.format(value);
}

// Centésimos exactos como BigInt, para comparar importes sin coma flotante.
export function cents(text) {
  const negative = text.startsWith('-');
  const [whole, fraction = '0'] = (negative ? text.slice(1) : text).split('.');
  const value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -value : value;
}
