import assert from 'node:assert/strict';
import { test } from 'node:test';

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

const month = { from: '2026-11-01', to: '2026-11-30', currency: 'UYU' };

test('Data API alojada expone get_stats, get_annual y set_favorite solo a sesiones autenticadas', {
  skip: !enabled && 'Requiere proyecto de desarrollo',
}, async () => {
  for (const [name, body] of [['get_stats', { filters: month }], ['get_annual', { currency: 'UYU' }],
    ['set_favorite', { panel: 'metrics', enabled: true }]]) {
    const { status, data } = await call(name, body);
    assert.ok([401, 403].includes(status), name + ' → ' + status);
    assert.equal(data.code, '42501', name);
  }
  // Las tablas privadas siguen fuera de la Data API.
  const table = await fetch(origin + '/rest/v1/favorites', { headers: { apikey: key, 'Accept-Profile': 'app' } });
  assert.ok([401, 404, 406].includes(table.status), 'app.favorites → ' + table.status);
});

test('la primera plaza consulta agregados de una sola moneda con decimales exactos', {
  skip: !enabled || !tokenA ? 'Requiere sesión de prueba autorizada de la primera plaza' : false,
}, async () => {
  const stats = await call('get_stats', { filters: month, reference: { from: '2026-10-01', to: '2026-10-31' } }, tokenA);
  assert.equal(stats.status, 200);
  assert.equal(stats.data.filters.currency, 'UYU');
  assert.ok(stats.data.indicator.current.total === null || /^\d+\.\d{2}$/.test(stats.data.indicator.current.total));
  const annual = await call('get_annual', { currency: 'UYU' }, tokenA);
  assert.equal(annual.status, 200);
  assert.equal(annual.data.points.length, 5);
  assert.equal(annual.data.points.at(-1).partial, true);
  const missing = await call('get_stats', { filters: { ...month, category_id: zero } }, tokenA);
  assert.equal(missing.status, 404);
  const invalid = await call('get_annual', { currency: 'UYU', end_year: 9999 }, tokenA);
  assert.equal(invalid.status, 422);
});
