import { asUser, sessions, users } from '../../supabase/tests/database/fixture.js';
import { expect, test } from './database-fixture.js';
import { chooseOption, pickDate } from './controls.js';

test.use({ locale: 'es-UY' });

const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const rows = (page) => page.locator('.expense-table tbody tr');
const titles = (page) => page.locator('.expense-table tbody .row-link');
// Pages of the history (30 rows); the Resumen's short recent list (5 rows) is not part of it.
const listCalls = (ledger) => ledger.calls.filter((call) => call.name === 'list_expenses' && call.args.limit === 30);

async function catalog(ledger) {
  const { categories, subcategories } = await ledger.rpc('get_catalog');
  const byName = (list, name) => list.find((row) => row.name === name);
  return {
    food: byName(categories, 'Alimentación'), transport: byName(categories, 'Transporte'),
    services: byName(categories, 'Servicios'), market: byName(subcategories, 'Supermercado'),
    taxi: byName(subcategories, 'Taxi/Uber'),
  };
}

async function create(ledger, expense) {
  const args = { id: crypto.randomUUID(), subcategory_id: null, description: null, ...expense };
  await ledger.rpc('create_expense', args);
  return args;
}

// Years of history are inserted directly as fixture data, then the session role is restored.
async function seedMany(ledger, count, category_id) {
  await ledger.db.exec('reset role');
  await ledger.db.query(`
    with rows as (
      select gen_random_uuid() as id, n from generate_series(1, $2::int) n
    ), keys as (
      insert into app.expense_keys select $1, id, repeat('b', 64) from rows returning id
    )
    insert into app.expenses (owner_id, id, amount, currency, spent_on, category_id, description)
    select $1, r.id, ((r.n % 7) + 1) * 10, (array['UYU','USD','EUR'])[1 + r.n % 3], date '2025-01-01' + (r.n % 40), $3,
      'Lote ' || lpad(r.n::text, 3, '0')
    from rows r join keys k on k.id = r.id`, [users.a, count, category_id]);
  await asUser(ledger.db, users.a, sessions.a);
}

test('historial vacío ofrece el primer alta y el gasto nuevo aparece al volver', async ({ page, ledger }) => {
  // Entrar abre el Resumen (IMP-05), que solo lee: ninguna escritura antes de usar el Historial.
  const reads = ['get_stats', 'get_budgets', 'list_expenses'];
  expect(ledger.calls.filter((call) => !reads.includes(call.name))).toEqual([]);
  await page.goto('/historial');
  await expect(page.getByRole('heading', { name: 'Todavía no registraste gastos' })).toBeVisible();
  await expect(button(page, 'Limpiar')).toBeDisabled();
  await page.getByRole('link', { name: 'Registrar el primer gasto' }).click();
  await page.getByLabel('Importe del gasto').fill('1280,5');
  await pickDate(page.getByLabel('Fecha', { exact: true }), '2026-11-20');
  await chooseOption(page.getByLabel('Categoría', { exact: true }), { label: 'Alimentación' });
  await chooseOption(page.getByLabel('Subcategoría · opcional'), { label: 'Supermercado' });
  await button(page, 'Guardar gasto').click();
  await expect(page).toHaveURL(/\/historial$/);
  await expect(page.getByRole('status').filter({ hasText: 'Gasto guardado' })).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  // Without a description the subcategory titles the row.
  await expect(titles(page)).toHaveText(['Supermercado']);
  await expect(rows(page).first()).toContainText('UYU1.280,50');
  await expect(rows(page).first()).toContainText('20 nov 2026');
});

