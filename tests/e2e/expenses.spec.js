import { expect, test } from './database-fixture.js';

test.use({ locale: 'es-UY' });

const button = (page, name) => page.getByRole('button', { name, exact: true });
const category = (page) => page.getByLabel('Categoría', { exact: true });
const child = (page) => page.getByLabel('Subcategoría · opcional');

async function fillExpense(page, { amount = '1250,50', currency = 'UYU', parent = 'Alimentación' } = {}) {
  await page.goto('/gastos/nuevo');
  await page.getByLabel('Importe del gasto').fill(amount);
  await button(page, currency).click();
  await page.getByLabel('Fecha', { exact: true }).fill('2024-02-29');
  await category(page).selectOption({ label: parent });
  await page.getByLabel('Descripción · opcional').fill('Compra en la feria');
}

async function createFromDialog(page, kind, name) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill(name);
  await button(dialog, 'Crear ' + kind).click();
  await expect(dialog).toHaveCount(0);
}

test('crear, renombrar, archivar y restaurar una categoría', async ({ page, ledger }) => {
  await page.goto('/categorias');
  await button(page, 'Crear categoría').click();
  await createFromDialog(page, 'categoría', 'Librería');
  await button(page, 'Editar Librería').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill('Libros');
  await button(dialog, 'Guardar cambios').click();
  await button(page, 'Editar Libros').click();
  await button(dialog, 'Archivar categoría').click();
  await expect(button(page, 'Editar Libros')).toHaveCount(0);
  await button(page, 'Archivadas').click();
  await button(page, 'Editar Libros').click();
  await button(dialog, 'Restaurar categoría').click();
  await button(page, 'Activas').click();
  await expect(button(page, 'Editar Libros')).toBeVisible();
  expect((await ledger.rpc('get_catalog')).categories).toContainEqual(expect.objectContaining({ name: 'Libros', archived: false }));
});

test('alta en dos monedas, clasificación en el formulario, edición y borrado confirmados', async ({ page, ledger }) => {
  await fillExpense(page);
  await category(page).selectOption('__create__');
  await createFromDialog(page, 'categoría', 'Mercado');
  await expect(category(page).locator('option:checked')).toHaveText('Mercado');
  await child(page).selectOption('__create__');
  await button(page.getByRole('dialog'), 'Cancelar').click();
  await expect(page.getByLabel('Importe del gasto')).toHaveValue('1250,50');
  await child(page).selectOption('__create__');
  await createFromDialog(page, 'subcategoría', 'Verdulería');
  await expect(child(page).locator('option:checked')).toHaveText('Verdulería');
  await expect(page.getByLabel('Descripción · opcional')).toHaveValue('Compra en la feria');
  expect(ledger.calls.filter((call) => call.name === 'create_expense')).toHaveLength(0);
  await button(page, 'Guardar gasto').click();
  await page.getByRole('link', { name: 'Ver gasto' }).click();
  await expect(page.getByLabel('Importe del gasto')).toHaveValue('1250,50');
  const id = ledger.calls.find((call) => call.name === 'create_expense').args.id;
  expect(await ledger.rpc('get_expense', { id })).toMatchObject({ currency: 'UYU', spent_on: '2024-02-29', subcategory_name: 'Verdulería' });
  await page.getByLabel('Importe del gasto').fill('99,01');
  await button(page, 'Guardar cambios').click();
  await expect.poll(async () => (await ledger.rpc('get_expense', { id })).version).toBe(2);
  expect((await ledger.rpc('get_expense', { id })).amount).toBe('99.01');
  await fillExpense(page, { amount: '8,75', currency: 'USD' });
  await button(page, 'Guardar gasto').click();
  await expect(page.getByRole('link', { name: 'Ver gasto' })).toBeVisible();
  const other = ledger.calls.filter((call) => call.name === 'create_expense').at(-1).args.id;
  expect((await ledger.rpc('get_expense', { id: other })).currency).toBe('USD');
  await page.goto('/gastos/' + id + '/editar');
  await button(page, 'Eliminar gasto').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Compra en la feria');
  await button(dialog, 'Eliminar gasto').click();
  await expect.poll(async () => (await ledger.db.query('select count(*)::int n from app.expenses')).rows[0].n).toBe(1);
  expect((await ledger.rpc('get_expense', { id: other })).version).toBe(1);
});

