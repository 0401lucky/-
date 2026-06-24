import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const baseURL = 'http://127.0.0.1:8080';
const origin = process.env.ECO_GO_API_ORIGIN || baseURL;
const testUserID = Number(process.env.ECO_SMOKE_USER_ID || 999915);
const ownerUserID = Number(process.env.ECO_SMOKE_OWNER_USER_ID || 999916);
const testUsername = `eco_smoke_${testUserID}`;
const ownerUsername = `eco_smoke_owner_${ownerUserID}`;
const visiblePrizeID = 'eco-smoke-visible-photo';
const normalLotID = 'eco-smoke-normal-coin-lot';
const merchantLotID = 'eco-smoke-merchant-necklace-lot';
const merchantEntryID = 'eco-smoke-merchant-entry';
const blackMarketLotID = 'eco-smoke-blackmarket-trophy-lot';
const blackMarketTheftID = 'eco-smoke-blackmarket-theft';
const blackMarketEntryID = 'eco-smoke-blackmarket-entry';
const ownerLotID = 'eco-smoke-owner-diamond-lot';
const ownerEntryID = 'eco-smoke-owner-entry';
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const userCookie = makeSessionCookie(testUserID, testUsername, 'Eco Smoke');
const ownerCookie = makeSessionCookie(ownerUserID, ownerUsername, 'Eco Smoke Owner');

