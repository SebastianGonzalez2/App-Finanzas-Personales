import { expect, test } from '@playwright/test';

const apiOrigin = 'http://127.0.0.1:54321';
const preferences = { currency: 'UYU', favorites: [], today: '2026-11-23' };
const ownerA = { id: '00000000-0000-4000-a000-000000000001', email: 'a@example.test' };
const ownerB = { id: '00000000-0000-4000-a000-000000000002', email: 'b@example.test' };
const outsider = { id: '00000000-0000-4000-a000-000000000003', email: 'externa@example.test' };
const denied = { code: 'PT403', message: 'ACCESS_DENIED' };

function mockSession(user, generation = 1) {
  const encode = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp, generation })}.fixture`,
    expires_in: 3600,
    refresh_token: `test-refresh-${generation}`,
    token_type: 'bearer',
    user: { ...user, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' } },
  };
}

async function mockSupabase(page, { user = ownerA, signupDenied = false, revokeFirstToken = false, offlineLogout = false } = {}) {
  const calls = { exchanges: 0, refreshes: 0, logouts: 0, preferences: 0 };
  const session = mockSession(user);
  const refreshed = mockSession(user, 2);
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
  };

  await page.route(`${apiOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const reply = (status, json) => route.fulfill({ status, json, headers: cors });

    if (url.pathname === '/auth/v1/authorize') {
      expect(url.searchParams.get('provider')).toBe('google');
      expect(url.searchParams.get('code_challenge_method')?.toLowerCase()).toBe('s256');
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
      const redirect = new URL(url.searchParams.get('redirect_to'));
      expect(redirect.pathname).toBe('/auth/callback');
      redirect.search = signupDenied ? '?error_code=signup_disabled' : '?code=fixture-code';
      return route.fulfill({ status: 302, headers: { location: redirect.href } });
    }

    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        calls.refreshes += 1;
        return reply(200, refreshed);
      }
      calls.exchanges += 1;
      expect(request.postDataJSON()).toEqual({
        auth_code: 'fixture-code', code_verifier: expect.any(String),
      });
      return reply(200, session);
    }

    if (url.pathname === '/rest/v1/rpc/get_preferences') {
      calls.preferences += 1;
      expect(request.method()).toBe('POST');
      expect(request.headers()['content-profile']).toBe('api');
      const authorization = request.headers().authorization;
      if (revokeFirstToken && authorization === `Bearer ${session.access_token}`) {
        return reply(401, { code: 'PGRST301', message: 'JWT expired' });
      }
      const expected = revokeFirstToken ? refreshed : session;
      expect(authorization).toBe(`Bearer ${expected.access_token}`);
      return user === outsider ? reply(403, denied) : reply(200, preferences);
    }

    if (url.pathname === '/auth/v1/logout') {
      calls.logouts += 1;
      expect(url.searchParams.get('scope')).toBe('local');
      if (offlineLogout && calls.logouts === 1) return route.abort('internetdisconnected');
      if (calls.logouts > (offlineLogout ? 2 : 1)) {
        return reply(403, { code: 'session_not_found', msg: 'Session not found' });
      }
      return route.fulfill({ status: 204, headers: cors });
    }

    return reply(404, { message: 'No existe en el doble de pruebas' });
  });

  return calls;
}

async function enter(page) {
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  await expect(page).toHaveURL(/:4173\/$/);
}

test('ruta privada sin sesión y callback interrumpido', async ({ page }) => {
  const calls = await mockSupabase(page);
  await page.goto('/historial');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
  expect(calls.preferences).toBe(0);

  await page.goto('/auth/callback');
  await expect(page.getByRole('heading', { name: 'El enlace de acceso venció' })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a ingresar' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('intercambio único, consulta 401 y renovación de sesión', async ({ page }) => {
  const calls = await mockSupabase(page, { user: ownerB, revokeFirstToken: true });
  await page.goto('/login');
  await enter(page);
  expect(calls.exchanges).toBe(1);
  expect(calls.refreshes).toBe(1);
  await page.getByRole('link', { name: 'Mi cuenta' }).click();
  await expect(page.getByText(ownerB.email)).toBeVisible();
});

test('una identidad existente sin plaza queda bloqueada y puede salir', async ({ page }) => {
  const calls = await mockSupabase(page, { user: outsider });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(page).toHaveURL(/\/auth\/callback$/);
  await expect(page.getByRole('heading', { name: 'Esta cuenta no tiene acceso' })).toBeVisible();
  await page.getByRole('button', { name: 'Salir y elegir otra cuenta' }).click();
  await expect(page.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
  expect(calls.exchanges).toBe(1);
  expect(calls.logouts).toBe(2);
});

test('un alta denegada limpia el callback y permite elegir otra cuenta', async ({ page }) => {
  const calls = await mockSupabase(page, { signupDenied: true });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(page.getByRole('heading', { name: 'Esta cuenta no tiene acceso' })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/callback$/);
  await page.getByRole('link', { name: 'Elegir otra cuenta' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(calls.exchanges).toBe(0);
});

test('cierre remoto pendiente bloquea la vista incluso tras recargar', async ({ page }) => {
  const calls = await mockSupabase(page, { offlineLogout: true });
  await page.goto('/login');
  await enter(page);
  await page.getByRole('link', { name: 'Mi cuenta' }).click();
  await expect(page.getByText(ownerA.email)).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Cierre remoto pendiente' })).toBeVisible();
  await page.reload();
  await expect(page.getByText(ownerA.email)).toHaveCount(0);
  await page.getByRole('button', { name: 'Reintentar cierre' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(calls.logouts).toBe(3);
});

for (const [width, height] of [[1440, 960], [834, 1112], [375, 812]]) {
  test(`acceso y navegación a ${width} px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await mockSupabase(page);
    await page.goto('/login');
    const button = page.getByRole('button', { name: 'Continuar con Google' });
    await expect(button).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => document.fonts.ready);
    if (width !== 834) {
      const heading = await page.getByRole('heading', { name: 'Ingresá a tu espacio' }).boundingBox();
      expect(heading.height).toBeLessThan(50);
    }
    await expect(page.locator('.sculpture')).toHaveJSProperty('complete', true);
    expect(await page.locator('.sculpture').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath('login.png') });
    await enter(page);
    await page.screenshot({ path: testInfo.outputPath('resumen.png') });

    if (width === 375) {
      const menu = page.getByRole('button', { name: 'Ver menú' });
      await menu.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('link', { name: 'Categorías' })).toBeVisible();
      await expect(dialog.getByRole('link', { name: 'Mi cuenta' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(menu).toBeFocused();
    } else if (width === 834) {
      expect((await page.locator('.rail').boundingBox()).width).toBe(72);
      await page.getByRole('button', { name: 'Expandir barra lateral' }).click();
      await expect(page.getByRole('dialog').getByRole('link', { name: 'Resumen' }))
        .toHaveAttribute('aria-current', 'page');
      await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    } else {
      expect((await page.locator('.rail').boundingBox()).width).toBe(224);
      await page.getByRole('button', { name: 'Colapsar barra lateral' }).click();
      await expect.poll(async () => Math.round((await page.locator('.rail').boundingBox()).width)).toBe(72);
      await page.getByRole('button', { name: 'Expandir barra lateral' }).click();
      await expect(page.getByRole('link', { name: 'Resumen' })).toHaveAttribute('aria-current', 'page');
    }

    await page.getByRole('link', { name: 'Nuevo gasto' }).click();
    await expect(page.getByRole('heading', { name: 'Nuevo gasto' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect(errors).toEqual([]);
  });
}