test('búsqueda literal, filtros combinados en la URL, categoría archivada y sin resultados', async ({ page, ledger }) => {
  const c = await catalog(ledger);
  await create(ledger, { amount: '1280.00', currency: 'UYU', spent_on: '2026-11-23', category_id: c.food.id, subcategory_id: c.market.id, description: 'Compra semanal' });
  await create(ledger, { amount: '12.00', currency: 'USD', spent_on: '2026-11-21', category_id: c.services.id, description: 'Suscripción 100% cine' });
  await create(ledger, { amount: '340.00', currency: 'UYU', spent_on: '2026-11-22', category_id: c.transport.id, subcategory_id: c.taxi.id, description: 'Viaje al centro' });
  await create(ledger, { amount: '9.50', currency: 'EUR', spent_on: '2026-10-02', category_id: c.transport.id, subcategory_id: c.taxi.id, description: 'Taxi en Madrid' });
  await create(ledger, { amount: '75.00', currency: 'UYU', spent_on: '2026-11-05', category_id: c.food.id, description: 'Café_con leche' });
  await ledger.rpc('update_category', { kind: 'category', id: c.transport.id, patch: { archived: true } });

  await page.goto('/historial');
  await expect(titles(page)).toHaveText(['Compra semanal', 'Viaje al centro', 'Suscripción 100% cine', 'Café_con leche', 'Taxi en Madrid']);
  await expect(page.getByText('USD12,00')).toBeVisible();
  await expect(page.getByText('EUR9,50')).toBeVisible();
  await expect(rows(page).nth(1)).toContainText('Archivada');

  await page.getByLabel('Buscar por descripción').fill('100%');
  await expect(titles(page)).toHaveText(['Suscripción 100% cine']);
  await expect(page).toHaveURL(/q=100%25/);
  await page.getByLabel('Buscar por descripción').fill('_');
  await expect(titles(page)).toHaveText(['Café_con leche']);
  await page.getByLabel('Buscar por descripción').fill('CAFÉ');
  await expect(titles(page)).toHaveText(['Café_con leche']);
  await page.getByLabel('Buscar por descripción').fill('');
  await expect(rows(page)).toHaveCount(5);

  await chooseOption(page.getByRole('button', { name: /^Período/ }), { label: 'Noviembre 2026' });
  await expect(page.getByRole('heading', { name: 'Gastos de noviembre' })).toBeVisible();
  await expect(rows(page)).toHaveCount(4);
  await page.getByRole('button', { name: /^Filtros/ }).click();
  const panel = page.getByRole('form', { name: 'Filtros del historial' });
  await chooseOption(panel.getByLabel('Categoría', { exact: true }), { label: 'Transporte · Archivada' });
  await chooseOption(panel.getByLabel('Subcategoría'), { label: 'Taxi/Uber · Archivada' });
  await chooseOption(panel.getByLabel('Moneda'), 'UYU');
  await button(panel, 'Aplicar').click();
  await expect(titles(page)).toHaveText(['Viaje al centro']);
  await expect(page.getByRole('button', { name: /Filtros/ })).toContainText('4');
  const url = new URL(page.url());
  expect(Object.fromEntries(url.searchParams)).toEqual({
    desde: '2026-11-01', hasta: '2026-11-30', moneda: 'UYU', categoria: c.transport.id, subcategoria: c.taxi.id,
  });
  expect(listCalls(ledger).at(-1).args).toMatchObject({
    filters: { from: '2026-11-01', to: '2026-11-30', currency: 'UYU', category_id: c.transport.id, subcategory_id: c.taxi.id },
    sort: 'spent_on', direction: 'desc', limit: 30, cursor: null,
  });

  // The filters survive a reload and a shared link.
  await page.reload();
  await expect(titles(page)).toHaveText(['Viaje al centro']);
  await page.getByLabel('Buscar por descripción').fill('inexistente');
  await expect(page.getByRole('heading', { name: 'Sin resultados' })).toBeVisible();
  await button(page, 'Limpiar filtros').click();
  await expect(rows(page)).toHaveCount(5);
  await expect(page).toHaveURL(/\/historial$/);
  await expect(page.getByLabel('Buscar por descripción')).toHaveValue('');

  await page.goto(`/historial?categoria=${c.food.id}&subcategoria=ninguna`);
  await expect(titles(page)).toHaveText(['Café_con leche']);
  await page.goto('/historial?categoria=' + crypto.randomUUID());
  await expect(page.getByRole('heading', { name: 'No pudimos aplicar esta consulta' })).toBeVisible();
  await button(page, 'Limpiar filtros').click();
  await expect(rows(page)).toHaveCount(5);
});

