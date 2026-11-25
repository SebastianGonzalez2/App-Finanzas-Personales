import { expect, test } from './database-fixture.js';
import { chooseOption } from './controls.js';

test.use({ locale: 'es-UY' });

const button = (scope, name) => scope.getByRole('button', { name, exact: true });

test('toasts globales en gastos: centrado sobre área principal, sin desplazar contenido, persiste al navegar y conserva «Ver gasto»', async ({ page, ledger }, info) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/historial');
  const mainTopBefore = await page.locator('main#contenido').evaluate((node) => node.getBoundingClientRect().top);

  // Registrar gasto y confirmar que el toast aparece centrado sobre el área principal (no sobre la barra lateral).
  await page.getByRole('link', { name: 'Registrar gasto' }).first().click();
  await page.getByLabel('Importe del gasto').fill('450,00');
  await chooseOption(page.getByLabel('Categoría', { exact: true }), { label: 'Alimentación' });
  await page.getByLabel('Descripción · opcional').fill('Almuerzo');
  await button(page, 'Guardar gasto').click();

  await expect(page).toHaveURL(/\/historial$/);
  const toast = page.locator('.toast[data-variant="success"]').filter({ hasText: 'Gasto guardado' });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute('role', 'status');
  await expect(toast.getByRole('link', { name: 'Ver gasto' })).toBeVisible();

  // No desplaza el contenido principal ni deja banners inline antiguos.
  expect(await page.locator('.feedback').count()).toBe(0);
  const mainTopDuring = await page.locator('main#contenido').evaluate((node) => node.getBoundingClientRect().top);
  expect(mainTopDuring).toBe(mainTopBefore);

  // Centrado horizontal respecto al área principal (a la derecha de .rail de 224 px).
  const geometry = await page.evaluate(() => {
    const rail = document.querySelector('.rail').getBoundingClientRect();
    const toastBox = document.querySelector('.toast').getBoundingClientRect();
    const mainCenter = rail.right + (window.innerWidth - rail.right) / 2;
    const toastCenter = toastBox.left + toastBox.width / 2;
    return { diff: Math.abs(mainCenter - toastCenter), viewportPointer: getComputedStyle(document.querySelector('.toast-viewport')).pointerEvents };
  });
  expect(geometry.diff).toBeLessThanOrEqual(2);
  expect(geometry.viewportPointer).toBe('none');

  // Persiste durante la navegación a otra sección.
  await page.getByRole('link', { name: 'Presupuestos' }).first().click();
  await expect(page).toHaveURL(/\/presupuestos$/);
  await expect(toast).toBeVisible();

  // Al colapsar la barra lateral, el centrado acompaña el nuevo ancho del área principal.
  await page.getByRole('button', { name: 'Colapsar barra lateral' }).click();
  await page.waitForTimeout(180);
  const compactDiff = await page.evaluate(() => {
    const rail = document.querySelector('.rail').getBoundingClientRect();
    const toastBox = document.querySelector('.toast').getBoundingClientRect();
    const mainCenter = rail.right + (window.innerWidth - rail.right) / 2;
    const toastCenter = toastBox.left + toastBox.width / 2;
    return Math.abs(mainCenter - toastCenter);
  });
  expect(compactDiff).toBeLessThanOrEqual(2);

  // Acción «Ver gasto» navega a la edición y cierra la notificación.
  await toast.getByRole('link', { name: 'Ver gasto' }).click();
  await expect(page).toHaveURL(/\/gastos\/[^/]+\/editar$/);
  await expect(toast).toHaveCount(0);

  // Actualizar gasto muestra «Cambios guardados» con «Ver gasto».
  await page.getByLabel('Importe del gasto').fill('500,00');
  await button(page, 'Guardar cambios').click();
  const updated = page.locator('.toast[data-variant="success"]').filter({ hasText: 'Cambios guardados' });
  await expect(updated).toBeVisible();
  await expect(updated.getByRole('link', { name: 'Ver gasto' })).toBeVisible();

  // Cierre manual con «×».
  await updated.getByRole('button', { name: 'Cerrar notificación' }).click();
  await expect(updated).toHaveCount(0);

  // Eliminar gasto desde el historial muestra «Gasto eliminado».
  await page.goto('/historial');
  await button(page, 'Acciones para Almuerzo').click();
  await button(page, 'Eliminar').click();
  await button(page.getByRole('dialog'), 'Eliminar gasto').click();
  const deleted = page.locator('.toast[data-variant="success"]').filter({ hasText: 'Gasto eliminado' });
  await expect(deleted).toBeVisible();
  await page.waitForTimeout(260);
  await page.screenshot({ path: info.outputPath('toast-desktop-deleted.png') });
  expect(ledger.calls.filter((call) => call.name === 'delete_expense')).toHaveLength(1);
});

