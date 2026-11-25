// Helpers E2E para interactuar con SpringSelect y DatePicker en pruebas Playwright.

export async function chooseOption(trigger, option) {
  await trigger.click();
  const listboxId = await trigger.getAttribute('aria-controls');
  const listbox = listboxId
    ? trigger.page().locator(`[id="${listboxId}"]`)
    : trigger.page().getByRole('listbox');
  const item = typeof option === 'string'
    ? listbox.locator(`[role="option"][data-value="${option}"]`)
    : listbox.getByRole('option', { name: option.label, exact: true });
  await item.click();
  await listbox.waitFor({ state: 'detached' });
}

export async function pickDate(trigger, iso) {
  const [year, month] = iso.split('-').map(Number);
  await trigger.click();
  const dialog = trigger.page().getByRole('dialog', { name: 'Elegir fecha' });
  const dayButton = dialog.locator(`button[data-iso="${iso}"]`);
  if (await dayButton.count()) {
    await dayButton.click();
    await dialog.waitFor({ state: 'detached' });
    return;
  }
  await dialog.locator('.calendar__heading-btn').click();
  const currentYear = Number((await dialog.locator('.calendar__heading-btn').innerText()).trim());
  if (currentYear !== year) {
    await dialog.locator('.calendar__heading-btn').click();
    while (!(await dialog.getByRole('button', { name: String(year), exact: true }).count())) {
      const rangeText = await dialog.locator('.calendar__heading-btn').innerText();
      const firstYear = Number(rangeText.split('–')[0].trim());
      await dialog.getByRole('button', { name: year < firstYear ? 'Años anteriores' : 'Años siguientes' }).click();
    }
    await dialog.getByRole('button', { name: String(year), exact: true }).click();
  }
  await dialog.locator('.calendar__grid-12 button').nth(month - 1).click();
  await dialog.locator(`button[data-iso="${iso}"]`).click();
  await dialog.waitFor({ state: 'detached' });
}
