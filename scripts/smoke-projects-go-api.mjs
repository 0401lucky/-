import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const baseURL = 'http://127.0.0.1:8080';
const origin = process.env.PROJECTS_GO_API_ORIGIN || baseURL;
const activeProjectID = process.env.PROJECTS_SMOKE_ACTIVE_ID || 'projects-smoke-active';
const pausedProjectID = process.env.PROJECTS_SMOKE_PAUSED_ID || 'projects-smoke-paused';
const testUserID = Number(process.env.PROJECTS_SMOKE_USER_ID || 999973);
const testUsername = `projects_smoke_${testUserID}`;
const sessionSecret = 'local-development-session-secret-at-least-32-chars';
const cookie = makeSessionCookie(testUserID, testUsername, 'Projects Smoke User');

function fail(message) {
  throw new Error(`projects Go API smoke failed: ${message}`);
}

function makeSessionCookie(userID, username, displayName) {
  const now = Date.now();
  const raw = JSON.stringify({
    id: userID,
    username,
    displayName,
    iat: now,
    exp: now + 3600000,
    jti: `projects-smoke-${userID}-${now}`,
  });
  const payload = Buffer.from(raw).toString('base64');
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex');
  return `app_session=${payload}.${sig}`;
}

function assertGatewayProjectsRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) =>
      line.includes('/api/projects') ||
      line.includes('/api/admin/projects')
    );
  const allowed = new Set([
    'handle /api/projects {',
    'handle /api/projects/my-claims {',
    'handle /api/projects/* {',
    'handle /api/admin/projects {',
    'handle /api/admin/projects/* {',
  ]);
  const unexpected = activeRules.filter((line) => !allowed.has(line));
  if (unexpected.length > 0) {
    fail(`gateway/Caddyfile contains unexpected projects rules: ${unexpected.join('; ')}`);
  }
  if (!activeRules.includes('handle /api/projects {')) {
    fail('gateway/Caddyfile is missing exact /api/projects rule');
  }
  if (!activeRules.includes('handle /api/projects/my-claims {') || !activeRules.includes('handle /api/projects/* {')) {
    fail('gateway/Caddyfile is missing public project detail/my-claims rules');
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

function request(method, path, requestCookie = '') {
  const args = ['compose', 'exec', '-T', 'api', 'wget', '-S', '-O', '-'];
  if (requestCookie) {
    args.push('--header', `Cookie: ${requestCookie}`);
  }
  if (method !== 'GET') {
    args.push('--header', `Origin: ${origin}`);
    args.push('--header', 'Content-Type: application/json');
    args.push('--post-data', '{}');
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

function cleanup() {
  psql(`
    DELETE FROM exchange_logs WHERE user_id = ${testUserID} OR item_id IN (${sqlLiteral(activeProjectID)}, ${sqlLiteral(pausedProjectID)});
    DELETE FROM point_ledger WHERE user_id = ${testUserID};
    DELETE FROM point_accounts WHERE user_id = ${testUserID};
    DELETE FROM user_assets WHERE user_id = ${testUserID};
    DELETE FROM users WHERE id = ${testUserID};
    DELETE FROM projects WHERE id IN (${sqlLiteral(activeProjectID)}, ${sqlLiteral(pausedProjectID)});
  `);
}

function seedData() {
  cleanup();
  const nowMs = Date.now();
  psql(`
    INSERT INTO projects (
      id, name, description, max_claims, claimed_count, codes_count, status,
      created_at_ms, created_by, reward_type, direct_points, new_user_only, pinned, pinned_at_ms
    ) VALUES
      (${sqlLiteral(activeProjectID)}, 'Projects Smoke Active', 'Go API smoke active project', 10, 2, 8, 'active',
       ${nowMs}, 'smoke', 'direct', 5, false, true, ${nowMs}),
      (${sqlLiteral(pausedProjectID)}, 'Projects Smoke Paused', 'Go API smoke paused project', 10, 0, 10, 'paused',
       ${nowMs - 1}, 'smoke', 'code', NULL, false, false, NULL);
  `);
}

function verifyProjects(payload) {
  if (!payload.success || !Array.isArray(payload.projects)) {
    fail(`projects payload is not compatible: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  const active = payload.projects.find((item) => item.id === activeProjectID);
  if (!active || active.name !== 'Projects Smoke Active' || active.status !== 'active' || active.directPoints !== 5 || active.pinned !== true) {
    fail(`active smoke project missing or malformed: ${JSON.stringify(active || payload.projects).slice(0, 500)}`);
  }
  if (payload.projects.some((item) => item.id === pausedProjectID)) {
    fail(`paused smoke project should not be public: ${JSON.stringify(payload.projects).slice(0, 500)}`);
  }
}

function verifyProjectDetail(payload, claimedExpected) {
  if (!payload.success || !payload.project || payload.project.id !== activeProjectID) {
    fail(`project detail payload is not compatible: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  if (claimedExpected && (!payload.claimed || payload.claimed.creditStatus !== 'success' || payload.claimed.creditedPoints !== 5)) {
    fail(`project claimed payload is missing: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  if (!claimedExpected && payload.claimed !== null) {
    fail(`anonymous project detail should not include claim record: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function verifyClaim(payload) {
  if (!payload.success || payload.directCredit !== true || payload.creditedPoints !== 5 || payload.creditStatus !== 'success') {
    fail(`claim payload is not compatible: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function verifyMyClaims(payload) {
  if (!payload.success || !Array.isArray(payload.data?.projectIds) || !payload.data.projectIds.includes(activeProjectID)) {
    fail(`my-claims payload is not compatible: ${JSON.stringify(payload).slice(0, 500)}`);
  }
}

function verifyCleanup() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'projects', (SELECT count(*) FROM projects WHERE id IN (${sqlLiteral(activeProjectID)}, ${sqlLiteral(pausedProjectID)})),
      'users', (SELECT count(*) FROM users WHERE id = ${testUserID}),
      'accounts', (SELECT count(*) FROM point_accounts WHERE user_id = ${testUserID}),
      'ledgers', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID}),
      'logs', (SELECT count(*) FROM exchange_logs WHERE user_id = ${testUserID})
    )::text;
  `), 'projects cleanup verification');
  if (result.projects !== 0 || result.users !== 0 || result.accounts !== 0 || result.ledgers !== 0 || result.logs !== 0) {
    fail(`projects cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  const gatewayRules = assertGatewayProjectsRulesExact();
  const ready = request('GET', '/readyz');
  if (ready.status !== 200) {
    fail(`GET /readyz expected HTTP 200, got ${ready.status}; raw=${ready.raw.slice(0, 500)}`);
  }

  let cleanupResult = null;
  try {
    seedData();
    const response = request('GET', '/api/projects');
    if (response.status !== 200) {
      fail(`GET /api/projects expected HTTP 200, got ${response.status}; raw=${response.raw.slice(0, 500)}`);
    }
    verifyProjects(parseJSON(response.body, 'GET /api/projects'));

    const anonymousDetail = request('GET', `/api/projects/${activeProjectID}`);
    if (anonymousDetail.status !== 200) {
      fail(`GET /api/projects/{id} expected HTTP 200, got ${anonymousDetail.status}; raw=${anonymousDetail.raw.slice(0, 500)}`);
    }
    verifyProjectDetail(parseJSON(anonymousDetail.body, 'GET /api/projects/{id} anonymous'), false);

    const unauthenticatedClaims = request('GET', '/api/projects/my-claims');
    if (unauthenticatedClaims.status !== 401) {
      fail(`GET /api/projects/my-claims without cookie expected HTTP 401, got ${unauthenticatedClaims.status}; raw=${unauthenticatedClaims.raw.slice(0, 500)}`);
    }

    const claim = request('POST', `/api/projects/${activeProjectID}`, cookie);
    if (claim.status !== 200) {
      fail(`POST /api/projects/{id} expected HTTP 200, got ${claim.status}; raw=${claim.raw.slice(0, 500)}`);
    }
    verifyClaim(parseJSON(claim.body, 'POST /api/projects/{id}'));

    const duplicate = request('POST', `/api/projects/${activeProjectID}`, cookie);
    if (duplicate.status !== 200) {
      fail(`duplicate POST /api/projects/{id} expected HTTP 200, got ${duplicate.status}; raw=${duplicate.raw.slice(0, 500)}`);
    }
    verifyClaim(parseJSON(duplicate.body, 'duplicate POST /api/projects/{id}'));

    const myClaims = request('GET', '/api/projects/my-claims', cookie);
    if (myClaims.status !== 200) {
      fail(`GET /api/projects/my-claims expected HTTP 200, got ${myClaims.status}; raw=${myClaims.raw.slice(0, 500)}`);
    }
    verifyMyClaims(parseJSON(myClaims.body, 'GET /api/projects/my-claims'));

    const claimedDetail = request('GET', `/api/projects/${activeProjectID}`, cookie);
    if (claimedDetail.status !== 200) {
      fail(`GET claimed /api/projects/{id} expected HTTP 200, got ${claimedDetail.status}; raw=${claimedDetail.raw.slice(0, 500)}`);
    }
    verifyProjectDetail(parseJSON(claimedDetail.body, 'GET /api/projects/{id} claimed'), true);

    const dbState = parseJSON(psql(`
      SELECT json_build_object(
        'balance', (SELECT balance FROM point_accounts WHERE user_id = ${testUserID}),
        'ledgers', (SELECT count(*) FROM point_ledger WHERE user_id = ${testUserID} AND source = 'project_claim'),
        'logs', (SELECT count(*) FROM exchange_logs WHERE user_id = ${testUserID} AND item_id = ${sqlLiteral(activeProjectID)} AND type = 'project_direct'),
        'claimedCount', (SELECT claimed_count FROM projects WHERE id = ${sqlLiteral(activeProjectID)})
      )::text;
    `), 'projects claim db state');
    if (dbState.balance !== 5 || dbState.ledgers !== 1 || dbState.logs !== 1 || dbState.claimedCount !== 3) {
      fail(`unexpected projects claim db state: ${JSON.stringify(dbState)}`);
    }
  } finally {
    cleanup();
    cleanupResult = verifyCleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres',
    baseURL,
    checkedPublicPaths: [
      'GET /api/projects',
      'GET /api/projects/{id}',
      'POST /api/projects/{id}',
      'GET /api/projects/my-claims',
    ],
    activeProjectID,
    pausedProjectID,
    testUserID,
    cleanup: cleanupResult,
    gatewayProjectsRules: gatewayRules,
  }, null, 2));
}

try {
  main();
} catch (error) {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`projects Go API smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
}