test('ordenar por fecha e importe con empates deterministas', async ({ page, ledger }) => {
  const c = await catalog(ledger);
  const same = { currency: 'UYU', spent_on: '2026-11-10', category_id: c.food.id };
  const a = await create(ledger, { ...same, amount: '50.00', description: 'Empate A' });
  const b = await create(ledger, { ...same, amount: '50.00', description: 'Empate B' });
  const later = await create(ledger, { ...same, amount: '50.00', currency: 'USD', spent_on: '2026-11-11', description: 'Mayor fecha' });
  await create(ledger, { ...same, amount: '700.00', spent_on: '2026-01-01', description: 'Mayor importe' });
  const tied = [a, b].sort((x, y) => x.id < y.id ? 1 : -1).map((row) => row.description);

  await page.goto('/historial');
  await expect(titles(page)).toHaveText(['Mayor fecha', ...tied, 'Mayor importe']);
  await page.getByRole('button', { name: /^Importe/ }).click();
  await expect(page).toHaveURL(/orden=importe/);
  await expect(titles(page).first()).toHaveText('Mayor importe');
  await expect(page.getByRole('columnheader', { name: /Importe/ })).toHaveAttribute('aria-sort', 'descending');
  // Nominal order across currencies; equal amounts fall back to id in the same direction.
  const descending = ['Mayor importe', ...[a, b, later].sort((x, y) => x.id < y.id ? 1 : -1).map((row) => row.description)];
  await expect(titles(page)).toHaveText(descending);
  await page.getByRole('button', { name: /^Importe/ }).click();
  await expect(page.getByRole('columnheader', { name: /Importe/ })).toHaveAttribute('aria-sort', 'ascending');
  await expect(titles(page).last()).toHaveText('Mayor importe');
  await expect(titles(page)).toHaveText([...descending].reverse());
  await chooseOption(page.getByRole('button', { name: 'Ordenar', exact: true }), { label: 'Fecha ↑ · antiguos' });
  await expect(titles(page)).toHaveText(['Mayor importe', ...[...tied].reverse(), 'Mayor fecha']);
  expect(listCalls(ledger).at(-1).args).toMatchObject({ sort: 'spent_on', direction: 'asc' });
});

test('paginación por cursor conserva filas y reintenta una página fallida', async ({ page, ledger }) => {
  const c = await catalog(ledger);
  await seedMany(ledger, 65, c.food.id);
  await page.goto('/historial');
  await expect(rows(page)).toHaveCount(30);
  const first = await titles(page).allTextContents();
  ledger.faults.before = 'list_expenses';
  await button(page, 'Cargar más gastos').click();
  await expect(page.getByText('No pudimos cargar más gastos. Los que ya ves se conservan.')).toBeVisible();
  await expect(rows(page)).toHaveCount(30);
  expect(await titles(page).allTextContents()).toEqual(first);
  await button(page, 'Reintentar').click();
  await expect(rows(page)).toHaveCount(60);
  await button(page, 'Cargar más gastos').click();
  await expect(rows(page)).toHaveCount(65);
  await expect(button(page, 'Cargar más gastos')).toHaveCount(0);
  const all = await titles(page).allTextContents();
  expect(new Set(all).size).toBe(65);
  expect(all.slice(0, 30)).toEqual(first);
  const cursors = listCalls(ledger).map((call) => call.args.cursor);
  expect(cursors[0]).toBeNull();
  expect(cursors.slice(1).every(Boolean)).toBe(true);
});

