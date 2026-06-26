import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const baseURL = 'http://127.0.0.1:8080';
const origin = process.env.WALLET_GO_API_ORIGIN || baseURL;
const testUserID = Number(process.env.WALLET_WRITE_SMOKE_USER_ID || 999907);
const testUsername = `wallet_write_smoke_${testUserID}`;
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const cookie = makeSessionCookie(testUserID, testUsername, 'Wallet Write Smoke');

function fail(message) {
  throw new Error(`wallet write missing-newapi Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `wallet-write-smoke-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayWalletRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeWalletRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) =>
      line.includes('/api/store/topup') ||
      line.includes('/api/store/withdraw') ||
      line.includes('/api/store*')
    );
  const allowed = new Set([
    'handle /api/store/topup {',
    'handle /api/store/withdraw {',
  ]);
  const unexpected = activeWalletRules.filter((line) => !allowed.has(line));
  if (unexpected.length > 0) {
    fail(`gateway/Caddyfile contains unexpected wallet cutover rules: ${unexpected.join('; ')}`);
  }
  for (const line of allowed) {
    if (!activeWalletRules.includes(line)) {
      fail(`gateway/Caddyfile missing wallet cutover rule: ${line}`);
    }
  }
  return activeWalletRules;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(sql) {
  const result = spawnSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'app', '-d', 'app', '-v', 'ON_ERROR_STOP=1', '-t', '-A'],
    { input: sql, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    fail(`psql failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function parseStatus(output) {
  const matches = [...output.matchAll(/HTTP\/\d(?:\.\d)?\s+(\d{3})/g)];
  return matches.length ? Number(matches[matches.length - 1][1]) : 0;
}

function shellSingleQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function request(method, path, payload) {
  const body = payload ? JSON.stringify(payload) : '';
  const rawRequest = [
    `${method} ${path} HTTP/1.1`,
    'Host: 127.0.0.1:8080',
    `Cookie: ${cookie}`,
    `Origin: ${origin}`,
    'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Connection: close',
    '',
    body,
  ].join('\r\n');
  const result = spawnSync(
    'docker',
    ['compose', 'exec', '-T', 'api', 'sh', '-lc', `(printf %s ${shellSingleQuote(rawRequest)}; sleep 1) | nc 127.0.0.1 8080`],
    { encoding: 'utf8' },
  );
  const raw = `${result.stdout}\n${result.stderr}`;
  const bodyStart = result.stdout.indexOf('\r\n\r\n');
  return {
    status: parseStatus(raw),
    body: bodyStart >= 0 ? result.stdout.slice(bodyStart + 4) : '',
    raw,
  };
}

function parseJSON(body, label) {
  try {
    return JSON.parse(body);
  } catch {
    fail(`${label} did not return JSON: ${body.slice(0, 300)}`);
  }
}

function seedUser() {
  cleanup();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES (${testUserID}, ${sqlLiteral(testUsername)}, 'Wallet Write Smoke', now(), now());
    INSERT INTO point_accounts (user_id, balance, updated_at)
    VALUES (${testUserID}, 1000, now());
  `);
}

function cleanup() {
  psql(`
    DELETE FROM wallet_transactions WHERE user_id = ${testUserID};
    DELETE FROM point_ledger WHERE user_id = ${testUserID};
    DELETE FROM point_accounts WHERE user_id = ${testUserID};
    DELETE FROM users WHERE id = ${testUserID};
  `);
}

function assertMissingNewAPI(response, label) {
  if (response.status !== 503) {
    fail(`${label} expected HTTP 503, got ${response.status}; raw=${response.raw.slice(0, 500)}`);
  }
  const payload = parseJSON(response.body, label);
  if (payload.success !== false || payload.code !== 'NEW_API_NOT_CONFIGURED') {
    fail(`${label} expected NEW_API_NOT_CONFIGURED, got ${response.body.slice(0, 500)}`);
  }
}

function verifyNoWrites() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'balance', (SELECT balance FROM point_accounts WHERE user_id = ${testUserID}),
      'wallet_transactions', (SELECT count(*) FROM wallet_transactions WHERE user_id = ${testUserID}),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID})
    )::text;
  `), 'wallet no-write verification');
  if (result.balance !== 1000 || result.wallet_transactions !== 0 || result.ledger_count !== 0) {
    fail(`wallet no-write verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function verifyCleanup() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'user_exists', EXISTS(SELECT 1 FROM users WHERE id = ${testUserID}),
      'account_exists', EXISTS(SELECT 1 FROM point_accounts WHERE user_id = ${testUserID}),
      'wallet_transactions', (SELECT count(*) FROM wallet_transactions WHERE user_id = ${testUserID}),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID})
    )::text;
  `), 'wallet cleanup verification');
  if (result.user_exists || result.account_exists || result.wallet_transactions !== 0 || result.ledger_count !== 0) {
    fail(`wallet cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  const gatewayWalletRules = assertGatewayWalletRulesExact();

  const ready = request('GET', '/readyz');
  if (ready.status !== 200) {
    fail(`GET /readyz expected HTTP 200, got ${ready.status}; raw=${ready.raw.slice(0, 500)}`);
  }

  let noWrites = null;
  let cleanupResult = null;
  try {
    seedUser();
    assertMissingNewAPI(request('GET', '/api/store/topup'), 'GET /api/store/topup');
    assertMissingNewAPI(request('POST', '/api/store/topup', { dollars: 1 }), 'POST /api/store/topup');
    assertMissingNewAPI(request('POST', '/api/store/withdraw', { points: 10 }), 'POST /api/store/withdraw');
    noWrites = verifyNoWrites();
  } finally {
    cleanup();
    cleanupResult = verifyCleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres',
    baseURL,
    testUserID,
    checkedAuthenticatedPaths: [
      'GET /api/store/topup',
      'POST /api/store/topup',
      'POST /api/store/withdraw',
    ],
    expectedCode: 'NEW_API_NOT_CONFIGURED',
    verification: noWrites,
    cleanup: cleanupResult,
    gatewayWalletRules,
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`wallet write missing-newapi Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
