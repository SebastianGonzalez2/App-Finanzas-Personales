import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asUser, createTestDatabase, freezeTodaySql, sessions, users } from './fixture.js';

const TODAY = '2026-11-23';

test('MEJORA 02 · pagos recurrentes mensuales: reglas de negocio, cron, concurrencia, integración y seguridad', async (t) => {
  const db = await createTestDatabase({ today: TODAY });
  t.after(() => db.close());

  const scalar = async (sql, args) => (await db.query(sql, args)).rows[0]?.result;
  const user = (key) => asUser(db, users[key], sessions[key]);
  const rejects = (promise, message, code) => assert.rejects(promise, (error) => {
    assert.equal(error.message, message);
    if (code) assert.equal(error.code, code);
    return true;
  });

  async function freeze(today) {
    await db.exec('reset role');
    await db.exec(freezeTodaySql(today));
    await user('a');
  }

  async function runCron(asOf = null) {
    await db.exec('reset role');
    try {
      return await scalar('select private.process_recurring_payments($1::date) as result', [asOf]);
    } finally {
      await user('a');
    }
  }

  const listRecurring = () => scalar('select api.list_recurring_payments() as result');
  const createRecurring = (args) => scalar(
    'select api.create_recurring_payment($1, $2, $3, $4, $5, $6) as result',
    [args.name, args.amount, args.currency, args.category_id, args.subcategory_id ?? null, args.billing_day],
  );
  const updateRecurring = (id, version, args) => scalar(
    'select api.update_recurring_payment($1, $2, $3, $4, $5, $6, $7, $8) as result',
    [id, version, args.name, args.amount, args.currency, args.category_id, args.subcategory_id ?? null, args.billing_day],
  );
  const deleteRecurring = (id, version) => scalar(
    'select api.delete_recurring_payment($1, $2) as result',
    [id, version],
  );

  await user('a');
  const catalog = await scalar('select api.get_catalog() as result');
  const cat = (name) => catalog.categories.find((c) => c.name === name).id;
  const sub = (name) => catalog.subcategories.find((s) => s.name === name).id;
  const c = {
    food: cat('Alimentación'),
    market: sub('Supermercado'),
    rest: sub('Restaurantes'),
    services: cat('Servicios'),
    fun: cat('Entretenimiento'),
    home: cat('Vivienda'),
    rent: sub('Alquiler'),
  };

  await t.test('validaciones de campos, precisión decimal y categorías activas', async () => {
    for (const invalid of ['', '   ', 'x'.repeat(121), null]) {
      await rejects(createRecurring({ name: invalid, amount: '10', currency: 'USD', category_id: c.fun, billing_day: 15 }), 'INVALID_RECURRING_NAME', 'PT422');
    }
    for (const invalid of ['0', '0.00', '-1', '1.234', '1e3', 'abc', '1000000000000', null]) {
      await rejects(createRecurring({ name: 'Test', amount: invalid, currency: 'USD', category_id: c.fun, billing_day: 15 }), 'INVALID_AMOUNT', 'PT422');
    }
    for (const invalid of ['ARS', 'usd', null]) {
      await rejects(createRecurring({ name: 'Test', amount: '10', currency: invalid, category_id: c.fun, billing_day: 15 }), 'INVALID_CURRENCY', 'PT422');
    }
    for (const invalid of [0, 32, -1, null]) {
      await rejects(createRecurring({ name: 'Test', amount: '10', currency: 'USD', category_id: c.fun, billing_day: invalid }), 'INVALID_BILLING_DAY', 'PT422');
    }
    await rejects(createRecurring({ name: 'Test', amount: '10', currency: 'USD', category_id: null, billing_day: 15 }), 'INVALID_CATEGORY', 'PT422');
    await rejects(createRecurring({ name: 'Test', amount: '10', currency: 'USD', category_id: c.fun, subcategory_id: c.market, billing_day: 15 }), 'INVALID_SUBCATEGORY', 'PT422');
  });

  await t.test('reglas 3, 4 y 5: creación mismo día vs día pasado y sin retroactivos', async () => {
    // Hoy es 2026-11-23. Día 23 (hoy) -> próximo registro 2026-11-23 y se genera hoy mismo.
    const sameDay = await createRecurring({
      name: '  Spotify   Premium ',
      amount: '7.99',
      currency: 'USD',
      category_id: c.fun,
      billing_day: 23,
    });
    assert.equal(sameDay.name, 'Spotify Premium');
    assert.equal(sameDay.next_billing_date, '2026-11-23');

    // Día 15 (ya pasó este mes) -> próximo registro 2026-12-15 (no genera retroactivo en noviembre).
    const pastDay = await createRecurring({
      name: 'Internet Fibra',
      amount: '1850',
      currency: 'UYU',
      category_id: c.services,
      billing_day: 15,
    });
    assert.equal(pastDay.next_billing_date, '2026-12-15');

    const run1 = await runCron();
    assert.equal(run1.processed, 1);
    assert.equal(run1.errors, 0);

    // Idempotencia: una segunda ejecución el mismo día no duplica.
    const run2 = await runCron();
    assert.equal(run2.processed, 0);

    const expenses = await scalar("select api.list_expenses('{}'::jsonb) as result");
    assert.equal(expenses.items.length, 1);
    assert.equal(expenses.items[0].description, 'Spotify Premium');
    assert.equal(expenses.items[0].amount, '7.99');
    assert.equal(expenses.items[0].currency, 'USD');
    assert.equal(expenses.items[0].spent_on, '2026-11-23');
    assert.equal(expenses.items[0].is_recurring, true);

    // next_billing_date de Spotify avanzó a 2026-12-23
    const listed = await listRecurring();
    assert.equal(listed.items.find((i) => i.id === sameDay.id).next_billing_date, '2026-12-23');
  });

  await t.test('reglas 2 y 6: meses de 28, 29 (bisiesto), 30, 31 días, cambio de año y recuperación', async () => {
    // Día 31 creado el 2026-11-23 -> en noviembre (30 días) corresponde 2026-11-30!
    const day31 = await createRecurring({
      name: 'Alquiler',
      amount: '9600',
      currency: 'UYU',
      category_id: c.home,
      subcategory_id: c.rent,
      billing_day: 31,
    });
    assert.equal(day31.next_billing_date, '2026-11-30');

    // Simular falla del cron hasta 2027-03-02: recupera Nov 30, Dic 31, Ene 31, Feb 28 (2027 no bisiesto)
    // además de los meses correspondientes de Spotify e Internet.
    await freeze('2027-03-02');
    const recRun = await runCron();
    assert.equal(recRun.errors, 0);
    // Alquiler: nov 30, dic 31, ene 31, feb 28 (4); Spotify: dic 23, ene 23, feb 23 (3); Internet: dic 15, ene 15, feb 15 (3) -> 10
    assert.equal(recRun.processed, 10);

    const rentExpenses = (await scalar('select api.list_expenses(filters => $1, sort => $2, direction => $3) as result', [
      JSON.stringify({ category_id: c.home }), 'spent_on', 'asc',
    ])).items;
    assert.deepEqual(rentExpenses.map((e) => e.spent_on), [
      '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28',
    ]);

    // Verificar año bisiesto (2024-02-29):
    await freeze('2024-02-01');
    const leap = await createRecurring({
      name: 'Seguro Bisiesto',
      amount: '100',
      currency: 'EUR',
      category_id: c.services,
      billing_day: 31,
    });
    assert.equal(leap.next_billing_date, '2024-02-29');
    await freeze('2024-02-29');
    await runCron();
    const eurExpenses = (await scalar('select api.list_expenses(filters => $1) as result', [
      JSON.stringify({ currency: 'EUR' }),
    ])).items;
    assert.equal(eurExpenses.length, 1);
    assert.equal(eurExpenses[0].spent_on, '2024-02-29');

    // Volver a 2027-03-02 y limpiar Seguro Bisiesto para el resto de pruebas
    await freeze('2027-03-02');
    const leapItem = (await listRecurring()).items.find((i) => i.id === leap.id);
    await deleteRecurring(leapItem.id, leapItem.version);
  });

  await t.test('reglas 7, 9 y 10: edición futura con ocurrencia pendiente congelada, eliminación manual y edición individual', async () => {
    const listed = await listRecurring();
    const internet = listed.items.find((i) => i.name === 'Internet Fibra');
    assert.equal(internet.next_billing_date, '2027-03-15');

    // Avanzar fecha a 2027-03-16 SIN correr el cron aún -> 2027-03-15 está vencida pero pendiente.
    await freeze('2027-03-16');
    const updated = await updateRecurring(internet.id, internet.version, {
      name: 'Internet 1Gbps',
      amount: '2200',
      currency: 'UYU',
      category_id: c.services,
      billing_day: 20,
    });
    // La ocurrencia vencida de marzo quedó congelada con condiciones originales (1850, 2027-03-15),
    // y el nuevo próximo cobro pasa a abril (sin duplicar marzo!).
    assert.equal(updated.next_billing_date, '2027-04-20');

    const cronAfterEdit = await runCron();
    assert.equal(cronAfterEdit.pending_processed, 1);
    assert.equal(cronAfterEdit.processed, 0);

    const marchInternet = (await scalar('select api.list_expenses(filters => $1) as result', [
      JSON.stringify({ from: '2027-03-01', to: '2027-03-31', category_id: c.services }),
    ])).items;
    assert.equal(marchInternet.length, 1);
    assert.equal(marchInternet[0].amount, '1850.00');
    assert.equal(marchInternet[0].description, 'Internet Fibra');
    assert.equal(marchInternet[0].spent_on, '2027-03-15');

    // Regla 9: eliminar manualmente el gasto generado no provoca regeneración ese mes.
    await scalar('select api.delete_expense($1, $2) as result', [marchInternet[0].id, marchInternet[0].version]);
    const cronAfterManualDelete = await runCron();
    assert.equal(cronAfterManualDelete.processed, 0);
    assert.equal(cronAfterManualDelete.pending_processed, 0);
    const marchAfterDelete = (await scalar('select api.list_expenses(filters => $1) as result', [
      JSON.stringify({ from: '2027-03-01', to: '2027-03-31', category_id: c.services }),
    ])).items;
    assert.equal(marchAfterDelete.length, 0);

    // Regla 10: editar individualmente un gasto generado no modifica la configuración del pago recurrente.
    const spotifyFeb = (await scalar('select api.list_expenses(filters => $1) as result', [
      JSON.stringify({ from: '2027-02-01', to: '2027-02-28', currency: 'USD' }),
    ])).items[0];
    await scalar('select api.update_expense($1, $2, $3, $4, $5, $6, $7, $8) as result', [
      spotifyFeb.id, spotifyFeb.version, '99.99', 'USD', spotifyFeb.spent_on, spotifyFeb.category_id, null, 'Editado manual',
    ]);
    const spotifyCfg = (await listRecurring()).items.find((i) => i.name === 'Spotify Premium');
    assert.equal(spotifyCfg.amount, '7.99');
    assert.equal(spotifyCfg.name, 'Spotify Premium');
  });

  await t.test('regla 8: eliminar pago recurrente cancela futuros y conserva gastos históricos', async () => {
    await freeze('2027-04-20');
    const beforeExpenses = (await scalar("select api.list_expenses('{}'::jsonb) as result")).items.length;
    const spotify = (await listRecurring()).items.find((i) => i.name === 'Spotify Premium');
    const res = await deleteRecurring(spotify.id, spotify.version);
    assert.deepEqual(res, { id: spotify.id, deleted: true });

    // Ya no aparece en la lista ni es editable/eliminable
    assert.equal((await listRecurring()).items.some((i) => i.id === spotify.id), false);
    await rejects(deleteRecurring(spotify.id, spotify.version), 'RECURRING_NOT_FOUND', 'PT404');

    // Al correr el cron el 2027-04-20, Spotify NO genera gasto, mientras Internet (día 20) sí genera con su nuevo importe (2200).
    await runCron();
    const aprilExpenses = (await scalar('select api.list_expenses(filters => $1) as result', [
      JSON.stringify({ from: '2027-04-01', to: '2027-04-30' }),
    ])).items;
    assert.equal(aprilExpenses.some((e) => e.description === 'Spotify Premium'), false);
    const internetApril = aprilExpenses.find((e) => e.description === 'Internet 1Gbps');
    assert.equal(internetApril.amount, '2200.00');

    // Los gastos históricos de Spotify se conservan intactos.
    const afterExpenses = (await scalar("select api.list_expenses('{}'::jsonb) as result")).items.length;
    assert.ok(afterExpenses >= beforeExpenses);
  });

  await t.test('regla 11 y presupuestos/estadísticas: categoría archivada bloquea y luego se reanuda', async () => {
    await freeze('2027-05-01');
    const meal = await createRecurring({
      name: 'Vianda mensual',
      amount: '3500',
      currency: 'UYU',
      category_id: c.food,
      subcategory_id: c.market,
      billing_day: 5,
    });
    assert.equal(meal.next_billing_date, '2027-05-05');

    // Archivar subcategoría Supermercado antes del día 5
    await scalar("select api.update_category('subcategory', $1, '{\"archived\":true}') as result", [c.market]);
    await freeze('2027-05-05');
    const blockedRun = await runCron();
    assert.equal(blockedRun.blocked, 1);

    const flagged = (await listRecurring()).items.find((i) => i.id === meal.id);
    assert.equal(flagged.needs_attention, true);
    assert.equal(flagged.last_error_code, 'SUBCATEGORY_ARCHIVED');

    // No se creó ningún gasto con referencia inválida
    const mayFood = (await scalar('select api.list_expenses(filters => $1) as result', [
      JSON.stringify({ from: '2027-05-01', to: '2027-05-31', category_id: c.food }),
    ])).items;
    assert.equal(mayFood.length, 0);

    // Usuario corrige a subcategoría activa Restaurantes -> los próximos meses se registran normalmente
    const fixedMeal = await updateRecurring(flagged.id, flagged.version, {
      name: 'Vianda mensual',
      amount: '3500',
      currency: 'UYU',
      category_id: c.food,
      subcategory_id: c.rest,
      billing_day: 5,
    });
    assert.equal(fixedMeal.needs_attention, false);
    assert.equal(fixedMeal.next_billing_date, '2027-06-05');

    await freeze('2027-06-05');
    await runCron();

    // Verificar integración con get_budgets y get_stats en junio 2027
    await scalar('select api.create_budget($1, $2, $3) as result', [c.food, 'UYU', '7000']);
    const budgets = await scalar("select api.get_budgets('UYU') as result");
    const foodBudget = budgets.items.find((b) => b.category_id === c.food);
    assert.equal(foodBudget.spent, '3500.00');
    assert.equal(foodBudget.percent, '50.00');

    const stats = await scalar('select api.get_stats(filters => $1) as result', [
      JSON.stringify({ from: '2027-06-01', to: '2027-06-30', currency: 'UYU' }),
    ]);
    assert.equal(stats.categories.find((entry) => entry.id === c.food).total, '3500.00');

    await scalar("select api.update_category('subcategory', $1, '{\"archived\":false}') as result", [c.market]);
  });

  await t.test('aislamiento entre usuarios, RLS, ACLs y privilegios de automatización', async () => {
    const aItems = (await listRecurring()).items;
    assert.ok(aItems.length > 0);
    const target = aItems[0];

    await user('b');
    assert.equal((await listRecurring()).items.length, 0);
    await rejects(createRecurring({ name: 'Ajeno', amount: '10', currency: 'UYU', category_id: c.food, billing_day: 10 }), 'CATEGORY_NOT_FOUND', 'PT404');
    await rejects(updateRecurring(target.id, target.version, { name: 'Hack', amount: '1', currency: 'UYU', category_id: c.food, billing_day: 10 }), 'RECURRING_NOT_FOUND', 'PT404');
    await rejects(deleteRecurring(target.id, target.version), 'RECURRING_NOT_FOUND', 'PT404');
    assert.equal(await scalar('select count(*)::int as result from app.recurring_payments'), 0);
    assert.equal(await scalar('select count(*)::int as result from app.recurring_payment_occurrences'), 0);

    await db.exec('reset role');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(await scalar("select has_function_privilege($1, 'private.process_recurring_payments(date)', 'EXECUTE') as result", [role]), false);
    }
    for (const role of ['anon', 'service_role']) {
      for (const fn of [
        'api.list_recurring_payments()',
        'api.create_recurring_payment(text,text,text,uuid,uuid,integer)',
        'api.update_recurring_payment(uuid,integer,text,text,text,uuid,uuid,integer)',
        'api.delete_recurring_payment(uuid,integer)',
      ]) {
        assert.equal(await scalar("select has_function_privilege($1, $2, 'EXECUTE') as result", [role, fn]), false);
      }
    }
    for (const table of ['recurring_payments', 'recurring_payment_occurrences']) {
      assert.equal(await scalar('select relrowsecurity as result from pg_class where oid = $1::regclass', ['app.' + table]), true);
      assert.equal(await scalar("select has_table_privilege('authenticated', $1, 'DELETE') as result", ['app.' + table]), false);
    }

    // Sesión cerrada / anónimo / sin plaza
    await asUser(db, users.outsider, sessions.outsider);
    await rejects(listRecurring(), 'ACCESS_DENIED', 'PT403');
    await db.exec('reset role; set role anon');
    await assert.rejects(listRecurring(), { code: '42501' });
    await db.exec('reset role');
  });
});
