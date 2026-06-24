import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedRogueliteApiPaths = [
  '/api/games/roguelite/status',
  '/api/games/roguelite/start',
  '/api/games/roguelite/step',
  '/api/games/roguelite/submit',
  '/api/games/roguelite/cancel',
];

const requiredGoRouteSnippets = [
  'rogueliteRouter.Get("/status", rogueliteHandlers.status)',
  'rogueliteRouter.Post("/start", rogueliteHandlers.start)',
  'rogueliteRouter.Post("/step", rogueliteHandlers.step)',
  'rogueliteRouter.Post("/submit", rogueliteHandlers.submit)',
  'rogueliteRouter.Post("/cancel", rogueliteHandlers.cancel)',
  'rogueliteRouter.HandleFunc("/*", notMigratedHandler("roguelite"))',
];

const requiredHandlerSnippets = [
  'func (handlers rogueliteHandlers) status',
  'func (handlers rogueliteHandlers) start',
  'func (handlers rogueliteHandlers) step',
  'func (handlers rogueliteHandlers) submit',
  'func (handlers rogueliteHandlers) cancel',
  'decodeRogueliteStepInput',
  'decodeRogueliteAction',
  'rejectUntrustedUnsafeRequest',
  'gameStartRateLimit',
  'gameActionRateLimit',
  'gameSubmitRateLimit',
];

const requiredServiceSnippets = [
  'func (service *Service) Status',
  'func (service *Service) Start',
  'func (service *Service) Step',
  'func (service *Service) Submit',
  'func (service *Service) Cancel',
  'BuildSessionView',
  'BuildStateView',
  'ResolveAction',
  'CalculateScore',
  'CalculatePointReward',
  'settledRecordOrFailure',
  'appendCompactAction',
  'FOR UPDATE',
  'addGamePointsWithLimit',
  'insertRecord',
  'updateSession',
  'deleteSessionAndActive',
  'setCooldown',
];

const requiredJSONFields = [
  'sessionId',
  'startedAt',
  'expiresAt',
  'actionsCount',
  'state',
  'floor',
  'boardSize',
  'viewportRadius',
  'sightRadius',
  'board',
  'player',
  'starGate',
  'pending',
  'status',
  'scorePreview',
  'outcome',
  'record',
  'pointsEarned',
  'won',
  'finalFloor',
  'floorsCleared',
  'score',
  'stardust',
  'hpRemaining',
  'relics',
  'monstersDefeated',
  'chestsOpened',
  'stepsUsed',
  'duration',
  'scoreBreakdown',
  'createdAt',
  'balance',
  'dailyStats',
  'inCooldown',
  'cooldownRemaining',
  'dailyLimit',
  'pointsLimitReached',
  'records',
  'activeSession',
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
  'scripts/smoke-roguelite-go-api.mjs',
];

const requiredSmokeSnippets = [
  'ROGUELITE_SMOKE_USER_ID',
  'docker-compose-exec-api-and-postgres',
  'checkedRoguelitePaths',
  '/api/games/roguelite/step',
  'prepareEscapedSession',
  'verifySettlement',
  'verifyCleanup',
  'gatewayRogueliteRules',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'games', 'roguelite'),
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
  console.error(`roguelite cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const roguelitePathPattern = /['"`](\/api\/games\/roguelite\/[^'"`?]+)(?:[?#][^'"`]*)?['"`]/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(roguelitePathPattern)) {
    const apiPath = match[1];
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedSet = new Set(expectedRogueliteApiPaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedRogueliteApiPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedSet.has(apiPath));
if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend roguelite API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected frontend path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => `unexpected frontend path ${apiPath}`),
  ]);
}

const serverSource = read('backend/internal/httpserver/server.go');
const missingGoRoutes = requiredGoRouteSnippets.filter((snippet) => !serverSource.includes(snippet));
if (missingGoRoutes.length > 0) {
  fail('Go roguelite routes are incomplete', missingGoRoutes);
}

const handlerSource = read('backend/internal/httpserver/roguelite_handlers.go');
const missingHandlerSnippets = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
if (missingHandlerSnippets.length > 0) {
  fail('Go roguelite handlers are missing required snippets', missingHandlerSnippets);
}

const serviceSource = [
  read('backend/internal/roguelite/types.go'),
  read('backend/internal/roguelite/service.go'),
  read('backend/internal/roguelite/engine.go'),
].join('\n');
const missingServiceSnippets = requiredServiceSnippets.filter((snippet) => !serviceSource.includes(snippet));
if (missingServiceSnippets.length > 0) {
  fail('Go roguelite service is missing required snippets', missingServiceSnippets);
}

const goJSONTags = new Set([...serviceSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]));
const missingJSONFields = requiredJSONFields.filter((field) => !goJSONTags.has(field) && !handlerSource.includes(`"${field}"`));
if (missingJSONFields.length > 0) {
  fail('Go roguelite response JSON fields are incomplete', missingJSONFields);
}

const migrationSource = [
  read('backend/migrations/0001_base.sql'),
  read('backend/migrations/0012_game_runtime.sql'),
].join('\n');
const missingMigrationSnippets = requiredMigrationSnippets.filter((snippet) => !migrationSource.includes(snippet));
if (missingMigrationSnippets.length > 0) {
  fail('roguelite runtime migrations are incomplete', missingMigrationSnippets);
}

const missingSmokeFiles = requiredSmokeFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingSmokeFiles.length > 0) {
  fail('roguelite direct API smoke files are missing', missingSmokeFiles);
}
const smokeSource = requiredSmokeFiles.map((relativePath) => read(relativePath)).join('\n');
const missingSmokeSnippets = requiredSmokeSnippets.filter((snippet) => !smokeSource.includes(snippet));
if (missingSmokeSnippets.length > 0) {
  fail('roguelite direct API smoke script is incomplete', missingSmokeSnippets);
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewayLines = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'));
const activeGatewayRogueliteRules = activeGatewayLines.filter((entry) => entry.line.includes('/api/games/roguelite'));

const allowedGatewayRules = new Set(expectedRogueliteApiPaths.map((apiPath) => `handle ${apiPath} {`));
const missingGatewayRules = [...allowedGatewayRules].filter((line) =>
  !activeGatewayRogueliteRules.some((entry) => entry.line === line)
);
const unexpectedGatewayRules = activeGatewayRogueliteRules.filter((entry) => !allowedGatewayRules.has(entry.line));
const forbiddenGatewayRules = activeGatewayLines.filter((entry) =>
  entry.line === 'handle /api/games/* {' ||
  entry.line === 'handle /api/games/roguelite* {' ||
  entry.line === 'handle /api/games/roguelite/* {'
);
if (missingGatewayRules.length > 0 || unexpectedGatewayRules.length > 0 || forbiddenGatewayRules.length > 0) {
  fail('Gateway roguelite rules are not the reviewed exact cutover set', [
    ...missingGatewayRules.map((line) => `missing gateway rule ${line}`),
    ...unexpectedGatewayRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`),
    ...forbiddenGatewayRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} forbidden ${entry.line}`),
  ]);
}

const summary = {
  frontendRogueliteApiPaths: Object.fromEntries([...discovered.entries()]),
  goRoutes: requiredGoRouteSnippets,
  migrations: [
    'backend/migrations/0001_base.sql',
    'backend/migrations/0012_game_runtime.sql',
  ],
  smokeFiles: requiredSmokeFiles,
  gatewayRogueliteRules: activeGatewayRogueliteRules.map((entry) => entry.line),
  wildcardCutover: 'disabled',
};

console.log(JSON.stringify(summary, null, 2));
