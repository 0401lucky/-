import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const suffix = String(process.env.ADMIN_REWARDS_SMOKE_SUFFIX || Date.now());
const targetUserID = Number(process.env.ADMIN_REWARDS_SMOKE_USER_ID || 999982);
const title = `后台奖励 smoke ${suffix}`;
const adminCookie = makeSessionCookie(999981, 'admin', 'Admin Rewards Smoke');
const userCookie = makeSessionCookie(targetUserID, 'admin_rewards_smoke_user', 'Admin Rewards Smoke User');
const nonAdminCookie = makeSessionCookie(999983, 'not_admin', 'Not Admin');

function fail(message) {
  throw new Error(`admin rewards Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `admin-rewards-smoke-${userID}-${now}`,
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
    { input: sql, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 * 4 },
  );
  if (result.status !== 0) {
    fail(`psql failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function request(method, path, payload, cookie = adminCookie, baseURL = 'http://api:8080') {
  const bodyExpression = payload == null ? 'undefined' : JSON.stringify(JSON.stringify(payload));
  const code = `
    const response = await fetch('${baseURL}${path}', {
      method: ${JSON.stringify(method)},
      headers: {
        'Cookie': ${JSON.stringify(cookie)},
        'Origin': 'http://api:8080',
        'Content-Type': 'application/json'
      },
      body: ${bodyExpression}
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
    DELETE FROM point_ledger WHERE user_id = ${targetUserID};
    DELETE FROM reward_claims
     WHERE user_id = ${targetUserID}
        OR batch_id IN (SELECT id FROM reward_batches WHERE title = ${sqlLiteral(title)});
    DELETE FROM notifications
     WHERE user_id = ${targetUserID}
        OR title = ${sqlLiteral(title)};
    DELETE FROM reward_batches WHERE title = ${sqlLiteral(title)};
    DELETE FROM point_accounts WHERE user_id = ${targetUserID};
    DELETE FROM users WHERE id = ${targetUserID};
  `);
}

function seedTargetUser() {
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES (${targetUserID}, 'admin_rewards_smoke_user', 'Admin Rewards Smoke User', now(), now())
    ON CONFLICT (id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name, updated_at = now();
  `);
}

try {
  cleanup();
  seedTargetUser();

  const forbidden = request('GET', '/api/admin/rewards', null, nonAdminCookie);
  assertStatus(forbidden, 403, 'non-admin GET /api/admin/rewards');

  const create = request('POST', '/api/admin/rewards', {
    type: 'points',
    amount: 11,
    targetMode: 'selected',
    targetUserIds: [targetUserID],
    title,
    message: '请领取 smoke 积分',
  });
  assertStatus(create, 201, 'admin POST /api/admin/rewards');
  const createBody = parseBody(create, 'admin rewards create');
  const batchID = createBody.data?.id;
  if (!createBody.success || !batchID || createBody.data?.distributedCount !== 1 || createBody.data?.totalTargets !== 1) {
    fail(`admin rewards create body is invalid: ${create.body.slice(0, 800)}`);
  }

  const list = request('GET', '/api/admin/rewards?page=1&limit=10');
  assertStatus(list, 200, 'admin GET /api/admin/rewards');
  const listBody = parseBody(list, 'admin rewards list');
  if (!listBody.success || !Array.isArray(listBody.data?.items) || !listBody.data.items.some((item) => item.id === batchID)) {
    fail(`admin rewards list body is invalid: ${list.body.slice(0, 800)}`);
  }

  const detail = request('GET', `/api/admin/rewards/${batchID}`);
  assertStatus(detail, 200, 'admin GET /api/admin/rewards/{batchId}');
  const detailBody = parseBody(detail, 'admin rewards detail');
  if (!detailBody.success || detailBody.data?.id !== batchID || detailBody.data?.amount !== 11) {
    fail(`admin rewards detail body is invalid: ${detail.body.slice(0, 800)}`);
  }

  const gatewayList = request('GET', '/api/admin/rewards?page=1&limit=10', null, adminCookie, 'http://gateway:8080');
  assertStatus(gatewayList, 200, 'gateway GET /api/admin/rewards');
  const gatewayListBody = parseBody(gatewayList, 'gateway admin rewards list');
  if (!gatewayListBody.success || !Array.isArray(gatewayListBody.data?.items) || !gatewayListBody.data.items.some((item) => item.id === batchID)) {
    fail(`gateway admin rewards list body is invalid: ${gatewayList.body.slice(0, 800)}`);
  }

  const gatewayDetail = request('GET', `/api/admin/rewards/${batchID}`, null, adminCookie, 'http://gateway:8080');
  assertStatus(gatewayDetail, 200, 'gateway GET /api/admin/rewards/{batchId}');

  const notificationID = psql(`
    SELECT notification_id
      FROM reward_claims
     WHERE batch_id = ${sqlLiteral(batchID)}
       AND user_id = ${targetUserID}
     LIMIT 1;
  `);
  if (!notificationID) {
    fail('created reward claim has no notification_id');
  }

  const claim = request('POST', '/api/notifications/claim', { notificationId: notificationID }, userCookie);
  assertStatus(claim, 200, 'user POST /api/notifications/claim');
  const claimBody = parseBody(claim, 'notification claim');
  if (!claimBody.success || claimBody.data?.claimStatus !== 'claimed') {
    fail(`notification claim body is invalid: ${claim.body.slice(0, 800)}`);
  }

  const state = psql(`
    SELECT
      (SELECT balance::text FROM point_accounts WHERE user_id = ${targetUserID}) || ':' ||
      (SELECT claimed_count::text FROM reward_batches WHERE id = ${sqlLiteral(batchID)});
  `);
  if (state !== '11:1') {
    fail(`database reward claim state mismatch: ${state}`);
  }

  cleanup();
  console.log(JSON.stringify({
    ok: true,
    mode: 'admin-rewards-go-api-smoke',
    checkedPaths: [
      'GET /api/admin/rewards',
      'POST /api/admin/rewards',
      'GET /api/admin/rewards/{batchId}',
      'POST /api/notifications/claim',
    ],
    gatewayCutover: 'checked',
  }, null, 2));
} catch (error) {
  try {
    cleanup();
  } catch {
    // 保留原始错误。
  }
  throw error;
}
