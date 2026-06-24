import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const adminCookie = makeSessionCookie(999951, 'admin', 'Admin Points Smoke');
const userCookie = makeSessionCookie(999952, 'not_admin', 'Not Admin');
const targetUserID = Number(process.env.ADMIN_POINTS_SMOKE_USER_ID || 999953);
const targetUsername = `admin_points_smoke_${targetUserID}`;

function fail(message) {
  throw new Error(`admin points Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `admin-points-smoke-${userID}-${now}`,
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
    DELETE FROM point_ledger WHERE user_id = ${targetUserID};
    DELETE FROM point_accounts WHERE user_id = ${targetUserID};
    DELETE FROM users WHERE id = ${targetUserID};
  `);
}

function seed() {
  cleanup();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES (${targetUserID}, ${sqlLiteral(targetUsername)}, 'Admin Points Smoke Target', now(), now());
    INSERT INTO point_accounts (user_id, balance, updated_at)
    VALUES (${targetUserID}, 100, now());
    INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
    VALUES ('admin-points-smoke-seed', ${targetUserID}, 100, 'admin_adjust', 'seed', 100, now() - interval '1 second');
  `);
}

try {
  seed();

  const forbidden = request('GET', `/api/admin/points?userId=${targetUserID}`, null, userCookie);
  assertStatus(forbidden, 403, 'non-admin GET /api/admin/points');

  const initial = request('GET', `/api/admin/points?userId=${targetUserID}&page=1&limit=10`);
  assertStatus(initial, 200, 'admin GET /api/admin/points');
  const initialBody = parseBody(initial, 'admin points initial');
  if (!initialBody.success || initialBody.data?.balance !== 100 || initialBody.data?.pagination?.total !== 1) {
    fail(`initial admin points body is invalid: ${initial.body.slice(0, 500)}`);
  }

  const add = request('POST', '/api/admin/points', {
    userId: String(targetUserID),
    amount: 33,
    description: 'smoke add',
  });
  assertStatus(add, 200, 'admin POST /api/admin/points add');
  const addBody = parseBody(add, 'admin points add');
  if (!addBody.success || addBody.data?.newBalance !== 133 || addBody.data?.adjustment !== 33) {
    fail(`admin points add result invalid: ${add.body.slice(0, 500)}`);
  }

  const deduct = request('POST', '/api/admin/points', {
    userId: targetUserID,
    amount: -10,
    description: 'smoke deduct',
  });
  assertStatus(deduct, 200, 'admin POST /api/admin/points deduct');
  const deductBody = parseBody(deduct, 'admin points deduct');
  if (!deductBody.success || deductBody.data?.newBalance !== 123 || deductBody.data?.adjustment !== -10) {
    fail(`admin points deduct result invalid: ${deduct.body.slice(0, 500)}`);
  }

  const insufficient = request('POST', '/api/admin/points', {
    userId: targetUserID,
    amount: -999999,
    description: 'smoke insufficient',
  });
  assertStatus(insufficient, 400, 'admin POST /api/admin/points insufficient');

  const verify = request('GET', `/api/admin/points?userId=${targetUserID}&page=1&limit=2`);
  assertStatus(verify, 200, 'admin GET /api/admin/points after writes');
  const verifyBody = parseBody(verify, 'admin points verify');
  const latestLog = verifyBody.data?.logs?.[0];
  if (
    !verifyBody.success ||
    verifyBody.data?.balance !== 123 ||
    verifyBody.data?.pagination?.total !== 3 ||
    verifyBody.data?.pagination?.hasMore !== true ||
    latestLog?.amount !== -10 ||
    !String(latestLog?.description || '').includes('[管理员:admin]')
  ) {
    fail(`admin points verify result invalid: ${verify.body.slice(0, 800)}`);
  }

  const stored = psql(`SELECT balance::text FROM point_accounts WHERE user_id = ${targetUserID};`);
  if (Number(stored) !== 123) {
    fail(`database balance mismatch: ${stored}`);
  }

  cleanup();
  console.log(JSON.stringify({
    ok: true,
    mode: 'admin-points-go-api-smoke',
    checkedPaths: ['GET /api/admin/points', 'POST /api/admin/points'],
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
