import { asUser, sessions, users } from '../../supabase/tests/database/fixture.js';
import { expect, test } from './database-fixture.js';
import { chooseOption } from './controls.js';

// Medición orientativa (ARCH-01 §12): Chromium con viewport de 375 px y CPU ralentizada 4×.
// La Data API se sirve desde PostgreSQL embebido en la misma máquina, así que los tiempos
// excluyen la red real; miden el costo de cliente (descarga local, render y gráficos).
test.use({ viewport: { width: 375, height: 812 }, locale: 'es-UY' });

test('tiempos de carga y de cambio de moneda en Estadísticas con diez años de gastos', async ({ page, ledger }) => {
  const { categories } = await ledger.rpc('get_catalog');
  await ledger.db.exec('reset role');
  await ledger.db.query(`
    with rows as (select n, md5('e2e-perf' || n)::uuid as id from generate_series(1, 3650) as n),
    keys as (insert into app.expense_keys select $1, id, repeat('d', 64) from rows returning id)
    insert into app.expenses (owner_id, id, amount, currency, spent_on, category_id)
    select $1, r.id, (((abs(hashint4(r.n)) % 90000) + 100)::numeric / 100)::numeric(14,2),
      (array['UYU','UYU','USD','EUR'])[1 + r.n % 4], date '2026-11-23' - r.n, ($2::uuid[])[1 + r.n % 13]
    from rows r join keys k on k.id = r.id`, [users.a, categories.map((row) => row.id)]);
  await asUser(ledger.db, users.a, sessions.a);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const results = {};
  const started = Date.now();
  await page.goto('/estadisticas?periodo=12m');
  await expect(page.locator('section[data-panel="metrics"] dd.figure').first()).toContainText('UYU');
  results.indicadores = Date.now() - started;
  await expect(page.locator('section[data-panel="monthly"] .recharts-surface')).toBeVisible();
  await expect(page.locator('section[data-panel="annual"] .year-dot').first()).toBeVisible();
  results.graficos = Date.now() - started;

  const switched = Date.now();
  await page.getByRole('group', { name: 'Moneda de consulta' }).getByRole('button', { name: 'EUR' }).click();
  await expect(page.locator('section[data-panel="metrics"] dd.figure').first()).toContainText('EUR');
  await expect(page.locator('section[data-panel="annual"] .annual-meta')).toContainText('EUR');
  results.cambioMoneda = Date.now() - switched;

  const period = Date.now();
  await chooseOption(page.locator('.stats-filters .spring-select__trigger').first(), 'anio');
  await expect(page.locator('.page-description')).toHaveText('Del 1 de enero al 31 de diciembre de 2026');
  await expect(page.locator('section[data-panel="metrics"] dd.figure').first()).toContainText('EUR');
  results.cambioPeriodo = Date.now() - period;

  const transfer = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry) => entry.name.includes('/assets/'))
    .map((entry) => [entry.name.split('/').pop().replace(/-[\w-]{8}\./, '.'), Math.round(entry.encodedBodySize / 1024)]));
  const rpcs = ledger.calls.filter((call) => ['get_stats', 'get_annual'].includes(call.name)).length;
  test.info().annotations.push({ type: 'medición', description: JSON.stringify({ ms: results, rpcs, assetsKiB: transfer }) });
  console.log('IMP-04 rendimiento', JSON.stringify({ ms: results, rpcs, assetsKiB: transfer }));
  // Cota amplia contra regresiones graves; la meta real se mide en un teléfono físico.
  expect(results.graficos).toBeLessThan(10_000);
});
