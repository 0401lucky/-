import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const baseURL = 'http://127.0.0.1:8080';
const origin = process.env.STORE_GO_API_ORIGIN || baseURL;
const testUserID = Number(process.env.STORE_SMOKE_USER_ID || 999911);
const adminUserID = Number(process.env.STORE_SMOKE_ADMIN_USER_ID || 999912);
const testUsername = `store_smoke_${testUserID}`;
const adminUsername = 'admin';
const categoryID = process.env.STORE_SMOKE_CATEGORY_ID || 'store-smoke-category';
const itemID = process.env.STORE_SMOKE_ITEM_ID || 'store-smoke-makeup-card';
const idempotencyKey = process.env.STORE_SMOKE_IDEMPOTENCY_KEY || `store-smoke-${testUserID}`;
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const userCookie = makeSessionCookie(testUserID, testUsername, 'Store Smoke');
const adminCookie = makeSessionCookie(adminUserID, adminUsername, 'Admin');

function fail(message) {
  throw new Error(`store Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `store-smoke-${userID}-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayStoreRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => line.includes('/api/store'));
  const allowed = new Set([
    'handle /api/store {',
    'handle /api/store/exchange {',
    'handle /api/store/topup {',
    'handle /api/store/withdraw {',
    'handle /api/store/admin {',
  ]);
  const unexpected = activeRules.filter((line) => !allowed.has(line));
  if (unexpected.length > 0) {
    fail(`gateway/Caddyfile contains unexpected store rules: ${unexpected.join('; ')}`);
  }
  for (const line of allowed) {
    if (!activeRules.includes(line)) {
      fail(`gateway/Caddyfile missing store rule: ${line}`);
    }
  }
  return activeRules;
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

function parseStatus(output) {
  const matches = [...output.matchAll(/HTTP\/\d(?:\.\d)?\s+(\d{3})/g)];
  return matches.length ? Number(matches[matches.length - 1][1]) : 0;
}

function request(method, path, payload = null, cookie = '', extraHeaders = {}) {
  const body = payload == null ? '' : JSON.stringify(payload);
  const args = ['compose', 'exec', '-T', 'api', 'wget', '-S', '-O', '-'];
  if (cookie) {
    args.push('--header', `Cookie: ${cookie}`);
  }
  if (method !== 'GET') {
    args.push('--header', `Origin: ${origin}`);
    args.push('--header', 'Content-Type: application/json');
    args.push('--post-data', body);
  }
  for (const [key, value] of Object.entries(extraHeaders)) {
    args.push('--header', `${key}: ${value}`);
  }
  args.push(`${baseURL}${path}`);
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  const raw = `${result.stdout}\n${result.stderr}`;
  return {
    status: parseStatus(raw),
    body: result.stdout,
    raw,
  };
}

function parseJSON(body, label) {
  try {
    return JSON.parse(body);
  } catch {
    fail(`${label} did not return JSON: ${body.slice(0, 300)}`);
  }
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    fail(`${label} expected HTTP ${expected}, got ${response.status}; raw=${response.raw.slice(0, 500)}`);
  }
}

function apiRequest(method, path, payload, cookie, label = `${method} ${path}`, extraHeaders = {}) {
  const response = request(method, path, payload, cookie, extraHeaders);
  assertStatus(response, 200, label);
  const body = parseJSON(response.body, label);
  if (!body.success) {
    fail(`${label} returned success=false: ${response.body.slice(0, 500)}`);
  }
  return body;
}

function cleanup() {
  psql(`
    DELETE FROM idempotency_keys WHERE scope IN (${sqlLiteral(`store:exchange:${testUserID}`)}, ${sqlLiteral(`store:exchange:${adminUserID}`)})
       OR key = ${sqlLiteral(idempotencyKey)};
    DELETE FROM exchange_logs WHERE user_id IN (${testUserID}, ${adminUserID}) OR item_id = ${sqlLiteral(itemID)};
    DELETE FROM store_daily_purchases WHERE user_id IN (${testUserID}, ${adminUserID}) OR item_id = ${sqlLiteral(itemID)};
    DELETE FROM user_assets WHERE user_id IN (${testUserID}, ${adminUserID});
    DELETE FROM point_ledger WHERE user_id IN (${testUserID}, ${adminUserID});
    DELETE FROM point_accounts WHERE user_id IN (${testUserID}, ${adminUserID});
    DELETE FROM store_items WHERE id = ${sqlLiteral(itemID)};
    DELETE FROM store_categories WHERE id = ${sqlLiteral(categoryID)};
    DELETE FROM users WHERE id IN (${testUserID}, ${adminUserID});
  `);
}

