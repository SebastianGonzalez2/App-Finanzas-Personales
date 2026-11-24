import { mkdir } from 'node:fs/promises';
import { expect, test } from './database-fixture.js';

test.use({ locale: 'es-UY' });

const MINUS = '−';
const panel = (page, id) => page.locator(`section[data-panel="${id}"]`);
const currencyButton = (page, code) => page.getByRole('group', { name: 'Moneda de consulta' }).getByRole('button', { name: code, exact: true });
const periodSelect = (page) => page.locator('.stats-filters select').first();
const categorySelect = (page) => page.locator('.stats-filters select').nth(1);
const viewButton = (page, name) => page.getByRole('group', { name: 'Paneles' }).getByRole('button', { name });

async function catalog(ledger) {
  const { categories, subcategories } = await ledger.rpc('get_catalog');
  const byName = (list, name) => list.find((row) => row.name === name).id;
  return {
    food: byName(categories, 'Alimentación'), transport: byName(categories, 'Transporte'), home: byName(categories, 'Vivienda'),
    services: byName(categories, 'Servicios'), market: byName(subcategories, 'Supermercado'), rest: byName(subcategories, 'Restaurantes'),
    taxi: byName(subcategories, 'Taxi/Uber'), rent: byName(subcategories, 'Alquiler'),
  };
}

// Gastos sintéticos con resultados calculados a mano (ver comentarios en cada prueba).
async function seed(ledger) {
  const c = await catalog(ledger);
  const rows = [
    ['2026-11-02', 'UYU', '100.00', c.food, c.market], ['2026-11-10', 'UYU', '200.00', c.food, c.rest],
    ['2026-11-05', 'USD', '300.00', c.food, null], ['2026-11-20', 'UYU', '0.10', c.transport, c.taxi],
    ['2026-11-21', 'UYU', '0.20', c.transport, null], ['2026-11-01', 'EUR', '45.67', c.services, null],
    ['2026-10-31', 'UYU', '250.00', c.food, c.market], ['2026-10-01', 'UYU', '300.00', c.food, c.rest],
    ['2026-10-15', 'UYU', '99.99', c.home, c.rent],
    ['2025-01-01', 'UYU', '540.00', c.food, c.rest], ['2024-02-29', 'UYU', '600.00', c.food, null],
    ['2024-07-01', 'UYU', '400.00', c.transport, null], ['2023-03-01', 'UYU', '200.00', c.food, c.market],
    ['2023-12-31', 'UYU', '300.00', c.food, null], ['2021-06-01', 'UYU', '70.00', c.food, null],
    ['2017-01-01', 'UYU', '33.33', c.food, null], ['2016-12-31', 'UYU', '11.11', c.food, null],
  ];
  const ids = [];
  for (const [spent_on, currency, amount, category_id, subcategory_id] of rows) {
    const id = crypto.randomUUID();
    ids.push(id);
    await ledger.rpc('create_expense', { id, amount, currency, spent_on, category_id, subcategory_id, description: `${currency} ${amount} ${spent_on}` });
  }
  return { c, ids };
}

