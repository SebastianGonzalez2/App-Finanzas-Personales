import { expect, test } from '@playwright/test';
import { enter, mockSupabase, ownerA, ownerB, outsider } from './access-fixture.js';

test('ruta privada sin sesión y callback interrumpido', async ({ page }) => {
  const calls = await mockSupabase(page);
  await page.goto('/historial');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
  expect(calls.preferences).toBe(0);

  await page.goto('/auth/callback');
  await expect(page.getByRole('heading', { name: 'El enlace de acceso venció' })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a ingresar' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('intercambio único, consulta 401 y renovación de sesión', async ({ page }) => {
  const calls = await mockSupabase(page, { user: ownerB, revokeFirstToken: true });
  await page.goto('/login');
  await enter(page);
  expect(calls.exchanges).toBe(1);
  expect(calls.refreshes).toBe(1);
  await page.getByRole('link', { name: 'Mi cuenta' }).click();
  await expect(page.getByText(ownerB.email)).toBeVisible();
});

test('una identidad existente sin plaza queda bloqueada y puede salir', async ({ page }) => {
  const calls = await mockSupabase(page, { user: outsider });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(page).toHaveURL(/\/auth\/callback$/);
  await expect(page.getByRole('heading', { name: 'Esta cuenta no tiene acceso' })).toBeVisible();
  await page.getByRole('button', { name: 'Salir y elegir otra cuenta' }).click();
  await expect(page.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
  expect(calls.exchanges).toBe(1);
  expect(calls.logouts).toBe(2);
});

test('un alta denegada limpia el callback y permite elegir otra cuenta', async ({ page }) => {
  const calls = await mockSupabase(page, { signupDenied: true });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(page.getByRole('heading', { name: 'Esta cuenta no tiene acceso' })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/callback$/);
  await page.getByRole('link', { name: 'Elegir otra cuenta' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(calls.exchanges).toBe(0);
});

test('cierre remoto pendiente bloquea la vista incluso tras recargar', async ({ page }) => {
  const calls = await mockSupabase(page, { offlineLogout: true });
  await page.goto('/login');
  await enter(page);
  await page.getByRole('link', { name: 'Mi cuenta' }).click();
  await expect(page.getByText(ownerA.email)).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Cierre remoto pendiente' })).toBeVisible();
  await page.reload();
  await expect(page.getByText(ownerA.email)).toHaveCount(0);
  await page.getByRole('button', { name: 'Reintentar cierre' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(calls.logouts).toBe(3);
});

for (const [width, height] of [[1440, 960], [834, 1112], [375, 812]]) {
  test(`acceso y navegación a ${width} px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await mockSupabase(page);
    await page.goto('/login');
    const button = page.getByRole('button', { name: 'Continuar con Google' });
    await expect(button).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => document.fonts.ready);
    if (width !== 834) {
      const heading = await page.getByRole('heading', { name: 'Ingresá a tu espacio' }).boundingBox();
      expect(heading.height).toBeLessThan(50);
    }
    await expect(page.locator('.sculpture')).toHaveJSProperty('complete', true);
    expect(await page.locator('.sculpture').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath('login.png') });
    await enter(page);
    await page.screenshot({ path: testInfo.outputPath('resumen.png') });

    if (width === 375) {
      const menu = page.getByRole('button', { name: 'Ver menú' });
      await menu.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('link', { name: 'Categorías' })).toBeVisible();
      await expect(dialog.getByRole('link', { name: 'Mi cuenta' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(menu).toBeFocused();
    } else if (width === 834) {
      expect((await page.locator('.rail').boundingBox()).width).toBe(72);
      await page.getByRole('button', { name: 'Expandir barra lateral' }).click();
      await expect(page.getByRole('dialog').getByRole('link', { name: 'Resumen' }))
        .toHaveAttribute('aria-current', 'page');
      await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    } else {
      expect((await page.locator('.rail').boundingBox()).width).toBe(224);
      await page.getByRole('button', { name: 'Colapsar barra lateral' }).click();
      await expect.poll(async () => Math.round((await page.locator('.rail').boundingBox()).width)).toBe(72);
      await page.getByRole('button', { name: 'Expandir barra lateral' }).click();
      await expect(page.getByRole('link', { name: 'Resumen' })).toHaveAttribute('aria-current', 'page');
    }

    await page.getByRole('link', { name: 'Nuevo gasto' }).click();
    await expect(page.getByRole('heading', { name: 'Nuevo gasto' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect(errors).toEqual([]);
  });
}
