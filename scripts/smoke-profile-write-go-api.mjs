import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const baseURL = 'http://127.0.0.1:8080';
const origin = process.env.PROFILE_GO_API_ORIGIN || baseURL;
const testUserID = Number(process.env.PROFILE_WRITE_SMOKE_USER_ID || 999902);
const testUsername = `profile_write_smoke_${testUserID}`;
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const cookie = makeSessionCookie(testUserID, testUsername, 'Profile Write Smoke');

function fail(message) {
  throw new Error(`profile write Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `profile-write-smoke-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayProfileRulesDisabled() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeProfileRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => line.includes('/api/profile'));
  if (activeProfileRules.length > 0) {
    fail(`gateway/Caddyfile contains profile cutover rules: ${activeProfileRules.join('; ')}`);
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
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

function responseBody(output) {
  const separator = output.indexOf('\r\n\r\n');
  if (separator >= 0) {
    return decodeChunkedBody(output.slice(separator + 4).trim());
  }
  const fallback = output.indexOf('\n\n');
  if (fallback >= 0) {
    return decodeChunkedBody(output.slice(fallback + 2).trim());
  }
  return decodeChunkedBody(output.trim());
}

function decodeChunkedBody(body) {
  const normalized = body.replace(/\r\n/g, '\n');
  if (!/^[0-9a-fA-F]+\n/.test(normalized)) {
    return body;
  }
  let index = 0;
  let decoded = '';
  while (index < normalized.length) {
    const lineEnd = normalized.indexOf('\n', index);
    if (lineEnd < 0) {
      return body;
    }
    const sizeText = normalized.slice(index, lineEnd).trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size)) {
      return body;
    }
    index = lineEnd + 1;
    if (size === 0) {
      return decoded;
    }
    decoded += normalized.slice(index, index + size);
    index += size;
    if (normalized[index] === '\n') {
      index += 1;
    }
  }
  return decoded || body;
}

function request(method, path, body = '', headers = {}) {
  if (method === 'GET') {
    return wgetRequest(path, headers);
  }

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

function wgetRequest(path, headers = {}) {
  const args = ['compose', 'exec', '-T', 'api', 'wget', '-S', '-O', '-'];
  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      args.push('--header', `${key}: ${value}`);
    }
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
  const response = request(method, path, payload ? JSON.stringify(payload) : '', {
    Cookie: cookie,
    Origin: origin,
    'Content-Type': 'application/json',
  });
  assertStatus(response, 200, `${method} ${path}`);
  const parsed = parseJSON(response.body, `${method} ${path}`);
  if (!parsed.success || !parsed.data) {
    fail(`${method} ${path} returned incompatible payload: ${response.body.slice(0, 500)}`);
  }
  return parsed.data;
}

function seedTestUser() {
  psql(`
    DELETE FROM user_forced_achievements WHERE user_id = ${testUserID};
    DELETE FROM user_equipped_achievements WHERE user_id = ${testUserID};
    DELETE FROM user_achievement_grants WHERE user_id = ${testUserID};
    DELETE FROM user_profiles WHERE user_id = ${testUserID};
    DELETE FROM notifications WHERE user_id = ${testUserID};
    DELETE FROM game_records WHERE user_id = ${testUserID};
    DELETE FROM card_user_states WHERE user_id = ${testUserID};
    DELETE FROM point_ledger WHERE user_id = ${testUserID};
    DELETE FROM point_accounts WHERE user_id = ${testUserID};
    DELETE FROM users WHERE id = ${testUserID};

    INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
    VALUES (${testUserID}, ${sqlLiteral(testUsername)}, 'Profile Write Smoke', now(), now());
    INSERT INTO point_accounts (user_id, balance, updated_at)
    VALUES (${testUserID}, 1500, now());
    INSERT INTO user_achievement_grants (
      user_id, achievement_id, source, granted_at_ms, expires_at_ms, reason, metadata
    ) VALUES (
      ${testUserID}, 'beginner', 'auto', 1700000000000, NULL, 'profile write smoke', '{}'::jsonb
    );
  `);
}

