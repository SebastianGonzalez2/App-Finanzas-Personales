import { createClient } from '@supabase/supabase-js';
import { createAuthStorage, requestPersistentStorage } from './authStorage.js';
import { validateSupabaseConfig } from './supabaseConfig.js';

const config = validateSupabaseConfig(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

const storage = config ? createAuthStorage() : undefined;
if (storage) void requestPersistentStorage();

export const supabase = config && createClient(config.url, config.key, {
  db: { schema: 'api' },
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: true,
    ...(storage ? { storage } : {}),
  },
});
