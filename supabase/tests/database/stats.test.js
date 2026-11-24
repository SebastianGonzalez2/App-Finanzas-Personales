import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { asUser, createTestDatabase, sessions, users } from './fixture.js';
import { expectedAnnual, expectedStats, fromCents, metric, toCents } from './oracle.js';

const TODAY = '2026-11-23';
const fingerprint = 'b'.repeat(64);

test('IMP-04 · get_stats, get_annual y favoritos contra un modelo independiente', async (t) => {
  const db = await createTestDatabase({ today: TODAY });
  t.after(() => db.close());
  const user = (key) => asUser(db, users[key], sessions[key]);
  const scalar = async (sql, args) => (await db.query(sql, args)).rows[0]?.result;
  const stats = (filters, reference = null, offset = 0) => scalar(
    'select api.get_stats(filters => $1, reference => $2, month_offset => $3) as result',
    [JSON.stringify(filters), reference === null ? null : JSON.stringify(reference), offset]);
  const annual = (currency, endYear = null, categoryId = null, subcategoryId = null) => scalar(
    'select api.get_annual(currency => $1, end_year => $2, category_id => $3, subcategory_id => $4) as result',
    [currency, endYear, categoryId, subcategoryId]);
  const rejects = (promise, message, code) => assert.rejects(promise, (error) => {
    assert.equal(error.message, message);
    if (code) assert.equal(error.code, code);
    return true;
  });
  const listAll = async (filters) => {
    const rows = [];
    let cursor = null;
    do {
      const page = await scalar('select api.list_expenses(filters => $1, "limit" => 100, cursor => $2) as result',
        [JSON.stringify(filters), cursor]);
      rows.push(...page.items);
      cursor = page.next_cursor;
    } while (cursor);
    return rows;
  };

  // ── Catálogo de A: categorías sembradas más una propia que se archivará.
  await user('a');
  const catalog = await scalar('select api.get_catalog() as result');
  const parent = (name) => catalog.categories.find((row) => row.name === name).id;
  const child = (name) => catalog.subcategories.find((row) => row.name === name).id;
  const pets = (await scalar("select api.create_category('Mascotas') as result")).id;
  const vet = (await scalar('select api.create_category($1, $2) as result', ['Veterinaria', pets])).id;
  const c = {
    food: parent('Alimentación'), transport: parent('Transporte'), home: parent('Vivienda'), services: parent('Servicios'), pets,
    market: child('Supermercado'), rest: child('Restaurantes'), delivery: child('Delivery'),
    bus: child('Transporte público'), taxi: child('Taxi/Uber'), rent: child('Alquiler'), vet,
  };
  const names = new Map([...catalog.categories, ...catalog.subcategories].map((row) => [row.id, row.name]));
  names.set(pets, 'Mascotas');
  names.set(vet, 'Veterinaria');

  // ── Gastos sintéticos con resultados calculados a mano (comentarios) y por el modelo.
  const row = (key, spent_on, currency, amount, category, subcategory = null) => ({
    key, id: randomUUID(), spent_on, currency, amount, category_id: c[category], subcategory_id: subcategory ? c[subcategory] : null,
  });
  const rows = [
    // Noviembre 2026, mes en curso (hoy 23/11). UYU: 100 + 200 + 0,10 + 0,20 + 50 = 350,30 en 5 gastos.
    row('n1', '2026-11-02', 'UYU', '100.00', 'food', 'market'),
    row('n2', '2026-11-10', 'UYU', '200.00', 'food', 'rest'),
    row('n3', '2026-11-05', 'USD', '300.00', 'food'),
    row('n4', '2026-11-20', 'UYU', '0.10', 'transport', 'taxi'),
    row('n5', '2026-11-21', 'UYU', '0.20', 'transport'),
    row('n6', '2026-11-01', 'EUR', '45.67', 'services'),
    row('n7', '2026-11-30', 'UYU', '50.00', 'food'),
    // Octubre 2026. UYU: 250 + 300 + 99,99 + 0,01 = 650,00 en 4 gastos.
    row('o1', '2026-10-31', 'UYU', '250.00', 'food', 'market'),
    row('o2', '2026-10-01', 'UYU', '300.00', 'food', 'rest'),
    row('o3', '2026-10-15', 'UYU', '99.99', 'home', 'rent'),
    row('o4', '2026-10-15', 'USD', '10.00', 'transport'),
    row('o5', '2026-10-20', 'UYU', '0.01', 'transport', 'bus'),
    // Septiembre sin UYU; agosto en una categoría que se archivará: 1.000,99 UYU.
    row('s1', '2026-09-09', 'EUR', '12.34', 'services'),
    row('a1', '2026-08-08', 'UYU', '1000.00', 'pets', 'vet'),
    row('a2', '2026-08-31', 'UYU', '0.99', 'pets'),
    row('j1', '2026-06-15', 'UYU', '33.33', 'food', 'delivery'),
    row('d1', '2025-12-31', 'UYU', '70.00', 'home', 'rent'),
    // Años anteriores para la serie anual de Alimentación en UYU.
    row('y25', '2025-01-01', 'UYU', '540.00', 'food', 'rest'),
    row('y24a', '2024-02-29', 'UYU', '600.00', 'food'),
    row('y24b', '2024-07-01', 'UYU', '400.00', 'transport'),
    row('y24c', '2024-03-03', 'USD', '999.00', 'food'),
    row('y23a', '2023-03-01', 'UYU', '200.00', 'food', 'market'),
    row('y23b', '2023-12-31', 'UYU', '300.00', 'food', 'delivery'),
    row('y21', '2021-06-01', 'UYU', '70.00', 'food'),
    row('y17', '2017-01-01', 'UYU', '33.33', 'food'),
    row('y16', '2016-12-31', 'UYU', '11.11', 'food'),
  ];
  const byKey = Object.fromEntries(rows.map((entry) => [entry.key, entry]));
  async function seed(owner, entries) {
    await db.exec('reset role');
    for (const entry of entries) {
      await db.query('insert into app.expense_keys values ($1, $2, $3)', [owner, entry.id, fingerprint]);
      await db.query(`insert into app.expenses (owner_id, id, amount, currency, spent_on, category_id, subcategory_id)
        values ($1, $2, $3, $4, $5, $6, $7)`, [owner, entry.id, entry.amount, entry.currency, entry.spent_on,
        entry.category_id, entry.subcategory_id]);
    }
  }
  await seed(users.a, rows);
  await user('a');
  await scalar("select api.update_category('subcategory', $1, '{\"archived\":true}') as result", [vet]);
  await scalar("select api.update_category('category', $1, '{\"archived\":true}') as result", [pets]);

  const november = { from: '2026-11-01', to: '2026-11-30' };
  const october = { from: '2026-10-01', to: '2026-10-31' };
  const last12 = { from: '2025-12-01', to: '2026-11-30' };
  const check = async (filters, reference = null, offset = 0) => {
    const actual = await stats(filters, reference, offset);
    assert.deepEqual(actual, expectedStats(rows, names, filters, reference, TODAY, offset), JSON.stringify({ filters, reference, offset }));
    return actual;
  };

  await t.test('RF-017 · tres monedas separadas, sin total multimoneda', async () => {
    await user('b');
    const own = await scalar('select api.get_catalog() as result');
    const food = own.categories.find((entry) => entry.name === 'Alimentación').id;
    for (const [amount, currency] of [['100.00', 'UYU'], ['200.00', 'UYU'], ['300.00', 'USD']]) {
      await scalar('select api.create_expense($1, $2, $3, $4, $5) as result', [randomUUID(), amount, currency, '2026-11-10', food]);
    }
    const range = { from: '2026-11-01', to: '2026-11-30' };
    assert.deepEqual((await stats({ ...range, currency: 'UYU' })).indicator.current, { count: 2, total: '300.00' });
    assert.deepEqual((await stats({ ...range, currency: 'USD' })).indicator.current, { count: 1, total: '300.00' });
    assert.deepEqual((await stats({ ...range, currency: 'EUR' })).indicator.current, { count: 0, total: null });
    for (const currency of ['UYU', 'USD', 'EUR']) {
      const text = JSON.stringify(await stats({ ...range, currency }));
      assert.ok(!text.includes('"600.00"'), currency);
    }
    const yearUyu = await annual('UYU');
    assert.deepEqual(yearUyu.points.at(-1), { year: 2026, count: 2, total: '300.00', partial: true, delta: null, percent: null });
  });

  await t.test('indicadores, céntimos, participación y desglose calculados a mano', async () => {
    await user('a');
    const uyu = await check({ ...november, currency: 'UYU' }, october);
    assert.deepEqual(uyu.indicator, {
      current: { count: 5, total: '350.30' }, reference: { count: 4, total: '650.00' }, delta: '-299.70', percent: null,
    });
    assert.equal(uyu.comparable, false, 'noviembre sigue abierto: no hay porcentaje comparable');
    assert.deepEqual(uyu.categories.map((entry) => [entry.name, entry.count, entry.total, entry.share]),
      [['Alimentación', 3, '350.00', '99.91'], ['Transporte', 2, '0.30', '0.09']]);
    // 0,10 + 0,20 = 0,30 exactos en SUM(numeric).
    assert.equal(uyu.categories[1].total, '0.30');
    assert.deepEqual((await check({ ...november, currency: 'USD' })).indicator.current, { count: 1, total: '300.00' });
    assert.deepEqual((await check({ ...november, currency: 'EUR' })).indicator.current, { count: 1, total: '45.67' });

    // RF-018: dos hijas 100 + 200 y 50 sin hija → el padre suma 350, no el doble.
    const food = await check({ ...november, currency: 'UYU', category_id: c.food });
    assert.deepEqual(food.categories.map((entry) => [entry.name, entry.total, entry.share]), [['Alimentación', '350.00', '100.00']]);
    assert.deepEqual(food.children.map((entry) => [entry.name, entry.count, entry.total, entry.share]),
      [['Restaurantes', 1, '200.00', '57.14'], ['Supermercado', 1, '100.00', '28.57'], [null, 1, '50.00', '14.29']]);
    const childCents = food.children.reduce((total, entry) => total + toCents(entry.total), 0n);
    assert.equal(fromCents(childCents), food.indicator.current.total);
    assert.equal(food.children.reduce((total, entry) => total + entry.count, 0), food.indicator.current.count);

    const market = await check({ ...november, currency: 'UYU', category_id: c.food, subcategory_id: c.market });
    assert.deepEqual(market.indicator.current, { count: 1, total: '100.00' });
    assert.deepEqual(market.children.map((entry) => entry.share), ['100.00']);
    const loose = await check({ ...november, currency: 'UYU', category_id: c.food, unclassified_child: true });
    assert.deepEqual(loose.indicator.current, { count: 1, total: '50.00' });
    assert.deepEqual(loose.children.map((entry) => entry.id), [null]);
  });

  await t.test('comparaciones válidas, base ausente y categorías presentes en un solo período', async () => {
    await user('a');
    // Octubre cerrado frente a agosto cerrado: 650,00 − 1.000,99 = −350,99 → −35,06 %.
    const closed = await check({ ...october, currency: 'UYU' }, { from: '2026-08-01', to: '2026-08-31' });
    assert.equal(closed.comparable, true);
    assert.deepEqual([closed.indicator.delta, closed.indicator.percent], ['-350.99', '-35.06']);
    assert.deepEqual(closed.category_comparisons.map((entry) => [entry.name, entry.current.total, entry.reference.total, entry.delta, entry.percent]), [
      ['Alimentación', '550.00', null, null, null],
      ['Mascotas', null, '1000.99', null, null],
      ['Transporte', '0.01', null, null, null],
      ['Vivienda', '99.99', null, null, null],
    ]);
    // Septiembre no tiene UYU: sin base no se inventa una variación.
    const noBase = await check({ ...october, currency: 'UYU' }, { from: '2026-09-01', to: '2026-09-30' });
    assert.equal(noBase.comparable, true);
    assert.deepEqual(noBase.indicator, { current: { count: 4, total: '650.00' }, reference: { count: 0, total: null }, delta: null, percent: null });
    // Período actual vacío frente a una referencia con datos: nunca −100 %.
    const empty = await check({ from: '2026-07-01', to: '2026-07-31', currency: 'UYU' }, { from: '2026-06-01', to: '2026-06-30' });
    assert.deepEqual(empty.indicator, { current: { count: 0, total: null }, reference: { count: 1, total: '33.33' }, delta: null, percent: null });
    assert.deepEqual(empty.categories, []);
    assert.deepEqual(empty.category_comparisons.map((entry) => [entry.name, entry.current, entry.delta]),
      [['Alimentación', { count: 0, total: null }, null]]);
    // Octubre frente a junio, ambos cerrados: 550,00 − 33,33 = 516,67 → 1.550,165… % → 1.550,17 %.
    const mixed = await check({ from: '2026-10-01', to: '2026-10-31', currency: 'UYU' }, { from: '2026-06-01', to: '2026-06-30' });
    assert.deepEqual(mixed.category_comparisons.find((entry) => entry.name === 'Alimentación'),
      { id: c.food, name: 'Alimentación', current: { count: 2, total: '550.00' }, reference: { count: 1, total: '33.33' },
        delta: '516.67', percent: '1550.17' });
    // Sin referencia: comparación vacía y referencia nula.
    const alone = await check({ ...november, currency: 'UYU' });
    assert.deepEqual([alone.reference, alone.comparable, alone.indicator.reference, alone.category_comparisons], [null, null, null, []]);
  });

  await t.test('reglas de equivalencia de períodos (ARCH-01 §9)', async () => {
    await user('a');
    const cases = [
      [october, { from: '2026-09-01', to: '2026-09-30' }, true, 'meses completos de 31 y 30 días'],
      [{ from: '2026-10-01', to: '2026-10-22' }, { from: '2026-09-01', to: '2026-09-22' }, true, 'mismos días cerrados'],
      [{ from: '2026-11-01', to: '2026-11-22' }, { from: '2026-10-01', to: '2026-10-22' }, true, 'mes en curso hasta ayer'],
      [{ from: '2026-11-01', to: '2026-11-23' }, { from: '2026-10-01', to: '2026-10-23' }, false, 'incluye hoy'],
      [november, october, false, 'mes en curso frente a mes cerrado'],
      [{ from: '2025-01-01', to: '2025-12-31' }, { from: '2024-01-01', to: '2024-12-31' }, true, 'años de 365 y 366 días'],
      [{ from: '2026-07-01', to: '2026-09-30' }, { from: '2026-04-01', to: '2026-06-30' }, true, 'trimestres'],
      [october, { from: '2026-08-01', to: '2026-08-15' }, false, 'duraciones desiguales'],
      [{ from: '2026-10-02', to: '2026-10-31' }, { from: '2026-09-01', to: '2026-09-30' }, true, 'mismo número de días (30)'],
      [{ from: '2026-10-02', to: '2026-10-31' }, { from: '2026-09-01', to: '2026-09-29' }, false, '30 días frente a 29'],
    ];
    for (const [current, reference, expected, label] of cases) {
      const result = await check({ ...current, currency: 'UYU' }, reference);
      assert.equal(result.comparable, expected, label);
    }
  });

  await t.test('redondeo único de porcentajes, mitad lejos de cero', async () => {
    await user('b');
    const own = await scalar('select api.get_catalog() as result');
    const services = own.categories.find((entry) => entry.name === 'Servicios').id;
    const add = (amount, date) => scalar('select api.create_expense($1, $2, $3, $4, $5) as result',
      [randomUUID(), amount, 'EUR', date, services]);
    await add('200.00', '2025-01-10');
    await add('200.01', '2025-02-10');
    await add('199.99', '2025-03-10');
    await add('3.00', '2025-04-10');
    await add('4.00', '2025-05-10');
    const pct = async (current, reference) => (await stats({ ...current, currency: 'EUR' }, reference)).indicator.percent;
    const month = (m) => ({ from: `2025-${m}-01`, to: `2025-${m}-${m === '02' ? '28' : m === '04' ? '30' : '31'}` });
    assert.equal(await pct(month('02'), month('01')), '0.01'); // +0,005 % → 0,01
    assert.equal(await pct(month('03'), month('01')), '-0.01'); // −0,005 % → −0,01
    assert.equal(await pct(month('05'), month('04')), '33.33');
    assert.equal(await pct(month('04'), month('05')), '-25.00');
  });

  await t.test('gastos por mes: posiciones vacías, cambio de año y bloques de 60 meses', async () => {
    await user('a');
    const year = await check({ ...last12, currency: 'UYU' }, { from: '2024-12-01', to: '2025-11-30' });
    assert.deepEqual(year.months.map((entry) => [entry.month, entry.count, entry.total]), [
      ['2025-12', 1, '70.00'], ['2026-01', 0, null], ['2026-02', 0, null], ['2026-03', 0, null], ['2026-04', 0, null],
      ['2026-05', 0, null], ['2026-06', 1, '33.33'], ['2026-07', 0, null], ['2026-08', 2, '1000.99'],
      ['2026-09', 0, null], ['2026-10', 4, '650.00'], ['2026-11', 5, '350.30'],
    ]);
    assert.deepEqual(year.indicator.current, { count: 13, total: '2104.62' });
    assert.deepEqual(year.months[1], { month: '2026-01', from: '2026-01-01', to: '2026-01-31', count: 0, total: null });
    // Participación sobre el total real, redondeada una sola vez y sin reajustes.
    assert.deepEqual(year.categories.map((entry) => [entry.name, entry.total, entry.share]), [
      ['Mascotas', '1000.99', '47.56'], ['Alimentación', '933.33', '44.35'], ['Vivienda', '169.99', '8.08'], ['Transporte', '0.31', '0.01'],
    ]);
    // 1.000,99 / 2.104,62 = 47,5615…; 933,33 / 2.104,62 = 44,3466…; 169,99 / 2.104,62 = 8,0770…
    const monthCents = year.months.reduce((total, entry) => total + (entry.total ? toCents(entry.total) : 0n), 0n);
    assert.equal(fromCents(monthCents), year.indicator.current.total);

    // Rango libre que recorta extremos: del 15/12/2016 al 23/11/2026 son 120 meses en dos bloques.
    const long = { from: '2016-12-15', to: '2026-11-23', currency: 'UYU' };
    const first = await check(long);
    const second = await check(long, null, 60);
    assert.equal(first.months.length, 60);
    assert.deepEqual([first.months[0].from, first.months.at(-1).month, first.month_next_offset], ['2016-12-15', '2021-11', 60]);
    assert.deepEqual([second.months.length, second.months[0].month, second.months.at(-1).to, second.month_next_offset],
      [60, '2021-12', '2026-11-23', null]);
    assert.deepEqual(first.indicator, second.indicator);
    const blocks = [...first.months, ...second.months].reduce((total, entry) => total + (entry.total ? toCents(entry.total) : 0n), 0n);
    assert.equal(fromCents(blocks), first.indicator.current.total);
    // n7 (30/11) queda fuera porque el rango termina el 23/11.
    assert.ok(second.months.at(-1).total === '300.30');
    await rejects(stats(long, null, 120), 'INVALID_OFFSET', 'PT422');
    // Extremos del calendario.
    const edge = await stats({ from: '0001-01-01', to: '0001-03-31', currency: 'UYU' });
    assert.deepEqual(edge.months.map((entry) => entry.month), ['0001-01', '0001-02', '0001-03']);
    const far = await stats({ from: '9999-12-01', to: '9999-12-31', currency: 'UYU' });
    assert.deepEqual(far.months, [{ month: '9999-12', from: '9999-12-01', to: '9999-12-31', count: 0, total: null }]);
  });

  await t.test('categorías y subcategorías archivadas siguen contabilizadas', async () => {
    await user('a');
    const august = await check({ from: '2026-08-01', to: '2026-08-31', currency: 'UYU', category_id: pets });
    assert.deepEqual(august.indicator.current, { count: 2, total: '1000.99' });
    assert.deepEqual(august.children.map((entry) => [entry.name, entry.total, entry.share]),
      [['Veterinaria', '1000.00', '99.90'], [null, '0.99', '0.10']]);
    const child = await check({ from: '2026-08-01', to: '2026-08-31', currency: 'UYU', category_id: pets, subcategory_id: vet });
    assert.deepEqual(child.indicator.current, { count: 1, total: '1000.00' });
    // Renombrar no altera importes: los nombres se resuelven por ID en cada lectura.
    await scalar("select api.update_category('category', $1, '{\"name\":\"Animales\"}') as result", [pets]);
    names.set(pets, 'Animales');
    const renamed = await check({ from: '2026-08-01', to: '2026-08-31', currency: 'UYU' });
    assert.deepEqual(renamed.categories.map((entry) => [entry.name, entry.total]), [['Animales', '1000.99']]);
    assert.equal((await annual('UYU', 2026, pets)).label, 'Animales');
    await scalar("select api.update_category('category', $1, '{\"name\":\"Mascotas\"}') as result", [pets]);
    names.set(pets, 'Mascotas');
  });

  await t.test('RF-020 · ventana inicial, huecos, año parcial y variaciones anuales', async () => {
    await user('a');
    const food = await annual('UYU', null, c.food);
    assert.deepEqual(food, expectedAnnual(rows, names, { currency: 'UYU', endYear: 2026, categoryId: c.food }, TODAY));
    assert.deepEqual(food.points, [
      { year: 2022, count: 0, total: null, partial: false, delta: null, percent: null },
      { year: 2023, count: 2, total: '500.00', partial: false, delta: null, percent: null },
      { year: 2024, count: 1, total: '600.00', partial: false, delta: '100.00', percent: '20.00' },
      { year: 2025, count: 1, total: '540.00', partial: false, delta: '-60.00', percent: '-10.00' },
      { year: 2026, count: 6, total: '933.33', partial: true, delta: null, percent: null },
    ]);
    assert.deepEqual([food.start_year, food.end_year, food.previous_end_year, food.next_end_year, food.label],
      [2022, 2026, 2021, null, 'Alimentación']);

    // Bloque anterior y regreso: 2017 compara con 2016 fuera del bloque; 2018–2020 sin registros.
    const older = await annual('UYU', 2021, c.food);
    assert.deepEqual(older, expectedAnnual(rows, names, { currency: 'UYU', endYear: 2021, categoryId: c.food }, TODAY));
    assert.deepEqual(older.points.map((point) => [point.year, point.total, point.delta, point.percent]), [
      [2017, '33.33', '22.22', '200.00'], [2018, null, null, null], [2019, null, null, null], [2020, null, null, null], [2021, '70.00', null, null],
    ]);
    assert.deepEqual([older.previous_end_year, older.next_end_year], [2016, 2026]);
    assert.deepEqual(await annual('UYU', older.next_end_year, c.food), food);
    const oldest = await annual('UYU', 2016, c.food);
    assert.deepEqual(oldest.points.map((point) => [point.year, point.total]), [[2012, null], [2013, null], [2014, null], [2015, null], [2016, '11.11']]);

    // Todas las categorías y cambio de moneda dentro del mismo bloque.
    const all = await annual('UYU');
    assert.deepEqual(all, expectedAnnual(rows, names, { currency: 'UYU', endYear: 2026 }, TODAY));
    assert.deepEqual(all.points.map((point) => [point.year, point.count, point.total, point.delta, point.percent]), [
      [2022, 0, null, null, null], [2023, 2, '500.00', null, null], [2024, 2, '1000.00', '500.00', '100.00'],
      [2025, 2, '610.00', '-390.00', '-39.00'], [2026, 12, '2034.62', null, null],
    ]);
    const usd = await annual('USD', 2026, c.food);
    assert.deepEqual(usd.points.map((point) => [point.year, point.total]), [[2022, null], [2023, null], [2024, '999.00'], [2025, null], [2026, '300.00']]);
    assert.deepEqual(usd, expectedAnnual(rows, names, { currency: 'USD', endYear: 2026, categoryId: c.food }, TODAY));
    // Subcategoría: puntos aislados con huecos intermedios.
    const market = await annual('UYU', 2026, c.food, c.market);
    assert.deepEqual(market, expectedAnnual(rows, names, { currency: 'UYU', endYear: 2026, categoryId: c.food, subcategoryId: c.market }, TODAY));
    assert.deepEqual(market.points.map((point) => [point.year, point.total, point.delta]),
      [[2022, null, null], [2023, '200.00', null], [2024, null, null], [2025, null, null], [2026, '350.00', null]]);
    assert.equal(market.label, 'Alimentación · Supermercado');
    // Categoría e hija archivadas.
    assert.deepEqual((await annual('UYU', 2026, pets, vet)).points.at(-1).total, '1000.00');
    // Inicio del calendario: bloques cortos y sin anterior.
    const start = await annual('UYU', 3);
    assert.deepEqual([start.start_year, start.points.length, start.previous_end_year, start.next_end_year], [1, 3, null, 8]);
    assert.deepEqual((await annual('UYU', 1)).points.map((point) => point.year), [1]);
  });

  await t.test('Estadísticas e Historial coinciden en cada agregado', async () => {
    await user('a');
    const same = async (filters, expected) => {
      const listed = await listAll(filters);
      assert.deepEqual(metric(listed), { count: expected.count, total: expected.total }, JSON.stringify(filters));
    };
    for (const currency of ['UYU', 'USD', 'EUR']) {
      const result = await stats({ ...last12, currency });
      await same({ ...last12, currency }, result.indicator.current);
      for (const month of result.months) await same({ from: month.from, to: month.to, currency }, month);
      for (const category of result.categories) {
        await same({ ...last12, currency, category_id: category.id }, category);
        const detail = await stats({ ...last12, currency, category_id: category.id });
        for (const entry of detail.children) {
          await same({ ...last12, currency, category_id: category.id, ...(entry.id ? { subcategory_id: entry.id } : { unclassified_child: true }) }, entry);
        }
      }
    }
    for (const [categoryId, subcategoryId] of [[null, null], [c.food, null], [c.food, c.market], [pets, vet]]) {
      for (const endYear of [2026, 2021]) {
        const series = await annual('UYU', endYear, categoryId, subcategoryId);
        for (const point of series.points) {
          await same({ from: `${String(point.year).padStart(4, '0')}-01-01`, to: `${String(point.year).padStart(4, '0')}-12-31`, currency: 'UYU',
            ...(categoryId ? { category_id: categoryId } : {}), ...(subcategoryId ? { subcategory_id: subcategoryId } : {}) }, point);
        }
      }
    }
  });

  await t.test('editar fecha, importe, moneda y categoría, y eliminar el último gasto', async () => {
    await user('a');
    const live = async (key) => scalar('select api.get_expense($1) as result', [byKey[key].id]);
    const edit = async (key, patch) => {
      const current = await live(key);
      const next = { ...current, ...patch };
      await scalar('select api.update_expense($1, $2, $3, $4, $5, $6, $7, $8) as result', [current.id, current.version,
        next.amount, next.currency, next.spent_on, next.category_id, next.subcategory_id, next.description]);
      Object.assign(byKey[key], { amount: next.amount, currency: next.currency, spent_on: next.spent_on,
        category_id: next.category_id, subcategory_id: next.subcategory_id });
    };
    const total = async (range, currency, extra = {}) => (await stats({ ...range, currency, ...extra })).indicator.current;

    // Noviembre 300 → 200 (RF-023): el total baja exactamente 100.
    const before = await total(november, 'UYU');
    await edit('n2', { amount: '100.00' });
    const after = await total(november, 'UYU');
    assert.equal(fromCents(toCents(before.total) - toCents(after.total)), '100.00');
    await check({ ...november, currency: 'UYU' }, october);
    // Mover de mes: noviembre baja y octubre sube lo mismo, sin duplicar.
    const octoberBefore = await total(october, 'UYU');
    await edit('n2', { spent_on: '2026-10-05' });
    assert.deepEqual(await total(november, 'UYU'), { count: 4, total: '150.30' });
    assert.deepEqual(await total(october, 'UYU'), { count: octoberBefore.count + 1, total: fromCents(toCents(octoberBefore.total) + 10000n) });
    // Cambiar moneda: sale de UYU y entra en USD.
    await edit('n2', { currency: 'USD' });
    assert.deepEqual(await total(october, 'UYU'), octoberBefore);
    assert.deepEqual(await total(october, 'USD'), { count: 2, total: '110.00' });
    // Cambiar categoría: Vivienda desaparece de octubre y aparece Servicios.
    await edit('o3', { category_id: c.services, subcategory_id: null });
    const moved = await check({ ...october, currency: 'UYU' }, { from: '2026-09-01', to: '2026-09-30' });
    assert.ok(!moved.categories.some((entry) => entry.id === c.home));
    assert.deepEqual(moved.categories.find((entry) => entry.id === c.services).total, '99.99');
    await check({ ...last12, currency: 'USD' });

    // Eliminar el único gasto de 2024: la serie queda con hueco y sin descensos ficticios.
    // 2026 ya no incluye n2 (pasó a USD): 933,33 − 200,00 = 733,33.
    const removed = await live('y24a');
    await scalar('select api.delete_expense($1, $2) as result', [removed.id, removed.version]);
    rows.splice(rows.indexOf(byKey.y24a), 1);
    const food = await annual('UYU', 2026, c.food);
    assert.deepEqual(food, expectedAnnual(rows, names, { currency: 'UYU', endYear: 2026, categoryId: c.food }, TODAY));
    assert.deepEqual(food.points.map((point) => [point.year, point.total, point.delta, point.percent]), [
      [2022, null, null, null], [2023, '500.00', null, null], [2024, null, null, null], [2025, '540.00', null, null], [2026, '733.33', null, null],
    ]);
    // Eliminar todo lo de UYU de junio: el mes conserva su lugar vacío y no hay −100 %.
    const june = await live('j1');
    await scalar('select api.delete_expense($1, $2) as result', [june.id, june.version]);
    rows.splice(rows.indexOf(byKey.j1), 1);
    const empty = await check({ from: '2026-06-01', to: '2026-06-30', currency: 'UYU' }, { from: '2026-05-01', to: '2026-05-31' });
    assert.deepEqual(empty.indicator, { current: { count: 0, total: null }, reference: { count: 0, total: null }, delta: null, percent: null });
    assert.deepEqual(empty.months, [{ month: '2026-06', from: '2026-06-01', to: '2026-06-30', count: 0, total: null }]);
    await check({ ...last12, currency: 'UYU' }, { from: '2024-12-01', to: '2025-11-30' });
  });

  await t.test('validación de argumentos', async () => {
    await user('a');
    const base = { ...november, currency: 'UYU' };
    for (const filters of [null, [], {}, { ...base, other: 1 }, { to: base.to, currency: 'UYU' }, { from: base.from, currency: 'UYU' },
      { from: base.from, to: base.to }, { ...base, currency: 'GBP' }, { ...base, currency: 1 }, { ...base, from: '2026-02-30' },
      { ...base, category_id: 'x' }, { ...base, subcategory_id: c.market }, { ...base, unclassified_child: true },
      { ...base, category_id: c.food, subcategory_id: c.market, unclassified_child: true }]) {
      await rejects(stats(filters), 'INVALID_FILTERS', 'PT422');
    }
    await rejects(stats({ ...base, from: '2026-12-01' }), 'INVALID_DATE_RANGE', 'PT422');
    for (const reference of [[], 'x', { from: '2026-10-01' }, { from: '2026-10-01', to: '2026-09-01' }, { from: '2026-10-01', to: '2026-10-31', x: 1 },
      { from: '2026-02-30', to: '2026-03-01' }]) {
      await rejects(stats(base, reference), 'INVALID_REFERENCE', 'PT422');
    }
    await rejects(stats(base, null, -1), 'INVALID_OFFSET', 'PT422');
    await rejects(stats(base, null, 1), 'INVALID_OFFSET', 'PT422');
    await rejects(scalar('select api.get_stats($1, null, null) as result', [JSON.stringify(base)]), 'INVALID_OFFSET', 'PT422');
    await rejects(stats({ ...base, category_id: randomUUID() }), 'CATEGORY_NOT_FOUND', 'PT404');
    await rejects(stats({ ...base, category_id: c.food, subcategory_id: randomUUID() }), 'SUBCATEGORY_NOT_FOUND', 'PT404');
    await rejects(stats({ ...base, category_id: c.transport, subcategory_id: c.market }), 'INVALID_SUBCATEGORY', 'PT422');
    for (const currency of [null, 'usd', 'ARS']) await rejects(annual(currency), 'INVALID_CURRENCY', 'PT422');
    for (const year of [0, -5, 2027]) await rejects(annual('UYU', year), 'INVALID_YEAR', 'PT422');
    await rejects(annual('UYU', 2026, null, c.market), 'INVALID_FILTERS', 'PT422');
    await rejects(annual('UYU', 2026, randomUUID()), 'CATEGORY_NOT_FOUND', 'PT404');
    await rejects(annual('UYU', 2026, c.transport, c.market), 'INVALID_SUBCATEGORY', 'PT422');
    for (const panel of [null, '', 'METRICS', 'overview']) {
      await rejects(scalar('select api.set_favorite($1, true) as result', [panel]), 'INVALID_PANEL', 'PT422');
    }
    await rejects(scalar("select api.set_favorite('metrics', null) as result"), 'INVALID_FAVORITE', 'PT422');
  });

  await t.test('favoritos privados, idempotentes y en orden canónico', async () => {
    await user('a');
    assert.deepEqual((await scalar('select api.get_preferences() as result')).favorites, []);
    for (const panel of ['summary', 'annual', 'metrics', 'annual']) {
      assert.deepEqual(await scalar('select api.set_favorite($1, true) as result', [panel]), { panel, enabled: true });
    }
    assert.deepEqual(await scalar('select api.get_preferences() as result'),
      { currency: 'UYU', favorites: ['metrics', 'annual', 'summary'], today: TODAY });
    assert.deepEqual(await scalar("select api.set_favorite('annual', false) as result"), { panel: 'annual', enabled: false });
    assert.deepEqual(await scalar("select api.set_favorite('annual', false) as result"), { panel: 'annual', enabled: false });
    assert.deepEqual((await scalar('select api.get_preferences() as result')).favorites, ['metrics', 'summary']);
    await user('b');
    assert.deepEqual((await scalar('select api.get_preferences() as result')).favorites, []);
    await scalar("select api.set_favorite('comparison', true) as result");
    // Escrituras directas sobre filas ajenas: RLS las filtra o las rechaza.
    await assert.rejects(db.query("insert into app.favorites values ($1, 'monthly')", [users.a]), /row-level security/);
    assert.equal((await db.query('delete from app.favorites where owner_id = $1 returning panel', [users.a])).rows.length, 0);
    assert.deepEqual((await db.query('select owner_id, panel from app.favorites')).rows, [{ owner_id: users.b, panel: 'comparison' }]);
    await assert.rejects(db.query("update app.favorites set panel = 'monthly'"), /permission denied/);
    await user('a');
    assert.deepEqual((await scalar('select api.get_preferences() as result')).favorites, ['metrics', 'summary']);
  });

  await t.test('aislamiento A/B, plaza, sesión exacta, anónimo y superficie', async () => {
    await user('b');
    const own = await stats({ ...last12, currency: 'UYU' });
    assert.ok(!JSON.stringify(own).includes(c.food));
    assert.deepEqual((await annual('UYU', 2026)).points.slice(0, 4).map((point) => point.count), [0, 0, 0, 0]);
    await rejects(stats({ ...last12, currency: 'UYU', category_id: c.food }), 'CATEGORY_NOT_FOUND', 'PT404');
    await rejects(annual('UYU', 2026, c.food), 'CATEGORY_NOT_FOUND', 'PT404');
    await rejects(stats({ ...last12, currency: 'UYU', category_id: (await scalar('select api.get_catalog() as result')).categories[0].id, subcategory_id: c.market }),
      'SUBCATEGORY_NOT_FOUND', 'PT404');

    for (const [sub, sid] of [[users.outsider, sessions.outsider], [users.a, sessions.b], [users.a, randomUUID()], [users.a, null]]) {
      await asUser(db, sub, sid);
      await rejects(stats({ ...last12, currency: 'UYU' }), 'ACCESS_DENIED', 'PT403');
      await rejects(stats(null), 'ACCESS_DENIED', 'PT403');
      await rejects(annual('UYU'), 'ACCESS_DENIED', 'PT403');
      await rejects(scalar("select api.set_favorite('metrics', true) as result"), 'ACCESS_DENIED', 'PT403');
      assert.equal((await db.query('select count(*)::int as n from app.favorites')).rows[0].n, 0);
    }
    await db.exec('reset role; set role anon;');
    for (const sql of ["select api.get_stats('{}')", "select api.get_annual('UYU')", "select api.set_favorite('metrics', true)"]) {
      await assert.rejects(db.query(sql), /permission denied/);
    }
    await db.exec('reset role');
    const procedures = (await db.query(`select p.proname, p.prosecdef, p.proconfig, p.provolatile,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('service_role', p.oid, 'EXECUTE') as service,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as member
      from pg_proc p where p.oid in ('api.get_stats(jsonb,jsonb,integer)'::regprocedure, 'api.get_annual(text,integer,uuid,uuid)'::regprocedure,
        'api.set_favorite(text,boolean)'::regprocedure, 'api.get_preferences()'::regprocedure) order by p.proname`)).rows;
    assert.deepEqual(procedures.map((fn) => [fn.proname, fn.prosecdef, fn.proconfig, fn.provolatile, fn.anon, fn.service, fn.member]), [
      ['get_annual', false, ['search_path=""'], 's', false, false, true],
      ['get_preferences', false, ['search_path=""'], 's', false, false, true],
      ['get_stats', false, ['search_path=""'], 's', false, false, true],
      ['set_favorite', false, ['search_path=""'], 'v', false, false, true],
    ]);
    assert.equal((await db.query("select relrowsecurity as value from pg_class where oid = 'app.favorites'::regclass")).rows[0].value, true);
    assert.equal((await db.query("select has_any_column_privilege('authenticated', 'app.favorites', 'INSERT') as value")).rows[0].value, true);
    assert.equal((await db.query("select has_any_column_privilege('anon', 'app.favorites', 'INSERT') as value")).rows[0].value, false);
    for (const [privilege, expected] of [['SELECT', true], ['INSERT', false], ['DELETE', true], ['UPDATE', false], ['TRUNCATE', false]]) {
      assert.equal((await db.query("select has_table_privilege('authenticated', 'app.favorites', $1) as value", [privilege])).rows[0].value, expected, privilege);
      assert.equal((await db.query("select has_table_privilege('anon', 'app.favorites', $1) as value", [privilege])).rows[0].value, false, privilege);
    }
    const policies = (await db.query("select policyname, cmd, qual, with_check from pg_policies where schemaname = 'app' and tablename = 'favorites' order by policyname")).rows;
    assert.deepEqual(policies.map((policy) => [policy.policyname, policy.cmd]), [['delete_own', 'DELETE'], ['insert_own', 'INSERT'], ['read_own', 'SELECT']]);
    for (const policy of policies) assert.match(policy.qual ?? policy.with_check, /auth\.uid\(\).*private\.allowed\(\)/s);
  });
});
