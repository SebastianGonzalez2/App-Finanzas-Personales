import assert from 'node:assert/strict';
import { test } from 'node:test';

const origin = 'https://ljbrukrakumuatjnwxwd.supabase.co';
const enabled = process.env.CIFRA_RUN_HOSTED_TESTS === '1';
const key = process.env.CIFRA_TEST_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const token = process.env.CIFRA_TEST_ACCESS_TOKEN_A;
const options = { skip: !enabled && 'Requiere proyecto de desarrollo' };
const zero = '00000000-0000-4000-a000-000000000000';

async function request(path, schema, body, accessToken) {
  const url = process.env.CIFRA_TEST_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  assert.equal(new URL(url).origin, origin);
  assert.ok(key?.startsWith('sb_publishable_'));
  const response = await fetch(origin + '/rest/v1/' + path, {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: { apikey: key, 'Content-Type': 'application/json', 'Content-Profile': schema, 'Accept-Profile': schema,
      ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}

test('Data API alojada reconoce los siete RPC de IMP-02 y deniega llamadas anónimas', options, async () => {
  const expense = { id: zero, amount: '0', currency: 'UYU', spent_on: '2024-02-29', category_id: zero, description: null, subcategory_id: null };
  const cases = { get_catalog: {}, get_expense: { id: zero }, create_category: { name: '' },
    update_category: { kind: 'category', id: zero, patch: {} }, create_expense: expense,
    update_expense: { ...expense, version: 1 }, delete_expense: { id: zero, version: 0 } };
  for (const [name, args] of Object.entries(cases)) {
    const { status, data } = await request('rpc/' + name, 'api', args);
    assert.ok([401, 403].includes(status), name + ' → ' + status);
    assert.equal(data.code, '42501', name);
  }
});

test('PostgREST mantiene las cuatro tablas de IMP-02 fuera de los esquemas expuestos', options, async () => {
  for (const name of ['categories', 'subcategories', 'expenses', 'expense_keys']) {
    const { status, data } = await request(name + '?select=id&limit=0', 'app');
    assert.equal(status, 406, name);
    assert.equal(data.code, 'PGRST106');
  }
});

test('la sesión real de la primera plaza puede consultar su catálogo alojado', {
  skip: !enabled || !token ? 'Requiere sesión de prueba autorizada de la primera plaza' : false,
}, async () => {
  const { status, data } = await request('rpc/get_catalog', 'api', {}, token);
  assert.equal(status, 200);
  assert.ok(data.categories.length >= 13);
  const parents = new Set(data.categories.map((row) => row.id));
  assert.ok(data.subcategories.every((row) => parents.has(row.category_id)));
});
