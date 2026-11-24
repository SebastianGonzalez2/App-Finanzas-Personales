import { expect } from '@playwright/test';

const apiOrigin = 'http://127.0.0.1:54321';
const preferences = { currency: 'UYU', favorites: [], today: '2026-11-23' };
export const ownerA = { id: '00000000-0000-4000-a000-000000000001', email: 'a@example.test' };
export const ownerB = { id: '00000000-0000-4000-a000-000000000002', email: 'b@example.test' };
export const outsider = { id: '00000000-0000-4000-a000-000000000003', email: 'externa@example.test' };
const denied = { code: 'PT403', message: 'ACCESS_DENIED' };

function mockSession(user, generation = 1, lifetime = 3600) {
  const encode = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + lifetime;
  return {
    access_token: `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp, generation })}.fixture`,
    expires_in: lifetime,
    refresh_token: `test-refresh-${generation}`,
    token_type: 'bearer',
    user: { ...user, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' } },
  };
}

// get_stats without expenses: every month of the range is empty (count 0, total NULL).
function emptyStats({ filters, reference = null }) {
  const months = [];
  let [year, month] = filters.from.split('-').map(Number);
  const [lastYear, lastMonth] = filters.to.split('-').map(Number);
  while (year * 12 + month <= lastYear * 12 + lastMonth) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    months.push({ month: key, from: key + '-01' < filters.from ? filters.from : key + '-01',
      to: end > filters.to ? filters.to : end, count: 0, total: null });
    [year, month] = month === 12 ? [year + 1, 1] : [year, month + 1];
  }
  const metric = { count: 0, total: null };
  return {
    filters: { ...filters, category_id: null, subcategory_id: null, unclassified_child: false },
    reference, comparable: reference ? false : null,
    indicator: { current: metric, reference: reference ? metric : null, delta: null, percent: null },
    months, month_next_offset: null, categories: [], children: [], category_comparisons: [],
  };
}

// expiresIn acorta la vida del primer token para que el SDK lo renueve durante la prueba (IMP-06).
export async function mockSupabase(page, { user = ownerA, signupDenied = false, revokeFirstToken = false, offlineLogout = false, expiresIn = 3600 } = {}) {
  const calls = { exchanges: 0, refreshes: 0, logouts: 0, preferences: 0 };
  const session = mockSession(user, 1, expiresIn);
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
      // WebKit no admite redirecciones en route.fulfill: el doble responde con una página que navega.
      if (page.context().browser().browserType().name() === 'webkit') {
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: `<script>location.replace(${JSON.stringify(redirect.href)})</script>` });
      }
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

    if (url.pathname === '/rest/v1/rpc/get_catalog') return reply(200, { categories: [], subcategories: [] });
    // Resumen (IMP-05) de una cuenta sin gastos ni límites.
    if (url.pathname === '/rest/v1/rpc/get_stats') return reply(200, emptyStats(request.postDataJSON()));
    if (url.pathname === '/rest/v1/rpc/get_budgets') {
      return reply(200, { month: preferences.today.slice(0, 7), currency: request.postDataJSON().currency, items: [] });
    }
    if (url.pathname === '/rest/v1/rpc/list_expenses') return reply(200, { items: [], next_cursor: null });

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

export async function enter(page) {
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === '/' && !url.search);
}
