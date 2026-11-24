import { mkdir, writeFile } from 'node:fs/promises';
import { asUser, sessions, users } from '../../supabase/tests/database/fixture.js';
import { expect, test } from './database-fixture.js';

// IMP-06 · Rendimiento en celular emulado (Chromium, no un dispositivo físico): 375 px, CPU 4×
// y la red móvil de Lighthouse (150 ms de RTT, 1,6 Mbps de bajada, 750 kbps de subida) para los
// archivos estáticos del build de producción. La Data API se sirve desde PostgreSQL embebido en
// la misma máquina (sin red real), con 3.650 gastos de diez años. Cinco cargas en frío del
// Resumen y un recorrido por las pantallas; se registran medianas, bytes y llamadas RPC.
test.use({ locale: 'es-UY', viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
test.skip(({ browserName }) => browserName !== 'chromium', 'Usa CDP para limitar CPU y red');

const RUNS = Number(process.env.CIFRA_PERF_RUNS ?? 5);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function seedVolume(ledger) {
  const { categories } = await ledger.rpc('get_catalog');
  await ledger.db.exec('reset role');
  await ledger.db.query(`
    with rows as (select n, md5('imp06-perf' || n)::uuid as id from generate_series(1, 3650) as n),
    keys as (insert into app.expense_keys select $1, id, repeat('e', 64) from rows returning id)
    insert into app.expenses (owner_id, id, amount, currency, spent_on, category_id, description)
    select $1, r.id, (((abs(hashint4(r.n)) % 90000) + 100)::numeric / 100)::numeric(14,2),
      (array['UYU','UYU','USD','EUR'])[1 + r.n % 4], date '2026-11-23' - (r.n % 3650), ($2::uuid[])[1 + r.n % 13],
      'Gasto sintético ' || r.n
    from rows r join keys k on k.id = r.id`, [users.a, categories.map((row) => row.id)]);
  await asUser(ledger.db, users.a, sessions.a);
  for (const category of categories.slice(0, 5)) {
    await ledger.rpc('create_budget', { category_id: category.id, currency: 'UYU', monthly_limit: '1000' });
  }
}

test('carga en frío del Resumen y navegación entre pantallas en celular', async ({ page, ledger }) => {
  test.setTimeout(180_000);
  await seedVolume(ledger);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const cold = [];
  for (let run = 0; run < RUNS; run += 1) {
    await cdp.send('Network.clearBrowserCache');
    await page.goto('about:blank');
    const started = Date.now();
    await page.goto('/');
    await expect(page.locator('section[aria-labelledby="overview-month"] .hero-value')).toContainText('UYU', { timeout: 30_000 });
    const hero = Date.now() - started;
    await expect(page.locator('section[aria-labelledby="overview-recent"] tbody tr')).toHaveCount(5);
    const complete = Date.now() - started;
    const paint = await page.evaluate(() => new Promise((resolve) => {
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        resolve({ fcp, lcp: entries.at(-1)?.startTime ?? null });
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      setTimeout(() => resolve({ fcp, lcp: null }), 1000);
    }));
    const bytes = await page.evaluate(() => performance.getEntriesByType('resource')
      .concat(performance.getEntriesByType('navigation'))
      .filter((entry) => entry.name.startsWith(location.origin))
      .reduce((sum, entry) => sum + entry.transferSize, 0));
    cold.push({ hero, complete, fcp: Math.round(paint.fcp), lcp: Math.round(paint.lcp), kib: Math.round(bytes / 1024) });
  }

  // Recorrido con caché caliente: cada paso mide hasta el contenido útil y las RPC que dispara.
  const steps = [];
  async function step(name, action, ready) {
    ledger.calls.length = 0;
    const started = Date.now();
    await action();
    await expect(ready()).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    steps.push({ name, ms: Date.now() - started, rpcs: ledger.calls.map((call) => call.name) });
  }
  const nav = async (label) => {
    await page.getByRole('button', { name: 'Ver menú' }).click();
    await page.getByRole('dialog', { name: 'Navegación' }).getByRole('link', { name: label, exact: true }).click();
  };
  await step('Resumen → Historial', () => nav('Historial'), () => page.locator('.expense-table tbody tr').first());
  await step('Historial · cargar más', () => page.getByRole('button', { name: 'Cargar más gastos' }).click(),
    () => page.locator('.expense-table tbody tr').nth(59));
  await step('Historial → Presupuestos', () => nav('Presupuestos'), () => page.getByText('Mayor uso del límite'));
  await step('Presupuestos → Estadísticas', () => nav('Estadísticas'), () => page.locator('[data-panel="annual"] .recharts-surface'));
  await step('Estadísticas · Últimos 12 meses', () => page.getByLabel(/^Período/).selectOption('12m'),
    () => page.locator('[data-panel="monthly"] .recharts-bar-rectangle').nth(11));
  await step('Estadísticas → Resumen', () => nav('Resumen'), () => page.locator('section[aria-labelledby="overview-month"] .hero-value'));
  await step('Resumen → Nuevo gasto', () => page.getByRole('link', { name: 'Nuevo gasto' }).click(), () => page.getByLabel('Importe del gasto'));

  const summary = {
    frio: { runs: cold, mediana: Object.fromEntries(['hero', 'complete', 'fcp', 'lcp', 'kib'].map((key) => [key, median(cold.map((run) => run[key]))])) },
    recorrido: steps,
  };
  console.log('IMP-06 rendimiento', JSON.stringify(summary));
  await mkdir('test-results/audit', { recursive: true });
  await writeFile('test-results/audit/performance.json', JSON.stringify(summary, null, 2));
  // Sin cascadas ni repeticiones: cada pantalla pide solo lo que muestra.
  for (const { name, rpcs } of steps) expect(new Set(rpcs).size, name + ': RPC repetidas ' + rpcs).toBe(rpcs.length);
  expect(summary.frio.mediana.complete).toBeLessThan(15_000);
});
