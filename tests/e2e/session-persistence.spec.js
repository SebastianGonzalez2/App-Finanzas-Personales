import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { enter, ownerA, ownerB } from './access-fixture.js';

const apiOrigin = 'http://127.0.0.1:54321';
const storageKey = 'sb-127-auth-token';
const preferences = { currency: 'UYU', favorites: [], today: '2026-11-23' };
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
};

function makeSession(user, generation = 1, lifetime = 3600) {
  const encode = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const exp = now + lifetime;
  return {
    access_token: `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp, generation })}.fixture`,
    expires_in: Math.max(lifetime, 1),
    expires_at: exp,
    refresh_token: `test-refresh-${user.id.slice(-4)}-${generation}`,
    token_type: 'bearer',
    user: { ...user, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' } },
  };
}

function emptyStats({ filters, reference = null }) {
  const months = [];
  let [year, month] = filters.from.split('-').map(Number);
  const [lastYear, lastMonth] = filters.to.split('-').map(Number);
  while (year * 12 + month <= lastYear * 12 + lastMonth) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    months.push({
      month: key,
      from: key + '-01' < filters.from ? filters.from : key + '-01',
      to: end > filters.to ? filters.to : end,
      count: 0,
      total: null,
    });
    [year, month] = month === 12 ? [year + 1, 1] : [year, month + 1];
  }
  const metric = { count: 0, total: null };
  return {
    filters: { ...filters, category_id: null, subcategory_id: null, unclassified_child: false },
    reference,
    comparable: reference ? false : null,
    indicator: { current: metric, reference: reference ? metric : null, delta: null, percent: null },
    months,
    month_next_offset: null,
    categories: [],
    children: [],
    category_comparisons: [],
  };
}

