import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asUser, createTestDatabase, databaseSetupSql, sessions, users } from './fixture.js';
import { PGlite } from '@electric-sql/pglite';

// IMP-06 · Auditoría independiente de exactitud y coherencia entre pantallas. Un libro
// reproducible (PRNG con semilla) de 600 gastos en tres monedas, ocho años, categorías y
// subcategorías —una archivada con gastos históricos— recibe ediciones de importe, fecha,
// moneda y categoría, y eliminaciones. Tras cada tanda, para cada moneda se comparan contra un
// modelo propio en centésimos BigInt (sin SQL, sin reutilizar oracle.js):
//   · Resumen/Estadísticas (get_stats del mes) = Historial (todas las páginas) = modelo;
//   · categorías, participaciones, subcategorías y meses de 12 meses;
//   · serie anual (cinco años) y cada año contra get_stats del año completo;
//   · Presupuestos (consumo, restante, %) = total de la categoría en get_stats del mes.
const TODAY = '2026-03-01'; // primer día del mes: el mes en curso tiene un solo día.

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const cents = (text) => { const [w, f = ''] = text.split('.'); return BigInt(w) * 100n + BigInt(f.padEnd(2, '0')); };
const text = (value) => (value < 0n ? '-' : '') + ((value < 0n ? -value : value) / 100n) + '.'
  + String((value < 0n ? -value : value) % 100n).padStart(2, '0');
