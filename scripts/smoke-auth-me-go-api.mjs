import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const baseURL = 'http://127.0.0.1:8080';
const testUserID = Number(process.env.AUTH_ME_SMOKE_USER_ID || 999961);
const testUsername = `auth_me_smoke_${testUserID}`;
const sessionSecret = process.env.AUTH_ME_SMOKE_SESSION_SECRET || 'local-development-session-secret-at-least-32-chars';

function fail(message) {
  throw new Error(`auth/me Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `auth-me-smoke-${userID}-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayAuthRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => line.includes('/api/auth'));
  const expectedRules = ['handle /api/auth/login {', 'handle /api/auth/me {', 'handle /api/auth/logout {'];
  const missing = expectedRules.filter((line) => !activeRules.includes(line));
  const unexpected = activeRules.filter((line) => !expectedRules.includes(line));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(`gateway/Caddyfile auth rules mismatch: missing=${missing.join('; ')} unexpected=${unexpected.join('; ')}`);
  }
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

function request(path, cookie = '') {
  const args = ['compose', 'exec', '-T', 'api', 'wget', '-S', '-O', '-'];
  if (cookie) {
    args.push('--header', `Cookie: ${cookie}`);
  }
  args.push(`${baseURL}${path}`);
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  return {
    status: parseStatus(`${result.stderr}\n${result.stdout}`),
    body: result.stdout,
    raw: `${result.stderr}\n${result.stdout}`,
  };
}

function parseJSON(body, label) {
  try {
    return JSON.parse(body);
  } catch {
    fail(`${label} did not return JSON: ${body.slice(0, 300)}`);
  }
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    fail(`${label} expected HTTP ${expected}, got ${response.status}; raw=${response.raw.slice(0, 500)}`);
  }
}

function cleanup() {
  psql(`
    DELETE FROM user_assets WHERE user_id = ${testUserID};
    DELETE FROM point_accounts WHERE user_id = ${testUserID};
    DELETE FROM users WHERE id = ${testUserID};
  `);
}

function readSyncedUser() {
  return parseJSON(psql(`
    SELECT json_build_object(
      'users', (SELECT count(*) FROM users WHERE id = ${testUserID}),
      'accounts', (SELECT count(*) FROM point_accounts WHERE user_id = ${testUserID}),
      'assets', (SELECT count(*) FROM user_assets WHERE user_id = ${testUserID}),
      'username', COALESCE((SELECT username FROM users WHERE id = ${testUserID}), ''),
      'displayName', COALESCE((SELECT display_name FROM users WHERE id = ${testUserID}), ''),
      'balance', COALESCE((SELECT balance FROM point_accounts WHERE user_id = ${testUserID}), -1)
    )::text;
  `), 'synced auth user');
}

function verifySyncedUser(expectedDisplayName) {
  const state = readSyncedUser();
  if (
    state.users !== 1 ||
    state.accounts !== 1 ||
    state.assets !== 1 ||
    state.username !== testUsername ||
    state.displayName !== expectedDisplayName ||
    state.balance !== 0
  ) {
    fail(`synced user state mismatch: ${JSON.stringify(state)}`);
  }
  return state;
}

function verifyCleanup() {
  const state = readSyncedUser();
  if (state.users !== 0 || state.accounts !== 0 || state.assets !== 0) {
    fail(`cleanup verification failed: ${JSON.stringify(state)}`);
  }
  return state;
}

function main() {
  assertGatewayAuthRulesExact();

  const ready = request('/readyz');
  assertStatus(ready, 200, 'GET /readyz');

  let firstSync = null;
  let secondSync = null;
  let cleanupState = null;
  try {
    cleanup();

    const unauthenticated = request('/api/auth/me');
    assertStatus(unauthenticated, 401, 'GET /api/auth/me without login');

    const first = request('/api/auth/me', makeSessionCookie(testUserID, testUsername, 'Auth Me Smoke'));
    assertStatus(first, 200, 'GET /api/auth/me with login');
    const firstPayload = parseJSON(first.body, 'GET /api/auth/me first');
    if (!firstPayload.success || firstPayload.user?.id !== testUserID || firstPayload.user?.username !== testUsername) {
      fail(`first auth/me payload mismatch: ${first.body.slice(0, 500)}`);
    }
    firstSync = verifySyncedUser('Auth Me Smoke');

    const second = request('/api/auth/me', makeSessionCookie(testUserID, testUsername, 'Auth Me Smoke Renamed'));
    assertStatus(second, 200, 'GET /api/auth/me second');
    secondSync = verifySyncedUser('Auth Me Smoke Renamed');
  } finally {
    cleanup();
    cleanupState = verifyCleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres',
    checkedPaths: ['GET /api/auth/me'],
    testUserID,
    firstSync,
    secondSync,
    cleanup: cleanupState,
    gatewayAuthRules: 'enabled-exact',
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`auth/me Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
