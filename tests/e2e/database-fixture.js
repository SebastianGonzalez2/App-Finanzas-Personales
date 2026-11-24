import { expect, test as base } from '@playwright/test';
import { asUser, createTestDatabase, sessions, users } from '../../supabase/tests/database/fixture.js';

// Same civil date as the access mock, so periods and the annual window are reproducible.
export const TODAY = '2026-11-23';
import { enter, mockSupabase } from './access-fixture.js';

const signatures = {
  get_catalog: [],
  create_category: ['name', 'category_id'],
  update_category: ['kind', 'id', 'patch'],
  get_expense: ['id'],
  create_expense: ['id', 'amount', 'currency', 'spent_on', 'category_id', 'subcategory_id', 'description'],
  update_expense: ['id', 'version', 'amount', 'currency', 'spent_on', 'category_id', 'subcategory_id', 'description'],
  delete_expense: ['id', 'version'],
  list_expenses: ['filters', 'q', 'sort', 'direction', 'limit', 'cursor'],
  get_preferences: [],
  set_currency: ['currency'],
  set_favorite: ['panel', 'enabled'],
  get_stats: ['filters', 'reference', 'month_offset'],
  get_annual: ['currency', 'end_year', 'category_id', 'subcategory_id'],
  get_budgets: ['currency'],
  create_budget: ['category_id', 'currency', 'monthly_limit'],
  update_budget: ['category_id', 'currency', 'monthly_limit'],
  delete_budget: ['category_id', 'currency'],
};
const jsonArgs = ['patch', 'filters', 'reference'];

// Chromium exercises the built app and SDK. The loopback route executes the actual migrations
// as authenticated in a disposable database. Hosted HTTP checks cover PostgREST separately.
export const test = base.extend({
  // Opciones del doble de Auth (por ejemplo, un token de vida corta para probar la renovación).
  access: [{}, { option: true }],
  ledger: async ({ page, access }, use) => {
    const db = await createTestDatabase({ today: TODAY });
    try {
      await asUser(db, users.a, sessions.a);
      const calls = [];
      const faults = { before: null, after: null };
      // A held request waits until the test releases it (late responses, ARCH-01 §15 RF-021).
      const holds = [];
      function hold(name, match = () => true) {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        holds.push({ name, match, gate });
        return release;
      }
      async function rpc(name, args = {}) {
        const fields = signatures[name];
        if (!fields || Object.keys(args).some((field) => !fields.includes(field))) {
          throw new Error('Unexpected RPC signature');
        }
        const placeholders = fields.map((_, index) => '$' + (index + 1)).join(', ');
        const values = fields.map((key) => jsonArgs.includes(key)
          ? (key === 'reference' && args[key] == null ? null : JSON.stringify(args[key] ?? {})) : args[key] ?? null);
        return (await db.query('select api.' + name + '(' + placeholders + ') as result', values)).rows[0].result;
      }
      // access.clock instala un reloj controlable antes de abrir la aplicación.
      if (access.clock) await page.clock.install();
      const auth = await mockSupabase(page, access);
      await page.route('**/rest/v1/rpc/*', async (route) => {
        const name = new URL(route.request().url()).pathname.split('/').pop();
        if (!Object.hasOwn(signatures, name) || route.request().method() === 'OPTIONS') return route.fallback();
        const args = route.request().postDataJSON() ?? {};
        expect(route.request().headers()['content-profile']).toBe('api');
        expect(route.request().headers().authorization).toMatch(/^Bearer /);
        // Session plumbing (get_preferences) stays out of the business call log.
        if (name !== 'get_preferences') calls.push({ name, args });
        const held = holds.findIndex((entry) => entry.name === name && entry.match(args));
        if (held >= 0) await holds.splice(held, 1)[0].gate;
        if (faults.before === name) {
          faults.before = null;
          return route.abort('internetdisconnected');
        }
        try {
          const result = await rpc(name, args);
          if (faults.after === name) {
            faults.after = null;
            return route.abort('connectionreset');
          }
          return await route.fulfill({ status: 200, json: result }).catch(() => {});
        } catch (error) {
          return route.fulfill({ status: /^PT\d{3}$/.test(error.code) ? Number(error.code.slice(2)) : 500,
            json: { code: error.code, message: error.message } });
        }
      });
      await page.goto('/login');
      await enter(page);
      await use({ rpc, calls, faults, hold, db, auth });
    } finally {
      await db.close();
    }
  },
});
export { expect };
