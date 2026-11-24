import { mkdir } from 'node:fs/promises';
import { expect, test } from './database-fixture.js';

test.use({ locale: 'es-UY' });

const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const currencyButton = (page, code) => page.getByRole('group', { name: 'Moneda de consulta' }).getByRole('button', { name: code, exact: true });
const row = (page, name) => page.locator('.budget-table tbody tr', { hasText: name });
const card = (page, name) => page.locator('.budget-card', { hasText: name });
const panel = (page, id) => page.locator(`section[aria-labelledby="${id}"]`);

async function catalog(ledger) {
  const { categories, subcategories } = await ledger.rpc('get_catalog');
  const byName = (list, name) => list.find((entry) => entry.name === name).id;
  return {
    food: byName(categories, 'Alimentación'), transport: byName(categories, 'Transporte'), home: byName(categories, 'Vivienda'),
    services: byName(categories, 'Servicios'), health: byName(categories, 'Salud'),
    market: byName(subcategories, 'Supermercado'), rest: byName(subcategories, 'Restaurantes'), taxi: byName(subcategories, 'Taxi/Uber'),
  };
}

// Gastos sintéticos con resultados calculados a mano. Hoy: 23/11/2026.
// Noviembre UYU: Alimentación 2.000 + 3.000 = 5.000; Transporte 3.600 + 240 = 3.840; Vivienda 9.600;
// Servicios 2.400. Total 20.840,00 en 6 gastos. USD: Alimentación 50. Octubre UYU: 32.000. Agosto: 1.234,56.
async function seed(ledger) {
  const c = await catalog(ledger);
  const rows = [
    ['2026-11-03', 'UYU', '2000.00', c.food, c.market, 'Compra semanal'],
    ['2026-11-08', 'UYU', '3000.00', c.food, c.rest, 'Cena del sábado'],
    ['2026-11-09', 'USD', '50.00', c.food, null, 'Suscripción'],
    ['2026-11-20', 'UYU', '3600.00', c.transport, c.taxi, 'Viaje al centro'],
    ['2026-11-21', 'UYU', '240.00', c.transport, null, 'Recarga de boleto'],
    ['2026-11-01', 'UYU', '9600.00', c.home, null, 'Alquiler de noviembre'],
    ['2026-11-19', 'UYU', '2400.00', c.services, null, 'Electricidad'],
    ['2026-10-15', 'UYU', '32000.00', c.home, null, 'Octubre'],
    ['2026-08-10', 'UYU', '1234.56', c.food, null, 'Agosto'],
  ];
  const ids = {};
  for (const [spent_on, currency, amount, category_id, subcategory_id, description] of rows) {
    const id = crypto.randomUUID();
    ids[description] = id;
    await ledger.rpc('create_expense', { id, amount, currency, spent_on, category_id, subcategory_id, description });
  }
  return { c, ids };
}

// update_expense con los campos exactos del contrato a partir de un Expense.
function move(ledger, expense, patch) {
  const { id, version, amount, currency, spent_on, category_id, subcategory_id, description } = { ...expense, ...patch };
  return ledger.rpc('update_expense', { id, version, amount, currency, spent_on, category_id, subcategory_id, description });
}

async function budgetLimits(ledger, c) {
  for (const [category_id, monthly_limit] of [[c.transport, '3600'], [c.services, '2400'], [c.home, '10000'], [c.health, '500']]) {
    await ledger.rpc('create_budget', { category_id, currency: 'UYU', monthly_limit });
  }
}

