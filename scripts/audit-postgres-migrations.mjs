import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const migrationsDir = path.join('backend', 'migrations');
const backendDockerfilePath = path.join('backend', 'Dockerfile');
const migrateCommandPath = path.join('backend', 'cmd', 'migrate', 'main.go');
const runnerPath = path.join('backend', 'internal', 'migration', 'postgres', 'runner.go');
const runbookPath = path.join('docs', 'zeabur-deployment-runbook.md');

const requiredFiles = [
  backendDockerfilePath,
  migrateCommandPath,
  runnerPath,
  runbookPath,
];

const missingFiles = requiredFiles.filter((file) => !existsSync(file));
const invalid = [];
const missingSnippets = [];

if (!existsSync(migrationsDir) || !statSync(migrationsDir).isDirectory()) {
  missingFiles.push(migrationsDir);
}

const migrationFiles = existsSync(migrationsDir)
  ? readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  : [];

if (migrationFiles.length === 0) {
  invalid.push('backend/migrations must contain sql files');
}

const seenVersions = new Set();
const versions = [];
for (const file of migrationFiles) {
  const match = file.match(/^(\d{4})_[a-z0-9_]+\.sql$/);
  if (!match) {
    invalid.push(`${file} must match 0001_name.sql`);
    continue;
  }
  const version = Number(match[1]);
  if (seenVersions.has(version)) {
    invalid.push(`${file} duplicates version ${match[1]}`);
  }
  seenVersions.add(version);
  versions.push({ version, file });

  const content = readFileSync(path.join(migrationsDir, file), 'utf8');
  if (!content.includes('-- +goose Up')) {
    invalid.push(`${file} must include -- +goose Up`);
  }
  const upSQL = content
    .split('-- +goose Up')[1]
    ?.split('-- +goose Down')[0]
    ?.trim();
  if (!upSQL || !/[A-Za-z]/.test(upSQL)) {
    invalid.push(`${file} must include non-empty Up SQL`);
  }
}

const sortedVersions = [...versions].sort((a, b) => a.version - b.version);
sortedVersions.forEach(({ version, file }, index) => {
  const expected = index + 1;
  if (version !== expected) {
    invalid.push(`${file} has version ${String(version).padStart(4, '0')}, expected ${String(expected).padStart(4, '0')}`);
  }
});

function requireSnippets(file, snippets) {
  if (!existsSync(file)) {
    return;
  }
  const content = readFileSync(file, 'utf8');
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      missingSnippets.push({ file, snippet });
    }
  }
}

requireSnippets(backendDockerfilePath, [
  '-o /out/migrate ./cmd/migrate',
  'COPY --from=builder /out/migrate /app/migrate',
  'COPY migrations /app/migrations',
]);
requireSnippets(migrateCommandPath, [
  'flag.Bool("dry-run"',
  'DATABASE_URL is required',
  'defaultMigrationsDir()',
  '"/app/migrations"',
]);
requireSnippets(runnerPath, [
  'CREATE TABLE IF NOT EXISTS schema_migrations',
  'INSERT INTO schema_migrations',
  'extractUpSQL',
  'sort.Strings(files)',
]);
requireSnippets(runbookPath, [
  'docker compose exec -T api /app/migrate',
  'node scripts/audit-postgres-migrations.mjs',
]);

if (missingFiles.length > 0 || invalid.length > 0 || missingSnippets.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'postgres-migrations-audit',
    missingFiles,
    invalid,
    missingSnippets,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'postgres-migrations-audit',
  checkedMigrations: migrationFiles.length,
  firstMigration: migrationFiles[0],
  latestMigration: migrationFiles[migrationFiles.length - 1],
  checkedFiles: requiredFiles.length + 1,
}, null, 2));