const pct = (part, whole) => {
  const scaled = part * 10000n;
  let q = scaled / whole;
  if ((scaled % whole) * 2n >= whole) q += 1n;
  return text(q);
};
const pad = (n, size = 2) => String(n).padStart(size, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const month = (y, m) => ({ from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` });

test('IMP-06 · coherencia y exactitud entre Resumen, Estadísticas, Historial, Presupuestos y serie anual', async (t) => {
  const db = await createTestDatabase({ today: TODAY });
  t.after(() => db.close());
  await asUser(db, users.a, sessions.a);
  const call = async (sql, params = []) => (await db.query(`select ${sql} as r`, params)).rows[0].r;
  const catalog = await call('api.get_catalog()');
  const parents = catalog.categories;
  const children = catalog.subcategories;
  const rand = random(20261124);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const amount = () => {
    const kind = rand();
    const value = kind < 0.1 ? 1n : kind < 0.2 ? 99_999_999_999_999n : BigInt(Math.floor(rand() * 5_000_000) + 1);
    return text(value);
  };
  const date = () => {
    const y = 2019 + Math.floor(rand() * 8);
    const m = y === 2026 ? 1 + Math.floor(rand() * 3) : 1 + Math.floor(rand() * 12);
    const d = 1 + Math.floor(rand() * lastDay(y, m));
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    return iso > TODAY ? TODAY : iso;
  };
  const ledger = new Map();
  const closed = new Set();
  async function create() {
    const parent = pick(parents.filter((p) => !closed.has(p.id)));
    const options = children.filter((c) => c.category_id === parent.id);
    const child = options.length && rand() < 0.6 ? pick(options) : null;
    const id = crypto.randomUUID();
    const { expense } = await call('api.create_expense($1,$2,$3,$4,$5,$6,null)',
      [id, amount(), pick(['UYU', 'UYU', 'USD', 'EUR']), date(), parent.id, child?.id ?? null]);
    ledger.set(id, expense);
  }
  for (let i = 0; i < 600; i += 1) await create();
  // Una categoría con gastos históricos se archiva: sigue contando en todas las vistas.
  const archived = parents.find((p) => [...ledger.values()].some((e) => e.category_id === p.id && e.currency === 'UYU'));
  await call(`api.update_category('category', $1, '{"archived":true}')`, [archived.id]);
  closed.add(archived.id);
  const active = parents.filter((p) => p.id !== archived.id);
  for (const [category, currency, limit] of [[active[0].id, 'UYU', '1.00'], [active[1].id, 'UYU', '999999999999.99'],
    [active[2].id, 'USD', '250.00'], [archived.id, 'UYU', '10.00']]) {
    if (category === archived.id) {
      await db.exec('reset role');
      await db.query('insert into app.budgets values ($1,$2,$3,$4)', [users.a, category, currency, limit]);
      await asUser(db, users.a, sessions.a);
    } else {
      await call('api.create_budget($1,$2,$3)', [category, currency, limit]);
    }
  }

  function model(filter) {
    const rows = [...ledger.values()].filter(filter);
    const total = rows.reduce((sum, row) => sum + cents(row.amount), 0n);
    return { count: rows.length, total: rows.length ? text(total) : null, rows, cents: total };
  }
  async function history(filters) {
    const items = [];
    let cursor = null;
    do {
      const page = await call('api.list_expenses($1,null,$2,$3,100,$4)', [JSON.stringify(filters), 'amount', 'desc', cursor]);
      items.push(...page.items);
      cursor = page.next_cursor;
    } while (cursor);
    return items;
  }

  let checks = 0;
  async function verify(label) {
    const current = month(2026, 3);
    for (const currency of ['UYU', 'USD', 'EUR']) {
      const inRange = (from, to) => (row) => row.currency === currency && row.spent_on >= from && row.spent_on <= to;
      // Resumen = Estadísticas (mismo get_stats) = Historial = modelo, mes en curso y 12 meses.
      for (const range of [current, { from: '2025-04-01', to: '2026-03-31' }]) {
        const stats = await call('api.get_stats($1,null,0)', [JSON.stringify({ ...range, currency })]);
        const want = model(inRange(range.from, range.to));
        assert.deepEqual(stats.indicator.current, { count: want.count, total: want.total }, `${label} ${currency} ${range.from}`);
        checks += want.count;
        const rows = await history({ ...range, currency });
        assert.equal(rows.length, want.count);
        assert.equal(text(rows.reduce((s, r) => s + cents(r.amount), 0n)), want.total ?? '0.00');
        for (let i = 1; i < rows.length; i += 1) assert.ok(cents(rows[i - 1].amount) >= cents(rows[i].amount), 'orden por importe');
        for (const category of stats.categories) {
          const part = model((row) => inRange(range.from, range.to)(row) && row.category_id === category.id);
          assert.equal(category.total, part.total, `${label} categoría ${category.name}`);
          assert.equal(category.count, part.count);
          assert.equal(category.share, pct(part.cents, want.cents));
        }
        const monthSum = stats.months.reduce((s, m) => s + (m.total ? cents(m.total) : 0n), 0n);
        assert.equal(monthSum, want.cents, 'meses sin duplicar');
        if (want.count) {
          const top = stats.categories[0];
          const split = await call('api.get_stats($1,null,0)', [JSON.stringify({ ...range, currency, category_id: top.id })]);
          assert.equal(text(split.children.reduce((s, c) => s + cents(c.total), 0n)), top.total, 'hijas = padre');
        }
      }
      // Serie anual: cada año = get_stats del año completo = modelo.
      const annual = await call('api.get_annual($1,null,null,null)', [currency]);
      for (const point of annual.points) {
        const want = model(inRange(`${point.year}-01-01`, `${point.year}-12-31`));
        assert.equal(point.total, want.total, `${label} año ${point.year}`);
        assert.equal(point.count, want.count);
        assert.equal(point.partial, point.year === 2026);
        checks += want.count;
        if (point.year < 2026 && want.count) {
          const previous = model(inRange(`${point.year - 1}-01-01`, `${point.year - 1}-12-31`));
          assert.equal(point.delta, previous.count ? text(want.cents - previous.cents) : null);
        }
      }
      // Presupuestos = total de la categoría en el mes = modelo; restante y % exactos.
      const budgets = await call('api.get_budgets($1)', [currency]);
      const monthStats = await call('api.get_stats($1,null,0)', [JSON.stringify({ ...current, currency })]);
      for (const item of budgets.items) {
        const want = model((row) => inRange(current.from, current.to)(row) && row.category_id === item.category_id);
        assert.equal(item.spent, text(want.cents), `${label} presupuesto ${item.category_name}`);
        checks += 1;
        assert.equal(item.remaining, text(cents(item.monthly_limit) - want.cents));
        assert.equal(item.percent, pct(want.cents, cents(item.monthly_limit)));
        const inStats = monthStats.categories.find((c) => c.id === item.category_id);
        assert.equal(inStats?.total ?? null, want.count ? item.spent : null);
      }
    }
  }

  await verify('inicial');
  t.diagnostic(`libro: ${ledger.size} gastos; filas comparadas en la primera verificación: ${checks}`);
  // Mutaciones: importe, fecha (otro mes/año), moneda, categoría, quitar hija y eliminar.
  for (let round = 0; round < 3; round += 1) {
    const ids = [...ledger.keys()];
    for (let i = 0; i < 60; i += 1) {
      const id = pick(ids);
      const row = ledger.get(id);
      if (!row) continue;
      const action = rand();
      if (action < 0.2) {
        await call('api.delete_expense($1,$2)', [id, row.version]);
        ledger.delete(id);
        continue;
      }
      const parent = action < 0.4 ? pick(parents.filter((p) => p.id !== archived.id)) : null;
      const next = {
        amount: action < 0.6 ? amount() : row.amount,
        currency: action > 0.8 ? pick(['UYU', 'USD', 'EUR']) : row.currency,
        spent_on: action > 0.6 ? date() : row.spent_on,
        category_id: parent?.id ?? row.category_id,
        subcategory_id: parent ? null : (action > 0.9 ? null : row.subcategory_id),
      };
      const updated = await call('api.update_expense($1,$2,$3,$4,$5,$6,$7,null)',
        [id, row.version, next.amount, next.currency, next.spent_on, next.category_id, next.subcategory_id]);
      ledger.set(id, updated);
    }
    for (let i = 0; i < 20; i += 1) await create();
    await verify('ronda ' + (round + 1));
  }
});

test('IMP-06 · today() usa la medianoche de Montevideo (UTC−3), no la de UTC', async () => {
  const db = new PGlite();
  try {
    for (const sql of await databaseSetupSql()) await db.exec(sql);
    // Evalúa la definición real de la migración sustituyendo el reloj por instantes fijos.
    const body = (await db.query("select prosrc from pg_proc where proname = 'today' and pronamespace = 'private'::regnamespace")).rows[0].prosrc;
    assert.match(body, /statement_timestamp\(\) at time zone 'America\/Montevideo'/);
    for (const [instant, expected] of [['2026-12-01 02:59:59+00', '2026-11-30'], ['2026-12-01 03:00:00+00', '2026-12-01'],
      ['2027-01-01 02:59:59+00', '2026-12-31'], ['2027-01-01 03:00:00+00', '2027-01-01'], ['2028-03-01 02:30:00+00', '2028-02-29']]) {
      const sql = body.replace('statement_timestamp()', `timestamptz '${instant}'`);
      const value = (await db.query(`select to_char((${sql.replace(/^\s*select\s+/i, '')})::timestamp, 'YYYY-MM-DD') as d`)).rows[0].d;
      assert.equal(value, expected, instant);
    }
  } finally {
    await db.close();
  }
});
