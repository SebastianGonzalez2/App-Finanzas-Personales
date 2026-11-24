import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asUser, createTestDatabase, sessions, users } from './fixture.js';
import { expectedAnnual, expectedStats } from './oracle.js';

// ARCH-01 §2: cuatro personas × diez gastos por día × diez años ≈ 146.000 gastos,
// es decir unos 36.500 por persona. Se generan para B en PostgreSQL embebido (WASM,
// un solo hilo): los tiempos son una cota pesimista, no la latencia alojada.
const TODAY = '2026-11-23';
const ROWS = 36_500;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

test('IMP-04 · rendimiento y exactitud con diez años de gastos de una persona', async (t) => {
  const db = await createTestDatabase({ today: TODAY });
  t.after(() => db.close());
  await asUser(db, users.b, sessions.b);
  const catalog = (await db.query('select api.get_catalog() as result')).rows[0].result;
  const pairs = catalog.categories.flatMap((category) => [[category.id, null],
    ...catalog.subcategories.filter((child) => child.category_id === category.id).map((child) => [category.id, child.id])]);
  const names = new Map([...catalog.categories, ...catalog.subcategories].map((row) => [row.id, row.name]));

  await db.exec('reset role');
  const started = performance.now();
  await db.query(`insert into app.expense_keys (owner_id, id, fingerprint)
    select $1, md5('perf' || g)::uuid, repeat('c', 64) from generate_series(1, $2) as g`, [users.b, ROWS]);
  await db.query(`insert into app.expenses (owner_id, id, amount, currency, spent_on, category_id, subcategory_id)
    select $1, md5('perf' || g)::uuid,
      (((abs(hashint4(g)) % 500000) + 1)::numeric / 100)::numeric(14,2),
      (array['UYU','UYU','UYU','USD','EUR'])[1 + abs(hashint4(g * 7)) % 5],
      date '${TODAY}' - (g % 3650),
      ($3::jsonb -> (abs(hashint4(g * 13)) % $4) ->> 0)::uuid,
      ($3::jsonb -> (abs(hashint4(g * 13)) % $4) ->> 1)::uuid
    from generate_series(1, $2) as g`, [users.b, ROWS, JSON.stringify(pairs), pairs.length]);
  await db.exec('analyze app.expenses');
  t.diagnostic(`semilla: ${ROWS} gastos en ${Math.round(performance.now() - started)} ms`);
  const rows = (await db.query(`select id, amount::text as amount, currency, to_char(spent_on::timestamp, 'YYYY-MM-DD') as spent_on,
    category_id, subcategory_id from app.expenses where owner_id = $1`, [users.b])).rows;
  assert.equal(rows.length, ROWS);

  await asUser(db, users.b, sessions.b);
  const food = catalog.categories.find((row) => row.name === 'Alimentación').id;
  async function timed(label, sql, args, check) {
    const samples = [];
    let result;
    for (let run = 0; run < 5; run += 1) {
      const begin = performance.now();
      result = (await db.query(sql, args)).rows[0].result;
      samples.push(performance.now() - begin);
    }
    check(result);
    const size = Buffer.byteLength(JSON.stringify(result));
    t.diagnostic(`${label}: mediana ${median(samples).toFixed(1)} ms · máx. ${Math.max(...samples).toFixed(1)} ms · ${size} bytes`);
    return median(samples);
  }
  const statsSql = 'select api.get_stats($1, $2, $3) as result';
  const cases = [
    ['mes actual con referencia', { from: '2026-11-01', to: '2026-11-30', currency: 'UYU' }, { from: '2026-10-01', to: '2026-10-31' }, 0],
    ['últimos 12 meses con referencia', { from: '2025-12-01', to: '2026-11-30', currency: 'UYU' }, { from: '2024-12-01', to: '2025-11-30' }, 0],
    ['diez años, primer bloque', { from: '2016-11-24', to: '2026-11-23', currency: 'UYU' }, null, 0],
    ['diez años, segundo bloque', { from: '2016-11-24', to: '2026-11-23', currency: 'UYU' }, null, 60],
    ['12 meses de Alimentación con desglose', { from: '2025-12-01', to: '2026-11-30', currency: 'USD', category_id: food }, { from: '2024-12-01', to: '2025-11-30' }, 0],
  ];
  const timings = [];
  for (const [label, filters, reference, offset] of cases) {
    timings.push(await timed('get_stats · ' + label, statsSql, [JSON.stringify(filters), reference && JSON.stringify(reference), offset],
      (result) => assert.deepEqual(result, expectedStats(rows, names, filters, reference, TODAY, offset), label)));
  }
  for (const [label, currency, endYear, categoryId] of [['bloque actual, todas', 'UYU', null, null], ['bloque anterior, todas', 'EUR', 2021, null],
    ['bloque actual, Alimentación', 'UYU', null, food]]) {
    timings.push(await timed('get_annual · ' + label, 'select api.get_annual($1, $2, $3) as result', [currency, endYear, categoryId],
      (result) => assert.deepEqual(result, expectedAnnual(rows, names, { currency, endYear: endYear ?? 2026, categoryId }, TODAY), label)));
  }
  // Cota amplia para detectar regresiones graves (p. ej. agregaciones por fila o N+1), no una meta de latencia.
  assert.ok(Math.max(...timings) < 3000, 'agregación demasiado lenta');

  await t.test('los períodos acotados usan el índice (owner_id, currency, spent_on) bajo RLS', async () => {
    const { rows: plan } = await db.query(`explain (analyze, costs off) select count(*), sum(e.amount) from app.expenses e
      where e.owner_id = $1 and e.currency = 'UYU' and e.spent_on between '2026-11-01' and '2026-11-30'`, [users.b]);
    const text = plan.map((line) => line['QUERY PLAN']).join('\n');
    t.diagnostic(text);
    assert.match(text, /expenses_currency_date_idx|expenses_category_currency_date_idx/);
  });
});
