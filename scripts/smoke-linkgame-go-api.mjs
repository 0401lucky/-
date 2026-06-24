import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const baseURL = 'http://127.0.0.1:8080';
const origin = process.env.LINKGAME_GO_API_ORIGIN || baseURL;
const testUserID = Number(process.env.LINKGAME_SMOKE_USER_ID || 999921);
const testUsername = `linkgame_smoke_${testUserID}`;
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const cookie = makeSessionCookie(testUserID, testUsername, 'Linkgame Smoke');

function fail(message) {
  throw new Error(`linkgame Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `linkgame-smoke-${userID}-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayLinkgameRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  const linkgameRules = activeRules.filter((line) => line.includes('/api/games/linkgame'));
  const allowed = new Set([
    'handle /api/games/linkgame/status {',
    'handle /api/games/linkgame/start {',
    'handle /api/games/linkgame/submit {',
    'handle /api/games/linkgame/cancel {',
  ]);
  const forbidden = activeRules.filter((line) =>
    line === 'handle /api/games/* {' ||
    line === 'handle /api/games/linkgame* {' ||
    line === 'handle /api/games/linkgame/* {'
  );
  const unexpected = linkgameRules.filter((line) => !allowed.has(line));
  if (unexpected.length > 0 || forbidden.length > 0) {
    fail(`gateway/Caddyfile contains unexpected linkgame rules: ${[...unexpected, ...forbidden].join('; ')}`);
  }
  for (const line of allowed) {
    if (!linkgameRules.includes(line)) {
      fail(`gateway/Caddyfile missing linkgame rule: ${line}`);
    }
  }
  return linkgameRules;
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
    DELETE FROM game_cooldowns WHERE user_id = ${testUserID} AND game_type = 'linkgame';
    DELETE FROM active_game_sessions WHERE user_id = ${testUserID} AND game_type = 'linkgame';
    DELETE FROM game_sessions WHERE user_id = ${testUserID} AND game_type = 'linkgame';
    DELETE FROM game_records WHERE user_id = ${testUserID} AND game_type = 'linkgame';
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
    VALUES (${testUserID}, ${sqlLiteral(testUsername)}, 'Linkgame Smoke', now(), now());
    INSERT INTO point_accounts (user_id, balance, updated_at)
    VALUES (${testUserID}, 0, now());
  `);
}

function deleteCooldown() {
  psql(`DELETE FROM game_cooldowns WHERE user_id = ${testUserID} AND game_type = 'linkgame';`);
}

function loadSession(sessionID) {
  return parseJSON(psql(`
    SELECT payload::text
      FROM game_sessions
     WHERE id = ${sqlLiteral(sessionID)}
       AND user_id = ${testUserID}
       AND game_type = 'linkgame';
  `), `linkgame session ${sessionID}`);
}

function prepareTwoTileSession(sessionID) {
  const session = loadSession(sessionID);
  const startedAt = Date.now() - 6000;
  const expiresAt = Date.now() + 300000;
  const layout = Array.from({ length: 64 }, () => null);
  layout[0] = 'A';
  layout[1] = 'A';
  const adjusted = {
    ...session,
    difficulty: 'easy',
    tileLayout: layout,
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
       AND game_type = 'linkgame';
    UPDATE active_game_sessions
       SET expires_at = to_timestamp(${expiresAt}::double precision / 1000)
     WHERE user_id = ${testUserID}
       AND game_type = 'linkgame'
       AND session_id = ${sqlLiteral(sessionID)};
  `);
  return adjusted;
}

