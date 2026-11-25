import { expect, test } from './database-fixture.js';
import { chooseOption, pickDate } from './controls.js';

test.use({ locale: 'es-UY' });

test('SpringSelect y DatePicker: teclado, Escape sin cerrar diálogos, sin select/date nativos y prefers-reduced-motion', async ({ page, ledger }) => {
  expect(ledger).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 960 });

  // 1. Nuevo gasto: no hay <select> ni <input type="date"> nativos; teclado y DatePicker funcionan.
  await page.goto('/gastos/nuevo');
  await expect(page.locator('select, input[type="date"]')).toHaveCount(0);

  const dateTrigger = page.getByLabel('Fecha', { exact: true });
  await expect(dateTrigger).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(dateTrigger).toHaveAttribute('data-value', '2026-11-23');

  // Abrir DatePicker y cerrar con Escape devuelve el foco al trigger.
  await dateTrigger.click();
  const calendar = page.getByRole('dialog', { name: 'Elegir fecha' });
  await expect(calendar).toBeVisible();
  const popAnim = await calendar.evaluate((el) => getComputedStyle(el).animationTimingFunction);
  expect(popAnim).toMatch(/^linear\(0( 0%)?, 0\.033[ ,]/);
  await page.keyboard.press('Escape');
  await expect(calendar).toHaveCount(0);
  await expect(dateTrigger).toBeFocused();

  // Seleccionar una fecha de otro año mediante el selector de año/mes.
  await pickDate(dateTrigger, '2024-02-29');
  await expect(dateTrigger).toHaveAttribute('data-value', '2024-02-29');
  await expect(dateTrigger).toContainText('2024');

  // SpringSelect con teclado: ArrowDown abre, ArrowDown navega, Enter selecciona, chevron rota.
  const catTrigger = page.getByLabel('Categoría', { exact: true });
  await expect(catTrigger).toHaveAttribute('aria-haspopup', 'listbox');
  await catTrigger.focus();
  await page.keyboard.press('ArrowDown');
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  const menuTiming = await listbox.evaluate((el) => getComputedStyle(el).animationTimingFunction);
  expect(menuTiming).toMatch(/^linear\(0( 0%)?, 0\.0283[ ,]/);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(listbox).toHaveCount(0);
  await expect(catTrigger).toBeFocused();
  await expect(catTrigger).not.toHaveText('Elegí una categoría');

  // 2. Dentro de un <dialog> modal (Presupuestos): Escape cierra el menú sin cerrar el modal.
  await page.goto('/presupuestos');
  await page.getByRole('button', { name: 'Crear límite', exact: true }).first().click();
  const modal = page.getByRole('dialog', { name: 'Crear límite' });
  await expect(modal.locator('select')).toHaveCount(0);
  const modalCat = modal.getByLabel('Categoría');
  await modalCat.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(modal).toBeVisible();
  await expect(modalCat).toBeFocused();
  await chooseOption(modalCat, { label: 'Alimentación' });
  await expect(modalCat).toHaveText('Alimentación');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

  // 3. Historial y Estadísticas: sin <select> ni <input type="date"> nativos; Limpiar fecha funciona.
  await page.goto('/historial');
  await page.getByRole('button', { name: /^Filtros/ }).click();
  await expect(page.locator('select, input[type="date"]')).toHaveCount(0);
  const fromTrigger = page.getByLabel('Desde', { exact: true });
  await pickDate(fromTrigger, '2026-11-10');
  await expect(fromTrigger).toHaveAttribute('data-value', '2026-11-10');
  await fromTrigger.click();
  await page.getByRole('dialog', { name: 'Elegir fecha' }).getByRole('button', { name: 'Limpiar' }).click();
  await expect(fromTrigger).toHaveAttribute('data-value', '');

  await page.goto('/estadisticas');
  await page.getByRole('button', { name: /^Filtros/ }).click();
  await expect(page.locator('select, input[type="date"]')).toHaveCount(0);

  // 4. Con prefers-reduced-motion, ni el popover ni el listbox ejecutan animaciones.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/gastos/nuevo');
  await page.getByLabel('Fecha', { exact: true }).click();
  const reducedCal = page.getByRole('dialog', { name: 'Elegir fecha' });
  expect(await reducedCal.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.keyboard.press('Escape');
  await page.getByLabel('Categoría', { exact: true }).click();
  const reducedList = page.getByRole('listbox');
  expect(await reducedList.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});

test('móvil 360 px: SpringSelect y DatePicker abiertos no producen desborde horizontal', async ({ page, ledger }) => {
  expect(ledger).toBeTruthy();
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/gastos/nuevo');

  await page.getByLabel('Fecha', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Elegir fecha' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');

  await page.getByLabel('Categoría', { exact: true }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