// Suma exacta, en centésimos, de los importes de una moneda que muestra el Historial.
async function historySum(page, currency) {
  // The history keeps the previous query's rows (dimmed) while the new one loads.
  await expect(page.locator('section.history-panel-list')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.history-body.updating')).toHaveCount(0);
  const pager = page.getByRole('button', { name: 'Cargar más gastos' });
  while (await pager.isVisible()) await pager.click();
  const texts = await page.locator('.expense-table tbody td.money').allInnerTexts();
  let cents = 0n;
  for (const text of texts) {
    const clean = text.replace(/\s/g, '');
    expect(clean.startsWith(currency)).toBe(true);
    cents += BigInt(clean.slice(3).replace(/\./g, '').replace(',', ''));
  }
  const whole = String(cents / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return { count: texts.length, total: `${whole},${String(cents % 100n).padStart(2, '0')}` };
}

test('indicadores, categorías, desglose, comparación y resumen con valores exactos', async ({ page, ledger }) => {
  await seed(ledger);
  await page.goto('/estadisticas');
  await expect(page.getByRole('heading', { name: 'Estadísticas', level: 1 })).toBeVisible();
  await expect(page.locator('.page-description')).toHaveText('Del 1 de noviembre al 30 de noviembre de 2026');

  // Noviembre UYU: 100 + 200 + 0,10 + 0,20 = 300,30 en 4 gastos. Octubre: 250 + 300 + 99,99 = 649,99 en 3.
  const metrics = panel(page, 'metrics');
  await expect(metrics.locator('dd.figure').nth(0)).toHaveText('300,30 UYU');
  await expect(metrics.locator('dd.figure').nth(1)).toHaveText('4 gastos');
  await expect(metrics.locator('dd.figure').nth(2)).toHaveText('649,99 UYU');
  await expect(metrics.locator('dd.figure').nth(3)).toHaveText(`${MINUS}349,69 UYU`);
  await expect(metrics.locator('dd.figure').nth(4)).toHaveText('No comparable');
  await expect(metrics.locator('.metric-note').last()).toHaveText('Período en curso');
  await expect(metrics.locator('.period-line')).toContainText('Actual · 1 nov 2026 – 30 nov 2026 · parcial');
  await expect(metrics.locator('.period-line')).toContainText('Referencia · 1 oct 2026 – 31 oct 2026');

  // 300 / 300,30 = 99,90 %; 0,30 / 300,30 = 0,10 %.
  const categories = panel(page, 'categories');
  await expect(categories.locator('.cat-row')).toHaveCount(2);
  await expect(categories.locator('.cat-row').nth(0)).toContainText('Alimentación · 2');
  await expect(categories.locator('.cat-row').nth(0)).toContainText('300,00 · 99,90%');
  await expect(categories.locator('.cat-row').nth(1)).toContainText('0,30 · 0,10%');
  await categories.locator('.cat-row').nth(0).click();
  await expect(page).toHaveURL(/desglose=/);
  // Hijas 200 + 100 = 300: el padre no duplica importes.
  await expect(categories.locator('.breakdown-head')).toContainText('UYU 300,00 · 2 gastos');
  await expect(categories.locator('.cat-row')).toHaveCount(2);
  await expect(categories.locator('.cat-row').nth(0)).toContainText('Restaurantes');
  await expect(categories.locator('.cat-row').nth(0)).toContainText('200,00 · 66,67%');
  await expect(categories.locator('.cat-row').nth(1)).toContainText('100,00 · 33,33%');
  await categories.getByRole('button', { name: 'Todas las categorías' }).click();
  await expect(page).not.toHaveURL(/desglose=/);

  const comparison = panel(page, 'comparison');
  await expect(comparison.locator('tbody tr')).toHaveCount(3);
  await expect(comparison.locator('tbody tr').nth(0)).toHaveText(['Alimentación', '300,00', '550,00', `${MINUS}250,00`, 'No comparable'].join(''));
  await expect(comparison.locator('tbody tr').nth(1)).toContainText('Transporte0,30Sin registros');
  await expect(comparison.locator('tbody tr').nth(1)).toContainText('Sin base');
  await expect(comparison.locator('tbody tr').nth(2)).toContainText('ViviendaSin registros99,99');
  await expect(comparison.locator('tbody tr').nth(2).locator('td').last()).toHaveText('No disponible');

  const summary = panel(page, 'summary');
  await expect(summary.locator('.summary-headline')).toHaveText('Alimentación concentró el 99,90% del gasto registrado.');
  await expect(summary).toContainText('En el período registraste 4 gastos por UYU 300,30.');
  await expect(summary).toContainText('El total disminuyó UYU 349,69 frente al período de referencia (UYU 649,99). La variación porcentual no se calcula porque uno de los períodos sigue en curso.');
  await expect(summary).toContainText('No hay datos suficientes para describir una tendencia');
  await expect(page.locator('body')).not.toContainText('600,30');
});

test('moneda compartida: tres monedas separadas, persistencia y respuesta tardía descartada', async ({ page, ledger }) => {
  await seed(ledger);
  // RF-017: UYU 300,30/4, USD 300,00/1 y EUR 45,67/1, nunca un total combinado.
  const release = ledger.hold('get_stats', (args) => args.filters.currency === 'UYU');
  await page.goto('/estadisticas');
  await expect(currencyButton(page, 'UYU')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page, 'metrics').getByRole('status')).toHaveText('Cargando estadísticas…');
  await currencyButton(page, 'EUR').click();
  await expect(currencyButton(page, 'EUR')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page, 'metrics').locator('dd.figure').nth(0)).toHaveText('45,67 EUR');
  release();
  await page.waitForTimeout(300);
  // La respuesta UYU tardía no se muestra bajo la clave EUR.
  await expect(panel(page, 'metrics').locator('dd.figure').nth(0)).toHaveText('45,67 EUR');
  await expect(panel(page, 'metrics')).not.toContainText('UYU');
  await expect(panel(page, 'categories')).not.toContainText('UYU');

  await currencyButton(page, 'USD').click();
  await expect(panel(page, 'metrics').locator('dd.figure').nth(0)).toHaveText('300,00 USD');
  await expect(panel(page, 'metrics').locator('dd.figure').nth(1)).toHaveText('1 gasto');
  expect((await ledger.rpc('get_preferences')).currency).toBe('USD');
  for (const call of ledger.calls.filter((entry) => entry.name === 'get_stats').slice(-1)) expect(call.args.filters.currency).toBe('USD');

  // Se conserva al navegar y al volver a iniciar sesión.
  await page.getByRole('link', { name: 'Historial' }).first().click();
  await page.getByRole('link', { name: 'Estadísticas' }).first().click();
  await expect(currencyButton(page, 'USD')).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/cuenta');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  await page.goto('/estadisticas');
  await expect(currencyButton(page, 'USD')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page, 'metrics').locator('dd.figure').nth(0)).toHaveText('300,00 USD');
  // Cambiar la moneda de consulta no modifica la moneda original de ningún gasto.
  const listed = await ledger.rpc('list_expenses', { filters: {}, sort: 'spent_on', direction: 'desc', limit: 100 });
  expect(listed.items.filter((row) => row.currency === 'UYU')).toHaveLength(15);
});

