import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const baseURL = 'http://127.0.0.1:8080';
const testUserID = Number(process.env.POINTS_RANKINGS_SMOKE_USER_ID || 999913);
const rivalUserID = Number(process.env.POINTS_RANKINGS_SMOKE_RIVAL_USER_ID || 999914);
const testUsername = `points_rankings_smoke_${testUserID}`;
const rivalUsername = `points_rankings_smoke_${rivalUserID}`;
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const userCookie = makeSessionCookie(testUserID, testUsername, 'Points Rankings Smoke');

function fail(message) {
  throw new Error(`points/rankings Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `points-rankings-smoke-${userID}-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => line.includes('/api/points') || line.includes('/api/rankings'));
  const allowed = new Set([
    'handle /api/points {',
    'handle /api/rankings/eco {',
  ]);
  const unexpected = activeRules.filter((line) => !allowed.has(line));
  if (unexpected.length > 0) {
    fail(`gateway/Caddyfile contains unexpected points/rankings rules: ${unexpected.join('; ')}`);
  }
  for (const line of allowed) {
    if (!activeRules.includes(line)) {
      fail(`gateway/Caddyfile missing rule: ${line}`);
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

function request(method, path, cookie = '') {
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

function apiRequest(path, cookie, label = `GET ${path}`) {
  const response = request('GET', path, cookie);
  assertStatus(response, 200, label);
  const payload = parseJSON(response.body, label);
  if (!payload.success) {
    fail(`${label} returned success=false: ${response.body.slice(0, 500)}`);
  }
  return payload;
}

function cleanup() {
  psql(`
    DELETE FROM user_forced_achievements WHERE user_id IN (${testUserID}, ${rivalUserID});
    DELETE FROM user_equipped_achievements WHERE user_id IN (${testUserID}, ${rivalUserID});
    DELETE FROM user_achievement_grants WHERE user_id IN (${testUserID}, ${rivalUserID});
    DELETE FROM eco_trash_rankings WHERE user_id IN (${testUserID}, ${rivalUserID});
    DELETE FROM point_ledger WHERE user_id IN (${testUserID}, ${rivalUserID});
    DELETE FROM point_accounts WHERE user_id IN (${testUserID}, ${rivalUserID});
    DELETE FROM users WHERE id IN (${testUserID}, ${rivalUserID});
  `);
}

function seedData() {
  cleanup();
  const nowMs = Date.now();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES
      (${testUserID}, ${sqlLiteral(testUsername)}, 'Points Rankings Smoke', now(), now()),
      (${rivalUserID}, ${sqlLiteral(rivalUsername)}, 'Eco Rival', now(), now());
    INSERT INTO point_accounts (user_id, balance, updated_at)
    VALUES (${testUserID}, 1234, now()), (${rivalUserID}, 500, now());
    INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
    VALUES
      (${sqlLiteral(`points-rankings-smoke:${testUserID}:1`)}, ${testUserID}, 1000, 'game_play', '冒烟测试入账', 1000, now() - interval '2 minutes'),
      (${sqlLiteral(`points-rankings-smoke:${testUserID}:2`)}, ${testUserID}, 234, 'exchange_refund', '冒烟测试补账', 1234, now() - interval '1 minute');
    INSERT INTO eco_trash_rankings (period, period_key, user_id, trash_cleared, updated_at)
    VALUES
      ('daily', (now() AT TIME ZONE 'Asia/Shanghai')::date::text, ${testUserID}, 77, now()),
      ('daily', (now() AT TIME ZONE 'Asia/Shanghai')::date::text, ${rivalUserID}, 88, now());
    INSERT INTO user_achievement_grants (user_id, achievement_id, source, granted_at_ms, metadata)
    VALUES (${rivalUserID}, 'beginner', 'auto', ${nowMs}, '{}'::jsonb);
    INSERT INTO user_equipped_achievements (user_id, achievement_id, updated_at_ms)
    VALUES (${rivalUserID}, 'beginner', ${nowMs});
  `);
}

function verifyPointsPayload(payload) {
  if (!payload.data || payload.data.balance !== 1234 || !Array.isArray(payload.data.logs)) {
    fail(`points payload shape mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  if (payload.data.logs.length < 2) {
    fail(`points payload missing seeded logs: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  const first = payload.data.logs[0];
  if (first.amount !== 234 || first.source !== 'exchange_refund' || first.balance !== 1234) {
    fail(`points latest log mismatch: ${JSON.stringify(first)}`);
  }
}

function verifyEcoRankingPayload(payload) {
  if (!payload.data || payload.data.period !== 'daily' || !Array.isArray(payload.data.leaderboard)) {
    fail(`eco ranking payload shape mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  if (payload.data.totalParticipants !== 2) {
    fail(`eco ranking totalParticipants mismatch: ${JSON.stringify(payload.data).slice(0, 500)}`);
  }
  const [first, second] = payload.data.leaderboard;
  if (!first || first.userId !== rivalUserID || first.rank !== 1 || first.trashCleared !== 88) {
    fail(`eco ranking first entry mismatch: ${JSON.stringify(first)}`);
  }
  if (!second || second.userId !== testUserID || second.rank !== 2 || second.trashCleared !== 77) {
    fail(`eco ranking second entry mismatch: ${JSON.stringify(second)}`);
  }
  if (!first.equippedAchievement || first.equippedAchievement.id !== 'beginner') {
    fail(`eco ranking equipped achievement missing: ${JSON.stringify(first)}`);
  }
}

function verifyCleanup() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'users', (SELECT count(*) FROM users WHERE id IN (${testUserID}, ${rivalUserID})),
      'accounts', (SELECT count(*) FROM point_accounts WHERE user_id IN (${testUserID}, ${rivalUserID})),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id IN (${testUserID}, ${rivalUserID})),
      'rankings', (SELECT count(*) FROM eco_trash_rankings WHERE user_id IN (${testUserID}, ${rivalUserID})),
      'grants', (SELECT count(*) FROM user_achievement_grants WHERE user_id IN (${testUserID}, ${rivalUserID})),
      'equipped', (SELECT count(*) FROM user_equipped_achievements WHERE user_id IN (${testUserID}, ${rivalUserID})),
      'forced', (SELECT count(*) FROM user_forced_achievements WHERE user_id IN (${testUserID}, ${rivalUserID}))
    )::text;
  `), 'points/rankings cleanup verification');
  if (
    result.users !== 0 ||
    result.accounts !== 0 ||
    result.ledger_count !== 0 ||
    result.rankings !== 0 ||
    result.grants !== 0 ||
    result.equipped !== 0 ||
    result.forced !== 0
  ) {
    fail(`points/rankings cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  const gatewayRules = assertGatewayRulesExact();

  const ready = request('GET', '/readyz');
  assertStatus(ready, 200, 'GET /readyz');

  let cleanupResult = null;
  try {
    seedData();

    assertStatus(request('GET', '/api/points'), 401, 'GET /api/points without login');
    assertStatus(request('GET', '/api/rankings/eco?period=daily&limit=10'), 401, 'GET /api/rankings/eco without login');

    verifyPointsPayload(apiRequest('/api/points', userCookie));
    verifyEcoRankingPayload(apiRequest('/api/rankings/eco?period=daily&limit=10', userCookie));
  } finally {
    cleanup();
    cleanupResult = verifyCleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres',
    baseURL,
    testUserID,
    rivalUserID,
    checkedPaths: [
      'GET /api/points',
      'GET /api/rankings/eco',
    ],
    cleanup: cleanupResult,
    gatewayRules,
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`points/rankings Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
