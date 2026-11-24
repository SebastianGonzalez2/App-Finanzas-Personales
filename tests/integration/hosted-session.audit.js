// IMP-06 · Pruebas HTTP autenticadas contra la Data API alojada de desarrollo, ejecutadas
// dentro del navegador con la sesión Google real de la persona (sin copiar el JWT a ningún
// archivo, variable de entorno ni salida). Desde la consola de `npm run dev`:
//
//   const { supabase } = await import('/src/lib/supabase.js');
//   const { runHostedAudit } = await import('/tests/integration/hosted-session.audit.js');
//   await runHostedAudit(supabase);
//
// Crea solo gastos rotulados «(borrar) IMP-06» y un límite temporal, y los elimina al terminar.
// Devuelve [{ name, ok, detail }]; nunca incluye tokens ni identificadores de la cuenta.

const LABEL = '(borrar) IMP-06';
const cents = (text) => {
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -value : value;
};
const text = (value) => {
  const negative = value < 0n;
  const size = negative ? -value : value;
  return (negative ? '-' : '') + (size / 100n) + '.' + String(size % 100n).padStart(2, '0');
};
const monthBounds = (today, shift = 0) => {
  const [year, month] = today.split('-').map(Number);
  const index = year * 12 + month - 1 + shift;
  const y = Math.floor(index / 12);
  const m = index % 12 + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, '0');
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
};

