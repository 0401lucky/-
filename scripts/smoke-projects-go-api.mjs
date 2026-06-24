import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const baseURL = 'http://127.0.0.1:8080';
const activeProjectID = process.env.PROJECTS_SMOKE_ACTIVE_ID || 'projects-smoke-active';
const pausedProjectID = process.env.PROJECTS_SMOKE_PAUSED_ID || 'projects-smoke-paused';

function fail(message) {
  throw new Error(`projects Go API smoke failed: ${message}`);
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

function request(path) {
  const result = spawnSync(
    'docker',
    ['compose', 'exec', '-T', 'api', 'wget', '-S', '-O', '-', `${baseURL}${path}`],
    { encoding: 'utf8' },
  );
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

function verifyCleanup() {
  const result = parseJSON(psql(`
    SELECT json_build_object(
      'projects', (SELECT count(*) FROM projects WHERE id IN (${sqlLiteral(activeProjectID)}, ${sqlLiteral(pausedProjectID)}))
    )::text;
  `), 'projects cleanup verification');
  if (result.projects !== 0) {
    fail(`projects cleanup verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function main() {
  const gatewayRules = assertGatewayProjectsRulesExact();
  const ready = request('/readyz');
  if (ready.status !== 200) {
    fail(`GET /readyz expected HTTP 200, got ${ready.status}; raw=${ready.raw.slice(0, 500)}`);
  }

  let cleanupResult = null;
  try {
    seedData();
    const response = request('/api/projects');
    if (response.status !== 200) {
      fail(`GET /api/projects expected HTTP 200, got ${response.status}; raw=${response.raw.slice(0, 500)}`);
    }
    verifyProjects(parseJSON(response.body, 'GET /api/projects'));
  } finally {
    cleanup();
    cleanupResult = verifyCleanup();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'docker-compose-exec-api-and-postgres',
    baseURL,
    checkedPublicPaths: ['GET /api/projects'],
    activeProjectID,
    pausedProjectID,
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
