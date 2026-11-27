import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createTestDatabase } from './fixture.js';

const migration = new URL('../../migrations/20261127190000_health_check.sql', import.meta.url);

test('health_check: única superficie anónima, de solo lectura y sin acceso a datos', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const rows = async (sql) => (await db.query(sql)).rows;

  await t.test('definición y concesiones mínimas', async () => {
    assert.deepEqual(await rows(`
      select prosecdef, provolatile, proconfig,
        has_function_privilege('anon', oid, 'execute') as anon,
        has_function_privilege('authenticated', oid, 'execute') as member,
        has_function_privilege('service_role', oid, 'execute') as service
      from pg_proc where oid = 'api.health_check()'::regprocedure`), [{
      prosecdef: false, provolatile: 's', proconfig: ['search_path=""'],
      anon: true, member: false, service: false,
    }]);
    assert.deepEqual(await rows(`
      select proname from pg_proc
      where pronamespace in ('api'::regnamespace, 'app'::regnamespace, 'private'::regnamespace)
        and has_function_privilege('anon', oid, 'execute')
        and has_schema_privilege('anon', pronamespace, 'usage')`), [{ proname: 'health_check' }]);
    assert.deepEqual(await rows(`
      select s, has_schema_privilege('anon', s, 'usage') as usage
      from unnest(array['api', 'app', 'private']) as s order by s`),
    [{ s: 'api', usage: true }, { s: 'app', usage: false }, { s: 'private', usage: false }]);
  });

  await t.test('anon recibe solo el estado, también en una transacción de solo lectura', async () => {
    await db.exec('set role anon; begin read only;');
    try {
      const [{ result }] = await rows('select api.health_check() as result');
      assert.deepEqual(Object.keys(result).sort(), ['checked_at', 'status']);
      assert.equal(result.status, 'ok');
      assert.ok(!Number.isNaN(Date.parse(result.checked_at)));
    } finally {
      await db.exec('rollback; reset role;');
    }
  });

  await t.test('anon sigue sin acceso a datos ni a otras funciones', async () => {
    await db.exec('set role anon');
    try {
      for (const sql of [
        'select * from app.expenses', 'select * from app.preferences', 'select * from private.members',
        'select api.get_preferences()', 'select api.get_catalog()', 'select api.list_recurring_payments()',
      ]) {
        await assert.rejects(db.query(sql), { code: '42501' }, sql);
      }
    } finally {
      await db.exec('reset role');
    }
  });

  await t.test('la migración es repetible y se cancela si anon alcanzara otro objeto', async () => {
    const sql = await readFile(migration, 'utf8');
    await db.exec(sql);
    await db.exec('grant execute on function api.get_catalog() to anon');
    await assert.rejects(db.exec(sql), /health_check cancelado/);
    await db.exec('rollback; revoke execute on function api.get_catalog() from anon;');
    await db.exec(sql);
  });
});