test('categorías y subcategorías muestran toasts para crear, actualizar, archivar y restaurar', async ({ page, ledger }) => {
  expect(ledger).toBeTruthy();
  await page.goto('/categorias');

  const expectSuccessToast = async (text) => {
    const toast = page.locator('.toast[data-variant="success"]').filter({ hasText: text }).last();
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Cerrar notificación' }).click();
    await expect(toast).toHaveCount(0);
  };

  // Categoría: crear, actualizar, archivar, restaurar.
  await button(page, 'Crear categoría').click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill('Mascotas');
  await button(dialog, 'Crear categoría').click();
  await expectSuccessToast('Categoría creada');

  await button(page, 'Editar Mascotas').click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill('Animales');
  await button(dialog, 'Guardar cambios').click();
  await expectSuccessToast('Categoría actualizada');

  // Subcategoría: crear, actualizar, archivar, restaurar.
  await button(page, 'Animales').click();
  await button(page, 'Crear subcategoría').click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill('Veterinaria');
  await button(dialog, 'Crear subcategoría').click();
  await expectSuccessToast('Subcategoría creada');

  await button(page, 'Editar Veterinaria').click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill('Clínica');
  await button(dialog, 'Guardar cambios').click();
  await expectSuccessToast('Subcategoría actualizada');

  await button(page, 'Editar Clínica').click();
  dialog = page.getByRole('dialog');
  await button(dialog, 'Archivar subcategoría').click();
  await expectSuccessToast('Subcategoría archivada');

  await button(page, 'Archivadas').click();
  await button(page, 'Animales').click();
  await button(page, 'Editar Clínica').click();
  dialog = page.getByRole('dialog');
  await button(dialog, 'Restaurar subcategoría').click();
  await expectSuccessToast('Subcategoría restaurada');

  await button(page, 'Activas').click();
  await button(page, 'Editar Animales').click();
  dialog = page.getByRole('dialog');
  await button(dialog, 'Archivar categoría').click();
  await expectSuccessToast('Categoría archivada');

  await button(page, 'Archivadas').click();
  await button(page, 'Editar Animales').click();
  dialog = page.getByRole('dialog');
  await button(dialog, 'Restaurar categoría').click();
  await expectSuccessToast('Categoría restaurada');
});

test('temporizador de 4 s, pausa al pasar el puntero y variante de error ante fallo real', async ({ page, ledger }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/categorias');

  // Crear categoría y mantener el puntero encima > 4,5 s: no debe cerrarse mientras se interactúa.
  await button(page, 'Crear categoría').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill('Hobbies');
  await button(dialog, 'Crear categoría').click();

  const toast = page.locator('.toast[data-variant="success"]').filter({ hasText: 'Categoría creada' });
  await expect(toast).toBeVisible();
  await toast.hover();
  await page.waitForTimeout(4400);
  await expect(toast).toBeVisible();

  // Al sacar el puntero se reanuda el tiempo restante y desaparece automáticamente.
  await page.mouse.move(10, 10);
  await expect(toast).toHaveCount(0, { timeout: 5500 });

  // Un error real al cambiar moneda muestra un toast variante error con role="alert".
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'Moneda de consulta' })).toBeVisible();
  ledger.faults.before = 'set_currency';
  await button(page.getByRole('group', { name: 'Moneda de consulta' }), 'USD').click();
  const errorToast = page.locator('.toast[data-variant="error"]');
  await expect(errorToast).toBeVisible();
  await expect(errorToast).toHaveAttribute('role', 'alert');
  await expect(errorToast).toContainText('No pudimos cambiar la moneda');
});

test('adaptación en celular y respeto a prefers-reduced-motion', async ({ page, ledger }, info) => {
  expect(ledger).toBeTruthy();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/presupuestos');

  await button(page, 'Crear límite').first().click();
  const dialog = page.getByRole('dialog', { name: 'Crear límite' });
  await chooseOption(dialog.getByLabel('Categoría'), { label: 'Alimentación' });
  await dialog.getByLabel('Límite mensual').fill('12000');
  await button(dialog, 'Crear límite').click();

  const toast = page.locator('.toast[data-variant="success"]');
  await expect(toast).toBeVisible();
  await page.screenshot({ path: info.outputPath('toast-mobile-budget.png') });
  const metrics = await page.evaluate(() => {
    const toastNode = document.querySelector('.toast');
    const closeNode = document.querySelector('.toast-close');
    const mobileHead = document.querySelector('.mobile-head').getBoundingClientRect();
    const box = toastNode.getBoundingClientRect();
    const closeBox = closeNode.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      belowHeader: box.top >= mobileHead.bottom,
      centerDiff: Math.abs(window.innerWidth / 2 - (box.left + box.width / 2)),
      closeWidth: closeBox.width,
      closeHeight: closeBox.height,
      animationName: getComputedStyle(toastNode).animationName,
    };
  });
  expect(metrics.overflow).toBe(0);
  expect(metrics.belowHeader).toBe(true);
  expect(metrics.centerDiff).toBeLessThanOrEqual(2);
  expect(metrics.closeWidth).toBeGreaterThanOrEqual(44);
  expect(metrics.closeHeight).toBeGreaterThanOrEqual(44);
  expect(metrics.animationName).toBe('none');
});
