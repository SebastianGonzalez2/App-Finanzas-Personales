import { cents } from './format.js';
import { toDay } from './query.js';

// Paleta sobria y armónica con el sistema oscuro de Cifra (--sage, --amber, --rose y neutros fríos).
export const CATEGORY_PALETTE = ['#adcfba', '#e3bd84', '#8eb8d9', '#e5a6a3', '#b7a8db'];
export const OTHER_SLICE_COLOR = '#7b8082';

const MONTHS_TITLE = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];

const pad2 = (value) => String(value).padStart(2, '0');
const pad4 = (value) => String(value).padStart(4, '0');

// Convierte centésimos BigInt en texto decimal exacto compatible con money() / signedMoney().
export function formatCents(value) {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 100n;
  const frac = String(abs % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

// Variación porcentual exacta con redondeo half-up a 2 decimales (igual que PostgreSQL round()).
export function percentChange(currentCents, referenceCents) {
  if (referenceCents <= 0n) return null;
  const diff = currentCents - referenceCents;
  const negative = diff < 0n;
  const absDiff = negative ? -diff : diff;
  const scaled = absDiff * 10000n;
  const quotient = scaled / referenceCents;
  const remainder = scaled % referenceCents;
  const rounded = remainder * 2n >= referenceCents ? quotient + 1n : quotient;
  if (rounded === 0n) return '0.00';
  const whole = rounded / 100n;
  const frac = String(rounded % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

// Participación porcentual exacta con redondeo half-up a 2 decimales.
export function sharePercent(partCents, totalCents) {
  if (totalCents <= 0n) return '0.00';
  const scaled = partCents * 10000n;
  const quotient = scaled / totalCents;
  const remainder = scaled % totalCents;
  const rounded = remainder * 2n >= totalCents ? quotient + 1n : quotient;
  const whole = rounded / 100n;
  const frac = String(rounded % 100n).padStart(2, '0');
  return `${whole}.${frac}`;
}

// ── Utilidades de calendario civil (proléptico gregoriano).
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return { year, month };
}

export function monthKeyFrom(year, month) {
  return `${pad4(year)}-${pad2(month)}`;
}

export function shiftMonthKey(monthKey, delta) {
  const { year, month } = parseMonthKey(monthKey);
  const index = year * 12 + (month - 1) + delta;
  if (index < 12) return null; // Antes del año 0001
  return monthKeyFrom(Math.floor(index / 12), (index % 12) + 1);
}

export function monthLabel(monthKey) {
  const { year, month } = parseMonthKey(monthKey);
  return `${MONTHS_TITLE[month - 1]} ${year}`;
}

export function monthShortLabel(monthKey, withYear = true) {
  const { year, month } = parseMonthKey(monthKey);
  return withYear ? `${MONTHS_SHORT[month - 1]} ${year}` : MONTHS_SHORT[month - 1];
}

export function recentMonthOptions(today, count = 36) {
  const current = today.slice(0, 7);
  const options = [];
  for (let offset = 0; offset < count; offset += 1) {
    const key = shiftMonthKey(current, -offset);
    if (!key) break;
    options.push({ value: key, label: monthLabel(key) });
  }
  return options;
}

export function recentYearOptions(today, count = 10) {
  const currentYear = Number(today.slice(0, 4));
  const options = [];
  for (let offset = 0; offset < count; offset += 1) {
    const year = currentYear - offset;
    if (year < 1) break;
    options.push({ value: String(year), label: String(year) });
  }
  return options;
}

export function formatShortSpan(range) {
  const [y1, m1, d1] = range.from.split('-').map(Number);
  const [y2, m2, d2] = range.to.split('-').map(Number);
  if (y1 === y2 && m1 === m2) {
    return `${d1}–${d2} ${MONTHS_SHORT[m1 - 1].toLowerCase()} ${y1}`;
  }
  if (y1 === y2) {
    return `${d1} ${MONTHS_SHORT[m1 - 1].toLowerCase()} – ${d2} ${MONTHS_SHORT[m2 - 1].toLowerCase()} ${y1}`;
  }
  return `${d1} ${MONTHS_SHORT[m1 - 1].toLowerCase()} ${y1} – ${d2} ${MONTHS_SHORT[m2 - 1].toLowerCase()} ${y2}`;
}

// ── 1) Resolución de períodos para la comparación entre períodos.
export function resolveMonthlyComparison(monthA, monthB, today) {
  const currentMonth = today.slice(0, 7);
  const todayDay = Number(today.slice(8, 10));
  const { year: yA, month: mA } = parseMonthKey(monthA);
  const { year: yB, month: mB } = parseMonthKey(monthB);
  const fullDaysA = daysInMonth(yA, mA);
  const fullDaysB = daysInMonth(yB, mB);
  const todayMonthDays = daysInMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)));

  const currentInProgress = todayDay < todayMonthDays;
  const involvesCurrent = currentInProgress && (monthA === currentMonth || monthB === currentMonth);

  const endDayA = involvesCurrent ? Math.min(todayDay, fullDaysA) : fullDaysA;
  const endDayB = involvesCurrent ? Math.min(todayDay, fullDaysB) : fullDaysB;

  const rangeA = { from: `${monthA}-01`, to: `${monthA}-${pad2(endDayA)}` };
  const rangeB = { from: `${monthB}-01`, to: `${monthB}-${pad2(endDayB)}` };
  const prevMonth = shiftMonthKey(currentMonth, -1);

  return {
    mode: 'monthly',
    rangeA,
    rangeB,
    labelA: monthShortLabel(monthA),
    labelB: monthShortLabel(monthB),
    spanA: formatShortSpan(rangeA),
    spanB: formatShortSpan(rangeB),
    daysA: endDayA,
    daysB: endDayB,
    alignedPartial: involvesCurrent,
    clamped: involvesCurrent && endDayA !== endDayB,
    isDefaultCurrentVsPrevious: monthA === currentMonth && monthB === prevMonth,
  };
}

