// Independent reference model for IMP-04. It recomputes every statistic from the
// raw fixture rows with BigInt cents, without SQL, so a test never compares
// PostgreSQL with itself. Rounding: half away from zero, once, at two decimals.

export function toCents(text) {
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Unexpected amount ' + text);
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function fromCents(cents) {
  const negative = cents < 0n;
  const value = negative ? -cents : cents;
  return (negative ? '-' : '') + String(value / 100n) + '.' + String(value % 100n).padStart(2, '0');
}

// 100 × numerator / denominator, rounded to hundredths (half away from zero).
export function percent(numerator, denominator) {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = (numerator < 0n ? -numerator : numerator) * 10000n;
  const d = denominator < 0n ? -denominator : denominator;
  let hundredths = n / d;
  if ((n % d) * 2n >= d) hundredths += 1n;
  return fromCents(negative && hundredths !== 0n ? -hundredths : hundredths);
}

const sum = (rows) => rows.reduce((total, row) => total + toCents(row.amount), 0n);
export function metric(rows) {
  return { count: rows.length, total: rows.length ? fromCents(sum(rows)) : null };
}

// Civil dates as day numbers (proleptic Gregorian), valid for years 1–9999.
function dayNumber(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.round(date.getTime() / 86_400_000);
}
const monthIndex = (iso) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const pad = (value, size = 2) => String(value).padStart(size, '0');
function monthBounds(index) {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(0);
  last.setUTCFullYear(year, month, 0);
  return { month: `${pad(year, 4)}-${pad(month)}`, from: `${pad(year, 4)}-${pad(month)}-01`,
    to: `${pad(year, 4)}-${pad(month)}-${pad(last.getUTCDate())}` };
}

function isCompleteMonths(from, to) {
  const next = new Date(0);
  const [year, month, day] = to.split('-').map(Number);
  next.setUTCFullYear(year, month - 1, day + 1);
  return from.endsWith('-01') && next.getUTCDate() === 1;
}

export function equivalent(current, reference, today) {
  if (!(current.to < today && reference.to < today)) return false;
  if (dayNumber(current.to) - dayNumber(current.from) === dayNumber(reference.to) - dayNumber(reference.from)) return true;
  return isCompleteMonths(current.from, current.to) && isCompleteMonths(reference.from, reference.to)
    && monthIndex(current.to) - monthIndex(current.from) === monthIndex(reference.to) - monthIndex(reference.from);
}

export function comparison(currentRows, referenceRows, hasReference, comparable) {
  const current = metric(currentRows);
  const reference = hasReference ? metric(referenceRows) : null;
  const both = hasReference && currentRows.length > 0 && referenceRows.length > 0;
  const delta = both ? sum(currentRows) - sum(referenceRows) : null;
  return {
    current, reference,
    delta: delta === null ? null : fromCents(delta),
    percent: both && comparable ? percent(delta, sum(referenceRows)) : null,
  };
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const id = key(row) ?? null;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  return groups;
}

const byName = (names) => (left, right) => {
  const a = left.id === null ? null : names.get(left.id).toLowerCase();
  const b = right.id === null ? null : names.get(right.id).toLowerCase();
  if (a !== b) return a === null ? 1 : b === null ? -1 : a.localeCompare(b, 'und');
  return left.id === right.id ? 0 : left.id === null ? 1 : right.id === null ? -1 : left.id < right.id ? -1 : 1;
};
const byTotal = (names) => (left, right) => {
  const a = toCents(left.total);
  const b = toCents(right.total);
  return a === b ? byName(names)(left, right) : a > b ? -1 : 1;
};

function matches(row, filters, from, to) {
  return row.currency === filters.currency && row.spent_on >= from && row.spent_on <= to
    && (!filters.category_id || row.category_id === filters.category_id)
    && (!filters.subcategory_id || row.subcategory_id === filters.subcategory_id)
    && (!filters.unclassified_child || !row.subcategory_id);
}

// Expected api.get_stats response. names maps category and subcategory ids to current names.
export function expectedStats(rows, names, filters, reference, today, offset = 0) {
  const current = rows.filter((row) => matches(row, filters, filters.from, filters.to));
  const previous = reference ? rows.filter((row) => matches(row, filters, reference.from, reference.to)) : [];
  const comparable = reference ? equivalent(filters, reference, today) : null;
  const total = sum(current);
  const shareOf = (group) => percent(sum(group), total);

  const first = monthIndex(filters.from);
  const count = monthIndex(filters.to) - first + 1;
  const months = [];
  for (let index = first + offset; index <= first + Math.min(offset + 59, count - 1); index += 1) {
    const bounds = monthBounds(index);
    const from = bounds.from < filters.from ? filters.from : bounds.from;
    const to = bounds.to > filters.to ? filters.to : bounds.to;
    months.push({ month: bounds.month, from, to, ...metric(current.filter((row) => row.spent_on >= from && row.spent_on <= to)) });
  }

  const categories = [...groupBy(current, (row) => row.category_id)].map(([id, group]) =>
    ({ id, name: names.get(id), ...metric(group), share: shareOf(group) })).sort(byTotal(names));
  const children = filters.category_id
    ? [...groupBy(current, (row) => row.subcategory_id)].map(([id, group]) =>
      ({ id, name: id === null ? null : names.get(id), ...metric(group), share: shareOf(group) })).sort(byTotal(names))
    : [];
  const currentByCategory = groupBy(current, (row) => row.category_id);
  const previousByCategory = groupBy(previous, (row) => row.category_id);
  const ids = new Set([...currentByCategory.keys(), ...previousByCategory.keys()]);
  const categoryComparisons = reference ? [...ids].map((id) => ({
    id, name: names.get(id),
    ...comparison(currentByCategory.get(id) ?? [], previousByCategory.get(id) ?? [], true, comparable),
  })).sort(byName(names)) : [];

  return {
    filters: { from: filters.from, to: filters.to, currency: filters.currency, category_id: filters.category_id ?? null,
      subcategory_id: filters.subcategory_id ?? null, unclassified_child: Boolean(filters.unclassified_child) },
    reference: reference ? { from: reference.from, to: reference.to } : null,
    comparable,
    indicator: comparison(current, previous, Boolean(reference), comparable),
    months,
    month_next_offset: offset + 60 < count ? offset + 60 : null,
    categories,
    children,
    category_comparisons: categoryComparisons,
  };
}

// Expected api.get_annual response for the block ending in endYear.
export function expectedAnnual(rows, names, { currency, endYear, categoryId = null, subcategoryId = null }, today) {
  const thisYear = Number(today.slice(0, 4));
  const startYear = Math.max(1, endYear - 4);
  const selected = rows.filter((row) => row.currency === currency
    && (!categoryId || row.category_id === categoryId) && (!subcategoryId || row.subcategory_id === subcategoryId));
  const year = (y) => selected.filter((row) => Number(row.spent_on.slice(0, 4)) === y);
  const points = [];
  for (let y = startYear; y <= endYear; y += 1) {
    const own = year(y);
    const before = y > 1 ? year(y - 1) : [];
    const closedPair = y < thisYear && own.length > 0 && before.length > 0;
    const delta = closedPair ? sum(own) - sum(before) : null;
    points.push({ year: y, ...metric(own), partial: y === thisYear,
      delta: delta === null ? null : fromCents(delta), percent: closedPair ? percent(delta, sum(before)) : null });
  }
  return {
    currency, category_id: categoryId, subcategory_id: subcategoryId,
    label: subcategoryId ? names.get(categoryId) + ' · ' + names.get(subcategoryId) : categoryId ? names.get(categoryId) : null,
    start_year: startYear, end_year: endYear,
    previous_end_year: startYear > 1 ? startYear - 1 : null,
    next_end_year: endYear < thisYear ? Math.min(endYear + 5, thisYear) : null,
    points,
  };
}

// Expected api.get_budgets response (IMP-05). budgets: [{category_id, currency, monthly_limit}].
// Consumption: expenses of the budget's parent category (with or without child) in its
// currency during the civil month of today. Remaining may be negative. Sorted by the
// rounded percentage (descending), then lower-case name and id.
export function expectedBudgets(rows, budgets, names, currency, today) {
  const { month, from, to } = monthBounds(monthIndex(today));
  const items = budgets.filter((budget) => budget.currency === currency).map((budget) => {
    const used = sum(rows.filter((row) => row.currency === currency && row.category_id === budget.category_id
      && row.spent_on >= from && row.spent_on <= to));
    const limit = toCents(budget.monthly_limit);
    return {
      category_id: budget.category_id, category_name: names.get(budget.category_id), currency,
      monthly_limit: fromCents(limit), spent: fromCents(used), remaining: fromCents(limit - used),
      percent: percent(used, limit),
    };
  });
  items.sort((left, right) => {
    const a = toCents(left.percent);
    const b = toCents(right.percent);
    if (a !== b) return a > b ? -1 : 1;
    const nameOrder = left.category_name.toLowerCase().localeCompare(right.category_name.toLowerCase(), 'und');
    return nameOrder || (left.category_id < right.category_id ? -1 : 1);
  });
  return { month, currency, items };
}
