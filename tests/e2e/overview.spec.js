import { mkdir } from 'node:fs/promises';
import { expect, test } from './database-fixture.js';
import { chooseOption } from './controls.js';

test.use({ locale: 'es-UY' });

const MINUS = '−';
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const currencyButton = (page, code) => page.getByRole('group', { name: 'Moneda de consulta' }).getByRole('button', { name: code, exact: true });
const panel = (page, id) => page.locator(`section[aria-labelledby="${id}"]`);
const metrics = (page) => page.locator('section[data-panel="metrics"]');

async function catalog(ledger) {
  const { categories, subcategories } = await ledger.rpc('get_catalog');
  const byName = (list, name) => list.find((entry) => entry.name === name).id;
  return {
    food: byName(categories, 'Alimentación'), transport: byName(categories, 'Transporte'), home: byName(categories, 'Vivienda'),
    services: byName(categories, 'Servicios'), market: byName(subcategories, 'Supermercado'), rest: byName(subcategories, 'Restaurantes'),
    taxi: byName(subcategories, 'Taxi/Uber'),
  };
}

// Hoy: 23/11/2026. Noviembre UYU: Vivienda 9.600; Alimentación 2.000 + 3.000 = 5.000; Transporte 3.600 + 240 = 3.840;
// Servicios 2.400 → 20.840,00 en 6 gastos. Participaciones sobre el total real del mes: 9.600 / 20.840 = 46,07 %;
// 5.000 / 20.840 = 23,99 %; 3.840 / 20.840 = 18,43 % (suman 88,49 %; Servicios aporta el 11,52 % restante).
// Octubre completo: 32.000 → diferencia −11.160,00. Agosto: 1.234,56. Junio, julio y septiembre sin registros.
// USD: noviembre 50 (Alimentación) y 12 (Entretenimiento sin hija). EUR: nada.
async function seed(ledger) {
  const c = await catalog(ledger);
  const { categories } = await ledger.rpc('get_catalog');
  const fun = categories.find((entry) => entry.name === 'Entretenimiento').id;
  const rows = [
    ['2026-11-03', 'UYU', '2000.00', c.food, c.market, 'Compra semanal'],
    ['2026-11-08', 'UYU', '3000.00', c.food, c.rest, 'Cena del sábado'],
    ['2026-11-09', 'USD', '50.00', c.food, null, 'Libros importados'],
    ['2026-11-21', 'USD', '12.00', fun, null, 'Suscripción de cine'],
    ['2026-11-20', 'UYU', '3600.00', c.transport, c.taxi, 'Viaje al centro'],
    ['2026-11-21', 'UYU', '240.00', c.transport, null, 'Recarga de boleto'],
    ['2026-11-01', 'UYU', '9600.00', c.home, null, 'Alquiler de noviembre'],
    ['2026-11-19', 'UYU', '2400.00', c.services, null, 'Electricidad'],
    ['2026-10-15', 'UYU', '32000.00', c.home, null, 'Octubre completo'],
    ['2026-08-10', 'UYU', '1234.56', c.food, null, 'Agosto'],
    ['2026-05-31', 'UYU', '999.99', c.food, null, 'Mayo, fuera de los seis meses'],
    ['2026-12-01', 'UYU', '777.00', c.food, null, 'Diciembre, futuro'],
  ];
  for (const [spent_on, currency, amount, category_id, subcategory_id, description] of rows) {
    await ledger.rpc('create_expense', { id: crypto.randomUUID(), amount, currency, spent_on, category_id, subcategory_id, description });
  }
  for (const [category_id, monthly_limit] of [[c.transport, '3600'], [c.home, '10000'], [c.food, '15000']]) {
    await ledger.rpc('create_budget', { category_id, currency: 'UYU', monthly_limit });
  }
  return c;
}