test('evolución anual: ventana de cinco años, navegación, independencia del período y coincidencia con el Historial', async ({ page, ledger }) => {
  const { c } = await seed(ledger);
  await page.goto('/estadisticas');
  const annual = panel(page, 'annual');
  await expect(annual.locator('.year-nav')).toContainText('2022 – 2026');
  await expect(annual.locator('.tag')).toHaveText('2026 parcial');
  await annual.getByText('Ver datos').click();
  const table = annual.locator('.chart-table tbody tr');
  // Todas las categorías en UYU. 2024: 600 + 400 = 1.000,00; 2026: 850 + 0,30 + 99,99 = 950,29.
  await expect(table).toHaveText([
    /^2022\s*0\s*Sin registros/, /^2023\s*2\s*500,00/, /^2024\s*2\s*1\.000,00\+500,00 \(\+100%\)/,
    /^2025\s*1\s*540,00.*\(.*46%\)/, /^2026 · parcial\s*7\s*950,29Parcial$/,
  ]);
  await expect(annual.locator('.chart-foot')).toContainText('2022 · Sin registros');

  await categorySelect(page).selectOption(c.food);
  await expect(annual.locator('.annual-meta')).toContainText('Alimentación · UYU');
  await expect(table).toHaveText([/^2022\s*0\s*Sin registros/, /^2023\s*2\s*500,00/, /^2024\s*1\s*600,00\+100,00 \(\+20%\)/,
    new RegExp(`^2025\\s*1\\s*540,00${MINUS}60,00 \\(${MINUS}10%\\)`), /^2026 · parcial\s*4\s*850,00/]);

  await annual.getByRole('button', { name: /^Años anteriores/ }).click();
  await expect(annual.locator('.year-nav')).toContainText('2017 – 2021');
  await expect(page).toHaveURL(/anual=2021/);
  const older = [/^2017\s*1\s*33,33\+22,22 \(\+200%\)/, /^2018\s*0\s*Sin registros/, /^2019\s*0\s*Sin registros/, /^2020\s*0\s*Sin registros/,
    /^2021\s*1\s*70,00Sin base$/];
  await expect(table).toHaveText(older);
  await expect(annual.locator('.tag')).toHaveCount(0);

  // Cambiar el período general conserva el bloque y sus importes.
  const annualCalls = ledger.calls.filter((call) => call.name === 'get_annual').length;
  for (const value of ['6m', 'anio', 'mes-anterior', 'mes']) {
    await periodSelect(page).selectOption(value);
    await expect(annual.locator('.year-nav')).toContainText('2017 – 2021');
    await expect(table).toHaveText(older);
  }
  expect(ledger.calls.filter((call) => call.name === 'get_annual').length).toBe(annualCalls);

  // Cambiar la moneda recalcula el mismo bloque.
  await currencyButton(page, 'USD').click();
  await expect(annual.locator('.annual-meta')).toContainText('Alimentación · USD');
  await expect(annual.locator('.year-nav')).toContainText('2017 – 2021');
  await expect(annual.locator('.chart-overlay')).toHaveText('Sin registros en USD entre 2017 y 2021.');
  await currencyButton(page, 'UYU').click();
  await expect(table).toHaveText(older);

  await annual.getByRole('button', { name: /^Años más recientes/ }).click();
  await expect(annual.locator('.year-nav')).toContainText('2022 – 2026');
  await expect(page).not.toHaveURL(/anual=/);

  // Teclado: recorrer los años con flechas y abrir el detalle con Enter.
  // El foco activa el primer año; cada flecha avanza uno (Recharts procesa una tecla por cuadro).
  await annual.locator('.recharts-surface').focus();
  const tip = annual.locator('.chart-tip');
  await expect(tip).toContainText('2022');
  await page.keyboard.press('ArrowRight');
  await expect(tip).toContainText('2023');
  await page.keyboard.press('ArrowRight');
  await expect(tip).toContainText('2024');
  await expect(tip).toContainText('UYU 600,00 · 1 gasto');
  await page.keyboard.press('Enter');
  const detail = annual.locator('.chart-detail');
  await expect(detail).toContainText(/2024.*Alimentación · UYU.*UYU 600,00 · 1 gasto.*vs\. 2023: \+100,00 \(\+20%\)/);
  await detail.getByRole('link', { name: 'Ver gastos de 2024' }).click();
  await expect(page).toHaveURL(/\/historial\?/);
  expect(await historySum(page, 'UYU')).toEqual({ count: 1, total: '600,00' });
  await page.getByRole('link', { name: 'Volver a Estadísticas' }).click();
  await expect(page).toHaveURL(new RegExp(`/estadisticas\\?categoria=${c.food}`));
  await expect(panel(page, 'annual').locator('.annual-meta')).toContainText('Alimentación · UYU');

  // Eliminar el único gasto de 2024 deja «Sin registros» y sin variaciones ficticias.
  const [only] = (await ledger.rpc('list_expenses', { filters: { from: '2024-01-01', to: '2024-12-31', category_id: c.food },
    sort: 'spent_on', direction: 'desc', limit: 30 })).items;
  await ledger.rpc('delete_expense', { id: only.id, version: only.version });
  await page.reload();
  await panel(page, 'annual').getByText('Ver datos').click();
  await expect(panel(page, 'annual').locator('.chart-table tbody tr').nth(2)).toHaveText(/^2024\s*0\s*Sin registros—$/);
  await expect(panel(page, 'annual').locator('.chart-table tbody tr').nth(3)).toHaveText(/^2025\s*1\s*540,00Sin base$/);
});

