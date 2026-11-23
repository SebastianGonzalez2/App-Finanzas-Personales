import { expect, test as base } from '@playwright/test';
import { asUser, createTestDatabase, sessions, users } from '../../supabase/tests/database/fixture.js';
import { enter, mockSupabase } from './access-fixture.js';

const signatures = {
  get_catalog: [],
  create_category: ['name', 'category_id'],
  update_category: ['kind', 'id', 'patch'],
  get_expense: ['id'],
  create_expense: ['id', 'amount', 'currency', 'spent_on', 'category_id', 'subcategory_id', 'description'],
  update_expense: ['id', 'version', 'amount', 'currency', 'spent_on', 'category_id', 'subcategory_id', 'description'],
  delete_expense: ['id', 'version'],
};

// Chromium exercises the built app and SDK. The loopback route executes the actual migrations
// as authenticated in a disposable database. Hosted HTTP checks cover PostgREST separately.
export const test = base.extend({
  ledger: async ({ page }, use) => {
    const db = await createTestDatabase();
    try {
      await asUser(db, users.a, sessions.a);
      const calls = [];
      const faults = { before: null, after: null };
      async function rpc(name, args = {}) {
        const fields = signatures[name];
        if (!fields || Object.keys(args).some((field) => !fields.includes(field))) {
          throw new Error('Unexpected RPC signature');
        }
        const placeholders = fields.map((_, index) => '$' + (index + 1)).join(', ');
        const values = fields.map((key) => key === 'patch' ? JSON.stringify(args[key]) : args[key] ?? null);
        return (await db.query('select api.' + name + '(' + placeholders + ') as result', values)).rows[0].result;
      }
      await mockSupabase(page);
      await page.route('**/rest/v1/rpc/*', async (route) => {
        const name = new URL(route.request().url()).pathname.split('/').pop();
        if (!Object.hasOwn(signatures, name) || route.request().method() === 'OPTIONS') return route.fallback();
        const args = route.request().postDataJSON() ?? {};
        expect(route.request().headers()['content-profile']).toBe('api');
        expect(route.request().headers().authorization).toMatch(/^Bearer /);
        calls.push({ name, args });
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
          return route.fulfill({ status: 200, json: result });
        } catch (error) {
          return route.fulfill({ status: /^PT\d{3}$/.test(error.code) ? Number(error.code.slice(2)) : 500,
            json: { code: error.code, message: error.message } });
        }
      });
      await page.goto('/login');
      await enter(page);
      await use({ rpc, calls, faults, db });
    } finally {
      await db.close();
    }
  },
});
export { expect };