export function resolveAnnualComparison(yearA, yearB, today) {
  const numA = Number(yearA);
  const numB = Number(yearB);
  const currentYear = Number(today.slice(0, 4));
  const todayMonth = Number(today.slice(5, 7));
  const todayDay = Number(today.slice(8, 10));
  const yearInProgress = !(todayMonth === 12 && todayDay === 31);
  const involvesCurrent = yearInProgress && (numA === currentYear || numB === currentYear);

  const endDayA = involvesCurrent ? Math.min(todayDay, daysInMonth(numA, todayMonth)) : 31;
  const endDayB = involvesCurrent ? Math.min(todayDay, daysInMonth(numB, todayMonth)) : 31;
  const endMonth = involvesCurrent ? todayMonth : 12;

  const rangeA = { from: `${pad4(numA)}-01-01`, to: `${pad4(numA)}-${pad2(endMonth)}-${pad2(endDayA)}` };
  const rangeB = { from: `${pad4(numB)}-01-01`, to: `${pad4(numB)}-${pad2(endMonth)}-${pad2(endDayB)}` };

  return {
    mode: 'annual',
    rangeA,
    rangeB,
    labelA: String(numA),
    labelB: String(numB),
    spanA: involvesCurrent ? formatShortSpan(rangeA) : `Año ${numA} completo`,
    spanB: involvesCurrent ? formatShortSpan(rangeB) : `Año ${numB} completo`,
    daysA: toDay(rangeA.to) - toDay(rangeA.from) + 1,
    daysB: toDay(rangeB.to) - toDay(rangeB.from) + 1,
    alignedPartial: involvesCurrent,
    clamped: false,
    isDefaultCurrentVsPrevious: false,
  };
}

export function resolveCustomComparison(rangeA, rangeB) {
  const daysA = toDay(rangeA.to) - toDay(rangeA.from) + 1;
  const daysB = toDay(rangeB.to) - toDay(rangeB.from) + 1;
  return {
    mode: 'custom',
    rangeA,
    rangeB,
    labelA: 'Período A',
    labelB: 'Período B',
    spanA: formatShortSpan(rangeA),
    spanB: formatShortSpan(rangeB),
    daysA,
    daysB,
    alignedPartial: false,
    differentDuration: daysA !== daysB,
    clamped: false,
    isDefaultCurrentVsPrevious: false,
  };
}

