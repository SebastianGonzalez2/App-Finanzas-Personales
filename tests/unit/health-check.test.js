import { describe, expect, it, vi } from 'vitest';
import { checkHealth, readConfig } from '../../scripts/supabase-health-check.mjs';

const config = { url: 'https://proyecto.supabase.co', key: 'sb_publishable_x' };
const ok = () => Response.json({ status: 'ok', checked_at: '2026-11-27T19:00:00.123456+00:00' });
const failure = (status, code) => Response.json({ code, message: 'detalle interno' }, { status });

function run(...responses) {
  const request = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) request.mockRejectedValueOnce(response);
    else request.mockResolvedValueOnce(response);
  }
  const sleep = vi.fn(async () => {});
  const lines = [];
  return checkHealth(config, { request, sleep, log: (line) => lines.push(line) })
    .then((result) => ({ result, request, sleep, log: lines.join('\n') }));
}

describe('readConfig', () => {
  it('acepta la URL https y la clave publicable', () => {
    expect(readConfig({ SUPABASE_URL: ' https://proyecto.supabase.co/ ', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x\n' }))
      .toEqual(config);
  });

  it.each([
    {},
    { SUPABASE_URL: config.url },
    { SUPABASE_URL: 'http://proyecto.supabase.co', SUPABASE_PUBLISHABLE_KEY: config.key },
    { SUPABASE_URL: 'no es una url', SUPABASE_PUBLISHABLE_KEY: config.key },
    { SUPABASE_URL: config.url, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_x' },
    { SUPABASE_URL: config.url, SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.service_role' },
  ])('rechaza configuración incompleta o claves administrativas: %o', (env) => {
    expect(() => readConfig(env)).toThrow(/SUPABASE/);
  });
});

describe('checkHealth', () => {
  it('hace un único GET de solo lectura con la clave publicable', async () => {
    const { result, request, sleep } = await run(ok());
    expect(result).toMatchObject({ ok: true, attempts: 1, checkedAt: '2026-11-27T19:00:00.123Z' });
    expect(sleep).not.toHaveBeenCalled();
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('https://proyecto.supabase.co/rest/v1/rpc/health_check');
    expect(options.method).toBeUndefined();
    expect(options.body).toBeUndefined();
    expect(options.headers).toMatchObject({ apikey: config.key, 'Accept-Profile': 'api' });
    expect(options.headers.Authorization).toBeUndefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('reintenta errores transitorios y termina bien', async () => {
    const timeout = new DOMException('timeout', 'TimeoutError');
    const { result, sleep, log } = await run(timeout, failure(503, 'PGRST000'), ok());
    expect(result).toMatchObject({ ok: true, attempts: 3 });
    expect(sleep.mock.calls).toEqual([[10_000], [30_000]]);
    expect(log).toContain('sin respuesta en 20 s');
    expect(log).toContain('HTTP 503 PGRST000');
  });

  it('falla tras tres intentos', async () => {
    const network = new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    const { result, request, log } = await run(network, network, network);
    expect(result).toMatchObject({ ok: false, attempts: 3 });
    expect(request).toHaveBeenCalledTimes(3);
    expect(log).toContain('ENOTFOUND');
  });

  it.each([[401, '42501'], [403, 'PT403'], [404, 'PGRST202'], [406, 'PGRST106'], [540, undefined]])(
    'no reintenta HTTP %i ni registra la clave o el detalle',
    async (status, code) => {
      const { result, request, log } = await run(failure(status, code));
      expect(result).toMatchObject({ ok: false, attempts: 1 });
      expect(request).toHaveBeenCalledTimes(1);
      expect(log).toContain(`HTTP ${status}`);
      expect(log).not.toContain(config.key);
      expect(log).not.toContain('detalle interno');
    },
  );

  it.each([
    new Response('<html>mantenimiento</html>'),
    Response.json({ status: 'error', checked_at: '2026-11-27T19:00:00Z' }),
    Response.json({ status: 'ok' }),
    Response.json(null),
  ])('considera fallida una respuesta 200 inesperada', async (response) => {
    const { result } = await run(response);
    expect(result).toMatchObject({ ok: false, attempts: 1, reason: 'HTTP 200 con una respuesta inesperada.' });
  });
});