for (const fault of ['before', 'after']) {
  test('reconciliar una desconexión ' + (fault === 'before' ? 'antes' : 'después') + ' del commit', async ({ page, ledger }) => {
    await fillExpense(page, { currency: 'EUR', amount: '70,02' });
    ledger.faults[fault] = 'create_expense';
    await button(page, 'Guardar gasto').click();
    await expect(page.getByLabel('Importe del gasto')).toHaveValue('70,02');
    await expect(page.getByRole('link', { name: 'Ver gasto' })).toHaveCount(0);
    await button(page, 'Reintentar').click();
    await expect(page.getByRole('link', { name: 'Ver gasto' })).toBeVisible();
    const names = ledger.calls.filter((call) => call.name.endsWith('_expense')).map((call) => call.name);
    expect(names).toEqual(fault === 'after' ? ['create_expense', 'get_expense'] : ['create_expense', 'get_expense', 'create_expense']);
    const ids = new Set(ledger.calls.filter((call) => call.name.endsWith('_expense')).map((call) => call.args.id));
    expect(ids.size).toBe(1);
    expect((await ledger.db.query('select count(*)::int as n from app.expenses')).rows[0].n).toBe(1);
  });
}

test('un enlace histórico permite consultar y editar un gasto con la categoría archivada', async ({ page, ledger }) => {
  await fillExpense(page);
  await button(page, 'Guardar gasto').click();
  await expect(page.getByRole('link', { name: 'Ver gasto' })).toBeVisible();
  const { id, category_id } = ledger.calls.find((call) => call.name === 'create_expense').args;
  await ledger.rpc('update_category', { kind: 'category', id: category_id, patch: { archived: true } });
  await page.goto('/historial?gasto=' + id);
  const detail = page.getByRole('region', { name: 'Detalle del gasto' });
  await expect(detail).toContainText('Compra en la feria');
  await expect(detail).toContainText('Alimentación');
  await expect(detail).toContainText('Archivada');
  const edit = detail.getByRole('link', { name: 'Editar gasto' });
  await expect(edit).toHaveAttribute('href', '/gastos/' + id + '/editar');
  await edit.click();
  await expect(category(page).locator('option:checked')).toHaveText(/Alimentación.*Archivada/i);
  await page.getByLabel('Importe del gasto').fill('137,20');
  await button(page, 'Guardar cambios').click();
  await expect.poll(async () => (await ledger.rpc('get_expense', { id })).amount).toBe('137.20');
});

test('un conflicto conserva el importe escrito y la versión guardada por otra sesión', async ({ page, ledger }) => {
  const { categories } = await ledger.rpc('get_catalog');
  const input = { id: crypto.randomUUID(), amount: '2.00', currency: 'USD', spent_on: '2024-02-29',
    category_id: categories[0].id, subcategory_id: null, description: 'Prueba de versión' };
  await ledger.rpc('create_expense', input);
  await page.goto('/gastos/' + input.id + '/editar');
  await page.getByLabel('Importe del gasto').fill('20,00');
  await ledger.rpc('update_expense', { ...input, amount: '30.00', version: 1 });
  await button(page, 'Guardar cambios').click();
  await expect(page.getByText(/El gasto cambió desde que lo abriste/).first()).toBeVisible();
  await expect(page.getByLabel('Importe del gasto')).toHaveValue('20,00');
  expect((await ledger.rpc('get_expense', { id: input.id })).amount).toBe('30.00');
});

for (const [width, height] of [[1440, 960], [834, 1112], [375, 812]]) {
  test('pantallas de gastos y categorías a ' + width + ' px', async ({ page, ledger }, info) => {
    await page.setViewportSize({ width, height });
    async function capture(name) {
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await page.screenshot({ path: info.outputPath(name + '-' + width + '.png') });
    }
    await fillExpense(page);
    await child(page).selectOption({ label: 'Supermercado' });
    await capture('nuevo');
    await child(page).selectOption('__create__');
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture('dialogo');
    await button(page.getByRole('dialog'), 'Cancelar').click();
    await button(page, 'Guardar gasto').click();
    await page.getByRole('link', { name: 'Ver gasto' }).click();
    await expect(button(page, 'Guardar cambios')).toBeVisible();
    await capture('editar');
    await button(page, 'Eliminar gasto').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture('eliminar');
    await page.keyboard.press('Escape');
    await page.goto('/categorias');
    await button(page, 'Alimentación').click();
    await expect(button(page, 'Editar Supermercado')).toBeVisible();
    await capture('categorias');
    expect(ledger.calls.filter((call) => call.name === 'create_expense')).toHaveLength(1);
  });
}