function finalizePeriodComparison(totalACents, countA, totalBCents, countB, categoryRows, currency) {
  const deltaCents = totalACents - totalBCents;
  const categories = categoryRows.map((row) => {
    const rowDelta = row.aCents - row.bCents;
    const status = row.bCount === 0 && row.aCount > 0 ? 'new'
      : row.aCount === 0 && row.bCount > 0 ? 'gone'
      : rowDelta > 0n ? 'up'
      : rowDelta < 0n ? 'down'
      : 'same';
    return {
      id: row.id,
      name: row.name,
      aCount: row.aCount,
      aCents: row.aCents,
      aTotal: formatCents(row.aCents),
      bCount: row.bCount,
      bCents: row.bCents,
      bTotal: formatCents(row.bCents),
      deltaCents: rowDelta,
      deltaText: formatCents(rowDelta),
      percentText: percentChange(row.aCents, row.bCents),
      status,
    };
  });

  // Ordenar por mayor impacto absoluto en la diferencia (responde «¿qué categorías explican la diferencia?»).
  categories.sort((left, right) => {
    const absLeft = left.deltaCents < 0n ? -left.deltaCents : left.deltaCents;
    const absRight = right.deltaCents < 0n ? -right.deltaCents : right.deltaCents;
    if (absRight !== absLeft) return absRight > absLeft ? 1 : -1;
    const maxLeft = left.aCents > left.bCents ? left.aCents : left.bCents;
    const maxRight = right.aCents > right.bCents ? right.aCents : right.bCents;
    if (maxRight !== maxLeft) return maxRight > maxLeft ? 1 : -1;
    return left.name.localeCompare(right.name, 'es');
  });

  let maxCategoryCents = 0n;
  let topIncrease = null;
  let topDecrease = null;
  for (const row of categories) {
    if (row.aCents > maxCategoryCents) maxCategoryCents = row.aCents;
    if (row.bCents > maxCategoryCents) maxCategoryCents = row.bCents;
    if (row.deltaCents > 0n && (!topIncrease || row.deltaCents > topIncrease.deltaCents)) topIncrease = row;
    if (row.deltaCents < 0n && (!topDecrease || row.deltaCents < topDecrease.deltaCents)) topDecrease = row;
  }

  return {
    currency,
    periodA: { count: countA, cents: totalACents, total: formatCents(totalACents) },
    periodB: { count: countB, cents: totalBCents, total: formatCents(totalBCents) },
    deltaCents,
    deltaText: formatCents(deltaCents),
    percentText: percentChange(totalACents, totalBCents),
    direction: deltaCents > 0n ? 'up' : deltaCents < 0n ? 'down' : 'same',
    categories,
    maxCategoryCents,
    topIncrease,
    topDecrease,
  };
}

export function buildPeriodComparisonFromStats(data) {
  const current = data.indicator.current;
  const reference = data.indicator.reference ?? { count: 0, total: null };
  const totalACents = current.total ? cents(current.total) : 0n;
  const totalBCents = reference.total ? cents(reference.total) : 0n;
  const rows = (data.category_comparisons ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    aCount: row.current.count,
    aCents: row.current.total ? cents(row.current.total) : 0n,
    bCount: row.reference.count,
    bCents: row.reference.total ? cents(row.reference.total) : 0n,
  }));
  return finalizePeriodComparison(totalACents, current.count, totalBCents, reference.count, rows, data.filters.currency);
}

export function buildPeriodComparisonFromExpenses(expenses, rangeA, rangeB, currency) {
  let totalACents = 0n;
  let countA = 0;
  let totalBCents = 0n;
  let countB = 0;
  const byCategory = new Map();

  const ensure = (id, name) => {
    let entry = byCategory.get(id);
    if (!entry) {
      entry = { id, name, aCount: 0, aCents: 0n, bCount: 0, bCents: 0n };
      byCategory.set(id, entry);
    }
    return entry;
  };

  for (const expense of expenses) {
    if (expense.currency !== currency) continue;
    const amountCents = cents(expense.amount);
    const inA = expense.spent_on >= rangeA.from && expense.spent_on <= rangeA.to;
    const inB = expense.spent_on >= rangeB.from && expense.spent_on <= rangeB.to;
    if (!inA && !inB) continue;
    const entry = ensure(expense.category_id, expense.category_name);
    if (inA) {
      totalACents += amountCents;
      countA += 1;
      entry.aCount += 1;
      entry.aCents += amountCents;
    }
    if (inB) {
      totalBCents += amountCents;
      countB += 1;
      entry.bCount += 1;
      entry.bCents += amountCents;
    }
  }

  return finalizePeriodComparison(totalACents, countA, totalBCents, countB, [...byCategory.values()], currency);
}

