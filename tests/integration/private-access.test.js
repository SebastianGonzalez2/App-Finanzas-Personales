import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  CIFRA_RUN_HOSTED_TESTS: enabled,
  CIFRA_TEST_SUPABASE_URL: rawUrl,
  CIFRA_TEST_SUPABASE_PUBLISHABLE_KEY: key,
  CIFRA_TEST_ACCESS_TOKEN_A: tokenA,
  CIFRA_TEST_ACCESS_TOKEN_B: tokenB,
  CIFRA_TEST_ACCESS_TOKEN_OUTSIDER: tokenOutsider,
  CIFRA_TEST_EXPIRED_ACCESS_TOKEN: expiredToken,
} = process.env;

test('Data API y cierre local sobre Supabase alojado de pruebas', {
  skip: enabled !== '1' && 'Requiere un entorno Supabase aislado y sesiones Google de prueba',
}, async (t) => {
  const url = new URL(rawUrl);
  assert.match(url.origin, /^https:\/\/[a-z0-9-]+\.supabase\.co$/);
  assert.equal(url.href, `${url.origin}/`);
  assert.ok(key?.startsWith('sb_publishable_'), 'Falta la clave publicable del proyecto de pruebas.');

  const users = [tokenA, tokenB, tokenOutsider].map((token) => {
    assert.ok(token && token.split('.').length === 3, 'Falta un JWT de prueba.');
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  });
  assert.ok(users.every((info) => info.iss === `${url.origin}/auth/v1` && info.role === 'authenticated'));
  assert.equal(new Set(users.map((info) => info.sub)).size, 3);
  assert.ok(users.every((info) => info.session_id), 'Cada JWT debe representar una sesión de Auth.');

  async function request(path, { token, schema = 'api', params } = {}) {
    const headers = { apikey: key, 'Content-Profile': schema, 'Accept-Profile': schema };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (params) headers['Content-Type'] = 'application/json';
    return fetch(new URL(path, url), {
      method: params || path.startsWith('/auth/v1/logout') ? 'POST' : 'GET',
      headers,
      body: params && JSON.stringify(params),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  }

  function rpc(name, token, params = {}) {
    return request(`/rest/v1/rpc/${name}`, { token, params });
  }

  async function expectStatus(response, ...statuses) {
    assert.ok(statuses.includes(response.status), `HTTP ${response.status}, esperado ${statuses.join('/')}`);
  }

  async function getPreferences(token) {
    const response = await rpc('get_preferences', token);
    await expectStatus(response, 200);
    const data = await response.json();
    assert.ok(['UYU', 'USD', 'EUR'].includes(data.currency));
    assert.deepEqual(data.favorites, []);
    assert.match(data.today, /^\d{4}-\d{2}-\d{2}$/);
    return data;
  }

  async function setCurrency(token, currency) {
    const response = await rpc('set_currency', token, { currency });
    await expectStatus(response, 200);
    assert.deepEqual(await response.json(), { currency });
  }

  await t.test('ambas plazas responden y cada preferencia pertenece a su dueño', async () => {
    const beforeA = await getPreferences(tokenA);
    const beforeB = await getPreferences(tokenB);
    const newA = beforeA.currency === 'USD' ? 'UYU' : 'USD';
    const newB = beforeB.currency === 'EUR' ? 'UYU' : 'EUR';
    try {
      await setCurrency(tokenA, newA);
      assert.equal((await getPreferences(tokenB)).currency, beforeB.currency);
      await setCurrency(tokenB, newB);
      assert.equal((await getPreferences(tokenA)).currency, newA);
      assert.equal((await getPreferences(tokenB)).currency, newB);
      await expectStatus(await rpc('set_currency', tokenA, { currency: 'GBP' }), 422);
      await expectStatus(await rpc('set_currency', tokenA, { currency: 'UYU', owner_id: users[1].sub }), 404);
      assert.equal((await getPreferences(tokenB)).currency, newB);
    } finally {
      await Promise.all([setCurrency(tokenA, beforeA.currency), setCurrency(tokenB, beforeB.currency)]);
    }
  });

  await t.test('sin token, token inválido e identidad sin plaza', async () => {
    await expectStatus(await rpc('get_preferences'), 401, 403);
    await expectStatus(await rpc('get_preferences', 'invalid-token'), 401, 403);
    await expectStatus(await rpc('get_preferences', tokenOutsider), 403);
    await expectStatus(await rpc('set_currency', tokenOutsider, { currency: null }), 403);
  });

  await t.test('los esquemas privados y GraphQL quedan fuera de la Data API', async () => {
    for (const [schema, name] of [['app', 'preferences'], ['private', 'members'], ['auth', 'sessions']]) {
      for (const token of [undefined, tokenA]) {
        await expectStatus(await request(`/rest/v1/${name}?select=*`, { token, schema }), 401, 403, 404, 406);
      }
    }
    await expectStatus(await request('/rest/v1/rpc/allowed', { token: tokenA, schema: 'private', params: {} }), 401, 403, 404, 406);
    await expectStatus(await request('/graphql/v1', { token: tokenA, params: { query: '{ __typename }' } }), 400, 401, 403, 404, 406);
  });

  await t.test('JWT realmente expirado', { skip: !expiredToken && 'Falta un JWT de prueba vencido naturalmente' }, async () => {
    await expectStatus(await rpc('get_preferences', expiredToken), 401);
  });

  await t.test('cierre de A y rechazo del mismo JWT tras confirmar', async () => {
    await getPreferences(tokenA);
    await expectStatus(await request('/auth/v1/logout?scope=local', { token: tokenA }), 200, 204);
    await expectStatus(await rpc('get_preferences', tokenA), 403);
    await expectStatus(await rpc('set_currency', tokenA, { currency: 'UYU' }), 403);
    await getPreferences(tokenB);
  });
});
