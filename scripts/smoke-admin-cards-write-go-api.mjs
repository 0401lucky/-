import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const baseURL = 'http://127.0.0.1:8080';
const origin = process.env.ADMIN_CARDS_GO_API_ORIGIN || 'http://127.0.0.1:8080';
const testUserID = Number(process.env.ADMIN_CARDS_WRITE_SMOKE_USER_ID || 999901);
const testUsername = `admin_cards_write_smoke_${testUserID}`;
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const adminCookie = process.env.ADMIN_CARDS_GO_API_COOKIE || makeSessionCookie('admin', 'Admin');

function fail(message) {
  console.error(`admin cards write Go API smoke failed: ${message}`);
  process.exit(1);
}

function makeSessionCookie(username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: 1,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `admin-cards-write-smoke-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
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

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlTimestamp(value) {
  return value ? `${sqlLiteral(value)}::timestamptz` : 'NULL';
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

function request(method, path, body = '', headers = {}) {
  const bodyBytes = Buffer.byteLength(body);
  const requestLines = [
    `${method} ${path} HTTP/1.1`,
    'Host: 127.0.0.1:8080',
    'Connection: close',
    ...Object.entries(headers).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`),
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

function writeRequest(method, path, payload) {
  const response = request(method, path, JSON.stringify(payload), {
    Cookie: adminCookie,
    Origin: origin,
    'Content-Type': 'application/json',
  });
  assertStatus(response, 200, `${method} ${path}`);
  const parsed = parseJSON(response.body, `${method} ${path}`);
  if (!parsed.success) {
    fail(`${method} ${path} returned success=false: ${response.body}`);
  }
  return parsed;
}

function readRequest(path) {
  const response = request('GET', path, '', { Cookie: adminCookie });
  assertStatus(response, 200, `GET ${path}`);
  const parsed = parseJSON(response.body, `GET ${path}`);
  if (!parsed.success) {
    fail(`GET ${path} returned success=false: ${response.body}`);
  }
  return parsed;
}

function backupAdminCardConfig() {
  return parseJSON(psql(`
    SELECT json_build_object(
      'card_rules', (SELECT row_to_json(r) FROM card_rules r WHERE id = 'default'),
      'album_reward', (SELECT row_to_json(a) FROM card_album_rewards a WHERE album_id = 'animal-s1'),
      'tier_reward', (SELECT row_to_json(t) FROM card_tier_rewards t WHERE reward_type = 'common')
    )::text;
  `), 'admin card config backup');
}

function seedTestUser() {
  psql(`
    DELETE FROM card_reward_claims WHERE user_id = ${testUserID};
    DELETE FROM card_draw_logs WHERE user_id = ${testUserID};
    DELETE FROM card_user_states WHERE user_id = ${testUserID};
    DELETE FROM point_accounts WHERE user_id = ${testUserID};
    DELETE FROM users WHERE id = ${testUserID};

    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES (${testUserID}, ${sqlLiteral(testUsername)}, 'Admin Cards Write Smoke', now(), now());

    INSERT INTO point_accounts (user_id, balance, updated_at)
    VALUES (${testUserID}, 1000, now());

    INSERT INTO card_user_states (
      user_id, inventory, fragments, pity_rare, pity_epic, pity_legendary,
      pity_legendary_rare, draws_available, collection_rewards, recent_draws, raw_state,
      imported_at, created_at, updated_at
    ) VALUES (
      ${testUserID},
      '["animal-s1-legendary_rare-熊猫", "animal-s1-common-猫"]'::jsonb,
      42, 3, 4, 5, 6, 7,
      '["animal-s1:common"]'::jsonb,
      '[]'::jsonb,
      '{"source":"admin-cards-write-smoke"}'::jsonb,
      now(), now(), now()
    );

    INSERT INTO card_reward_claims (user_id, album_id, reward_type, points_awarded, claimed_at_ms)
    VALUES (${testUserID}, 'animal-s1', 'common', 11, 1700000000000);

    INSERT INTO card_draw_logs (user_id, draw_group_id, card_id, rarity, is_duplicate, fragments_added, created_at_ms)
    VALUES (${testUserID}, 'admin-cards-write-smoke', 'animal-s1-common-猫', 'common', false, 0, 1700000000000);
  `);
}

function restoreRules(row) {
  if (!row) {
    psql(`DELETE FROM card_rules WHERE id = 'default';`);
    return;
  }
  psql(`
    INSERT INTO card_rules (
      id, rarity_probabilities, pity_thresholds, card_draw_price,
      fragment_values, exchange_prices, config_json, updated_at_ms,
      imported_at, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(row.id)},
      ${sqlLiteral(JSON.stringify(row.rarity_probabilities))}::jsonb,
      ${sqlLiteral(JSON.stringify(row.pity_thresholds))}::jsonb,
      ${Number(row.card_draw_price)},
      ${sqlLiteral(JSON.stringify(row.fragment_values))}::jsonb,
      ${sqlLiteral(JSON.stringify(row.exchange_prices))}::jsonb,
      ${sqlLiteral(JSON.stringify(row.config_json))}::jsonb,
      ${Number(row.updated_at_ms)},
      ${sqlTimestamp(row.imported_at)},
      ${sqlTimestamp(row.created_at)},
      ${sqlTimestamp(row.updated_at)}
    )
    ON CONFLICT (id) DO UPDATE SET
      rarity_probabilities = excluded.rarity_probabilities,
      pity_thresholds = excluded.pity_thresholds,
      card_draw_price = excluded.card_draw_price,
      fragment_values = excluded.fragment_values,
      exchange_prices = excluded.exchange_prices,
      config_json = excluded.config_json,
      updated_at_ms = excluded.updated_at_ms,
      imported_at = excluded.imported_at,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at;
  `);
}