function cleanup() {
  psql(`
    DELETE FROM user_forced_achievements WHERE user_id = ${testUserID};
    DELETE FROM user_equipped_achievements WHERE user_id = ${testUserID};
    DELETE FROM user_achievement_grants WHERE user_id = ${testUserID};
    DELETE FROM user_profiles WHERE user_id = ${testUserID};
    DELETE FROM notifications WHERE user_id = ${testUserID};
    DELETE FROM game_records WHERE user_id = ${testUserID};
    DELETE FROM card_user_states WHERE user_id = ${testUserID};
    DELETE FROM point_ledger WHERE user_id = ${testUserID};
    DELETE FROM point_accounts WHERE user_id = ${testUserID};
    DELETE FROM users WHERE id = ${testUserID};
  `);
}

function verifyWrites() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'profile', (SELECT row_to_json(p) FROM user_profiles p WHERE user_id = ${testUserID}),
      'equipped', (SELECT row_to_json(e) FROM user_equipped_achievements e WHERE user_id = ${testUserID}),
      'grant_exists', EXISTS(
        SELECT 1 FROM user_achievement_grants
        WHERE user_id = ${testUserID} AND achievement_id = 'beginner'
      )
    )::text;
  `), 'write verification');

  if (!result.profile || result.profile.display_name !== 'Profile Smoke Updated') {
    fail(`profile update did not persist: ${JSON.stringify(result)}`);
  }
  if (result.profile.avatar_url !== 'https://example.com/profile-smoke.png') {
    fail(`profile avatar did not persist: ${JSON.stringify(result)}`);
  }
  if (result.profile.qq_email !== '123456@qq.com') {
    fail(`profile qq email did not persist: ${JSON.stringify(result)}`);
  }
  if (!result.equipped || result.equipped.achievement_id !== 'beginner') {
    fail(`equipped achievement did not persist: ${JSON.stringify(result)}`);
  }
  if (!result.grant_exists) {
    fail(`achievement grant missing after smoke: ${JSON.stringify(result)}`);
  }
  return result;
}

function verifyCleanup() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'user_exists', EXISTS(SELECT 1 FROM users WHERE id = ${testUserID}),
      'profile_exists', EXISTS(SELECT 1 FROM user_profiles WHERE user_id = ${testUserID}),
      'equipped_exists', EXISTS(SELECT 1 FROM user_equipped_achievements WHERE user_id = ${testUserID}),
      'grant_exists', EXISTS(SELECT 1 FROM user_achievement_grants WHERE user_id = ${testUserID})
    )::text;
  `), 'cleanup verification');
  if (result.user_exists || result.profile_exists || result.equipped_exists || result.grant_exists) {
    fail(`cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  assertGatewayProfileRulesDisabled();

  const ready = request('GET', '/readyz');
  assertStatus(ready, 200, 'GET /readyz');

  let verification = null;
  let cleanupResult = null;
  try {
    seedTestUser();

    const settings = apiRequest('PUT', '/api/profile/settings', {
      displayName: 'Profile Smoke Updated',
      avatarUrl: 'https://example.com/profile-smoke.png',
      qqEmail: '123456@qq.com',
    });
    if (settings.displayName !== 'Profile Smoke Updated' || settings.qqEmail !== '123456@qq.com') {
      fail(`unexpected settings response: ${JSON.stringify(settings)}`);
    }

    const equipped = apiRequest('PUT', '/api/profile/achievements/equip', {
      achievementId: 'beginner',
    });
    if (equipped.equippedId !== 'beginner' || !equipped.equipped || equipped.equipped.id !== 'beginner') {
      fail(`unexpected equip response: ${JSON.stringify(equipped)}`);
    }

    const overview = apiRequest('GET', '/api/profile/overview');
    if (overview.user.customDisplayName !== 'Profile Smoke Updated') {
      fail(`overview did not include updated display name: ${JSON.stringify(overview.user)}`);
    }
    if (!overview.achievements || overview.achievements.equippedId !== 'beginner') {
      fail(`overview did not include equipped achievement: ${JSON.stringify(overview.achievements)}`);
    }

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
    checkedAuthenticatedPaths: [
      'PUT /api/profile/settings',
      'PUT /api/profile/achievements/equip',
      'GET /api/profile/overview',
    ],
    verification,
    cleanup: cleanupResult,
    gatewayProfileRules: 'none',
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`profile write Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
