// Comprobación de disponibilidad de la base de producción (docs/keep-alive.md).
// Llama a api.health_check() por la Data API con la clave publicable. Sin dependencias.
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const ATTEMPTS = 3;
export const TIMEOUT_MS = 20_000;
export const RETRY_DELAYS_MS = [10_000, 30_000];

// Errores que pueden resolverse solos. El resto (clave, permisos, función ausente, proyecto
// pausado) falla en el primer intento.
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

const HINTS = {
  401: 'Revisá la clave publicable y que la migración health_check esté aplicada.',
  403: 'Revisá los permisos de api.health_check().',
  404: 'No existe api.health_check(): aplicá la migración health_check.',
  406: 'El esquema api no está expuesto en la Data API.',
  540: 'El proyecto está pausado: restauralo desde el panel de Supabase.',
};

export function readConfig(env) {
  const rawUrl = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!rawUrl || !key) throw new Error('Faltan SUPABASE_URL o SUPABASE_PUBLISHABLE_KEY.');
  // Una clave secreta o service_role no debe usarse nunca para esta comprobación.
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY debe ser una clave publicable (sb_publishable_…).');
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('SUPABASE_URL no es una URL válida.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('SUPABASE_URL debe ser una URL https sin credenciales.');
  }
  return { url: url.origin, key };
}

async function attempt({ url, key }, request, timeoutMs) {
  let response;
  let text;
  try {
    // GET ejecuta la función en una transacción de solo lectura.
    response = await request(`${url}/rest/v1/rpc/health_check`, {
      headers: { apikey: key, 'Accept-Profile': 'api', 'Cache-Control': 'no-cache' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await response.text();
  } catch (error) {
    const reason = error?.name === 'TimeoutError'
      ? `sin respuesta en ${timeoutMs / 1000} s`
      : `error de red (${error?.cause?.code ?? error?.name ?? 'desconocido'})`;
    return { ok: false, transient: true, reason };
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  const { status } = response;
  if (status !== 200) {
    // Solo el código de error: el registro de Actions es público.
    const code = /^[A-Z0-9_]{1,20}$/i.test(body?.code ?? '') ? ` ${body.code}` : '';
    const hint = HINTS[status] ? ` ${HINTS[status]}` : '';
    return { ok: false, transient: TRANSIENT_STATUS.has(status), reason: `HTTP ${status}${code}.${hint}` };
  }
  if (body?.status !== 'ok' || Number.isNaN(Date.parse(body.checked_at))) {
    return { ok: false, transient: false, reason: 'HTTP 200 con una respuesta inesperada.' };
  }
  return { ok: true, checkedAt: new Date(body.checked_at).toISOString() };
}

export async function checkHealth(config, {
  request = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  for (let number = 1; ; number += 1) {
    const started = Date.now();
    const result = await attempt(config, request, timeoutMs);
    const elapsed = `${Date.now() - started} ms`;
    const label = `Intento ${number}/${ATTEMPTS} · ${new Date(started).toISOString()}`;

    if (result.ok) {
      log(`${label} · OK en ${elapsed} · hora de PostgreSQL ${result.checkedAt}`);
      return { ...result, attempts: number };
    }
    log(`${label} · FALLÓ en ${elapsed} · ${result.reason}`);
    if (!result.transient || number === ATTEMPTS) return { ...result, attempts: number };

    const delay = RETRY_DELAYS_MS[number - 1];
    log(`Reintento en ${delay / 1000} s.`);
    await sleep(delay);
  }
}

async function main() {
  let message;
  let ok = false;
  try {
    const config = readConfig(process.env);
    console.log(`Comprobando api.health_check() en ${new URL(config.url).hostname}`);
    const result = await checkHealth(config);
    ok = result.ok;
    message = ok
      ? `Base de datos disponible (intento ${result.attempts}, PostgreSQL ${result.checkedAt}).`
      : `La base de datos no respondió correctamente tras ${result.attempts} intento(s): ${result.reason}`;
  } catch (error) {
    message = error.message;
  }

  if (ok) console.log(message);
  else {
    console.error(process.env.GITHUB_ACTIONS ? `::error title=Supabase health check::${message}` : message);
    process.exitCode = 1;
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${ok ? '✅' : '❌'} ${message}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
