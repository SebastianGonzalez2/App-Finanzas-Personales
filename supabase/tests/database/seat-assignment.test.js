import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { databaseSetupSql, users } from './fixture.js';

// IMP-06 · El script operativo supabase/audit/assign-seat-2.sql asigna la plaza 2 a la cuenta
// Google admitida, siembra su catálogo, vacía la lista de admisión y no admite repeticiones ni
// cuentas sin identidad Google. El modelo de Auth se amplía con email e identities.
const script = await readFile(new URL('../../audit/assign-seat-2.sql', import.meta.url), 'utf8');

async function database() {
  const db = new PGlite();
  for (const sql of await databaseSetupSql()) await db.exec(sql);
  await db.exec(`alter table auth.users add column email text, add column email_confirmed_at timestamptz;
    create table auth.identities (user_id uuid, provider text);
    update auth.users set email = 'padre@example.test', email_confirmed_at = now() where id = '${users.outsider}';
    delete from private.members where slot = 2;
    insert into private.bootstrap_emails values ('padre@example.test');`);
  return db;
}
const run = (db, email) => db.exec(script.replaceAll('<CORREO_PLAZA_2>', email));

test('asigna la plaza 2 a la cuenta Google admitida y vacía la admisión', async () => {
  const db = await database();
  try {
    await db.exec(`insert into auth.identities values ('${users.outsider}', 'google')`);
    await run(db, ' Padre@Example.test ');
    const { rows: [row] } = await db.query(`select (select owner_id from private.members where slot = 2)::text as owner,
      (select count(*) from app.categories where owner_id = $1)::int as categories,
      (select count(*) from private.bootstrap_emails)::int as admission`, [users.outsider]);
    assert.deepEqual(row, { owner: users.outsider, categories: 13, admission: 0 });
    await assert.rejects(run(db, 'padre@example.test'), /ya ocupa una plaza/);
  } finally {
    await db.close();
  }
});

test('rechaza una cuenta sin identidad Google o inexistente sin cambiar nada', async () => {
  const db = await database();
  try {
    await db.exec(`insert into auth.identities values ('${users.outsider}', 'email')`);
    await assert.rejects(run(db, 'padre@example.test'), /identidad, de Google/);
    await db.exec('rollback');
    await assert.rejects(run(db, 'otra@example.test'), /no rows|query returned no rows/);
    await db.exec('rollback');
    const { rows: [row] } = await db.query(`select (select count(*) from private.members)::int as members,
      (select count(*) from private.bootstrap_emails)::int as admission`);
    assert.deepEqual(row, { members: 1, admission: 1 });
  } finally {
    await db.close();
  }
});
