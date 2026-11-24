import { asUser, sessions, users } from '../../supabase/tests/database/fixture.js';
import { expect, test } from './database-fixture.js';

// Medición orientativa del Resumen (ARCH-01 §12), mismo método que IMP-04: Chromium con la
// Data API servida desde PostgreSQL embebido en la misma máquina, sin red real. Diez años de
// gastos (3.650) y cinco límites; se mide en escritorio sin ralentizar y a 375 px con CPU 4×.
for (const [name, viewport, rate] of [['escritorio', { width: 1440, height: 960 }, 1], ['móvil', { width: 375, height: 812 }, 4]]) {
  test(`tiempos de carga del Resumen y del cambio de moneda · ${name}`, async ({ page, ledger }) => {
    await page.setViewportSize(viewport);
    const { categories } = await ledger.rpc('get_catalog');
    await ledger.db.exec('reset role');
    await ledger.db.query(`
      with rows as (select n, md5('e2e-overview' || n)::uuid as id from generate_series(1, 3650) as n),
      keys as (insert into app.expense_keys select $1, id, repeat('d', 64) from rows returning id)
      insert into app.expenses (owner_id, id, amount, currency, spent_on, category_id)
      select $1, r.id, (((abs(hashint4(r.n)) % 90000) + 100)::numeric / 100)::numeric(14,2),
        (array['UYU','UYU','USD','EUR'])[1 + r.n % 4], date '2026-11-23' - (r.n % 3650), ($2::uuid[])[1 + r.n % 13]
      from rows r join keys k on k.id = r.id`, [users.a, categories.map((row) => row.id)]);
    await asUser(ledger.db, users.a, sessions.a);
    for (const category of categories.slice(0, 5)) {
      await ledger.rpc('create_budget', { category_id: category.id, currency: 'UYU', monthly_limit: '1000' });
      await ledger.rpc('create_budget', { category_id: category.id, currency: 'EUR', monthly_limit: '1000' });
    }

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    ledger.calls.length = 0;
    const results = {};
    const started = Date.now();
    await page.goto('/');
    await expect(page.locator('section[aria-labelledby="overview-month"] .hero-value')).toContainText('UYU');
    results.total = Date.now() - started;
    await expect(page.locator('section[aria-labelledby="overview-budgets"] .gauge')).toBeVisible();
    await expect(page.locator('section[aria-labelledby="overview-recent"] tbody tr')).toHaveCount(5);
    await expect(page.locator('section[aria-labelledby="overview-months"] .month-bar')).toHaveCount(6);
    results.completo = Date.now() - started;

    const switched = Date.now();
    await page.getByRole('group', { name: 'Moneda de consulta' }).getByRole('button', { name: 'EUR' }).click();
    await expect(page.locator('section[aria-labelledby="overview-month"] .hero-value')).toContainText('EUR');
    await expect(page.locator('section[aria-labelledby="overview-recent"] tbody td.money').first()).toContainText('EUR');
    await expect(page.locator('section[aria-labelledby="overview-budgets"] .gauge')).toBeVisible();
    results.cambioMoneda = Date.now() - switched;

    const transfer = await page.evaluate(() => performance.getEntriesByType('resource')
      .filter((entry) => entry.name.includes('/assets/'))
      .map((entry) => [entry.name.split('/').pop().replace(/-[\w-]{8}\./, '.'), Math.round(entry.encodedBodySize / 1024)]));
    const rpcs = ledger.calls.map((call) => call.name).sort();
    const report = { ms: results, rpcs, assetsKiB: transfer };
    test.info().annotations.push({ type: 'medición', description: JSON.stringify(report) });
    console.log(`IMP-05 rendimiento ${name}`, JSON.stringify(report));
    // El Resumen no descarga Recharts ni el Historial completo: cuatro lecturas por moneda.
    expect(transfer.some(([file]) => file.startsWith('charts'))).toBe(false);
    expect(rpcs.filter((entry) => entry !== 'set_currency')).toEqual(
      ['get_budgets', 'get_budgets', 'get_stats', 'get_stats', 'get_stats', 'get_stats', 'list_expenses', 'list_expenses']);
    expect(results.completo).toBeLessThan(10_000);
  });
}
