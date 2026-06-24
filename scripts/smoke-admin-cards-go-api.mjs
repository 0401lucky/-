import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const defaultBaseURL = 'http://127.0.0.1:8080';
const baseURL = (process.env.ADMIN_CARDS_GO_API_BASE_URL || defaultBaseURL).replace(/\/+$/, '');
const origin = process.env.ADMIN_CARDS_GO_API_ORIGIN || defaultBaseURL;
const cookie = process.env.ADMIN_CARDS_GO_API_COOKIE || '';
const nonAdminCookie = process.env.ADMIN_CARDS_GO_API_NON_ADMIN_COOKIE || '';
const useDocker = process.env.ADMIN_CARDS_GO_API_USE_DOCKER !== '0' && !process.env.ADMIN_CARDS_GO_API_BASE_URL;

function fail(message) {
  console.error(`admin cards Go API smoke failed: ${message}`);
  process.exit(1);
}

function assertGatewayCardRulesDisabled() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeCardRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => line.includes('/api/cards') || line.includes('/api/admin/cards'));
  if (activeCardRules.length > 0) {
    fail(`gateway/Caddyfile contains card cutover rules: ${activeCardRules.join('; ')}`);
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function dockerRawRequest(method, path, body = '', headers = {}) {
  const bodyBytes = Buffer.byteLength(body);
  const requestLines = [
    `${method} ${path} HTTP/1.1`,
    'Host: 127.0.0.1:8080',
    'Connection: close',
    ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
  ];
  if (bodyBytes > 0) {
    requestLines.push(`Content-Length: ${bodyBytes}`);
  }
  requestLines.push('', body);

  const rawRequest = requestLines.join('\r\n');
  const command = `(printf %s ${shellQuote(rawRequest)}; sleep 1) | nc -w 5 127.0.0.1 8080`;
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'api', 'sh', '-lc', command], { encoding: 'utf8' });
  const raw = `${result.stdout}\n${result.stderr}`;
  return {
    status: parseStatus(raw),
    body: responseBody(raw),
    raw,
  };
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
    body: body ? body : undefined,
  });
  return {
    status: response.status,
    body: await response.text(),
    raw: '',
  };
}

