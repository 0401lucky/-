import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const migrationsDir = path.join('backend', 'migrations');

function run(command, args, input = '') {
  const result = spawnSync(command, args, {
    input,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 4,
  });
  if (result.status !== 0) {
    return {
      ok: false,
      status: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  }
  return {
    ok: true,
    stdout: result.stdout.trim(),
  };
}

function expectedMigrations() {
  if (!existsSync(migrationsDir)) {
    return [];
  }
  return readdirSync(migrationsDir)
    .filter((file) => /^(\d{4})_[a-z0-9_]+\.sql$/.test(file))
    .sort();
}

const expected = expectedMigrations();
const tableCheck = run('docker', [
  'compose',
  'exec',
  '-T',
  'postgres',
  'psql',
  '-U',
  'app',
  '-d',
  'app',
  '-t',
  '-A',
  '-c',
  "SELECT to_regclass('public.schema_migrations') IS NOT NULL;",
]);

if (!tableCheck.ok) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'postgres-live-schema-audit',
    reason: 'failed to query schema_migrations table state',
    command: 'docker compose exec -T postgres psql -U app -d app',
    result: tableCheck,
  }, null, 2));
  process.exit(1);
}

if (tableCheck.stdout !== 't') {
  console.error(JSON.stringify({
    ok: false,
    mode: 'postgres-live-schema-audit',
    reason: 'schema_migrations table is missing; run /app/migrate before deployment smoke',
  }, null, 2));
  process.exit(1);
}

const appliedQuery = run('docker', [
  'compose',
  'exec',
  '-T',
  'postgres',
  'psql',
  '-U',
  'app',
  '-d',
  'app',
  '-t',
  '-A',
  '-c',
  'SELECT version FROM schema_migrations ORDER BY version;',
]);

if (!appliedQuery.ok) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'postgres-live-schema-audit',
    reason: 'failed to read applied schema migrations',
    result: appliedQuery,
  }, null, 2));
  process.exit(1);
}

const applied = appliedQuery.stdout
  ? appliedQuery.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  : [];

const expectedSet = new Set(expected);
const appliedSet = new Set(applied);
const missingAppliedMigrations = expected.filter((migration) => !appliedSet.has(migration));
const unexpectedAppliedMigrations = applied.filter((migration) => !expectedSet.has(migration));

if (expected.length === 0 || missingAppliedMigrations.length > 0 || unexpectedAppliedMigrations.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'postgres-live-schema-audit',
    expectedMigrations: expected.length,
    appliedMigrations: applied.length,
    missingAppliedMigrations,
    unexpectedAppliedMigrations,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'postgres-live-schema-audit',
  checkedDatabase: 'docker-compose:postgres/app',
  expectedMigrations: expected.length,
  appliedMigrations: applied.length,
  latestMigration: expected[expected.length - 1],
}, null, 2));
