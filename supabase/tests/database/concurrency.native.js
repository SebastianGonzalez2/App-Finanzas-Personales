// Run with node --test supabase/tests/database/concurrency.native.js.
// initdb, pg_ctl and psql must be on PATH or under CIFRA_PG_BIN.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { databaseSetupSql, sessions, users } from './fixture.js';

const run = promisify(execFile);
const bin = (name) => join(process.env.CIFRA_PG_BIN || '', name + (process.platform === 'win32' ? '.exe' : ''));

async function availablePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return String(port);
}

test('reintentos concurrentes con dos conexiones PostgreSQL reales', { timeout: 120_000 }, async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'cifra-imp02-pg-'));
  const data = join(temp, 'data');
  const log = join(temp, 'postgres.log');
  const port = await availablePort();
  const password = randomBytes(32).toString('hex');
  const pwfile = join(temp, 'init-password');
  let started = false;
  t.after(async () => {
    if (started) await run(bin('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { windowsHide: true });
    await rm(temp, { recursive: true, force: true });
  });
  await writeFile(pwfile, password, { mode: 0o600 });
  await run(bin('initdb'), ['-D', data, '-U', 'postgres', '--auth=scram-sha-256', '--pwfile', pwfile,
    '--no-locale', '--encoding=UTF8'], { windowsHide: true });
  await rm(pwfile);
  try {
    await run(bin('pg_ctl'), ['-D', data, '-l', log, '-o', '-h 127.0.0.1 -p ' + port, '-w', 'start'],
      { windowsHide: true, timeout: 30_000 });
    started = true;
  } catch (error) {
    throw new Error(await readFile(log, 'utf8').catch(() => error.message), { cause: error });
  }

  function connection(name) {
    const client = spawn(bin('psql'), ['-XqAtw', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
      '-p', port, '-U', 'postgres', '-d', 'postgres'], {
      env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGAPPNAME: name, PGPASSWORD: password,
        PGOPTIONS: '-c statement_timeout=20000 -c idle_in_transaction_session_timeout=20000' },
      windowsHide: true, stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    client.stdout.on('data', (chunk) => { stdout += chunk; });
    client.stderr.on('data', (chunk) => { stderr += chunk; });
    const result = new Promise((resolve, reject) => {
      client.on('error', reject);
      client.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    });
    return { client, result };
  }
  async function query(sql) {
    const monitor = connection('monitor');
    monitor.client.stdin.end(sql + '\n');
    const { code, stdout, stderr } = await monitor.result;
    assert.equal(code, 0, stderr);
    return stdout;
  }
  async function waitFor(sql) {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (await query(sql) === 't') return;
      await delay(30);
    }
    assert.fail('No se alcanzó la condición SQL: ' + sql);
  }
  await query((await databaseSetupSql()).join('\n'));
  const parent = await query(`select id from app.categories where owner_id='${users.a}' limit 1;`);
  const auth = `set role authenticated;
    set request.jwt.claims = '{"sub":"${users.a}","session_id":"${sessions.a}"}';`;
  const scenarios = [
    { name: 'misma huella devuelve un replay al confirmar', commit: true, amount: '30.00', replayed: true },
    { name: 'otra huella da conflicto al confirmar', commit: true, amount: '40.00', conflict: true },
    { name: 'reserva revertida deja que el segundo envío persista', commit: false, amount: '40.00', replayed: false },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const id = randomUUID();
      const submit = (amount) => `select api.create_expense('${id}','${amount}','UYU','2024-02-29','${parent}');`;
      const first = connection('first_submission');
      let second;
      try {
        first.client.stdin.write(auth + '\nbegin;\n' + submit('30') + '\n');
        await waitFor("select exists(select 1 from pg_stat_activity where application_name='first_submission' and state='idle in transaction' and query like '%api.create_expense%');");
        second = connection('second_submission');
        second.client.stdin.end(auth + '\n' + submit(scenario.amount) + '\n');
        // Prove the second backend is waiting on the first, before releasing its transaction.
        await waitFor(`select exists(select 1 from pg_stat_activity a, pg_stat_activity b
          where a.application_name='first_submission' and b.application_name='second_submission'
            and a.pid = any(pg_blocking_pids(b.pid)));`);
        first.client.stdin.end(scenario.commit ? 'commit;\n' : 'rollback;\n');
        const [winner, retry] = await Promise.all([first.result, second.result]);
        assert.equal(winner.code, 0, winner.stderr);
        assert.equal(JSON.parse(winner.stdout).replayed, false);
        if (scenario.conflict) {
          assert.notEqual(retry.code, 0);
          assert.match(retry.stderr, /ID_REUSED/);
        } else {
          assert.equal(retry.code, 0, retry.stderr);
          assert.equal(JSON.parse(retry.stdout).replayed, scenario.replayed);
        }
        assert.equal(await query(`select count(*) || ':' || min(amount)::text from app.expenses where id='${id}';`),
          '1:' + (scenario.commit ? '30.00' : scenario.amount));
        assert.equal(await query(`select count(*) from app.expense_keys where id='${id}';`), '1');
      } finally {
        first.client.kill();
        second?.client.kill();
      }
    });
  }
});
