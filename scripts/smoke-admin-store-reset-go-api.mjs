import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const adminCookie = makeSessionCookie(999984, 'admin', 'Admin Store Reset Smoke');
const nonAdminCookie = makeSessionCookie(999985, 'not_admin', 'Not Admin');

function fail(message) {
  throw new Error(`admin store reset Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `admin-store-reset-smoke-${userID}-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function request(baseURL, cookie = adminCookie) {
  const origin = new URL(baseURL).origin;
  const code = `
    const response = await fetch('${baseURL}/api/admin/store/reset', {
      method: 'POST',
      headers: {
        'Cookie': ${JSON.stringify(cookie)},
        'Origin': ${JSON.stringify(origin)},
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
    fail(`request failed: ${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    fail(`request returned non-json wrapper: ${result.stdout}`);
  }
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    fail(`${label} expected HTTP ${expected}, got ${response.status}; body=${response.body.slice(0, 500)}`);
  }
}

function assertDisabled(response, label) {
  assertStatus(response, 410, label);
  if (!response.body.includes('ADMIN_STORE_RESET_DISABLED')) {
    fail(`${label} should return ADMIN_STORE_RESET_DISABLED; body=${response.body.slice(0, 500)}`);
  }
}

const nonAdmin = request('http://api:8080', nonAdminCookie);
assertStatus(nonAdmin, 403, 'non-admin POST /api/admin/store/reset');

const direct = request('http://api:8080');
assertDisabled(direct, 'direct Go POST /api/admin/store/reset');

const gateway = request('http://gateway:8080');
assertDisabled(gateway, 'gateway POST /api/admin/store/reset');

console.log(JSON.stringify({
  ok: true,
  mode: 'admin-store-reset-go-api-smoke',
  checkedPaths: ['POST /api/admin/store/reset'],
  gatewayCutover: 'checked',
}, null, 2));
