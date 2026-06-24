import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const baseURL = 'http://127.0.0.1:8080';
const testUserID = Number(process.env.RAFFLE_SMOKE_USER_ID || 999909);
const adminUserID = Number(process.env.RAFFLE_SMOKE_ADMIN_USER_ID || 999910);
const raffleID = process.env.RAFFLE_SMOKE_RAFFLE_ID || 'raffle-smoke-go-api';
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const userCookie = makeSessionCookie(testUserID, `raffle_smoke_${testUserID}`, 'Raffle Smoke');
const adminCookie = makeSessionCookie(adminUserID, 'admin', 'Admin');

function fail(message) {
  throw new Error(`raffle Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `raffle-smoke-${userID}-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayRaffleRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) =>
      line.includes('/api/raffle') ||
      line.includes('/api/admin/raffle') ||
      line.includes('/api/admin/*')
    );
  const allowed = new Set([
    'handle /api/raffle {',
    'handle /api/raffle/* {',
    'handle /api/admin/raffle {',
    'handle /api/admin/raffle/* {',
  ]);
  const unexpected = activeRules.filter((line) => !allowed.has(line));
  if (unexpected.length > 0) {
    fail(`gateway/Caddyfile contains unexpected raffle/admin rules: ${unexpected.join('; ')}`);
  }
  return activeRules;
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

