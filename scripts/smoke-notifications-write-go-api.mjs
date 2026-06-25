import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const baseURL = 'http://127.0.0.1:8080';
const origin = process.env.NOTIFICATIONS_GO_API_ORIGIN || baseURL;
const testUserID = Number(process.env.NOTIFICATIONS_WRITE_SMOKE_USER_ID || 999903);
const testUsername = `notifications_write_smoke_${testUserID}`;
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const cookie = makeSessionCookie(testUserID, testUsername, 'Notifications Write Smoke');

const ids = {
  unread: `notifications-write-unread-${testUserID}`,
  read: `notifications-write-read-${testUserID}`,
  reward: `notifications-write-reward-${testUserID}`,
  batch: `notifications-write-batch-${testUserID}`,
  claim: `notifications-write-claim-${testUserID}`,
};
const expectedGatewayNotificationRules = [
  'handle /api/notifications {',
  'handle /api/notifications/unread-count {',
  'handle /api/notifications/read {',
  'handle /api/notifications/delete {',
  'handle /api/notifications/claim {',
];

function fail(message) {
  throw new Error(`notifications write Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `notifications-write-smoke-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayNotificationRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeNotificationRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => line.includes('/api/notifications'));
  const actual = new Set(activeNotificationRules);
  const missing = expectedGatewayNotificationRules.filter((line) => !actual.has(line));
  const unexpected = activeNotificationRules.filter((line) => !expectedGatewayNotificationRules.includes(line));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(`gateway/Caddyfile notification rules must be exact; missing=${missing.join('; ')} unexpected=${unexpected.join('; ')}`);
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

function request(method, path, payload) {
  const body = payload ? JSON.stringify(payload) : '';
  const args = ['compose', 'exec', '-T', 'api', 'wget', '-S', '-O', '-'];
  args.push('--header', `Cookie: ${cookie}`);
  args.push('--header', `Origin: ${origin}`);
  args.push('--header', 'Content-Type: application/json');
  if (method === 'POST') {
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
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        // Fall through to the original failure with the raw body snippet.
      }
    }
    fail(`${label} did not return JSON: ${body.slice(0, 300)}`);
  }
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    fail(`${label} expected HTTP ${expected}, got ${response.status}; raw=${response.raw.slice(0, 500)}`);
  }
}

function apiRequest(method, path, payload) {
  const response = request(method, path, payload);
  assertStatus(response, 200, `${method} ${path}`);
  const parsed = parseJSON(response.body, `${method} ${path}`);
  if (!parsed.success || !parsed.data) {
    fail(`${method} ${path} returned incompatible payload: ${response.body.slice(0, 500)}`);
  }
  return parsed.data;
}

function seedTestData() {
  cleanup();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES (${testUserID}, ${sqlLiteral(testUsername)}, 'Notifications Write Smoke', now(), now());
    INSERT INTO point_accounts (user_id, balance, updated_at)
    VALUES (${testUserID}, 5, now());

    INSERT INTO notifications (id, user_id, type, title, content, data, created_at_ms, read_at_ms)
    VALUES
      (${sqlLiteral(ids.unread)}, ${testUserID}, 'system', '未读测试', '内容', '{}'::jsonb, 1700000000100, NULL),
      (${sqlLiteral(ids.read)}, ${testUserID}, 'system', '已读测试', '内容', '{}'::jsonb, 1700000000200, 1700000000300),
      (
        ${sqlLiteral(ids.reward)},
        ${testUserID},
        'reward',
        '奖励测试',
        '内容',
        ${sqlLiteral(JSON.stringify({
          rewardBatchId: ids.batch,
          rewardType: 'points',
          rewardAmount: 25,
          claimStatus: 'pending',
        }))}::jsonb,
        1700000000400,
        NULL
      );

    INSERT INTO reward_batches (
      id, type, amount, target_mode, target_user_ids, title, message, created_by,
      created_at_ms, status, total_targets, distributed_count
    ) VALUES (
      ${sqlLiteral(ids.batch)}, 'points', 25, 'selected', ${sqlLiteral(JSON.stringify([testUserID]))}::jsonb,
      '奖励测试', '内容', 'smoke', 1700000000000, 'completed', 1, 1
    );

    INSERT INTO reward_claims (id, batch_id, user_id, notification_id, type, amount, status)
    VALUES (${sqlLiteral(ids.claim)}, ${sqlLiteral(ids.batch)}, ${testUserID}, ${sqlLiteral(ids.reward)}, 'points', 25, 'pending');
  `);
}

function cleanup() {
  psql(`
    DELETE FROM point_ledger WHERE user_id = ${testUserID};
    DELETE FROM reward_claims
      WHERE user_id = ${testUserID}
         OR batch_id = ${sqlLiteral(ids.batch)}
         OR notification_id IN (${sqlLiteral(ids.unread)}, ${sqlLiteral(ids.read)}, ${sqlLiteral(ids.reward)});
    DELETE FROM reward_batches WHERE id = ${sqlLiteral(ids.batch)};
    DELETE FROM notifications
      WHERE user_id = ${testUserID}
         OR id IN (${sqlLiteral(ids.unread)}, ${sqlLiteral(ids.read)}, ${sqlLiteral(ids.reward)});
    DELETE FROM point_accounts WHERE user_id = ${testUserID};
    DELETE FROM users WHERE id = ${testUserID};
  `);
}

function verifyWrites() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'unread_exists', EXISTS(SELECT 1 FROM notifications WHERE id = ${sqlLiteral(ids.unread)}),
      'read_exists', EXISTS(SELECT 1 FROM notifications WHERE id = ${sqlLiteral(ids.read)}),
      'reward_status', (SELECT status FROM reward_claims WHERE id = ${sqlLiteral(ids.claim)}),
      'reward_notification_status', (SELECT data->>'claimStatus' FROM notifications WHERE id = ${sqlLiteral(ids.reward)}),
      'reward_read', EXISTS(SELECT 1 FROM notifications WHERE id = ${sqlLiteral(ids.reward)} AND read_at_ms IS NOT NULL),
      'balance', (SELECT balance FROM point_accounts WHERE user_id = ${testUserID}),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID} AND source = 'reward_claim'),
      'claimed_count', (SELECT claimed_count FROM reward_batches WHERE id = ${sqlLiteral(ids.batch)})
    )::text;
  `), 'write verification');

  if (!result.unread_exists) {
    fail(`mark read should keep unread notification row: ${JSON.stringify(result)}`);
  }
  if (result.read_exists) {
    fail(`delete should remove read notification row: ${JSON.stringify(result)}`);
  }
  if (result.reward_status !== 'claimed' || result.reward_notification_status !== 'claimed' || !result.reward_read) {
    fail(`claim should mark reward as claimed and read: ${JSON.stringify(result)}`);
  }
  if (result.balance !== 30 || result.ledger_count !== 1 || result.claimed_count !== 1) {
    fail(`claim should add points once: ${JSON.stringify(result)}`);
  }
  return result;
}

