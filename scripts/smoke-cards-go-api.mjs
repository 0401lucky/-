import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const defaultBaseURL = 'http://127.0.0.1:8080';
const baseURL = (process.env.CARDS_GO_API_BASE_URL || defaultBaseURL).replace(/\/+$/, '');
const origin = process.env.CARDS_GO_API_ORIGIN || defaultBaseURL;
const cookie = process.env.CARDS_GO_API_COOKIE || '';
const useDocker = process.env.CARDS_GO_API_USE_DOCKER !== '0' && !process.env.CARDS_GO_API_BASE_URL;
const expectedGatewayCardRules = [
  'handle /api/cards/inventory {',
  'handle /api/cards/rules {',
  'handle /api/cards/draw {',
  'handle /api/cards/exchange {',
  'handle /api/cards/claim-reward {',
];

function fail(message) {
  console.error(`cards Go API smoke failed: ${message}`);
  process.exit(1);
}

function assertGatewayCardRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeCardRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => line.includes('/api/cards'));
  const actual = new Set(activeCardRules);
  const missing = expectedGatewayCardRules.filter((line) => !actual.has(line));
  const unexpected = activeCardRules.filter((line) => !expectedGatewayCardRules.includes(line));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(`gateway/Caddyfile card rules must be exact; missing=${missing.join('; ')} unexpected=${unexpected.join('; ')}`);
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

function assertInventoryPayload(payload, label) {
  if (!payload.success || !payload.data) {
    fail(`${label} payload is not compatible: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  const requiredFields = [
    'inventory',
    'fragments',
    'pityCounter',
    'pityRare',
    'pityEpic',
    'pityLegendary',
    'pityLegendaryRare',
    'drawsAvailable',
    'collectionRewards',
    'recentDraws',
  ];
  const missing = requiredFields.filter((field) => !(field in payload.data));
  if (missing.length > 0) {
    fail(`${label} missing fields: ${missing.join(', ')}`);
  }
}

async function main() {
  assertGatewayCardRulesExact();

  const ready = await request('GET', '/readyz');
  assertStatus(ready.status, 200, 'GET /readyz', ready.raw);
  const readyPayload = parseJSON(ready.body, 'GET /readyz');
  if (!readyPayload.ok || !readyPayload.postgres || !readyPayload.redis) {
    fail(`GET /readyz is not fully ready: ${ready.body}`);
  }

  const rules = await request('GET', '/api/cards/rules');
  assertStatus(rules.status, 200, 'GET /api/cards/rules', rules.raw);
  assertRulesPayload(parseJSON(rules.body, 'GET /api/cards/rules'), 'GET /api/cards/rules');

  const inventory = await request('GET', '/api/cards/inventory');
  assertStatus(inventory.status, 401, 'GET /api/cards/inventory without login', inventory.raw);

  const draw = await request('POST', '/api/cards/draw', '{"count":1}', {
    Origin: origin,
    'Content-Type': 'application/json',
  });
  assertStatus(draw.status, 401, 'POST /api/cards/draw without login', draw.raw);

  const exchange = await request('POST', '/api/cards/exchange', '{"cardId":"animal-s1-common-仓鼠"}', {
    Origin: origin,
    'Content-Type': 'application/json',
  });
  assertStatus(exchange.status, 401, 'POST /api/cards/exchange without login', exchange.raw);

  const claimReward = await request('POST', '/api/cards/claim-reward', '{"rewardType":"common","albumId":"animal-s1"}', {
    Origin: origin,
    'Content-Type': 'application/json',
  });
  assertStatus(claimReward.status, 401, 'POST /api/cards/claim-reward without login', claimReward.raw);

  if (cookie) {
    const authenticatedInventory = await request('GET', '/api/cards/inventory', '', { Cookie: cookie });
    assertStatus(authenticatedInventory.status, 200, 'GET /api/cards/inventory with CARDS_GO_API_COOKIE', authenticatedInventory.raw);
    assertInventoryPayload(
      parseJSON(authenticatedInventory.body, 'GET /api/cards/inventory with CARDS_GO_API_COOKIE'),
      'GET /api/cards/inventory with CARDS_GO_API_COOKIE',
    );
  }

  console.log(JSON.stringify({
    ok: true,
    mode: useDocker ? 'docker-compose-exec-api' : 'direct-fetch',
    baseURL,
    checkedUnauthenticatedPaths: 1,
    checkedUnauthenticatedWritePaths: 3,
    checkedPublicReadPaths: 1,
    checkedAuthenticatedReadPaths: cookie ? 1 : 0,
    gatewayCardRules: expectedGatewayCardRules,
  }, null, 2));
}

main().catch((error) => {
  fail(error?.stack || String(error));
});
