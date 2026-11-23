import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { validateSupabaseConfig } from './src/lib/supabaseConfig.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const config = validateSupabaseConfig(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
  // Use the origin from this build, so a preview never falls back to production.
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    `connect-src 'self'${config ? ` ${config.url}` : ''}`,
  ].join('; ');

  return {
    server: { strictPort: true },
    plugins: [
      react(),
      {
        name: 'cifra-csp',
        apply: 'build',
        transformIndexHtml: () => [
          { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
        ],
      },
    ],
    build: {
      assetsInlineLimit: 0,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{ name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ }],
          },
        },
      },
    },
    test: { include: ['tests/unit/**/*.test.js'] },
  };
});
