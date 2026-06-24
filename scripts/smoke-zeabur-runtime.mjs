const baseURL = (process.env.ZEABUR_RUNTIME_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const requireRemote = process.env.ZEABUR_RUNTIME_REQUIRE_REMOTE === '1';

function parseBaseURL(value) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`Zeabur runtime smoke failed: invalid ZEABUR_RUNTIME_BASE_URL: ${value}`);
  }
}

function isLocalHost(hostname) {
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)$/i.test(hostname);
}

const parsedBaseURL = parseBaseURL(baseURL);
if (requireRemote) {
  if (parsedBaseURL.protocol !== 'https:') {
    throw new Error('Zeabur runtime smoke failed: ZEABUR_RUNTIME_REQUIRE_REMOTE=1 requires an https ZEABUR_RUNTIME_BASE_URL');
  }
  if (isLocalHost(parsedBaseURL.hostname)) {
    throw new Error('Zeabur runtime smoke failed: ZEABUR_RUNTIME_REQUIRE_REMOTE=1 cannot target localhost or loopback addresses');
  }
}

const checks = [
  {
    label: 'healthz',
    path: '/healthz',
    expectedStatus: 200,
    expectJSON: (body) => body.ok === true && body.service === 'go-api',
  },
  {
    label: 'readyz',
    path: '/readyz',
    expectedStatus: 200,
    expectJSON: (body) => body.ok === true && body.postgres === true && body.redis === true,
  },
  {
    label: 'home page',
    path: '/',
    expectedStatus: 200,
    expectText: (body, headers) => {
      const contentType = headers.get('content-type') || '';
      return contentType.includes('text/html') && /<html/i.test(body);
    },
  },
  {
    label: 'public projects',
    path: '/api/projects',
    expectedStatus: 200,
    expectJSON: (body) => body.success === true && Array.isArray(body.projects),
  },
  {
    label: 'public raffle',
    path: '/api/raffle',
    expectedStatus: 200,
    expectJSON: (body) => body.success === true && Array.isArray(body.raffles),
  },
  {
    label: 'points unauthenticated boundary',
    path: '/api/points',
    expectedStatus: 401,
  },
  {
    label: 'store unauthenticated boundary',
    path: '/api/store',
    expectedStatus: 401,
  },
  {
    label: 'games profile unauthenticated boundary',
    path: '/api/games/profile',
    expectedStatus: 401,
  },
  {
    label: 'eco status unauthenticated boundary',
    path: '/api/games/eco/status',
    expectedStatus: 401,
  },
  {
    label: 'memory status unauthenticated boundary',
    path: '/api/games/memory/status',
    expectedStatus: 401,
  },
];

function fail(message) {
  throw new Error(`Zeabur runtime smoke failed: ${message}`);
}

async function readBody(response) {
  const text = await response.text();
  return text;
}

async function runCheck(check) {
  const url = `${baseURL}${check.path}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
    },
    redirect: 'manual',
  });
  const bodyText = await readBody(response);
  if (response.status !== check.expectedStatus) {
    fail(`${check.label} expected HTTP ${check.expectedStatus}, got ${response.status}; body=${bodyText.slice(0, 300)}`);
  }
  if (check.expectJSON) {
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      fail(`${check.label} did not return JSON: ${bodyText.slice(0, 300)}`);
    }
    if (!check.expectJSON(parsed)) {
      fail(`${check.label} JSON shape mismatch: ${JSON.stringify(parsed).slice(0, 500)}`);
    }
  }
  if (check.expectText && !check.expectText(bodyText, response.headers)) {
    fail(`${check.label} text shape mismatch: ${bodyText.slice(0, 300)}`);
  }
  return {
    label: check.label,
    path: check.path,
    status: response.status,
  };
}

const results = [];
for (const check of checks) {
  results.push(await runCheck(check));
}

console.log(JSON.stringify({
  ok: true,
  mode: 'zeabur-runtime-smoke',
  baseURL,
  requireRemote,
  checks: results,
}, null, 2));
