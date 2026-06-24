import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const baseURL = 'http://127.0.0.1:8080';
const origin = process.env.MINESWEEPER_GO_API_ORIGIN || baseURL;
const testUserID = Number(process.env.MINESWEEPER_SMOKE_USER_ID || 999920);
const testUsername = `minesweeper_smoke_${testUserID}`;
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const cookie = makeSessionCookie(testUserID, testUsername, 'Minesweeper Smoke');

function fail(message) {
  throw new Error(`minesweeper Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `minesweeper-smoke-${userID}-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayMinesweeperRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  const minesweeperRules = activeRules.filter((line) => line.includes('/api/games/minesweeper'));
  const allowed = new Set([
    'handle /api/games/minesweeper/status {',
    'handle /api/games/minesweeper/start {',
    'handle /api/games/minesweeper/step {',
    'handle /api/games/minesweeper/submit {',
    'handle /api/games/minesweeper/cancel {',
  ]);
  const forbidden = activeRules.filter((line) =>
    line === 'handle /api/games/* {' ||
    line === 'handle /api/games/minesweeper* {' ||
    line === 'handle /api/games/minesweeper/* {'
  );
  const unexpected = minesweeperRules.filter((line) => !allowed.has(line));
  if (unexpected.length > 0 || forbidden.length > 0) {
    fail(`gateway/Caddyfile contains unexpected minesweeper rules: ${[...unexpected, ...forbidden].join('; ')}`);
  }
  for (const line of allowed) {
    if (!minesweeperRules.includes(line)) {
      fail(`gateway/Caddyfile missing minesweeper rule: ${line}`);
    }
  }
  return minesweeperRules;
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
    DELETE FROM game_cooldowns WHERE user_id = ${testUserID} AND game_type = 'minesweeper';
    DELETE FROM active_game_sessions WHERE user_id = ${testUserID} AND game_type = 'minesweeper';
    DELETE FROM game_sessions WHERE user_id = ${testUserID} AND game_type = 'minesweeper';
    DELETE FROM game_records WHERE user_id = ${testUserID} AND game_type = 'minesweeper';
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
    VALUES (${testUserID}, ${sqlLiteral(testUsername)}, 'Minesweeper Smoke', now(), now());
    INSERT INTO point_accounts (user_id, balance, updated_at)
    VALUES (${testUserID}, 0, now());
  `);
}

function deleteCooldown() {
  psql(`DELETE FROM game_cooldowns WHERE user_id = ${testUserID} AND game_type = 'minesweeper';`);
}

function loadSession(sessionID) {
  return parseJSON(psql(`
    SELECT payload::text
      FROM game_sessions
     WHERE id = ${sqlLiteral(sessionID)}
       AND user_id = ${testUserID}
       AND game_type = 'minesweeper';
  `), `minesweeper session ${sessionID}`);
}

function firstMinePosition(state) {
  const mine = state.cells.find((cell) => cell.mine);
  if (!mine) {
    fail('minesweeper session has no mine after first reveal');
  }
  return { row: mine.row, col: mine.col };
}

function verifyStartPayload(payload) {
  const state = payload.data?.state;
  if (
    !payload.data ||
    !payload.data.sessionId ||
    payload.data.difficulty !== 'easy' ||
    !state ||
    state.rows !== 9 ||
    state.cols !== 9 ||
    state.mines !== 10 ||
    state.status !== 'playing' ||
    !Array.isArray(state.cells) ||
    state.cells.length !== 81 ||
    typeof payload.data.actionsCount !== 'number'
  ) {
    fail(`start payload shape mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function verifyStatusPayload(payload, label) {
  if (!payload.data || typeof payload.data.balance !== 'number' || !payload.data.dailyStats || !Array.isArray(payload.data.difficulties) || !('activeSession' in payload.data)) {
    fail(`${label} status shape mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function verifyFirstStepPayload(payload) {
  const session = payload.data?.session;
  if (
    !session ||
    session.state.status !== 'playing' ||
    session.state.revealedSafe <= 0 ||
    !payload.data.outcome ||
    payload.data.outcome.type !== 'reveal'
  ) {
    fail(`first step payload mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function verifyMineStepPayload(payload) {
  const session = payload.data?.session;
  if (
    !session ||
    session.state.status !== 'lost' ||
    !payload.data.outcome ||
    payload.data.outcome.type !== 'reveal'
  ) {
    fail(`mine step payload mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function verifySubmitPayload(payload) {
  const record = payload.data?.record;
  if (
    !record ||
    record.difficulty !== 'easy' ||
    record.won !== false ||
    typeof record.score !== 'number' ||
    typeof record.pointsEarned !== 'number' ||
    payload.data.pointsEarned !== record.pointsEarned ||
    record.mines !== 10 ||
    record.moves < 2 ||
    typeof record.scoreBreakdown !== 'object' ||
    typeof record.createdAt !== 'number'
  ) {
    fail(`submit payload mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  return record;
}

function verifySettlement(sessionID, record) {
  const expectedLedgerCount = record.pointsEarned > 0 ? 1 : 0;
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'balance', (SELECT balance FROM point_accounts WHERE user_id = ${testUserID}),
      'records', (SELECT count(*) FROM game_records WHERE user_id = ${testUserID} AND game_type = 'minesweeper' AND session_id = ${sqlLiteral(sessionID)}),
      'record_points', COALESCE((SELECT points_earned FROM game_records WHERE user_id = ${testUserID} AND game_type = 'minesweeper' AND session_id = ${sqlLiteral(sessionID)} LIMIT 1), 0),
      'record_score', COALESCE((SELECT score FROM game_records WHERE user_id = ${testUserID} AND game_type = 'minesweeper' AND session_id = ${sqlLiteral(sessionID)} LIMIT 1), 0),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID} AND source = 'game_play'),
      'daily_game_points', COALESCE((SELECT earned_points FROM daily_game_points WHERE user_id = ${testUserID} AND stat_date = (now() AT TIME ZONE 'Asia/Shanghai')::date), 0),
      'daily_stats_games', COALESCE((SELECT games_played FROM game_daily_stats WHERE user_id = ${testUserID} AND stat_date = (now() AT TIME ZONE 'Asia/Shanghai')::date), 0),
      'daily_stats_points', COALESCE((SELECT points_earned FROM game_daily_stats WHERE user_id = ${testUserID} AND stat_date = (now() AT TIME ZONE 'Asia/Shanghai')::date), 0),
      'active_sessions', (SELECT count(*) FROM active_game_sessions WHERE user_id = ${testUserID} AND game_type = 'minesweeper'),
      'sessions', (SELECT count(*) FROM game_sessions WHERE user_id = ${testUserID} AND game_type = 'minesweeper')
    )::text;
  `), 'minesweeper settlement verification');
  if (
    result.balance !== record.pointsEarned ||
    result.records !== 1 ||
    result.record_points !== record.pointsEarned ||
    result.record_score !== record.score ||
    result.ledger_count !== expectedLedgerCount ||
    result.daily_game_points !== record.pointsEarned ||
    result.daily_stats_games !== 1 ||
    result.daily_stats_points !== record.pointsEarned ||
    result.active_sessions !== 0 ||
    result.sessions !== 0
  ) {
    fail(`minesweeper settlement verification failed: ${JSON.stringify(result)} expected=${JSON.stringify(record)}`);
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
      'records', (SELECT count(*) FROM game_records WHERE user_id = ${testUserID} AND game_type = 'minesweeper'),
      'sessions', (SELECT count(*) FROM game_sessions WHERE user_id = ${testUserID} AND game_type = 'minesweeper'),
      'active_sessions', (SELECT count(*) FROM active_game_sessions WHERE user_id = ${testUserID} AND game_type = 'minesweeper'),
      'cooldowns', (SELECT count(*) FROM game_cooldowns WHERE user_id = ${testUserID} AND game_type = 'minesweeper')
    )::text;
  `), 'minesweeper cleanup verification');
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
    fail(`minesweeper cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  const gatewayMinesweeperRules = assertGatewayMinesweeperRulesExact();
  const ready = request('GET', '/readyz');
  assertStatus(ready, 200, 'GET /readyz');

  let settlement = null;
  let cleanupResult = null;
  try {
    seedUser();

    assertStatus(request('GET', '/api/games/minesweeper/status', null, ''), 401, 'GET /api/games/minesweeper/status without login');
    assertStatus(request('POST', '/api/games/minesweeper/start', { difficulty: 'easy' }, ''), 401, 'POST /api/games/minesweeper/start without login');
    assertStatus(request('POST', '/api/games/minesweeper/step', { sessionId: 'missing', action: { type: 'reveal', position: { row: 0, col: 0 } } }, ''), 401, 'POST /api/games/minesweeper/step without login');
    verifyStatusPayload(apiRequest('GET', '/api/games/minesweeper/status'), 'GET /api/games/minesweeper/status');

    const cancelStart = apiRequest('POST', '/api/games/minesweeper/start', { difficulty: 'easy' });
    verifyStartPayload(cancelStart);
    apiRequest('POST', '/api/games/minesweeper/cancel');
    const afterCancel = apiRequest('GET', '/api/games/minesweeper/status');
    if (afterCancel.data.activeSession !== null) {
      fail(`cancel did not clear active session: ${JSON.stringify(afterCancel).slice(0, 500)}`);
    }
    deleteCooldown();

    const start = apiRequest('POST', '/api/games/minesweeper/start', { difficulty: 'easy' });
    verifyStartPayload(start);
    const sessionID = start.data.sessionId;

    const firstStep = apiRequest('POST', '/api/games/minesweeper/step', {
      sessionId: sessionID,
      action: { type: 'reveal', position: { row: 0, col: 0 } },
    });
    verifyFirstStepPayload(firstStep);

    const mine = firstMinePosition(loadSession(sessionID).state);
    const mineStep = apiRequest('POST', '/api/games/minesweeper/step', {
      sessionId: sessionID,
      action: { type: 'reveal', position: mine },
    });
    verifyMineStepPayload(mineStep);

    const submitBody = { sessionId: sessionID };
    const submit = apiRequest('POST', '/api/games/minesweeper/submit', submitBody);
    const record = verifySubmitPayload(submit);
    const duplicate = apiRequest('POST', '/api/games/minesweeper/submit', submitBody);
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
    checkedMinesweeperPaths: [
      'GET /api/games/minesweeper/status',
      'POST /api/games/minesweeper/start',
      'POST /api/games/minesweeper/step',
      'POST /api/games/minesweeper/submit',
      'POST /api/games/minesweeper/cancel',
    ],
    settlement,
    cleanup: cleanupResult,
    gatewayMinesweeperRules,
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`minesweeper Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