// ── 2) Evolución acumulada día a día del gasto mensual.
export function buildCumulativeMonthly({ expensesA, expensesB, monthA, monthB, today, currency, categoryId = '' }) {
  const { year: yA, month: mA } = parseMonthKey(monthA);
  const { year: yB, month: mB } = parseMonthKey(monthB);
  const daysA = daysInMonth(yA, mA);
  const daysB = daysInMonth(yB, mB);
  const maxDays = Math.max(daysA, daysB);
  const currentMonth = today.slice(0, 7);
  const isCurrentA = monthA === currentMonth;
  const lastDayA = isCurrentA ? Math.min(Number(today.slice(8, 10)), daysA) : daysA;
  const compareDayB = Math.min(lastDayA, daysB);
  const clampedB = compareDayB < lastDayA;

  const dailyA = Array(daysA + 1).fill(0n);
  const dailyACount = Array(daysA + 1).fill(0);
  const dailyB = Array(daysB + 1).fill(0n);
  const dailyBCount = Array(daysB + 1).fill(0);

  const prefixA = `${monthA}-`;
  const prefixB = `${monthB}-`;

  for (const expense of expensesA) {
    if (expense.currency !== currency) continue;
    if (categoryId && expense.category_id !== categoryId) continue;
    if (!expense.spent_on.startsWith(prefixA)) continue;
    const day = Number(expense.spent_on.slice(8, 10));
    if (day >= 1 && day <= lastDayA) {
      dailyA[day] += cents(expense.amount);
      dailyACount[day] += 1;
    }
  }

  for (const expense of expensesB) {
    if (expense.currency !== currency) continue;
    if (categoryId && expense.category_id !== categoryId) continue;
    if (!expense.spent_on.startsWith(prefixB)) continue;
    const day = Number(expense.spent_on.slice(8, 10));
    if (day >= 1 && day <= daysB) {
      dailyB[day] += cents(expense.amount);
      dailyBCount[day] += 1;
    }
  }

  let runningA = 0n;
  let runningACount = 0;
  let runningB = 0n;
  let runningBCount = 0;
  let refAtSameDayCents = 0n;
  let refAtSameDayCount = 0;
  const points = [];

  for (let day = 1; day <= maxDays; day += 1) {
    const hasA = day <= lastDayA;
    const hasB = day <= daysB;
    if (hasA) {
      runningA += dailyA[day];
      runningACount += dailyACount[day];
    }
    if (hasB) {
      runningB += dailyB[day];
      runningBCount += dailyBCount[day];
      if (day === compareDayB) {
        refAtSameDayCents = runningB;
        refAtSameDayCount = runningBCount;
      }
    }
    const cumAText = hasA ? formatCents(runningA) : null;
    const cumBText = hasB ? formatCents(runningB) : null;
    const dayDeltaCents = hasA && hasB ? runningA - runningB : null;
    points.push({
      day,
      dateA: day <= daysA ? `${monthA}-${pad2(day)}` : null,
      dateB: hasB ? `${monthB}-${pad2(day)}` : null,
      dailyACents: hasA ? dailyA[day] : 0n,
      dailyAText: hasA ? formatCents(dailyA[day]) : null,
      dailyACount: hasA ? dailyACount[day] : 0,
      cumACents: hasA ? runningA : null,
      cumAText,
      cumANum: cumAText !== null ? Number(cumAText) : null,
      dailyBCents: hasB ? dailyB[day] : 0n,
      dailyBText: hasB ? formatCents(dailyB[day]) : null,
      dailyBCount: hasB ? dailyBCount[day] : 0,
      cumBCents: hasB ? runningB : null,
      cumBText,
      cumBNum: cumBText !== null ? Number(cumBText) : null,
      deltaCents: dayDeltaCents,
      deltaText: dayDeltaCents !== null ? formatCents(dayDeltaCents) : null,
      percentText: hasA && hasB ? percentChange(runningA, runningB) : null,
    });
  }

  const deltaCents = runningA - refAtSameDayCents;
  const maxCents = runningA > runningB ? runningA : runningB;

  return {
    currency,
    monthA,
    monthB,
    labelA: monthShortLabel(monthA),
    labelB: monthShortLabel(monthB),
    shortA: monthShortLabel(monthA, false),
    shortB: monthShortLabel(monthB, false),
    daysA,
    daysB,
    maxDays,
    isCurrentA,
    lastDayA,
    compareDayB,
    clampedB,
    current: { cents: runningA, total: formatCents(runningA), count: runningACount },
    refAtSameDay: { cents: refAtSameDayCents, total: formatCents(refAtSameDayCents), count: refAtSameDayCount },
    refFullMonth: { cents: runningB, total: formatCents(runningB), count: runningBCount },
    deltaCents,
    deltaText: formatCents(deltaCents),
    percentText: percentChange(runningA, refAtSameDayCents),
    direction: deltaCents > 0n ? 'up' : deltaCents < 0n ? 'down' : 'same',
    maxValueNum: Number(formatCents(maxCents)),
    hasAnyData: runningACount > 0 || runningBCount > 0,
    points,
  };
}

