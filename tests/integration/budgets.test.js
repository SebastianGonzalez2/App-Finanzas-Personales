import assert from 'node:assert/strict';
import { test } from 'node:test';

// IMP-05 contra la Data API alojada de desarrollo (cifra-development). Sin sesión, los RPC de
// presupuestos se rechazan y app.budgets no está expuesta. Con CIFRA_TEST_ACCESS_TOKEN_A se
// recorre crear → editar → duplicado → retirar, dejando la cuenta como estaba.
const origin = 'https://ljbrukrakumuatjnwxwd.supabase.co';
const enabled = process.env.CIFRA_RUN_HOSTED_TESTS === '1';
const key = process.env.CIFRA_TEST_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const tokenA = process.env.CIFRA_TEST_ACCESS_TOKEN_A;
const zero = '00000000-0000-4000-a000-000000000000';

async function call(name, body, accessToken) {
  const url = process.env.CIFRA_TEST_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  assert.equal(new URL(url).origin, origin);
  assert.ok(key?.startsWith('sb_publishable_'));
  const response = await fetch(origin + '/rest/v1/rpc/' + name, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: { apikey: key, 'Content-Type': 'application/json', 'Content-Profile': 'api', 'Accept-Profile': 'api',
      ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

test('Data API alojada expone los RPC de presupuestos solo a sesiones autenticadas', {
  skip: !enabled && 'Requiere proyecto de desarrollo',
}, async () => {
  for (const [name, body] of [['get_budgets', { currency: 'UYU' }],
    ['create_budget', { category_id: zero, currency: 'UYU', monthly_limit: '1' }],
    ['update_budget', { category_id: zero, currency: 'UYU', monthly_limit: '1' }],
    ['delete_budget', { category_id: zero, currency: 'UYU' }]]) {
    const { status, data } = await call(name, body);
    assert.ok([401, 403].includes(status), name + ' → ' + status);
    assert.equal(data.code, '42501', name);
  }
  const table = await fetch(origin + '/rest/v1/budgets', { headers: { apikey: key, 'Accept-Profile': 'app' } });
  assert.ok([401, 404, 406].includes(table.status), 'app.budgets → ' + table.status);
});

test('la primera plaza crea, edita y retira un límite sin tocar gastos', {
  skip: !enabled || !tokenA ? 'Requiere sesión de prueba autorizada de la primera plaza' : false,
}, async () => {
  const empty = await call('get_budgets', { currency: 'EUR' }, tokenA);
  assert.equal(empty.status, 200);
  assert.match(empty.data.month, /^\d{4}-\d{2}$/);
  const catalog = await call('get_catalog', {}, tokenA);
  const parent = catalog.data.categories.find((row) => !row.archived && !empty.data.items.some((item) => item.category_id === row.id));
  const created = await call('create_budget', { category_id: parent.id, currency: 'EUR', monthly_limit: '15000.00' }, tokenA);
  assert.equal(created.status, 200);
  assert.equal(created.data.monthly_limit, '15000.00');
  assert.equal((await call('create_budget', { category_id: parent.id, currency: 'EUR', monthly_limit: '1' }, tokenA)).status, 409);
  assert.equal((await call('update_budget', { category_id: parent.id, currency: 'EUR', monthly_limit: '0' }, tokenA)).status, 422);
  assert.equal((await call('update_budget', { category_id: parent.id, currency: 'EUR', monthly_limit: '18000' }, tokenA)).data.monthly_limit, '18000.00');
  assert.equal((await call('create_budget', { category_id: zero, currency: 'EUR', monthly_limit: '1' }, tokenA)).status, 404);
  assert.deepEqual((await call('delete_budget', { category_id: parent.id, currency: 'EUR' }, tokenA)).data, { deleted: true });
  assert.deepEqual((await call('get_budgets', { currency: 'EUR' }, tokenA)).data.items, empty.data.items);
});
