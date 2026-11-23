import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const a = '00000000-0000-4000-a000-000000000001';
const b = '00000000-0000-4000-a000-000000000002';
const outsider = '00000000-0000-4000-a000-000000000003';
const sessionA = '10000000-0000-4000-a000-000000000001';
const sessionB = '10000000-0000-4000-a000-000000000002';
const sessionOutsider = '10000000-0000-4000-a000-000000000003';
const sessionA2 = '10000000-0000-4000-a000-000000000004';

test('migración desde cero, privilegios, políticas y sesiones en PostgreSQL embebido', async (t) => {
  const db = await PGlite.create();
  t.after(() => db.close());
  const query = async (sql, args) => (await db.query(sql, args)).rows;
  const value = async (sql, args) => (await query(sql, args))[0]?.value;

  // Minimal Supabase contract. Auth and the JWT gateway are verified in hosted tests.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create role supabase_auth_admin;
    create schema auth;
    create schema graphql_public;
    grant usage on schema graphql_public to public, anon, authenticated;
    create table auth.users (id uuid primary key);
    create table auth.sessions (
      id uuid primary key, user_id uuid not null references auth.users(id)
    );
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select (auth.jwt() ->> 'sub')::uuid;
    $$;
    grant usage on schema auth to authenticated, anon, service_role;
  `);
  await db.exec(await readFile(new URL('../../migrations/20261123000000_security.sql', import.meta.url), 'utf8'));

  await db.exec(`
    insert into auth.users values ('${a}'), ('${b}'), ('${outsider}');
    insert into auth.sessions values ('${sessionA}', '${a}'), ('${sessionA2}', '${a}'),
      ('${sessionB}', '${b}'), ('${sessionOutsider}', '${outsider}');
    insert into private.members values (1, '${a}'), (2, '${b}');
    insert into app.preferences values ('${a}', 'UYU'), ('${b}', 'EUR');
  `);

  async function asUser(sub, session_id) {
    await db.exec('reset role; set role authenticated;');
    await query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub, session_id })]);
  }

  await t.test('esquemas, firmas, RLS y concesiones mínimas', async () => {
    const functions = await query(`
      select proname, prosecdef, pg_get_userbyid(proowner) as owner,
        pronargs, proconfig, provolatile
      from pg_proc
      where pronamespace in ('api'::regnamespace, 'private'::regnamespace)
      order by proname
    `);
    assert.equal(functions.length, 4);
    assert.deepEqual(functions[0], {
      proname: 'allowed', prosecdef: true, owner: 'postgres', pronargs: 0,
      proconfig: ['search_path=""'], provolatile: 's',
    });
    assert.ok(functions.slice(1).every(({ prosecdef }) => !prosecdef));
    const policies = await query(`
      select relrowsecurity from pg_class
      where oid in ('app.preferences'::regclass, 'private.members'::regclass, 'private.bootstrap_emails'::regclass)
    `);
    assert.deepEqual(policies.map((table) => table.relrowsecurity), [true, true, true]);

    assert.equal(await value("select has_schema_privilege('authenticated', 'graphql_public', 'USAGE') as value"), false);
    assert.equal(await value("select has_schema_privilege('anon', 'api', 'USAGE') as value"), false);
    for (const role of ['anon', 'service_role']) {
      for (const name of ['private.allowed()', 'private.before_user_created(jsonb)', 'api.get_preferences()', 'api.set_currency(text)']) {
        assert.equal(await value("select has_function_privilege($1, $2, 'EXECUTE') as value", [role, name]), false);
      }
    }
    for (const [object, privilege] of [
      ['private.members', 'SELECT'], ['private.bootstrap_emails', 'SELECT'],
      ['auth.sessions', 'SELECT'], ['app.preferences', 'INSERT'], ['app.preferences', 'DELETE'],
    ]) {
      assert.equal(await value("select has_table_privilege('authenticated', $1, $2) as value", [object, privilege]), false);
    }
    assert.equal(await value(
      "select has_column_privilege('authenticated', 'app.preferences', 'owner_id', 'UPDATE') as value",
    ), false);
    assert.equal(await value(
      "select has_column_privilege('authenticated', 'app.preferences', 'currency', 'UPDATE') as value",
    ), true);
    await db.exec('create function api.audit_fixture() returns int language sql as $$ select 1 $$;');
    assert.equal(await value(
      "select has_function_privilege('authenticated', 'api.audit_fixture()', 'EXECUTE') as value",
    ), false);
    await db.exec('drop function api.audit_fixture();');
  });

  await t.test('admisión temporal por Google y límite de plazas', async () => {
    await assert.rejects(db.exec(`insert into private.members values (3, '${outsider}')`), { code: '23514' });

    async function runHook(event) {
      await db.exec('set role supabase_auth_admin');
      try {
        return await value('select private.before_user_created($1::jsonb) as value', [JSON.stringify(event)]);
      } finally {
        await db.exec('reset role');
      }
    }
    const google = { user: { app_metadata: { provider: 'google' }, email: ' A@example.test ' } };
    assert.equal((await runHook(google)).error.http_code, 403);
    await db.exec("insert into private.bootstrap_emails values ('a@example.test'), ('b@example.test');");
    assert.deepEqual(await runHook(google), {});
    assert.equal((await runHook({ user: { ...google.user, email: 'c@example.test' } })).error.http_code, 403);
    assert.equal((await runHook({ user: { ...google.user, app_metadata: { provider: 'email' } } })).error.http_code, 403);
    assert.equal((await runHook({})).error.http_code, 403);
    await db.exec("insert into private.bootstrap_emails values ('c@example.test');");
    assert.equal((await runHook(google)).error.http_code, 403);
    await db.exec('delete from private.bootstrap_emails;');
  });

  await t.test('preferencias propias y rechazo de cambios sobre otro propietario', async () => {
    await asUser(a, sessionA);
    const preferences = await value('select api.get_preferences() as value');
    assert.deepEqual(preferences, {
      currency: 'UYU', favorites: [],
      today: await value("select to_char(now() at time zone 'America/Montevideo', 'YYYY-MM-DD') as value"),
    });
    assert.deepEqual(await query('select owner_id from app.preferences'), [{ owner_id: a }]);
    assert.deepEqual(await query("update app.preferences set currency = 'USD' where owner_id = $1 returning currency", [b]), []);
    assert.deepEqual(await value("select api.set_currency('USD') as value"), { currency: 'USD' });
    for (const invalid of [null, 'usd', 'GBP']) {
      await assert.rejects(value('select api.set_currency($1) as value', [invalid]), { code: 'PT422' });
    }
    await asUser(b, sessionB);
    assert.equal((await value('select api.get_preferences() as value')).currency, 'EUR');
    assert.deepEqual(await query('select owner_id from app.preferences'), [{ owner_id: b }]);
  });

  await t.test('exclusión de anónimo, externo y tokens de sesiones ajenas o revocadas', async () => {
    await db.exec('reset role; set role anon');
    await assert.rejects(value('select api.get_preferences() as value'), { code: '42501' });
    for (const [owner, session] of [[outsider, sessionOutsider], [a, sessionB], [a, 'malformed'], [a, null]]) {
      await asUser(owner, session);
      await assert.rejects(value('select api.get_preferences() as value'), { code: 'PT403' });
      await assert.rejects(value('select api.set_currency(null) as value'), { code: 'PT403' });
      assert.deepEqual(await query('select owner_id from app.preferences'), []);
    }

    await db.exec('reset role');
    await query('delete from auth.sessions where id = $1', [sessionA]);
    await asUser(a, sessionA);
    await assert.rejects(value('select api.get_preferences() as value'), { code: 'PT403' });
    await asUser(a, sessionA2);
    assert.equal((await value('select api.get_preferences() as value')).currency, 'USD');

    await db.exec('reset role');
    await query('delete from private.members where owner_id = $1', [a]);
    await asUser(a, sessionA2);
    await assert.rejects(value('select api.get_preferences() as value'), { code: 'PT403' });
    await asUser(b, sessionB);
    assert.equal((await value('select api.get_preferences() as value')).currency, 'EUR');
  });
});