test('cada agregado abre el Historial con los mismos gastos e importe', async ({ page, ledger }) => {
  const { c } = await seed(ledger);
  await page.goto('/estadisticas?periodo=12m');
  const back = page.url().replace(/^https?:\/\/[^/]+/, '');
  // Indicador de los últimos 12 meses (dic 2025 – nov 2026): noviembre 300,30 + octubre 649,99 = 950,29 en 7 gastos.
  await expect(panel(page, 'metrics').locator('dd.figure').nth(0)).toHaveText('950,29 UYU');
  await panel(page, 'metrics').locator('dd.figure a').first().click();
  expect(await historySum(page, 'UYU')).toEqual({ count: 7, total: '950,29' });
  await page.getByRole('link', { name: 'Volver a Estadísticas' }).click();
  await expect(page).toHaveURL((url) => url.pathname + url.search === back);

  // Barra de octubre (tabla equivalente) y subcategoría desde el desglose.
  const monthly = panel(page, 'monthly');
  await monthly.getByText('Ver datos').click();
  await monthly.getByRole('link', { name: 'Ver los gastos de octubre 2026' }).click();
  expect(await historySum(page, 'UYU')).toEqual({ count: 3, total: '649,99' });
  await page.getByRole('link', { name: 'Volver a Estadísticas' }).click();
  await panel(page, 'categories').locator('.cat-row', { hasText: 'Alimentación' }).click();
  await panel(page, 'categories').getByRole('link', { name: /^Supermercado: UYU 350,00/ }).click();
  expect(await historySum(page, 'UYU')).toEqual({ count: 2, total: '350,00' });
  await expect(page).toHaveURL(new RegExp(`subcategoria=${c.market}`));
  await page.getByRole('link', { name: 'Volver a Estadísticas' }).click();
  await expect(page).toHaveURL(/desglose=/);
  await panel(page, 'comparison').getByRole('link', { name: /^Vivienda, actual: UYU 99,99/ }).click();
  expect(await historySum(page, 'UYU')).toEqual({ count: 1, total: '99,99' });

  // Desde el Historial: editar noviembre 200 → 100 reduce el total en 100 al volver (RF-023).
  await page.goto('/estadisticas');
  await expect(panel(page, 'metrics').locator('dd.figure').nth(0)).toHaveText('300,30 UYU');
  await panel(page, 'metrics').locator('dd.figure a').first().click();
  await page.getByRole('link', { name: 'UYU 200.00 2026-11-10' }).click();
  await page.getByRole('link', { name: 'Editar gasto' }).click();
  await page.getByLabel('Importe del gasto').fill('100');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Cambios guardados' })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a Estadísticas' }).click();
  await expect(panel(page, 'metrics').locator('dd.figure').nth(0)).toHaveText('200,30 UYU');
});

