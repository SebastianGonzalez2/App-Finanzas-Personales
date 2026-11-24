import { cents, expensesCount, money, percentage } from './format.js';
import { fromDay, isOpen, monthLong, toDay } from './query.js';

// Resumen inteligente (RF-023): plantillas deterministas sobre la respuesta de
// get_stats. No usa IA ni inventa cifras; cada frase repite un valor del servidor
// o una relación verificable entre ellos, y explica cuándo faltan datos.

const joinNames = (names) => names.length < 2 ? names[0] : names.slice(0, -1).join(', ') + ' y ' + names.at(-1);
const completeMonth = (month) => month.from.endsWith('-01') && fromDay(toDay(month.to) + 1).endsWith('-01');

function headline(data, amount) {
  const scoped = Boolean(data.filters.category_id);
  const parent = data.categories[0]?.name;
  const groups = (scoped ? data.children : data.categories)
    .map((group) => ({ ...group, label: group.name ?? 'Sin subcategoría' }));
  if (!groups.length) return null;
  if (groups.length === 1) {
    if (!scoped) return { before: 'Todo el gasto registrado corresponde a ', strong: groups[0].label, after: '.' };
    return groups[0].id === null
      ? { before: 'Ningún gasto de ', strong: parent, after: ' tiene subcategoría.' }
      : { before: `Todo el gasto de ${parent} corresponde a `, strong: groups[0].label, after: '.' };
  }
  const top = groups.filter((group) => cents(group.total) === cents(groups[0].total));
  if (top.length > 1) {
    return {
      before: '', strong: joinNames(top.map((group) => group.label)),
      after: ` empatan como ${scoped ? 'subcategorías' : 'categorías'} de mayor gasto, con ${amount(top[0].total)} y el ${percentage(top[0].share)} del total cada una.`,
    };
  }
  return {
    before: `${groups[0].label} concentró el `, strong: percentage(groups[0].share),
    after: scoped ? ` del gasto de ${parent}.` : ' del gasto registrado.',
  };
}

function comparison(data, today, amount) {
  const { current, reference, delta, percent } = data.indicator;
  if (!data.reference) return null;
  if (reference.count === 0) {
    return `El período de referencia no tiene gastos registrados en ${data.filters.currency}, así que no hay base para comparar.`;
  }
  if (current.count === 0) return null;
  const change = cents(delta);
  const absolute = delta.replace(/^-/, '');
  const direction = change > 0n ? `aumentó ${amount(absolute)}` : change < 0n ? `disminuyó ${amount(absolute)}` : 'se mantuvo igual';
  let text = `El total ${direction} frente al período de referencia (${amount(reference.total)})`;
  if (percent !== null) return text + `, una variación de ${percentage(percent, { sign: true })}.`;
  text += '. La variación porcentual no se calcula porque ';
  return text + (isOpen(data.filters, today) || isOpen(data.reference, today)
    ? 'uno de los períodos sigue en curso.' : 'los períodos no tienen la misma duración.');
}

function highestMonth(months, amount) {
  const observed = months.filter((month) => month.total !== null);
  if (months.length < 2 || observed.length < 2) return null;
  const max = observed.reduce((best, month) => cents(month.total) > best ? cents(month.total) : best, 0n);
  const top = observed.filter((month) => cents(month.total) === max);
  return top.length === 1
    ? `El mes de mayor gasto fue ${monthLong(top[0].month)}, con ${amount(top[0].total)}.`
    : `Los meses de mayor gasto fueron ${joinNames(top.map((month) => monthLong(month.month)))}, con ${amount(top[0].total)} cada uno.`;
}

// Una tendencia solo se describe con al menos tres meses completos y cerrados,
// todos con registros, que suben o bajan en cada paso.
function trend(data, today) {
  if (data.month_next_offset !== null) return null;
  const closed = data.months.filter((month) => completeMonth(month) && month.to < today);
  if (closed.length < 3 || closed.some((month) => month.total === null)) {
    return 'No hay datos suficientes para describir una tendencia: hacen falta al menos tres meses cerrados con registros.';
  }
  const steps = closed.slice(1).map((month, index) => cents(month.total) - cents(closed[index].total));
  const span = `de ${monthLong(closed[0].month)} a ${monthLong(closed.at(-1).month)}`;
  if (steps.every((step) => step > 0n)) return `El gasto aumentó en cada uno de los ${closed.length} meses cerrados, ${span}.`;
  if (steps.every((step) => step < 0n)) return `El gasto disminuyó en cada uno de los ${closed.length} meses cerrados, ${span}.`;
  return `En los ${closed.length} meses cerrados, ${span}, el gasto subió y bajó sin una tendencia sostenida.`;
}

export function describeStats(data, today) {
  const currency = data.filters.currency;
  const amount = (text) => `${currency} ${money(text)}`;
  const { current } = data.indicator;
  if (current.count === 0) {
    return { headline: null, lines: [`No hay gastos registrados en ${currency} en este período.`] };
  }
  return {
    headline: headline(data, amount),
    lines: [
      `En el período registraste ${expensesCount(current.count)} por ${amount(current.total)}.`,
      comparison(data, today, amount),
      highestMonth(data.months, amount),
      trend(data, today),
    ].filter(Boolean),
  };
}
