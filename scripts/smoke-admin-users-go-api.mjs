import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const adminCookie = makeSessionCookie(999961, 'admin', 'Admin Users Smoke');
const userCookie = makeSessionCookie(999962, 'not_admin', 'Not Admin');
const targetUserID = Number(process.env.ADMIN_USERS_SMOKE_USER_ID || 999963);
const otherUserID = targetUserID + 1;
const suffix = `${targetUserID}`;
const targetUsername = `admin_users_smoke_${suffix}`;
const otherUsername = `admin_users_smoke_other_${suffix}`;
const raffleID = `admin-users-smoke-raffle-${suffix}`;
const entryID = `admin-users-smoke-entry-${suffix}`;
const exchangeID = `admin-users-smoke-exchange-${suffix}`;

function fail(message) {
  throw new Error(`admin users Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `admin-users-smoke-${userID}-${now}`,
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

function request(method, path, payload, cookie = adminCookie) {
  const code = `
    const response = await fetch('http://api:8080${path}', {
      method: ${JSON.stringify(method)},
      headers: {
        'Cookie': ${JSON.stringify(cookie)},
        'Origin': 'http://api:8080',
        'Content-Type': 'application/json'
      },
      body: ${payload == null ? 'undefined' : JSON.stringify(JSON.stringify(payload))}
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
    DELETE FROM user_achievement_grants WHERE user_id IN (${targetUserID}, ${otherUserID});
    DELETE FROM user_equipped_achievements WHERE user_id IN (${targetUserID}, ${otherUserID});
    DELETE FROM user_forced_achievements WHERE user_id IN (${targetUserID}, ${otherUserID});
    DELETE FROM exchange_logs WHERE user_id IN (${targetUserID}, ${otherUserID});
    DELETE FROM raffle_entries WHERE raffle_id = ${sqlLiteral(raffleID)};
    DELETE FROM raffles WHERE id = ${sqlLiteral(raffleID)};
    DELETE FROM point_accounts WHERE user_id IN (${targetUserID}, ${otherUserID});
    DELETE FROM users WHERE id IN (${targetUserID}, ${otherUserID});
  `);
}

function seed() {
  cleanup();
  const now = Date.now();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES
      (${targetUserID}, ${sqlLiteral(targetUsername)}, 'Admin Users Smoke Target', now(), now()),
      (${otherUserID}, ${sqlLiteral(otherUsername)}, 'Admin Users Smoke Other', now() - interval '1 hour', now());

    INSERT INTO exchange_logs (id, user_id, item_id, item_name, points_cost, value, type, quantity, created_at)
    VALUES (${sqlLiteral(exchangeID)}, ${targetUserID}, 'smoke-item', 'Smoke 兑换项', 100, 1, 'lottery_spin', 1, now());

    INSERT INTO raffles (
      id, mode, title, description, prizes, trigger_type, threshold, status,
      participants_count, winners_count, created_by, created_at_ms, updated_at_ms
    ) VALUES (
      ${sqlLiteral(raffleID)}, 'draw', 'Smoke 抽奖', '后台用户 smoke',
      '[]'::jsonb, 'manual', 1, 'active', 1, 0, 1, ${now}, ${now}
    );

    INSERT INTO raffle_entries (id, raffle_id, user_id, username, entry_number, created_at_ms)
    VALUES (${sqlLiteral(entryID)}, ${sqlLiteral(raffleID)}, ${targetUserID}, ${sqlLiteral(targetUsername)}, 1, ${now});

    INSERT INTO user_achievement_grants (
      user_id, achievement_id, source, granted_at_ms, expires_at_ms, reason, granted_by_username, metadata
    ) VALUES (${targetUserID}, 'beginner', 'auto', ${now}, NULL, 'seed', 'system', '{}'::jsonb);

    INSERT INTO user_equipped_achievements (user_id, achievement_id, updated_at_ms)
    VALUES (${targetUserID}, 'beginner', ${now});
  `);
}

function hasAchievement(items, id, unlocked) {
  return Array.isArray(items) && items.some((item) => item.id === id && item.unlocked === unlocked);
}

try {
  seed();

  const forbidden = request('GET', '/api/admin/users?page=1&limit=10', null, userCookie);
  assertStatus(forbidden, 403, 'non-admin GET /api/admin/users');

  const list = request('GET', `/api/admin/users?page=1&limit=10&search=${encodeURIComponent(targetUsername)}`);
  assertStatus(list, 200, 'admin GET /api/admin/users');
  const listBody = parseBody(list, 'admin users list');
  const user = listBody.users?.[0];
  if (
    !listBody.success ||
    listBody.pagination?.total !== 1 ||
    listBody.stats?.claimedUserCount !== 1 ||
    user?.id !== targetUserID ||
    user?.claimsCount !== 1 ||
    user?.lotteryCount !== 1 ||
    user?.isNewUser !== false
  ) {
    fail(`admin users list body is invalid: ${list.body.slice(0, 800)}`);
  }

  const detail = request('GET', `/api/admin/users/${targetUserID}`);
  assertStatus(detail, 200, 'admin GET /api/admin/users/{id}');
  const detailBody = parseBody(detail, 'admin user detail');
  if (
    !detailBody.success ||
    detailBody.claims?.[0]?.projectName !== 'Smoke 兑换项' ||
    detailBody.lotteryRecords?.[0]?.oderId !== raffleID ||
    !hasAchievement(detailBody.achievements, 'beginner', true) ||
    !hasAchievement(detailBody.achievements, 'contributor', false)
  ) {
    fail(`admin user detail body is invalid: ${detail.body.slice(0, 1000)}`);
  }

  const unsupported = request('POST', `/api/admin/users/${targetUserID}/achievements`, {
    achievementId: 'beginner',
    action: 'grant',
  });
  assertStatus(unsupported, 400, 'admin POST unsupported achievement');

  const grant = request('POST', `/api/admin/users/${targetUserID}/achievements`, {
    achievementId: 'contributor',
    action: 'grant',
    reason: 'smoke grant',
  });
  assertStatus(grant, 200, 'admin POST grant contributor');
  const grantBody = parseBody(grant, 'admin user grant');
  if (!grantBody.success || !hasAchievement(grantBody.achievements, 'contributor', true)) {
    fail(`admin user grant result invalid: ${grant.body.slice(0, 800)}`);
  }

  const storedGrant = psql(`
    SELECT COUNT(*)::text
      FROM user_achievement_grants
     WHERE user_id = ${targetUserID}
       AND achievement_id = 'contributor'
       AND source = 'admin'
       AND granted_by_username = 'admin';
  `);
  if (Number(storedGrant) !== 1) {
    fail(`contributor grant was not persisted correctly: ${storedGrant}`);
  }

  const revoke = request('POST', `/api/admin/users/${targetUserID}/achievements`, {
    achievementId: 'contributor',
    action: 'revoke',
  });
  assertStatus(revoke, 200, 'admin POST revoke contributor');
  const revokedGrant = psql(`
    SELECT COUNT(*)::text
      FROM user_achievement_grants
     WHERE user_id = ${targetUserID}
       AND achievement_id = 'contributor';
  `);
  if (Number(revokedGrant) !== 0) {
    fail(`contributor grant should be revoked: ${revokedGrant}`);
  }

  cleanup();
  console.log(JSON.stringify({
    ok: true,
    mode: 'admin-users-go-api-smoke',
    checkedPaths: [
      'GET /api/admin/users',
      'GET /api/admin/users/{id}',
      'POST /api/admin/users/{id}/achievements',
    ],
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