test('favoritos privados: «Mis favoritos» conserva filtros y ventana anual', async ({ page, ledger }) => {
  await seed(ledger);
  await page.goto('/estadisticas?periodo=6m&anual=2021');
  await viewButton(page, /^Mis favoritos/).click();
  await expect(page.getByRole('heading', { name: 'Todavía no elegiste paneles' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver todas' }).click();
  const star = (title) => page.getByRole('button', { name: `Agregar «${title}» a Mis favoritos` });
  await star('Evolución anual por categoría').click();
  await star('Indicadores del período').click();
  await expect(page.getByRole('button', { name: 'Quitar «Indicadores del período» de Mis favoritos' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Quitar «Evolución anual por categoría» de Mis favoritos' })).toHaveAttribute('aria-pressed', 'true');
  expect((await ledger.rpc('get_preferences')).favorites).toEqual(['metrics', 'annual']);
  await viewButton(page, /^Mis favoritos/).click();
  await expect(page).toHaveURL(/vista=favoritos/);
  await expect(page).toHaveURL(/periodo=6m/);
  await expect(page.locator('section[data-panel]')).toHaveCount(2);
  await expect(page.locator('section[data-panel]').nth(0)).toHaveAttribute('data-panel', 'metrics');
  await expect(panel(page, 'annual').locator('.year-nav')).toContainText('2017 – 2021');
  await page.reload();
  await expect(page.locator('section[data-panel]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Quitar «Evolución anual por categoría» de Mis favoritos' }).click();
  await expect(page.locator('section[data-panel]')).toHaveCount(1);
  await viewButton(page, 'Todas').click();
  await expect(page.locator('section[data-panel]')).toHaveCount(6);
  await expect(page).toHaveURL(/anual=2021/);
});

for (const [width, height, name] of [[1440, 960, '1440'], [834, 1112, '834'], [375, 812, '375']]) {
  test(`diseño adaptable y capturas a ${name} px`, async ({ page, ledger }) => {
    await seed(ledger);
    await page.setViewportSize({ width, height });
    await page.goto('/estadisticas?periodo=12m&anual=2021');
    await expect(panel(page, 'summary').locator('.summary-headline')).toBeVisible();
    await panel(page, 'annual').getByRole('button', { name: /^Años más recientes/ }).click();
    await expect(panel(page, 'annual').locator('.year-nav')).toContainText('2022 – 2026');
    await expect(page.locator('.recharts-surface')).toHaveCount(2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await mkdir('docs/imp-04/capturas', { recursive: true });
    await page.screenshot({ path: `docs/imp-04/capturas/estadisticas-${name}.png`, fullPage: true });
    await panel(page, 'annual').locator('.year-dot').nth(1).click();
    await expect(panel(page, 'annual').locator('.chart-detail')).toContainText('2024');
    await panel(page, 'annual').screenshot({ path: `docs/imp-04/capturas/anual-detalle-${name}.png` });
    await panel(page, 'categories').locator('.cat-row', { hasText: 'Alimentación' }).click();
    await expect(panel(page, 'categories').locator('.breakdown-head')).toContainText('UYU 850,00 · 4 gastos');
    await panel(page, 'categories').screenshot({ path: `docs/imp-04/capturas/desglose-${name}.png` });
    await panel(page, 'categories').getByRole('link', { name: /^Supermercado: UYU 350,00/ }).click();
    await expect(page.getByRole('link', { name: 'Volver a Estadísticas' })).toBeVisible();
    await expect(page.locator('.expense-table tbody tr')).toHaveCount(2);
    await page.screenshot({ path: `docs/imp-04/capturas/historial-desde-estadisticas-${name}.png`, fullPage: true });
  });
}

test.describe('toque en móvil', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  test('tocar una barra y un punto muestra su detalle y abre el Historial', async ({ page, ledger }) => {
    await seed(ledger);
    await page.goto('/estadisticas?periodo=3m');
    const monthly = panel(page, 'monthly');
    await expect(monthly.locator('.chart-details')).toHaveAttribute('open', '');
    await monthly.locator('.segment-bar').first().tap();
    await expect(monthly.locator('.chart-detail')).toContainText('octubre de 2026');
    await expect(monthly.locator('.chart-detail')).toContainText('UYU 649,99');
    await panel(page, 'annual').locator('.year-dot').first().tap();
    await expect(panel(page, 'annual').locator('.chart-detail')).toContainText('2023');
    await panel(page, 'annual').locator('.chart-detail').getByRole('link').tap();
    expect(await historySum(page, 'UYU')).toEqual({ count: 2, total: '500,00' });
  });
});

test('mantener presionado y soltar sobre una barra o un punto los selecciona', async ({ page, ledger }) => {
  await seed(ledger);
  await page.goto('/estadisticas?periodo=3m');
  // La selección usa pointerup. En Chromium real, Recharts puede dibujar el punto resaltado
  // encima entre mousedown y mouseup y el navegador no emite click (verificado a mano con
  // registro de eventos). Playwright deja pasar un cuadro entre mover y presionar, así que
  // esta prueba no reproduce esa carrera: comprueba que presionar, esperar y soltar selecciona.
  const press = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();
  };
  const annual = panel(page, 'annual');
  await expect(annual.locator('.year-dot')).toHaveCount(4);
  await press(annual.locator('.year-dot').nth(1));
  await expect(annual.locator('.chart-detail')).toContainText('2024');
  await expect(annual.locator('.chart-detail')).toContainText('UYU 1.000,00 · 2 gastos');
  const monthly = panel(page, 'monthly');
  await press(monthly.locator('.segment-bar').nth(1));
  await expect(monthly.locator('.chart-detail')).toContainText('noviembre de 2026');
  await expect(monthly.locator('.chart-detail')).toContainText('UYU 300,30');
});

// Estrella de «Mis favoritos» (animación del botón «Favorite» de Amicro): estado sin animación al
// cargar, resorte al marcar y al desmarcar, y cambio instantáneo con prefers-reduced-motion.
for (const [name, device] of [
  ['escritorio', { viewport: { width: 1440, height: 960 } }],
  ['celular', { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true }],
]) {
  test.describe(`estrella de favoritos en ${name}`, () => {
    test.use(device);
    test('anima solo al marcar o desmarcar y respeta prefers-reduced-motion', async ({ page, ledger }) => {
      await ledger.rpc('set_favorite', { panel: 'metrics', enabled: true });
      await page.goto('/estadisticas');
      const press = (locator) => (device.hasTouch ? locator.tap() : locator.click());
      const star = (action, title) => page.getByRole('button', {
        name: action === 'Quitar' ? `Quitar «${title}» de Mis favoritos` : `Agregar «${title}» a Mis favoritos`,
      });
      const layers = (button) => button.evaluate((element) => [...element.querySelectorAll('.fav-star-layer')].map((layer) => {
        const style = getComputedStyle(layer);
        return {
          opacity: style.opacity, transform: style.transform, running: layer.getAnimations().length,
          timing: style.transitionTimingFunction, duration: style.transitionDuration,
          fill: getComputedStyle(layer.querySelector('path')).fill,
        };
      }));
      const off = { opacity: '1', transform: 'none', fill: 'none' };
      const hidden = { opacity: '0', transform: 'matrix(0.5, 0, 0, 0.5, 0, 0)' };
      const yellow = { opacity: '1', transform: 'none', fill: 'rgb(250, 204, 21)' };
      const runs = () => page.evaluate(() => window.favoriteRuns.splice(0).sort());
      await page.evaluate(() => {
        window.favoriteRuns = [];
        document.addEventListener('transitionrun', (event) => {
          if (event.target.classList?.contains('fav-star-layer')) window.favoriteRuns.push(`${event.target.classList[1]} ${event.propertyName}`);
        });
      });

      // Al cargar, cada estrella ya está en su estado y no hay animaciones.
      const metrics = star('Quitar', 'Indicadores del período');
      const annual = star('Agregar', 'Evolución anual por categoría');
      await expect(metrics).toHaveAttribute('aria-pressed', 'true');
      expect(await layers(metrics)).toMatchObject([{ ...hidden, running: 0 }, { ...yellow, running: 0 }]);
      expect(await layers(annual)).toMatchObject([{ ...off, running: 0 }, { ...hidden, running: 0 }]);
      expect(await page.locator('.fav .fav-star-layer').evaluateAll((all) => all.some((layer) => layer.getAnimations().length))).toBe(false);
      expect(await runs()).toEqual([]);
      await expect(page.locator('.fav').first()).not.toContainText(/\S/);

      // Marcar: la estrella neutra sale y la amarilla entra con el resorte (451 ms).
      await press(annual);
      const marked = star('Quitar', 'Evolución anual por categoría');
      await expect(marked).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(runs).toEqual(['fav-star-off opacity', 'fav-star-off transform', 'fav-star-on opacity', 'fav-star-on transform']);
      const [timing] = await layers(marked);
      expect(timing.timing).toMatch(/^linear\(0( 0%)?, 0\.0286[ ,].*1\.1119[ ,]/);
      expect(timing.duration).toMatch(/^0\.451s(, 0\.451s)?$/);
      await expect.poll(() => layers(marked)).toMatchObject([{ ...hidden, running: 0 }, { ...yellow, running: 0 }]);
      expect((await ledger.rpc('get_preferences')).favorites).toEqual(['metrics', 'annual']);

      // Desmarcar: la transición inversa recupera la estrella neutra.
      await press(metrics);
      const unmarked = star('Agregar', 'Indicadores del período');
      await expect(unmarked).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(runs).toEqual(['fav-star-off opacity', 'fav-star-off transform', 'fav-star-on opacity', 'fav-star-on transform']);
      await expect.poll(() => layers(unmarked)).toMatchObject([{ ...off, running: 0 }, { ...hidden, running: 0 }]);
      expect((await ledger.rpc('get_preferences')).favorites).toEqual(['annual']);

      // Con prefers-reduced-motion el cambio de estado es inmediato.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await press(marked);
      const reduced = star('Agregar', 'Evolución anual por categoría');
      await expect(reduced).toHaveAttribute('aria-pressed', 'false');
      expect(await layers(reduced)).toMatchObject([{ ...off, running: 0 }, { ...hidden, running: 0 }]);
      expect(await runs()).toEqual([]);
      expect((await ledger.rpc('get_preferences')).favorites).toEqual([]);
    });
  });
}
