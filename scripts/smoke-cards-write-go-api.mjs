import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const baseURL = 'http://127.0.0.1:8080';
const origin = process.env.CARDS_GO_API_ORIGIN || baseURL;
const testUserID = Number(process.env.CARDS_WRITE_SMOKE_USER_ID || 999904);
const testUsername = `cards_write_smoke_${testUserID}`;
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const cookie = makeSessionCookie(testUserID, testUsername, 'Cards Write Smoke');
const commonCardIDs = animalS1CommonCardIDs();
const exchangeCardID = commonCardIDs[0];

function fail(message) {
  throw new Error(`cards write Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `cards-write-smoke-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function animalS1CommonCardIDs() {
  const source = readFileSync('backend/internal/cards/catalog.go', 'utf8');
  const match = source.match(/var animalS1Common = \[\]string\{([^}]+)\}/);
  if (!match) {
    fail('cannot find animalS1Common in Go card catalog');
  }
  const names = [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  if (names.length === 0) {
    fail('animalS1Common has no cards');
  }
  return names.map((name) => `animal-s1-common-${name}`);
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

function request(method, path, payload) {
  const body = payload ? JSON.stringify(payload) : '';
  const args = ['compose', 'exec', '-T', 'api', 'wget', '-S', '-O', '-'];
  args.push('--header', `Cookie: ${cookie}`);
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

function apiRequest(method, path, payload) {
  const response = request(method, path, payload);
  assertStatus(response, 200, `${method} ${path}`);
  const parsed = parseJSON(response.body, `${method} ${path}`);
  if (!parsed.success && path !== '/api/cards/claim-reward') {
    fail(`${method} ${path} returned success=false: ${response.body.slice(0, 500)}`);
  }
  return parsed;
}

function seedTestUser() {
  cleanup();
  psql(`
    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES (${testUserID}, ${sqlLiteral(testUsername)}, 'Cards Write Smoke', now(), now());
    INSERT INTO point_accounts (user_id, balance, updated_at)
    VALUES (${testUserID}, 0, now());
    INSERT INTO card_user_states (
      user_id, inventory, fragments, pity_rare, pity_epic, pity_legendary,
      pity_legendary_rare, draws_available, collection_rewards, recent_draws, raw_state,
      created_at, updated_at
    ) VALUES (
      ${testUserID},
      '[]'::jsonb,
      1000,
      0, 0, 0, 0,
      2,
      '[]'::jsonb,
      '[]'::jsonb,
      '{"source":"cards-write-smoke"}'::jsonb,
      now(),
      now()
    );
  `);
}

function seedCommonAlbumInventoryForClaim() {
  psql(`
    UPDATE card_user_states
       SET inventory = ${sqlLiteral(JSON.stringify(commonCardIDs))}::jsonb,
           fragments = 500,
           collection_rewards = '[]'::jsonb,
           updated_at = now()
     WHERE user_id = ${testUserID};
  `);
}

function cleanup() {
  psql(`
    DELETE FROM card_reward_claims WHERE user_id = ${testUserID};
    DELETE FROM card_draw_logs WHERE user_id = ${testUserID};
    DELETE FROM card_user_states WHERE user_id = ${testUserID};
    DELETE FROM point_ledger WHERE user_id = ${testUserID};
    DELETE FROM point_accounts WHERE user_id = ${testUserID};
    DELETE FROM users WHERE id = ${testUserID};
  `);
}

function verifyExchangeAndDraw() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'has_exchange_card', EXISTS(
        SELECT 1 FROM card_user_states
        WHERE user_id = ${testUserID}
          AND inventory ? ${sqlLiteral(exchangeCardID)}
      ),
      'draw_logs', (SELECT count(*) FROM card_draw_logs WHERE user_id = ${testUserID}),
      'draws_available', (SELECT draws_available FROM card_user_states WHERE user_id = ${testUserID}),
      'fragments', (SELECT fragments FROM card_user_states WHERE user_id = ${testUserID})
    )::text;
  `), 'exchange and draw verification');
  if (!result.has_exchange_card || result.draw_logs !== 1 || result.draws_available !== 1 || result.fragments >= 1000) {
    fail(`exchange/draw verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function verifyClaim() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'claim_count', (
        SELECT count(*) FROM card_reward_claims
        WHERE user_id = ${testUserID}
          AND album_id = 'animal-s1'
          AND reward_type = 'common'
          AND points_awarded = 4
      ),
      'has_reward_key', EXISTS(
        SELECT 1 FROM card_user_states
        WHERE user_id = ${testUserID}
          AND collection_rewards ? 'album:animal-s1:common'
      ),
      'balance', (SELECT balance FROM point_accounts WHERE user_id = ${testUserID}),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID})
    )::text;
  `), 'reward claim verification');
  if (result.claim_count !== 1 || !result.has_reward_key || result.balance !== 4 || result.ledger_count !== 1) {
    fail(`reward claim verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function verifyCleanup() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'user_exists', EXISTS(SELECT 1 FROM users WHERE id = ${testUserID}),
      'state_exists', EXISTS(SELECT 1 FROM card_user_states WHERE user_id = ${testUserID}),
      'draw_logs', (SELECT count(*) FROM card_draw_logs WHERE user_id = ${testUserID}),
      'claims', (SELECT count(*) FROM card_reward_claims WHERE user_id = ${testUserID}),
      'ledger_count', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID})
    )::text;
  `), 'cleanup verification');
  if (result.user_exists || result.state_exists || result.draw_logs !== 0 || result.claims !== 0 || result.ledger_count !== 0) {
    fail(`cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  assertGatewayCardRulesDisabled();

  const ready = request('GET', '/readyz');
  assertStatus(ready, 200, 'GET /readyz');

  let exchangeAndDraw = null;
  let claim = null;
  let cleanupResult = null;
  try {
    seedTestUser();

    const inventoryBefore = apiRequest('GET', '/api/cards/inventory');
    if (inventoryBefore.data.drawsAvailable !== 2 || inventoryBefore.data.fragments !== 1000) {
      fail(`unexpected initial inventory: ${JSON.stringify(inventoryBefore.data)}`);
    }

    apiRequest('POST', '/api/cards/exchange', { cardId: exchangeCardID });
    const draw = apiRequest('POST', '/api/cards/draw', { count: 1 });
    if (!draw.data || draw.data.drawsAvailable !== 1) {
      fail(`unexpected draw response: ${JSON.stringify(draw)}`);
    }
    exchangeAndDraw = verifyExchangeAndDraw();

    seedCommonAlbumInventoryForClaim();
    const claimResponse = apiRequest('POST', '/api/cards/claim-reward', {
      rewardType: 'common',
      albumId: 'animal-s1',
    });
    if (!claimResponse.success || claimResponse.pointsAwarded !== 4 || claimResponse.newBalance !== 4) {
      fail(`unexpected reward claim response: ${JSON.stringify(claimResponse)}`);
    }
    claim = verifyClaim();
  } finally {
    cleanup();
    cleanupResult = verifyCleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres',
    baseURL,
    testUserID,
    checkedAuthenticatedPaths: [
      'GET /api/cards/inventory',
      'POST /api/cards/exchange',
      'POST /api/cards/draw',
      'POST /api/cards/claim-reward',
    ],
    exchangeCardID,
    commonCards: commonCardIDs.length,
    verification: {
      exchangeAndDraw,
      claim,
    },
    cleanup: cleanupResult,
    gatewayCardRules: 'none',
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`cards write Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