test('RF-027 · total, categorías, seis meses, presupuestos y gastos recientes con valores exactos', async ({ page, ledger }) => {
  await seed(ledger);
  ledger.calls.length = 0;
  await page.goto('/');
  await expect(page.locator('.page-description')).toHaveText('Noviembre de 2026');
  await expect(currencyButton(page, 'UYU')).toHaveAttribute('aria-pressed', 'true');

  const hero = panel(page, 'overview-month');
  await expect(hero.locator('.hero-value')).toHaveText('20.840,00 UYU');
  await expect(hero.locator('.hero-note').first()).toHaveText('6 gastos registrados');
  await expect(hero.locator('.tag')).toHaveText('Mes parcial');
  await expect(hero.locator('.hero-base')).toHaveText(`${MINUS}11.160,00 UYU frente a octubre completo`);

  // Gráfico circular segmentado de Principales categorías con participación sobre el total real del mes.
  const categories = panel(page, 'overview-categories');
  await expect(categories.locator('.cat-donut-tick')).toHaveCount(72);
  await expect(categories.locator('.cat-donut-center-value')).toHaveText('20.840,00');
  await expect(categories.locator('.cat-donut-item-name')).toHaveText(['Vivienda · 1', 'Alimentación · 2', 'Transporte · 2', 'Servicios · 1']);
  await expect(categories.locator('.cat-donut-item-amount')).toHaveText([
    '9.600,00 · 46,07%', '5.000,00 · 23,99%', '3.840,00 · 18,43%', '2.400,00 · 11,52%']);
  // Hover/click sincroniza el centro del gráfico y la lista asociada.
  await categories.locator('.cat-donut-item').nth(1).click();
  await expect(categories.locator('.cat-donut-item').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(categories.locator('.cat-donut-center-name')).toHaveText('Alimentación');
  await expect(categories.locator('.cat-donut-center-value')).toHaveText('5.000,00');
  await expect(categories.locator('.cat-donut-center-meta')).toHaveText('UYU · 23,99%');
  await expect(categories.locator('.cat-donut-center-sub')).toHaveText('2 gastos');
  await categories.getByRole('button', { name: 'Ver total' }).click();
  await expect(categories.locator('.cat-donut-center-value')).toHaveText('20.840,00');

  // Seis meses: junio a noviembre, con los meses vacíos en su lugar.
  const months = panel(page, 'overview-months');
  await expect(months.locator('.month-label')).toHaveText(['Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov']);
  await expect(months.locator('.month-value')).toHaveText(['—', '—', '1,2k', '—', '32k', '20,8k']);
  await months.getByText('Ver datos').click();
  await expect(months.locator('.chart-table tbody tr')).toHaveText([
    'junio 20260Sin registros', 'julio 20260Sin registros', 'agosto 202611.234,56', 'septiembre 20260Sin registros',
    'octubre 2026132.000,00', 'noviembre 2026 · parcial620.840,00']);
  await expect(months.getByRole('img')).toHaveAccessibleName(/noviembre 2026 · parcial: UYU 20\.840,00\.$/);

  // Presupuestos de la moneda: destaca el mayor porcentaje (Transporte 106,67 %).
  const budgets = panel(page, 'overview-budgets');
  await expect(budgets.locator('.tag')).toHaveText('Superado');
  await expect(budgets.locator('h3')).toHaveText('Transporte');
  await expect(budgets.locator('.figure')).toHaveText('240,00 UYU');
  await expect(budgets.locator('.hero-note')).toHaveText('por encima del límite mensual');
  await expect(budgets.getByRole('img')).toHaveAccessibleName('106,67% utilizado');
  await expect(budgets.locator('.bottom-rule')).toHaveText('3 límites activos · 1 superado');

  // Gastos recientes: cinco del mes y la moneda, del más reciente al más antiguo; nunca USD ni otros meses.
  const recent = panel(page, 'overview-recent');
  await expect(recent.locator('tbody tr .row-link')).toHaveText(['Recarga de boleto', 'Viaje al centro', 'Electricidad', 'Cena del sábado', 'Compra semanal']);
  await expect(recent.locator('tbody td.money')).toHaveText(['UYU240,00', 'UYU3.600,00', 'UYU2.400,00', 'UYU3.000,00', 'UYU2.000,00']);

  // Cuatro lecturas en paralelo: dos get_stats (mes y seis meses), get_budgets y una página corta de list_expenses.
  const names = ledger.calls.map((call) => call.name).sort();
  expect(names).toEqual(['get_budgets', 'get_stats', 'get_stats', 'list_expenses']);
  const list = ledger.calls.find((call) => call.name === 'list_expenses').args;
  expect(list).toEqual({ filters: { from: '2026-11-01', to: '2026-11-30', currency: 'UYU' }, q: null, sort: 'spent_on',
    direction: 'desc', limit: 5, cursor: null });

  // Sin bloque inferior de accesos rápidos.
  await expect(page.getByRole('navigation', { name: 'Accesos rápidos' })).toHaveCount(0);
});

test('RF-027 · el Resumen coincide con Estadísticas, Presupuestos e Historial', async ({ page, ledger }) => {
  const c = await seed(ledger);
  await page.goto('/');
  const hero = panel(page, 'overview-month');
  await expect(hero.locator('.hero-value')).toHaveText('20.840,00 UYU');
  // Mismo mes y moneda en Estadísticas: mismo total; se reutiliza la respuesta en caché (misma clave).
  const statsCalls = ledger.calls.filter((call) => call.name === 'get_stats').length;
  await page.getByRole('link', { name: 'Ver todas' }).click();
  await expect(page).toHaveURL(/\/estadisticas$/);
  await expect(metrics(page).locator('dd.figure').nth(0)).toHaveText('20.840,00 UYU');
  await expect(metrics(page).locator('dd.figure').nth(1)).toHaveText('6 gastos');
  expect(ledger.calls.filter((call) => call.name === 'get_stats').length).toBe(statsCalls);
  // Estadísticas: Alimentación 5.000 ⇔ Presupuesto Alimentación 5.000 consumidos ⇔ incluido en el total del Resumen.
  await expect(page.locator('section[data-panel="categories"] .cat-donut-item', { hasText: 'Alimentación' }).locator('.money')).toHaveText('5.000,00');
  await page.getByRole('link', { name: 'Presupuestos' }).first().click();
  await expect(page.locator('.budget-table tbody tr', { hasText: 'Alimentación' }).locator('td').nth(0)).toHaveText('5.000,00');
  // «Últimos 6 meses» en Estadísticas comparte la consulta de la evolución mensual.
  await page.getByRole('link', { name: 'Resumen' }).first().click();
  await panel(page, 'overview-months').getByRole('link', { name: 'Estadísticas' }).click();
  await expect(page).toHaveURL(/\/estadisticas\?periodo=6m$/);
  await expect(metrics(page).locator('dd.figure').nth(0)).toHaveText('54.074,56 UYU');

  // El total abre el Historial del mes y la moneda, con la misma suma.
  await page.getByRole('link', { name: 'Resumen' }).first().click();
  await hero.getByRole('link', { name: /^Gasto del mes: UYU 20\.840,00/ }).click();
  await expect(page).toHaveURL(/\/historial\?desde=2026-11-01&hasta=2026-11-30&moneda=UYU$/);
  await expect(page.locator('.expense-table tbody tr')).toHaveCount(6);
  // Una categoría seleccionada en el donut abre su Historial; «Ver historial» abre el mes y la moneda de los recientes.
  await page.goBack();
  const overviewCats = panel(page, 'overview-categories');
  await overviewCats.getByRole('button', { name: /^Alimentación: UYU 5\.000,00/ }).click();
  await overviewCats.getByRole('link', { name: 'Ver gastos de Alimentación' }).click();
  await expect(page).toHaveURL(new RegExp(`categoria=${c.food}`));
  await expect(page.locator('.expense-table tbody tr')).toHaveCount(2);
  await page.goBack();
  await panel(page, 'overview-recent').getByRole('link', { name: 'Ver historial' }).click();
  await expect(page).toHaveURL(/\/historial\?desde=2026-11-01&hasta=2026-11-30&moneda=UYU$/);
  await page.goBack();
  await panel(page, 'overview-recent').getByRole('link', { name: 'Electricidad' }).click();
  const detail = page.getByRole('region', { name: 'Detalle del gasto' });
  await expect(detail.locator('.history-amount')).toHaveText('2.400,00 UYU');
  await expect(detail).toContainText('Electricidad');

  // Editar un gasto se refleja en Resumen y presupuesto: Cena 3.000 → 2.000 baja todo en 1.000.
  await page.goto('/historial?q=Cena');
  await page.getByRole('button', { name: /^Acciones para Cena del sábado/ }).click();
  await page.getByRole('link', { name: 'Editar' }).click();
  await page.getByLabel('Importe del gasto').fill('2000');
  await button(page, 'Guardar cambios').click();
  await page.getByRole('link', { name: 'Resumen' }).first().click();
  await expect(hero.locator('.hero-value')).toHaveText('19.840,00 UYU');
  await expect(panel(page, 'overview-categories').locator('.cat-donut-item-amount').nth(1)).toHaveText('4.000,00 · 20,16%');
  await page.getByRole('link', { name: 'Presupuestos' }).first().click();
  await expect(page.locator('.budget-table tbody tr', { hasText: 'Alimentación' }).locator('td').nth(0)).toHaveText('4.000,00');
});

test('RF-021 · cambio de moneda sin datos obsoletos ni respuesta tardía', async ({ page, ledger }) => {
  await seed(ledger);
  // Las dos lecturas get_stats en UYU (mes y seis meses) y la lista quedan retenidas.
  const releaseMonth = ledger.hold('get_stats', (args) => args.filters.currency === 'UYU');
  const releaseSix = ledger.hold('get_stats', (args) => args.filters.currency === 'UYU');
  const releaseList = ledger.hold('list_expenses', (args) => args.filters.currency === 'UYU');
  await page.goto('/');
  await expect(panel(page, 'overview-month').getByRole('status')).toHaveText('Cargando el gasto del mes…');
  await currencyButton(page, 'USD').click();
  await expect(panel(page, 'overview-month').locator('.hero-value')).toHaveText('62,00 USD');
  await expect(panel(page, 'overview-month').locator('.hero-base')).toHaveText('Sin base de comparación: octubre no tiene gastos en USD.');
  await expect(panel(page, 'overview-recent').locator('tbody td.money')).toHaveText(['USD12,00', 'USD50,00']);
  await expect(panel(page, 'overview-budgets')).toContainText('Todavía no tenés límites mensuales en USD.');
  releaseMonth();
  releaseSix();
  releaseList();
  await page.waitForTimeout(300);
  await expect(page.locator('.overview')).not.toContainText('UYU');
  await expect(panel(page, 'overview-month').locator('.hero-value')).toHaveText('62,00 USD');
  // EUR: nada registrado; cada bloque muestra su estado vacío.
  await currencyButton(page, 'EUR').click();
  await expect(panel(page, 'overview-month').locator('.hero-value')).toHaveText('Sin registros EUR');
  await expect(panel(page, 'overview-categories')).toContainText('Sin gastos en EUR este mes.');
  await expect(panel(page, 'overview-recent')).toContainText('Sin gastos en EUR este mes');
  await expect(panel(page, 'overview-months').locator('.month-value')).toHaveText(['—', '—', '—', '—', '—', '—']);
  // Persistencia tras volver a iniciar sesión.
  await page.goto('/cuenta');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(currencyButton(page, 'EUR')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page, 'overview-month').locator('.hero-value')).toHaveText('Sin registros EUR');
});

