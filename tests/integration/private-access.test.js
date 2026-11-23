import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';

const {
  CIFRA_RUN_HOSTED_TESTS, CIFRA_TEST_SUPABASE_URL, CIFRA_TEST_SUPABASE_PUBLISHABLE_KEY: key,
  CIFRA_TEST_ACCESS_TOKEN_A: a, CIFRA_TEST_ACCESS_TOKEN_B: b,
  CIFRA_TEST_ACCESS_TOKEN_OUTSIDER: outsider, CIFRA_TEST_EXPIRED_ACCESS_TOKEN: expired,
  CIFRA_TEST_REVOKE_SESSION_A,
} = process.env;

const devOrigin = 'https://ljbrukrakumuatjnwxwd.supabase.co';
const disabled = CIFRA_RUN_HOSTED_TESTS !== '1' && 'Habilitá las pruebas alojadas explícitamente';
const currencies = ['UYU', 'USD', 'EUR'];

async function request(path, { token, schema, body, method } = {}) {
  assert.match(CIFRA_TEST_SUPABASE_URL ?? '', /^https:\/\/ljbrukrakumuatjnwxwd\.supabase\.co\/?$/);
  assert.ok(key?.startsWith('sb_publishable_'), 'Se requiere una clave publicable.');
  const headers = { apikey: key };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (schema) {
    headers['Content-Profile'] = schema;
    headers['Accept-Profile'] = schema;
  }
  if (body) headers['Content-Type'] = 'application/json';
  return fetch(new URL(path, devOrigin), {
    method: method ?? (body ? 'POST' : 'GET'), headers,
    body: body && JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
}

function rpc(name, token, body = {}) {
  return request(`/rest/v1/rpc/${name}`, { token, schema: 'api', body });
}

async function expectResponse(response, status, code) {
  assert.equal(response.status, status);
  if (code) {
    const { code: apiCode, error_code: authCode } = await response.json();
    assert.equal(authCode ?? apiCode, code);
  } else if (!response.ok) {
    await response.body?.cancel();
  }
}

function claims(token) {
  try {
    const parts = token.split('.');
    if (parts.length === 3) return JSON.parse(Buffer.from(parts[1], 'base64url'));
  } catch { /* Keep the token out of test output. */ }
  assert.fail('JWT de prueba inválido.');
}

function identity(token, { expired = false } = {}) {
  const info = claims(token);
  assert.ok(info?.iss === `${devOrigin}/auth/v1` && info.role === 'authenticated'
    && info.sub && info.session_id, 'Se requiere un JWT de sesión del proyecto de desarrollo.');
  assert.ok(Number.isFinite(info.exp) && (info.exp * 1000 <= Date.now()) === expired,
    expired ? 'Se requiere un JWT vencido naturalmente.' : 'La sesión de prueba venció.');
  return info;
}

async function getPreferences(token) {
  const response = await rpc('get_preferences', token);
  await expectResponse(response, 200);
  const data = await response.json();
  assert.ok(currencies.includes(data.currency));
  assert.deepEqual(data.favorites, []);
  assert.match(data.today, /^\d{4}-\d{2}-\d{2}$/);
  return data;
}

async function setCurrency(token, currency) {
  const response = await rpc('set_currency', token, { currency });
  await expectResponse(response, 200);
  assert.deepEqual(await response.json(), { currency });
}

async function assertPrivateSchemasClosed(token) {
  const relations = [
    ['app', 'preferences'], ['private', 'members'], ['auth', 'sessions'],
    ['public', 'preferences'], ['graphql_public', 'preferences'],
  ];
  for (const [schema, name] of relations) {
    await expectResponse(await request(`/rest/v1/${name}?select=*`, { token, schema }), 406, 'PGRST106');
  }
  await expectResponse(await request('/rest/v1/rpc/allowed', { token, schema: 'private', body: {} }), 406, 'PGRST106');
  await expectResponse(await request('/graphql/v1', { token, body: { query: '{ __typename }' } }), 406, 'PGRST106');
}

test('altas cerradas en Auth alojado', { skip: disabled }, async () => {
  const response = await request('/auth/v1/settings');
  await expectResponse(response, 200);
  const settings = await response.json();
  assert.equal(settings.disable_signup, true);
  assert.equal(settings.external.google, true);
  assert.equal(settings.external.anonymous_users, false);
  await expectResponse(await request('/auth/v1/signup', {
    body: { email: `cifra-imp01-${randomUUID()}@example.com`, password: randomUUID() },
  }), 422, 'signup_disabled');
});

test('Data API anónima, JWT inválido, esquemas y GraphQL', { skip: disabled }, async () => {
  await expectResponse(await rpc('get_preferences'), 401, '42501');
  await expectResponse(await rpc('set_currency', undefined, { currency: null }), 401, '42501');
  await expectResponse(await rpc('get_preferences', 'invalid-token'), 401);
  await assertPrivateSchemasClosed();
});

test('A accede, actualiza y restaura sus preferencias', { skip: disabled || !a && 'Falta la sesión de A' }, async () => {
  identity(a);
  await assertPrivateSchemasClosed(a);
  const original = (await getPreferences(a)).currency;
  const currency = currencies.find((value) => value !== original);
  try {
    await setCurrency(a, currency);
    assert.equal((await getPreferences(a)).currency, currency);
    await expectResponse(await rpc('set_currency', a, { currency: 'GBP' }), 422, 'PT422');
  } finally {
    await setCurrency(a, original);
  }
  assert.equal((await getPreferences(a)).currency, original);
});

test('A y B guardan sus preferencias por separado', { skip: disabled || !(a && b) && 'Faltan las dos plazas' }, async () => {
  const ownerA = identity(a).sub;
  const ownerB = identity(b).sub;
  assert.ok(ownerA !== ownerB, 'Se requieren dos identidades distintas.');
  const originalA = (await getPreferences(a)).currency;
  const originalB = (await getPreferences(b)).currency;
  const currencyA = currencies.find((value) => value !== originalA && value !== originalB);
  const currencyB = currencies.find((value) => value !== originalB && value !== currencyA);
  try {
    await setCurrency(a, currencyA);
    assert.equal((await getPreferences(b)).currency, originalB);
    await setCurrency(b, currencyB);
    assert.equal((await getPreferences(a)).currency, currencyA);
    await expectResponse(await rpc('set_currency', a, { currency: originalB, owner_id: ownerB }), 404, 'PGRST202');
    assert.equal((await getPreferences(b)).currency, currencyB);
  } finally {
    const restorations = await Promise.allSettled([setCurrency(a, originalA), setCurrency(b, originalB)]);
    assert.ok(restorations.every(({ status }) => status === 'fulfilled'), 'Falló la restauración de preferencias.');
  }
  assert.equal((await getPreferences(a)).currency, originalA);
  assert.equal((await getPreferences(b)).currency, originalB);
});

test('Auth reconoce al tercero, pero los RPC le deniegan acceso', { skip: disabled || !outsider && 'Falta la sesión del tercero' }, async () => {
  const owner = identity(outsider).sub;
  assert.ok([a, b].filter(Boolean).every((token) => identity(token).sub !== owner), 'El tercero debe ser otra identidad.');
  const response = await request('/auth/v1/user', { token: outsider });
  await expectResponse(response, 200);
  assert.ok((await response.json()).id === owner);
  await expectResponse(await rpc('get_preferences', outsider), 403, 'PT403');
  await expectResponse(await rpc('set_currency', outsider, { currency: null }), 403, 'PT403');
});

test('JWT vencido naturalmente', { skip: disabled || !expired && 'Falta un JWT vencido' }, async () => {
  identity(expired, { expired: true });
  await expectResponse(await rpc('get_preferences', expired), 401);
});

test('cierre local de A bloquea el JWT aún vigente', {
  skip: disabled || !(a && CIFRA_TEST_REVOKE_SESSION_A === '1') && 'Requiere una sesión dedicada y confirmación por variable',
}, async () => {
  const session = identity(a);
  if (b) assert.ok(identity(b).sub !== session.sub, 'Se requieren dos identidades distintas.');
  await getPreferences(a);
  const response = await request('/auth/v1/logout?scope=local', { token: a, method: 'POST' });
  assert.ok([200, 204].includes(response.status), `Logout HTTP ${response.status}`);
  await expectResponse(await rpc('get_preferences', a), 403, 'PT403');
  await expectResponse(await rpc('set_currency', a, { currency: 'UYU' }), 403, 'PT403');
  assert.ok(session.exp * 1000 > Date.now(), 'El JWT debe seguir vigente después del cierre.');
  if (b) await getPreferences(b);
});
