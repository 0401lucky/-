import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedFrontendApiPaths = [
  '/api/games/whack-mole/status',
  '/api/games/whack-mole/start',
  '/api/games/whack-mole/submit',
  '/api/games/whack-mole/cancel',
];

const expectedGatewayApiPaths = [
  '/api/games/whack-mole/status',
  '/api/games/whack-mole/sync',
  '/api/games/whack-mole/start',
  '/api/games/whack-mole/submit',
  '/api/games/whack-mole/cancel',
];

const requiredGoRouteSnippets = [
  'whackRouter.Get("/status", whackMoleHandlers.status)',
  'whackRouter.Get("/sync", whackMoleHandlers.sync)',
  'whackRouter.Post("/start", whackMoleHandlers.start)',
  'whackRouter.Post("/submit", whackMoleHandlers.submit)',
  'whackRouter.Post("/cancel", whackMoleHandlers.cancel)',
  'whackRouter.HandleFunc("/*", notMigratedHandler("whack_mole"))',
];

const requiredHandlerSnippets = [
  'func (handlers whackMoleHandlers) status',
  'func (handlers whackMoleHandlers) sync',
  'func (handlers whackMoleHandlers) start',
  'func (handlers whackMoleHandlers) submit',
  'func (handlers whackMoleHandlers) cancel',
  'rejectUntrustedUnsafeRequest',
  'gameStartRateLimit',
  'gameSubmitRateLimit',
];

const requiredServiceSnippets = [
  'func (service *Service) Status',
  'func (service *Service) Sync',
  'func (service *Service) Start',
  'func (service *Service) Submit',
  'func (service *Service) Cancel',
  'BuildSessionView',
  'ScoreEvents',
  'CalculatePointReward',
  'ValidateEventsRate',
  'NormalizeEvents',
  'FOR UPDATE',
  'addGamePointsWithLimit',
  'insertRecord',
  'deleteSessionAndActive',
  'setCooldown',
];

const requiredJSONFields = [
  'sessionId',
  'seed',
  'startedAt',
  'expiresAt',
  'durationMs',
  'difficulty',
  'board',
  'boardTick',
  'timeLeftMs',
  'score',
  'combo',
  'eventsCount',
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
  'hits',
  'goldenHits',
  'misses',
  'bombs',
  'maxCombo',
  'duration',
  'createdAt',
  'events',
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
  'scripts/smoke-whack-mole-go-api.mjs',
];

const requiredSmokeSnippets = [
  'WHACK_MOLE_SMOKE_USER_ID',
  'docker-compose-exec-api-and-postgres',
  'checkedWhackMolePaths',
  '/api/games/whack-mole/submit',
  'whack-test-seed-alpha',
  'verifySettlement',
  'verifyCleanup',
  'gatewayWhackMoleRules',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'games', 'whack-mole'),
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
  console.error(`whack-mole cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const whackMolePathPattern = /['"`](\/api\/games\/whack-mole\/[^'"`?]+)(?:[?#][^'"`]*)?['"`]/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(whackMolePathPattern)) {
    const apiPath = match[1];
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedFrontendSet = new Set(expectedFrontendApiPaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedFrontendApiPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedFrontendSet.has(apiPath));
if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend whack-mole API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected frontend path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => `unexpected frontend path ${apiPath}`),
  ]);
}

const serverSource = read('backend/internal/httpserver/server.go');
const missingGoRoutes = requiredGoRouteSnippets.filter((snippet) => !serverSource.includes(snippet));
if (missingGoRoutes.length > 0) {
  fail('Go whack-mole routes are incomplete', missingGoRoutes);
}

const handlerSource = read('backend/internal/httpserver/whack_mole_handlers.go');
const missingHandlerSnippets = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
if (missingHandlerSnippets.length > 0) {
  fail('Go whack-mole handlers are missing required snippets', missingHandlerSnippets);
}

const serviceSource = [
  read('backend/internal/whackmole/types.go'),
  read('backend/internal/whackmole/service.go'),
  read('backend/internal/whackmole/engine.go'),
].join('\n');
const missingServiceSnippets = requiredServiceSnippets.filter((snippet) => !serviceSource.includes(snippet));
if (missingServiceSnippets.length > 0) {
  fail('Go whack-mole service is missing required snippets', missingServiceSnippets);
}

const goJSONTags = new Set([...serviceSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]));
const missingJSONFields = requiredJSONFields.filter((field) => !goJSONTags.has(field) && !handlerSource.includes(`"${field}"`));
if (missingJSONFields.length > 0) {
  fail('Go whack-mole response JSON fields are incomplete', missingJSONFields);
}

const migrationSource = [
  read('backend/migrations/0001_base.sql'),
  read('backend/migrations/0012_game_runtime.sql'),
].join('\n');
const missingMigrationSnippets = requiredMigrationSnippets.filter((snippet) => !migrationSource.includes(snippet));
if (missingMigrationSnippets.length > 0) {
  fail('whack-mole runtime migrations are incomplete', missingMigrationSnippets);
}

const missingSmokeFiles = requiredSmokeFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingSmokeFiles.length > 0) {
  fail('whack-mole direct API smoke files are missing', missingSmokeFiles);
}
const smokeSource = requiredSmokeFiles.map((relativePath) => read(relativePath)).join('\n');
const missingSmokeSnippets = requiredSmokeSnippets.filter((snippet) => !smokeSource.includes(snippet));
if (missingSmokeSnippets.length > 0) {
  fail('whack-mole direct API smoke script is incomplete', missingSmokeSnippets);
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewayLines = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'));
const activeGatewayWhackMoleRules = activeGatewayLines.filter((entry) => entry.line.includes('/api/games/whack-mole'));

const allowedGatewayRules = new Set(expectedGatewayApiPaths.map((apiPath) => `handle ${apiPath} {`));
const missingGatewayRules = [...allowedGatewayRules].filter((line) =>
  !activeGatewayWhackMoleRules.some((entry) => entry.line === line)
);
const unexpectedGatewayRules = activeGatewayWhackMoleRules.filter((entry) => !allowedGatewayRules.has(entry.line));
const forbiddenGatewayRules = activeGatewayLines.filter((entry) =>
  entry.line === 'handle /api/games/* {' ||
  entry.line === 'handle /api/games/whack-mole* {' ||
  entry.line === 'handle /api/games/whack-mole/* {'
);
if (missingGatewayRules.length > 0 || unexpectedGatewayRules.length > 0 || forbiddenGatewayRules.length > 0) {
  fail('Gateway whack-mole rules are not the reviewed exact cutover set', [
    ...missingGatewayRules.map((line) => `missing gateway rule ${line}`),
    ...unexpectedGatewayRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`),
    ...forbiddenGatewayRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} forbidden ${entry.line}`),
  ]);
}

const summary = {
  frontendWhackMoleApiPaths: Object.fromEntries([...discovered.entries()]),
  goRoutes: requiredGoRouteSnippets,
  migrations: [
    'backend/migrations/0001_base.sql',
    'backend/migrations/0012_game_runtime.sql',
  ],
  smokeFiles: requiredSmokeFiles,
  gatewayWhackMoleRules: activeGatewayWhackMoleRules.map((entry) => entry.line),
  wildcardCutover: 'disabled',
};

console.log(JSON.stringify(summary, null, 2));
