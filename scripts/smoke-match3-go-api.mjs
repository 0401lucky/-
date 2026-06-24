import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const baseURL = 'http://127.0.0.1:8080';
const origin = process.env.MATCH3_GO_API_ORIGIN || baseURL;
const testUserID = Number(process.env.MATCH3_SMOKE_USER_ID || 999918);
const testUsername = `match3_smoke_${testUserID}`;
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const cookie = makeSessionCookie(testUserID, testUsername, 'Match3 Smoke');
const fixedSeed = 'seed-for-test';

function fail(message) {
  throw new Error(`match3 Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `match3-smoke-${userID}-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayMatch3RulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  const match3Rules = activeRules.filter((line) => line.includes('/api/games/match3'));
  const allowed = new Set([
    'handle /api/games/match3/status {',
    'handle /api/games/match3/start {',
    'handle /api/games/match3/submit {',
    'handle /api/games/match3/cancel {',
  ]);
  const forbidden = activeRules.filter((line) =>
    line === 'handle /api/games/* {' ||
    line === 'handle /api/games/match3* {' ||
    line === 'handle /api/games/match3/* {'
  );
  const unexpected = match3Rules.filter((line) => !allowed.has(line));
  if (unexpected.length > 0 || forbidden.length > 0) {
    fail(`gateway/Caddyfile contains unexpected match3 rules: ${[...unexpected, ...forbidden].join('; ')}`);
  }
  for (const line of allowed) {
    if (!match3Rules.includes(line)) {
      fail(`gateway/Caddyfile missing match3 rule: ${line}`);
    }
  }
  return match3Rules;
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

function apiRequest(method, path, payload = null, requestCookie = cookie) {
  const response = request(method, path, payload, requestCookie);
  assertStatus(response, 200, `${method} ${path}`);
  const parsed = parseJSON(response.body, `${method} ${path}`);
  if (!parsed.success) {
    fail(`${method} ${path} returned success=false: ${response.body.slice(0, 500)}`);
  }
  return parsed;
}

function cleanup() {
  psql(`
    DELETE FROM game_cooldowns WHERE user_id = ${testUserID} AND game_type = 'match3';
    DELETE FROM active_game_sessions WHERE user_id = ${testUserID} AND game_type = 'match3';
    DELETE FROM game_sessions WHERE user_id = ${testUserID} AND game_type = 'match3';
    DELETE FROM game_records WHERE user_id = ${testUserID} AND game_type = 'match3';
    DELETE FROM game_daily_stats WHERE user_id = ${testUserID};
    DELETE FROM daily_game_points WHERE user_id = ${testUserID};
    DELETE FROM point_ledger WHERE user_id = ${testUserID};
    DELETE FROM point_accounts WHERE user_id = ${testUserID};
    DELETE FROM users WHERE id = ${testUserID};
  `);
}

function seedUser() {
  cleanup();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES (${testUserID}, ${sqlLiteral(testUsername)}, 'Match3 Smoke', now(), now());
    INSERT INTO point_accounts (user_id, balance, updated_at)
    VALUES (${testUserID}, 0, now());
  `);
}

function deleteCooldown() {
  psql(`DELETE FROM game_cooldowns WHERE user_id = ${testUserID} AND game_type = 'match3';`);
}

function loadSession(sessionID) {
  return parseJSON(psql(`
    SELECT payload::text
      FROM game_sessions
     WHERE id = ${sqlLiteral(sessionID)}
       AND user_id = ${testUserID}
       AND game_type = 'match3';
  `), `match3 session ${sessionID}`);
}

function prepareFixedSession(sessionID) {
  const session = loadSession(sessionID);
  const startedAt = Date.now() - 11000;
  const expiresAt = Date.now() + 300000;
  const adjusted = {
    ...session,
    seed: fixedSeed,
    startedAt,
    expiresAt,
  };
  psql(`
    UPDATE game_sessions
       SET payload = ${sqlLiteral(JSON.stringify(adjusted))}::jsonb,
           started_at = to_timestamp(${startedAt}::double precision / 1000),
           expires_at = to_timestamp(${expiresAt}::double precision / 1000),
           updated_at = now()
     WHERE id = ${sqlLiteral(sessionID)}
       AND user_id = ${testUserID}
       AND game_type = 'match3';
    UPDATE active_game_sessions
       SET expires_at = to_timestamp(${expiresAt}::double precision / 1000)
     WHERE user_id = ${testUserID}
       AND game_type = 'match3'
       AND session_id = ${sqlLiteral(sessionID)};
  `);
  return adjusted;
}

function verifyStartPayload(payload) {
  if (
    !payload.data ||
    !payload.data.sessionId ||
    typeof payload.data.seed !== 'string' ||
    !payload.data.config ||
    payload.data.config.rows !== 8 ||
    payload.data.config.cols !== 8 ||
    payload.data.config.types !== 6 ||
    typeof payload.data.timeLimitMs !== 'number' ||
    typeof payload.data.startedAt !== 'number' ||
    typeof payload.data.expiresAt !== 'number'
  ) {
    fail(`start payload shape mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function verifyStatusPayload(payload, label) {
  if (!payload.data || typeof payload.data.balance !== 'number' || !payload.data.dailyStats || !('activeSession' in payload.data)) {
    fail(`${label} status shape mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function verifySubmitPayload(payload) {
  const record = payload.data?.record;
  if (
    !record ||
    payload.data.pointsEarned !== 2 ||
    record.score !== 27 ||
    record.pointsEarned !== 2 ||
    record.moves !== 1 ||
    record.cascades !== 2 ||
    record.tilesCleared !== 6 ||
    typeof record.duration !== 'number' ||
    typeof record.createdAt !== 'number'
  ) {
    fail(`submit payload mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function verifySettlement(sessionID) {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'balance', (SELECT balance FROM point_accounts WHERE user_id = ${testUserID}),
      'records', (SELECT count(*) FROM game_records WHERE user_id = ${testUserID} AND game_type = 'match3' AND session_id = ${sqlLiteral(sessionID)}),
      'record_points', COALESCE((SELECT points_earned FROM game_records WHERE user_id = ${testUserID} AND game_type = 'match3' AND session_id = ${sqlLiteral(sessionID)} LIMIT 1), 0),
      'record_score', COALESCE((SELECT score FROM game_records WHERE user_id = ${testUserID} AND game_type = 'match3' AND session_id = ${sqlLiteral(sessionID)} LIMIT 1), 0),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID} AND source = 'game_play'),
      'daily_game_points', COALESCE((SELECT earned_points FROM daily_game_points WHERE user_id = ${testUserID} AND stat_date = (now() AT TIME ZONE 'Asia/Shanghai')::date), 0),
      'daily_stats_games', COALESCE((SELECT games_played FROM game_daily_stats WHERE user_id = ${testUserID} AND stat_date = (now() AT TIME ZONE 'Asia/Shanghai')::date), 0),
      'daily_stats_points', COALESCE((SELECT points_earned FROM game_daily_stats WHERE user_id = ${testUserID} AND stat_date = (now() AT TIME ZONE 'Asia/Shanghai')::date), 0),
      'active_sessions', (SELECT count(*) FROM active_game_sessions WHERE user_id = ${testUserID} AND game_type = 'match3'),
      'sessions', (SELECT count(*) FROM game_sessions WHERE user_id = ${testUserID} AND game_type = 'match3')
    )::text;
  `), 'match3 settlement verification');
  if (
    result.balance !== 2 ||
    result.records !== 1 ||
    result.record_points !== 2 ||
    result.record_score !== 27 ||
    result.ledger_count !== 1 ||
    result.daily_game_points !== 2 ||
    result.daily_stats_games !== 1 ||
    result.daily_stats_points !== 2 ||
    result.active_sessions !== 0 ||
    result.sessions !== 0
  ) {
    fail(`match3 settlement verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function verifyCleanup() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'users', (SELECT count(*) FROM users WHERE id = ${testUserID}),
      'accounts', (SELECT count(*) FROM point_accounts WHERE user_id = ${testUserID}),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID}),
      'daily_game_points', (SELECT count(*) FROM daily_game_points WHERE user_id = ${testUserID}),
      'game_daily_stats', (SELECT count(*) FROM game_daily_stats WHERE user_id = ${testUserID}),
      'records', (SELECT count(*) FROM game_records WHERE user_id = ${testUserID} AND game_type = 'match3'),
      'sessions', (SELECT count(*) FROM game_sessions WHERE user_id = ${testUserID} AND game_type = 'match3'),
      'active_sessions', (SELECT count(*) FROM active_game_sessions WHERE user_id = ${testUserID} AND game_type = 'match3'),
      'cooldowns', (SELECT count(*) FROM game_cooldowns WHERE user_id = ${testUserID} AND game_type = 'match3')
    )::text;
  `), 'match3 cleanup verification');
  if (
    result.users !== 0 ||
    result.accounts !== 0 ||
    result.ledger_count !== 0 ||
    result.daily_game_points !== 0 ||
    result.game_daily_stats !== 0 ||
    result.records !== 0 ||
    result.sessions !== 0 ||
    result.active_sessions !== 0 ||
    result.cooldowns !== 0
  ) {
    fail(`match3 cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  const gatewayMatch3Rules = assertGatewayMatch3RulesExact();
  const ready = request('GET', '/readyz');
  assertStatus(ready, 200, 'GET /readyz');

  let settlement = null;
  let cleanupResult = null;
  try {
    seedUser();

    assertStatus(request('GET', '/api/games/match3/status', null, ''), 401, 'GET /api/games/match3/status without login');
    assertStatus(request('POST', '/api/games/match3/start', {}, ''), 401, 'POST /api/games/match3/start without login');
    verifyStatusPayload(apiRequest('GET', '/api/games/match3/status'), 'GET /api/games/match3/status');

    const cancelStart = apiRequest('POST', '/api/games/match3/start', {});
    verifyStartPayload(cancelStart);
    apiRequest('POST', '/api/games/match3/cancel');
    const afterCancel = apiRequest('GET', '/api/games/match3/status');
    if (afterCancel.data.activeSession !== null) {
      fail(`cancel did not clear active session: ${JSON.stringify(afterCancel).slice(0, 500)}`);
    }
    deleteCooldown();

    const start = apiRequest('POST', '/api/games/match3/start', {});
    verifyStartPayload(start);
    const sessionID = start.data.sessionId;
    prepareFixedSession(sessionID);

    const submitBody = { sessionId: sessionID, moves: [{ from: 4, to: 12 }] };
    const submit = apiRequest('POST', '/api/games/match3/submit', submitBody);
    verifySubmitPayload(submit);
    assertStatus(request('POST', '/api/games/match3/submit', submitBody), 400, 'duplicate POST /api/games/match3/submit');
    settlement = verifySettlement(sessionID);
  } finally {
    cleanup();
    cleanupResult = verifyCleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres',
    baseURL,
    testUserID,
    checkedMatch3Paths: [
      'GET /api/games/match3/status',
      'POST /api/games/match3/start',
      'POST /api/games/match3/submit',
      'POST /api/games/match3/cancel',
    ],
    settlement,
    cleanup: cleanupResult,
    gatewayMatch3Rules,
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`match3 Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
