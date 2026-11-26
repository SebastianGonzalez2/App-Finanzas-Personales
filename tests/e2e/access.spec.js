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
  await page.getByRole('button', { name: 'Mi cuenta' }).click();
  await expect(page).toHaveURL(/\/$/);
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
  await page.getByRole('button', { name: 'Mi cuenta' }).click();
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
      await expect(dialog.getByRole('button', { name: 'Mi cuenta' })).toBeVisible();
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

    await page.getByRole('link', { name: 'Registrar gasto', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Nuevo gasto' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect(errors).toEqual([]);
  });
}

test('panel integrado de Mi cuenta: apertura, cierre, alineación, correo largo y estados responsive', async ({ page }, testInfo) => {
  const longUser = {
    id: ownerA.id,
    email: 'sebastian.gonzalez.finanzas.personales.2026@gmail.com',
  };
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockSupabase(page, { user: longUser });
  await page.goto('/login');
  await enter(page);

  // La ruta independiente /cuenta ya no existe y redirige al Resumen.
  await page.goto('/cuenta');
  await expect(page).toHaveURL(/\/$/);

  // Navegar a otra sección y comprobar que abrir Mi cuenta mantiene intacta la página actual.
  await page.getByRole('link', { name: 'Categorías' }).click();
  await expect(page).toHaveURL(/\/categorias$/);

  const rail = page.locator('.rail');
  const trigger = rail.getByRole('button', { name: 'Mi cuenta' });
  const card = rail.locator('.account-menu__card');
  const panel = rail.locator('.account-menu__panel');
  const signOut = rail.getByRole('button', { name: 'Cerrar sesión' });
  const navSample = rail.getByRole('link', { name: 'Categorías' });

  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(signOut).toBeHidden();

  // Apertura desde el botón sin navegación.
  await trigger.click();
  await expect(page).toHaveURL(/\/categorias$/);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Cuenta de Google')).toBeVisible();
  await expect(panel.getByText(longUser.email)).toBeVisible();
  await expect(signOut).toBeVisible();

  // Esperar al fin de la transición de apertura antes de medir geometría y capturar.
  await page.waitForTimeout(240);

  const metrics = await page.evaluate(() => {
    const r = document.querySelector('.rail').getBoundingClientRect();
    const nav = document.querySelector('.rail .navitem').getBoundingClientRect();
    const cardEl = document.querySelector('.rail .account-menu__card').getBoundingClientRect();
    const panelEl = document.querySelector('.rail .account-menu__panel');
    const panelBox = panelEl.getBoundingClientRect();
    const btnBox = document.querySelector('.rail .account-menu__trigger').getBoundingClientRect();
    const emailEl = document.querySelector('.rail .account-menu__email');
    const emailBox = emailEl.getBoundingClientRect();
    return {
      railLeft: r.left,
      railRight: r.right,
      navLeft: nav.left,
      navRight: nav.right,
      navWidth: nav.width,
      cardLeft: cardEl.left,
      cardRight: cardEl.right,
      cardWidth: cardEl.width,
      panelLeft: panelBox.left,
      panelRight: panelBox.right,
      panelBottom: panelBox.bottom,
      panelOverflowX: panelEl.scrollWidth - panelEl.clientWidth,
      btnTop: btnBox.top,
      btnLeft: btnBox.left,
      btnRight: btnBox.right,
      btnWidth: btnBox.width,
      emailOverflowX: emailBox.right - panelBox.right,
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  // Alineación exacta y márgenes simétricos idénticos a los demás ítems del sidebar.
  expect(Math.abs(metrics.cardLeft - metrics.navLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.cardRight - metrics.navRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.cardWidth - metrics.navWidth)).toBeLessThanOrEqual(1);
  const leftMargin = metrics.cardLeft - metrics.railLeft;
  const rightMargin = metrics.railRight - metrics.cardRight;
  expect(leftMargin).toBeGreaterThanOrEqual(11);
  expect(rightMargin).toBeGreaterThanOrEqual(11);
  expect(Math.abs(leftMargin - rightMargin)).toBeLessThanOrEqual(2);
  // Panel y botón unidos directamente sin separación y con el mismo ancho.
  expect(Math.abs(metrics.panelBottom - metrics.btnTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.panelLeft - metrics.btnLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.panelRight - metrics.btnRight)).toBeLessThanOrEqual(1);
  // Sin desborde del correo largo ni de la página.
  expect(metrics.panelOverflowX).toBeLessThanOrEqual(0);
  expect(metrics.emailOverflowX).toBeLessThanOrEqual(1);
  expect(metrics.pageOverflowX).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('account-desktop-expanded.png') });

  // Cierre al volver a pulsar «Mi cuenta».
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(signOut).toBeHidden();

  // Cierre al hacer clic fuera del panel.
  await trigger.click();
  await expect(signOut).toBeVisible();
  await page.locator('.page').click({ position: { x: 20, y: 20 } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(signOut).toBeHidden();

  // Cierre con Escape devolviendo el foco al botón.
  await trigger.click();
  await expect(signOut).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(signOut).toBeHidden();
  await expect(trigger).toBeFocused();

  // Modo sidebar contraído (72 px) en escritorio.
  await page.getByRole('button', { name: 'Colapsar barra lateral' }).click();
  await expect.poll(async () => Math.round((await rail.boundingBox()).width)).toBe(72);
  await trigger.click();
  await expect(signOut).toBeVisible();
  await page.waitForTimeout(240);
  const compactBox = await card.boundingBox();
  expect(compactBox.width).toBeGreaterThanOrEqual(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('account-desktop-compact.png') });
  await page.keyboard.press('Escape');
  await expect(signOut).toBeHidden();

  // Modo móvil (375 px) dentro de la hoja de navegación.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'Ver menú' }).click();
  const dialog = page.getByRole('dialog', { name: 'Navegación' });
  await expect(dialog).toBeVisible();
  const mobileTrigger = dialog.getByRole('button', { name: 'Mi cuenta' });
  const mobileSignOut = dialog.getByRole('button', { name: 'Cerrar sesión' });
  await mobileTrigger.click();
  await expect(mobileSignOut).toBeVisible();
  await page.waitForTimeout(240);

  const mobileMetrics = await page.evaluate(() => {
    const sheet = document.querySelector('dialog.sheet');
    const s = sheet.getBoundingClientRect();
    const nav = sheet.querySelector('.navitem').getBoundingClientRect();
    const c = sheet.querySelector('.account-menu__card').getBoundingClientRect();
    const p = sheet.querySelector('.account-menu__panel');
    return {
      leftDelta: Math.abs(c.left - nav.left),
      rightDelta: Math.abs(c.right - nav.right),
      sheetOverflowX: sheet.scrollWidth - sheet.clientWidth,
      panelOverflowX: p.scrollWidth - p.clientWidth,
      leftMargin: c.left - s.left,
      rightMargin: s.right - c.right,
    };
  });
  expect(mobileMetrics.leftDelta).toBeLessThanOrEqual(1);
  expect(mobileMetrics.rightDelta).toBeLessThanOrEqual(1);
  expect(Math.abs(mobileMetrics.leftMargin - mobileMetrics.rightMargin)).toBeLessThanOrEqual(2);
  expect(mobileMetrics.sheetOverflowX).toBeLessThanOrEqual(0);
  expect(mobileMetrics.panelOverflowX).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('account-mobile-open.png') });

  // Primer Escape cierra solo el panel de cuenta, manteniendo abierto el menú móvil.
  await page.keyboard.press('Escape');
  await expect(mobileSignOut).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(mobileTrigger).toBeFocused();

  // Reabrir y cerrar sesión desde el panel móvil.
  await mobileTrigger.click();
  await expect(mobileSignOut).toBeVisible();
  await mobileSignOut.click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(navSample).toHaveCount(0);
});