async function request(method, path, body = '', headers = {}) {
  if (useDocker) {
    if (method !== 'PATCH') {
      return dockerWget(method, path, body, headers);
    }
    return dockerRawRequest(method, path, body, headers);
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

function responseBody(output) {
  const separator = output.indexOf('\r\n\r\n');
  if (separator >= 0) {
    return output.slice(separator + 4).trim();
  }
  const fallback = output.indexOf('\n\n');
  if (fallback >= 0) {
    return output.slice(fallback + 2).trim();
  }
  return output.trim();
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

function assertAdminUsersPayload(payload, label) {
  if (!payload.success || !Array.isArray(payload.users) || !payload.pagination) {
    fail(`${label} payload is not compatible: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  for (const field of ['page', 'limit', 'total', 'totalPages', 'hasMore']) {
    if (!(field in payload.pagination)) {
      fail(`${label} pagination missing ${field}`);
    }
  }
}

function assertAdminAlbumsPayload(payload, label) {
  if (!payload.success || !Array.isArray(payload.albums) || !Array.isArray(payload.tiers)) {
    fail(`${label} payload is not compatible: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function assertRulesPayload(payload, label) {
  if (!payload.success || !payload.data) {
    fail(`${label} payload is not compatible: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  const requiredFields = [
    'rarityProbabilities',
    'pityThresholds',
    'cardDrawPrice',
    'fragmentValues',
    'exchangePrices',
    'updatedAt',
  ];
  const missing = requiredFields.filter((field) => !(field in payload.data));
  if (missing.length > 0) {
    fail(`${label} missing fields: ${missing.join(', ')}`);
  }
}

async function main() {
  assertGatewayCardRulesDisabled();

  const ready = await request('GET', '/readyz');
  assertStatus(ready.status, 200, 'GET /readyz', ready.raw);
  const readyPayload = parseJSON(ready.body, 'GET /readyz');
  if (!readyPayload.ok || !readyPayload.postgres || !readyPayload.redis) {
    fail(`GET /readyz is not fully ready: ${ready.body}`);
  }

  const unauthenticatedReads = [
    ['GET', '/api/admin/cards/users?page=1&limit=1'],
    ['GET', '/api/admin/cards/user/1'],
    ['GET', '/api/admin/cards/albums'],
    ['GET', '/api/admin/cards/rules'],
  ];
  for (const [method, path] of unauthenticatedReads) {
    const response = await request(method, path);
    assertStatus(response.status, 401, `${method} ${path} without login`, response.raw);
  }

  const writeHeaders = {
    Origin: origin,
    'Content-Type': 'application/json',
  };
  const unauthenticatedWrites = [
    ['POST', '/api/admin/cards/reset', '{"userId":1}'],
    ['POST', '/api/admin/cards/albums', '{"albumId":"animal-s1","reward":100}'],
    ['PATCH', '/api/admin/cards/rules', '{"cardDrawPrice":900}'],
  ];
  for (const [method, path, body] of unauthenticatedWrites) {
    const response = await request(method, path, body, writeHeaders);
    assertStatus(response.status, 401, `${method} ${path} without login`, response.raw);
  }

  const nonAdminChecks = [];
  if (nonAdminCookie) {
    const nonAdminRead = await request('GET', '/api/admin/cards/users?page=1&limit=1', '', { Cookie: nonAdminCookie });
    assertStatus(nonAdminRead.status, 403, 'GET /api/admin/cards/users with non-admin cookie', nonAdminRead.raw);
    nonAdminChecks.push('GET /api/admin/cards/users');

    const nonAdminWrite = await request('POST', '/api/admin/cards/reset', '{"userId":1}', {
      Cookie: nonAdminCookie,
      Origin: origin,
      'Content-Type': 'application/json',
    });
    assertStatus(nonAdminWrite.status, 403, 'POST /api/admin/cards/reset with non-admin cookie', nonAdminWrite.raw);
    nonAdminChecks.push('POST /api/admin/cards/reset');
  }

  if (cookie) {
    const authHeaders = { Cookie: cookie };
    const users = await request('GET', '/api/admin/cards/users?page=1&limit=1', '', authHeaders);
    assertStatus(users.status, 200, 'GET /api/admin/cards/users with ADMIN_CARDS_GO_API_COOKIE', users.raw);
    assertAdminUsersPayload(parseJSON(users.body, 'GET /api/admin/cards/users'), 'GET /api/admin/cards/users');

    const albums = await request('GET', '/api/admin/cards/albums', '', authHeaders);
    assertStatus(albums.status, 200, 'GET /api/admin/cards/albums with ADMIN_CARDS_GO_API_COOKIE', albums.raw);
    assertAdminAlbumsPayload(parseJSON(albums.body, 'GET /api/admin/cards/albums'), 'GET /api/admin/cards/albums');

    const rules = await request('GET', '/api/admin/cards/rules', '', authHeaders);
    assertStatus(rules.status, 200, 'GET /api/admin/cards/rules with ADMIN_CARDS_GO_API_COOKIE', rules.raw);
    assertRulesPayload(parseJSON(rules.body, 'GET /api/admin/cards/rules'), 'GET /api/admin/cards/rules');
  }

  console.log(JSON.stringify({
    ok: true,
    mode: useDocker ? 'docker-compose-exec-api' : 'direct-fetch',
    baseURL,
    checkedUnauthenticatedReadPaths: unauthenticatedReads.length,
    checkedUnauthenticatedWritePaths: unauthenticatedWrites.length,
    checkedNonAdminPaths: nonAdminChecks.length,
    checkedAuthenticatedReadPaths: cookie ? 3 : 0,
    gatewayCardRules: 'none',
  }, null, 2));
}

main().catch((error) => {
  fail(error?.stack || String(error));
});