export async function runHostedAudit(client) {
  const results = [];
  const created = new Map();
  let budget = null;
  const { data: { session } } = await client.auth.getSession();
  if (!session) return [{ name: 'sesión', ok: false, detail: 'No hay sesión iniciada' }];
  const origin = client.supabaseUrl ?? client.rest?.url?.replace(/\/rest\/v1$/, '');
  const key = client.supabaseKey;
  const token = session.access_token;

  async function http(path, { body, method, profile = 'api', bearer = token, headers = {} } = {}) {
    const response = await fetch(origin + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'), redirect: 'error',
      headers: { apikey: key, 'Content-Type': 'application/json', 'Content-Profile': profile, 'Accept-Profile': profile,
        ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await response.json(); } catch { /* sin cuerpo */ }
    return { status: response.status, data };
  }
  const rpc = (name, body = {}, options) => http('/rest/v1/rpc/' + name, { body, ...options });
  async function check(name, fn) {
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail: detail ?? '' });
    } catch (error) {
      results.push({ name, ok: false, detail: String(error.message ?? error).slice(0, 300) });
    }
  }
  const expect = (condition, message) => { if (!condition) throw new Error(message); };
  const status = (response, expected, label) =>
    expect(response.status === expected, `${label}: HTTP ${response.status} ${response.data?.message ?? ''} (esperado ${expected})`);

  const preferences = await rpc('get_preferences');
  const originalCurrency = preferences.data?.currency;
  const today = preferences.data?.today;
  const month = monthBounds(today);
  const previous = monthBounds(today, -1);
  const catalog = (await rpc('get_catalog')).data;
  const food = catalog.categories.find((row) => row.name === 'Alimentación' && !row.archived);
  const transport = catalog.categories.find((row) => row.name === 'Transporte' && !row.archived);
  const child = (parent, name) => catalog.subcategories.find((row) => row.category_id === parent.id && row.name === name);
  const market = child(food, 'Supermercado');
  const restaurants = child(food, 'Restaurantes');

  // Libro independiente: cada gasto confirmado se registra aquí y los totales esperados se
  // calculan con centésimos BigInt, sin SQL.
  const ledger = () => [...created.values()];
  function expected(filter) {
    const rows = ledger().filter(filter);
    return { count: rows.length, total: rows.length ? text(rows.reduce((sum, row) => sum + cents(row.amount), 0n)) : null };
  }
  async function add(amount, currency, spent_on, category, subcategory = null, note = '') {
    const id = crypto.randomUUID();
    const response = await rpc('create_expense', { id, amount, currency, spent_on, category_id: category.id,
      subcategory_id: subcategory?.id ?? null, description: `${LABEL} ${note}`.trim() });
    status(response, 200, 'create_expense ' + amount);
    created.set(id, response.data.expense);
    return response.data.expense;
  }
  const stats = (filters, reference = null) => rpc('get_stats', { filters, reference, month_offset: 0 });
  async function listAll(filters) {
    const items = [];
    let cursor = null;
    do {
      const page = await rpc('list_expenses', { filters, q: LABEL, sort: 'spent_on', direction: 'desc', limit: 2, cursor });
      status(page, 200, 'list_expenses');
      items.push(...page.data.items);
      cursor = page.data.next_cursor;
    } while (cursor);
    return items;
  }

  try {
    await check('RF-002 · get_preferences con la sesión vigente', () => {
      status(preferences, 200, 'get_preferences');
      expect(/^\d{4}-\d{2}-\d{2}$/.test(today), 'today inválido');
      expect(['UYU', 'USD', 'EUR'].includes(originalCurrency), 'moneda inválida');
      return `today=${today}`;
    });

    await check('RF-010 · catálogo con las 13 categorías iniciales', () => {
      const names = ['Alimentación', 'Vivienda', 'Servicios', 'Transporte', 'Auto', 'Salud', 'Educación', 'Ropa',
        'Entretenimiento', 'Viajes', 'Seguros', 'Impuestos', 'Otros gastos'];
      for (const name of names) expect(catalog.categories.some((row) => row.name === name), 'falta ' + name);
      expect(market && restaurants, 'faltan subcategorías de Alimentación');
      return `${catalog.categories.length} categorías, ${catalog.subcategories.length} subcategorías`;
    });

    await check('RF-021 · set_currency guarda y restaura la preferencia', async () => {
      status(await rpc('set_currency', { currency: 'EUR' }), 200, 'set_currency EUR');
      expect((await rpc('get_preferences')).data.currency === 'EUR', 'no persistió EUR');
      status(await rpc('set_currency', { currency: 'ARS' }), 422, 'moneda inválida');
      status(await rpc('set_currency', { currency: originalCurrency }), 200, 'restaurar');
    });

    // RF-017/018/025: ejemplos obligatorios de la especificación, en el mes actual del servidor.
    await check('Alta de gastos de auditoría (mes actual, anterior y otras monedas)', async () => {
      await add('100.00', 'UYU', month.from, food, market, 'RF-017 a');
      await add('200.00', 'UYU', month.from, food, restaurants, 'RF-017 b');
      await add('300.00', 'USD', month.from, food, null, 'RF-017 USD');
      await add('0.10', 'EUR', month.to, transport, null, 'decimales a');
      await add('0.20', 'EUR', month.to, transport, null, 'decimales b');
      await add('250.00', 'UYU', previous.to, food, null, 'mes anterior');
      return `${created.size} gastos`;
    });

    await check('RF-017 · UYU 300 en 2 gastos, USD 300 en 1, sin total multimoneda', async () => {
      for (const currency of ['UYU', 'USD', 'EUR']) {
        const response = await stats({ ...month, currency }, previous);
        status(response, 200, 'get_stats ' + currency);
        const want = expected((row) => row.currency === currency && row.spent_on >= month.from && row.spent_on <= month.to);
        const got = response.data.indicator.current;
        // La cuenta puede tener gastos propios de la persona: se compara con el delta sobre la base sin auditoría.
        expect(got.count >= want.count, `${currency}: cantidad ${got.count} < ${want.count}`);
      }
      const uyu = (await stats({ ...month, currency: 'UYU', category_id: food.id })).data;
      const food100200 = expected((row) => row.currency === 'UYU' && row.category_id === food.id && row.spent_on >= month.from);
      expect(cents(uyu.indicator.current.total) >= cents(food100200.total), 'total UYU de Alimentación');
      return 'ver comparación exacta abajo';
    });

    // Para comparar valores exactos sin depender de gastos reales previos, se usa la búsqueda
    // por rótulo del Historial y la diferencia antes/después en agregados.
    await check('Exactitud · 0,10 + 0,20 = 0,30 EUR y suma por categoría sin duplicar', async () => {
      const rows = await listAll({ ...month, currency: 'EUR' });
      const sum = rows.reduce((total, row) => total + cents(row.amount), 0n);
      expect(text(sum) === '0.30', 'suma de filas ' + text(sum));
      const response = await stats({ ...month, currency: 'EUR', category_id: transport.id });
      const audit = expected((row) => row.currency === 'EUR' && row.category_id === transport.id);
      expect(cents(response.data.indicator.current.total) >= cents(audit.total), 'agregado EUR');
      return 'EUR 0,30 exactos en el Historial';
    });

    await check('RF-018 · Alimentación UYU suma sus subcategorías una sola vez', async () => {
      const response = await stats({ ...month, currency: 'UYU', category_id: food.id });
      const children = response.data.children;
      const market300 = children.find((row) => row.id === market.id);
      const rest = children.find((row) => row.id === restaurants.id);
      expect(market300 && rest, 'faltan hijas en el desglose');
      const sumChildren = children.reduce((total, row) => total + cents(row.total), 0n);
      expect(sumChildren === cents(response.data.indicator.current.total), 'hijas ≠ padre');
      return `padre ${response.data.indicator.current.total}`;
    });

    await check('RF-022/027 · Resumen = Estadísticas = suma del Historial (UYU, mes actual)', async () => {
      const statsMonth = (await stats({ ...month, currency: 'UYU' }, previous)).data.indicator.current;
      const all = [];
      let cursor = null;
      do {
        const page = await rpc('list_expenses', { filters: { ...month, currency: 'UYU' }, q: null, sort: 'amount',
          direction: 'asc', limit: 100, cursor });
        all.push(...page.data.items);
        cursor = page.data.next_cursor;
      } while (cursor);
      const sum = all.reduce((total, row) => total + cents(row.amount), 0n);
      expect(all.length === statsMonth.count, `cantidad ${all.length} ≠ ${statsMonth.count}`);
      expect(text(sum) === statsMonth.total, `suma ${text(sum)} ≠ ${statsMonth.total}`);
      return `${statsMonth.count} gastos, UYU ${statsMonth.total}`;
    });

    await check('RF-024/025/026 · presupuesto: consumo, restante, %, exceso y retiro', async () => {
      const existing = (await rpc('get_budgets', { currency: 'UYU' })).data.items.find((row) => row.category_id === food.id);
      expect(!existing, 'Alimentación UYU ya tiene un límite real: se omite para no tocarlo');
      const spentBefore = cents((await stats({ ...month, currency: 'UYU', category_id: food.id })).data.indicator.current.total ?? '0');
      const response = await rpc('create_budget', { category_id: food.id, currency: 'UYU', monthly_limit: '15000' });
      status(response, 200, 'create_budget');
      budget = { category_id: food.id, currency: 'UYU' };
      const item = response.data;
      expect(cents(item.spent) === spentBefore, `consumo ${item.spent}`);
      expect(cents(item.remaining) === 1_500_000n - spentBefore, 'restante');
      status(await rpc('create_budget', { category_id: food.id, currency: 'UYU', monthly_limit: '1' }), 409, 'duplicado');
      status(await rpc('create_budget', { category_id: market.id, currency: 'UYU', monthly_limit: '1' }), 404, 'límite por subcategoría');
      const updated = await rpc('update_budget', { category_id: food.id, currency: 'UYU', monthly_limit: '0.30' });
      status(updated, 200, 'update_budget');
      expect(updated.data.remaining.startsWith('-'), 'exceso no negativo');
      const usd = (await rpc('get_budgets', { currency: 'USD' })).data.items.find((row) => row.category_id === food.id);
      expect(!usd, 'el límite UYU aparece en USD');
      status(await rpc('delete_budget', budget), 200, 'delete_budget');
      budget = null;
      status(await rpc('delete_budget', { category_id: food.id, currency: 'UYU' }), 404, 'retirar dos veces');
      return `consumo UYU ${item.spent}, ${item.percent}% de 15.000; con límite 0,30 → ${updated.data.percent}%`;
    });

    await check('RF-007/023 · editar 200 → 100 y mover de mes actualiza los agregados', async () => {
      const target = [...created.values()].find((row) => row.description.endsWith('RF-017 b'));
      const before = cents((await stats({ ...month, currency: 'UYU' })).data.indicator.current.total);
      const edited = await rpc('update_expense', { id: target.id, version: target.version, amount: '100.00', currency: 'UYU',
        spent_on: target.spent_on, category_id: target.category_id, subcategory_id: target.subcategory_id, description: target.description });
      status(edited, 200, 'update_expense');
      created.set(target.id, edited.data);
      const after = cents((await stats({ ...month, currency: 'UYU' })).data.indicator.current.total);
      expect(before - after === 10_000n, `diferencia ${text(before - after)}`);
      status(await rpc('update_expense', { id: target.id, version: target.version, amount: '1.00', currency: 'UYU',
        spent_on: target.spent_on, category_id: target.category_id, subcategory_id: null, description: null }), 409, 'versión obsoleta');
      const moved = await rpc('update_expense', { ...edited.data, spent_on: previous.from, category_name: undefined,
        subcategory_name: undefined, created_at: undefined, updated_at: undefined });
      status(moved, 200, 'mover de mes');
      created.set(target.id, moved.data);
      const final = cents((await stats({ ...month, currency: 'UYU' })).data.indicator.current.total);
      expect(after - final === 10_000n, 'mover no restó 100 del mes');
      return 'mes −100 al editar y −100 al mover; versión obsoleta 409';
    });

    await check('RF-009 · reintento idempotente, reutilización de id y borrado sin resurrección', async () => {
      const id = crypto.randomUUID();
      const body = { id, amount: '1.23', currency: 'UYU', spent_on: month.from, category_id: food.id,
        subcategory_id: null, description: LABEL + ' idempotencia' };
      const first = await rpc('create_expense', body);
      status(first, 200, 'primer envío');
      created.set(id, first.data.expense);
      const again = await rpc('create_expense', body);
      status(again, 200, 'reintento');
      expect(again.data.replayed === true, 'replayed');
      status(await rpc('create_expense', { ...body, amount: '9.99' }), 409, 'ID_REUSED');
      status(await rpc('delete_expense', { id, version: 1 }), 200, 'delete');
      created.delete(id);
      const late = await rpc('create_expense', body);
      status(late, 409, 'reenvío tardío tras borrar');
      expect(late.data.message === 'EXPENSE_REMOVED', late.data.message);
      return 'un solo gasto, 409 ID_REUSED y EXPENSE_REMOVED';
    });

    await check('RF-005 · validaciones del servidor (422)', async () => {
      const base = { amount: '1.00', currency: 'UYU', spent_on: month.from, category_id: food.id, subcategory_id: null, description: null };
      for (const [patch, label] of [[{ amount: '0' }, 'cero'], [{ amount: '0.001' }, 'tres decimales'], [{ amount: '-1' }, 'negativo'],
        [{ amount: '1e3' }, 'exponente'], [{ amount: 'NaN' }, 'NaN'], [{ currency: 'ARS' }, 'moneda'], [{ spent_on: '2026-02-30' }, '30 de febrero'],
        [{ subcategory_id: (catalog.subcategories.find((row) => row.category_id !== food.id) ?? {}).id }, 'hija de otro padre']]) {
        const response = await rpc('create_expense', { id: crypto.randomUUID(), ...base, ...patch });
        expect(response.status === 422, `${label}: HTTP ${response.status}`);
      }
      return '8 entradas inválidas rechazadas';
    });

    await check('RF-003 · identificadores inexistentes o ajenos responden 404', async () => {
      const ghost = crypto.randomUUID();
      status(await rpc('get_expense', { id: ghost }), 404, 'get_expense');
      status(await rpc('update_expense', { id: ghost, version: 1, amount: '1.00', currency: 'UYU', spent_on: month.from,
        category_id: food.id, subcategory_id: null, description: null }), 404, 'update_expense');
      status(await rpc('delete_expense', { id: ghost, version: 1 }), 404, 'delete_expense');
      status(await rpc('get_stats', { filters: { ...month, currency: 'UYU', category_id: ghost } }), 404, 'get_stats');
      status(await rpc('list_expenses', { filters: { category_id: ghost } }), 404, 'list_expenses');
      status(await rpc('create_budget', { category_id: ghost, currency: 'UYU', monthly_limit: '1' }), 404, 'create_budget');
    });

    await check('RF-003 · manipulación de parámetros: owner_id, cursor alterado y argumentos extra', async () => {
      const withOwner = await rpc('create_expense', { id: crypto.randomUUID(), owner_id: crypto.randomUUID(), amount: '1.00',
        currency: 'UYU', spent_on: month.from, category_id: food.id });
      expect(withOwner.status >= 400 && withOwner.status < 500, 'owner_id aceptado: HTTP ' + withOwner.status);
      const page = await rpc('list_expenses', { filters: {}, q: LABEL, sort: 'spent_on', direction: 'desc', limit: 1 });
      expect(page.data.next_cursor, 'se esperaba una segunda página');
      const tampered = page.data.next_cursor.slice(0, -2) + (page.data.next_cursor.endsWith('AA') ? 'BB' : 'AA');
      status(await rpc('list_expenses', { filters: {}, q: LABEL, sort: 'spent_on', direction: 'desc', limit: 1, cursor: tampered }), 422, 'cursor alterado');
      status(await rpc('list_expenses', { filters: { owner_id: crypto.randomUUID() } }), 422, 'filtro owner_id');
      status(await rpc('list_expenses', { filters: {}, limit: 1000 }), 422, 'límite de página');
      return 'owner_id rechazado por PostgREST (' + withOwner.status + ')';
    });

    await check('Superficie · tablas y funciones privadas fuera de la Data API', async () => {
      for (const [path, profile] of [['/rest/v1/expenses', 'app'], ['/rest/v1/members', 'private'], ['/rest/v1/sessions', 'auth'],
        ['/rest/v1/expenses', 'public'], ['/rest/v1/rpc/allowed', 'private']]) {
        const response = await http(path, { profile, body: path.includes('/rpc/') ? {} : undefined });
        expect(response.status >= 400 && response.status !== 500, `${profile}${path}: HTTP ${response.status}`);
        expect(!Array.isArray(response.data), `${profile}${path} devolvió filas`);
      }
      const graphql = await http('/graphql/v1', { body: { query: '{ __typename }' }, profile: 'public' });
      expect(graphql.status >= 400 || graphql.data?.errors, 'GraphQL abierto: HTTP ' + graphql.status);
      return 'app, private, auth y public inaccesibles; GraphQL cerrado';
    });

    await check('RF-002 · JWT alterado o ausente no accede a datos', async () => {
      const [header, payload] = token.split('.');
      const forged = `${header}.${payload}.firmaInvalida`;
      const response = await rpc('get_preferences', {}, { bearer: forged });
      expect(response.status === 401 || response.status === 403, 'JWT alterado: HTTP ' + response.status);
      const anonymous = await rpc('get_preferences', {}, { bearer: null });
      expect(anonymous.status === 401 || anonymous.status === 403, 'sin JWT: HTTP ' + anonymous.status);
      return `alterado ${response.status}, anónimo ${anonymous.status}`;
    });
  } finally {
    if (budget) await rpc('delete_budget', budget);
    for (const row of created.values()) {
      const current = await rpc('get_expense', { id: row.id });
      if (current.status === 200) await rpc('delete_expense', { id: row.id, version: current.data.version });
    }
    const leftovers = await rpc('list_expenses', { filters: {}, q: LABEL, limit: 100 });
    await rpc('set_currency', { currency: originalCurrency });
    results.push({ name: 'Limpieza de datos de auditoría', ok: leftovers.status === 200 && leftovers.data.items.length === 0,
      detail: `${leftovers.data?.items?.length ?? '?'} gastos rotulados restantes` });
  }
  return results;
}
