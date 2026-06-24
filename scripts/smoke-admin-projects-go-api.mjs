import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const adminCookie = makeSessionCookie(999971, 'admin', 'Admin Projects Smoke');
const userCookie = makeSessionCookie(999972, 'not_admin', 'Not Admin');
const suffix = String(process.env.ADMIN_PROJECTS_SMOKE_SUFFIX || Date.now());
const projectName = `后台项目 smoke ${suffix}`;
const testUserID = Number(process.env.ADMIN_PROJECTS_SMOKE_USER_ID || 999973);
const exchangeID = `admin-projects-smoke-exchange-${suffix}`;

function fail(message) {
  throw new Error(`admin projects Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `admin-projects-smoke-${userID}-${now}`,
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

function request(method, path, payload, cookie = adminCookie, contentType = 'application/json') {
  const bodyExpression = payload == null
    ? 'undefined'
    : contentType === 'application/x-www-form-urlencoded'
      ? JSON.stringify(new URLSearchParams(payload).toString())
      : JSON.stringify(JSON.stringify(payload));
  const code = `
    const response = await fetch('http://api:8080${path}', {
      method: ${JSON.stringify(method)},
      headers: {
        'Cookie': ${JSON.stringify(cookie)},
        'Origin': 'http://api:8080',
        'Content-Type': ${JSON.stringify(contentType)}
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

function cleanup(projectID = '') {
  psql(`
    DELETE FROM exchange_logs
     WHERE id = ${sqlLiteral(exchangeID)}
        OR item_name = ${sqlLiteral(projectName)}
        OR (${projectID ? `item_id = ${sqlLiteral(projectID)}` : 'false'});
    DELETE FROM point_accounts WHERE user_id = ${testUserID};
    DELETE FROM users WHERE id = ${testUserID};
    DELETE FROM projects
     WHERE name = ${sqlLiteral(projectName)}
        OR id = ${projectID ? sqlLiteral(projectID) : "''"}
        OR id = ${sqlLiteral(`admin-projects-smoke-code-${suffix}`)};
  `);
}

function seedRecord(projectID) {
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES (${testUserID}, 'admin_projects_smoke_user', 'Admin Projects Smoke User', now(), now())
    ON CONFLICT (id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name;

    INSERT INTO exchange_logs (id, user_id, item_id, item_name, points_cost, value, type, quantity, created_at)
    VALUES (${sqlLiteral(exchangeID)}, ${testUserID}, ${sqlLiteral(projectID)}, ${sqlLiteral(projectName)}, 0, 12, 'project_direct', 1, now())
    ON CONFLICT (id) DO UPDATE SET item_id = excluded.item_id, item_name = excluded.item_name;
  `);
}

try {
  cleanup();

  const forbidden = request('GET', '/api/admin/projects', null, userCookie);
  assertStatus(forbidden, 403, 'non-admin GET /api/admin/projects');

  const create = request('POST', '/api/admin/projects', {
    name: projectName,
    description: '后台项目 smoke',
    maxClaims: '2',
    directPoints: '12',
    newUserOnly: 'true',
  }, adminCookie, 'application/x-www-form-urlencoded');
  assertStatus(create, 200, 'admin POST /api/admin/projects');
  const createBody = parseBody(create, 'admin projects create');
  const projectID = createBody.project?.id;
  if (
    !createBody.success ||
    !projectID ||
    createBody.project?.rewardType !== 'direct' ||
    createBody.project?.directPoints !== 12 ||
    createBody.project?.maxClaims !== 2 ||
    createBody.codesAdded !== 0
  ) {
    fail(`admin project create body is invalid: ${create.body.slice(0, 800)}`);
  }

  seedRecord(projectID);

  const list = request('GET', '/api/admin/projects');
  assertStatus(list, 200, 'admin GET /api/admin/projects');
  const listBody = parseBody(list, 'admin projects list');
  if (!listBody.success || !Array.isArray(listBody.projects) || !listBody.projects.some((project) => project.id === projectID)) {
    fail(`admin projects list body is invalid: ${list.body.slice(0, 800)}`);
  }

  const detail = request('GET', `/api/admin/projects/${projectID}`);
  assertStatus(detail, 200, 'admin GET /api/admin/projects/{id}');
  const detailBody = parseBody(detail, 'admin project detail');
  if (
    !detailBody.success ||
    detailBody.project?.id !== projectID ||
    detailBody.records?.[0]?.userId !== testUserID ||
    detailBody.records?.[0]?.creditedPoints !== 12
  ) {
    fail(`admin project detail body is invalid: ${detail.body.slice(0, 1000)}`);
  }

  const patch = request('PATCH', `/api/admin/projects/${projectID}`, {
    name: `${projectName} updated`,
    description: 'updated',
    status: 'paused',
    pinned: true,
    maxClaims: 4,
  });
  assertStatus(patch, 200, 'admin PATCH /api/admin/projects/{id}');

  const append = request('POST', `/api/admin/projects/${projectID}`, {
    appendClaims: '3',
  }, adminCookie, 'application/x-www-form-urlencoded');
  assertStatus(append, 200, 'admin POST /api/admin/projects/{id}');
  const appendBody = parseBody(append, 'admin project append');
  if (!appendBody.success || appendBody.appended !== 3 || appendBody.maxClaims !== 7) {
    fail(`admin project append body is invalid: ${append.body.slice(0, 800)}`);
  }

  const stored = psql(`SELECT max_claims::text || ':' || codes_count::text || ':' || status FROM projects WHERE id = ${sqlLiteral(projectID)};`);
  if (stored !== '7:7:paused') {
    fail(`database project state mismatch: ${stored}`);
  }

  const legacyID = `admin-projects-smoke-code-${suffix}`;
  psql(`
    INSERT INTO projects (
      id, name, description, max_claims, claimed_count, codes_count,
      status, created_at_ms, created_by, reward_type, direct_points, new_user_only
    ) VALUES (${sqlLiteral(legacyID)}, '历史兑换码 smoke ${suffix}', '只读', 1, 0, 1, 'active', ${Date.now()}, 'admin', 'code', NULL, false);
  `);
  const legacyAppend = request('POST', `/api/admin/projects/${legacyID}`, {
    appendClaims: '1',
  }, adminCookie, 'application/x-www-form-urlencoded');
  assertStatus(legacyAppend, 400, 'legacy code project append');

  const deleted = request('DELETE', `/api/admin/projects/${projectID}`);
  assertStatus(deleted, 200, 'admin DELETE /api/admin/projects/{id}');
  const remaining = psql(`SELECT COUNT(*)::text FROM projects WHERE id = ${sqlLiteral(projectID)};`);
  if (Number(remaining) !== 0) {
    fail(`project should be deleted, remaining=${remaining}`);
  }

  cleanup(projectID);
  psql(`DELETE FROM projects WHERE id = ${sqlLiteral(legacyID)};`);
  console.log(JSON.stringify({
    ok: true,
    mode: 'admin-projects-go-api-smoke',
    checkedPaths: [
      'GET /api/admin/projects',
      'POST /api/admin/projects',
      'GET /api/admin/projects/{id}',
      'PATCH /api/admin/projects/{id}',
      'POST /api/admin/projects/{id}',
      'DELETE /api/admin/projects/{id}',
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