test('cuenta sin gastos: registrar el primer gasto desde el Resumen y crear un presupuesto', async ({ page, ledger }) => {
  await page.goto('/');
  const hero = panel(page, 'overview-month');
  await expect(hero.locator('.hero-value')).toHaveText('Sin registros UYU');
  await expect(hero.locator('.hero-base')).toHaveText('Sin base de comparación: octubre no tiene gastos en UYU.');
  await expect(panel(page, 'overview-budgets').getByRole('link', { name: 'Crear presupuesto' })).toBeVisible();
  await expect(panel(page, 'overview-recent')).toContainText('Sin gastos en UYU este mes');
  await hero.getByRole('link', { name: 'Registrar un gasto' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo gasto', level: 1 })).toBeVisible();
  await page.getByLabel('Importe del gasto').fill('1280');
  await chooseOption(page.getByLabel('Categoría', { exact: true }), { label: 'Alimentación' });
  await page.getByLabel('Descripción · opcional').fill('Primer gasto');
  await button(page, 'Guardar gasto').click();
  await expect(page).toHaveURL((url) => url.pathname === '/');
  await expect(hero.locator('.hero-value')).toHaveText('1.280,00 UYU');
  await expect(hero.locator('.hero-note').first()).toHaveText('1 gasto registrado');
  await expect(panel(page, 'overview-recent').locator('.row-link')).toHaveText(['Primer gasto']);
  await expect(panel(page, 'overview-categories').locator('.cat-donut-item-amount')).toHaveText(['1.280,00 · 100%']);
  // Crear presupuesto desde el Resumen abre el formulario en Presupuestos.
  await panel(page, 'overview-budgets').getByRole('link', { name: 'Crear presupuesto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear límite' });
  await chooseOption(dialog.getByLabel('Categoría'), { label: 'Alimentación' });
  await dialog.getByLabel('Límite mensual').fill('1280');
  await button(dialog, 'Crear límite').click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('link', { name: 'Resumen' }).first().click();
  await expect(panel(page, 'overview-budgets').locator('.tag')).toHaveText('Límite alcanzado');
  await expect(panel(page, 'overview-budgets').locator('.figure')).toHaveText('0,00 UYU');
  expect(ledger.calls.find((call) => call.name === 'create_budget').args.monthly_limit).toBe('1280.00');
});

test('error en un bloque: los demás se muestran y el bloque permite reintentar', async ({ page, ledger }) => {
  await seed(ledger);
  ledger.faults.before = 'get_budgets';
  await page.goto('/');
  await expect(panel(page, 'overview-month').locator('.hero-value')).toHaveText('20.840,00 UYU');
  const budgets = panel(page, 'overview-budgets');
  await expect(budgets.getByRole('alert')).toContainText('No pudimos cargar este panel.');
  await button(budgets, 'Reintentar').click();
  await expect(budgets.locator('h3')).toHaveText('Transporte');
});

for (const [width, height, name] of [[1440, 960, '1440'], [834, 1112, '834'], [375, 812, '375']]) {
  test(`Resumen adaptable y capturas a ${name} px`, async ({ page, ledger }) => {
    await seed(ledger);
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(panel(page, 'overview-recent').locator('tbody tr')).toHaveCount(5);
    await expect(panel(page, 'overview-budgets').locator('.gauge')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Con el menú cerrado, «Registrar gasto» está a un toque.
    await expect(page.getByRole('link', { name: 'Registrar gasto', exact: true }).filter({ visible: true })).toHaveCount(1);
    await mkdir('docs/imp-05/capturas', { recursive: true });
    await page.screenshot({ path: `docs/imp-05/capturas/resumen-${name}.png`, fullPage: true });
  });
}

test.describe('toque en móvil', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  test('tocar accesos, categorías y el selector de moneda', async ({ page, ledger }) => {
    await seed(ledger);
    await page.goto('/');
    await currencyButton(page, 'USD').tap();
    await expect(panel(page, 'overview-month').locator('.hero-value')).toHaveText('62,00 USD');
    const mobileCats = panel(page, 'overview-categories');
    await mobileCats.getByRole('button', { name: /^Alimentación: USD 50,00/ }).tap();
    await expect(mobileCats.locator('.cat-donut-center-name')).toHaveText('Alimentación');
    await mobileCats.getByRole('link', { name: 'Ver gastos de Alimentación' }).tap();
    await expect(page).toHaveURL(/moneda=USD/);
    await expect(page.locator('.expense-table tbody tr')).toHaveCount(1);
    await page.goBack();
    await page.getByRole('link', { name: 'Registrar gasto', exact: true }).tap();
    await expect(page.getByRole('heading', { name: 'Nuevo gasto', level: 1 })).toBeVisible();
  });
});
