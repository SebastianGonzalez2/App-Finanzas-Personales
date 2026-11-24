import { defineConfig } from '@playwright/test';

// CIFRA_E2E_PORT permite usar otro puerto si 4173 está ocupado por otro proceso.
const port = Number(process.env.CIFRA_E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: `http://127.0.0.1:${port}` },
  // Chromium ejecuta toda la suite. WebKit (motor de Safari) repite la auditoría visual de IMP-06.
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: { executablePath: process.env.CIFRA_CHROMIUM_PATH } } },
    { name: 'webkit', use: { browserName: 'webkit' }, testMatch: /audit-.*\.spec\.js$/ },
  ],
  webServer: {
    command: `npm run build -- --outDir dist-e2e && npm run preview -- --outDir dist-e2e --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_cifra_test_fixture',
    },
  },
});
