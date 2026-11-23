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
