import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const baseURL = 'http://127.0.0.1:8080';
const gatewayURL = 'http://gateway:8080';
const testUserID = Number(process.env.GAMES_SUMMARY_SMOKE_USER_ID || 999908);
const testUsername = `games_summary_smoke_${testUserID}`;
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const cookie = makeSessionCookie(testUserID, testUsername, 'Games Summary Smoke');

function fail(message) {
  throw new Error(`games summary Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `games-summary-smoke-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayGamesSummaryRulesSafe() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) =>
      line.includes('/api/games/profile') ||
      line.includes('/api/games/overview') ||
      line.includes('/api/games/*')
    );
  const allowedRules = new Set([
    'handle /api/games/overview {',
    'handle /api/games/profile {',
  ]);
  const unexpected = activeRules.filter((line) => !allowedRules.has(line));
  if (unexpected.length > 0) {
    fail(`gateway/Caddyfile contains unexpected games summary rules: ${unexpected.join('; ')}`);
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

function request(path, includeCookie = true, origin = baseURL) {
  const args = ['compose', 'exec', '-T', 'api', 'wget', '-S', '-O', '-'];
  if (includeCookie) {
    args.push('--header', `Cookie: ${cookie}`);
  }
  args.push(`${origin}${path}`);
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

function apiGet(path) {
  const response = request(path);
  if (response.status !== 200) {
    fail(`GET ${path} expected HTTP 200, got ${response.status}; raw=${response.raw.slice(0, 500)}`);
  }
  const payload = parseJSON(response.body, `GET ${path}`);
  if (!payload.success || !payload.data) {
    fail(`GET ${path} returned incompatible payload: ${response.body.slice(0, 500)}`);
  }
  return payload.data;
}

function cleanup() {
  psql(`
    DELETE FROM game_records WHERE user_id = ${testUserID};
    DELETE FROM game_daily_stats WHERE user_id = ${testUserID};
    DELETE FROM point_ledger WHERE user_id = ${testUserID};
    DELETE FROM point_accounts WHERE user_id = ${testUserID};
    DELETE FROM users WHERE id = ${testUserID};
  `);
}

function seedData() {
  cleanup();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES (${testUserID}, ${sqlLiteral(testUsername)}, 'Games Summary Smoke', now(), now());
    INSERT INTO point_accounts (user_id, balance, updated_at)
    VALUES (${testUserID}, 321, now());
    INSERT INTO game_daily_stats (user_id, stat_date, games_played, total_score, points_earned, last_game_at, updated_at)
    VALUES (${testUserID}, (now() AT TIME ZONE 'Asia/Shanghai')::date, 3, 6000, 66, now(), now());
    INSERT INTO game_records (id, user_id, session_id, game_type, difficulty, score, points_earned, payload, created_at)
    VALUES
      ('games-summary-smoke-1', ${testUserID}, 'games-summary-session-1', 'memory', 'easy', 100, 10, '{"completed":true}'::jsonb, now() - interval '6 minutes'),
      ('games-summary-smoke-2', ${testUserID}, 'games-summary-session-2', 'memory', 'easy', 90, 9, '{"completed":true}'::jsonb, now() - interval '5 minutes'),
      ('games-summary-smoke-3', ${testUserID}, 'games-summary-session-3', 'memory', 'easy', 80, 8, '{"completed":false}'::jsonb, now() - interval '4 minutes'),
      ('games-summary-smoke-4', ${testUserID}, 'games-summary-session-4', 'match3', '', 1300, 13, '{"score":1300}'::jsonb, now() - interval '3 minutes'),
      ('games-summary-smoke-5', ${testUserID}, 'games-summary-session-5', 'whack_mole', 'hard', 1400, 14, '{"score":1400}'::jsonb, now() - interval '2 minutes'),
      ('games-summary-smoke-6', ${testUserID}, 'games-summary-session-6', 'roguelite', '', 9999, 99, '{"won":true}'::jsonb, now() - interval '1 minutes');
  `);
}

function verifyCommonSummary(data) {
  if (data.balance !== 321 || data.dailyStats?.gamesPlayed !== 3 || data.dailyStats?.pointsEarned !== 66) {
    fail(`unexpected summary payload: ${JSON.stringify(data)}`);
  }
}

function verifyOverview(data) {
  verifyCommonSummary(data);
  if (typeof data.dailyLimit !== 'number' || typeof data.pointsLimitReached !== 'boolean') {
    fail(`overview missing limit fields: ${JSON.stringify(data)}`);
  }
}

function verifyProfile(data) {
  verifyCommonSummary(data);
  if (data.totalGamesPlayed !== 6 || data.peakScore !== 9999 || data.peakGame !== 'roguelite') {
    fail(`unexpected profile totals: ${JSON.stringify(data)}`);
  }
  if (data.favoriteGame !== 'memory' || data.mostWinsGame !== 'memory' || data.mostWinsCount !== 2) {
    fail(`unexpected profile favorites/wins: ${JSON.stringify(data)}`);
  }
  for (const key of ['roguelite', 'minesweeper', 'whack-mole', 'memory', 'match3', 'linkgame']) {
    if (!data.perGame || !(key in data.perGame)) {
      fail(`profile missing perGame key ${key}: ${JSON.stringify(data.perGame)}`);
    }
  }
  if (data.perGame.memory.totalPlays !== 3 || data.perGame.match3.wins !== 1 || data.perGame['whack-mole'].bestScore !== 1400) {
    fail(`unexpected perGame values: ${JSON.stringify(data.perGame)}`);
  }
}

function verifyCleanup() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'user_exists', EXISTS(SELECT 1 FROM users WHERE id = ${testUserID}),
      'account_exists', EXISTS(SELECT 1 FROM point_accounts WHERE user_id = ${testUserID}),
      'daily_stats', (SELECT count(*) FROM game_daily_stats WHERE user_id = ${testUserID}),
      'game_records', (SELECT count(*) FROM game_records WHERE user_id = ${testUserID})
    )::text;
  `), 'games summary cleanup verification');
  if (result.user_exists || result.account_exists || result.daily_stats !== 0 || result.game_records !== 0) {
    fail(`games summary cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  const gatewayRules = assertGatewayGamesSummaryRulesSafe();

  const ready = request('/readyz', false);
  if (ready.status !== 200) {
    fail(`GET /readyz expected HTTP 200, got ${ready.status}; raw=${ready.raw.slice(0, 500)}`);
  }
  for (const path of ['/api/games/profile', '/api/games/overview']) {
    const unauth = request(path, false);
    if (unauth.status !== 401) {
      fail(`GET ${path} without login expected HTTP 401, got ${unauth.status}; raw=${unauth.raw.slice(0, 500)}`);
    }
  }

  let cleanupResult = null;
  try {
    seedData();
    verifyProfile(apiGet('/api/games/profile'));
    verifyOverview(apiGet('/api/games/overview'));
    const gatewayOverview = request('/api/games/overview', true, gatewayURL);
    if (gatewayOverview.status !== 200) {
      fail(`GET /api/games/overview through Gateway expected HTTP 200, got ${gatewayOverview.status}; raw=${gatewayOverview.raw.slice(0, 500)}`);
    }
    const gatewayPayload = parseJSON(gatewayOverview.body, 'GET /api/games/overview through Gateway');
    if (!gatewayPayload.success || !gatewayPayload.data) {
      fail(`GET /api/games/overview through Gateway returned incompatible payload: ${gatewayOverview.body.slice(0, 500)}`);
    }
    verifyOverview(gatewayPayload.data);
  } finally {
    cleanup();
    cleanupResult = verifyCleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres',
    baseURL,
    gatewayURL,
    testUserID,
    checkedUnauthenticatedPaths: [
      'GET /api/games/profile',
      'GET /api/games/overview',
    ],
    checkedAuthenticatedPaths: [
      'GET /api/games/profile',
      'GET /api/games/overview',
      'GET /api/games/overview through Gateway',
    ],
    cleanup: cleanupResult,
    gatewayGamesSummaryRules: gatewayRules.length === 0 ? 'none' : gatewayRules,
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`games summary Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
