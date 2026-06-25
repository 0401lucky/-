import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const baseURL = process.env.ADMIN_LEGACY_TOOLS_SMOKE_BASE_URL || 'http://127.0.0.1:8080';
const adminUserID = Number(process.env.ADMIN_LEGACY_TOOLS_SMOKE_ADMIN_ID || 1);
const sessionSecret = process.env.ADMIN_LEGACY_TOOLS_SMOKE_SESSION_SECRET || 'local-development-session-secret-at-least-32-chars';

const disabledPaths = [
  '/api/admin/sync-users',
  '/api/admin/fix-codes-count',
  '/api/admin/migrate-native-hot-data',
  '/api/admin/migrate-new-user-eligibility',
];

function fail(message) {
  throw new Error(`admin legacy tools Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `admin-legacy-tools-smoke-${userID}-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => disabledPaths.some((path) => line.includes(path)));

  const expectedRules = disabledPaths.map((path) => `handle ${path} {`);
  const missing = expectedRules.filter((line) => !activeRules.includes(line));
  const unexpected = activeRules.filter((line) => !expectedRules.includes(line));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(`gateway/Caddyfile legacy tool rules mismatch: missing=${missing.join('; ')} unexpected=${unexpected.join('; ')}`);
  }
}

async function requestDisabledPath(path, cookie) {
  const response = await fetch(`${baseURL}${path}`, {
    method: 'POST',
    headers: {
      Origin: baseURL,
      Cookie: cookie,
    },
  });
  const body = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(body);
  } catch {
    fail(`${path} did not return JSON: ${body.slice(0, 300)}`);
  }
  if (response.status !== 410) {
    fail(`${path} expected HTTP 410, got ${response.status}: ${body.slice(0, 500)}`);
  }
  if (payload?.code !== 'ADMIN_LEGACY_TOOL_DISABLED') {
    fail(`${path} expected ADMIN_LEGACY_TOOL_DISABLED, got ${body.slice(0, 500)}`);
  }
  return { path, status: response.status, code: payload.code };
}

async function main() {
  assertGatewayRulesExact();
  const cookie = makeSessionCookie(adminUserID, 'admin', 'Admin');
  const results = [];
  for (const path of disabledPaths) {
    results.push(await requestDisabledPath(path, cookie));
  }
  console.log(JSON.stringify({
    ok: true,
    mode: 'admin-legacy-tools-go-api-smoke',
    baseURL,
    checkedPaths: results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
