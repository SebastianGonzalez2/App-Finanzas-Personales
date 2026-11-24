import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { asUser, createTestDatabase, freezeTodaySql, sessions, users } from './fixture.js';
import { expectedBudgets, expectedStats } from './oracle.js';

const TODAY = '2026-11-23';

// IMP-05 · RF-024 a RF-027. Cada resultado se contrasta con importes escritos a mano
// (comentarios y literales) y con el modelo independiente de oracle.js (BigInt, sin SQL).
test('IMP-05 · presupuestos mensuales contra valores calculados a mano y un modelo independiente', async (t) => {
  const db = await createTestDatabase({ today: TODAY });
  t.after(() => db.close());
  const scalar = async (sql, args) => (await db.query(sql, args)).rows[0]?.result;
  const user = (key) => asUser(db, users[key], sessions[key]);
  const rejects = (promise, message, code) => assert.rejects(promise, (error) => {
    assert.equal(error.message, message);
    if (code) assert.equal(error.code, code);
    return true;
  });
  const budgets = (currency) => scalar('select api.get_budgets(currency => $1) as result', [currency]);
  const createBudget = (category_id, currency, limit) => scalar(
    'select api.create_budget(category_id => $1, currency => $2, monthly_limit => $3) as result', [category_id, currency, limit]);
  const updateBudget = (category_id, currency, limit) => scalar(
    'select api.update_budget(category_id => $1, currency => $2, monthly_limit => $3) as result', [category_id, currency, limit]);
  const deleteBudget = (category_id, currency) => scalar(
    'select api.delete_budget(category_id => $1, currency => $2) as result', [category_id, currency]);
  const stats = (filters, reference = null) => scalar('select api.get_stats(filters => $1, reference => $2) as result',
    [JSON.stringify(filters), reference && JSON.stringify(reference)]);
  async function freeze(today) {
    await db.exec('reset role');
    await db.exec(freezeTodaySql(today));
    await user('a');
  }
  async function listAll(filters) {
    const rows = [];
    let cursor = null;
    do {
      const page = await scalar('select api.list_expenses(filters => $1, "limit" => 100, cursor => $2) as result',
        [JSON.stringify(filters), cursor]);
      rows.push(...page.items);
      cursor = page.next_cursor;
    } while (cursor);
    return rows;
  }

  await user('a');
  const catalog = await scalar('select api.get_catalog() as result');
  const parent = (name) => catalog.categories.find((row) => row.name === name).id;
  const child = (name) => catalog.subcategories.find((row) => row.name === name).id;
  const c = {
    food: parent('Alimentación'), transport: parent('Transporte'), home: parent('Vivienda'), services: parent('Servicios'),
    health: parent('Salud'), market: child('Supermercado'), rest: child('Restaurantes'), taxi: child('Taxi/Uber'),
  };
  const names = new Map(catalog.categories.map((row) => [row.id, row.name]));

  // Registro local de los gastos vivos y de los límites, para el modelo independiente.
  const ledger = new Map();
  const limits = new Map();
  const key = (category_id, currency) => category_id + '/' + currency;
  async function spend(spent_on, currency, amount, category_id, subcategory_id = null) {
    const id = randomUUID();
    const { expense } = await scalar('select api.create_expense($1, $2, $3, $4, $5, $6) as result',
      [id, amount, currency, spent_on, category_id, subcategory_id]);
    ledger.set(id, { id, spent_on, currency, amount, category_id, subcategory_id, version: expense.version });
    return id;
  }
  async function edit(id, patch) {
    const row = { ...ledger.get(id), ...patch };
    const updated = await scalar('select api.update_expense($1, $2, $3, $4, $5, $6, $7, null) as result',
      [id, row.version, row.amount, row.currency, row.spent_on, row.category_id, row.subcategory_id]);
    ledger.set(id, { ...row, version: updated.version });
  }
  async function drop(id) {
    await scalar('select api.delete_expense($1, $2) as result', [id, ledger.get(id).version]);
    ledger.delete(id);
  }
  const rememberLimit = (category_id, currency, monthly_limit) => limits.set(key(category_id, currency), { category_id, currency, monthly_limit });
  async function check(currency, today = TODAY) {
    const actual = await budgets(currency);
    assert.deepEqual(actual, expectedBudgets([...ledger.values()], [...limits.values()], names, currency, today), currency);
    return actual;
  }
  const item = (response, category_id) => response.items.find((entry) => entry.category_id === category_id);

  await t.test('RF-024 · crear un límite válido, sin gastos consume 0,00', async () => {
    const created = await createBudget(c.health, 'UYU', '2500');
    rememberLimit(c.health, 'UYU', '2500.00');
    assert.deepEqual(created, {
      category_id: c.health, category_name: 'Salud', currency: 'UYU',
      monthly_limit: '2500.00', spent: '0.00', remaining: '2500.00', percent: '0.00',
    });
    assert.deepEqual(await check('UYU'), { month: '2026-11', currency: 'UYU', items: [created] });
    // ARCH-01 §8: en noviembre, sin presupuestos USD, la lista está vacía.
    assert.deepEqual(await budgets('USD'), { month: '2026-11', currency: 'USD', items: [] });
  });

  await t.test('RF-024/025 · ejemplo obligatorio: gastos anteriores al límite, subcategorías y otra moneda', async () => {
    // Gastos registrados ANTES de crear el límite de Alimentación.
    await spend('2026-11-03', 'UYU', '2000', c.food, c.market);
    await spend('2026-11-08', 'UYU', '3000', c.food, c.rest);
    await spend('2026-11-09', 'USD', '50', c.food);
    const created = await createBudget(c.food, 'UYU', '15000');
    rememberLimit(c.food, 'UYU', '15000.00');
    // 2.000 + 3.000 = 5.000 consumidos; 15.000 − 5.000 = 10.000; 100 × 5.000 / 15.000 = 33,33 %. USD 50 no interviene.
    assert.deepEqual(created, {
      category_id: c.food, category_name: 'Alimentación', currency: 'UYU',
      monthly_limit: '15000.00', spent: '5000.00', remaining: '10000.00', percent: '33.33',
    });
    await check('UYU');
    assert.deepEqual(await budgets('USD'), { month: '2026-11', currency: 'USD', items: [] });
    // Un gasto sin subcategoría también cuenta, una sola vez: 5.000 + 250,50 = 5.250,50 → 35,00 %.
    await spend('2026-11-10', 'UYU', '250.50', c.food);
    const after = item(await check('UYU'), c.food);
    assert.deepEqual([after.spent, after.remaining, after.percent], ['5250.50', '9749.50', '35.00']);
    // Límite USD independiente: solo los 50 USD.
    const usd = await createBudget(c.food, 'USD', '200');
    rememberLimit(c.food, 'USD', '200.00');
    assert.deepEqual([usd.spent, usd.remaining, usd.percent], ['50.00', '150.00', '25.00']);
    await check('USD');
  });

  await t.test('rechazar límites, monedas y categorías inválidas', async () => {
    for (const invalid of ['0', '0.00', '0.001', '-1', '1e3', 'abc', '1.234', '', ' 5', '5 ', '1,5', '1000000000000', 'NaN', null]) {
      await rejects(createBudget(c.transport, 'UYU', invalid), 'INVALID_MONTHLY_LIMIT', 'PT422');
      await rejects(updateBudget(c.food, 'UYU', invalid), 'INVALID_MONTHLY_LIMIT', 'PT422');
    }
    for (const invalid of ['uyu', 'GBP', '', null]) {
      await rejects(createBudget(c.transport, invalid, '10'), 'INVALID_CURRENCY', 'PT422');
      await rejects(budgets(invalid), 'INVALID_CURRENCY', 'PT422');
      await rejects(deleteBudget(c.food, invalid), 'INVALID_CURRENCY', 'PT422');
    }
    await rejects(createBudget(null, 'UYU', '10'), 'INVALID_CATEGORY', 'PT422');
    await rejects(createBudget(randomUUID(), 'UYU', '10'), 'CATEGORY_NOT_FOUND', 'PT404');
    // Ningún límite por subcategoría: su id no es una categoría.
    await rejects(createBudget(c.market, 'UYU', '10'), 'CATEGORY_NOT_FOUND', 'PT404');
    // Extremos válidos del dominio monetario.
    const top = await createBudget(c.services, 'EUR', '999999999999.99');
    assert.equal(top.monthly_limit, '999999999999.99');
    await deleteBudget(c.services, 'EUR');
    const tiny = await createBudget(c.services, 'EUR', '0.01');
    assert.deepEqual([tiny.monthly_limit, tiny.percent], ['0.01', '0.00']);
    await deleteBudget(c.services, 'EUR');
    await check('UYU');
  });

  await t.test('combinaciones duplicadas: 409 y el límite original se conserva', async () => {
    await rejects(createBudget(c.food, 'UYU', '1'), 'DUPLICATE_BUDGET', 'PT409');
    assert.equal(item(await check('UYU'), c.food).monthly_limit, '15000.00');
    // Otra moneda de la misma categoría es otra combinación (creada arriba en USD).
    assert.equal((await budgets('USD')).items.length, 1);
  });

  await t.test('RF-026 · modificar el límite recalcula restante y porcentaje sin tocar gastos', async () => {
    await db.exec('reset role');
    const before = (await db.query('select id, amount, version, updated_at from app.expenses order by id')).rows;
    await user('a');
    const updated = await updateBudget(c.food, 'UYU', '18000');
    rememberLimit(c.food, 'UYU', '18000.00');
    // 5.250,50 / 18.000 = 29,17 %; restan 12.749,50.
    assert.deepEqual([updated.monthly_limit, updated.spent, updated.remaining, updated.percent],
      ['18000.00', '5250.50', '12749.50', '29.17']);
    await check('UYU');
    await db.exec('reset role');
    assert.deepEqual((await db.query('select id, amount, version, updated_at from app.expenses order by id')).rows, before);
    await user('a');
    await rejects(updateBudget(c.transport, 'UYU', '10'), 'BUDGET_NOT_FOUND', 'PT404');
    await rejects(updateBudget(c.food, 'EUR', '10'), 'BUDGET_NOT_FOUND', 'PT404');
  });

  await t.test('RF-025 · estados: exactamente 100 %, superado y orden por porcentaje y nombre', async () => {
    // Transporte: 3.600 de 3.600 → 100,00 %, restante 0,00.
    await createBudget(c.transport, 'UYU', '3600');
    rememberLimit(c.transport, 'UYU', '3600.00');
    const taxi = await spend('2026-11-20', 'UYU', '3600', c.transport, c.taxi);
    assert.deepEqual(item(await check('UYU'), c.transport), {
      category_id: c.transport, category_name: 'Transporte', currency: 'UYU',
      monthly_limit: '3600.00', spent: '3600.00', remaining: '0.00', percent: '100.00',
    });
    // +240 → 3.840 de 3.600 = 106,67 % con exceso de 240 (remaining −240,00).
    await spend('2026-11-21', 'UYU', '240', c.transport);
    const over = item(await check('UYU'), c.transport);
    assert.deepEqual([over.spent, over.remaining, over.percent], ['3840.00', '-240.00', '106.67']);
    // Vivienda 9.600 de 10.000 = 96 %; Alimentación 29,17 %; Salud 0 %.
    await createBudget(c.home, 'UYU', '10000');
    rememberLimit(c.home, 'UYU', '10000.00');
    await spend('2026-11-01', 'UYU', '9600', c.home);
    const ordered = await check('UYU');
    assert.deepEqual(ordered.items.map((entry) => [entry.category_name, entry.percent]), [
      ['Transporte', '106.67'], ['Vivienda', '96.00'], ['Alimentación', '29.17'], ['Salud', '0.00'],
    ]);
    // Empate de porcentaje: desempata el nombre (Servicios 0 % antes que Salud no; «Salud» < «Servicios»).
    await createBudget(c.services, 'UYU', '100');
    rememberLimit(c.services, 'UYU', '100.00');
    assert.deepEqual((await check('UYU')).items.slice(-2).map((entry) => entry.category_name), ['Salud', 'Servicios']);
    // Un céntimo por encima del límite redondea a 100,00 % pero conserva el exceso.
    await edit(taxi, { amount: '3360.01' });
    const cent = item(await check('UYU'), c.transport);
    assert.deepEqual([cent.spent, cent.remaining, cent.percent], ['3600.01', '-0.01', '100.00']);
    await edit(taxi, { amount: '3600.00' });
  });

  await t.test('editar importe, fecha, categoría y moneda; eliminar gastos', async () => {
    const id = await spend('2026-11-15', 'UYU', '1000', c.food, c.market);
    assert.equal(item(await check('UYU'), c.food).spent, '6250.50');
    // Importe 1.000 → 400: 5.250,50 + 400 = 5.650,50.
    await edit(id, { amount: '400' });
    assert.equal(item(await check('UYU'), c.food).spent, '5650.50');
    // Fecha a octubre: sale del mes actual.
    await edit(id, { spent_on: '2026-10-31' });
    assert.equal(item(await check('UYU'), c.food).spent, '5250.50');
    // Vuelve a noviembre y cambia de categoría: pasa de Alimentación a Vivienda.
    await edit(id, { spent_on: '2026-11-30', category_id: c.home, subcategory_id: null });
    let current = await check('UYU');
    assert.deepEqual([item(current, c.food).spent, item(current, c.home).spent], ['5250.50', '10000.00']);
    assert.equal(item(current, c.home).percent, '100.00');
    // Cambia a USD: sale del contador UYU de Vivienda y no entra en el de Alimentación USD.
    await edit(id, { currency: 'USD' });
    current = await check('UYU');
    assert.equal(item(current, c.home).spent, '9600.00');
    assert.equal(item(await check('USD'), c.food).spent, '50.00');
    // Eliminar resta exactamente su importe.
    await drop(id);
    const extra = await spend('2026-11-22', 'UYU', '99.99', c.food);
    assert.equal(item(await check('UYU'), c.food).spent, '5350.49');
    await drop(extra);
    assert.equal(item(await check('UYU'), c.food).spent, '5250.50');
  });

  await t.test('cambio de mes: el límite se conserva y el consumo se reinicia sin sobrantes', async () => {
    // Gastos fuera del mes: 31/10 y 01/12 (futuro) no cuentan en noviembre.
    await spend('2026-10-31', 'UYU', '700', c.food);
    await spend('2026-12-01', 'UYU', '1500', c.food, c.rest);
    assert.equal(item(await check('UYU'), c.food).spent, '5250.50');
    await freeze('2026-12-01');
    // Diciembre: solo 1.500 de 18.000 = 8,33 %; los demás, 0 de su límite.
    const december = await check('UYU', '2026-12-01');
    assert.equal(december.month, '2026-12');
    assert.deepEqual(december.items.map((entry) => [entry.category_name, entry.monthly_limit, entry.spent, entry.percent]), [
      ['Alimentación', '18000.00', '1500.00', '8.33'], ['Salud', '2500.00', '0.00', '0.00'],
      ['Servicios', '100.00', '0.00', '0.00'], ['Transporte', '3600.00', '0.00', '0.00'], ['Vivienda', '10000.00', '0.00', '0.00'],
    ]);
    await freeze('2027-01-15');
    const january = await check('UYU', '2027-01-15');
    assert.equal(january.month, '2027-01');
    assert.ok(january.items.every((entry) => entry.spent === '0.00' && entry.remaining === entry.monthly_limit));
    await freeze(TODAY);
    assert.equal(item(await check('UYU'), c.food).spent, '5250.50');
  });

  await t.test('RF-027 · presupuestos, Estadísticas e Historial coinciden en el mes actual', async () => {
    const month = { from: '2026-11-01', to: '2026-11-30' };
    for (const currency of ['UYU', 'USD', 'EUR']) {
      const filters = { ...month, currency };
      const actual = await stats(filters, { from: '2026-10-01', to: '2026-10-31' });
      assert.deepEqual(actual, expectedStats([...ledger.values()], names, filters, { from: '2026-10-01', to: '2026-10-31' }, TODAY));
      for (const budget of (await budgets(currency)).items) {
        const fromStats = actual.categories.find((entry) => entry.id === budget.category_id);
        assert.equal(budget.spent, fromStats ? fromStats.total : '0.00', budget.category_name);
        const rows = await listAll({ ...filters, category_id: budget.category_id });
        const cents = rows.reduce((total, row) => total + BigInt(row.amount.replace('.', '')), 0n);
        assert.equal(BigInt(budget.spent.replace('.', '')), cents, budget.category_name);
      }
    }
    // Ejemplo de la consigna: Estadísticas 5.000 en Alimentación ⇔ presupuesto 5.000 ⇔ incluido en el total del mes.
    const uyu = await stats({ ...month, currency: 'UYU' });
    assert.equal(uyu.categories.find((entry) => entry.id === c.food).total, item(await budgets('UYU'), c.food).spent);
  });

  await t.test('categoría archivada: sin altas nuevas, el límite existente sigue visible, editable y retirable', async () => {
    await scalar("select api.update_category('category', $1, '{\"archived\":true}') as result", [c.home]);
    await rejects(createBudget(c.home, 'USD', '10'), 'CATEGORY_ARCHIVED', 'PT422');
    const archived = item(await check('UYU'), c.home);
    assert.equal(archived.spent, '9600.00');
    const changed = await updateBudget(c.home, 'UYU', '12000');
    rememberLimit(c.home, 'UYU', '12000.00');
    assert.deepEqual([changed.spent, changed.percent, changed.remaining], ['9600.00', '80.00', '2400.00']);
    await check('UYU');
    await scalar("select api.update_category('category', $1, '{\"archived\":false}') as result", [c.home]);
    const usd = await createBudget(c.home, 'USD', '10');
    assert.equal(usd.spent, '0.00');
    await deleteBudget(c.home, 'USD');
    await scalar("select api.update_category('category', $1, '{\"archived\":true}') as result", [c.home]);
    assert.deepEqual(await deleteBudget(c.home, 'UYU'), { deleted: true });
    limits.delete(key(c.home, 'UYU'));
    await check('UYU');
    await scalar("select api.update_category('category', $1, '{\"archived\":false}') as result", [c.home]);
  });

  await t.test('RF-026 · retirar elimina solo el límite: gastos y estadísticas intactos', async () => {
    const filters = { from: '2026-01-01', to: '2026-12-31', currency: 'UYU' };
    const statsBefore = await stats(filters);
    const annualBefore = await scalar("select api.get_annual('UYU') as result");
    await db.exec('reset role');
    const expensesBefore = (await db.query('select * from app.expenses order by id')).rows;
    await user('a');
    assert.deepEqual(await deleteBudget(c.transport, 'UYU'), { deleted: true });
    limits.delete(key(c.transport, 'UYU'));
    await check('UYU');
    await rejects(deleteBudget(c.transport, 'UYU'), 'BUDGET_NOT_FOUND', 'PT404');
    assert.deepEqual(await stats(filters), statsBefore);
    assert.deepEqual(await scalar("select api.get_annual('UYU') as result"), annualBefore);
    await db.exec('reset role');
    assert.deepEqual((await db.query('select * from app.expenses order by id')).rows, expensesBefore);
    await user('a');
    // Volver a crearlo muestra el consumo vigente del mes, sin historial de límites.
    const again = await createBudget(c.transport, 'UYU', '4000');
    rememberLimit(c.transport, 'UYU', '4000.00');
    assert.deepEqual([again.spent, again.percent], ['3840.00', '96.00']);
    await check('UYU');
  });

  await t.test('aislamiento entre propietarios, plaza, sesión exacta y anónimo', async () => {
    await user('b');
    assert.deepEqual(await budgets('UYU'), { month: '2026-11', currency: 'UYU', items: [] });
    // B no puede leer, crear sobre, modificar ni retirar los límites de A usando sus IDs.
    await rejects(createBudget(c.food, 'USD', '10'), 'CATEGORY_NOT_FOUND', 'PT404');
    await rejects(updateBudget(c.food, 'UYU', '1'), 'BUDGET_NOT_FOUND', 'PT404');
    await rejects(deleteBudget(c.food, 'UYU'), 'BUDGET_NOT_FOUND', 'PT404');
    assert.equal(await scalar('select count(*)::int as result from app.budgets'), 0);
    assert.equal(await scalar('select count(*)::int as result from app.budgets where owner_id = $1', [users.a]), 0);
    await assert.rejects(db.query('insert into app.budgets (owner_id, category_id, currency, monthly_limit) values ($1, $2, $3, $4)',
      [users.a, c.services, 'EUR', '1']), { code: '42501' });
    assert.equal((await db.query('update app.budgets set monthly_limit = 1 where owner_id = $1 returning 1', [users.a])).rows.length, 0);
    assert.equal((await db.query('delete from app.budgets where owner_id = $1 returning 1', [users.a])).rows.length, 0);
    // Un límite propio de B no altera los de A.
    const own = await scalar('select api.get_catalog() as result');
    const bFood = own.categories.find((row) => row.name === 'Alimentación').id;
    await scalar('select api.create_expense($1, $2, $3, $4, $5) as result', [randomUUID(), '77.77', 'UYU', '2026-11-11', bFood]);
    assert.deepEqual(await createBudget(bFood, 'UYU', '100'), {
      category_id: bFood, category_name: 'Alimentación', currency: 'UYU',
      monthly_limit: '100.00', spent: '77.77', remaining: '22.23', percent: '77.77',
    });
    await user('a');
    await check('UYU');
    // Columnas inmutables y privilegios mínimos.
    await db.exec('reset role');
    for (const column of ['owner_id', 'category_id', 'currency']) {
      assert.equal(await scalar("select has_column_privilege('authenticated', 'app.budgets', $1, 'UPDATE') as result", [column]), false);
    }
    assert.equal(await scalar("select has_column_privilege('authenticated', 'app.budgets', 'monthly_limit', 'UPDATE') as result"), true);
    assert.equal(await scalar("select relrowsecurity as result from pg_class where oid = 'app.budgets'::regclass"), true);
    for (const role of ['anon', 'service_role']) {
      for (const fn of ['api.get_budgets(text)', 'api.create_budget(uuid,text,text)', 'api.update_budget(uuid,text,text)',
        'api.delete_budget(uuid,text)', 'private.budget_items(text,uuid)']) {
        assert.equal(await scalar("select has_function_privilege($1, $2, 'EXECUTE') as result", [role, fn]), false, role + ' ' + fn);
      }
      assert.equal(await scalar("select has_table_privilege($1, 'app.budgets', 'SELECT') as result", [role]), false);
    }
    await db.exec('set role anon');
    await assert.rejects(budgets('UYU'), { code: '42501' });
    // Sin plaza, con una sesión de otra persona o con la sesión cerrada: 403 antes de validar.
    await db.exec('reset role');
    await db.query('insert into auth.sessions values ($1, $2)', ['10000000-0000-4000-a000-000000000099', users.a]);
    await db.query('delete from auth.sessions where id = $1', ['10000000-0000-4000-a000-000000000099']);
    for (const [sub, sid] of [[users.outsider, sessions.outsider], [users.a, sessions.b], [users.a, '10000000-0000-4000-a000-000000000099'], [users.a, null]]) {
      await asUser(db, sub, sid);
      for (const call of [() => budgets('UYU'), () => budgets('bad'), () => createBudget(c.food, 'UYU', '-1'),
        () => updateBudget(c.food, 'UYU', '1'), () => deleteBudget(c.food, 'UYU')]) {
        await rejects(call(), 'ACCESS_DENIED', 'PT403');
      }
      assert.equal(await scalar('select count(*)::int as result from app.budgets'), 0);
    }
    await user('a');
    assert.equal((await budgets('UYU')).items.length, 4);
  });
});
