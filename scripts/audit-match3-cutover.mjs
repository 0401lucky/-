import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedMatch3ApiPaths = [
  '/api/games/match3/status',
  '/api/games/match3/start',
  '/api/games/match3/submit',
  '/api/games/match3/cancel',
];

const requiredGoRouteSnippets = [
  'match3Router.Get("/status", match3Handlers.status)',
  'match3Router.Post("/start", match3Handlers.start)',
  'match3Router.Post("/submit", match3Handlers.submit)',
  'match3Router.Post("/cancel", match3Handlers.cancel)',
  'match3Router.HandleFunc("/*", notMigratedHandler("match3"))',
];

const requiredHandlerSnippets = [
  'func (handlers match3Handlers) status',
  'func (handlers match3Handlers) start',
  'func (handlers match3Handlers) submit',
  'func (handlers match3Handlers) cancel',
  'rejectUntrustedUnsafeRequest',
  'gameStartRateLimit',
  'gameSubmitRateLimit',
];

const requiredServiceSnippets = [
  'func (service *Service) Status',
  'func (service *Service) Start',
  'func (service *Service) Submit',
  'func (service *Service) Cancel',
  'BuildSessionView',
  'SimulateGame',
  'CalculatePointReward',
  'FOR UPDATE',
  'addGamePointsWithLimit',
  'insertRecord',
  'deleteSessionAndActive',
  'setCooldown',
];

const requiredJSONFields = [
  'sessionId',
  'seed',
  'config',
  'timeLimitMs',
  'startedAt',
  'expiresAt',
  'balance',
  'dailyStats',
  'inCooldown',
  'cooldownRemaining',
  'dailyLimit',
  'pointsLimitReached',
  'records',
  'activeSession',
  'record',
  'pointsEarned',
  'score',
  'moves',
  'cascades',
  'tilesCleared',
  'duration',
  'createdAt',
];

const requiredMigrationSnippets = [
  'CREATE TABLE IF NOT EXISTS game_sessions',
  'CREATE TABLE IF NOT EXISTS active_game_sessions',
  'CREATE TABLE IF NOT EXISTS game_records',
  'CREATE TABLE IF NOT EXISTS game_cooldowns',
  'CREATE TABLE IF NOT EXISTS game_daily_stats',
  'CREATE TABLE IF NOT EXISTS daily_game_points',
  'CREATE TABLE IF NOT EXISTS point_accounts',
  'CREATE TABLE IF NOT EXISTS point_ledger',
];

const requiredSmokeFiles = [
  'scripts/smoke-match3-go-api.mjs',
];

const requiredSmokeSnippets = [
  'MATCH3_SMOKE_USER_ID',
  'docker-compose-exec-api-and-postgres',
  'checkedMatch3Paths',
  '/api/games/match3/submit',
  'seed-for-test',
  'verifySettlement',
  'verifyCleanup',
  'gatewayMatch3Rules',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'games', 'match3'),
];

