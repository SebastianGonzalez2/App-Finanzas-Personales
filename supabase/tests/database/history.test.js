import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { asUser, createTestDatabase, sessions, users } from './fixture.js';

const orders = [['spent_on', 'desc'], ['spent_on', 'asc'], ['amount', 'desc'], ['amount', 'asc']];
const fingerprint = 'a'.repeat(64);

function compare(sort, direction) {
  const sign = direction === 'asc' ? 1 : -1;
  const key = (row) => sort === 'amount' ? Math.round(Number(row.amount) * 100) : row.spent_on;
  return (left, right) => {
    const a = key(left);
    const b = key(right);
    if (a !== b) return (a < b ? -1 : 1) * sign;
    return (left.id < right.id ? -1 : 1) * sign;
  };
}

test('IMP-03 · list_expenses: filtros, orden, cursor y aislamiento en PostgreSQL', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const user = (key) => asUser(db, users[key], sessions[key]);
  const list = async (args = {}) => (await db.query(
    'select api.list_expenses(filters => $1, q => $2, sort => $3, direction => $4, "limit" => $5, cursor => $6) as result',
    [JSON.stringify(args.filters ?? {}), args.q ?? null, args.sort ?? 'spent_on', args.direction ?? 'desc',
      args.limit ?? 30, args.cursor ?? null],
  )).rows[0].result;
  const rejects = (args, code) => assert.rejects(list(args), (error) => {
    assert.equal(error.message, code);
    return true;
  });
  async function walk(args) {
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const page = await list({ ...args, cursor });
      assert.ok(page.items.length <= (args.limit ?? 30));
      seen.push(...page.items);
      cursor = page.next_cursor;
      pages += 1;
      if (cursor) assert.equal(page.items.length, args.limit ?? 30);
    } while (cursor);
    return { seen, pages };
  }
  // Bulk fixture rows bypass create_expense to model years of history quickly.
  async function seed(owner, rows) {
    await db.exec('reset role');
    for (const row of rows) {
      await db.query('insert into app.expense_keys values ($1, $2, $3)', [owner, row.id, fingerprint]);
      await db.query(`insert into app.expenses (owner_id, id, amount, currency, spent_on, category_id, subcategory_id, description)
        values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [owner, row.id, row.amount, row.currency, row.spent_on, row.category_id, row.subcategory_id ?? null, row.description ?? null]);
    }
  }

  await user('a');
  const catalogA = (await db.query('select api.get_catalog() as result')).rows[0].result;
  const food = catalogA.categories.find((c) => c.name === 'Alimentación');
  const transport = catalogA.categories.find((c) => c.name === 'Transporte');
  const market = catalogA.subcategories.find((s) => s.name === 'Supermercado');
  const taxi = catalogA.subcategories.find((s) => s.name === 'Taxi/Uber');

  await t.test('historial vacío y contrato de respuesta', async () => {
    await user('a');
    assert.deepEqual(await list(), { items: [], next_cursor: null });
    const functions = (await db.query(`select prosecdef, proconfig, provolatile from pg_proc
      where oid = 'api.list_expenses(jsonb,text,text,text,integer,text)'::regprocedure`)).rows;
    assert.deepEqual(functions, [{ prosecdef: false, proconfig: ['search_path=""'], provolatile: 's' }]);
  });

  const fixed = [
    { id: '00000000-0000-4000-8000-000000000001', amount: '100.00', currency: 'UYU', spent_on: '2026-11-20', category_id: food.id, subcategory_id: market.id, description: 'Compra 100% orgánica' },
    { id: '00000000-0000-4000-8000-000000000002', amount: '100.00', currency: 'USD', spent_on: '2026-11-20', category_id: food.id, description: 'Café_con leche' },
    { id: '00000000-0000-4000-8000-000000000003', amount: '12.50', currency: 'EUR', spent_on: '2026-11-21', category_id: transport.id, subcategory_id: taxi.id, description: 'Taxi al aeropuerto' },
    { id: '00000000-0000-4000-8000-000000000004', amount: '100.00', currency: 'UYU', spent_on: '2026-10-31', category_id: transport.id, description: 'Ruta C:\\viajes' },
    { id: '00000000-0000-4000-8000-000000000005', amount: '999999999999.99', currency: 'UYU', spent_on: '2026-11-20', category_id: food.id, subcategory_id: market.id },
    { id: '00000000-0000-4000-8000-000000000006', amount: '0.01', currency: 'USD', spent_on: '2025-01-01', category_id: food.id, description: 'CAFÉ COMPRADO' },
  ];

  await t.test('tres monedas, nombres históricos y descripción opcional', async () => {
    await seed(users.a, fixed);
    await user('a');
    const { items, next_cursor } = await list();
    assert.equal(next_cursor, null);
    assert.deepEqual(new Set(items.map((row) => row.currency)), new Set(['UYU', 'USD', 'EUR']));
    assert.deepEqual(Object.keys(items[0]).sort(), ['amount', 'category_id', 'category_name', 'created_at', 'currency',
      'description', 'id', 'spent_on', 'subcategory_id', 'subcategory_name', 'updated_at', 'version']);
    const bare = items.find((row) => row.id === fixed[4].id);
    assert.equal(bare.description, null);
    assert.equal(bare.amount, '999999999999.99');
    assert.equal(bare.subcategory_name, 'Supermercado');
    const plain = items.find((row) => row.id === fixed[1].id);
    assert.equal(plain.subcategory_id, null);
    assert.equal(plain.subcategory_name, null);
    for (const row of items) assert.deepEqual(row, (await db.query('select api.get_expense($1) as result', [row.id])).rows[0].result);
  });

  await t.test('orden determinista en las cuatro combinaciones, con empates de fecha e importe', async () => {
    await user('a');
    for (const [sort, direction] of orders) {
      const { items } = await list({ sort, direction });
      const expected = [...items].sort(compare(sort, direction));
      assert.deepEqual(items.map((row) => row.id), expected.map((row) => row.id), sort + ' ' + direction);
    }
    const byDate = (await list()).items.map((row) => row.id);
    assert.deepEqual(byDate.slice(1, 4), [fixed[4].id, fixed[1].id, fixed[0].id]);
    const byAmount = (await list({ sort: 'amount', direction: 'asc' })).items.map((row) => row.id);
    assert.deepEqual(byAmount.slice(2, 5), [fixed[0].id, fixed[1].id, fixed[3].id]);
  });

  await t.test('búsqueda literal e insensible a mayúsculas', async () => {
    await user('a');
    const ids = async (q, filters) => (await list({ q, filters })).items.map((row) => row.id).sort();
    assert.deepEqual(await ids('café'), [fixed[1].id, fixed[5].id].sort());
    assert.deepEqual(await ids('  CAFÉ_  '), [fixed[1].id]);
    assert.deepEqual(await ids('100%'), [fixed[0].id]);
    assert.deepEqual(await ids('%'), [fixed[0].id]);
    assert.deepEqual(await ids('_'), [fixed[1].id]);
    assert.deepEqual(await ids('c:\\'), [fixed[3].id]);
    assert.deepEqual(await ids('\\'), [fixed[3].id]);
    assert.deepEqual(await ids('   '), (await list()).items.map((row) => row.id).sort());
    assert.deepEqual(await ids('inexistente'), []);
    await rejects({ q: 'x'.repeat(101) }, 'INVALID_QUERY');
    assert.equal((await list({ q: 'x'.repeat(100) })).items.length, 0);
  });

  await t.test('filtros combinados, extremos inclusivos y clasificación archivada', async () => {
    await user('a');
    const ids = async (filters, q) => (await list({ filters, q })).items.map((row) => row.id).sort();
    const november = { from: '2026-11-01', to: '2026-11-30' };
    assert.deepEqual(await ids(november), [fixed[0].id, fixed[1].id, fixed[2].id, fixed[4].id].sort());
    assert.deepEqual(await ids({ from: '2026-10-31', to: '2026-10-31' }), [fixed[3].id]);
    assert.deepEqual(await ids({ to: '2025-12-31' }), [fixed[5].id]);
    assert.deepEqual(await ids({ ...november, currency: 'UYU', category_id: food.id }), [fixed[0].id, fixed[4].id].sort());
    assert.deepEqual(await ids({ ...november, category_id: food.id, subcategory_id: market.id }, 'orgánica'), [fixed[0].id]);
    assert.deepEqual(await ids({ category_id: food.id, unclassified_child: true }), [fixed[1].id, fixed[5].id].sort());
    assert.deepEqual(await ids({ currency: 'EUR', category_id: food.id }), []);
    assert.deepEqual(await ids({ from: null, currency: null, unclassified_child: false }), (await ids({})));

    await db.query("select api.update_category('subcategory', $1, '{\"archived\":true}')", [market.id]);
    await db.query("select api.update_category('category', $1, '{\"archived\":true,\"name\":\"Comida archivada\"}')", [food.id]);
    const archived = await list({ filters: { category_id: food.id, subcategory_id: market.id } });
    assert.deepEqual(archived.items.map((row) => row.category_name), ['Comida archivada', 'Comida archivada']);
    assert.deepEqual(archived.items.map((row) => row.subcategory_name), ['Supermercado', 'Supermercado']);
    await db.query("select api.update_category('category', $1, '{\"archived\":false,\"name\":\"Alimentación\"}')", [food.id]);
    await db.query("select api.update_category('subcategory', $1, '{\"archived\":false}')", [market.id]);
  });

  await t.test('validación de filtros, orden y límite', async () => {
    await user('a');
    for (const filters of [[], 'x', { other: 1 }, { from: '2026-02-30' }, { from: '0000-01-01' }, { to: 20261101 },
      { from: '2026-1-01' }, { currency: 'ARS' }, { currency: 1 }, { category_id: 'no-uuid' }, { category_id: 7 },
      { subcategory_id: market.id }, { unclassified_child: true }, { unclassified_child: 'true' },
      { category_id: food.id, subcategory_id: market.id, unclassified_child: true }]) {
      await assert.rejects(list({ filters }), (error) => ['INVALID_FILTERS'].includes(error.message), JSON.stringify(filters));
    }
    await rejects({ filters: { from: '2026-12-01', to: '2026-11-30' } }, 'INVALID_DATE_RANGE');
    await rejects({ filters: { category_id: transport.id, subcategory_id: market.id } }, 'INVALID_SUBCATEGORY');
    await rejects({ filters: { category_id: randomUUID() } }, 'CATEGORY_NOT_FOUND');
    await rejects({ filters: { category_id: food.id, subcategory_id: randomUUID() } }, 'SUBCATEGORY_NOT_FOUND');
    await rejects({ sort: 'description' }, 'INVALID_SORT');
    await rejects({ direction: 'up' }, 'INVALID_SORT');
    await rejects({ limit: 0 }, 'INVALID_LIMIT');
    await rejects({ limit: 101 }, 'INVALID_LIMIT');
    assert.equal((await list({ limit: 1 })).items.length, 1);
    assert.equal((await list({ limit: 100 })).next_cursor, null);
    const sqlState = await db.query('select api.list_expenses(\'{"from":"x"}\') as result').catch((error) => error.code);
    assert.equal(sqlState, 'PT422');
  });

  const bulk = [];
  await t.test('paginación de muchos gastos sin repetidos ni omisiones', async () => {
    const amounts = ['5.00', '5.00', '5.00', '17.25', '250.00', '0.99'];
    for (let index = 0; index < 240; index += 1) {
      bulk.push({
        id: randomUUID(), amount: amounts[index % amounts.length], currency: ['UYU', 'USD', 'EUR'][index % 3],
        spent_on: `2024-0${1 + (index % 6)}-${String(1 + (index % 4)).padStart(2, '0')}`,
        category_id: index % 2 ? transport.id : food.id, description: index % 5 ? 'Lote ' + index : null,
      });
    }
    await seed(users.a, bulk);
    await user('a');
    const total = fixed.length + bulk.length;
    for (const [sort, direction] of orders) {
      const { seen, pages } = await walk({ sort, direction, limit: 7 });
      assert.equal(seen.length, total, sort + ' ' + direction);
      assert.equal(new Set(seen.map((row) => row.id)).size, total);
      assert.equal(pages, Math.ceil(total / 7));
      assert.deepEqual(seen.map((row) => row.id), [...seen].sort(compare(sort, direction)).map((row) => row.id));
    }
    const filtered = await walk({ filters: { currency: 'USD', from: '2024-01-01', to: '2024-12-31' }, q: 'lote', limit: 9 });
    const expected = bulk.filter((row) => row.currency === 'USD' && row.description);
    assert.deepEqual(filtered.seen.map((row) => row.id).sort(), expected.map((row) => row.id).sort());
    const full = await list({ limit: 100 });
    assert.equal(full.items.length, 100);
    assert.ok(full.next_cursor);
    const tail = await walk({ filters: { from: '2026-01-01' }, limit: 5 });
    assert.equal(tail.seen.length, 5);
    assert.equal(tail.pages, 1);
  });

  await t.test('cursores inválidos, alterados o de otra consulta', async () => {
    await user('a');
    const first = await list({ limit: 5 });
    const second = await list({ limit: 5, cursor: first.next_cursor });
    assert.notEqual(second.items[0].id, first.items[0].id);
    assert.equal((await list({ limit: 13, cursor: first.next_cursor })).items[0].id, second.items[0].id);
    const body = JSON.parse(Buffer.from(first.next_cursor, 'base64url').toString('utf8'));
    assert.deepEqual(Object.keys(body).sort(), ['d', 'h', 'i', 'k', 's', 'v']);
    const forge = (patch) => Buffer.from(JSON.stringify({ ...body, ...patch })).toString('base64url');
    for (const cursor of ['', 'no es base64', '%%%', 'e30', Buffer.from('[1]').toString('base64url'),
      Buffer.from('no json').toString('base64url'), 'A'.repeat(600), forge({ v: 2 }), forge({ k: 'x' }),
      forge({ k: '2026-02-30' }), forge({ i: 'x' }), forge({ i: 1 }), forge({ extra: true }), forge({ h: 'f'.repeat(64) })]) {
      await rejects({ limit: 5, cursor }, 'INVALID_CURSOR');
    }
    await rejects({ limit: 5, cursor: first.next_cursor, sort: 'amount' }, 'INVALID_CURSOR');
    await rejects({ limit: 5, cursor: first.next_cursor, direction: 'asc' }, 'INVALID_CURSOR');
    await rejects({ limit: 5, cursor: first.next_cursor, q: 'lote' }, 'INVALID_CURSOR');
    await rejects({ limit: 5, cursor: first.next_cursor, filters: { currency: 'UYU' } }, 'INVALID_CURSOR');
    const byAmount = await list({ limit: 5, sort: 'amount' });
    await rejects({ limit: 5, cursor: byAmount.next_cursor }, 'INVALID_CURSOR');
    // Equivalent spellings of the same query share their cursors.
    assert.equal((await list({ limit: 5, q: '  ', filters: { currency: null }, cursor: first.next_cursor })).items[0].id,
      second.items[0].id);
  });

  await t.test('cambios entre páginas no repiten filas existentes', async () => {
    await user('a');
    const first = await list({ limit: 10 });
    const shown = new Set(first.items.map((row) => row.id));
    const victim = (await list({ limit: 1, cursor: first.next_cursor })).items[0];
    await db.query('select api.delete_expense($1, $2)', [victim.id, victim.version]);
    const moved = first.items[3];
    await db.query('select api.update_expense($1, $2, $3, $4, $5, $6, $7, $8)', [moved.id, moved.version, moved.amount,
      moved.currency, '1999-01-01', moved.category_id, moved.subcategory_id, moved.description]);
    let cursor = first.next_cursor;
    const rest = [];
    while (cursor) {
      const page = await list({ limit: 10, cursor });
      rest.push(...page.items);
      cursor = page.next_cursor;
    }
    assert.ok(!rest.some((row) => row.id === victim.id));
    const duplicates = rest.filter((row) => shown.has(row.id));
    assert.deepEqual(duplicates.map((row) => row.id), [moved.id]);
    assert.equal(rest.at(-1).id, moved.id);
  });

  await t.test('aislamiento entre propietarios, cursores ajenos y sesiones cerradas', async () => {
    await user('a');
    const ownCursor = (await list({ limit: 3 })).next_cursor;
    const catalog = (await db.query('select api.get_catalog() as result')).rows[0].result;
    await user('b');
    assert.deepEqual(await list(), { items: [], next_cursor: null });
    await rejects({ limit: 3, cursor: ownCursor }, 'INVALID_CURSOR');
    await rejects({ filters: { category_id: catalog.categories[0].id } }, 'CATEGORY_NOT_FOUND');
    const own = (await db.query('select api.get_catalog() as result')).rows[0].result.categories[0];
    await db.query('select api.create_expense($1, $2, $3, $4, $5)', [randomUUID(), '3.00', 'EUR', '2026-11-01', own.id]);
    const b = await list();
    assert.equal(b.items.length, 1);
    await user('a');
    assert.ok(!(await walk({ limit: 100 })).seen.some((row) => row.id === b.items[0].id));

    await asUser(db, users.outsider, sessions.outsider);
    await rejects({}, 'ACCESS_DENIED');
    await asUser(db, users.a, randomUUID());
    await rejects({}, 'ACCESS_DENIED');
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select api.list_expenses()'), /permission denied/);
    await db.exec('reset role');
    for (const role of ['anon', 'service_role', 'public']) {
      const { rows } = await db.query(`select has_function_privilege($1, 'api.list_expenses(jsonb,text,text,text,integer,text)', 'EXECUTE') as value`,
        [role === 'public' ? 'anon' : role]);
      assert.equal(rows[0].value, false, role);
    }
    const helpers = await db.query(`select p.oid::regprocedure::text as name,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon, p.prosecdef, p.proconfig
      from pg_proc p where p.oid in ('private.filter_date(jsonb,text)'::regprocedure, 'private.filter_uuid(jsonb,text)'::regprocedure,
        'private.decode_cursor(text)'::regprocedure, 'private.encode_cursor(jsonb)'::regprocedure)`);
    for (const row of helpers.rows) assert.deepEqual([row.anon, row.prosecdef, row.proconfig], [false, false, ['search_path=""']], row.name);
  });

  await t.test('las consultas paginadas usan índices del propietario', async () => {
    await db.exec('reset role; analyze app.expenses; set enable_seqscan = off;');
    const { rows } = await db.query(`explain select e.id from app.expenses e where e.owner_id = $1
      order by e.amount desc, e.id desc limit 31`, [users.a]);
    assert.match(rows.map((row) => row['QUERY PLAN']).join('\n'), /expenses_amount_idx/);
    const byDate = await db.query(`explain select e.id from app.expenses e where e.owner_id = $1
      and (e.spent_on, e.id) < ('2024-03-01', '00000000-0000-4000-8000-000000000000') order by e.spent_on desc, e.id desc limit 31`, [users.a]);
    assert.match(byDate.rows.map((row) => row['QUERY PLAN']).join('\n'), /expenses_spent_on_idx/);
    await db.exec('reset enable_seqscan');
  });
});
