import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export const users = {
  a: '00000000-0000-4000-a000-000000000001',
  b: '00000000-0000-4000-a000-000000000002',
  outsider: '00000000-0000-4000-a000-000000000003',
};
export const sessions = {
  a: '10000000-0000-4000-a000-000000000001',
  b: '10000000-0000-4000-a000-000000000002',
  outsider: '10000000-0000-4000-a000-000000000003',
  a2: '10000000-0000-4000-a000-000000000004',
};

// Only for disposable databases. Models the Auth catalog and JWT settings that
// PostgREST supplies. The application migrations themselves run unmodified.
const authSchema = `
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create role supabase_auth_admin;
  create schema auth;
  create schema graphql_public;
  grant usage on schema graphql_public to public, anon, authenticated;
  create table auth.users (id uuid primary key);
  create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users(id));
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  grant usage on schema auth to authenticated, anon, service_role;
`;

export async function databaseSetupSql() {
  const migrations = new URL('../../migrations/', import.meta.url);
  const files = (await readdir(migrations)).filter((file) => file.endsWith('.sql')).sort();
  const sql = await Promise.all(files.map((file) => readFile(new URL(file, migrations), 'utf8')));
  return [
    authSchema, sql[0],
    // Simulate the explicit hosted grants that IMP-01 reconciled.
    'grant execute on all functions in schema api to public, anon, service_role;',
    `insert into auth.users values ('${users.a}'), ('${users.b}'), ('${users.outsider}');
     insert into auth.sessions values ('${sessions.a}', '${users.a}'), ('${sessions.a2}', '${users.a}'),
       ('${sessions.b}', '${users.b}'), ('${sessions.outsider}', '${users.outsider}');
     insert into private.members values (1, '${users.a}');
     insert into app.preferences values ('${users.a}', 'UYU');`,
    ...sql.slice(1),
    // A existed before the catalog migration; B is provisioned after it.
    `begin;
     insert into private.members values (2, '${users.b}');
     insert into app.preferences values ('${users.b}', 'EUR');
     commit;`,
  ];
}

export async function createTestDatabase() {
  const db = await PGlite.create();
  try {
    for (const sql of await databaseSetupSql()) await db.exec(sql);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

export async function asUser(db, sub, session_id) {
  await db.exec('reset role; set role authenticated;');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub, session_id })]);
}
