import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asUser, createTestDatabase, sessions, users } from './fixture.js';

// IMP-06 · Latencia de cada RPC de lectura con 36.500 gastos de una persona (ARCH-01 §2) y
// 36.500 de otra persona en la misma tabla, en PostgreSQL embebido (WASM, un hilo): cota
// pesimista, sin red. Mide la mediana de 7 ejecuciones e incluye la búsqueda literal del
// Historial, el orden por importe, el año completo y la serie anual de todas las categorías.
const TODAY = '2026-11-23';
const ROWS = 36_500;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

test('IMP-06 · RPC de lectura con dos personas y diez años de gastos cada una', async (t) => {
  const db = await createTestDatabase({ today: TODAY });
  t.after(() => db.close());
  await db.exec('reset role');
  for (const owner of [users.a, users.b]) {
    await db.query(`insert into app.expense_keys (owner_id, id, fingerprint)
      select $1::uuid, md5($1::text || g)::uuid, repeat('c', 64) from generate_series(1, $2) as g`, [owner, ROWS]);
    await db.query(`insert into app.expenses (owner_id, id, amount, currency, spent_on, category_id, description)
      select $1::uuid, md5($1::text || g)::uuid, (((abs(hashint4(g)) % 500000) + 1)::numeric / 100)::numeric(14,2),
        (array['UYU','UYU','UYU','USD','EUR'])[1 + abs(hashint4(g * 7)) % 5], date '${TODAY}' - (g % 3650),
        (select c.id from app.categories c where c.owner_id = $1::uuid order by c.name offset (g % 13) limit 1),
        case when g % 3 = 0 then 'Compra ' || g end
      from generate_series(1, $2) as g`, [owner, ROWS]);
  }
  await db.exec('analyze app.expenses');
  await asUser(db, users.a, sessions.a);
  const { categories } = (await db.query('select api.get_catalog() as result')).rows[0].result;
  const food = categories.find((row) => row.name === 'Alimentación').id;

  const cases = [
    ['get_preferences', 'select api.get_preferences()'],
    ['get_stats · mes', `select api.get_stats('{"from":"2026-11-01","to":"2026-11-30","currency":"UYU"}', '{"from":"2026-10-01","to":"2026-10-31"}')`],
    ['get_stats · 12 meses', `select api.get_stats('{"from":"2025-12-01","to":"2026-11-30","currency":"UYU"}', '{"from":"2024-12-01","to":"2025-11-30"}')`],
    ['get_stats · 10 años, categoría', `select api.get_stats('{"from":"2016-12-01","to":"2026-11-30","currency":"UYU","category_id":"${food}"}')`],
    ['get_annual · todas', "select api.get_annual('UYU')"],
    ['get_budgets', "select api.get_budgets('UYU')"],
    ['list_expenses · fecha', "select api.list_expenses('{}', null, 'spent_on', 'desc', 30, null)"],
    ['list_expenses · importe', "select api.list_expenses('{}', null, 'amount', 'desc', 30, null)"],
    ['list_expenses · búsqueda', "select api.list_expenses('{}', 'compra 12', 'spent_on', 'desc', 30, null)"],
    ['list_expenses · búsqueda sin resultados', "select api.list_expenses('{}', 'zzz', 'spent_on', 'desc', 30, null)"],
  ];
  const report = {};
  for (const [name, sql] of cases) {
    const times = [];
    for (let run = 0; run < 7; run += 1) {
      const started = performance.now();
      await db.query(sql);
      times.push(performance.now() - started);
    }
    report[name] = Math.round(median(times) * 10) / 10;
  }
  t.diagnostic('mediana ms ' + JSON.stringify(report));
  // B no aparece en ninguna lectura de A, aunque comparte tabla e índices.
  const page = (await db.query("select api.list_expenses('{}', null, 'spent_on', 'desc', 100, null) as r")).rows[0].r;
  assert.equal(page.items.length, 100);
  await db.exec('reset role');
  const own = (await db.query('select count(*)::int as n from app.expenses where owner_id = $1 and id = any($2::uuid[])',
    [users.a, page.items.map((item) => item.id)])).rows[0].n;
  assert.equal(own, 100);
  for (const [name, ms] of Object.entries(report)) assert.ok(ms < 2000, `${name}: ${ms} ms`);
});
