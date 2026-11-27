import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { asUser, createTestDatabase, sessions, users } from './fixture.js';

const seed = {
  'Alimentación': ['Delivery', 'Restaurantes', 'Supermercado'],
  Auto: [], Educación: [], Entretenimiento: [], Impuestos: [], 'Otros gastos': [],
  Ropa: ['Calzado', 'Ropa'], Salud: [], Seguros: [], Servicios: [],
  Transporte: ['Taxi/Uber', 'Transporte público'], Viajes: [],
  Vivienda: ['Alquiler', 'Mantenimiento'],
};

test('IMP-02 · contratos, integridad y aislamiento en PostgreSQL', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const rows = async (sql, args) => (await db.query(sql, args)).rows;
  const scalar = async (sql, args) => (await rows(sql, args))[0].result;
  const rpc = (name, ...args) => {
    const placeholders = args.map((_, i) => '$' + (i + 1)).join(', ');
    return scalar(`select api.${name}(${placeholders}) as result`, args);
  };
  const user = (key) => asUser(db, users[key], sessions[key]);
  const createCategory = (name, parent = null) => rpc('create_category', name, parent);
  const changeCategory = (kind, id, patch) => rpc('update_category', kind, id, JSON.stringify(patch));
  const create = (expense) => rpc('create_expense', expense.id, ...fields(expense));
  const edit = (expense, version) => rpc('update_expense', expense.id, version, ...fields(expense));
  const read = (id) => rpc('get_expense', id);
  const remove = (id, version) => rpc('delete_expense', id, version);

  function draft(category_id, overrides) {
    return {
      id: randomUUID(), amount: '42.1', currency: 'UYU', spent_on: '2024-02-29',
      category_id, subcategory_id: null, description: '  Café  ', ...overrides,
    };
  }
  function fields(e) {
    return [e.amount, e.currency, e.spent_on, e.category_id, e.subcategory_id, e.description];
  }

  await t.test('backfill, nuevas plazas y reprovisión conservan el catálogo de cada persona', async () => {
    const allIds = new Set();
    for (const key of ['a', 'b']) {
      await user(key);
      const { categories, subcategories } = await rpc('get_catalog');
      assert.equal(categories.length, 13);
      assert.equal(subcategories.length, 9);
      for (const category of categories) {
        assert.deepEqual(Object.keys(category).sort(), ['archived', 'id', 'name']);
        const names = subcategories.filter((s) => s.category_id === category.id).map((s) => s.name);
        assert.deepEqual(names.sort(), seed[category.name], category.name);
      }
      for (const entry of [...categories, ...subcategories]) {
        assert.equal(entry.archived, false);
        assert.equal(allIds.has(entry.id), false);
        allIds.add(entry.id);
      }
    }
    await user('a');
    const { categories } = await rpc('get_catalog');
    const renamed = await changeCategory('category', categories[0].id, { name: 'Personalizada', archived: true });
    await db.exec('reset role');
    await db.query('delete from private.members where owner_id = $1', [users.a]);
    await db.query('insert into private.members values (1, $1)', [users.a]);
    await db.query('insert into app.preferences (owner_id) values ($1) on conflict do nothing', [users.a]);
    await db.query('select private.seed_catalog($1)', [users.a]);
    await user('a');
    const catalog = await rpc('get_catalog');
    assert.equal(catalog.categories.length, 13);
    assert.equal(catalog.subcategories.length, 9);
    assert.deepEqual(catalog.categories.find((c) => c.id === renamed.id), renamed);
  });

  await t.test('normalización, unicidad y administración de ambos niveles', async () => {
    await user('a');
    const parent = await createCategory('  Gasto\t  de prueba  ');
    assert.equal(parent.name, 'Gasto de prueba');
    const second = await createCategory('Segundo padre');
    const child = await createCategory('  Aviso  ', parent.id);
    assert.equal(child.category_id, parent.id);
    await createCategory('Aviso', second.id);
    await assert.rejects(createCategory(' gasto DE\nprueba'), { code: 'PT409' });
    await assert.rejects(createCategory('AVISO', parent.id), { code: 'PT409' });
    await createCategory('Óptica\u00a0y lentes');
    await assert.rejects(createCategory('óPTICA Y  LENTES'), { code: 'PT409' });
    await assert.rejects(changeCategory('category', second.id, { name: 'GASTO de prueba' }), { code: 'PT409' });
    for (const patch of [{}, { extra: 1 }, { name: null }, { archived: 'true' }]) {
      await assert.rejects(changeCategory('category', parent.id, patch), { code: 'PT422' });
    }
    for (const name of [' \t ', 'x'.repeat(81)]) {
      await assert.rejects(createCategory(name), { code: 'PT422' });
    }
    const renamed = await changeCategory('subcategory', child.id, { name: '  Nuevo  nombre ', archived: true });
    assert.equal(renamed.name, 'Nuevo nombre');
    assert.equal(renamed.archived, true);
    await assert.rejects(createCategory('nuevo NOMBRE', parent.id), { code: 'PT409' });
    assert.equal((await changeCategory('subcategory', child.id, { archived: false })).archived, false);
    await changeCategory('category', parent.id, { archived: true });
    await assert.rejects(createCategory('Hija', parent.id), { code: 'PT422' });
    await assert.rejects(createCategory('Gasto de prueba'), { code: 'PT409' });
    assert.equal((await changeCategory('category', parent.id, { archived: false })).archived, false);
  });

  await t.test('límites decimales exactos, moneda, fechas, descripción y alta atómica', async () => {
    await user('a');
    const { id: parent } = await createCategory('Validaciones');
    const bad = draft(parent);
    for (const amount of ['0', '-1', '1e2', 'NaN', 'Infinity', '0.001', '1000000000000', '1,20', null]) {
      await assert.rejects(create({ ...bad, amount }), { code: 'PT422' });
    }
    for (const spent_on of ['2023-02-29', '2024-04-31', '0000-01-01', '2024-2-02', 'infinity', null]) {
      await assert.rejects(create({ ...bad, spent_on }), { code: 'PT422' });
    }
    for (const currency of ['GBP', 'usd', null]) await assert.rejects(create({ ...bad, currency }), { code: 'PT422' });
    await assert.rejects(create({ ...bad, description: 'x'.repeat(501) }), { code: 'PT422' });
    const wrong = await createCategory('Hija ajena a este padre', (await createCategory('Otro grupo')).id);
    await assert.rejects(create({ ...bad, subcategory_id: wrong.id }), { code: 'PT422' });
    assert.equal(await scalar('select count(*)::int as result from app.expense_keys where id=$1', [bad.id]), 0);
    for (const [amount, currency, spent_on] of [['0.01', 'USD', '0001-01-01'], ['999999999999.99', 'EUR', '9999-12-31']]) {
      const { expense, replayed } = await create(draft(parent, { amount, currency, spent_on, description: '   ' }));
      assert.equal(replayed, false);
      assert.deepEqual([expense.amount, expense.currency, expense.spent_on, expense.description], [amount, currency, spent_on, null]);
    }
    // Apia skipped this local day in 2011. A civil DATE remains valid in every session.
    const civil = draft(parent, { amount: '0.01', spent_on: '2011-12-30' });
    await db.exec("set time zone 'Pacific/Apia'");
    try {
      assert.equal((await create(civil)).expense.spent_on, civil.spent_on);
    } finally {
      await db.exec("set time zone 'UTC'");
    }
    assert.equal((await create(civil)).replayed, true);
  });

  await t.test('huella canónica, versiones, reintentos después de editar y tombstone', async () => {
    await user('a');
    const parent = await createCategory('Idempotencia');
    const expense = draft(parent.id);
    const first = await create(expense);
    assert.equal(first.expense.version, 1);
    assert.equal(first.expense.spent_on, expense.spent_on);
    assert.equal(first.expense.description, 'Café');
    assert.equal(first.expense.amount, '42.10');
    assert.ok(Number.isFinite(Date.parse(first.expense.created_at)));
    assert.deepEqual(await read(expense.id), first.expense);
    const canonical = ['42.10', 'UYU', '2024-02-29', parent.id, null, 'Café'];
    const fingerprint = createHash('sha256').update('[' + canonical.map((x) => JSON.stringify(x)).join(', ') + ']').digest('hex');
    assert.equal(await scalar('select fingerprint as result from app.expense_keys where id=$1', [expense.id]), fingerprint);
    const update = { ...expense, currency: 'USD', amount: '19.99', spent_on: '2025-01-03' };
    const edited = await edit(update, 1);
    assert.equal(edited.id, expense.id);
    assert.equal(edited.version, 2);
    assert.equal(edited.created_at, first.expense.created_at);
    assert.equal(edited.currency, 'USD');
    assert.deepEqual(await create({ ...expense, amount: '42.10', description: 'Café' }), { replayed: true, expense: edited });
    await assert.rejects(create(update), { code: 'PT409', message: 'ID_REUSED' });
    await assert.rejects(edit(expense, 1), { code: 'PT409' });
    await assert.rejects(remove(expense.id, 1), { code: 'PT409' });
    const duplicateIntent = await create({ ...expense, id: randomUUID() });
    assert.notEqual(duplicateIntent.expense.id, expense.id);
    assert.deepEqual(await remove(expense.id, 2), { id: expense.id, deleted: true });
    await assert.rejects(read(expense.id), { code: 'PT404' });
    await assert.rejects(create(expense), { code: 'PT409', message: 'EXPENSE_REMOVED' });
    assert.equal((await read(duplicateIntent.expense.id)).id, duplicateIntent.expense.id);
  });

  await t.test('edición histórica con padre e hija archivados y restauración independiente', async () => {
    await user('a');
    const parent = await createCategory('Histórica');
    const child = await createCategory('Una hija', parent.id);
    const sibling = await createCategory('Otra hija', parent.id);
    const original = draft(parent.id, { subcategory_id: child.id });
    await create(original);
    await changeCategory('subcategory', child.id, { archived: true, name: 'Histórica renombrada' });
    await changeCategory('category', parent.id, { archived: true });
    assert.equal((await read(original.id)).subcategory_name, 'Histórica renombrada');
    assert.equal((await edit({ ...original, amount: '1' }, 1)).version, 2);
    await assert.rejects(create({ ...original, id: randomUUID() }), { code: 'PT422' });
    await assert.rejects(edit({ ...original, subcategory_id: sibling.id }, 2), { code: 'PT422' });
    assert.equal((await edit({ ...original, subcategory_id: null }, 2)).subcategory_id, null);
    await changeCategory('category', parent.id, { archived: false });
    await assert.rejects(edit(original, 3), { code: 'PT422' });
    assert.equal((await edit({ ...original, subcategory_id: sibling.id }, 3)).subcategory_name, sibling.name);
  });

  await t.test('aislamiento entre propietarios, FK compuestas y eliminación autorizada', async () => {
    await user('a');
    const parent = await createCategory('Grupo común');
    const child = await createCategory('Hijo', parent.id);
    const aExpense = draft(parent.id, { subcategory_id: child.id });
    await create(aExpense);
    await user('b');
    const parentB = await createCategory('Grupo común');
    const bExpense = draft(parentB.id);
    await create(bExpense);
    await assert.rejects(read(aExpense.id), { code: 'PT404' });
    await assert.rejects(remove(aExpense.id, 1), { code: 'PT404' });
    await assert.rejects(edit(aExpense, 1), { code: 'PT404' });
    await assert.rejects(changeCategory('category', parent.id, { name: 'Otro' }), { code: 'PT404' });
    await assert.rejects(create(draft(parent.id)), { code: 'PT404' });
    await assert.rejects(create(draft(parentB.id, { subcategory_id: child.id })), { code: 'PT404' });
    for (const table of ['categories', 'subcategories', 'expense_keys', 'expenses']) {
      assert.equal(await scalar(`select count(*)::int as result from app.${table} where owner_id=$1`, [users.a]), 0);
    }
    await db.exec('reset role');
    // SQL constraints must also hold when a maintenance role bypasses RLS.
    const restrict = (error) => ['23001', '23503'].includes(error.code);
    await assert.rejects(db.query('delete from app.expense_keys where owner_id=$1 and id=$2', [users.a, aExpense.id]), restrict);
    await assert.rejects(db.query('delete from app.categories where owner_id=$1 and id=$2', [users.a, parent.id]), restrict);
    await assert.rejects(db.query('insert into app.subcategories(owner_id,id,category_id,name) values($1,$2,$3,$4)',
      [users.b, randomUUID(), parent.id, 'Huérfana']), { code: '23503' });
    await assert.rejects(db.query('update app.expenses set subcategory_id=$1 where owner_id=$2 and id=$3',
      [child.id, users.b, bExpense.id]), { code: '23503' });
    await user('a');
    await remove(aExpense.id, 1);
    await user('b');
    assert.equal((await read(bExpense.id)).id, bExpense.id);
  });

  await t.test('superficie RPC, privilegios mínimos, RLS y rechazo previo por sesión/plaza', async () => {
    await db.exec('reset role');
    const procedures = await rows(`
      select proname, prosecdef,
        has_function_privilege('anon', oid, 'execute') as anon,
        has_function_privilege('service_role', oid, 'execute') as service,
        has_function_privilege('authenticated', oid, 'execute') as member
      from pg_proc where pronamespace='api'::regnamespace
        and proname <> 'health_check' -- única RPC anónima: se verifica en health-check.test.js
      order by proname`);
    assert.deepEqual(procedures.map((p) => p.proname), [
      'create_budget', 'create_category', 'create_expense', 'create_recurring_payment', 'delete_budget', 'delete_expense',
      'delete_recurring_payment', 'get_annual', 'get_budgets', 'get_catalog', 'get_expense', 'get_preferences', 'get_stats',
      'list_expenses', 'list_recurring_payments', 'set_currency', 'set_favorite', 'update_budget', 'update_category',
      'update_expense', 'update_recurring_payment',
    ]);
    assert.ok(procedures.every((p) => !p.prosecdef && !p.anon && !p.service && p.member));
    const guarded = await rows(`
      select proname, prosecdef, proconfig,
        has_function_privilege('anon', oid, 'execute') as anon,
        has_function_privilege('service_role', oid, 'execute') as service,
        has_function_privilege('authenticated', oid, 'execute') as member
      from pg_proc where pronamespace='private'::regnamespace and proname not in ('allowed','before_user_created')`);
    const callerHelpers = ['budget_currency', 'budget_items', 'budget_limit', 'comparison_json', 'decode_cursor',
      'effective_billing_date', 'encode_cursor', 'equivalent_periods', 'expense_fields', 'expense_json', 'filter_date',
      'filter_uuid', 'lock_expense', 'normalize_name', 'panel_order', 'recurring_fields', 'recurring_payment_json',
      'require_access', 'require_classification', 'stats_filters', 'stats_reference', 'today', 'whitespace_chars'];
    assert.deepEqual(guarded.filter((fn) => fn.member).map((fn) => fn.proname).sort(), callerHelpers);
    for (const fn of guarded) {
      assert.ok(!fn.prosecdef && !fn.anon && !fn.service, fn.proname);
      assert.deepEqual(fn.proconfig, ['search_path=""'], fn.proname);
    }
    for (const table of ['categories', 'subcategories', 'expense_keys', 'expenses']) {
      assert.equal(await scalar('select relrowsecurity as result from pg_class where oid=$1::regclass', ['app.' + table]), true);
      assert.equal(await scalar("select has_column_privilege('authenticated',$1,'owner_id','update') as result", ['app.' + table]), false);
      if (table !== 'expenses') {
        assert.equal(await scalar("select has_table_privilege('authenticated',$1,'delete') as result", ['app.' + table]), false);
      }
    }
    assert.equal(await scalar("select has_column_privilege('authenticated','app.subcategories','category_id','update') as result"), false);
    assert.equal(await scalar("select has_column_privilege('authenticated','app.expense_keys','fingerprint','update') as result"), false);
    const id = randomUUID();
    const denied = [
      () => rpc('get_catalog'), () => createCategory(''), () => changeCategory('invalid', id, {}),
      () => create(draft(id, { amount: '-1' })), () => read(id),
      () => edit(draft(id, { amount: '-1' }), 1), () => remove(id, 1),
    ];
    await db.query('delete from auth.sessions where id=$1', [sessions.a2]);
    for (const [sub, sid] of [[users.outsider, sessions.outsider], [users.a, sessions.b], [users.a, sessions.a2]]) {
      await asUser(db, sub, sid);
      for (const call of denied) await assert.rejects(call(), { code: 'PT403' });
      for (const table of ['categories', 'subcategories', 'expense_keys', 'expenses']) {
        assert.equal(await scalar(`select count(*)::int as result from app.${table}`), 0);
      }
    }
  });
});
