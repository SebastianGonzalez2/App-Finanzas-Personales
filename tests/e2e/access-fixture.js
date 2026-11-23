import { expect } from '@playwright/test';

const apiOrigin = 'http://127.0.0.1:54321';
const preferences = { currency: 'UYU', favorites: [], today: '2026-11-23' };
export const ownerA = { id: '00000000-0000-4000-a000-000000000001', email: 'a@example.test' };
export const ownerB = { id: '00000000-0000-4000-a000-000000000002', email: 'b@example.test' };
export const outsider = { id: '00000000-0000-4000-a000-000000000003', email: 'externa@example.test' };
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

export async function mockSupabase(page, { user = ownerA, signupDenied = false, revokeFirstToken = false, offlineLogout = false } = {}) {
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

    if (url.pathname === '/rest/v1/rpc/get_catalog') return reply(200, { categories: [], subcategories: [] });

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
