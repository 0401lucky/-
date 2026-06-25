import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const testUserID = Number(process.env.ANNOUNCEMENTS_SMOKE_USER_ID || 999947);
const otherUserID = testUserID + 1;
const suffix = `${testUserID}-${Date.now()}`;
const title = `公告 smoke ${suffix}`;
const adminCookie = makeSessionCookie(1, 'admin', 'Announcements Smoke Admin');
const userCookie = makeSessionCookie(testUserID, `announcements_smoke_${testUserID}`, 'Announcements Smoke User');
const nonAdminCookie = makeSessionCookie(otherUserID, `announcements_smoke_${otherUserID}`, 'Announcements Smoke Other');

const expectedGatewayAnnouncementRules = [
  'handle /api/announcements {',
  'handle /api/admin/announcements {',
  'handle /api/admin/announcements/* {',
];

function fail(message) {
  throw new Error(`announcements Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `announcements-smoke-${userID}-${now}`,
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

function request(method, path, payload, cookie = userCookie) {
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

function assertGatewayAnnouncementRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => line.includes('/api/announcements') || line.includes('/api/admin/announcements'));
  const missingRules = expectedGatewayAnnouncementRules.filter((rule) => !activeRules.includes(rule));
  const unexpectedRules = activeRules.filter((rule) => !expectedGatewayAnnouncementRules.includes(rule));
  if (missingRules.length > 0 || unexpectedRules.length > 0) {
    fail(`gateway/Caddyfile announcement rules mismatch: missing=${missingRules.join('; ')} unexpected=${unexpectedRules.join('; ')}`);
  }
}

function cleanup() {
  psql(`
    DELETE FROM notifications
     WHERE data->>'announcementId' IN (SELECT id FROM announcements WHERE title = ${sqlLiteral(title)})
        OR user_id IN (${testUserID}, ${otherUserID});
    DELETE FROM announcement_notifications
     WHERE announcement_id IN (SELECT id FROM announcements WHERE title = ${sqlLiteral(title)})
        OR user_id IN (${testUserID}, ${otherUserID});
    DELETE FROM announcements WHERE title = ${sqlLiteral(title)};
    DELETE FROM point_accounts WHERE user_id IN (${testUserID}, ${otherUserID});
    DELETE FROM user_assets WHERE user_id IN (${testUserID}, ${otherUserID});
    DELETE FROM users WHERE id IN (${testUserID}, ${otherUserID});
  `);
}

function seedUsers() {
  cleanup();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES
      (${testUserID}, 'announcements_smoke_${testUserID}', 'Announcements Smoke User', now(), now()),
      (${otherUserID}, 'announcements_smoke_${otherUserID}', 'Announcements Smoke Other', now(), now());
  `);
}

