import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const baseURL = 'http://127.0.0.1:8080';
const testUserID = Number(process.env.AUTH_LOGOUT_SMOKE_USER_ID || 999962);
const testUsername = `auth_logout_smoke_${testUserID}`;
const sessionSecret = process.env.AUTH_LOGOUT_SMOKE_SESSION_SECRET || 'local-development-session-secret-at-least-32-chars';

function fail(message) {
  throw new Error(`auth/logout Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `auth-logout-smoke-${userID}-${now}`,
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

function request(method, path, cookie = '') {
  const args = [
    'compose',
    'exec',
    '-T',
    'api',
    'wget',
    '-S',
    '-O',
    '-',
    '--header',
    'Origin: http://127.0.0.1:8080',
  ];
  if (cookie) {
    args.push('--header', `Cookie: ${cookie}`);
  }
  if (method !== 'GET') {
    args.push('--post-data', '');
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
    DELETE FROM user_profiles WHERE user_id = ${testUserID};
    DELETE FROM admin_alert_point_baselines WHERE user_id = ${testUserID};
    DELETE FROM point_accounts WHERE user_id = ${testUserID};
    DELETE FROM users WHERE id = ${testUserID};
  `);
}

function main() {
  assertGatewayAuthRulesExact();
  const cookie = makeSessionCookie(testUserID, testUsername, 'Auth Logout Smoke');

  try {
    cleanup();

    const meBefore = request('GET', '/api/auth/me', cookie);
    assertStatus(meBefore, 200, 'GET /api/auth/me before logout');
    const mePayload = parseJSON(meBefore.body, 'GET /api/auth/me before logout');
    if (!mePayload.success || mePayload.user?.id !== testUserID) {
      fail(`unexpected auth/me payload before logout: ${meBefore.body.slice(0, 500)}`);
    }

    const logout = request('POST', '/api/auth/logout', cookie);
    assertStatus(logout, 200, 'POST /api/auth/logout');
    const logoutPayload = parseJSON(logout.body, 'POST /api/auth/logout');
    if (!logoutPayload.success) {
      fail(`unexpected logout payload: ${logout.body.slice(0, 500)}`);
    }
    for (const name of ['app_session', 'session', 'new_api_session']) {
      if (!logout.raw.includes(`${name}=`)) {
        fail(`logout response did not clear ${name}`);
      }
    }

    const meAfter = request('GET', '/api/auth/me', cookie);
    assertStatus(meAfter, 401, 'GET /api/auth/me after logout with old cookie');
  } finally {
    cleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres-redis',
    checkedPaths: ['GET /api/auth/me', 'POST /api/auth/logout'],
    testUserID,
    gatewayAuthRules: 'enabled-exact',
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`auth/logout Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
