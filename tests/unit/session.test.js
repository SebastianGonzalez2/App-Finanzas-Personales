import { describe, expect, it, vi } from 'vitest';
import { accessStatus, exchangeSession, readCallback, signInWithGoogle } from '../../src/features/auth/session.js';
import { validateSupabaseConfig } from '../../src/lib/supabaseConfig.js';

describe('configuración del cliente', () => {
  const key = 'sb_publishable_fixture';

  it('acepta un origen HTTPS o un servidor local', () => {
    expect(validateSupabaseConfig('https://cifra.example/', key)).toEqual({ url: 'https://cifra.example', key });
    expect(validateSupabaseConfig('http://127.0.0.1:54321', key)).not.toBeNull();
  });

  it.each([
    ['https://cifra.example', 'sb_secret_fixture'],
    ['https://cifra.example', undefined],
    ['http://cifra.example', key],
    ['https://*', key],
    ['https://cifra.example/rest/v1', key],
    ['https://cifra.example/?key=fixture', key],
    ['https://user:password@cifra.example', key],
  ])('rechaza una configuración inválida', (url, value) => {
    expect(validateSupabaseConfig(url, value)).toBeNull();
  });
});

describe('flujo de sesión', () => {
  it('solicita Google y una redirección interna fija', async () => {
    const start = vi.fn().mockResolvedValue({ error: null });
    await signInWithGoogle({ auth: { signInWithOAuth: start } }, 'https://cifra.example');
    expect(start).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'https://cifra.example/auth/callback',
        queryParams: { prompt: 'select_account' },
      },
    });
  });

  it.each([
    ['?code=sample-code', { status: 'exchange', code: 'sample-code' }],
    ['?error_code=signup_disabled', { status: 'denied' }],
    ['?error_description=SIGNUP_NOT_ALLOWED', { status: 'denied' }],
    ['?error=access_denied&code=sample-code', { status: 'expired' }],
    ['', { status: 'expired' }],
  ])('interpreta el callback', (input, result) => {
    expect(readCallback(input)).toEqual(result);
  });

  it.each([
    [{ data: { session: {} }, error: null }, 'complete'],
    [{ data: { session: null }, error: { status: 400 } }, 'expired'],
    [{ data: { session: null }, error: { status: 503 } }, 'exchangeFailed'],
  ])('interpreta el resultado del intercambio', async (response, result) => {
    const exchange = vi.fn().mockResolvedValue(response);
    expect(await exchangeSession({ auth: { exchangeCodeForSession: exchange } }, 'sample-code')).toBe(result);
    expect(exchange).toHaveBeenCalledExactlyOnceWith('sample-code');
  });

  it('distingue una sesión caducada de una plaza denegada y una falla de red', () => {
    expect([401, 403, 0, 500].map(accessStatus)).toEqual(['sessionExpired', 'denied', 'failed', 'failed']);
  });
});
