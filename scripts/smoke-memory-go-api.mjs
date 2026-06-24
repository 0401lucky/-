import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const baseURL = 'http://127.0.0.1:8080';
const origin = process.env.MEMORY_GO_API_ORIGIN || baseURL;
const testUserID = Number(process.env.MEMORY_SMOKE_USER_ID || 999917);
const testUsername = `memory_smoke_${testUserID}`;
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const cookie = makeSessionCookie(testUserID, testUsername, 'Memory Smoke');

function fail(message) {
  throw new Error(`memory Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `memory-smoke-${userID}-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayMemoryRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => line.includes('/api/games/memory'));
  const allowed = new Set([
    'handle /api/games/memory/status {',
    'handle /api/games/memory/start {',
    'handle /api/games/memory/flip {',
    'handle /api/games/memory/submit {',
    'handle /api/games/memory/cancel {',
  ]);
  const unexpected = activeRules.filter((line) => !allowed.has(line));
  if (unexpected.length > 0) {
    fail(`gateway/Caddyfile contains unexpected memory rules: ${unexpected.join('; ')}`);
  }
  for (const line of allowed) {
    if (!activeRules.includes(line)) {
      fail(`gateway/Caddyfile missing memory rule: ${line}`);
    }
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
    DELETE FROM game_cooldowns WHERE user_id = ${testUserID} AND game_type = 'memory';
    DELETE FROM active_game_sessions WHERE user_id = ${testUserID} AND game_type = 'memory';
    DELETE FROM game_sessions WHERE user_id = ${testUserID} AND game_type = 'memory';
    DELETE FROM game_records WHERE user_id = ${testUserID} AND game_type = 'memory';
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
    VALUES (${testUserID}, ${sqlLiteral(testUsername)}, 'Memory Smoke', now(), now());
    INSERT INTO point_accounts (user_id, balance, updated_at)
    VALUES (${testUserID}, 0, now());
  `);
}

function deleteCooldown() {
  psql(`DELETE FROM game_cooldowns WHERE user_id = ${testUserID} AND game_type = 'memory';`);
}

function loadSession(sessionID) {
  return parseJSON(psql(`
    SELECT payload::text
      FROM game_sessions
     WHERE id = ${sqlLiteral(sessionID)}
       AND user_id = ${testUserID}
       AND game_type = 'memory';
  `), `memory session ${sessionID}`);
}

function ageSession(session) {
  const aged = { ...session, startedAt: session.startedAt - 6000 };
  psql(`
    UPDATE game_sessions
       SET payload = ${sqlLiteral(JSON.stringify(aged))}::jsonb,
           started_at = to_timestamp(${aged.startedAt}::double precision / 1000),
           updated_at = now()
     WHERE id = ${sqlLiteral(session.id)}
       AND user_id = ${testUserID}
       AND game_type = 'memory';
  `);
  return aged;
}

function pairsFromLayout(layout) {
  const firstByIcon = new Map();
  const pairs = [];
  for (const [index, icon] of layout.entries()) {
    if (firstByIcon.has(icon)) {
      pairs.push([firstByIcon.get(icon), index]);
      firstByIcon.delete(icon);
    } else {
      firstByIcon.set(icon, index);
    }
  }
  return pairs;
}

function verifyStartPayload(payload) {
  if (!payload.data || !payload.data.sessionId || payload.data.difficulty !== 'easy' || !Array.isArray(payload.data.cardLayout)) {
    fail(`start payload shape mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  if (payload.data.cardLayout.length !== 16 || payload.data.cardLayout.some((card) => card !== '__hidden__')) {
    fail(`start payload leaked memory layout: ${JSON.stringify(payload.data.cardLayout)}`);
  }
}

function verifyStatusPayload(payload, label) {
  if (!payload.data || typeof payload.data.balance !== 'number' || !payload.data.dailyStats || !('activeSession' in payload.data)) {
    fail(`${label} status shape mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function verifySettlement(sessionID) {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'balance', (SELECT balance FROM point_accounts WHERE user_id = ${testUserID}),
      'records', (SELECT count(*) FROM game_records WHERE user_id = ${testUserID} AND game_type = 'memory' AND session_id = ${sqlLiteral(sessionID)}),
      'record_points', COALESCE((SELECT points_earned FROM game_records WHERE user_id = ${testUserID} AND game_type = 'memory' AND session_id = ${sqlLiteral(sessionID)} LIMIT 1), 0),
      'record_score', COALESCE((SELECT score FROM game_records WHERE user_id = ${testUserID} AND game_type = 'memory' AND session_id = ${sqlLiteral(sessionID)} LIMIT 1), 0),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID} AND source = 'game_play'),
      'daily_game_points', COALESCE((SELECT earned_points FROM daily_game_points WHERE user_id = ${testUserID} AND stat_date = (now() AT TIME ZONE 'Asia/Shanghai')::date), 0),
      'daily_stats_games', COALESCE((SELECT games_played FROM game_daily_stats WHERE user_id = ${testUserID} AND stat_date = (now() AT TIME ZONE 'Asia/Shanghai')::date), 0),
      'daily_stats_points', COALESCE((SELECT points_earned FROM game_daily_stats WHERE user_id = ${testUserID} AND stat_date = (now() AT TIME ZONE 'Asia/Shanghai')::date), 0),
      'active_sessions', (SELECT count(*) FROM active_game_sessions WHERE user_id = ${testUserID} AND game_type = 'memory'),
      'sessions', (SELECT count(*) FROM game_sessions WHERE user_id = ${testUserID} AND game_type = 'memory')
    )::text;
  `), 'memory settlement verification');
  if (
    result.balance !== 24 ||
    result.records !== 1 ||
    result.record_points !== 24 ||
    result.record_score !== 220 ||
    result.ledger_count !== 1 ||
    result.daily_game_points !== 24 ||
    result.daily_stats_games !== 1 ||
    result.daily_stats_points !== 24 ||
    result.active_sessions !== 0 ||
    result.sessions !== 0
  ) {
    fail(`memory settlement verification failed: ${JSON.stringify(result)}`);
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
      'records', (SELECT count(*) FROM game_records WHERE user_id = ${testUserID} AND game_type = 'memory'),
      'sessions', (SELECT count(*) FROM game_sessions WHERE user_id = ${testUserID} AND game_type = 'memory'),
      'active_sessions', (SELECT count(*) FROM active_game_sessions WHERE user_id = ${testUserID} AND game_type = 'memory'),
      'cooldowns', (SELECT count(*) FROM game_cooldowns WHERE user_id = ${testUserID} AND game_type = 'memory')
    )::text;
  `), 'memory cleanup verification');
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
    fail(`memory cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  const gatewayMemoryRules = assertGatewayMemoryRulesExact();
  const ready = request('GET', '/readyz');
  assertStatus(ready, 200, 'GET /readyz');

  let settlement = null;
  let cleanupResult = null;
  try {
    seedUser();

    assertStatus(request('GET', '/api/games/memory/status', null, ''), 401, 'GET /api/games/memory/status without login');
    assertStatus(request('POST', '/api/games/memory/start', { difficulty: 'easy' }, ''), 401, 'POST /api/games/memory/start without login');
    verifyStatusPayload(apiRequest('GET', '/api/games/memory/status'), 'GET /api/games/memory/status');

    const cancelStart = apiRequest('POST', '/api/games/memory/start', { difficulty: 'easy' });
    verifyStartPayload(cancelStart);
    apiRequest('POST', '/api/games/memory/cancel');
    let afterCancel = apiRequest('GET', '/api/games/memory/status');
    if (afterCancel.data.activeSession !== null) {
      fail(`cancel did not clear active session: ${JSON.stringify(afterCancel).slice(0, 500)}`);
    }
    deleteCooldown();

    const start = apiRequest('POST', '/api/games/memory/start', { difficulty: 'easy' });
    verifyStartPayload(start);
    const sessionID = start.data.sessionId;
    const session = ageSession(loadSession(sessionID));
    const pairs = pairsFromLayout(session.cardLayout);
    if (pairs.length !== 8) {
      fail(`expected 8 easy memory pairs, got ${pairs.length}`);
    }

    const moves = [];
    for (const pair of pairs) {
      const first = apiRequest('POST', '/api/games/memory/flip', { sessionId: sessionID, cardIndex: pair[0] });
      if (!first.data || first.data.cardIndex !== pair[0] || first.data.matched !== false) {
        fail(`first flip mismatch: ${JSON.stringify(first).slice(0, 500)}`);
      }
      const second = apiRequest('POST', '/api/games/memory/flip', { sessionId: sessionID, cardIndex: pair[1] });
      if (!second.data || second.data.cardIndex !== pair[1] || second.data.matched !== true || !second.data.move) {
        fail(`second flip mismatch: ${JSON.stringify(second).slice(0, 500)}`);
      }
      moves.push(second.data.move);
    }

    const submitBody = { sessionId: sessionID, moves, completed: true, duration: 6000 };
    const submit = apiRequest('POST', '/api/games/memory/submit', submitBody);
    if (!submit.data || submit.data.pointsEarned !== 24 || submit.data.record.score !== 220) {
      fail(`submit payload mismatch: ${JSON.stringify(submit).slice(0, 500)}`);
    }
    assertStatus(request('POST', '/api/games/memory/submit', submitBody), 400, 'duplicate POST /api/games/memory/submit');
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
    checkedMemoryPaths: [
      'GET /api/games/memory/status',
      'POST /api/games/memory/start',
      'POST /api/games/memory/flip',
      'POST /api/games/memory/submit',
      'POST /api/games/memory/cancel',
    ],
    settlement,
    cleanup: cleanupResult,
    gatewayMemoryRules,
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`memory Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
