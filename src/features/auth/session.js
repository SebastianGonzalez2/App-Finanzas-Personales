export class SessionCheckError extends Error {
  constructor(status) {
    super('No se pudo verificar el acceso.');
    this.status = status;
  }
}

export function signInWithGoogle(client, origin) {
  return client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: new URL('/auth/callback', origin).href,
      queryParams: { prompt: 'select_account' },
    },
  });
}

export function readCallback(search) {
  const params = new URLSearchParams(search);
  const code = params.get('code');
  const error = params.get('error_code');
  if (error === 'signup_disabled' || params.get('error_description') === 'SIGNUP_NOT_ALLOWED') {
    return { status: 'denied' };
  }
  if (!code || params.has('error') || error) return { status: 'expired' };
  return { status: 'exchange', code };
}

export async function exchangeSession(client, code) {
  try {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (!error && data.session) return 'complete';
    return !error || (error.status >= 400 && error.status < 500) || error.code === 'pkce_verifier_not_found'
      ? 'expired'
      : 'exchangeFailed';
  } catch {
    return 'exchangeFailed';
  }
}

export function accessStatus(status) {
  if (status === 401) return 'sessionExpired';
  if (status === 403) return 'denied';
  return 'failed';
}

export function isTransientAuthError(error) {
  if (!error) return false;
  if (error.name === 'AuthRetryableFetchError') return true;
  if (typeof error.status === 'number') return error.status === 0 || error.status >= 500;
  return error instanceof TypeError;
}

// ARCH-01 §9: «today» se vuelve a pedir al servidor al cambiar el día civil de Montevideo si la
// aplicación sigue abierta. Milisegundos hasta la próxima medianoche de esa zona, más un margen
// para no consultar antes de tiempo; el servidor sigue siendo la fuente de la fecha.
const civilClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Montevideo', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
export function untilNextCivilDay(now = Date.now()) {
  const parts = Object.fromEntries(civilClock.formatToParts(now).map(({ type, value }) => [type, Number(value)]));
  const elapsed = ((parts.hour * 60 + parts.minute) * 60 + parts.second) * 1000 + (now % 1000);
  return 86_400_000 - elapsed + 5_000;
}
