import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const apiPort = Number(process.env.AUTH_LOGIN_SMOKE_API_PORT || 18082);
const newApiPort = Number(process.env.AUTH_LOGIN_SMOKE_NEW_API_PORT || 19091);
const testUserID = Number(process.env.AUTH_LOGIN_SMOKE_USER_ID || 999963);
const testUsername = `auth_login_smoke_${testUserID}`;
const sessionSecret = process.env.AUTH_LOGIN_SMOKE_SESSION_SECRET || 'local-development-session-secret-at-least-32-chars';
const databaseURL = process.env.TEST_DATABASE_URL || 'postgres://app:app@127.0.0.1:5432/app?sslmode=disable';
const redisURL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379/0';

function fail(message) {
  throw new Error(`auth/login Go API smoke failed: ${message}`);
}

function assertGatewayAuthRules() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => line.includes('/api/auth'));
  const expected = ['handle /api/auth/login {', 'handle /api/auth/me {', 'handle /api/auth/logout {'];
  const unexpected = activeRules.filter((line) => !expected.includes(line));
  const missing = expected.filter((line) => !activeRules.includes(line));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(`Gateway auth rules mismatch: missing=${missing.join('; ')} unexpected=${unexpected.join('; ')}`);
  }
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

function redisCli(args) {
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'redis', 'redis-cli', ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`redis-cli failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function cleanup() {
  psql(`
    DELETE FROM user_assets WHERE user_id = ${testUserID};
    DELETE FROM point_accounts WHERE user_id = ${testUserID};
    DELETE FROM users WHERE id = ${testUserID};
  `);
  redisCli(['DEL', `auth:login:fail:${testUsername}`, `auth:login:lock:${testUsername}`, `ratelimit:auth:login:user:${testUsername}`, 'ratelimit:auth:login:ip:127.0.0.1']);
}

function startFakeNewApi() {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/user/login') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'not found' }));
      return;
    }
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      res.setHeader('Content-Type', 'application/json');
      if (body.username === testUsername && body.password === 'correct-password') {
        res.setHeader('Set-Cookie', 'session=fake-new-api-session; Path=/; HttpOnly');
        res.end(JSON.stringify({
          success: true,
          message: 'ok',
          data: {
            id: testUserID,
            username: testUsername,
            display_name: 'Auth Login Smoke',
            role: 1,
            status: 1,
            email: '',
            quota: 0,
            used_quota: 0,
          },
        }));
        return;
      }
      res.end(JSON.stringify({ success: false, message: '密码错误' }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(newApiPort, '127.0.0.1', () => resolve(server));
  });
}

function startGoApi() {
  const child = spawn('go', ['run', './cmd/api'], {
    cwd: 'backend',
    env: {
      ...process.env,
      APP_MODE: 'api',
      PORT: String(apiPort),
      DATABASE_URL: databaseURL,
      REDIS_URL: redisURL,
      SESSION_SECRET: sessionSecret,
      ADMIN_USERNAMES: 'admin',
      INTERNAL_API_SECRET: 'local-internal-secret-at-least-32-chars',
      NEW_API_URL: `http://127.0.0.1:${newApiPort}`,
      NEW_API_ADMIN_ACCESS_TOKEN: '',
      NEW_API_ADMIN_USER_ID: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  return { child, getOutput: () => output };
}

function stopGoApi(proc) {
  if (!proc?.child || proc.child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(proc.child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  proc.child.kill('SIGTERM');
}

async function waitForReady(baseURL, proc) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    if (proc.child.exitCode !== null) {
      fail(`Go API exited before ready: ${proc.getOutput().slice(0, 2000)}`);
    }
    try {
      const response = await fetch(`${baseURL}/readyz`);
      if (response.status === 200) return;
    } catch {
      // 等待服务启动。
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  fail(`Go API did not become ready: ${proc.getOutput().slice(0, 2000)}`);
}

async function request(baseURL, payload) {
  const response = await fetch(`${baseURL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseURL,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    fail(`login response is not JSON: ${text.slice(0, 300)}`);
  }
  return {
    status: response.status,
    headers: response.headers,
    body,
    raw: text,
  };
}

function verifySyncedUser() {
  const raw = psql(`
    SELECT json_build_object(
      'users', (SELECT count(*) FROM users WHERE id = ${testUserID}),
      'accounts', (SELECT count(*) FROM point_accounts WHERE user_id = ${testUserID}),
      'assets', (SELECT count(*) FROM user_assets WHERE user_id = ${testUserID}),
      'username', COALESCE((SELECT username FROM users WHERE id = ${testUserID}), ''),
      'displayName', COALESCE((SELECT display_name FROM users WHERE id = ${testUserID}), '')
    )::text;
  `);
  const state = JSON.parse(raw);
  if (state.users !== 1 || state.accounts !== 1 || state.assets !== 1 || state.username !== testUsername || state.displayName !== 'Auth Login Smoke') {
    fail(`synced user mismatch: ${JSON.stringify(state)}`);
  }
  return state;
}

async function main() {
  assertGatewayAuthRules();
  cleanup();
  const fakeNewApi = await startFakeNewApi();
  const proc = startGoApi();
  const baseURL = `http://127.0.0.1:${apiPort}`;
  try {
    await waitForReady(baseURL, proc);

    const bad = await request(baseURL, { username: testUsername, password: 'bad-password' });
    if (bad.status !== 401 || bad.body.message !== '密码错误') {
      fail(`bad login mismatch: status=${bad.status} body=${JSON.stringify(bad.body)}`);
    }

    const ok = await request(baseURL, { username: testUsername, password: 'correct-password' });
    if (ok.status !== 200 || !ok.body.success || ok.body.user?.id !== testUserID) {
      fail(`successful login mismatch: status=${ok.status} body=${JSON.stringify(ok.body)}`);
    }
    const setCookie = ok.headers.get('set-cookie') || '';
    for (const name of ['app_session=', 'session=', 'new_api_session=']) {
      if (!setCookie.includes(name)) {
        fail(`successful login did not set ${name}`);
      }
    }
    const syncedUser = verifySyncedUser();
    const failExists = redisCli(['EXISTS', `auth:login:fail:${testUsername}`]);
    const lockExists = redisCli(['EXISTS', `auth:login:lock:${testUsername}`]);
    if (failExists !== '0' || lockExists !== '0') {
      fail(`successful login did not clear failure state: fail=${failExists} lock=${lockExists}`);
    }

    console.log(JSON.stringify({
      ok: true,
      mode: 'local-go-api-fake-new-api-postgres-redis',
      checkedPath: 'POST /api/auth/login',
      gatewayLoginCutover: 'enabled-exact',
      syncedUser,
    }, null, 2));
  } finally {
    stopGoApi(proc);
    fakeNewApi.close();
    cleanup();
  }
}

main().catch((error) => {
  try {
    cleanup();
  } catch (cleanupError) {
    console.error(`auth/login smoke cleanup failed: ${cleanupError?.message || cleanupError}`);
  }
  console.error(error?.message || String(error));
  process.exit(1);
});
