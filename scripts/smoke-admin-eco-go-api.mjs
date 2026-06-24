import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const adminCookie = makeSessionCookie(999941, 'admin', 'Admin Eco Smoke');
const userCookie = makeSessionCookie(999942, 'not_admin', 'Not Admin');
const testUserID = Number(process.env.ADMIN_ECO_SMOKE_USER_ID || 999943);
const testUsername = `admin_eco_smoke_${testUserID}`;

function fail(message) {
  throw new Error(`admin eco Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `admin-eco-smoke-${userID}-${now}`,
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

function cleanup() {
  psql(`
    DELETE FROM eco_trash_rankings WHERE user_id = ${testUserID};
    DELETE FROM eco_prize_inventory WHERE user_id = ${testUserID};
    DELETE FROM eco_prize_lots WHERE user_id = ${testUserID};
    DELETE FROM eco_thefts WHERE original_user_id = ${testUserID} OR thief_user_id = ${testUserID};
    DELETE FROM user_profiles WHERE user_id = ${testUserID};
    DELETE FROM users WHERE id = ${testUserID};
    DELETE FROM eco_prize_rate_settings WHERE prize_key = 'coin';
  `);
}

function seed() {
  cleanup();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES (${testUserID}, ${sqlLiteral(testUsername)}, 'Admin Eco Smoke User', now(), now());
    INSERT INTO user_profiles (user_id, display_name, avatar_url, updated_at_ms)
    VALUES (${testUserID}, 'Admin Eco Profile', 'https://example.com/admin-eco.webp', ${Date.now()});
    INSERT INTO eco_prize_inventory (user_id, prize_key, inventory_count, limited_count, lifetime_claim_count)
    VALUES (${testUserID}, 'coin', 1, 0, 2);
    INSERT INTO eco_trash_rankings (period, period_key, user_id, trash_cleared)
    VALUES ('daily', (now() AT TIME ZONE 'Asia/Shanghai')::date::text, ${testUserID}, 11);
  `);
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    fail(`${label} expected HTTP ${expected}, got ${response.status}; body=${response.body.slice(0, 500)}`);
  }
}

function findPrize(prizes, key) {
  return prizes.find((prize) => prize.key === key);
}

try {
  seed();

  const forbidden = request('GET', '/api/admin/eco', null, userCookie);
  assertStatus(forbidden, 403, 'non-admin GET /api/admin/eco');

  const initial = request('GET', '/api/admin/eco');
  assertStatus(initial, 200, 'admin GET /api/admin/eco');
  const initialBody = parseBody(initial, 'admin eco initial');
  if (!initialBody.success || !Array.isArray(initialBody.data?.prizes)) {
    fail(`admin eco initial body is invalid: ${initial.body.slice(0, 500)}`);
  }

  const patch = request('PATCH', '/api/admin/eco', { prizeRates: { coin: 0.0123 } });
  assertStatus(patch, 200, 'admin PATCH /api/admin/eco');
  const patchBody = parseBody(patch, 'admin eco patch');
  const patchedCoin = findPrize(patchBody.data?.prizes ?? [], 'coin');
  if (!patchBody.success || !patchedCoin || patchedCoin.currentRate !== 0.0123) {
    fail(`admin eco patch did not update coin rate: ${patch.body.slice(0, 500)}`);
  }

  const invalid = request('PATCH', '/api/admin/eco', { prizeRates: { coin: 1, photo: 1 } });
  assertStatus(invalid, 400, 'invalid admin PATCH /api/admin/eco');

  const verify = request('GET', '/api/admin/eco');
  assertStatus(verify, 200, 'admin GET /api/admin/eco after patch');
  const verifyBody = parseBody(verify, 'admin eco verify');
  const verifyCoin = findPrize(verifyBody.data?.prizes ?? [], 'coin');
  const smokeHolder = verifyCoin?.holders?.find((holder) => holder.userId === testUserID);
  if (!verifyCoin || verifyCoin.currentRate !== 0.0123 || !smokeHolder || smokeHolder.currentCount !== 1) {
    fail(`admin eco verify did not expose rate and holder: ${verify.body.slice(0, 800)}`);
  }

  const stored = psql(`SELECT spawn_rate::text FROM eco_prize_rate_settings WHERE prize_key = 'coin';`);
  if (Number(stored) !== 0.0123) {
    fail(`database coin spawn_rate mismatch: ${stored}`);
  }

  cleanup();
  console.log(JSON.stringify({
    ok: true,
    mode: 'admin-eco-go-api-smoke',
    checkedPaths: ['GET /api/admin/eco', 'PATCH /api/admin/eco'],
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
