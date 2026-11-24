export function validateSupabaseConfig(rawUrl, key) {
  if (!rawUrl || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key ?? '')) return null;

  try {
    const url = new URL(rawUrl);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.hostname.includes('*') || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash
    ) return null;

    return { url: url.origin, key };
  } catch {
    return null;
  }
}

// Proyecto Supabase de desarrollo y pruebas (cifra-development). Producción usa otro proyecto.
export const DEVELOPMENT_PROJECT_REF = 'ljbrukrakumuatjnwxwd';

// Comprobación del build en Vercel (VERCEL_ENV = production | preview | development).
export function deploymentProblem(vercelEnv, config) {
  if (!vercelEnv) return null;
  if (!config) return 'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY válidas para este entorno de Vercel.';
  if (vercelEnv === 'production' && new URL(config.url).hostname.startsWith(DEVELOPMENT_PROJECT_REF + '.')) {
    return 'Producción no puede usar el proyecto Supabase de desarrollo.';
  }
  return null;
}
