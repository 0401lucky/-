import { spawnSync } from 'node:child_process';

const minUserID = Number(process.env.SMOKE_RESIDUE_MIN_USER_ID || 999900);
const maxUserID = Number(process.env.SMOKE_RESIDUE_MAX_USER_ID || 999999);

function runPsql(sql) {
  const result = spawnSync('docker', [
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
    '-F',
    '\t',
    '-c',
    sql,
  ], {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 8,
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

if (!Number.isInteger(minUserID) || !Number.isInteger(maxUserID) || minUserID > maxUserID) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'postgres-smoke-residue-audit',
    reason: 'invalid smoke residue user id range',
    minUserID,
    maxUserID,
  }, null, 2));
  process.exit(1);
}

const tableQuery = `
WITH candidate_columns AS (
  SELECT table_schema, table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (
      column_name IN ('user_id', 'owner_user_id', 'thief_user_id', 'original_user_id')
      OR (table_name = 'users' AND column_name = 'id')
    )
)
SELECT table_schema, table_name, column_name
FROM candidate_columns
ORDER BY table_name, column_name;
`;

const tableResult = runPsql(tableQuery);
if (!tableResult.ok) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'postgres-smoke-residue-audit',
    reason: 'failed to list user id columns',
    result: tableResult,
  }, null, 2));
  process.exit(1);
}

const columns = tableResult.stdout
  ? tableResult.stdout.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [schema, table, column] = line.split('\t');
        return { schema, table, column };
      })
  : [];

if (columns.length === 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'postgres-smoke-residue-audit',
    reason: 'no user id columns found in public schema',
  }, null, 2));
  process.exit(1);
}

const unionQuery = columns.map(({ schema, table, column }) => {
  const qualified = `"${schema.replaceAll('"', '""')}"."${table.replaceAll('"', '""')}"`;
  const quotedColumn = `"${column.replaceAll('"', '""')}"`;
  return `SELECT '${table.replaceAll("'", "''")}' AS table_name, '${column.replaceAll("'", "''")}' AS column_name, count(*)::bigint AS rows FROM ${qualified} WHERE ${quotedColumn} BETWEEN ${minUserID} AND ${maxUserID}`;
}).join(' UNION ALL ');

const residueResult = runPsql(unionQuery);
if (!residueResult.ok) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'postgres-smoke-residue-audit',
    reason: 'failed to count smoke user residue',
    result: residueResult,
  }, null, 2));
  process.exit(1);
}

const checks = residueResult.stdout
  ? residueResult.stdout.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [tableName, columnName, rows] = line.split('\t');
        return {
          tableName,
          columnName,
          rows: Number(rows),
        };
      })
  : [];

const residues = checks.filter((check) => check.rows > 0);
if (residues.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'postgres-smoke-residue-audit',
    checkedDatabase: 'docker-compose:postgres/app',
    userIDRange: [minUserID, maxUserID],
    checkedColumns: checks.length,
    residues,
    note: '本地冒烟测试用户残留会污染后续导入/切流判断，请先清理对应测试数据后再复跑。',
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'postgres-smoke-residue-audit',
  checkedDatabase: 'docker-compose:postgres/app',
  userIDRange: [minUserID, maxUserID],
  checkedColumns: checks.length,
  residueRows: 0,
}, null, 2));