test('RF-024/025 · crear un límite con gastos previos, validar, detectar duplicados, editar y retirar', async ({ page, ledger }) => {
  const { c } = await seed(ledger);
  await page.goto('/presupuestos');
  await expect(page.getByRole('heading', { name: 'Presupuestos', level: 1 })).toBeVisible();
  await expect(page.locator('.page-description')).toHaveText('Límites mensuales por categoría · Noviembre de 2026');
  await expect(page.getByRole('heading', { name: 'Todavía no tenés límites en UYU' })).toBeVisible();

  // Crear: se propone la moneda activa; un límite inválido no se envía.
  await button(page, 'Crear límite').first().click();
  const dialog = page.getByRole('dialog', { name: 'Crear límite' });
  await expect(dialog.getByRole('button', { name: 'UYU', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByLabel('Categoría').selectOption({ label: 'Alimentación' });
  for (const invalid of ['0', '-5', 'abc', '1,234', '0,00']) {
    await dialog.getByLabel('Límite mensual').fill(invalid);
    await button(dialog, 'Crear límite').click();
    await expect(dialog.getByText('Ingresá un límite mayor que cero, con hasta 12 enteros y 2 decimales.')).toBeVisible();
    await expect(dialog.getByLabel('Límite mensual')).toBeFocused();
  }
  expect(ledger.calls.filter((call) => call.name === 'create_budget')).toHaveLength(0);
  // Subcategorías no se ofrecen; solo categorías activas.
  await expect(dialog.getByLabel('Categoría').locator('option', { hasText: 'Supermercado' })).toHaveCount(0);
  await dialog.getByLabel('Límite mensual').fill('15000');
  await button(dialog, 'Crear límite').click();
  await expect(dialog).toHaveCount(0);
  expect(ledger.calls.find((call) => call.name === 'create_budget').args)
    .toEqual({ category_id: c.food, currency: 'UYU', monthly_limit: '15000.00' });
  await expect(page.getByRole('status').filter({ hasText: 'Límite creado' })).toHaveText('Límite creado: Alimentación · UYU 15.000,00.');

  // 2.000 + 3.000 UYU registrados antes del límite: 5.000 de 15.000, restan 10.000, 33,33 %. USD 50 no interviene.
  const food = row(page, 'Alimentación');
  await expect(food.locator('td').nth(0)).toHaveText('5.000,00');
  await expect(food.locator('td').nth(1)).toHaveText('15.000,00');
  await expect(food.locator('td').nth(2)).toHaveText('Restan10.000,00');
  await expect(food.locator('.budget-percent')).toHaveText('33,33%');
  await expect(food.locator('.budget-state')).toHaveText('Dentro del límite');
  await expect(page.locator('.highlight')).toContainText('Alimentación');

  // Duplicado: la combinación existente se identifica antes de enviar y se ofrece editarla.
  await button(page, 'Crear límite').first().click();
  const again = page.getByRole('dialog', { name: 'Crear límite' });
  await again.getByLabel('Categoría').selectOption({ label: 'Alimentación · ya tiene límite en UYU' });
  await expect(again.getByRole('alert')).toContainText('Alimentación ya tiene un límite de UYU 15.000,00');
  await expect(button(again, 'Crear límite')).toBeDisabled();
  // Otra moneda de la misma categoría sí está disponible.
  await button(again, 'USD').click();
  await expect(again.getByRole('alert')).toHaveCount(0);
  await button(again, 'UYU').click();
  await button(again, 'Editar ese límite').click();
  const edit = page.getByRole('dialog', { name: 'Editar límite' });
  await expect(edit.getByLabel('Límite mensual')).toHaveValue('15000,00');
  await expect(edit.getByLabel('Límite mensual')).toBeFocused();
  await expect(edit.locator('.budget-facts')).toContainText('Consumido este mesUYU 5.000,00');
  // RF-026: 15.000 → 18.000 recalcula sobre el mismo consumo: 27,78 %, restan 13.000.
  await edit.getByLabel('Límite mensual').fill('18000,00');
  await button(edit, 'Guardar límite').click();
  await expect(edit).toHaveCount(0);
  await expect(food.locator('.budget-percent')).toHaveText('27,78%');
  await expect(food.locator('td').nth(2)).toHaveText('Restan13.000,00');
  expect(ledger.calls.filter((call) => call.name === 'create_budget')).toHaveLength(1);

  // Una combinación creada en otra pestaña se detecta al elegir su moneda.
  await ledger.rpc('create_budget', { category_id: c.health, currency: 'USD', monthly_limit: '10' });
  await button(page, 'Crear límite').first().click();
  const usd = page.getByRole('dialog', { name: 'Crear límite' });
  await button(usd, 'USD').click();
  await expect(usd.getByLabel('Categoría').locator('option', { hasText: 'Salud · ya tiene límite en USD' })).toHaveCount(1);
  await button(usd, 'Cancelar').click();

  // Retirar: confirmación con categoría y moneda; los gastos se conservan.
  const before = await ledger.rpc('list_expenses', { filters: {}, sort: 'spent_on', direction: 'desc', limit: 100 });
  await page.getByRole('button', { name: 'Acciones para el límite de Alimentación' }).click();
  await button(page, 'Retirar límite').click();
  const retire = page.getByRole('dialog', { name: 'Retirar límite' });
  await expect(retire).toContainText('Alimentación · UYU');
  await expect(retire).toContainText('Límite mensual UYU 18.000,00 · consumido este mes UYU 5.000,00');
  await expect(retire).toContainText('Los gastos registrados y las estadísticas se conservan.');
  await expect(button(retire, 'Cancelar')).toBeFocused();
  await button(retire, 'Cancelar').click();
  await expect(row(page, 'Alimentación')).toHaveCount(1);
  await page.getByRole('button', { name: 'Acciones para el límite de Alimentación' }).click();
  await button(page, 'Retirar límite').click();
  await button(retire, 'Retirar límite').click();
  await expect(retire).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Límite retirado' })).toHaveText('Límite retirado: Alimentación · UYU. Los gastos se conservan.');
  await expect(page.getByRole('heading', { name: 'Todavía no tenés límites en UYU' })).toBeVisible();
  expect(await ledger.rpc('list_expenses', { filters: {}, sort: 'spent_on', direction: 'desc', limit: 100 })).toEqual(before);
});

test('RF-025 · estados, exceso saturado, orden por porcentaje y moneda compartida', async ({ page, ledger }) => {
  const { c } = await seed(ledger);
  await budgetLimits(ledger, c);
  await ledger.rpc('create_budget', { category_id: c.food, currency: 'UYU', monthly_limit: '15000' });
  await page.goto('/presupuestos');
  // Transporte 3.840/3.600 = 106,67 %; Servicios 2.400/2.400 = 100 %; Vivienda 9.600/10.000 = 96 %;
  // Alimentación 5.000/15.000 = 33,33 %; Salud 0/500 = 0 %.
  await expect(page.locator('.budget-table tbody th .cat-name')).toHaveText(['Transporte', 'Servicios', 'Vivienda', 'Alimentación', 'Salud']);
  await expect(page.locator('.budget-table .budget-state')).toHaveText(['Superado', 'Límite alcanzado', 'Cerca del límite', 'Dentro del límite', 'Dentro del límite']);
  await expect(page.locator('.budget-table .budget-percent')).toHaveText(['106,67%', '100%', '96%', '33,33%', '0%']);
  const transport = row(page, 'Transporte');
  await expect(transport.locator('td').nth(2)).toHaveText('Exceso240,00');
  // La barra se satura al 100 %, el texto conserva 106,67 %.
  const width = await transport.locator('.fill').evaluate((element) => element.style.width);
  expect(width).toBe('100%');
  await expect(row(page, 'Servicios').locator('td').nth(2)).toHaveText('Restan0,00');
  await expect(row(page, 'Salud').locator('td').nth(0)).toHaveText('0,00');
  await expect(row(page, 'Salud').locator('td').nth(2)).toHaveText('Restan500,00');
  const highlight = page.locator('.highlight');
  await expect(highlight.locator('.tag')).toHaveText('Superado');
  await expect(highlight.locator('.eyebrow')).toHaveText('Transporte');
  await expect(highlight.locator('.figure')).toHaveText('240,00 UYU');
  await expect(highlight.getByRole('img')).toHaveAccessibleName('106,67% utilizado');
  await expect(highlight.locator('.bottom-rule')).toHaveText('UYU 3.840,00 de 3.600,00');
  await expect(page.locator('.budget-meta')).toHaveText('5 límites activos · 1 superado · UYU');

  // Moneda compartida: USD muestra solo sus límites; una respuesta UYU tardía no aparece bajo USD.
  await ledger.rpc('create_budget', { category_id: c.food, currency: 'USD', monthly_limit: '40' });
  const release = ledger.hold('get_budgets', (args) => args.currency === 'UYU');
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Cargando presupuestos…' })).toBeAttached();
  await currencyButton(page, 'USD').click();
  await expect(row(page, 'Alimentación').locator('td').nth(0)).toHaveText('50,00');
  await expect(row(page, 'Alimentación').locator('td').nth(2)).toHaveText('Exceso10,00');
  await expect(row(page, 'Alimentación').locator('.budget-percent')).toHaveText('125%');
  release();
  await page.waitForTimeout(300);
  await expect(page.locator('.budget-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.budget-list')).not.toContainText('UYU');
  await page.getByRole('link', { name: 'Resumen' }).first().click();
  await expect(currencyButton(page, 'USD')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page, 'overview-budgets').locator('h3')).toHaveText('Alimentación');
  await page.getByRole('link', { name: 'Estadísticas' }).first().click();
  await expect(currencyButton(page, 'USD')).toHaveAttribute('aria-pressed', 'true');
  expect((await ledger.rpc('get_preferences')).currency).toBe('USD');
});

test('el consumo sigue a los gastos: alta, edición de importe, fecha, categoría y eliminación', async ({ page, ledger }) => {
  const { c, ids } = await seed(ledger);
  await ledger.rpc('create_budget', { category_id: c.food, currency: 'UYU', monthly_limit: '15000' });
  await page.goto('/presupuestos');
  const food = row(page, 'Alimentación');
  await expect(food.locator('td').nth(0)).toHaveText('5.000,00');

  // Alta desde «Nuevo gasto» en Presupuestos: al volver, 5.000 + 1.000,50 = 6.000,50 (40 %).
  await page.getByRole('link', { name: 'Nuevo gasto' }).first().click();
  await page.getByLabel('Importe del gasto').fill('1000,50');
  await page.getByLabel('Categoría', { exact: true }).selectOption({ label: 'Alimentación' });
  await page.getByLabel('Subcategoría · opcional').selectOption({ label: 'Delivery' });
  await button(page, 'Guardar gasto').click();
  await expect(page).toHaveURL(/\/presupuestos$/);
  await expect(food.locator('td').nth(0)).toHaveText('6.000,50');
  await expect(food.locator('.budget-percent')).toHaveText('40%');

  // Importe 3.000 → 1.000 desde la edición: 4.000,50.
  const dinner = await ledger.rpc('get_expense', { id: ids['Cena del sábado'] });
  await page.goto(`/gastos/${dinner.id}/editar`);
  await page.getByLabel('Importe del gasto').fill('1000');
  await button(page, 'Guardar cambios').click();
  await page.goto('/presupuestos');
  await expect(food.locator('td').nth(0)).toHaveText('4.000,50');
  // Fecha a octubre, categoría a Vivienda y moneda a USD (vía la API real): salen del contador.
  let market = await ledger.rpc('get_expense', { id: ids['Compra semanal'] });
  market = await move(ledger, market, { spent_on: '2026-10-31' });
  await page.reload();
  await expect(food.locator('td').nth(0)).toHaveText('2.000,50');
  market = await move(ledger, market, { spent_on: '2026-11-03', category_id: c.home, subcategory_id: null });
  await page.reload();
  await expect(food.locator('td').nth(0)).toHaveText('2.000,50');
  await move(ledger, market, { category_id: c.food, currency: 'USD' });
  await page.reload();
  await expect(food.locator('td').nth(0)).toHaveText('2.000,50');
  // Eliminar desde el Historial: 2.000,50 − 1.000 = 1.000,50.
  await page.goto('/historial?q=Cena');
  await page.getByRole('button', { name: /^Acciones para Cena del sábado/ }).click();
  await button(page, 'Eliminar').click();
  await button(page.getByRole('dialog'), 'Eliminar gasto').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Presupuestos' }).first().click();
  await expect(food.locator('td').nth(0)).toHaveText('1.000,50');
  await expect(food.locator('.budget-percent')).toHaveText('6,67%');
});

test('categoría archivada: el límite sigue visible, editable y retirable; no admite límites nuevos', async ({ page, ledger }) => {
  const { c } = await seed(ledger);
  await ledger.rpc('create_budget', { category_id: c.home, currency: 'UYU', monthly_limit: '10000' });
  await ledger.rpc('update_category', { kind: 'category', id: c.home, patch: { archived: true } });
  await page.goto('/presupuestos');
  const home = row(page, 'Vivienda');
  await expect(home.locator('.archived-mark')).toHaveText('Archivada');
  await expect(home.locator('td').nth(0)).toHaveText('9.600,00');
  await button(page, 'Crear límite').first().click();
  const create = page.getByRole('dialog', { name: 'Crear límite' });
  await expect(create.getByLabel('Categoría').locator('option', { hasText: 'Vivienda' })).toHaveCount(0);
  await button(create, 'Cancelar').click();
  // Teclado: abrir el menú, Escape lo cierra y devuelve el foco.
  const trigger = page.getByRole('button', { name: 'Acciones para el límite de Vivienda' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(button(page, 'Editar límite')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const edit = page.getByRole('dialog', { name: 'Editar límite' });
  await expect(edit.locator('.budget-facts')).toContainText('Archivada');
  await edit.getByLabel('Límite mensual').fill('12000');
  await page.keyboard.press('Enter');
  await expect(edit).toHaveCount(0);
  await expect(home.locator('.budget-percent')).toHaveText('80%');
  await page.getByRole('button', { name: 'Acciones para el límite de Vivienda' }).click();
  await button(page, 'Retirar límite').click();
  await button(page.getByRole('dialog'), 'Retirar límite').click();
  await expect(home).toHaveCount(0);
});

for (const [width, height, name] of [[1440, 960, '1440'], [834, 1112, '834'], [375, 812, '375']]) {
  test(`Presupuestos adaptable y capturas a ${name} px`, async ({ page, ledger }) => {
    const { c } = await seed(ledger);
    await budgetLimits(ledger, c);
    await ledger.rpc('create_budget', { category_id: c.food, currency: 'UYU', monthly_limit: '15000' });
    await page.setViewportSize({ width, height });
    await page.goto('/presupuestos');
    const list = width > 1180 ? page.locator('.budget-table') : page.locator('.budget-cards');
    await expect(list).toBeVisible();
    if (width <= 1180) {
      await expect(card(page, 'Transporte').locator('.facts')).toContainText(`Exceso240,00 UYU`);
      await expect(card(page, 'Vivienda').locator('.budget-state')).toHaveText('Cerca del límite');
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await mkdir('docs/imp-05/capturas', { recursive: true });
    await page.screenshot({ path: `docs/imp-05/capturas/presupuestos-${name}.png`, fullPage: true });
    await button(page, 'Crear límite').first().click();
    const dialog = page.getByRole('dialog', { name: 'Crear límite' });
    await dialog.getByLabel('Categoría').selectOption({ label: 'Transporte · ya tiene límite en UYU' });
    await expect(dialog.getByRole('alert')).toBeVisible();
    await page.screenshot({ path: `docs/imp-05/capturas/presupuesto-duplicado-${name}.png` });
    await button(dialog, 'Cancelar').click();
    await page.getByRole('button', { name: 'Acciones para el límite de Transporte' }).click();
    await button(page, 'Retirar límite').click();
    await expect(page.getByRole('dialog', { name: 'Retirar límite' })).toBeVisible();
    await page.screenshot({ path: `docs/imp-05/capturas/presupuesto-retirar-${name}.png` });
  });
}

test.describe('toque en móvil', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  test('tocar el menú de un límite, editarlo y crear uno desde el Resumen vacío', async ({ page, ledger }) => {
    const { c } = await seed(ledger);
    await page.goto('/');
    await panel(page, 'overview-budgets').getByRole('link', { name: 'Crear presupuesto' }).tap();
    const dialog = page.getByRole('dialog', { name: 'Crear límite' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Categoría').selectOption({ label: 'Transporte' });
    await dialog.getByLabel('Límite mensual').fill('3600');
    await button(dialog, 'Crear límite').tap();
    await expect(dialog).toHaveCount(0);
    const transport = card(page, 'Transporte');
    await expect(transport.locator('.budget-percent')).toHaveText('106,67%');
    await transport.getByRole('button', { name: 'Acciones para el límite de Transporte' }).tap();
    await button(page, 'Editar límite').tap();
    const edit = page.getByRole('dialog', { name: 'Editar límite' });
    await edit.getByLabel('Límite mensual').fill('4800');
    await button(edit, 'Guardar límite').tap();
    await expect(transport.locator('.budget-percent')).toHaveText('80%');
    await expect(transport.locator('.facts')).toContainText('Restante960,00 UYU');
    // Volver atrás no reabre el formulario.
    await page.goBack();
    await page.goForward();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(c.transport).toBeTruthy();
  });
});

