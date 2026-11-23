import assert from 'node:assert/strict';
import { test } from 'node:test';

const origin = 'https://ljbrukrakumuatjnwxwd.supabase.co';
const enabled = process.env.CIFRA_RUN_HOSTED_TESTS === '1';
const key = process.env.CIFRA_TEST_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const tokenA = process.env.CIFRA_TEST_ACCESS_TOKEN_A;
const tokenB = process.env.CIFRA_TEST_ACCESS_TOKEN_B;
const zero = '00000000-0000-4000-a000-000000000000';

async function list(body, accessToken) {
  const url = process.env.CIFRA_TEST_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  assert.equal(new URL(url).origin, origin);
  assert.ok(key?.startsWith('sb_publishable_'));
  const response = await fetch(origin + '/rest/v1/rpc/list_expenses', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: { apikey: key, 'Content-Type': 'application/json', 'Content-Profile': 'api', 'Accept-Profile': 'api',
      ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

test('Data API alojada expone list_expenses solo a sesiones autenticadas', {
  skip: !enabled && 'Requiere proyecto de desarrollo',
}, async () => {
  const { status, data } = await list({ filters: {}, limit: 1 });
  assert.ok([401, 403].includes(status), 'list_expenses → ' + status);
  assert.equal(data.code, '42501');
});

test('la primera plaza pagina su historial y rechaza cursores alterados', {
  skip: !enabled || !tokenA ? 'Requiere sesión de prueba autorizada de la primera plaza' : false,
}, async () => {
  const first = await list({ filters: {}, sort: 'spent_on', direction: 'desc', limit: 1 }, tokenA);
  assert.equal(first.status, 200);
  assert.ok(Array.isArray(first.data.items));
  assert.ok(first.data.items.length <= 1);
  const bad = await list({ limit: 1, cursor: 'e30' }, tokenA);
  assert.equal(bad.status, 422);
  assert.equal(bad.data.message, 'INVALID_CURSOR');
  const missing = await list({ filters: { category_id: zero } }, tokenA);
  assert.equal(missing.status, 404);
  if (first.data.next_cursor) {
    const other = await list({ limit: 1, sort: 'amount', cursor: first.data.next_cursor }, tokenA);
    assert.equal(other.status, 422);
    if (tokenB) {
      const foreign = await list({ limit: 1, cursor: first.data.next_cursor }, tokenB);
      assert.equal(foreign.status, 422);
    }
  }
});