function seedData() {
  cleanup();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES
      (${testUserID}, ${sqlLiteral(testUsername)}, 'Store Smoke', now(), now()),
      (${adminUserID}, ${sqlLiteral(adminUsername)}, 'Admin', now(), now());
    INSERT INTO point_accounts (user_id, balance, updated_at)
    VALUES (${testUserID}, 100, now()), (${adminUserID}, 100, now());
    INSERT INTO store_categories (id, name, color, sort_order, enabled, created_at, updated_at)
    VALUES (${sqlLiteral(categoryID)}, '冒烟测试', '#22c55e', 9999, true, now(), now());
    INSERT INTO store_items (
      id, name, description, type, category_id, points_cost, value,
      daily_limit, total_stock, purchase_count, sort_order, enabled,
      created_at, updated_at
    ) VALUES (
      ${sqlLiteral(itemID)}, '冒烟补签卡', 'Go API smoke item', 'makeup_card',
      ${sqlLiteral(categoryID)}, 10, 2, 1, NULL, 0, 9999, true, now(), now()
    );
  `);
}

function assertStoreHomePayload(payload, label) {
  if (!payload.data || !Array.isArray(payload.data.items) || !Array.isArray(payload.data.categories)) {
    fail(`${label} missing items/categories: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  for (const field of ['balance', 'recentExchanges', 'dailyLimit', 'dailyEarned']) {
    if (!(field in payload.data)) {
      fail(`${label} missing field ${field}: ${JSON.stringify(payload).slice(0, 500)}`);
    }
  }
  if (!payload.data.items.some((item) => item.id === itemID && item.type === 'makeup_card')) {
    fail(`${label} missing seeded store item: ${JSON.stringify(payload.data.items).slice(0, 500)}`);
  }
  if (!payload.data.categories.some((category) => category.id === categoryID)) {
    fail(`${label} missing seeded store category: ${JSON.stringify(payload.data.categories).slice(0, 500)}`);
  }
}

