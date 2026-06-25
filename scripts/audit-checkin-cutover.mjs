import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedCheckinApiPaths = [
  '/api/checkin',
  '/api/checkin/makeup',
];

const requiredGoRouteSnippets = [
  'api.Get("/checkin", checkinHandlers.status)',
  'api.Post("/checkin", checkinHandlers.checkin)',
  'api.Post("/checkin/makeup", checkinHandlers.makeup)',
];

const expectedGatewayRules = [
  'handle /api/checkin {',
  'handle /api/checkin/makeup {',
];

const requiredJSONFields = [
  'checkedIn',
  'extraSpins',
  'dailyFreeAvailable',
  'makeupCards',
  'history',
  'weekStatus',
  'todayCheckinResult',
  'weekdayMon0',
  'weekBroken',
  'monThruSatAllSigned',
  'previewPoints',
  'previewSpins',
  'success',
  'message',
  'pointsAwarded',
  'pointsBalance',
  'extraSpinsAwarded',
  'weekdayLabel',
  'date',
  'stillMissing',
];

const requiredSmokeSnippets = [
  'CHECKIN_SMOKE_USER_ID',
  'docker-compose-exec-api-and-postgres',
  'gatewayCheckinRules',
  'checkedPaths',
  '/api/checkin',
  '/api/checkin/makeup',
  'verifyCleanup',
];

function fail(message, details = []) {
  console.error(`checkin cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const pageSource = read('src/app/checkin/page.tsx');
const frontendPaths = new Set(
  [...pageSource.matchAll(/['"`](\/api\/checkin(?:\/makeup)?)(?:[?'"`]|$)/g)].map((match) => match[1]),
);
const missingFrontendPaths = expectedCheckinApiPaths.filter((apiPath) => !frontendPaths.has(apiPath));
const unexpectedFrontendPaths = [...frontendPaths].filter((apiPath) => !expectedCheckinApiPaths.includes(apiPath));
if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend checkin API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected frontend path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => `unexpected frontend path ${apiPath}`),
  ]);
}

const serverSource = read('backend/internal/httpserver/server.go');
const missingGoRoutes = requiredGoRouteSnippets.filter((snippet) => !serverSource.includes(snippet));
if (missingGoRoutes.length > 0) {
  fail('Go checkin routes are incomplete', missingGoRoutes);
}

const typesSource = read('backend/internal/checkin/types.go');
const goJSONTags = new Set(
  [...typesSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]),
);
const missingJSONFields = requiredJSONFields.filter((field) => !goJSONTags.has(field));
if (missingJSONFields.length > 0) {
  fail('Go checkin response JSON fields are incomplete', missingJSONFields);
}

if (!existsSync(path.join(repoRoot, 'backend/migrations/0020_checkin.sql'))) {
  fail('checkin migration is missing', ['backend/migrations/0020_checkin.sql']);
}
const migrationSource = read('backend/migrations/0020_checkin.sql');
for (const snippet of ['CREATE TABLE IF NOT EXISTS checkin_records', 'PRIMARY KEY (user_id, checkin_date)']) {
  if (!migrationSource.includes(snippet)) {
    fail('checkin migration shape is incomplete', [snippet]);
  }
}

const gatewaySource = read('gateway/Caddyfile');
const activeGatewayRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line.includes('/api/checkin') && !entry.line.startsWith('#'));
const actualGatewayRules = new Set(activeGatewayRules.map((entry) => entry.line));
const missingGatewayRules = expectedGatewayRules.filter((line) => !actualGatewayRules.has(line));
const unexpectedGatewayRules = activeGatewayRules
  .filter((entry) => !expectedGatewayRules.includes(entry.line))
  .map((entry) => `gateway/Caddyfile:${entry.lineNumber} ${entry.line}`);
if (missingGatewayRules.length > 0 || unexpectedGatewayRules.length > 0) {
  fail('Gateway checkin rules must stay limited to exact paths', [
    ...missingGatewayRules.map((line) => `missing ${line}`),
    ...unexpectedGatewayRules.map((line) => `unexpected ${line}`),
  ]);
}

const smokePath = path.join(repoRoot, 'scripts/smoke-checkin-go-api.mjs');
if (!existsSync(smokePath)) {
  fail('checkin smoke script is missing', ['scripts/smoke-checkin-go-api.mjs']);
}
const smokeSource = readFileSync(smokePath, 'utf8');
const missingSmokeSnippets = requiredSmokeSnippets.filter((snippet) => !smokeSource.includes(snippet));
if (missingSmokeSnippets.length > 0) {
  fail('checkin smoke script is incomplete', missingSmokeSnippets);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'checkin-cutover-audit',
  frontendCheckinApiPaths: expectedCheckinApiPaths,
  goRoutes: requiredGoRouteSnippets,
  goJSONFields: requiredJSONFields,
  gatewayCheckinRules: expectedGatewayRules,
  smoke: 'scripts/smoke-checkin-go-api.mjs',
}, null, 2));
