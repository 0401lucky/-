import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const baseURL = 'http://127.0.0.1:8080';
const origin = process.env.FARM_GO_API_ORIGIN || baseURL;
const testUserID = Number(process.env.FARM_WRITE_SMOKE_USER_ID || 999905);
const targetUserID = Number(process.env.FARM_WRITE_SMOKE_TARGET_USER_ID || 999906);
const testUsername = `farm_write_smoke_${testUserID}`;
const targetUsername = `farm_write_target_${targetUserID}`;
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const cookie = makeSessionCookie(testUserID, testUsername, 'Farm Write Smoke');
const targetCookie = makeSessionCookie(targetUserID, targetUsername, 'Farm Write Target');
const expectedGatewayFarmRules = [
  '/api/farm/status',
  '/api/farm/plant',
  '/api/farm/water',
  '/api/farm/water-all',
  '/api/farm/harvest',
  '/api/farm/harvest-all',
  '/api/farm/remove',
  '/api/farm/buy-land',
  '/api/farm/shop/buy',
  '/api/farm/seeds/buy',
  '/api/farm/shop/use',
  '/api/farm/pet/adopt',
  '/api/farm/pet/feed',
  '/api/farm/pet/wash',
  '/api/farm/pet/drink',
  '/api/farm/pet/play',
  '/api/farm/pet/dispatch',
  '/api/farm/steal/list',
  '/api/farm/steal/do',
].map((path) => `handle ${path} {`);

function fail(message) {
  throw new Error(`farm write Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `farm-write-smoke-${userID}-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayFarmRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeFarmRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => line.includes('/api/farm'));
  const missing = expectedGatewayFarmRules.filter((line) => !activeFarmRules.includes(line));
  const unexpected = activeFarmRules.filter((line) => !expectedGatewayFarmRules.includes(line));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(`gateway/Caddyfile farm rules must be exact; missing=${missing.join('; ')} unexpected=${unexpected.join('; ')}`);
  }
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

