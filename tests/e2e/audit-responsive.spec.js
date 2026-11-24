import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from './database-fixture.js';

// IMP-06 · Auditoría visual y responsive. Recorre todas las pantallas, diálogos y el menú
// móvil a 360, 375, 390, 430 (celular), 768 y 1024 (tablet) y 1440 px (escritorio), en
// Chromium y en WebKit. Es emulación de viewport, no un dispositivo físico.
// Comprueba: sin desbordamiento horizontal (página y diálogos), áreas táctiles de al menos
// 44 × 44 px en celular (UI-01 · sistema visual), ningún error de consola (incluida la CSP)
// y foco visible al recorrer con el teclado. CIFRA_AUDIT_CAPTURES=1 guarda las capturas.
test.use({ locale: 'es-UY' });

const PHONES = [360, 375, 390, 430];
const WIDTHS = [...PHONES, 768, 1024, 1440];
const HEIGHT = { 360: 780, 375: 812, 390: 844, 430: 932, 768: 1024, 1024: 1366, 1440: 960 };
const captures = process.env.CIFRA_AUDIT_CAPTURES === '1';

async function seed(ledger) {
  const { categories, subcategories } = await ledger.rpc('get_catalog');
  const id = (list, name) => list.find((entry) => entry.name === name).id;
  const food = id(categories, 'Alimentación');
  const transport = id(categories, 'Transporte');
  const home = id(categories, 'Vivienda');
  const rows = [
    ['2026-11-03', 'UYU', '2000.00', food, id(subcategories, 'Supermercado'), 'Compra semanal del supermercado del barrio'],
    ['2026-11-08', 'UYU', '3000.00', food, id(subcategories, 'Restaurantes'), 'Cena del sábado'],
    ['2026-11-09', 'USD', '50.00', food, null, 'Libros importados'],
    ['2026-11-20', 'UYU', '3600.00', transport, id(subcategories, 'Taxi/Uber'), 'Viaje al centro'],
    ['2026-11-01', 'UYU', '999999999999.99', home, null, 'Importe máximo para probar el ancho'],
    ['2026-10-15', 'UYU', '32000.00', home, null, 'Octubre'],
    ['2025-03-10', 'UYU', '1234.56', food, null, 'Año anterior'],
  ];
  let first;
  for (const [spent_on, currency, amount, category_id, subcategory_id, description] of rows) {
    const { expense } = await ledger.rpc('create_expense', {
      id: crypto.randomUUID(), amount, currency, spent_on, category_id, subcategory_id, description });
    first ??= expense.id;
  }
  for (const [category_id, monthly_limit] of [[transport, '3600'], [home, '10000'], [food, '15000']]) {
    await ledger.rpc('create_budget', { category_id, currency: 'UYU', monthly_limit });
  }
  return { expense: first };
}

// Elementos accionables visibles cuyo rectángulo no alcanza 44 × 44 px. Los enlaces dentro de
// un párrafo o de una tabla de datos son texto, no controles, y quedan fuera de la regla.
function smallTargets() {
  const selector = 'button, select, input:not([type=hidden]), textarea, a.btn, a.square, a.navitem, a.quick-action,'
    + ' a.panel-link, a.history-link, a.row-link, a.cat-row, [role=button], summary';
  const out = [];
  for (const element of document.querySelectorAll(selector)) {
    if (element.closest('[aria-hidden="true"], .sr-only, table, p, dialog:not([open])')) continue;
    if (document.querySelector('dialog[open]') && !element.closest('dialog[open]')) continue;
    const style = getComputedStyle(element);
    // Un select transparente cubre su control visible: se mide el contenedor que se toca.
    const box = (style.opacity === '0' ? element.parentElement : element).getBoundingClientRect();
    if (!box.width || !box.height || style.visibility === 'hidden' || style.display === 'none') continue;
    if (box.width < 44 || box.height < 44) {
      const name = element.getAttribute('aria-label') || element.textContent.trim().slice(0, 30) || element.id || element.name;
      out.push(`${element.tagName.toLowerCase()}${element.className ? '.' + String(element.className).split(' ')[0] : ''}`
        + ` «${name}» ${Math.round(box.width)}×${Math.round(box.height)}`);
    }
  }
  return out;
}

