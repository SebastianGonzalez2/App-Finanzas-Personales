import { expect, test } from './database-fixture.js';

// IMP-06 · Regresión. La renovación del token de la misma persona (cada hora, o al volver a la
// pestaña) reemplazaba toda la aplicación por «Verificando tu sesión…», vaciaba la caché y
// volvía a montar la pantalla: se perdían el foco del formulario y las páginas ya cargadas.
// Ahora la sesión se vuelve a verificar con el token nuevo sin desmontar la vista; si el
// servidor la rechaza, el acceso se cierra igual que antes.
// Token de 125 s: el SDK lo renueva cuando le quedan menos de cuatro intervalos de 30 s.
test.use({ locale: 'es-UY', access: { expiresIn: 125, clock: true } });

test('renovar el token no desmonta la pantalla ni descarta datos ya cargados', async ({ page, ledger }) => {
  const { categories } = await ledger.rpc('get_catalog');
  const category_id = categories.find((entry) => entry.name === 'Alimentación').id;
  for (let day = 1; day <= 35; day += 1) {
    const spent_on = `2026-${day > 23 ? '10' : '11'}-${String(day > 23 ? day - 20 : day).padStart(2, '0')}`;
    await ledger.rpc('create_expense', { id: crypto.randomUUID(), amount: `${day}.00`, currency: 'UYU', spent_on, category_id,
      description: `Gasto ${day}` });
  }
  await page.goto('/historial');
  await expect(page.locator('.expense-table tbody tr')).toHaveCount(30);
  await page.getByRole('button', { name: 'Cargar más gastos' }).click();
  await expect(page.locator('.expense-table tbody tr')).toHaveCount(35);

  // Cualquier aparición del estado de verificación a pantalla completa queda registrada.
  await page.evaluate(() => {
    window.flashed = false;
    new MutationObserver(() => {
      if (document.body.textContent.includes('Verificando tu sesión')) window.flashed = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const listed = ledger.calls.filter((call) => call.name === 'list_expenses').length;
  expect(ledger.auth.refreshes).toBe(0);

  await page.clock.fastForward('00:40');
  await expect.poll(() => ledger.auth.refreshes).toBe(1);
  await page.waitForLoadState('networkidle');

  expect(await page.evaluate(() => window.flashed)).toBe(false);
  await expect(page.locator('.expense-table tbody tr')).toHaveCount(35);
  // Las páginas cargadas siguen en pantalla; no se descargó de nuevo el historial completo.
  expect(ledger.calls.filter((call) => call.name === 'list_expenses').length - listed).toBeLessThanOrEqual(2);

});

test('renovar el token conserva el importe escrito y el foco del formulario', async ({ page, ledger }) => {
  await page.goto('/gastos/nuevo');
  const amount = page.getByLabel('Importe del gasto');
  await amount.fill('123,45');
  await amount.focus();
  await page.evaluate(() => {
    window.flashed = false;
    new MutationObserver(() => {
      if (document.body.textContent.includes('Verificando tu sesión')) window.flashed = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  expect(ledger.auth.refreshes).toBe(0);
  await page.clock.fastForward('00:40');
  await expect.poll(() => ledger.auth.refreshes).toBe(1);
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => window.flashed)).toBe(false);
  await expect(amount).toHaveValue('123,45');
  await expect(amount).toBeFocused();
});

test('si el servidor rechaza el token renovado, el acceso se cierra y no quedan datos visibles', async ({ page, ledger }) => {
  const { categories } = await ledger.rpc('get_catalog');
  await ledger.rpc('create_expense', { id: crypto.randomUUID(), amount: '42.00', currency: 'UYU', spent_on: '2026-11-03',
    category_id: categories[0].id, description: 'Visible antes de la renovación' });
  await page.goto('/historial');
  await expect(page.getByText('Visible antes de la renovación')).toBeVisible();
  // La plaza se retira: el token nuevo ya no supera private.allowed().
  await page.route('**/rest/v1/rpc/*', (route) => route.request().method() === 'OPTIONS' ? route.fallback()
    : route.fulfill({ status: 403, json: { code: 'PT403', message: 'ACCESS_DENIED' },
      headers: { 'access-control-allow-origin': '*' } }));
  await page.clock.fastForward('00:40');
  await expect.poll(() => ledger.auth.refreshes).toBe(1);
  await expect(page.getByRole('heading', { name: 'Esta cuenta no tiene acceso' })).toBeVisible();
  await expect(page.getByText('Visible antes de la renovación')).toHaveCount(0);
});