function verifyCleanup() {
  const result = JSON.parse(psql(`
    SELECT json_build_object(
      'users', (SELECT count(*) FROM users WHERE id IN (${testUserID}, ${otherUserID})),
      'announcements', (SELECT count(*) FROM announcements WHERE title = ${sqlLiteral(title)}),
      'notifications', (SELECT count(*) FROM notifications WHERE user_id IN (${testUserID}, ${otherUserID})),
      'dedupe', (SELECT count(*) FROM announcement_notifications WHERE user_id IN (${testUserID}, ${otherUserID}))
    )::text;
  `));
  if (result.users !== 0 || result.announcements !== 0 || result.notifications !== 0 || result.dedupe !== 0) {
    fail(`cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function verifySeededUserNotifications(announcementID, expected) {
  const result = JSON.parse(psql(`
    SELECT json_build_object(
      'notifications', (SELECT count(*) FROM notifications WHERE data->>'announcementId' = ${sqlLiteral(announcementID)} AND user_id IN (${testUserID}, ${otherUserID})),
      'dedupe', (SELECT count(*) FROM announcement_notifications WHERE announcement_id = ${sqlLiteral(announcementID)} AND user_id IN (${testUserID}, ${otherUserID}))
    )::text;
  `));
  if (result.notifications !== expected || result.dedupe !== expected) {
    fail(`seeded notification verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

try {
  assertGatewayAnnouncementRulesExact();
  seedUsers();

  const unauthenticated = request('GET', '/api/announcements?page=1&limit=10', null, '');
  assertStatus(unauthenticated, 401, 'GET /api/announcements without login');

  const forbidden = request('GET', '/api/admin/announcements?status=all&limit=50', null, nonAdminCookie);
  assertStatus(forbidden, 403, 'non-admin GET /api/admin/announcements');

  const created = request('POST', '/api/admin/announcements', {
    title,
    content: '公告 smoke 内容',
    status: 'draft',
  }, adminCookie);
  assertStatus(created, 201, 'POST /api/admin/announcements');
  const createdBody = parseBody(created, 'create announcement');
  const announcementID = createdBody.data?.announcement?.id;
  if (!createdBody.success || !announcementID || createdBody.data?.announcement?.status !== 'draft' || createdBody.data?.notifiedUsers !== 0) {
    fail(`create announcement body is invalid: ${created.body.slice(0, 800)}`);
  }

  const adminList = request('GET', '/api/admin/announcements?status=all&limit=50', null, adminCookie);
  assertStatus(adminList, 200, 'GET /api/admin/announcements');
  const adminListBody = parseBody(adminList, 'admin announcement list');
  if (!adminListBody.success || !adminListBody.data?.items?.some((item) => item.id === announcementID)) {
    fail(`admin announcement list body is invalid: ${adminList.body.slice(0, 800)}`);
  }

  const published = request('PATCH', `/api/admin/announcements/${announcementID}`, {
    status: 'published',
  }, adminCookie);
  assertStatus(published, 200, 'PATCH /api/admin/announcements/{id}');
  const publishedBody = parseBody(published, 'publish announcement');
  if (!publishedBody.success || publishedBody.data?.announcement?.status !== 'published' || publishedBody.data?.notifiedUsers < 2) {
    fail(`publish announcement body is invalid: ${published.body.slice(0, 800)}`);
  }
  const notificationState = verifySeededUserNotifications(announcementID, 2);

  const repeated = request('PATCH', `/api/admin/announcements/${announcementID}`, {
    status: 'published',
  }, adminCookie);
  assertStatus(repeated, 200, 'repeat PATCH /api/admin/announcements/{id}');
  const repeatedBody = parseBody(repeated, 'repeat publish announcement');
  if (repeatedBody.data?.notifiedUsers !== 0) {
    fail(`repeat publish should not notify again: ${repeated.body.slice(0, 800)}`);
  }
  verifySeededUserNotifications(announcementID, 2);

  const publicList = request('GET', '/api/announcements?page=1&limit=10', null, userCookie);
  assertStatus(publicList, 200, 'GET /api/announcements');
  const publicListBody = parseBody(publicList, 'public announcement list');
  if (!publicListBody.success || !publicListBody.data?.items?.some((item) => item.id === announcementID)) {
    fail(`public announcement list body is invalid: ${publicList.body.slice(0, 800)}`);
  }

  const archived = request('DELETE', `/api/admin/announcements/${announcementID}`, null, adminCookie);
  assertStatus(archived, 200, 'DELETE /api/admin/announcements/{id}');
  const archivedBody = parseBody(archived, 'archive announcement');
  if (!archivedBody.success || archivedBody.data?.announcement?.status !== 'archived') {
    fail(`archive announcement body is invalid: ${archived.body.slice(0, 800)}`);
  }

  cleanup();
  const cleanupResult = verifyCleanup();
  console.log(JSON.stringify({
    ok: true,
    mode: 'announcements-go-api-smoke',
    checkedPaths: [
      'GET /api/announcements',
      'GET /api/admin/announcements',
      'POST /api/admin/announcements',
      'PATCH /api/admin/announcements/{id}',
      'DELETE /api/admin/announcements/{id}',
    ],
    notificationState,
    cleanup: cleanupResult,
    gatewayAnnouncementRules: expectedGatewayAnnouncementRules,
  }, null, 2));
} catch (error) {
  try {
    cleanup();
  } catch {
    // 保留原始错误。
  }
  throw error;
}
