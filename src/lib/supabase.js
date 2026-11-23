import { createClient } from '@supabase/supabase-js';
import { validateSupabaseConfig } from './supabaseConfig.js';

const config = validateSupabaseConfig(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

export const supabase = config && createClient(config.url, config.key, {
  db: { schema: 'api' },
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: true,
  },
});