function restoreAlbumReward(row) {
  if (!row) {
    psql(`DELETE FROM card_album_rewards WHERE album_id = 'animal-s1';`);
    return;
  }
  psql(`
    INSERT INTO card_album_rewards (album_id, reward_points, raw_reward, updated_at_ms, imported_at, created_at, updated_at)
    VALUES (
      ${sqlLiteral(row.album_id)},
      ${Number(row.reward_points)},
      ${sqlLiteral(JSON.stringify(row.raw_reward))}::jsonb,
      ${Number(row.updated_at_ms)},
      ${sqlTimestamp(row.imported_at)},
      ${sqlTimestamp(row.created_at)},
      ${sqlTimestamp(row.updated_at)}
    )
    ON CONFLICT (album_id) DO UPDATE SET
      reward_points = excluded.reward_points,
      raw_reward = excluded.raw_reward,
      updated_at_ms = excluded.updated_at_ms,
      imported_at = excluded.imported_at,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at;
  `);
}

function restoreTierReward(row) {
  if (!row) {
    psql(`DELETE FROM card_tier_rewards WHERE reward_type = 'common';`);
    return;
  }
  psql(`
    INSERT INTO card_tier_rewards (reward_type, reward_points, raw_reward, updated_at_ms, imported_at, created_at, updated_at)
    VALUES (
      ${sqlLiteral(row.reward_type)},
      ${Number(row.reward_points)},
      ${sqlLiteral(JSON.stringify(row.raw_reward))}::jsonb,
      ${Number(row.updated_at_ms)},
      ${sqlTimestamp(row.imported_at)},
      ${sqlTimestamp(row.created_at)},
      ${sqlTimestamp(row.updated_at)}
    )
    ON CONFLICT (reward_type) DO UPDATE SET
      reward_points = excluded.reward_points,
      raw_reward = excluded.raw_reward,
      updated_at_ms = excluded.updated_at_ms,
      imported_at = excluded.imported_at,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at;
  `);
}

function cleanup(backup) {
  psql(`
    DELETE FROM card_reward_claims WHERE user_id = ${testUserID};
    DELETE FROM card_draw_logs WHERE user_id = ${testUserID};
    DELETE FROM card_user_states WHERE user_id = ${testUserID};
    DELETE FROM point_accounts WHERE user_id = ${testUserID};
    DELETE FROM users WHERE id = ${testUserID};
  `);
  restoreRules(backup.card_rules);
  restoreAlbumReward(backup.album_reward);
  restoreTierReward(backup.tier_reward);
}

function verifyCleanup() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'test_user_exists', EXISTS(SELECT 1 FROM users WHERE id = ${testUserID}),
      'test_state_exists', EXISTS(SELECT 1 FROM card_user_states WHERE user_id = ${testUserID}),
      'test_claim_exists', EXISTS(SELECT 1 FROM card_reward_claims WHERE user_id = ${testUserID}),
      'test_draw_logs', (SELECT count(*) FROM card_draw_logs WHERE user_id = ${testUserID})
    )::text;
  `), 'cleanup verification');
  if (result.test_user_exists || result.test_state_exists || result.test_claim_exists || result.test_draw_logs !== 0) {
    fail(`cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function verifyWrites(expectedCardDrawPrice) {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'state_exists', EXISTS(SELECT 1 FROM card_user_states WHERE user_id = ${testUserID}),
      'claim_exists', EXISTS(SELECT 1 FROM card_reward_claims WHERE user_id = ${testUserID}),
      'draw_logs', (SELECT count(*) FROM card_draw_logs WHERE user_id = ${testUserID}),
      'album_reward', (SELECT reward_points FROM card_album_rewards WHERE album_id = 'animal-s1'),
      'tier_reward', (SELECT reward_points FROM card_tier_rewards WHERE reward_type = 'common'),
      'card_draw_price', (SELECT card_draw_price FROM card_rules WHERE id = 'default')
    )::text;
  `), 'write verification');

  if (result.state_exists || result.claim_exists || result.draw_logs !== 1) {
    fail(`reset verification failed: ${JSON.stringify(result)}`);
  }
  if (result.album_reward !== 777 || result.tier_reward !== 888 || result.card_draw_price !== expectedCardDrawPrice) {
    fail(`write verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  assertGatewayCardRulesDisabled();

  const ready = request('GET', '/readyz');
  assertStatus(ready, 200, 'GET /readyz');

  const backup = backupAdminCardConfig();
  let cleanupResult = null;
  let verification = null;
  try {
    seedTestUser();

    writeRequest('POST', '/api/admin/cards/reset', { userId: testUserID });
    writeRequest('POST', '/api/admin/cards/albums', { albumId: 'animal-s1', reward: 777 });
    writeRequest('POST', '/api/admin/cards/albums', { tierId: 'common', reward: 888 });

    const rules = readRequest('/api/admin/cards/rules').data;
    const nextCardDrawPrice = rules.cardDrawPrice === 902 ? 903 : 902;
    rules.cardDrawPrice = nextCardDrawPrice;
    writeRequest('PATCH', '/api/admin/cards/rules', rules);

    verification = verifyWrites(nextCardDrawPrice);
  } finally {
    cleanup(backup);
    cleanupResult = verifyCleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres',
    baseURL,
    testUserID,
    checkedWritePaths: [
      'POST /api/admin/cards/reset',
      'POST /api/admin/cards/albums album',
      'POST /api/admin/cards/albums tier',
      'PATCH /api/admin/cards/rules',
    ],
    verification,
    cleanup: cleanupResult,
    gatewayCardRules: 'none',
  }, null, 2));
}

main();