function verifyStartPayload(payload) {
  if (
    !payload.data ||
    !payload.data.sessionId ||
    payload.data.difficulty !== 'easy' ||
    !Array.isArray(payload.data.tileLayout) ||
    payload.data.tileLayout.length !== 64 ||
    typeof payload.data.remainingSeconds !== 'number' ||
    !payload.data.config ||
    payload.data.config.rows !== 8 ||
    payload.data.config.cols !== 8
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
    payload.data.pointsEarned !== 1 ||
    record.difficulty !== 'easy' ||
    record.completed !== true ||
    record.outcome !== 'completed' ||
    record.settlementResult !== 'win' ||
    record.moves !== 1 ||
    record.pointsEarned !== 1 ||
    record.score <= 0 ||
    typeof record.duration !== 'number' ||
    typeof record.createdAt !== 'number'
  ) {
    fail(`submit payload mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  return record;
}

function verifySettlement(sessionID, record) {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'balance', (SELECT balance FROM point_accounts WHERE user_id = ${testUserID}),
      'records', (SELECT count(*) FROM game_records WHERE user_id = ${testUserID} AND game_type = 'linkgame' AND session_id = ${sqlLiteral(sessionID)}),
      'record_points', COALESCE((SELECT points_earned FROM game_records WHERE user_id = ${testUserID} AND game_type = 'linkgame' AND session_id = ${sqlLiteral(sessionID)} LIMIT 1), 0),
      'record_score', COALESCE((SELECT score FROM game_records WHERE user_id = ${testUserID} AND game_type = 'linkgame' AND session_id = ${sqlLiteral(sessionID)} LIMIT 1), 0),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID} AND source = 'game_play'),
      'daily_game_points', COALESCE((SELECT earned_points FROM daily_game_points WHERE user_id = ${testUserID} AND stat_date = (now() AT TIME ZONE 'Asia/Shanghai')::date), 0),
      'daily_stats_games', COALESCE((SELECT games_played FROM game_daily_stats WHERE user_id = ${testUserID} AND stat_date = (now() AT TIME ZONE 'Asia/Shanghai')::date), 0),
      'daily_stats_points', COALESCE((SELECT points_earned FROM game_daily_stats WHERE user_id = ${testUserID} AND stat_date = (now() AT TIME ZONE 'Asia/Shanghai')::date), 0),
      'active_sessions', (SELECT count(*) FROM active_game_sessions WHERE user_id = ${testUserID} AND game_type = 'linkgame'),
      'sessions', (SELECT count(*) FROM game_sessions WHERE user_id = ${testUserID} AND game_type = 'linkgame')
    )::text;
  `), 'linkgame settlement verification');
  if (
    result.balance !== 1 ||
    result.records !== 1 ||
    result.record_points !== 1 ||
    result.record_score !== record.score ||
    result.ledger_count !== 1 ||
    result.daily_game_points !== 1 ||
    result.daily_stats_games !== 1 ||
    result.daily_stats_points !== 1 ||
    result.active_sessions !== 0 ||
    result.sessions !== 0
  ) {
    fail(`linkgame settlement verification failed: ${JSON.stringify(result)}`);
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
      'records', (SELECT count(*) FROM game_records WHERE user_id = ${testUserID} AND game_type = 'linkgame'),
      'sessions', (SELECT count(*) FROM game_sessions WHERE user_id = ${testUserID} AND game_type = 'linkgame'),
      'active_sessions', (SELECT count(*) FROM active_game_sessions WHERE user_id = ${testUserID} AND game_type = 'linkgame'),
      'cooldowns', (SELECT count(*) FROM game_cooldowns WHERE user_id = ${testUserID} AND game_type = 'linkgame')
    )::text;
  `), 'linkgame cleanup verification');
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
    fail(`linkgame cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  const gatewayLinkgameRules = assertGatewayLinkgameRulesExact();
  const ready = request('GET', '/readyz');
  assertStatus(ready, 200, 'GET /readyz');

  let settlement = null;
  let cleanupResult = null;
  try {
    seedUser();

    assertStatus(request('GET', '/api/games/linkgame/status', null, ''), 401, 'GET /api/games/linkgame/status without login');
    assertStatus(request('POST', '/api/games/linkgame/start', { difficulty: 'easy' }, ''), 401, 'POST /api/games/linkgame/start without login');
    verifyStatusPayload(apiRequest('GET', '/api/games/linkgame/status'), 'GET /api/games/linkgame/status');

    const cancelStart = apiRequest('POST', '/api/games/linkgame/start', { difficulty: 'easy' });
    verifyStartPayload(cancelStart);
    apiRequest('POST', '/api/games/linkgame/cancel');
    const afterCancel = apiRequest('GET', '/api/games/linkgame/status');
    if (afterCancel.data.activeSession !== null) {
      fail(`cancel did not clear active session: ${JSON.stringify(afterCancel).slice(0, 500)}`);
    }
    deleteCooldown();

    const start = apiRequest('POST', '/api/games/linkgame/start', { difficulty: 'easy' });
    verifyStartPayload(start);
    const sessionID = start.data.sessionId;
    prepareTwoTileSession(sessionID);

    const submitBody = {
      sessionId: sessionID,
      moves: [{
        type: 'match',
        pos1: { row: 0, col: 0 },
        pos2: { row: 0, col: 1 },
        matched: true,
        timestamp: 1,
      }],
      completed: true,
      duration: 6000,
    };
    const submit = apiRequest('POST', '/api/games/linkgame/submit', submitBody);
    const record = verifySubmitPayload(submit);
    const duplicate = apiRequest('POST', '/api/games/linkgame/submit', submitBody);
    const duplicateRecord = verifySubmitPayload(duplicate);
    if (duplicateRecord.id !== record.id || duplicateRecord.pointsEarned !== record.pointsEarned) {
      fail(`duplicate submit did not replay settled record: first=${JSON.stringify(record)} duplicate=${JSON.stringify(duplicateRecord)}`);
    }
    settlement = verifySettlement(sessionID, record);
  } finally {
    cleanup();
    cleanupResult = verifyCleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres',
    baseURL,
    testUserID,
    checkedLinkgamePaths: [
      'GET /api/games/linkgame/status',
      'POST /api/games/linkgame/start',
      'POST /api/games/linkgame/submit',
      'POST /api/games/linkgame/cancel',
    ],
    settlement,
    cleanup: cleanupResult,
    gatewayLinkgameRules,
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`linkgame Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
