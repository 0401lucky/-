import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const adminCookie = makeSessionCookie(999971, 'admin', 'Admin Dashboard Smoke');
const userCookie = makeSessionCookie(999972, 'not_admin', 'Not Admin');
const baseUserID = Number(process.env.ADMIN_DASHBOARD_SMOKE_USER_ID || 999973);
const userIDs = [baseUserID, baseUserID + 1, baseUserID + 2];
const suffix = `${baseUserID}`;
const raffleID = `admin-dashboard-smoke-raffle-${suffix}`;

function fail(message) {
  throw new Error(`admin dashboard Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `admin-dashboard-smoke-${userID}-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
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

function request(method, path, cookie = adminCookie) {
  const code = `
    const response = await fetch('http://api:8080${path}', {
      method: ${JSON.stringify(method)},
      headers: {
        'Cookie': ${JSON.stringify(cookie)},
        'Origin': 'http://api:8080',
        'Content-Type': 'application/json'
      }
    });
    const body = await response.text();
    console.log(JSON.stringify({ status: response.status, body }));
  `;
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'web', 'node', '-e', code], {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 4,
  });
  if (result.status !== 0) {
    fail(`request ${method} ${path} failed: ${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    fail(`request ${method} ${path} returned non-json wrapper: ${result.stdout}`);
  }
}

function parseBody(response, label) {
  try {
    return JSON.parse(response.body);
  } catch {
    fail(`${label} returned non-json body: ${response.body.slice(0, 300)}`);
  }
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    fail(`${label} expected HTTP ${expected}, got ${response.status}; body=${response.body.slice(0, 500)}`);
  }
}

function cleanup() {
  psql(`
    DELETE FROM game_records WHERE user_id IN (${userIDs.join(', ')});
    DELETE FROM point_ledger WHERE user_id IN (${userIDs.join(', ')});
    DELETE FROM exchange_logs WHERE user_id IN (${userIDs.join(', ')});
    DELETE FROM raffle_entries WHERE raffle_id = ${sqlLiteral(raffleID)};
    DELETE FROM raffles WHERE id = ${sqlLiteral(raffleID)};
    DELETE FROM point_accounts WHERE user_id IN (${userIDs.join(', ')});
    DELETE FROM users WHERE id IN (${userIDs.join(', ')});
  `);
}

function seed() {
  const now = Date.now();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES
      (${userIDs[0]}, 'admin_dashboard_smoke_1_${suffix}', 'Dashboard Smoke 1', now(), now()),
      (${userIDs[1]}, 'admin_dashboard_smoke_2_${suffix}', 'Dashboard Smoke 2', now(), now()),
      (${userIDs[2]}, 'admin_dashboard_smoke_3_${suffix}', 'Dashboard Smoke 3', now() - interval '40 days', now());

    INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
    VALUES
      (${sqlLiteral(`admin-dashboard-smoke-in-${suffix}`)}, ${userIDs[0]}, 100, 'admin_adjust', 'in', 100, now()),
      (${sqlLiteral(`admin-dashboard-smoke-out-${suffix}`)}, ${userIDs[0]}, -30, 'exchange', 'out', 70, now());

    INSERT INTO exchange_logs (id, user_id, item_id, item_name, points_cost, value, type, quantity, created_at)
    VALUES (${sqlLiteral(`admin-dashboard-smoke-exchange-${suffix}`)}, ${userIDs[0]}, 'dashboard-item', 'Dashboard 兑换项', 30, 1, 'lottery_spin', 1, now());

    INSERT INTO raffles (
      id, mode, title, description, prizes, trigger_type, threshold, status,
      participants_count, winners_count, created_by, created_at_ms, updated_at_ms
    ) VALUES (${sqlLiteral(raffleID)}, 'draw', 'Dashboard Smoke 抽奖', 'dashboard smoke', '[]'::jsonb, 'manual', 1, 'active', 1, 0, 1, ${now}, ${now});

    INSERT INTO raffle_entries (id, raffle_id, user_id, username, entry_number, created_at_ms)
    VALUES (${sqlLiteral(`admin-dashboard-smoke-entry-${suffix}`)}, ${sqlLiteral(raffleID)}, ${userIDs[1]}, 'admin_dashboard_smoke_2_${suffix}', 1, ${now});

    INSERT INTO game_records (id, user_id, session_id, game_type, difficulty, score, points_earned, payload, created_at)
    VALUES (${sqlLiteral(`admin-dashboard-smoke-game-${suffix}`)}, ${userIDs[1]}, 'admin-dashboard-smoke-session', 'memory', 'normal', 120, 10, '{}'::jsonb, now());
  `);
}

function getDashboard(label) {
  const response = request('GET', '/api/admin/dashboard?detect=1&refresh=1');
  assertStatus(response, 200, label);
  const body = parseBody(response, label);
  if (!body.success || !body.data?.dashboard) {
    fail(`${label} body is invalid: ${response.body.slice(0, 800)}`);
  }
  return body.data;
}

try {
  cleanup();

  const forbidden = request('GET', '/api/admin/dashboard', userCookie);
  assertStatus(forbidden, 403, 'non-admin GET /api/admin/dashboard');

  const baseline = getDashboard('admin dashboard baseline');
  seed();
  const after = getDashboard('admin dashboard after seed');

  const beforeDashboard = baseline.dashboard;
  const dashboard = after.dashboard;
  if (
    dashboard.users.total !== beforeDashboard.users.total + 3 ||
    dashboard.users.dau !== beforeDashboard.users.dau + 2 ||
    dashboard.users.mau !== beforeDashboard.users.mau + 2
  ) {
    fail(`dashboard users delta invalid: before=${JSON.stringify(beforeDashboard.users)} after=${JSON.stringify(dashboard.users)}`);
  }
  if (
    dashboard.redemption.todayClaims !== beforeDashboard.redemption.todayClaims + 1 ||
    dashboard.redemption.todayLotterySpins !== beforeDashboard.redemption.todayLotterySpins + 1
  ) {
    fail(`dashboard redemption delta invalid: before=${JSON.stringify(beforeDashboard.redemption)} after=${JSON.stringify(dashboard.redemption)}`);
  }
  if (
    dashboard.pointsFlow.todayIn !== beforeDashboard.pointsFlow.todayIn + 100 ||
    dashboard.pointsFlow.todayOut !== beforeDashboard.pointsFlow.todayOut + 30 ||
    dashboard.pointsFlow.todayNet !== beforeDashboard.pointsFlow.todayNet + 70
  ) {
    fail(`dashboard points flow delta invalid: before=${JSON.stringify(beforeDashboard.pointsFlow)} after=${JSON.stringify(dashboard.pointsFlow)}`);
  }
  if (
    dashboard.games.participants !== beforeDashboard.games.participants + 1 ||
    !Array.isArray(after.alerts?.active) ||
    !Array.isArray(after.alerts?.history) ||
    after.dashboard.alerts.active !== 0 ||
    after.detection?.scannedUsers !== beforeDashboard.users.total + 3 ||
    after.detection?.triggeredAlerts !== 0
  ) {
    fail(`dashboard games/alerts/detection invalid: ${JSON.stringify(after)}`);
  }

  cleanup();
  console.log(JSON.stringify({
    ok: true,
    mode: 'admin-dashboard-go-api-smoke',
    checkedPaths: ['GET /api/admin/dashboard'],
    gatewayCutover: 'not-used',
  }, null, 2));
} catch (error) {
  try {
    cleanup();
  } catch {
    // 保留原始错误。
  }
  throw error;
}
