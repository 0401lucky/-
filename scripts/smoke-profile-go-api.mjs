import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const defaultBaseURL = 'http://127.0.0.1:8080';
const baseURL = (process.env.PROFILE_GO_API_BASE_URL || defaultBaseURL).replace(/\/+$/, '');
const origin = process.env.PROFILE_GO_API_ORIGIN || defaultBaseURL;
const cookie = process.env.PROFILE_GO_API_COOKIE || '';
const useDocker = process.env.PROFILE_GO_API_USE_DOCKER !== '0' && !process.env.PROFILE_GO_API_BASE_URL;

const getPaths = [
  '/api/profile/overview',
  '/api/profile/settings',
];

const putPaths = [
  ['/api/profile/settings', '{"displayName":"Smoke User"}'],
  ['/api/profile/achievements/equip', '{"achievementId":"beginner"}'],
];

const authenticatedReadPaths = [
  '/api/profile/overview',
  '/api/profile/settings',
];

function fail(message) {
  console.error(`profile Go API smoke failed: ${message}`);
  process.exit(1);
}

function assertGatewayProfileRulesDisabled() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  if (caddyfile.includes('/api/profile')) {
    fail('gateway/Caddyfile contains /api/profile; profile Gateway cutover must stay disabled for this smoke');
  }
}

function dockerWget(method, path, body = '', headers = {}) {
  if (method === 'PUT') {
    return dockerRawHTTP(method, path, body, headers);
  }

  const args = ['compose', 'exec', '-T', 'api', 'wget', '-S', '-O', '-'];
  for (const [key, value] of Object.entries(headers)) {
    args.push('--header', `${key}: ${value}`);
  }
  args.push(`${baseURL}${path}`);

  const result = spawnSync('docker', args, { encoding: 'utf8' });
  return {
    status: parseStatus(`${result.stderr}\n${result.stdout}`),
    body: result.stdout,
    raw: `${result.stderr}\n${result.stdout}`,
  };
}

function dockerRawHTTP(method, path, body = '', headers = {}) {
  const headerLines = [
    `${method} ${path} HTTP/1.1`,
    'Host: 127.0.0.1:8080',
    'Connection: close',
    `Content-Length: ${Buffer.byteLength(body)}`,
    ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
  ];
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
    'printf "%s" "$SMOKE_REQUEST" | nc -w 5 127.0.0.1 8080',
  ], { encoding: 'utf8' });
  return {
    status: parseStatus(`${result.stderr}\n${result.stdout}`),
    body: result.stdout.split('\r\n\r\n').slice(1).join('\r\n\r\n'),
    raw: `${result.stderr}\n${result.stdout}`,
  };
}

async function fetchRequest(method, path, body = '', headers = {}) {
  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers,
    body: method === 'PUT' ? body : undefined,
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
  assertGatewayProfileRulesDisabled();

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

  for (const [path, body] of putPaths) {
    const response = await request('PUT', path, body, {
      Origin: origin,
      'Content-Type': 'application/json',
    });
    assertStatus(response.status, 401, `PUT ${path} without login`, response.raw);
  }

  if (cookie) {
    for (const path of authenticatedReadPaths) {
      const response = await request('GET', path, '', { Cookie: cookie });
      assertStatus(response.status, 200, `GET ${path} with PROFILE_GO_API_COOKIE`, response.raw);
      const payload = parseJSON(response.body, `GET ${path} with PROFILE_GO_API_COOKIE`);
      if (!payload.success || !payload.data) {
        fail(`GET ${path} authenticated payload is not compatible: ${response.body.slice(0, 500)}`);
      }
    }
  }

  console.log(JSON.stringify({
    ok: true,
    mode: useDocker ? 'docker-compose-exec-api' : 'direct-fetch',
    baseURL,
    checkedUnauthenticatedPaths: getPaths.length + putPaths.length,
    checkedAuthenticatedReadPaths: cookie ? authenticatedReadPaths.length : 0,
    gatewayProfileRules: 'none',
  }, null, 2));
}

main().catch((error) => {
  fail(error?.stack || String(error));
});
