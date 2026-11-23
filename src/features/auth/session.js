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