function fail(message) {
  throw new Error(`eco Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `eco-smoke-${userID}-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayEcoRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => line.includes('/api/games/eco'));
  const allowed = new Set([
    'handle /api/games/eco/status {',
    'handle /api/games/eco/collect {',
    'handle /api/games/eco/buy {',
    'handle /api/games/eco/claim-prize {',
    'handle /api/games/eco/sell {',
    'handle /api/games/eco/merchant-sell {',
    'handle /api/games/eco/black-market-sell {',
    'handle /api/games/eco/steal {',
  ]);
  const unexpected = activeRules.filter((line) => !allowed.has(line));
  if (unexpected.length > 0) {
    fail(`gateway/Caddyfile contains unexpected eco rules: ${unexpected.join('; ')}`);
  }
  for (const line of allowed) {
    if (!activeRules.includes(line)) {
      fail(`gateway/Caddyfile missing eco rule: ${line}`);
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

function request(method, path, payload = null, cookie = userCookie) {
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

function apiRequest(method, path, payload = null, cookie = userCookie) {
  const response = request(method, path, payload, cookie);
  assertStatus(response, 200, `${method} ${path}`);
  const parsed = parseJSON(response.body, `${method} ${path}`);
  if (!parsed.success) {
    fail(`${method} ${path} returned success=false: ${response.body.slice(0, 500)}`);
  }
  return parsed;
}

function cleanup() {
  psql(`
    DELETE FROM eco_thefts
     WHERE original_user_id IN (${testUserID}, ${ownerUserID})
        OR thief_user_id IN (${testUserID}, ${ownerUserID})
        OR id IN (${sqlLiteral(blackMarketTheftID)});
    DELETE FROM eco_public_prizes
     WHERE owner_user_id IN (${testUserID}, ${ownerUserID})
        OR thief_user_id IN (${testUserID}, ${ownerUserID})
        OR id IN (${sqlLiteral(merchantEntryID)}, ${sqlLiteral(blackMarketEntryID)}, ${sqlLiteral(ownerEntryID)});
    DELETE FROM eco_prize_lots
     WHERE user_id IN (${testUserID}, ${ownerUserID})
        OR id IN (${sqlLiteral(normalLotID)}, ${sqlLiteral(merchantLotID)}, ${sqlLiteral(blackMarketLotID)}, ${sqlLiteral(ownerLotID)});
    DELETE FROM eco_visible_prizes WHERE user_id IN (${testUserID}, ${ownerUserID}) OR id = ${sqlLiteral(visiblePrizeID)};
    DELETE FROM eco_prize_inventory WHERE user_id IN (${testUserID}, ${ownerUserID});
    DELETE FROM eco_item_purchases WHERE user_id IN (${testUserID}, ${ownerUserID});
    DELETE FROM eco_user_upgrades WHERE user_id IN (${testUserID}, ${ownerUserID});
    DELETE FROM eco_trash_rankings WHERE user_id IN (${testUserID}, ${ownerUserID});
    DELETE FROM eco_prize_claim_stats WHERE prize_key IN ('photo', 'coin', 'necklace', 'trophy', 'diamond');
    DELETE FROM eco_global_prize_stock WHERE prize_key IN ('photo', 'coin', 'necklace', 'trophy', 'diamond');
    DELETE FROM eco_states WHERE user_id IN (${testUserID}, ${ownerUserID});
    DELETE FROM point_ledger WHERE user_id IN (${testUserID}, ${ownerUserID});
    DELETE FROM point_accounts WHERE user_id IN (${testUserID}, ${ownerUserID});
    DELETE FROM users WHERE id IN (${testUserID}, ${ownerUserID});
  `);
}

function seedUsers() {
  cleanup();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES
      (${testUserID}, ${sqlLiteral(testUsername)}, 'Eco Smoke', now(), now()),
      (${ownerUserID}, ${sqlLiteral(ownerUsername)}, 'Eco Owner', now(), now());
    INSERT INTO point_accounts (user_id, balance, updated_at)
    VALUES (${testUserID}, 1000, now()), (${ownerUserID}, 1000, now());
  `);
}

function ensureRuntimeRows() {
  apiRequest('GET', '/api/games/eco/status');
  apiRequest('GET', '/api/games/eco/status', null, ownerCookie);
}

function seedCollectState() {
  const nowMs = Date.now();
  psql(`
    UPDATE eco_states
       SET pending = 20,
           point_buffer = 0,
           spawn_leftover_ms = 0,
           auto_leftover_ms = 0,
           glove_uses_remaining = 0,
           last_tick_at_ms = ${nowMs},
           updated_at_ms = ${nowMs},
           updated_at = now()
     WHERE user_id = ${testUserID};
  `);
}

function seedVisiblePrize() {
  const nowMs = Date.now();
  psql(`
    INSERT INTO eco_visible_prizes (id, user_id, prize_key, created_at_ms, limited, created_at)
    VALUES (${sqlLiteral(visiblePrizeID)}, ${testUserID}, 'photo', ${nowMs}, false, now());
  `);
}

function seedNormalSellPrize() {
  const nowMs = Date.now();
  psql(`
    INSERT INTO eco_prize_inventory (user_id, prize_key, inventory_count, limited_count, lifetime_claim_count, updated_at)
    VALUES (${testUserID}, 'coin', 1, 0, 1, now())
    ON CONFLICT (user_id, prize_key) DO UPDATE
      SET inventory_count = excluded.inventory_count,
          limited_count = excluded.limited_count,
          lifetime_claim_count = excluded.lifetime_claim_count,
          updated_at = now();
    INSERT INTO eco_prize_lots (
      id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source,
      created_at, updated_at
    ) VALUES (
      ${sqlLiteral(normalLotID)}, ${testUserID}, 'coin', ${nowMs - 90000000}, ${nowMs - 1000}, false, 'claim',
      now(), now()
    );
  `);
}

function seedMerchantSellPrize() {
  const nowMs = Date.now();
  psql(`
    INSERT INTO eco_prize_inventory (user_id, prize_key, inventory_count, limited_count, lifetime_claim_count, updated_at)
    VALUES (${testUserID}, 'necklace', 1, 0, 1, now())
    ON CONFLICT (user_id, prize_key) DO UPDATE
      SET inventory_count = excluded.inventory_count,
          limited_count = excluded.limited_count,
          lifetime_claim_count = excluded.lifetime_claim_count,
          updated_at = now();
    INSERT INTO eco_prize_lots (
      id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source,
      public_entry_id, publicly_listed_at_ms, merchant_available_at_ms, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(merchantLotID)}, ${testUserID}, 'necklace', ${nowMs - 90000000}, ${nowMs - 90000000}, false, 'claim',
      ${sqlLiteral(merchantEntryID)}, ${nowMs - 90000000}, ${nowMs - 1000}, now(), now()
    );
    INSERT INTO eco_public_prizes (
      id, prize_key, owner_user_id, owner_name, owner_lot_id, public_at_ms,
      merchant_available_at_ms, status, raw_entry, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(merchantEntryID)}, 'necklace', ${testUserID}, ${sqlLiteral(testUsername)}, ${sqlLiteral(merchantLotID)},
      ${nowMs - 90000000}, ${nowMs - 1000}, 'listed', '{}'::jsonb, now(), now()
    );
  `);
}

function seedBlackMarketPrize() {
  const nowMs = Date.now();
  psql(`
    INSERT INTO eco_prize_inventory (user_id, prize_key, inventory_count, limited_count, lifetime_claim_count, updated_at)
    VALUES (${testUserID}, 'trophy', 1, 0, 1, now())
    ON CONFLICT (user_id, prize_key) DO UPDATE
      SET inventory_count = excluded.inventory_count,
          limited_count = excluded.limited_count,
          lifetime_claim_count = excluded.lifetime_claim_count,
          updated_at = now();
    INSERT INTO eco_public_prizes (
      id, prize_key, owner_user_id, owner_name, owner_lot_id, public_at_ms,
      merchant_available_at_ms, status, thief_user_id, thief_name, theft_message,
      stolen_at_ms, raw_entry, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(blackMarketEntryID)}, 'trophy', ${ownerUserID}, ${sqlLiteral(ownerUsername)}, 'eco-smoke-blackmarket-original-lot',
      ${nowMs - 172800000}, ${nowMs - 86400000}, 'stolen', ${testUserID}, ${sqlLiteral(testUsername)}, 'black market smoke',
      ${nowMs - 90000000}, '{}'::jsonb, now(), now()
    );
    INSERT INTO eco_thefts (
      id, prize_key, original_user_id, thief_user_id, public_entry_id,
      original_lot_id, thief_lot_id, stolen_at_ms, next_check_at_ms,
      black_market_available_at_ms, message, raw_record, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(blackMarketTheftID)}, 'trophy', ${ownerUserID}, ${testUserID}, ${sqlLiteral(blackMarketEntryID)},
      'eco-smoke-blackmarket-original-lot', ${sqlLiteral(blackMarketLotID)}, ${nowMs - 90000000}, ${nowMs - 1000},
      ${nowMs - 1000}, 'black market smoke', '{}'::jsonb, now(), now()
    );
    INSERT INTO eco_prize_lots (
      id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source,
      stolen_from_user_id, stolen_at_ms, theft_id, black_market_available_at_ms,
      created_at, updated_at
    ) VALUES (
      ${sqlLiteral(blackMarketLotID)}, ${testUserID}, 'trophy', ${nowMs - 90000000}, ${nowMs - 90000000}, false, 'stolen',
      ${ownerUserID}, ${nowMs - 90000000}, ${sqlLiteral(blackMarketTheftID)}, ${nowMs - 1000},
      now(), now()
    );
  `);
}

function seedStealPrize() {
  const nowMs = Date.now();
  psql(`
    INSERT INTO eco_prize_inventory (user_id, prize_key, inventory_count, limited_count, lifetime_claim_count, updated_at)
    VALUES (${ownerUserID}, 'diamond', 1, 0, 1, now())
    ON CONFLICT (user_id, prize_key) DO UPDATE
      SET inventory_count = excluded.inventory_count,
          limited_count = excluded.limited_count,
          lifetime_claim_count = excluded.lifetime_claim_count,
          updated_at = now();
    INSERT INTO eco_prize_lots (
      id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source,
      public_entry_id, publicly_listed_at_ms, merchant_available_at_ms,
      created_at, updated_at
    ) VALUES (
      ${sqlLiteral(ownerLotID)}, ${ownerUserID}, 'diamond', ${nowMs - 90000000}, ${nowMs - 90000000}, false, 'claim',
      ${sqlLiteral(ownerEntryID)}, ${nowMs - 90000000}, ${nowMs + 86400000}, now(), now()
    );
    INSERT INTO eco_public_prizes (
      id, prize_key, owner_user_id, owner_name, owner_lot_id, public_at_ms,
      merchant_available_at_ms, status, raw_entry, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(ownerEntryID)}, 'diamond', ${ownerUserID}, ${sqlLiteral(ownerUsername)}, ${sqlLiteral(ownerLotID)},
      ${nowMs - 90000000}, ${nowMs + 86400000}, 'listed', '{}'::jsonb, now(), now()
    );
  `);
}

function verifyWrites() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'balance', (SELECT balance FROM point_accounts WHERE user_id = ${testUserID}),
      'pending', (SELECT pending FROM eco_states WHERE user_id = ${testUserID}),
      'point_buffer', (SELECT point_buffer FROM eco_states WHERE user_id = ${testUserID}),
      'spawn_level', COALESCE((SELECT level FROM eco_user_upgrades WHERE user_id = ${testUserID} AND upgrade_key = 'spawn'), 0),
      'flashlight_purchases', COALESCE((SELECT purchase_count FROM eco_item_purchases WHERE user_id = ${testUserID} AND item_key = 'lucky_flashlight' AND purchase_date = (now() AT TIME ZONE 'Asia/Shanghai')::date), 0),
      'photo_inventory', COALESCE((SELECT inventory_count FROM eco_prize_inventory WHERE user_id = ${testUserID} AND prize_key = 'photo'), 0),
      'coin_inventory', COALESCE((SELECT inventory_count FROM eco_prize_inventory WHERE user_id = ${testUserID} AND prize_key = 'coin'), 0),
      'necklace_inventory', COALESCE((SELECT inventory_count FROM eco_prize_inventory WHERE user_id = ${testUserID} AND prize_key = 'necklace'), 0),
      'trophy_inventory', COALESCE((SELECT inventory_count FROM eco_prize_inventory WHERE user_id = ${testUserID} AND prize_key = 'trophy'), 0),
      'diamond_inventory', COALESCE((SELECT inventory_count FROM eco_prize_inventory WHERE user_id = ${testUserID} AND prize_key = 'diamond'), 0),
      'owner_diamond_inventory', COALESCE((SELECT inventory_count FROM eco_prize_inventory WHERE user_id = ${ownerUserID} AND prize_key = 'diamond'), 0),
      'visible_exists', EXISTS(SELECT 1 FROM eco_visible_prizes WHERE id = ${sqlLiteral(visiblePrizeID)}),
      'merchant_entry_exists', EXISTS(SELECT 1 FROM eco_public_prizes WHERE id = ${sqlLiteral(merchantEntryID)}),
      'blackmarket_entry_exists', EXISTS(SELECT 1 FROM eco_public_prizes WHERE id = ${sqlLiteral(blackMarketEntryID)}),
      'blackmarket_escaped', EXISTS(SELECT 1 FROM eco_thefts WHERE id = ${sqlLiteral(blackMarketTheftID)} AND outcome = 'escaped'),
      'stolen_entry', EXISTS(SELECT 1 FROM eco_public_prizes WHERE id = ${sqlLiteral(ownerEntryID)} AND status = 'stolen' AND thief_user_id = ${testUserID}),
      'active_thefts', (SELECT count(*) FROM eco_thefts WHERE thief_user_id = ${testUserID} AND resolved_at_ms IS NULL),
      'trash_rank_daily', COALESCE((SELECT trash_cleared FROM eco_trash_rankings WHERE user_id = ${testUserID} AND period = 'daily' AND period_key = (now() AT TIME ZONE 'Asia/Shanghai')::date::text), 0),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID})
    )::text;
  `), 'eco write verification');
  if (
    result.pending < 10 ||
    result.point_buffer !== 0 ||
    result.spawn_level !== 1 ||
    result.flashlight_purchases !== 1 ||
    result.photo_inventory !== 1 ||
    result.coin_inventory !== 0 ||
    result.necklace_inventory !== 0 ||
    result.trophy_inventory !== 0 ||
    result.diamond_inventory !== 1 ||
    result.owner_diamond_inventory !== 0 ||
    result.visible_exists ||
    result.merchant_entry_exists ||
    result.blackmarket_entry_exists ||
    !result.blackmarket_escaped ||
    !result.stolen_entry ||
    result.active_thefts !== 1 ||
    result.trash_rank_daily < 10 ||
    result.ledger_count < 5 ||
    result.balance <= 1000
  ) {
    fail(`eco write verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function verifyCleanup() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'users', (SELECT count(*) FROM users WHERE id IN (${testUserID}, ${ownerUserID})),
      'accounts', (SELECT count(*) FROM point_accounts WHERE user_id IN (${testUserID}, ${ownerUserID})),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id IN (${testUserID}, ${ownerUserID})),
      'states', (SELECT count(*) FROM eco_states WHERE user_id IN (${testUserID}, ${ownerUserID})),
      'upgrades', (SELECT count(*) FROM eco_user_upgrades WHERE user_id IN (${testUserID}, ${ownerUserID})),
      'items', (SELECT count(*) FROM eco_item_purchases WHERE user_id IN (${testUserID}, ${ownerUserID})),
      'inventory', (SELECT count(*) FROM eco_prize_inventory WHERE user_id IN (${testUserID}, ${ownerUserID})),
      'lots', (SELECT count(*) FROM eco_prize_lots WHERE user_id IN (${testUserID}, ${ownerUserID})),
      'visible', (SELECT count(*) FROM eco_visible_prizes WHERE user_id IN (${testUserID}, ${ownerUserID})),
      'public', (SELECT count(*) FROM eco_public_prizes WHERE owner_user_id IN (${testUserID}, ${ownerUserID}) OR thief_user_id IN (${testUserID}, ${ownerUserID})),
      'thefts', (SELECT count(*) FROM eco_thefts WHERE original_user_id IN (${testUserID}, ${ownerUserID}) OR thief_user_id IN (${testUserID}, ${ownerUserID})),
      'rankings', (SELECT count(*) FROM eco_trash_rankings WHERE user_id IN (${testUserID}, ${ownerUserID}))
    )::text;
  `), 'eco cleanup verification');
  if (
    result.users !== 0 ||
    result.accounts !== 0 ||
    result.ledger_count !== 0 ||
    result.states !== 0 ||
    result.upgrades !== 0 ||
    result.items !== 0 ||
    result.inventory !== 0 ||
    result.lots !== 0 ||
    result.visible !== 0 ||
    result.public !== 0 ||
    result.thefts !== 0 ||
    result.rankings !== 0
  ) {
    fail(`eco cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function assertStatusPayload(payload, label) {
  if (!payload.data || typeof payload.data.pending !== 'number' || !Array.isArray(payload.data.items) || !Array.isArray(payload.data.prizes)) {
    fail(`${label} status shape mismatch: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function main() {
  const gatewayEcoRules = assertGatewayEcoRulesExact();
  const ready = request('GET', '/readyz');
  assertStatus(ready, 200, 'GET /readyz');

  let verification = null;
  let cleanupResult = null;
  try {
    seedUsers();

    assertStatus(request('GET', '/api/games/eco/status', null, ''), 401, 'GET /api/games/eco/status without login');
    assertStatus(request('POST', '/api/games/eco/collect', { drags: 1 }, ''), 401, 'POST /api/games/eco/collect without login');

    ensureRuntimeRows();
    seedCollectState();

    assertStatusPayload(apiRequest('GET', '/api/games/eco/status'), 'GET /api/games/eco/status');

    const collect = apiRequest('POST', '/api/games/eco/collect', { drags: 10 });
    if (collect.data.cleared !== 10 || collect.data.pointsEarned !== 1 || collect.data.pending !== 10) {
      fail(`collect payload mismatch: ${JSON.stringify(collect).slice(0, 500)}`);
    }

    const buyUpgrade = apiRequest('POST', '/api/games/eco/buy', { type: 'upgrade', key: 'spawn' });
    if (buyUpgrade.data.key !== 'spawn' || buyUpgrade.data.cost !== 50) {
      fail(`buy upgrade payload mismatch: ${JSON.stringify(buyUpgrade).slice(0, 500)}`);
    }
    const buyItem = apiRequest('POST', '/api/games/eco/buy', { type: 'item', key: 'lucky_flashlight' });
    if (buyItem.data.key !== 'lucky_flashlight' || buyItem.data.cost !== 20) {
      fail(`buy item payload mismatch: ${JSON.stringify(buyItem).slice(0, 500)}`);
    }

    seedVisiblePrize();
    const claim = apiRequest('POST', '/api/games/eco/claim-prize', { prizeId: visiblePrizeID, makePublic: true });
    if (claim.data.prizeKey !== 'photo') {
      fail(`claim prize payload mismatch: ${JSON.stringify(claim).slice(0, 500)}`);
    }

    seedNormalSellPrize();
    const sell = apiRequest('POST', '/api/games/eco/sell', { key: 'coin', quantity: 1 });
    if (sell.data.prizeKey !== 'coin' || sell.data.quantitySold !== 1 || sell.data.pointsEarned <= 0) {
      fail(`sell payload mismatch: ${JSON.stringify(sell).slice(0, 500)}`);
    }

    seedMerchantSellPrize();
    const merchantSell = apiRequest('POST', '/api/games/eco/merchant-sell', { key: 'necklace' });
    if (merchantSell.data.prizeKey !== 'necklace' || merchantSell.data.quantitySold !== 1 || merchantSell.data.pointsEarned <= 0) {
      fail(`merchant sell payload mismatch: ${JSON.stringify(merchantSell).slice(0, 500)}`);
    }

    seedBlackMarketPrize();
    const blackMarketSell = apiRequest('POST', '/api/games/eco/black-market-sell', { key: 'trophy' });
    if (blackMarketSell.data.prizeKey !== 'trophy' || blackMarketSell.data.quantitySold !== 1 || blackMarketSell.data.pointsEarned <= 0) {
      fail(`black market sell payload mismatch: ${JSON.stringify(blackMarketSell).slice(0, 500)}`);
    }

    seedStealPrize();
    const steal = apiRequest('POST', '/api/games/eco/steal', { entryId: ownerEntryID, message: 'eco smoke' });
    assertStatusPayload({ data: steal.data.status }, 'POST /api/games/eco/steal');

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
    ownerUserID,
    checkedEcoPaths: [
      'GET /api/games/eco/status',
      'POST /api/games/eco/collect',
      'POST /api/games/eco/buy',
      'POST /api/games/eco/claim-prize',
      'POST /api/games/eco/sell',
      'POST /api/games/eco/merchant-sell',
      'POST /api/games/eco/black-market-sell',
      'POST /api/games/eco/steal',
    ],
    verification,
    cleanup: cleanupResult,
    gatewayEcoRules,
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`eco Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