// Simula el backend de Supabase en un perfil persistente reutilizable entre procesos nuevos del navegador.
async function attachBackend(context, state) {
  const calls = { exchanges: 0, refreshes: 0, logouts: 0, preferences: 0 };

  await context.route(`${apiOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const reply = (status, json) => route.fulfill({ status, json, headers: cors });

    if (url.pathname === '/auth/v1/authorize') {
      const redirect = new URL(url.searchParams.get('redirect_to'));
      redirect.search = '?code=fixture-code';
      return route.fulfill({ status: 302, headers: { location: redirect.href } });
    }

    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        calls.refreshes += 1;
        if (state.refreshMode === 'offline') return route.abort('internetdisconnected');
        if (state.refreshMode === 'serverError') return reply(503, { msg: 'Temporarily unavailable' });
        if (state.refreshMode === 'revoked') {
          return reply(400, { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
        }
        state.generation += 1;
        state.activeSession = makeSession(state.user, state.generation, 3600);
        return reply(200, state.activeSession);
      }
      calls.exchanges += 1;
      state.generation += 1;
      state.activeSession = makeSession(state.user, state.generation, state.initialLifetime ?? 3600);
      return reply(200, state.activeSession);
    }

    if (url.pathname === '/rest/v1/rpc/get_preferences') {
      calls.preferences += 1;
      if (state.preferencesMode === 'offline') return route.abort('internetdisconnected');
      const auth = request.headers().authorization;
      if (state.rejectToken && auth === `Bearer ${state.rejectToken}`) {
        return reply(401, { code: 'PGRST301', message: 'JWT expired' });
      }
      if (!state.activeSession || auth !== `Bearer ${state.activeSession.access_token}`) {
        return reply(401, { code: 'PGRST301', message: 'JWT expired' });
      }
      return reply(200, preferences);
    }

    if (url.pathname === '/rest/v1/rpc/get_catalog') return reply(200, { categories: [], subcategories: [] });
    if (url.pathname === '/rest/v1/rpc/get_stats') return reply(200, emptyStats(request.postDataJSON()));
    if (url.pathname === '/rest/v1/rpc/get_budgets') {
      return reply(200, { month: preferences.today.slice(0, 7), currency: request.postDataJSON().currency, items: [] });
    }
    if (url.pathname === '/rest/v1/rpc/list_expenses') return reply(200, { items: [], next_cursor: null });

    if (url.pathname === '/auth/v1/logout') {
      calls.logouts += 1;
      state.activeSession = null;
      return route.fulfill({ status: 204, headers: cors });
    }

    return reply(404, { message: 'No existe en el doble de pruebas' });
  });

  return calls;
}

async function launchAppProcess(userDataDir) {
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: process.env.CIFRA_CHROMIUM_PATH,
    viewport: { width: 390, height: 844 },
  });
  const page = context.pages()[0] ?? await context.newPage();
  return { context, page };
}

async function readIdbSession(page) {
  return page.evaluate((key) => new Promise((resolve, reject) => {
    const req = indexedDB.open('cifra-auth', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('kv', 'readonly');
      const get = tx.objectStore('kv').get(key);
      get.onsuccess = () => {
        const value = get.result ?? null;
        db.close();
        resolve(value ? JSON.parse(value) : null);
      };
      get.onerror = () => { db.close(); reject(get.error); };
    };
  }), storageKey);
}

async function writeIdbSession(page, session) {
  await page.evaluate(([key, raw]) => new Promise((resolve, reject) => {
    const req = indexedDB.open('cifra-auth', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(raw, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), [storageKey, JSON.stringify(session)]);
}

function withTempProfile(run) {
  return async ({ baseURL }) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'cifra-pwa-profile-'));
    try {
      await run({ baseURL, userDataDir });
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  };
}

test('CA-02 · la sesión sobrevive al cierre total y reapertura en un proceso nuevo sin duplicar tokens', withTempProfile(async ({ baseURL, userDataDir }) => {
  const state = { user: ownerA, generation: 0, activeSession: null };

  // Proceso 1: inicio de sesión y verificación del manifiesto PWA y almacenamiento único.
  const first = await launchAppProcess(userDataDir);
  try {
    await attachBackend(first.context, state);
    await first.page.goto(`${baseURL}/login`);
    const manifestHref = await first.page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBe('/manifest.webmanifest');
    const manifestResponse = await first.page.request.get(`${baseURL}/manifest.webmanifest`);
    expect(manifestResponse.ok()).toBe(true);
    expect(await manifestResponse.json()).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' });

    await enter(first.page);
    const idbSession = await readIdbSession(first.page);
    expect(idbSession?.user?.id).toBe(ownerA.id);
    expect(await first.page.evaluate((key) => window.localStorage.getItem(key), storageKey)).toBeNull();
  } finally {
    await first.context.close();
  }

  // Proceso 2: cierre completo del navegador anterior y apertura en un proceso nuevo.
  const second = await launchAppProcess(userDataDir);
  try {
    const calls = await attachBackend(second.context, state);
    await second.page.goto(`${baseURL}/`);
    await expect(second.page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
    expect(calls.exchanges).toBe(0);

    // Incluso si un acceso directo antiguo abre /login, redirige a Resumen con la sesión activa.
    await second.page.goto(`${baseURL}/login`);
    await expect(second.page).toHaveURL(`${baseURL}/`);
    await second.page.getByRole('button', { name: 'Ver menú' }).click();
    await second.page.getByRole('dialog').getByRole('link', { name: 'Mi cuenta' }).click();
    await expect(second.page.getByText(ownerA.email)).toBeVisible();
  } finally {
    await second.context.close();
  }
}));

test('CA-02 · migra una sesión previa guardada en localStorage al reabrir en un proceso nuevo y elimina la copia anterior', withTempProfile(async ({ baseURL, userDataDir }) => {
  const legacySession = makeSession(ownerA, 1, 3600);
  const state = { user: ownerA, generation: 1, activeSession: legacySession };

  const first = await launchAppProcess(userDataDir);
  try {
    await attachBackend(first.context, state);
    await first.page.goto(`${baseURL}/login`);
    await first.page.evaluate(([key, raw]) => window.localStorage.setItem(key, raw), [storageKey, JSON.stringify(legacySession)]);
  } finally {
    await first.context.close();
  }

  const second = await launchAppProcess(userDataDir);
  try {
    await attachBackend(second.context, state);
    await second.page.goto(`${baseURL}/`);
    await expect(second.page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
    expect((await readIdbSession(second.page))?.access_token).toBe(legacySession.access_token);
    expect(await second.page.evaluate((key) => window.localStorage.getItem(key), storageKey)).toBeNull();
  } finally {
    await second.context.close();
  }
}));

test('CA-04 · recupera automáticamente una sesión con access token vencido y refresh token válido en proceso nuevo', withTempProfile(async ({ baseURL, userDataDir }) => {
  const state = { user: ownerA, generation: 0, activeSession: null };

  const first = await launchAppProcess(userDataDir);
  try {
    await attachBackend(first.context, state);
    await first.page.goto(`${baseURL}/login`);
    await enter(first.page);

    const expired = { ...state.activeSession, expires_at: Math.floor(Date.now() / 1000) - 120 };
    state.rejectToken = expired.access_token;
    await writeIdbSession(first.page, expired);
  } finally {
    await first.context.close();
  }

  const second = await launchAppProcess(userDataDir);
  try {
    const calls = await attachBackend(second.context, state);
    await second.page.goto(`${baseURL}/`);
    await expect(second.page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
    expect(calls.refreshes).toBe(1);
    const updated = await readIdbSession(second.page);
    expect(updated?.access_token).toBe(state.activeSession.access_token);
    expect(updated?.access_token).not.toBe(state.rejectToken);
  } finally {
    await second.context.close();
  }
}));

test('CA-05 · conserva la sesión ante fallo temporal de red en arranque en frío y la recupera al volver la conectividad', withTempProfile(async ({ baseURL, userDataDir }) => {
  const state = { user: ownerA, generation: 0, activeSession: null, refreshMode: 'ok' };

  const first = await launchAppProcess(userDataDir);
  try {
    await attachBackend(first.context, state);
    await first.page.goto(`${baseURL}/login`);
    await enter(first.page);

    const expired = { ...state.activeSession, expires_at: Math.floor(Date.now() / 1000) - 120 };
    state.rejectToken = expired.access_token;
    await writeIdbSession(first.page, expired);
  } finally {
    await first.context.close();
  }

  // Proceso 2: arranca con token vencido y Auth devolviendo 503 temporal.
  const second = await launchAppProcess(userDataDir);
  try {
    state.refreshMode = 'serverError';
    const calls = await attachBackend(second.context, state);
    await second.page.clock.install();
    await second.page.goto(`${baseURL}/`);

    // Espera el primer intento de refresh (503) y avanza el reloj para agotar la ventana de backoff del SDK.
    await expect.poll(() => calls.refreshes).toBeGreaterThanOrEqual(1);
    await second.page.clock.fastForward(35_000);
    await expect(second.page.getByRole('heading', { name: 'No pudimos verificar tu sesión' })).toBeVisible();
    await expect(second.page).not.toHaveURL(/\/login$/);
    expect((await readIdbSession(second.page))?.refresh_token).toBeTruthy();

    // Vuelve la conectividad: recuperación automática sin esperar el cooldown de 60 s ni reingresar con Google.
    state.refreshMode = 'ok';
    await second.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(second.page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
    expect(calls.refreshes).toBeGreaterThanOrEqual(2);
    expect(calls.exchanges).toBe(0);
  } finally {
    await second.context.close();
  }
}));

test('CA-05 · un error temporal al renovar tras 401 no marca la sesión como vencida y permite recuperar', withTempProfile(async ({ baseURL, userDataDir }) => {
  const state = { user: ownerA, generation: 0, activeSession: null, refreshMode: 'ok' };

  const first = await launchAppProcess(userDataDir);
  try {
    await attachBackend(first.context, state);
    await first.page.goto(`${baseURL}/login`);
    await enter(first.page);
    state.rejectToken = state.activeSession.access_token;
  } finally {
    await first.context.close();
  }

  const second = await launchAppProcess(userDataDir);
  try {
    state.refreshMode = 'serverError';
    const calls = await attachBackend(second.context, state);
    await second.page.clock.install();
    await second.page.goto(`${baseURL}/`);
    await expect.poll(() => calls.refreshes).toBeGreaterThanOrEqual(1);
    await second.page.clock.fastForward(35_000);

    await expect(second.page.getByRole('heading', { name: 'No pudimos verificar tu sesión' })).toBeVisible();
    await expect(second.page.getByRole('heading', { name: 'Tu sesión venció' })).toHaveCount(0);

    state.refreshMode = 'ok';
    await second.page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(second.page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  } finally {
    await second.context.close();
  }
}));

test('CA-06 · cerrar sesión limpia el almacenamiento persistente y solicita ingreso al reabrir en proceso nuevo', withTempProfile(async ({ baseURL, userDataDir }) => {
  const state = { user: ownerA, generation: 0, activeSession: null };

  const first = await launchAppProcess(userDataDir);
  try {
    await attachBackend(first.context, state);
    await first.page.goto(`${baseURL}/login`);
    await enter(first.page);
    await first.page.getByRole('button', { name: 'Ver menú' }).click();
    await first.page.getByRole('dialog').getByRole('link', { name: 'Mi cuenta' }).click();
    await first.page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(first.page).toHaveURL(`${baseURL}/login`);
    expect(await readIdbSession(first.page)).toBeNull();
  } finally {
    await first.context.close();
  }

  const second = await launchAppProcess(userDataDir);
  try {
    await attachBackend(second.context, state);
    await second.page.goto(`${baseURL}/`);
    await expect(second.page).toHaveURL(`${baseURL}/login`);
    await expect(second.page.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
  } finally {
    await second.context.close();
  }
}));

test('CA-07 · rechaza una sesión revocada o definitivamente inválida al reabrir en proceso nuevo', withTempProfile(async ({ baseURL, userDataDir }) => {
  const state = { user: ownerA, generation: 0, activeSession: null, refreshMode: 'ok' };

  const first = await launchAppProcess(userDataDir);
  try {
    await attachBackend(first.context, state);
    await first.page.goto(`${baseURL}/login`);
    await enter(first.page);

    const expired = { ...state.activeSession, expires_at: Math.floor(Date.now() / 1000) - 120 };
    state.rejectToken = expired.access_token;
    await writeIdbSession(first.page, expired);
  } finally {
    await first.context.close();
  }

  const second = await launchAppProcess(userDataDir);
  try {
    state.refreshMode = 'revoked';
    await attachBackend(second.context, state);
    await second.page.goto(`${baseURL}/`);
    await expect(second.page).toHaveURL(`${baseURL}/login`);
    expect(await readIdbSession(second.page)).toBeNull();
  } finally {
    await second.context.close();
  }
}));

test('CA-08 · mantiene aislamiento entre usuarios tras cerrar sesión y reabrir con otra cuenta', withTempProfile(async ({ baseURL, userDataDir }) => {
  const state = { user: ownerA, generation: 0, activeSession: null };

  const first = await launchAppProcess(userDataDir);
  try {
    await attachBackend(first.context, state);
    await first.page.goto(`${baseURL}/login`);
    await enter(first.page);
    await first.page.getByRole('button', { name: 'Ver menú' }).click();
    await first.page.getByRole('dialog').getByRole('link', { name: 'Mi cuenta' }).click();
    await expect(first.page.getByText(ownerA.email)).toBeVisible();
    await first.page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(first.page).toHaveURL(`${baseURL}/login`);
  } finally {
    await first.context.close();
  }

  state.user = ownerB;
  const second = await launchAppProcess(userDataDir);
  try {
    await attachBackend(second.context, state);
    await second.page.goto(`${baseURL}/login`);
    await enter(second.page);
    await second.page.getByRole('button', { name: 'Ver menú' }).click();
    await second.page.getByRole('dialog').getByRole('link', { name: 'Mi cuenta' }).click();
    await expect(second.page.getByText(ownerB.email)).toBeVisible();
    await expect(second.page.getByText(ownerA.email)).toHaveCount(0);
  } finally {
    await second.context.close();
  }

  const third = await launchAppProcess(userDataDir);
  try {
    await attachBackend(third.context, state);
    await third.page.goto(`${baseURL}/cuenta`);
    await expect(third.page.getByText(ownerB.email)).toBeVisible();
    await expect(third.page.getByText(ownerA.email)).toHaveCount(0);
  } finally {
    await third.context.close();
  }
}));

test('HOTFIX-AUTH-02 · reabrir la PWA en /auth/callback (sin código o con código usado) conserva la sesión tras múltiples cierres', withTempProfile(async ({ baseURL, userDataDir }) => {
  const state = { user: ownerA, generation: 0, activeSession: null };

  // Proceso 1: inicio de sesión con Google una sola vez.
  const first = await launchAppProcess(userDataDir);
  try {
    await attachBackend(first.context, state);
    await first.page.goto(`${baseURL}/login`);
    await enter(first.page);
    expect((await readIdbSession(first.page))?.user?.id).toBe(ownerA.id);
  } finally {
    await first.context.close();
  }

  // Proceso 2: cierre total y reapertura desde un acceso directo PWA que abre /auth/callback sin parámetros.
  const second = await launchAppProcess(userDataDir);
  try {
    const calls = await attachBackend(second.context, state);
    let sawExpired = false;
    await second.page.addInitScript(() => {
      window.__sawExpired = false;
      const check = () => {
        if (document.body?.textContent?.includes('El enlace de acceso venció')) window.__sawExpired = true;
      };
      document.addEventListener('DOMContentLoaded', () => {
        check();
        new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
      });
    });
    await second.page.goto(`${baseURL}/auth/callback`);
    await expect(second.page).toHaveURL(`${baseURL}/`);
    await expect(second.page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
    sawExpired = await second.page.evaluate(() => window.__sawExpired);
    expect(sawExpired).toBe(false);
    expect(calls.exchanges).toBe(0);
    expect(calls.logouts).toBe(0);
  } finally {
    await second.context.close();
  }

  // Proceso 3: nuevo cierre total y reapertura con un ?code= vencido/reutilizado en /auth/callback.
  const third = await launchAppProcess(userDataDir);
  try {
    const calls = await attachBackend(third.context, state);
    await third.page.goto(`${baseURL}/auth/callback?code=stale-code`);
    await expect(third.page).toHaveURL(`${baseURL}/`);
    await expect(third.page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
    await expect(third.page.getByRole('heading', { name: 'El enlace de acceso venció' })).toHaveCount(0);
    expect(calls.exchanges).toBe(0);
    expect(calls.logouts).toBe(0);

    // Prepara un access token vencido con refresh token válido para el siguiente reinicio.
    const expired = { ...state.activeSession, expires_at: Math.floor(Date.now() / 1000) - 120 };
    state.rejectToken = expired.access_token;
    await writeIdbSession(third.page, expired);
  } finally {
    await third.context.close();
  }

  // Proceso 4: reabrir en /auth/callback con access token vencido renueva la sesión y entra a Resumen.
  const fourth = await launchAppProcess(userDataDir);
  try {
    const calls = await attachBackend(fourth.context, state);
    await fourth.page.goto(`${baseURL}/auth/callback`);
    await expect(fourth.page).toHaveURL(`${baseURL}/`);
    await expect(fourth.page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
    expect(calls.refreshes).toBe(1);
    expect(calls.logouts).toBe(0);
  } finally {
    await fourth.context.close();
  }
}));

test('HOTFIX-AUTH-02 · reabrir en /auth/callback con falla temporal de red no destruye la sesión y se recupera al reconectar', withTempProfile(async ({ baseURL, userDataDir }) => {
  const state = { user: ownerA, generation: 0, activeSession: null, refreshMode: 'ok' };

  const first = await launchAppProcess(userDataDir);
  try {
    await attachBackend(first.context, state);
    await first.page.goto(`${baseURL}/login`);
    await enter(first.page);

    const expired = { ...state.activeSession, expires_at: Math.floor(Date.now() / 1000) - 120 };
    state.rejectToken = expired.access_token;
    await writeIdbSession(first.page, expired);
  } finally {
    await first.context.close();
  }

  const second = await launchAppProcess(userDataDir);
  try {
    state.refreshMode = 'serverError';
    const calls = await attachBackend(second.context, state);
    await second.page.clock.install();
    await second.page.goto(`${baseURL}/auth/callback`);
    await expect.poll(() => calls.refreshes).toBeGreaterThanOrEqual(1);
    await second.page.clock.fastForward(35_000);

    await expect(second.page.getByRole('heading', { name: 'No pudimos verificar tu sesión' })).toBeVisible();
    await expect(second.page.getByRole('heading', { name: 'El enlace de acceso venció' })).toHaveCount(0);
    expect((await readIdbSession(second.page))?.refresh_token).toBeTruthy();

    state.refreshMode = 'ok';
    await second.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(second.page).toHaveURL(`${baseURL}/`);
    await expect(second.page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
    expect(calls.logouts).toBe(0);
  } finally {
    await second.context.close();
  }
}));

test('HOTFIX-AUTH-02 · un solo clic en «Volver a ingresar» o «Salir» en /auth/callback lleva directo a /login sin doble pulsación', withTempProfile(async ({ baseURL, userDataDir }) => {
  const state = { user: ownerA, generation: 0, activeSession: null, refreshMode: 'ok' };

  // Caso A: sesión revocada en el servidor con access token aún no vencido localmente al reabrir /auth/callback.
  const first = await launchAppProcess(userDataDir);
  try {
    await attachBackend(first.context, state);
    await first.page.goto(`${baseURL}/login`);
    await enter(first.page);
    state.rejectToken = state.activeSession.access_token;
  } finally {
    await first.context.close();
  }

  const second = await launchAppProcess(userDataDir);
  try {
    state.refreshMode = 'revoked';
    await attachBackend(second.context, state);
    await second.page.goto(`${baseURL}/auth/callback`);
    await expect(second.page.getByRole('heading', { name: 'Tu sesión venció' })).toBeVisible();

    // Un solo clic cierra la sesión inválida y navega directo a /login (sin volver a mostrar un error).
    await second.page.getByRole('button', { name: 'Volver a ingresar' }).click();
    await expect(second.page).toHaveURL(`${baseURL}/login`);
    await expect(second.page.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
    expect(await readIdbSession(second.page)).toBeNull();
  } finally {
    await second.context.close();
  }

  // Caso B: error explícito signup_disabled en /auth/callback con sesión existente sale y lleva a /login en un solo clic.
  const third = await launchAppProcess(userDataDir);
  try {
    state.refreshMode = 'ok';
    state.rejectToken = null;
    await attachBackend(third.context, state);
    await third.page.goto(`${baseURL}/login`);
    await enter(third.page);

    await third.page.goto(`${baseURL}/auth/callback?error_code=signup_disabled`);
    await expect(third.page.getByRole('heading', { name: 'Esta cuenta no tiene acceso' })).toBeVisible();
    await third.page.getByRole('button', { name: 'Salir y elegir otra cuenta' }).click();
    await expect(third.page).toHaveURL(`${baseURL}/login`);
    await expect(third.page.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
    expect(await readIdbSession(third.page)).toBeNull();
  } finally {
    await third.context.close();
  }

  // Caso C: tras cerrar sesión, reabrir /auth/callback sin sesión permite ir a /login en un clic sin cerrar sesión.
  const fourth = await launchAppProcess(userDataDir);
  try {
    const calls = await attachBackend(fourth.context, state);
    await fourth.page.goto(`${baseURL}/auth/callback`);
    await expect(fourth.page.getByRole('heading', { name: 'El enlace de acceso venció' })).toBeVisible();
    await fourth.page.getByRole('link', { name: 'Volver a ingresar' }).click();
    await expect(fourth.page).toHaveURL(`${baseURL}/login`);
    expect(calls.logouts).toBe(0);
  } finally {
    await fourth.context.close();
  }
}));
