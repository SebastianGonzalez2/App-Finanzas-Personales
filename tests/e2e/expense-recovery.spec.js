import { expect, test } from './database-fixture.js';
import { chooseOption } from './controls.js';

test('un doble envío invoca una sola alta y confirma el UUID persistido', async ({ page, ledger }) => {
  await page.goto('/gastos/nuevo');
  await page.getByLabel('Importe del gasto').fill('10,50');
  await chooseOption(page.getByLabel('Categoría', { exact: true }), { label: 'Alimentación' });
  // Dispatch both before React can replace the button with the saving state.
  await page.getByRole('button', { name: 'Guardar gasto' }).evaluate((button) => { button.click(); button.click(); });
  await expect(page.getByRole('link', { name: 'Ver gasto' })).toBeVisible();
  const writes = ledger.calls.filter(({ name }) => name === 'create_expense');
  expect(writes).toHaveLength(1);
  expect(await ledger.rpc('get_expense', { id: writes[0].args.id })).toMatchObject({ amount: '10.50', version: 1 });
});

for (const action of ['update', 'delete']) {
  test('recuperar ' + (action === 'update' ? 'edición' : 'borrado') + ' confirmado con respuesta perdida', async ({ page, ledger }) => {
    const { categories } = await ledger.rpc('get_catalog');
    const id = crypto.randomUUID();
    await ledger.rpc('create_expense', { id, amount: '27.08', currency: 'EUR', spent_on: '2026-08-12',
      category_id: categories[0].id, description: 'Gasto de prueba' });
    await page.goto('/gastos/' + id + '/editar');
    const name = action + '_expense';
    ledger.faults.after = name;
    if (action === 'update') {
      await page.getByLabel('Importe del gasto').fill('29,99');
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
    } else {
      await page.getByRole('button', { name: 'Eliminar gasto' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Eliminar gasto' }).click();
    }
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.getByRole('status').filter({ hasText: action === 'update' ? 'Cambios guardados' : 'Gasto eliminado' })).toBeVisible();
    expect(ledger.calls.filter((call) => call.name === name)).toHaveLength(1);
    if (action === 'update') {
      expect(await ledger.rpc('get_expense', { id })).toMatchObject({ amount: '29.99', version: 2 });
    } else {
      await expect(ledger.rpc('get_expense', { id })).rejects.toMatchObject({ code: 'PT404', message: 'EXPENSE_NOT_FOUND' });
    }
  });
}