function verifyCleanup() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'user_exists', EXISTS(SELECT 1 FROM users WHERE id = ${testUserID}),
      'notification_count', (SELECT count(*) FROM notifications WHERE user_id = ${testUserID}),
      'claim_count', (SELECT count(*) FROM reward_claims WHERE user_id = ${testUserID}),
      'batch_exists', EXISTS(SELECT 1 FROM reward_batches WHERE id = ${sqlLiteral(ids.batch)}),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID})
    )::text;
  `), 'cleanup verification');
  if (result.user_exists || result.notification_count !== 0 || result.claim_count !== 0 || result.batch_exists || result.ledger_count !== 0) {
    fail(`cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  assertGatewayNotificationRulesExact();

  const ready = request('GET', '/readyz');
  assertStatus(ready, 200, 'GET /readyz');

  let verification = null;
  let cleanupResult = null;
  try {
    seedTestData();

    const listBefore = apiRequest('GET', '/api/notifications?page=1&limit=10');
    if (listBefore.unreadCount !== 2 || listBefore.pagination.total !== 3) {
      fail(`unexpected initial list payload: ${JSON.stringify(listBefore)}`);
    }

    const unreadBefore = apiRequest('GET', '/api/notifications/unread-count');
    if (unreadBefore.unreadCount !== 2) {
      fail(`unexpected initial unread count: ${JSON.stringify(unreadBefore)}`);
    }

    const readResult = apiRequest('POST', '/api/notifications/read', { ids: [ids.unread], markAll: false });
    if (readResult.updated !== 1 || readResult.unreadCount !== 1) {
      fail(`unexpected mark-read result: ${JSON.stringify(readResult)}`);
    }

    const deleteResult = apiRequest('POST', '/api/notifications/delete', { ids: [ids.read] });
    if (deleteResult.deleted !== 1 || deleteResult.unreadCount !== 1) {
      fail(`unexpected delete result: ${JSON.stringify(deleteResult)}`);
    }

    const claimResult = apiRequest('POST', '/api/notifications/claim', { notificationId: ids.reward });
    if (claimResult.claimStatus !== 'claimed') {
      fail(`unexpected claim result: ${JSON.stringify(claimResult)}`);
    }

    const claimAgain = apiRequest('POST', '/api/notifications/claim', { notificationId: ids.reward });
    if (claimAgain.claimStatus !== 'claimed') {
      fail(`unexpected repeated claim result: ${JSON.stringify(claimAgain)}`);
    }

    verification = verifyWrites();
  } finally {
    cleanup();
    cleanupResult = verifyCleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres',
    baseURL,
    testUserID,
    checkedAuthenticatedPaths: [
      'GET /api/notifications',
      'GET /api/notifications/unread-count',
      'POST /api/notifications/read',
      'POST /api/notifications/delete',
      'POST /api/notifications/claim',
    ],
    verification,
    cleanup: cleanupResult,
    gatewayNotificationRules: expectedGatewayNotificationRules,
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`notifications write Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
