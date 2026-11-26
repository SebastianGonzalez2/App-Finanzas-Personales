import { mkdir } from 'node:fs/promises';
import { expect, test } from './database-fixture.js';
import { chooseOption } from './controls.js';

test.use({ locale: 'es-UY' });

const button = (scope, name) => scope.getByRole('button', { name, exact: true });

test('pagos recurrentes: alta, totales por moneda, edición, generación automática e integración', async ({ page, ledger }) => {
  await page.goto('/pagos-recurrentes');
  await expect(page.getByRole('heading', { name: 'Pagos recurrentes', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Todavía no configuraste pagos recurrentes' })).toBeVisible();

  // Crear Spotify USD 7,99 el día 23 (hoy = 2026-11-23)
  await button(page, 'Nuevo pago recurrente').first().click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo pago recurrente' });
  await dialog.getByLabel('Nombre o descripción').fill('Spotify');
  await dialog.getByLabel('Importe').fill('7,99');
  await button(dialog, 'USD').click();
  await chooseOption(dialog.getByLabel('Categoría', { exact: true }), { label: 'Entretenimiento' });
  await chooseOption(dialog.getByLabel('Día de cobro mensual'), '23');
  await expect(dialog.locator('#\\:r0\\:-day-help, .field-help').last()).toContainText('23/11/2026');
  await button(dialog, 'Guardar pago recurrente').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Pago recurrente creado' })).toBeVisible();

  // Crear Alquiler UYU 9.600,00 el día 15 (pasado en noviembre -> 15/12/2026)
  await button(page, 'Nuevo pago recurrente').first().click();
  const dialog2 = page.getByRole('dialog', { name: 'Nuevo pago recurrente' });
  await dialog2.getByLabel('Nombre o descripción').fill('Alquiler');
  await dialog2.getByLabel('Importe').fill('9600');
  await button(dialog2, 'UYU').click();
  await chooseOption(dialog2.getByLabel('Categoría', { exact: true }), { label: 'Vivienda' });
  await chooseOption(dialog2.getByLabel('Subcategoría · opcional'), { label: 'Alquiler' });
  await chooseOption(dialog2.getByLabel('Día de cobro mensual'), '15');
  await button(dialog2, 'Guardar pago recurrente').click();
  await expect(dialog2).toHaveCount(0);

  // Totales separados por moneda sin conversiones y conteo activo
  await expect(page.getByLabel('Pagos recurrentes activos')).toContainText('2 pagos mensuales');
  const totals = page.getByLabel('Total mensual programado por moneda');
  await expect(totals.locator('[data-currency="UYU"] dd')).toHaveText('9.600,00');
  await expect(totals.locator('[data-currency="USD"] dd')).toHaveText('7,99');

  // Ejecutar proceso automático en la base de prueba: Spotify (día 23) se registra en app.expenses
  await ledger.db.exec('reset role');
  const cronResult = (await ledger.db.query('select private.process_recurring_payments() as r')).rows[0].r;
  expect(cronResult.processed).toBe(1);

  // Verificar integración con Historial e indicador discreto «Recurrente»
  await page.getByRole('link', { name: 'Historial' }).first().click();
  const row = page.locator('.expense-table tbody tr', { hasText: 'Spotify' });
  await expect(row).toContainText('Recurrente');
  await row.getByRole('link', { name: 'Spotify' }).click();
  await expect(page.locator('.recurring-badge')).toHaveText('Pago recurrente automático');

  // Editar individualmente el gasto generado no modifica el pago recurrente
  await page.getByRole('link', { name: 'Editar gasto' }).click();
  await page.getByLabel('Importe del gasto').fill('10,00');
  await button(page, 'Guardar cambios').click();
  await page.getByRole('link', { name: 'Pagos recurrentes' }).first().click();
  await expect(page.locator('.recurring-table tbody tr', { hasText: 'Spotify' })).toContainText('7,99');

  // Verificar integración con Resumen y Estadísticas (moneda USD)
  await page.getByRole('link', { name: 'Resumen' }).first().click();
  await page.getByRole('group', { name: 'Moneda de consulta' }).getByRole('button', { name: 'USD', exact: true }).click();
  await expect(page.locator('section[aria-labelledby="overview-month"] .hero-value')).toHaveText('10,00 USD');
  await page.getByRole('link', { name: 'Estadísticas' }).first().click();
  await expect(page.locator('section[data-panel="categories"] .cat-donut-center-value')).toHaveText('10,00');

  // Eliminar pago recurrente con confirmación: conserva los gastos históricos en Historial
  await page.getByRole('link', { name: 'Pagos recurrentes' }).first().click();
  await page.getByRole('button', { name: 'Acciones para Spotify' }).click();
  await button(page, 'Eliminar').click();
  const delDialog = page.getByRole('dialog', { name: 'Eliminar pago recurrente' });
  await expect(delDialog).toContainText('Los gastos que ya se registraron en el Historial se conservan intactos.');
  await button(delDialog, 'Eliminar pago recurrente').click();
  await expect(delDialog).toHaveCount(0);
  await expect(page.locator('.recurring-table tbody tr')).toHaveCount(1);

  await page.getByRole('link', { name: 'Historial' }).first().click();
  await expect(page.locator('.expense-table tbody tr', { hasText: 'Spotify' })).toHaveCount(1);
});

for (const [width, height, name] of [[1440, 960, '1440'], [375, 812, '375']]) {
  test(`Pagos recurrentes adaptable y captura a ${name} px`, async ({ page, ledger }) => {
    const { categories, subcategories } = await ledger.rpc('get_catalog');
    const cat = (label) => categories.find((c) => c.name === label).id;
    const sub = (label) => subcategories.find((s) => s.name === label).id;
    await ledger.rpc('create_recurring_payment', {
      name: 'Spotify', amount: '7.99', currency: 'USD', category_id: cat('Entretenimiento'), billing_day: 15,
    });
    await ledger.rpc('create_recurring_payment', {
      name: 'Alquiler', amount: '18500.00', currency: 'UYU', category_id: cat('Vivienda'), subcategory_id: sub('Alquiler'), billing_day: 5,
    });

    await page.setViewportSize({ width, height });
    await page.goto('/pagos-recurrentes');
    await expect(width > 1180 ? page.locator('.recurring-table') : page.locator('.recurring-cards')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await mkdir('docs/recurring/capturas', { recursive: true });
    await page.screenshot({ path: `docs/recurring/capturas/pagos-recurrentes-${name}.png`, fullPage: true });
  });
}
