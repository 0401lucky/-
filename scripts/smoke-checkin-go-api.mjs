import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const baseURL = 'http://127.0.0.1:8080';
const origin = process.env.CHECKIN_GO_API_ORIGIN || baseURL;
const testUserID = Number(process.env.CHECKIN_SMOKE_USER_ID || 999946);
const testUsername = `checkin_smoke_${testUserID}`;
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const cookie = makeSessionCookie(testUserID, testUsername, 'Checkin Smoke');

function fail(message) {
  throw new Error(`checkin Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `checkin-smoke-${userID}-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayCheckinRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => line.includes('/api/checkin'));
  const expectedRules = [
    'handle /api/checkin {',
    'handle /api/checkin/makeup {',
  ];
  const missingRules = expectedRules.filter((rule) => !activeRules.includes(rule));
  const unexpectedRules = activeRules.filter((rule) => !expectedRules.includes(rule));
  if (missingRules.length > 0 || unexpectedRules.length > 0) {
    fail(`gateway/Caddyfile checkin exact rules mismatch: missing=${missingRules.join('; ')} unexpected=${unexpectedRules.join('; ')}`);
  }
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

function request(method, path, payload = null, requestCookie = cookie) {
  const body = payload == null ? '' : JSON.stringify(payload);
  const args = ['compose', 'exec', '-T', 'api', 'wget', '-S', '-O', '-'];
  if (requestCookie) {
    args.push('--header', `Cookie: ${requestCookie}`);
  }
  if (method !== 'GET') {
    args.push('--header', `Origin: ${origin}`);
    args.push('--header', 'Content-Type: application/json');
    args.push('--post-data', body);
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

function apiRequest(method, path, payload = null) {
  const response = request(method, path, payload);
  assertStatus(response, 200, `${method} ${path}`);
  return parseJSON(response.body, `${method} ${path}`);
}

function cleanup() {
  psql(`
    DELETE FROM checkin_records WHERE user_id = ${testUserID};
    DELETE FROM point_ledger WHERE user_id = ${testUserID};
    DELETE FROM user_assets WHERE user_id = ${testUserID};
    DELETE FROM point_accounts WHERE user_id = ${testUserID};
    DELETE FROM users WHERE id = ${testUserID};
  `);
}

function seedUser() {
  cleanup();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES (${testUserID}, ${sqlLiteral(testUsername)}, 'Checkin Smoke', now(), now());
    INSERT INTO point_accounts (user_id, balance, updated_at)
    VALUES (${testUserID}, 0, now());
    INSERT INTO user_assets (user_id, extra_spins, card_draws, makeup_cards, updated_at)
    VALUES (${testUserID}, 0, 0, 1, now());
  `);
}

function chinaDateKey(offsetDays = 0) {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function weekdayMon0(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const dayValue = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (dayValue + 6) % 7;
}

function verifyStatusPayload(payload, label) {
  if (
    typeof payload.checkedIn !== 'boolean' ||
    typeof payload.extraSpins !== 'number' ||
    typeof payload.dailyFreeAvailable !== 'boolean' ||
    typeof payload.makeupCards !== 'number' ||
    !Array.isArray(payload.history) ||
    !payload.weekStatus ||
    typeof payload.weekStatus.previewPoints !== 'number' ||
    typeof payload.weekStatus.previewSpins !== 'number'
  ) {
    fail(`${label} payload shape mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function verifyCheckinResult(payload) {
  if (
    !payload.success ||
    typeof payload.pointsAwarded !== 'number' ||
    typeof payload.pointsBalance !== 'number' ||
    typeof payload.extraSpinsAwarded !== 'number' ||
    typeof payload.extraSpins !== 'number' ||
    typeof payload.weekBroken !== 'boolean' ||
    typeof payload.weekdayLabel !== 'string'
  ) {
    fail(`checkin result shape mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function verifyMakeupResult(payload, targetDate) {
  if (
    !payload.success ||
    payload.date !== targetDate ||
    typeof payload.pointsAwarded !== 'number' ||
    typeof payload.pointsBalance !== 'number' ||
    typeof payload.extraSpinsAwarded !== 'number' ||
    typeof payload.extraSpins !== 'number' ||
    typeof payload.makeupCards !== 'number' ||
    !Array.isArray(payload.stillMissing)
  ) {
    fail(`makeup result shape mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function verifyDatabaseState(expectedRecords) {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'users', (SELECT count(*) FROM users WHERE id = ${testUserID}),
      'accounts', (SELECT count(*) FROM point_accounts WHERE user_id = ${testUserID}),
      'assets', (SELECT count(*) FROM user_assets WHERE user_id = ${testUserID}),
      'records', (SELECT count(*) FROM checkin_records WHERE user_id = ${testUserID}),
      'ledger', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID} AND source = 'checkin_bonus'),
      'balance', COALESCE((SELECT balance FROM point_accounts WHERE user_id = ${testUserID}), 0),
      'extraSpins', COALESCE((SELECT extra_spins FROM user_assets WHERE user_id = ${testUserID}), 0),
      'makeupCards', COALESCE((SELECT makeup_cards FROM user_assets WHERE user_id = ${testUserID}), 0)
    )::text;
  `), 'checkin database state');
  if (
    result.users !== 1 ||
    result.accounts !== 1 ||
    result.assets !== 1 ||
    result.records !== expectedRecords ||
    result.ledger !== expectedRecords ||
    result.balance <= 0 ||
    result.extraSpins < expectedRecords
  ) {
    fail(`checkin database verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function verifyCleanup() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'users', (SELECT count(*) FROM users WHERE id = ${testUserID}),
      'accounts', (SELECT count(*) FROM point_accounts WHERE user_id = ${testUserID}),
      'assets', (SELECT count(*) FROM user_assets WHERE user_id = ${testUserID}),
      'records', (SELECT count(*) FROM checkin_records WHERE user_id = ${testUserID}),
      'ledger', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID})
    )::text;
  `), 'checkin cleanup verification');
  if (result.users !== 0 || result.accounts !== 0 || result.assets !== 0 || result.records !== 0 || result.ledger !== 0) {
    fail(`checkin cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  assertGatewayCheckinRulesExact();

  const ready = request('GET', '/readyz');
  assertStatus(ready, 200, 'GET /readyz');

  let databaseState = null;
  let cleanupResult = null;
  const checkedPaths = [
    'GET /api/checkin',
    'POST /api/checkin',
    'POST /api/checkin/makeup',
  ];
  try {
    seedUser();

    assertStatus(request('GET', '/api/checkin', null, ''), 401, 'GET /api/checkin without login');
    assertStatus(request('POST', '/api/checkin', {}, ''), 401, 'POST /api/checkin without login');
    assertStatus(request('POST', '/api/checkin/makeup', { date: chinaDateKey(-1) }, ''), 401, 'POST /api/checkin/makeup without login');

    verifyStatusPayload(apiRequest('GET', '/api/checkin'), 'GET /api/checkin before daily checkin');

    const checkin = apiRequest('POST', '/api/checkin', {});
    verifyCheckinResult(checkin);

    const duplicate = request('POST', '/api/checkin', {});
    assertStatus(duplicate, 400, 'duplicate POST /api/checkin');

    let expectedRecords = 1;
    const today = chinaDateKey(0);
    if (weekdayMon0(today) > 0) {
      const targetDate = chinaDateKey(-1);
      const makeup = apiRequest('POST', '/api/checkin/makeup', { date: targetDate });
      verifyMakeupResult(makeup, targetDate);
      expectedRecords = 2;
    } else {
      const invalidMakeup = request('POST', '/api/checkin/makeup', { date: today });
      assertStatus(invalidMakeup, 400, 'POST /api/checkin/makeup today');
    }

    verifyStatusPayload(apiRequest('GET', '/api/checkin'), 'GET /api/checkin after write');
    databaseState = verifyDatabaseState(expectedRecords);
  } finally {
    cleanup();
    cleanupResult = verifyCleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres',
    baseURL,
    testUserID,
    checkedPaths,
    databaseState,
    cleanup: cleanupResult,
    gatewayCheckinRules: 'enabled-exact',
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`checkin Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
