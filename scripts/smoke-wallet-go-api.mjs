import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const defaultBaseURL = 'http://127.0.0.1:8080';
const baseURL = (process.env.WALLET_GO_API_BASE_URL || defaultBaseURL).replace(/\/+$/, '');
const origin = process.env.WALLET_GO_API_ORIGIN || defaultBaseURL;
const cookie = process.env.WALLET_GO_API_COOKIE || '';
const expectNewAPIConfigured = process.env.WALLET_GO_API_EXPECT_NEW_API === '1';
const useDocker = process.env.WALLET_GO_API_USE_DOCKER !== '0' && !process.env.WALLET_GO_API_BASE_URL;

const unauthenticatedRequests = [
  ['GET', '/api/store/topup', ''],
  ['POST', '/api/store/topup', '{"dollars":1}'],
  ['POST', '/api/store/withdraw', '{"points":10}'],
];

function fail(message) {
  console.error(`wallet Go API smoke failed: ${message}`);
  process.exit(1);
}

function assertGatewayWalletRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeWalletRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) =>
      line.includes('/api/store/topup') ||
      line.includes('/api/store/withdraw') ||
      line.includes('/api/store*'),
    );
  const allowed = new Set([
    'handle /api/store/topup {',
    'handle /api/store/withdraw {',
  ]);
  const unexpected = activeWalletRules.filter((line) => !allowed.has(line));
  if (unexpected.length > 0) {
    fail(`gateway/Caddyfile contains unexpected wallet cutover rules: ${unexpected.join('; ')}`);
  }
  for (const line of allowed) {
    if (!activeWalletRules.includes(line)) {
      fail(`gateway/Caddyfile missing wallet cutover rule: ${line}`);
    }
  }
  return activeWalletRules;
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

function assertWalletBalancePayload(payload, label) {
  if (!payload.success || !payload.data) {
    fail(`${label} payload is not compatible: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  const requiredFields = [
    'newApiQuota',
    'newApiUsedQuota',
    'newApiBalanceDollars',
    'newApiBalanceWholeDollars',
    'quotaPerDollar',
  ];
  const missing = requiredFields.filter((field) => !(field in payload.data));
  if (missing.length > 0) {
    fail(`${label} missing fields: ${missing.join(', ')}`);
  }
}

async function main() {
  const gatewayWalletRules = assertGatewayWalletRulesExact();

  const ready = await request('GET', '/readyz');
  assertStatus(ready.status, 200, 'GET /readyz', ready.raw);
  const readyPayload = parseJSON(ready.body, 'GET /readyz');
  if (!readyPayload.ok || !readyPayload.postgres || !readyPayload.redis) {
    fail(`GET /readyz is not fully ready: ${ready.body}`);
  }

  for (const [method, path, body] of unauthenticatedRequests) {
    const headers = method === 'POST'
      ? { Origin: origin, 'Content-Type': 'application/json' }
      : {};
    const response = await request(method, path, body, headers);
    assertStatus(response.status, 401, `${method} ${path} without login`, response.raw);
  }

  let authenticatedReadStatus = null;
  if (cookie) {
    const response = await request('GET', '/api/store/topup', '', { Cookie: cookie });
    authenticatedReadStatus = response.status;
    const payload = parseJSON(response.body, 'GET /api/store/topup with WALLET_GO_API_COOKIE');

    if (expectNewAPIConfigured) {
      assertStatus(response.status, 200, 'GET /api/store/topup with WALLET_GO_API_COOKIE', response.raw);
      assertWalletBalancePayload(payload, 'GET /api/store/topup with WALLET_GO_API_COOKIE');
    } else if (response.status === 200) {
      assertWalletBalancePayload(payload, 'GET /api/store/topup with WALLET_GO_API_COOKIE');
    } else if (response.status === 503 && payload.code === 'NEW_API_NOT_CONFIGURED') {
      // 本地无 new-api 管理端配置时允许 503，但生产切流前必须用 EXPECT_NEW_API=1 复验。
    } else {
      fail(`GET /api/store/topup with WALLET_GO_API_COOKIE expected 200 or NEW_API_NOT_CONFIGURED, got ${response.status}: ${response.body.slice(0, 500)}`);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    mode: useDocker ? 'docker-compose-exec-api' : 'direct-fetch',
    baseURL,
    checkedUnauthenticatedPaths: unauthenticatedRequests.length,
    checkedAuthenticatedReadPaths: cookie ? 1 : 0,
    authenticatedReadStatus,
    newAPIConfiguredRequired: expectNewAPIConfigured,
    gatewayWalletRules,
  }, null, 2));
}

main().catch((error) => {
  fail(error?.stack || String(error));
});
