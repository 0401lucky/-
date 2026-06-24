import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const baseURL = 'http://127.0.0.1:8080';
const origin = process.env.FEEDBACK_GO_API_ORIGIN || baseURL;
const userID = Number(process.env.FEEDBACK_SMOKE_USER_ID || 999961);
const likerID = Number(process.env.FEEDBACK_SMOKE_LIKER_ID || 999962);
const adminID = Number(process.env.FEEDBACK_SMOKE_ADMIN_ID || 999963);
const username = `feedback_smoke_${userID}`;
const likerUsername = `feedback_liker_${likerID}`;
const adminUsername = 'admin';
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const userCookie = makeSessionCookie(userID, username, 'Feedback Smoke');
const likerCookie = makeSessionCookie(likerID, likerUsername, 'Feedback Liker');
const adminCookie = makeSessionCookie(adminID, adminUsername, 'Admin');

function fail(message) {
  throw new Error(`feedback Go API smoke failed: ${message}`);
}

function makeSessionCookie(id, name, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id,
    username: name,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `feedback-smoke-${id}-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayFeedbackRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => line.includes('/api/feedback') || line.includes('/api/admin/feedback'));
  const expectedRules = [
    'handle /api/admin/feedback {',
    'handle /api/admin/feedback/* {',
  ];
  const missingRules = expectedRules.filter((rule) => !activeRules.includes(rule));
  const unexpectedRules = activeRules.filter((rule) => !expectedRules.includes(rule));
  if (missingRules.length > 0 || unexpectedRules.length > 0) {
    fail(`gateway/Caddyfile feedback exact rules mismatch: missing=${missingRules.join('; ')} unexpected=${unexpectedRules.join('; ')}`);
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

function request(method, path, payload = null, cookie = '', extraHeaders = {}) {
  if (method === 'PATCH' || method === 'DELETE') {
    return rawHTTPRequest(method, path, payload == null ? '' : JSON.stringify(payload), cookie, {
      Origin: origin,
      'Content-Type': 'application/json',
      ...extraHeaders,
    });
  }
  const body = payload == null ? '' : JSON.stringify(payload);
  const args = ['compose', 'exec', '-T', 'api', 'wget', '-S', '-O', '-'];
  if (cookie) {
    args.push('--header', `Cookie: ${cookie}`);
  }
  if (method !== 'GET' && method !== 'HEAD') {
    args.push('--header', `Origin: ${origin}`);
    args.push('--header', 'Content-Type: application/json');
    args.push('--post-data', body);
  }
  if (method === 'HEAD') {
    args.push('--spider');
  }
  for (const [key, value] of Object.entries(extraHeaders)) {
    args.push('--header', `${key}: ${value}`);
  }
  args.push(`${baseURL}${path}`);
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  const raw = `${result.stdout}\n${result.stderr}`;
  return {
    status: parseStatus(raw),
    body: result.stdout,
    raw,
  };
}

function rawHTTPRequest(method, path, body = '', cookie = '', headers = {}) {
  const headerLines = [
    `${method} ${path} HTTP/1.1`,
    'Host: 127.0.0.1:8080',
    'Connection: close',
    `Content-Length: ${Buffer.byteLength(body)}`,
    ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
  ];
  if (cookie) {
    headerLines.push(`Cookie: ${cookie}`);
  }
  const requestPayload = `${headerLines.join('\r\n')}\r\n\r\n${body}`;
  const result = spawnSync('docker', [
    'compose',
    'exec',
    '-T',
    '-e',
    `SMOKE_REQUEST=${requestPayload}`,
    'api',
    'sh',
    '-c',
    '(printf "%s" "$SMOKE_REQUEST"; sleep 1) | nc -w 5 127.0.0.1 8080',
  ], { encoding: 'utf8' });
  const raw = `${result.stdout}\n${result.stderr}`;
  return {
    status: parseStatus(raw),
    body: result.stdout.split('\r\n\r\n').slice(1).join('\r\n\r\n'),
    raw,
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

function apiRequest(method, path, payload, cookie, label = `${method} ${path}`) {
  const response = request(method, path, payload, cookie);
  assertStatus(response, method === 'POST' ? 201 : 200, label);
  const body = parseJSON(response.body, label);
  if (!body.success) {
    fail(`${label} returned success=false: ${response.body.slice(0, 500)}`);
  }
  return body;
}

function cleanup() {
  psql(`
    DELETE FROM feedback_items WHERE user_id IN (${userID}, ${likerID}, ${adminID})
       OR username IN (${sqlLiteral(username)}, ${sqlLiteral(likerUsername)}, ${sqlLiteral(adminUsername)});
    DELETE FROM notifications WHERE user_id IN (${userID}, ${likerID}, ${adminID});
    DELETE FROM user_profiles WHERE user_id IN (${userID}, ${likerID}, ${adminID});
    DELETE FROM users WHERE id IN (${userID}, ${likerID}, ${adminID});
  `);
}

function seedUsers() {
  cleanup();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES
      (${userID}, ${sqlLiteral(username)}, 'Feedback Smoke', now(), now()),
      (${likerID}, ${sqlLiteral(likerUsername)}, 'Feedback Liker', now(), now()),
      (${adminID}, ${sqlLiteral(adminUsername)}, 'Admin', now(), now())
    ON CONFLICT (id) DO UPDATE
      SET username = excluded.username,
          display_name = excluded.display_name,
          updated_at = now();
    INSERT INTO user_profiles (user_id, display_name, avatar_url, updated_at_ms)
    VALUES
      (${userID}, '反馈冒烟用户', '', 1700000000000),
      (${likerID}, '反馈点赞用户', '', 1700000000000)
    ON CONFLICT (user_id) DO UPDATE
      SET display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          updated_at_ms = excluded.updated_at_ms;
  `);
}