function assertStoreAdminPayload(payload, label) {
  if (!payload.data || !Array.isArray(payload.data.items) || !Array.isArray(payload.data.categories) || !Array.isArray(payload.data.farmItems)) {
    fail(`${label} missing admin data shape: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  if (!payload.data.items.some((item) => item.id === itemID)) {
    fail(`${label} missing seeded admin item: ${JSON.stringify(payload.data.items).slice(0, 500)}`);
  }
  if (!payload.data.categories.some((category) => category.id === categoryID)) {
    fail(`${label} missing seeded admin category: ${JSON.stringify(payload.data.categories).slice(0, 500)}`);
  }
}

function verifyIdempotentExchange() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'balance', (SELECT balance FROM point_accounts WHERE user_id = ${testUserID}),
      'exchange_logs', (SELECT count(*) FROM exchange_logs WHERE user_id = ${testUserID} AND item_id = ${sqlLiteral(itemID)}),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID} AND source = 'exchange'),
      'makeup_cards', COALESCE((SELECT makeup_cards FROM user_assets WHERE user_id = ${testUserID}), 0),
      'daily_purchases', COALESCE((SELECT purchase_count FROM store_daily_purchases WHERE user_id = ${testUserID} AND item_id = ${sqlLiteral(itemID)} AND stat_date = (now() AT TIME ZONE 'Asia/Shanghai')::date), 0),
      'item_purchase_count', COALESCE((SELECT purchase_count FROM store_items WHERE id = ${sqlLiteral(itemID)}), 0),
      'idempotency_count', (SELECT count(*) FROM idempotency_keys WHERE scope = ${sqlLiteral(`store:exchange:${testUserID}`)} AND key = ${sqlLiteral(idempotencyKey)})
    )::text;
  `), 'store exchange verification');
  if (
    result.balance !== 90 ||
    result.exchange_logs !== 1 ||
    result.ledger_count !== 1 ||
    result.makeup_cards !== 2 ||
    result.daily_purchases !== 1 ||
    result.item_purchase_count !== 1 ||
    result.idempotency_count !== 1
  ) {
    fail(`store exchange verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function verifyCleanup() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'users', (SELECT count(*) FROM users WHERE id IN (${testUserID}, ${adminUserID})),
      'accounts', (SELECT count(*) FROM point_accounts WHERE user_id IN (${testUserID}, ${adminUserID})),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id IN (${testUserID}, ${adminUserID})),
      'exchange_logs', (SELECT count(*) FROM exchange_logs WHERE user_id IN (${testUserID}, ${adminUserID}) OR item_id = ${sqlLiteral(itemID)}),
      'daily_purchases', (SELECT count(*) FROM store_daily_purchases WHERE user_id IN (${testUserID}, ${adminUserID}) OR item_id = ${sqlLiteral(itemID)}),
      'assets', (SELECT count(*) FROM user_assets WHERE user_id IN (${testUserID}, ${adminUserID})),
      'item_exists', EXISTS(SELECT 1 FROM store_items WHERE id = ${sqlLiteral(itemID)}),
      'category_exists', EXISTS(SELECT 1 FROM store_categories WHERE id = ${sqlLiteral(categoryID)}),
      'idempotency_count', (SELECT count(*) FROM idempotency_keys WHERE scope IN (${sqlLiteral(`store:exchange:${testUserID}`)}, ${sqlLiteral(`store:exchange:${adminUserID}`)}) OR key = ${sqlLiteral(idempotencyKey)})
    )::text;
  `), 'store cleanup verification');
  if (
    result.users !== 0 ||
    result.accounts !== 0 ||
    result.ledger_count !== 0 ||
    result.exchange_logs !== 0 ||
    result.daily_purchases !== 0 ||
    result.assets !== 0 ||
    result.item_exists ||
    result.category_exists ||
    result.idempotency_count !== 0
  ) {
    fail(`store cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  const gatewayRules = assertGatewayStoreRulesExact();

  const ready = request('GET', '/readyz');
  assertStatus(ready, 200, 'GET /readyz');

  let verification = null;
  let cleanupResult = null;
  try {
    seedData();

    assertStatus(request('GET', '/api/store'), 401, 'GET /api/store without login');
    assertStatus(request('POST', '/api/store/exchange', { itemId: itemID }), 401, 'POST /api/store/exchange without login');

    const storeHome = apiRequest('GET', '/api/store', null, userCookie);
    assertStoreHomePayload(storeHome, 'GET /api/store with login');

    const exchangePayload = { itemId: itemID, quantity: 1, idempotencyKey };
    const firstExchange = apiRequest('POST', '/api/store/exchange', exchangePayload, userCookie);
    if (
      !firstExchange.data ||
      firstExchange.data.newBalance !== 90 ||
      firstExchange.data.rewardAssetKind !== 'makeup_cards' ||
      !firstExchange.data.log ||
      firstExchange.data.log.itemId !== itemID
    ) {
      fail(`unexpected first exchange payload: ${JSON.stringify(firstExchange).slice(0, 500)}`);
    }

    const repeatedExchange = apiRequest('POST', '/api/store/exchange', exchangePayload, userCookie);
    if (!repeatedExchange.data || repeatedExchange.data.newBalance !== 90 || repeatedExchange.data.rewardAssetKind !== 'makeup_cards') {
      fail(`unexpected repeated exchange payload: ${JSON.stringify(repeatedExchange).slice(0, 500)}`);
    }
    verification = verifyIdempotentExchange();

    const nextHome = apiRequest('GET', '/api/store', null, userCookie);
    if (nextHome.data.balance !== 90 || !nextHome.data.recentExchanges.some((log) => log.itemId === itemID)) {
      fail(`GET /api/store after exchange mismatch: ${JSON.stringify(nextHome).slice(0, 500)}`);
    }

    assertStatus(request('GET', '/api/store/admin'), 401, 'GET /api/store/admin without login');
    assertStatus(request('GET', '/api/store/admin', null, userCookie), 403, 'GET /api/store/admin as non-admin');
    const adminData = apiRequest('GET', '/api/store/admin', null, adminCookie);
    assertStoreAdminPayload(adminData, 'GET /api/store/admin as admin');
  } finally {
    cleanup();
    cleanupResult = verifyCleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres',
    baseURL,
    testUserID,
    adminUserID,
    categoryID,
    itemID,
    checkedCorePaths: [
      'GET /api/store',
      'POST /api/store/exchange',
      'GET /api/store/admin',
    ],
    walletPathsCutOver: [
      'GET /api/store/topup',
      'POST /api/store/topup',
      'POST /api/store/withdraw',
    ],
    verification,
    cleanup: cleanupResult,
    gatewayStoreRules: gatewayRules,
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`store Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
