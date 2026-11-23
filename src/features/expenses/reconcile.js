// After a lost response, read the server state before repeating the exact frozen request.
// Returns the confirmed result, false when the write did not happen (safe to repeat),
// or null when a create must be re-sent so the server can verify its fingerprint.
export async function reconcileWrite(api, { action, args }) {
  let current;
  try {
    current = await api.rpc('get_expense', { id: args.id });
  } catch (error) {
    if (error.code !== 'EXPENSE_NOT_FOUND' || error.status !== 404) throw error;
    if (action === 'delete') return { id: args.id, deleted: true };
    if (action === 'create') return false;
    throw error;
  }
  if (action === 'create') {
    // Ask create_expense to verify the original fingerprint if the expense has since changed.
    return Object.entries(args).every(([field, value]) => current[field] === value) ? current : null;
  }
  if (current.version === args.version) return false;
  if (action === 'update' && current.version === args.version + 1 &&
      Object.entries(args).every(([field, value]) => field === 'version' || current[field] === value)) return current;
  throw Object.assign(new Error('El gasto cambió desde que lo abriste.'), { code: 'STALE_VERSION', status: 409 });
}

// Network loss, timeouts and server faults leave the outcome unknown.
export function isUncertain(error) {
  return !error.status || error.status >= 500 || error.status === 408;
}