function request(method, path, payload, requestCookie = cookie) {
  const body = payload ? JSON.stringify(payload) : '';
  const args = ['compose', 'exec', '-T', 'api', 'wget', '-S', '-O', '-'];
  args.push('--header', `Cookie: ${requestCookie}`);
  args.push('--header', `Origin: ${origin}`);
  args.push('--header', 'Content-Type: application/json');
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

function apiRequest(method, path, payload, requestCookie = cookie) {
  const response = request(method, path, payload, requestCookie);
  assertStatus(response, 200, `${method} ${path}`);
  const parsed = parseJSON(response.body, `${method} ${path}`);
  if (!parsed.success) {
    fail(`${method} ${path} returned success=false: ${response.body.slice(0, 500)}`);
  }
  return parsed;
}

function seedUsers() {
  cleanup();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES
      (${testUserID}, ${sqlLiteral(testUsername)}, 'Farm Write Smoke', now(), now()),
      (${targetUserID}, ${sqlLiteral(targetUsername)}, 'Farm Write Target', now(), now());
  `);
}

function boostBalance(userID, balance = 1000) {
  psql(`
    INSERT INTO point_accounts (user_id, balance, updated_at)
    VALUES (${userID}, ${balance}, now())
    ON CONFLICT (user_id) DO UPDATE
       SET balance = excluded.balance,
           updated_at = now();
  `);
}

function readState(userID) {
  return parseJSON(psql(`
    SELECT state_json::text
      FROM farm_states
     WHERE user_id = ${userID};
  `), `farm state ${userID}`);
}

function saveState(userID, state) {
  const nowMs = Date.now();
  state.updatedAt = nowMs;
  state.lastTickAt = nowMs;
  psql(`
    UPDATE farm_states
       SET state_json = ${sqlLiteral(JSON.stringify(state))}::jsonb,
           last_tick_at_ms = ${nowMs},
           updated_at_ms = ${nowMs},
           updated_at = now()
     WHERE user_id = ${userID};
  `);
}

function forceFirstLandMature(userID) {
  const state = readState(userID);
  const nowMs = Date.now();
  state.lands[0] = {
    index: 1,
    status: 'mature',
    crop: {
      cropId: 'wheat',
      plantedAt: nowMs - 7200000,
      matureAt: nowMs - 1000,
      lastWaterAt: nowMs - 3600000,
      nextWaterDueAt: nowMs + 3600000,
      waterMissCount: 0,
      fertilizer: null,
      plantedSeason: 'spring',
      weatherAtPlant: 'sunny',
      birdNetUntil: null,
      stolenAmount: 0,
      stolenCount: 0,
      speedUsed: 0,
      speedReducedMinutes: 0,
    },
  };
  saveState(userID, state);
  return state;
}

function forceAdultStealPet(userID) {
  const state = readState(userID);
  state.pet = {
    type: 'cat',
    name: '小咪',
    stage: 'adult',
    growth: 180,
    hunger: 80,
    cleanliness: 80,
    mood: 80,
    thirst: 80,
    hydrationVersion: 2,
    health: 90,
    learnedSkills: ['steal'],
    currentTask: null,
    taskStartAt: null,
    taskEndAt: null,
    cooldownEndAt: null,
    stealTarget: null,
    feedToday: { normal: 0, premium: 0 },
    washToday: 0,
    waterToday: 0,
    playToday: 0,
    toyToday: 0,
    dailyResetAt: 0,
  };
  saveState(userID, state);
  return state;
}

function cleanup() {
  psql(`
    DELETE FROM farm_daily_shop_purchases WHERE user_id IN (${testUserID}, ${targetUserID});
    DELETE FROM farm_maturity_email_dedupes WHERE user_id IN (${testUserID}, ${targetUserID});
    DELETE FROM farm_water_email_dedupes WHERE user_id IN (${testUserID}, ${targetUserID});
    DELETE FROM farm_states WHERE user_id IN (${testUserID}, ${targetUserID});
    DELETE FROM point_ledger WHERE user_id IN (${testUserID}, ${targetUserID});
    DELETE FROM point_accounts WHERE user_id IN (${testUserID}, ${targetUserID});
    DELETE FROM users WHERE id IN (${testUserID}, ${targetUserID});
  `);
}

function verifyWrites() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'actor_state_exists', EXISTS(SELECT 1 FROM farm_states WHERE user_id = ${testUserID}),
      'target_state_exists', EXISTS(SELECT 1 FROM farm_states WHERE user_id = ${targetUserID}),
      'actor_balance', (SELECT balance FROM point_accounts WHERE user_id = ${testUserID}),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID}),
      'daily_purchase_count', (SELECT coalesce(sum(purchase_count), 0) FROM farm_daily_shop_purchases WHERE user_id = ${testUserID}),
      'has_pet', EXISTS(
        SELECT 1 FROM farm_states
         WHERE user_id = ${testUserID}
           AND state_json->'pet' IS NOT NULL
           AND state_json->'pet' <> 'null'::jsonb
      )
    )::text;
  `), 'farm write verification');
  if (!result.actor_state_exists || !result.target_state_exists || result.actor_balance === null || result.ledger_count < 1 || result.daily_purchase_count < 1 || !result.has_pet) {
    fail(`farm write verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function verifyCleanup() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'users', (SELECT count(*) FROM users WHERE id IN (${testUserID}, ${targetUserID})),
      'states', (SELECT count(*) FROM farm_states WHERE user_id IN (${testUserID}, ${targetUserID})),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id IN (${testUserID}, ${targetUserID})),
      'accounts', (SELECT count(*) FROM point_accounts WHERE user_id IN (${testUserID}, ${targetUserID})),
      'daily_purchases', (SELECT count(*) FROM farm_daily_shop_purchases WHERE user_id IN (${testUserID}, ${targetUserID}))
    )::text;
  `), 'farm cleanup verification');
  if (result.users !== 0 || result.states !== 0 || result.ledger_count !== 0 || result.accounts !== 0 || result.daily_purchases !== 0) {
    fail(`farm cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function assertStatusShape(payload, label) {
  if (!payload.data || !payload.data.state || !Array.isArray(payload.data.computedLands) || !payload.data.world) {
    fail(`${label} response is not compatible FarmStatusResponse: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function main() {
  assertGatewayFarmRulesExact();

  const ready = request('GET', '/readyz');
  assertStatus(ready, 200, 'GET /readyz');

  let verification = null;
  let cleanupResult = null;
  try {
    seedUsers();

    const status = apiRequest('GET', '/api/farm/status');
    assertStatusShape(status, 'initial status');
    apiRequest('GET', '/api/farm/status', undefined, targetCookie);
    boostBalance(testUserID);
    boostBalance(targetUserID);

    apiRequest('POST', '/api/farm/seeds/buy', { cropId: 'wheat', qty: 1 });
    const plant = apiRequest('POST', '/api/farm/plant', { plotIndex: 0, cropId: 'wheat' });
    assertStatusShape(plant, 'plant');
    apiRequest('POST', '/api/farm/water', { plotIndex: 0 });

    forceFirstLandMature(testUserID);
    const harvest = apiRequest('POST', '/api/farm/harvest', { plotIndex: 0 });
    if (!harvest.harvest || harvest.harvest.cropId !== 'wheat') {
      fail(`unexpected harvest response: ${JSON.stringify(harvest).slice(0, 500)}`);
    }

    apiRequest('POST', '/api/farm/shop/buy', { key: 'scarecrow', qty: 1 });
    apiRequest('POST', '/api/farm/shop/use', { key: 'scarecrow' });
    apiRequest('POST', '/api/farm/pet/adopt', { type: 'cat', name: '小咪' });
    apiRequest('POST', '/api/farm/shop/buy', { key: 'pet_food_normal', qty: 1 });
    apiRequest('POST', '/api/farm/pet/feed', { kind: 'normal' });
    apiRequest('POST', '/api/farm/pet/wash', {});
    apiRequest('POST', '/api/farm/pet/drink', {});
    apiRequest('POST', '/api/farm/pet/play', {});

    forceAdultStealPet(testUserID);
    forceFirstLandMature(targetUserID);
    const candidates = apiRequest('GET', '/api/farm/steal/list');
    if (!Array.isArray(candidates.data?.candidates)) {
      fail(`unexpected steal list response: ${JSON.stringify(candidates).slice(0, 500)}`);
    }
    apiRequest('POST', '/api/farm/steal/do', { targetUserId: targetUserID });

    verification = verifyWrites();
  } finally {
    cleanup();
    cleanupResult = verifyCleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres',
    baseURL,
    testUserID,
    targetUserID,
    checkedAuthenticatedPaths: [
      'GET /api/farm/status',
      'POST /api/farm/seeds/buy',
      'POST /api/farm/plant',
      'POST /api/farm/water',
      'POST /api/farm/harvest',
      'POST /api/farm/shop/buy',
      'POST /api/farm/shop/use',
      'POST /api/farm/pet/adopt',
      'POST /api/farm/pet/feed',
      'POST /api/farm/pet/wash',
      'POST /api/farm/pet/drink',
      'POST /api/farm/pet/play',
      'GET /api/farm/steal/list',
      'POST /api/farm/steal/do',
    ],
    verification,
    cleanup: cleanupResult,
    gatewayFarmRules: 'enabled-exact',
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`farm write Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
