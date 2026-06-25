import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const defaultBaseURL = 'http://127.0.0.1:8080';
const baseURL = (process.env.NOTIFICATIONS_GO_API_BASE_URL || defaultBaseURL).replace(/\/+$/, '');
const origin = process.env.NOTIFICATIONS_GO_API_ORIGIN || defaultBaseURL;
const cookie = process.env.NOTIFICATIONS_GO_API_COOKIE || '';
const useDocker = process.env.NOTIFICATIONS_GO_API_USE_DOCKER !== '0' && !process.env.NOTIFICATIONS_GO_API_BASE_URL;

const getPaths = [
  '/api/notifications?page=1&limit=5',
  '/api/notifications/unread-count',
];

const postPaths = [
  ['/api/notifications/read', '{"ids":["smoke-notification"],"markAll":false}'],
  ['/api/notifications/delete', '{"ids":["smoke-notification"]}'],
  ['/api/notifications/claim', '{"notificationId":"smoke-notification"}'],
];

const authenticatedReadPaths = [
  '/api/notifications?page=1&limit=5',
  '/api/notifications/unread-count',
];

const expectedGatewayNotificationRules = [
  'handle /api/notifications {',
  'handle /api/notifications/unread-count {',
  'handle /api/notifications/read {',
  'handle /api/notifications/delete {',
  'handle /api/notifications/claim {',
];

function fail(message) {
  console.error(`notifications Go API smoke failed: ${message}`);
  process.exit(1);
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

function dockerWget(method, path, body = '', headers = {}) {
  const args = ['compose', 'exec', '-T', 'api', 'wget', '-S', '-O', '-'];
  for (const [key, value] of Object.entries(headers)) {
    args.push('--header', `${key}: ${value}`);
  }
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

async function fetchRequest(method, path, body = '', headers = {}) {
  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers,
    body: method === 'POST' ? body : undefined,
  });
  return {
    status: response.status,
    body: await response.text(),
    raw: '',
  };
}

async function request(method, path, body = '', headers = {}) {
  if (useDocker) {
    return dockerWget(method, path, body, headers);
  }
  return fetchRequest(method, path, body, headers);
}

function parseStatus(output) {
  const matches = [...output.matchAll(/HTTP\/\d(?:\.\d)?\s+(\d{3})/g)];
  if (matches.length === 0) {
    return 0;
  }
  return Number(matches[matches.length - 1][1]);
}

function parseJSON(body, label) {
  try {
    return JSON.parse(body);
  } catch {
    fail(`${label} did not return JSON: ${body.slice(0, 200)}`);
  }
}

function assertStatus(actual, expected, label, raw = '') {
  if (actual !== expected) {
    fail(`${label} expected HTTP ${expected}, got ${actual}; raw=${raw.slice(0, 500)}`);
  }
}

async function main() {
  assertGatewayNotificationRulesExact();

  const ready = await request('GET', '/readyz');
  assertStatus(ready.status, 200, 'GET /readyz', ready.raw);
  const readyPayload = parseJSON(ready.body, 'GET /readyz');
  if (!readyPayload.ok || !readyPayload.postgres || !readyPayload.redis) {
    fail(`GET /readyz is not fully ready: ${ready.body}`);
  }

  for (const path of getPaths) {
    const response = await request('GET', path);
    assertStatus(response.status, 401, `GET ${path} without login`, response.raw);
  }

  for (const [path, body] of postPaths) {
    const response = await request('POST', path, body, {
      Origin: origin,
      'Content-Type': 'application/json',
    });
    assertStatus(response.status, 401, `POST ${path} without login`, response.raw);
  }

  if (cookie) {
    for (const path of authenticatedReadPaths) {
      const response = await request('GET', path, '', { Cookie: cookie });
      assertStatus(response.status, 200, `GET ${path} with NOTIFICATIONS_GO_API_COOKIE`, response.raw);
      const payload = parseJSON(response.body, `GET ${path} with NOTIFICATIONS_GO_API_COOKIE`);
      if (!payload.success || !payload.data) {
        fail(`GET ${path} authenticated payload is not compatible: ${response.body.slice(0, 500)}`);
      }
    }
  }

  console.log(JSON.stringify({
    ok: true,
    mode: useDocker ? 'docker-compose-exec-api' : 'direct-fetch',
    baseURL,
    checkedUnauthenticatedPaths: getPaths.length + postPaths.length,
    checkedAuthenticatedReadPaths: cookie ? authenticatedReadPaths.length : 0,
    gatewayNotificationRules: expectedGatewayNotificationRules,
  }, null, 2));
}

main().catch((error) => {
  fail(error?.stack || String(error));
});