function walkFiles(root, files = []) {
  if (!existsSync(root)) {
    return files;
  }
  const stat = statSync(root);
  if (stat.isFile()) {
    if (/\.(tsx?|jsx?)$/.test(root)) {
      files.push(root);
    }
    return files;
  }
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    const entryStat = statSync(fullPath);
    if (entryStat.isDirectory()) {
      walkFiles(fullPath, files);
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizeSlash(value) {
  return value.split(path.sep).join('/');
}

function fail(message, details = []) {
  console.error(`match3 cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const match3PathPattern = /['"`](\/api\/games\/match3\/[^'"`?]+)(?:[?#][^'"`]*)?['"`]/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(match3PathPattern)) {
    const apiPath = match[1];
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedSet = new Set(expectedMatch3ApiPaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedMatch3ApiPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedSet.has(apiPath));
if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend match3 API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected frontend path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => `unexpected frontend path ${apiPath}`),
  ]);
}

const serverSource = read('backend/internal/httpserver/server.go');
const missingGoRoutes = requiredGoRouteSnippets.filter((snippet) => !serverSource.includes(snippet));
if (missingGoRoutes.length > 0) {
  fail('Go match3 routes are incomplete', missingGoRoutes);
}

const handlerSource = read('backend/internal/httpserver/match3_handlers.go');
const missingHandlerSnippets = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
if (missingHandlerSnippets.length > 0) {
  fail('Go match3 handlers are missing required snippets', missingHandlerSnippets);
}

const serviceSource = [
  read('backend/internal/match3/types.go'),
  read('backend/internal/match3/service.go'),
  read('backend/internal/match3/engine.go'),
].join('\n');
const missingServiceSnippets = requiredServiceSnippets.filter((snippet) => !serviceSource.includes(snippet));
if (missingServiceSnippets.length > 0) {
  fail('Go match3 service is missing required snippets', missingServiceSnippets);
}

const goJSONTags = new Set([...serviceSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]));
const missingJSONFields = requiredJSONFields.filter((field) => !goJSONTags.has(field) && !handlerSource.includes(`"${field}"`));
if (missingJSONFields.length > 0) {
  fail('Go match3 response JSON fields are incomplete', missingJSONFields);
}

const migrationSource = [
  read('backend/migrations/0001_base.sql'),
  read('backend/migrations/0012_game_runtime.sql'),
].join('\n');
const missingMigrationSnippets = requiredMigrationSnippets.filter((snippet) => !migrationSource.includes(snippet));
if (missingMigrationSnippets.length > 0) {
  fail('match3 runtime migrations are incomplete', missingMigrationSnippets);
}

const missingSmokeFiles = requiredSmokeFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingSmokeFiles.length > 0) {
  fail('match3 direct API smoke files are missing', missingSmokeFiles);
}
const smokeSource = requiredSmokeFiles.map((relativePath) => read(relativePath)).join('\n');
const missingSmokeSnippets = requiredSmokeSnippets.filter((snippet) => !smokeSource.includes(snippet));
if (missingSmokeSnippets.length > 0) {
  fail('match3 direct API smoke script is incomplete', missingSmokeSnippets);
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewayLines = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'));
const activeGatewayMatch3Rules = activeGatewayLines.filter((entry) => entry.line.includes('/api/games/match3'));

const allowedGatewayRules = new Set(expectedMatch3ApiPaths.map((apiPath) => `handle ${apiPath} {`));
const missingGatewayRules = [...allowedGatewayRules].filter((line) =>
  !activeGatewayMatch3Rules.some((entry) => entry.line === line)
);
const unexpectedGatewayRules = activeGatewayMatch3Rules.filter((entry) => !allowedGatewayRules.has(entry.line));
const forbiddenGatewayRules = activeGatewayLines.filter((entry) =>
  entry.line === 'handle /api/games/* {' ||
  entry.line === 'handle /api/games/match3* {' ||
  entry.line === 'handle /api/games/match3/* {'
);
if (missingGatewayRules.length > 0 || unexpectedGatewayRules.length > 0 || forbiddenGatewayRules.length > 0) {
  fail('Gateway match3 rules are not the reviewed exact cutover set', [
    ...missingGatewayRules.map((line) => `missing gateway rule ${line}`),
    ...unexpectedGatewayRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`),
    ...forbiddenGatewayRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} forbidden ${entry.line}`),
  ]);
}

const summary = {
  frontendMatch3ApiPaths: Object.fromEntries([...discovered.entries()]),
  goRoutes: requiredGoRouteSnippets,
  migrations: [
    'backend/migrations/0001_base.sql',
    'backend/migrations/0012_game_runtime.sql',
  ],
  smokeFiles: requiredSmokeFiles,
  gatewayMatch3Rules: activeGatewayMatch3Rules.map((entry) => entry.line),
  wildcardCutover: 'disabled',
};

console.log(JSON.stringify(summary, null, 2));