test('editar y eliminar desde la fila vuelve a la misma consulta y actualiza la lista', async ({ page, ledger }) => {
  const c = await catalog(ledger);
  await create(ledger, { amount: '100.00', currency: 'UYU', spent_on: '2026-11-20', category_id: c.food.id, description: 'Feria' });
  const moved = await create(ledger, { amount: '200.00', currency: 'USD', spent_on: '2026-11-15', category_id: c.food.id, description: 'Mover de fecha' });
  await create(ledger, { amount: '300.00', currency: 'EUR', spent_on: '2026-11-10', category_id: c.food.id, description: 'Para borrar' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/historial?desde=2026-11-01&hasta=2026-11-30');
  await expect(titles(page)).toHaveText(['Feria', 'Mover de fecha', 'Para borrar']);

  await button(page, 'Acciones para Mover de fecha').click();
  await page.getByRole('link', { name: 'Editar' }).click();
  await expect(page.getByLabel('Importe del gasto')).toHaveValue('200,00');
  await page.getByLabel('Importe del gasto').fill('210,40');
  await pickDate(page.getByLabel('Fecha', { exact: true }), '2026-11-25');
  await chooseOption(page.getByLabel('Categoría', { exact: true }), { label: 'Servicios' });
  await button(page, 'Guardar cambios').click();
  await expect(page).toHaveURL(/\/historial\?desde=2026-11-01&hasta=2026-11-30$/);
  await expect(page.getByRole('status').filter({ hasText: 'Cambios guardados' })).toBeVisible();
  await expect(titles(page)).toHaveText(['Mover de fecha', 'Feria', 'Para borrar']);
  await expect(rows(page).first()).toContainText('USD210,40');
  await expect(rows(page).first()).toContainText('Servicios');
  expect((await ledger.rpc('get_expense', { id: moved.id })).version).toBe(2);

  // A reclassified expense leaves the category filter it no longer matches.
  await page.goto(`/historial?categoria=${c.food.id}`);
  await expect(titles(page)).toHaveText(['Feria', 'Para borrar']);

  await button(page, 'Acciones para Para borrar').click();
  await button(page, 'Eliminar').click();
  const dialog = page.getByRole('dialog', { name: 'Eliminar gasto' });
  await expect(dialog).toContainText('EUR 300,00');
  await button(dialog, 'Cancelar').click();
  await expect(rows(page)).toHaveCount(2);
  await button(page, 'Acciones para Para borrar').click();
  await button(page, 'Eliminar').click();
  ledger.faults.after = 'delete_expense';
  await button(dialog, 'Eliminar gasto').click();
  await expect(dialog.getByText('No pudimos confirmar la eliminación.')).toBeVisible();
  await button(dialog, 'Reintentar').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Gasto eliminado' })).toBeVisible();
  await expect(titles(page)).toHaveText(['Feria']);
  await expect(page).toHaveURL(new RegExp('categoria=' + c.food.id));
  expect(ledger.calls.filter((call) => call.name.endsWith('_expense') && call.name !== 'list_expenses').map((call) => call.name).slice(-2))
    .toEqual(['delete_expense', 'get_expense']);
  expect((await ledger.db.query('select count(*)::int as n from app.expenses')).rows[0].n).toBe(2);
});

test('en móvil la fila abre el detalle con editar y eliminar', async ({ page, ledger }) => {
  const c = await catalog(ledger);
  const row = await create(ledger, { amount: '88.00', currency: 'UYU', spent_on: '2026-11-18', category_id: c.food.id, subcategory_id: c.market.id });
  await create(ledger, { amount: '5.00', currency: 'USD', spent_on: '2026-11-17', category_id: c.services.id, description: 'Otro' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/historial?moneda=UYU');
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('.expense-table thead')).toBeHidden();
  await expect(rows(page).first()).toContainText('18 nov · Alimentación · Supermercado');
  await rows(page).first().click();
  await expect(page).toHaveURL(new RegExp('moneda=UYU&gasto=' + row.id));
  const detail = page.getByRole('region', { name: 'Detalle del gasto' });
  await expect(detail).toContainText('Sin descripción');
  await expect(detail.getByRole('link', { name: 'Editar gasto' })).toBeVisible();
  await button(detail, 'Eliminar gasto').click();
  await button(page.getByRole('dialog'), 'Eliminar gasto').click();
  await expect(page).toHaveURL(/\/historial\?moneda=UYU$/);
  await expect(page.getByRole('heading', { name: 'Sin resultados' })).toBeVisible();
  await expect(page.locator('.row-menu-trigger')).toHaveCount(0);
});

test('los gastos de otra persona no aparecen ni se pueden abrir', async ({ page, ledger }) => {
  const c = await catalog(ledger);
  await create(ledger, { amount: '1.00', currency: 'UYU', spent_on: '2026-11-01', category_id: c.food.id, description: 'Propio' });
  await asUser(ledger.db, users.b, sessions.b);
  const other = (await ledger.rpc('get_catalog')).categories[0];
  const foreign = await create(ledger, { amount: '2.00', currency: 'EUR', spent_on: '2026-11-02', category_id: other.id, description: 'Ajeno' });
  await asUser(ledger.db, users.a, sessions.a);
  await page.goto('/historial');
  await expect(titles(page)).toHaveText(['Propio']);
  await page.goto('/historial?categoria=' + other.id);
  await expect(page.getByRole('heading', { name: 'No pudimos aplicar esta consulta' })).toBeVisible();
  await page.goto('/historial?gasto=' + foreign.id);
  await expect(page.getByText('Este gasto ya no está disponible.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Volver al historial' })).toHaveAttribute('href', '/historial');
});

for (const [width, height] of [[1440, 960], [834, 1112], [375, 812]]) {
  test('pantallas del historial a ' + width + ' px', async ({ page, ledger }, info) => {
    await page.setViewportSize({ width, height });
    async function capture(name) {
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await page.screenshot({ path: info.outputPath(name + '-' + width + '.png') });
    }
    await page.goto('/historial');
    await expect(page.getByRole('heading', { name: 'Todavía no registraste gastos' })).toBeVisible();
    await capture('vacio');
    const c = await catalog(ledger);
    const samples = [
      ['Compra semanal', 'Alimentación', 'Supermercado', '2026-11-23', 'UYU', '1280.00'],
      ['Viaje al centro', 'Transporte', 'Taxi/Uber', '2026-11-22', 'UYU', '340.00'],
      ['Suscripción de cine', 'Servicios', null, '2026-11-21', 'USD', '12.00'],
      [null, 'Alimentación', 'Supermercado', '2026-11-21', 'UYU', '920.00'],
      ['Electricidad', 'Servicios', null, '2026-11-19', 'UYU', '2400.00'],
      ['Alquiler de noviembre', 'Servicios', null, '2026-11-18', 'UYU', '9600.00'],
      ['Tren a Colonia', 'Transporte', 'Taxi/Uber', '2026-11-17', 'EUR', '45.90'],
    ];
    for (const [description, parent, child, spent_on, currency, amount] of samples) {
      const category = { Alimentación: c.food, Transporte: c.transport, Servicios: c.services }[parent];
      await create(ledger, { description, category_id: category.id, subcategory_id: child === 'Supermercado' ? c.market.id : child ? c.taxi.id : null,
        spent_on, currency, amount });
    }
    await seedMany(ledger, 30, c.food.id);
    await page.goto('/historial?desde=2026-11-01&hasta=2026-11-30');
    await expect(rows(page)).toHaveCount(7);
    await capture('lista');
    await page.getByRole('button', { name: /^Filtros/ }).click();
    await expect(page.getByRole('form', { name: 'Filtros del historial' })).toBeVisible();
    await capture('filtros');
    await button(page, 'Cancelar').click();
    await page.getByLabel('Buscar por descripción').fill('nada coincide');
    await expect(page.getByRole('heading', { name: 'Sin resultados' })).toBeVisible();
    await capture('sin-resultados');
    await button(page, 'Limpiar filtros').click();
    await expect(rows(page)).toHaveCount(30);
    await expect(button(page, 'Cargar más gastos')).toBeVisible();
    if (width > 620) {
      await button(page, 'Acciones para Compra semanal').click();
      await expect(page.getByRole('link', { name: 'Editar' })).toBeVisible();
      await capture('acciones');
      await page.keyboard.press('Escape');
    }
    await titles(page).first().click();
    await expect(page.getByRole('region', { name: 'Detalle del gasto' })).toBeVisible();
    await capture('detalle');
  });
}