function overflow() {
  const page = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  const dialog = [...document.querySelectorAll('dialog[open]')].map((node) => node.scrollWidth - node.clientWidth);
  const wide = [...document.querySelectorAll('body *')].filter((node) => {
    const box = node.getBoundingClientRect();
    return box.width && box.right > document.documentElement.clientWidth + 1 && !node.closest('.chart-table-wrap, details:not([open])');
  }).slice(0, 5).map((node) => node.tagName.toLowerCase() + '.' + String(node.className).split(' ')[0]);
  return { page, dialog: Math.max(0, ...dialog), wide };
}

for (const width of WIDTHS) {
      test(`${width} px: pantallas, diálogos y menú sin desbordes`, async ({ page, ledger, browserName }, testInfo) => {
        const errors = [];
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('pageerror', (error) => errors.push(error.message));
        const { expense } = await seed(ledger);
        await page.setViewportSize({ width, height: HEIGHT[width] });
        const phone = PHONES.includes(width);
        const report = [];
        async function check(name) {
          await page.waitForLoadState('networkidle');
          await expect(page.locator('[role=status]', { hasText: /^Cargando/ })).toHaveCount(0);
          const result = await page.evaluate(overflow);
          const targets = phone ? await page.evaluate(smallTargets) : [];
          report.push({ name, ...result, targets });
          if (captures) {
            const dir = `test-results/audit/${browserName}`;
            await mkdir(dir, { recursive: true });
            await page.screenshot({ path: `${dir}/${width}-${name}.png`, fullPage: true, caret: 'initial' });
          }
        }
        const visit = async (path, name, ready) => {
          await page.goto(path);
          await expect(ready()).toBeVisible();
          await check(name);
        };
        await visit('/', 'resumen', () => page.locator('section[aria-labelledby="overview-recent"] tbody tr').first());
        await visit('/estadisticas', 'estadisticas', () => page.locator('.recharts-surface').first());
        await visit('/historial', 'historial', () => page.locator('.expense-table tbody tr').first());
        await visit('/historial?gasto=' + expense, 'detalle', () => page.getByRole('link', { name: /Editar/ }).first());
        await visit('/presupuestos', 'presupuestos', () => page.getByText('Mayor uso del límite'));
        await page.getByRole('button', { name: 'Crear límite', exact: true }).first().click();
        await expect(page.getByRole('dialog', { name: 'Crear límite' })).toBeVisible();
        await check('presupuesto-dialogo');
        await page.keyboard.press('Escape');
        await visit('/categorias', 'categorias', () => page.getByText('Alimentación').first());
        await visit('/cuenta', 'cuenta', () => page.getByRole('button', { name: 'Cerrar sesión' }));
        await visit('/gastos/nuevo', 'nuevo-gasto', () => page.getByLabel('Importe del gasto'));
        await visit(`/gastos/${expense}/editar`, 'editar-gasto', () => page.getByRole('button', { name: 'Guardar cambios' }));
        await page.getByRole('button', { name: 'Eliminar gasto', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Eliminar gasto' })).toBeVisible();
        await check('eliminar-dialogo');
        await page.keyboard.press('Escape');
        if (width <= 860) {
          await page.goto('/');
          await page.getByRole('button', { name: width <= 620 ? 'Ver menú' : 'Expandir barra lateral' }).click();
          await expect(page.getByRole('dialog', { name: 'Navegación' })).toBeVisible();
          await check('menu');
        }
        await testInfo.attach('report', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
        await mkdir('test-results/audit', { recursive: true });
        await writeFile(`test-results/audit/${browserName}-${width}.json`, JSON.stringify({ report, errors }, null, 2));
        // Al capturar, Playwright inyecta en WebKit una hoja de estilos que la CSP de Cifra rechaza
        // (sin capturas no aparece): ese aviso pertenece a la herramienta, no a la aplicación.
        const own = captures && browserName === 'webkit'
          ? errors.filter((text) => !text.startsWith('Refused to apply a stylesheet')) : errors;
        expect.soft(own, 'errores de consola').toEqual([]);
        for (const entry of report) {
          expect.soft(entry.page, `${entry.name}: desborde horizontal`).toBeLessThanOrEqual(0);
          expect.soft(entry.dialog, `${entry.name}: desborde en diálogo`).toBeLessThanOrEqual(0);
          expect.soft(entry.targets, `${entry.name}: áreas táctiles`).toEqual([]);
        }
      });
}

// Regresión IMP-06: un total de siete u ocho cifras (UYU 1.234.567,89) se partía en dos líneas
// a mitad del número en el Resumen a 360 px. Ahora se achica y sigue dentro de su panel.
for (const amount of ['1234567.89', '12345678.90', '999999999999.99']) {
  test(`360 px: el importe ${amount} no se parte ni desborda`, async ({ page, ledger }) => {
    const { categories } = await ledger.rpc('get_catalog');
    const category_id = categories.find((entry) => entry.name === 'Vivienda').id;
    await ledger.rpc('create_expense', { id: crypto.randomUUID(), amount, currency: 'UYU', spent_on: '2026-11-03', category_id });
    await ledger.rpc('create_expense', { id: crypto.randomUUID(), amount, currency: 'UYU', spent_on: '2026-10-03', category_id });
    await ledger.rpc('create_budget', { category_id, currency: 'UYU', monthly_limit: '100' });
    await page.setViewportSize({ width: 360, height: 780 });
    const whole = (locator) => locator.evaluate((node) => {
      const panel = node.closest('.panel').getBoundingClientRect();
      const rects = [...node.getClientRects()];
      return { lines: rects.length, inside: rects.every((rect) => rect.left >= panel.left && rect.right <= panel.right) };
    });
    await page.goto('/');
    await expect(whole(page.locator('.hero-value .history-link'))).resolves.toEqual({ lines: 1, inside: true });
    await page.goto('/estadisticas');
    for (const link of await page.locator('.metrics .history-link').all()) {
      await expect(whole(link)).resolves.toEqual({ lines: 1, inside: true });
    }
    await page.goto('/presupuestos');
    await expect(page.locator('.highlight .gauge text')).toBeVisible();
    const gauge = await page.locator('.highlight .gauge').evaluate((svg) => {
      const box = svg.getBoundingClientRect();
      const text = svg.querySelector('text').getBoundingClientRect();
      return text.left >= box.left - 1 && text.right <= box.right + 1;
    });
    expect(gauge).toBe(true);
  });
}

// Teclado: cada parada del Tab tiene un indicador de foco visible (UI-01: contorno salvia de
// 2 px) y el recorrido no queda atrapado fuera de un diálogo.
for (const width of [375, 1440]) {
  test(`${width} px: recorrido con Tab y foco visible en cada pantalla`, async ({ page, ledger }) => {
    await seed(ledger);
    await page.setViewportSize({ width, height: HEIGHT[width] });
    const missing = [];
    for (const path of ['/', '/estadisticas', '/historial', '/presupuestos', '/categorias', '/gastos/nuevo']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.locator('body').click({ position: { x: 1, y: 1 } });
      const seen = new Set();
      for (let step = 0; step < 40; step += 1) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
          const element = document.activeElement;
          if (!element || element === document.body) return null;
          const style = getComputedStyle(element);
          const parent = element.parentElement && getComputedStyle(element.parentElement);
          const ring = (s) => s && ((s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2) || s.boxShadow !== 'none');
          const label = element.getAttribute('aria-label') || element.textContent.trim().slice(0, 30) || element.id || element.tagName;
          return { key: element.tagName + label, label, visible: ring(style) || ring(parent) || ring(getComputedStyle(element, '::after')) };
        });
        if (!info || seen.has(info.key)) break;
        seen.add(info.key);
        if (!info.visible) missing.push(`${path}: ${info.label}`);
      }
      expect(seen.size, path + ': paradas de Tab').toBeGreaterThan(3);
    }
    expect(missing).toEqual([]);
  });
}