function request(method, path, cookie = '') {
  const args = ['compose', 'exec', '-T', 'api', 'wget', '-S', '-O', '-'];
  if (cookie) {
    args.push('--header', `Cookie: ${cookie}`);
  }
  if (method !== 'GET') {
    args.push('--header', 'Origin: http://127.0.0.1:8080');
    args.push('--header', 'Content-Type: application/json');
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

function apiRequest(method, path, cookie, label = `${method} ${path}`) {
  const response = request(method, path, cookie);
  assertStatus(response, 200, label);
  const payload = parseJSON(response.body, label);
  if (!payload.success) {
    fail(`${label} returned success=false: ${response.body.slice(0, 500)}`);
  }
  return payload;
}

function cleanup() {
  psql(`
    DELETE FROM raffle_delivery_jobs WHERE raffle_id = ${sqlLiteral(raffleID)};
    DELETE FROM user_raffle_wins WHERE raffle_id = ${sqlLiteral(raffleID)};
    DELETE FROM notifications WHERE id LIKE ${sqlLiteral(`raffle_win:%`)};
    DELETE FROM raffle_entries WHERE raffle_id = ${sqlLiteral(raffleID)};
    DELETE FROM raffles WHERE id = ${sqlLiteral(raffleID)};
    DELETE FROM point_ledger WHERE user_id IN (${testUserID}, ${adminUserID});
    DELETE FROM point_accounts WHERE user_id IN (${testUserID}, ${adminUserID});
    DELETE FROM users WHERE id IN (${testUserID}, ${adminUserID});
  `);
}

function seedData() {
  cleanup();
  const nowMs = Date.now();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES
      (${testUserID}, ${sqlLiteral(`raffle_smoke_${testUserID}`)}, 'Raffle Smoke', now(), now()),
      (${adminUserID}, 'admin', 'Admin', now(), now());
    INSERT INTO raffles (
      id, mode, title, description, prizes, trigger_type, threshold, status,
      participants_count, winners_count, winners, created_by, created_at_ms, updated_at_ms
    ) VALUES (
      ${sqlLiteral(raffleID)}, 'draw', 'Raffle Smoke', 'Go API smoke raffle',
      '[{"id":"p1","name":"10积分","points":10,"quantity":1}]'::jsonb,
      'manual', 99, 'active', 0, 0, '[]'::jsonb, ${adminUserID}, ${nowMs}, ${nowMs}
    );
  `);
}

function verifyPublicList(payload) {
  if (!Array.isArray(payload.raffles) || !payload.raffles.some((item) => item.id === raffleID && item.status === 'active')) {
    fail(`public raffle list missing seeded raffle: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function verifyDetail(payload, joined = false) {
  if (!payload.raffle || payload.raffle.id !== raffleID || !Array.isArray(payload.entries)) {
    fail(`raffle detail shape mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  if (joined && (!payload.userStatus || payload.userStatus.hasJoined !== true || !payload.userStatus.entry)) {
    fail(`joined raffle detail missing userStatus: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function verifyDBState() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'participants_count', (SELECT participants_count FROM raffles WHERE id = ${sqlLiteral(raffleID)}),
      'entry_count', (SELECT count(*) FROM raffle_entries WHERE raffle_id = ${sqlLiteral(raffleID)}),
      'user_entry_count', (SELECT count(*) FROM raffle_entries WHERE raffle_id = ${sqlLiteral(raffleID)} AND user_id = ${testUserID})
    )::text;
  `), 'raffle DB verification');
  if (result.participants_count !== 1 || result.entry_count !== 1 || result.user_entry_count !== 1) {
    fail(`raffle DB verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function verifyCleanup() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'raffle_exists', EXISTS(SELECT 1 FROM raffles WHERE id = ${sqlLiteral(raffleID)}),
      'entries', (SELECT count(*) FROM raffle_entries WHERE raffle_id = ${sqlLiteral(raffleID)}),
      'users', (SELECT count(*) FROM users WHERE id IN (${testUserID}, ${adminUserID}))
    )::text;
  `), 'raffle cleanup verification');
  if (result.raffle_exists || result.entries !== 0 || result.users !== 0) {
    fail(`raffle cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  const gatewayRules = assertGatewayRaffleRulesExact();

  const ready = request('GET', '/readyz');
  assertStatus(ready, 200, 'GET /readyz');

  let verification = null;
  let cleanupResult = null;
  try {
    seedData();

    verifyPublicList(apiRequest('GET', '/api/raffle', ''));
    verifyDetail(apiRequest('GET', `/api/raffle/${raffleID}`, ''));

    assertStatus(request('POST', `/api/raffle/${raffleID}/join`), 401, 'POST /api/raffle/{id}/join without login');

    const join = apiRequest('POST', `/api/raffle/${raffleID}/join`, userCookie);
    if (!join.entry || join.entry.userId !== testUserID || join.shouldDraw === true) {
      fail(`unexpected join payload: ${JSON.stringify(join).slice(0, 500)}`);
    }
    assertStatus(request('POST', `/api/raffle/${raffleID}/join`, userCookie), 400, 'POST /api/raffle/{id}/join duplicate');
    verifyDetail(apiRequest('GET', `/api/raffle/${raffleID}`, userCookie), true);

    assertStatus(request('GET', '/api/admin/raffle'), 401, 'GET /api/admin/raffle without login');
    assertStatus(request('GET', '/api/admin/raffle', userCookie), 403, 'GET /api/admin/raffle as non-admin');
    const adminList = apiRequest('GET', '/api/admin/raffle', adminCookie);
    if (!Array.isArray(adminList.raffles) || !adminList.raffles.some((item) => item.id === raffleID)) {
      fail(`admin raffle list missing seeded raffle: ${JSON.stringify(adminList).slice(0, 500)}`);
    }
    const adminDetail = apiRequest('GET', `/api/admin/raffle/${raffleID}`, adminCookie);
    if (!adminDetail.raffle || adminDetail.raffle.id !== raffleID || !Array.isArray(adminDetail.entries)) {
      fail(`admin raffle detail shape mismatch: ${JSON.stringify(adminDetail).slice(0, 500)}`);
    }

    verification = verifyDBState();
  } finally {
    cleanup();
    cleanupResult = verifyCleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres',
    baseURL,
    raffleID,
    testUserID,
    adminUserID,
    checkedPublicPaths: [
      'GET /api/raffle',
      'GET /api/raffle/{id}',
      'POST /api/raffle/{id}/join',
    ],
    checkedAdminPaths: [
      'GET /api/admin/raffle',
      'GET /api/admin/raffle/{id}',
    ],
    verification,
    cleanup: cleanupResult,
    gatewayRaffleRules: gatewayRules,
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`raffle Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