function verifyStoredState(feedbackID) {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'items', (SELECT count(*) FROM feedback_items WHERE id = ${sqlLiteral(feedbackID)} AND user_id = ${userID} AND status = 'resolved'),
      'messages', (SELECT count(*) FROM feedback_messages WHERE feedback_id = ${sqlLiteral(feedbackID)}),
      'likes', (SELECT count(*) FROM feedback_likes WHERE feedback_id = ${sqlLiteral(feedbackID)}),
      'replyNotifications', (SELECT count(*) FROM notifications WHERE user_id = ${userID} AND type = 'feedback_reply' AND data->>'feedbackId' = ${sqlLiteral(feedbackID)}),
      'statusNotifications', (SELECT count(*) FROM notifications WHERE user_id = ${userID} AND type = 'feedback_status' AND data->>'feedbackId' = ${sqlLiteral(feedbackID)})
    )::text;
  `), 'feedback verification');
  if (
    result.items !== 1 ||
    result.messages !== 3 ||
    result.likes !== 1 ||
    result.replyNotifications !== 2 ||
    result.statusNotifications !== 2
  ) {
    fail(`feedback stored state mismatch: ${JSON.stringify(result)}`);
  }
  return result;
}

function verifyFeedbackDeleted(feedbackID) {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'items', (SELECT count(*) FROM feedback_items WHERE id = ${sqlLiteral(feedbackID)}),
      'messages', (SELECT count(*) FROM feedback_messages WHERE feedback_id = ${sqlLiteral(feedbackID)}),
      'likes', (SELECT count(*) FROM feedback_likes WHERE feedback_id = ${sqlLiteral(feedbackID)})
    )::text;
  `), 'feedback delete verification');
  if (result.items !== 0 || result.messages !== 0 || result.likes !== 0) {
    fail(`feedback delete verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function verifyCleanup() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'users', (SELECT count(*) FROM users WHERE id IN (${userID}, ${likerID}, ${adminID})),
      'feedback', (SELECT count(*) FROM feedback_items WHERE user_id IN (${userID}, ${likerID}, ${adminID})),
      'notifications', (SELECT count(*) FROM notifications WHERE user_id IN (${userID}, ${likerID}, ${adminID}))
    )::text;
  `), 'feedback cleanup verification');
  if (result.users !== 0 || result.feedback !== 0 || result.notifications !== 0) {
    fail(`feedback cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  assertGatewayFeedbackRulesExact();

  const ready = request('GET', '/readyz');
  assertStatus(ready, 200, 'GET /readyz');

  let feedbackID = '';
  let deleteFeedbackID = '';
  let verification = null;
  let deleteVerification = null;
  let cleanupResult = null;
  try {
    seedUsers();

    assertStatus(request('GET', '/api/feedback?scope=wall'), 401, 'GET /api/feedback without login');
    assertStatus(request('POST', '/api/feedback', { content: '未登录' }), 401, 'POST /api/feedback without login');

    const createPayload = apiRequest('POST', '/api/feedback', {
      title: '反馈冒烟',
      content: '反馈冒烟内容',
      contact: 'smoke@example.com',
      anonymous: false,
    }, userCookie, 'POST /api/feedback');
    feedbackID = createPayload.feedback?.id || '';
    if (!feedbackID || createPayload.firstMessage?.content !== '反馈冒烟内容') {
      fail(`unexpected create feedback payload: ${JSON.stringify(createPayload).slice(0, 500)}`);
    }

    const wall = apiRequest('GET', '/api/feedback?scope=wall&page=1&limit=10', null, userCookie, 'GET /api/feedback wall');
    if (!Array.isArray(wall.items) || !wall.items.some((item) => item.id === feedbackID && item.contact === undefined)) {
      fail(`wall payload does not include public feedback without contact: ${JSON.stringify(wall).slice(0, 500)}`);
    }

    const detail = apiRequest('GET', `/api/feedback/${feedbackID}`, null, userCookie, 'GET /api/feedback/{id}');
    if (detail.feedback?.contact !== 'smoke@example.com' || !Array.isArray(detail.messages) || detail.messages.length !== 1) {
      fail(`detail payload mismatch: ${JSON.stringify(detail).slice(0, 500)}`);
    }

    const likeResponse = request('POST', `/api/feedback/${feedbackID}/like`, null, likerCookie);
    assertStatus(likeResponse, 200, 'POST /api/feedback/{id}/like');
    const likePayload = parseJSON(likeResponse.body, 'POST /api/feedback/{id}/like');
    if (!likePayload.success || likePayload.likeCount !== 1 || !likePayload.likedByMe) {
      fail(`like payload mismatch: ${likeResponse.body.slice(0, 500)}`);
    }

    const userMessage = apiRequest('POST', `/api/feedback/${feedbackID}/messages`, {
      content: '普通用户评论',
    }, likerCookie, 'POST /api/feedback/{id}/messages');
    if (userMessage.feedbackMessage?.role !== 'user') {
      fail(`user message payload mismatch: ${JSON.stringify(userMessage).slice(0, 500)}`);
    }

    const adminMessage = apiRequest('POST', `/api/admin/feedback/${feedbackID}/messages`, {
      content: '管理员回复',
    }, adminCookie, 'POST /api/admin/feedback/{id}/messages');
    if (adminMessage.feedback?.status !== 'processing' || adminMessage.feedbackMessage?.role !== 'admin') {
      fail(`admin message payload mismatch: ${JSON.stringify(adminMessage).slice(0, 500)}`);
    }

    const patchResponse = request('PATCH', `/api/admin/feedback/${feedbackID}`, { status: 'resolved' }, adminCookie);
    assertStatus(patchResponse, 200, 'PATCH /api/admin/feedback/{id}');
    const patchPayload = parseJSON(patchResponse.body, 'PATCH /api/admin/feedback/{id}');
    if (!patchPayload.success || patchPayload.feedback?.status !== 'resolved') {
      fail(`patch payload mismatch: ${patchResponse.body.slice(0, 500)}`);
    }

    const adminList = apiRequest('GET', '/api/admin/feedback?page=1&limit=10', null, adminCookie, 'GET /api/admin/feedback');
    if (!Array.isArray(adminList.items) || !adminList.items.some((item) => item.id === feedbackID && item.contact === 'smoke@example.com')) {
      fail(`admin list payload mismatch: ${JSON.stringify(adminList).slice(0, 500)}`);
    }

    verification = verifyStoredState(feedbackID);

    const deleteTarget = apiRequest('POST', '/api/feedback', {
      title: '待删除反馈',
      content: '这条反馈会被管理员删除',
      anonymous: false,
    }, userCookie, 'POST /api/feedback delete target');
    deleteFeedbackID = deleteTarget.feedback?.id || '';
    if (!deleteFeedbackID) {
      fail(`delete target payload mismatch: ${JSON.stringify(deleteTarget).slice(0, 500)}`);
    }
    const deleteResponse = request('DELETE', `/api/admin/feedback/${deleteFeedbackID}`, null, adminCookie);
    assertStatus(deleteResponse, 200, 'DELETE /api/admin/feedback/{id}');
    const deletePayload = parseJSON(deleteResponse.body, 'DELETE /api/admin/feedback/{id}');
    if (!deletePayload.success || deletePayload.message !== '反馈已删除') {
      fail(`delete payload mismatch: ${deleteResponse.body.slice(0, 500)}`);
    }
    const repeatDeleteResponse = request('DELETE', `/api/admin/feedback/${deleteFeedbackID}`, null, adminCookie);
    assertStatus(repeatDeleteResponse, 404, 'DELETE /api/admin/feedback/{id} repeat');
    deleteVerification = verifyFeedbackDeleted(deleteFeedbackID);
  } finally {
    cleanup();
    cleanupResult = verifyCleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres',
    baseURL,
    userID,
    likerID,
    adminID,
    checkedPaths: [
      'GET /api/feedback',
      'POST /api/feedback',
      'GET /api/feedback/{id}',
      'POST /api/feedback/{id}/messages',
      'POST /api/feedback/{id}/like',
      'GET /api/admin/feedback',
      'POST /api/admin/feedback/{id}/messages',
      'PATCH /api/admin/feedback/{id}',
      'DELETE /api/admin/feedback/{id}',
    ],
    verification,
    deleteVerification,
    cleanup: cleanupResult,
    gatewayFeedbackRules: 'admin-feedback-exact',
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`feedback Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