// ── 3) Segmentación radial para el gráfico circular de Principales categorías.
export const DONUT_TICKS = 72;
export const DONUT_MAX_PRIMARY = 5;

export function buildDonutSlices(categories, totalText, { maxPrimary = DONUT_MAX_PRIMARY, totalTicks = DONUT_TICKS } = {}) {
  if (!categories.length) return [];
  const totalCents = totalText ? cents(totalText) : categories.reduce((sum, item) => sum + cents(item.total), 0n);
  if (totalCents <= 0n) return [];

  const primary = categories.slice(0, maxPrimary).map((category, index) => ({
    id: category.id,
    name: category.name,
    count: category.count,
    total: category.total,
    cents: cents(category.total),
    share: category.share,
    color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length],
    isOther: false,
    otherCount: 0,
  }));

  const rest = categories.slice(maxPrimary);
  const slices = [...primary];
  if (rest.length > 0) {
    const restCents = rest.reduce((sum, item) => sum + cents(item.total), 0n);
    const restCount = rest.reduce((sum, item) => sum + item.count, 0);
    slices.push({
      id: '__other__',
      name: rest.length === 1 ? 'Otra categoría' : `Otras (${rest.length})`,
      count: restCount,
      total: formatCents(restCents),
      cents: restCents,
      share: sharePercent(restCents, totalCents),
      color: OTHER_SLICE_COLOR,
      isOther: true,
      otherCount: rest.length,
    });
  }

  // Reparto de marcas radiales (método de restos mayores / Hamilton), garantizando ≥ 1 marca
  // a cada porción con importe > 0 para que ninguna categoría visible desaparezca del anillo.
  const exact = slices.map((slice) => (Number(slice.cents) / Number(totalCents)) * totalTicks);
  const counts = exact.map((val, index) => (slices[index].cents > 0n ? Math.max(1, Math.floor(val)) : 0));
  let assigned = counts.reduce((sum, n) => sum + n, 0);

  if (assigned < totalTicks) {
    const order = exact
      .map((val, index) => ({ index, remainder: val - Math.floor(val) }))
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    let cursor = 0;
    while (assigned < totalTicks && order.length > 0) {
      counts[order[cursor % order.length].index] += 1;
      assigned += 1;
      cursor += 1;
    }
  } else if (assigned > totalTicks) {
    // Si garantizar ≥ 1 en porciones minúsculas excede totalTicks, descontar de las mayores.
    while (assigned > totalTicks) {
      let largestIndex = -1;
      for (let i = 0; i < counts.length; i += 1) {
        if (counts[i] > 1 && (largestIndex === -1 || counts[i] > counts[largestIndex])) {
          largestIndex = i;
        }
      }
      if (largestIndex === -1) break;
      counts[largestIndex] -= 1;
      assigned -= 1;
    }
  }

  let startTick = 0;
  return slices.map((slice, index) => {
    const tickCount = counts[index];
    const endTick = startTick + tickCount;
    const startAngle = -Math.PI / 2 + (startTick / totalTicks) * Math.PI * 2;
    const endAngle = -Math.PI / 2 + (endTick / totalTicks) * Math.PI * 2;
    const result = { ...slice, startTick, endTick, tickCount, startAngle, endAngle };
    startTick = endTick;
    return result;
  });
}
