import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedMemoryApiPaths = [
  '/api/games/memory/status',
  '/api/games/memory/start',
  '/api/games/memory/flip',
  '/api/games/memory/submit',
  '/api/games/memory/cancel',
];

const requiredGoRouteSnippets = [
  'memoryRouter.Get("/status", memoryHandlers.status)',
  'memoryRouter.Post("/start", memoryHandlers.start)',
  'memoryRouter.Post("/flip", memoryHandlers.flip)',
  'memoryRouter.Post("/submit", memoryHandlers.submit)',
  'memoryRouter.Post("/cancel", memoryHandlers.cancel)',
  'memoryRouter.HandleFunc("/*", notMigratedHandler("memory"))',
];

const requiredHandlerSnippets = [
  'func (handlers memoryHandlers) status',
  'func (handlers memoryHandlers) start',
  'func (handlers memoryHandlers) flip',
  'func (handlers memoryHandlers) submit',
  'func (handlers memoryHandlers) cancel',
  'rejectUntrustedUnsafeRequest',
  'gameStartRateLimit',
  'gameActionRateLimit',
  'gameSubmitRateLimit',
];

const requiredServiceSnippets = [
  'func (service *Service) Status',
  'func (service *Service) Start',
  'func (service *Service) Flip',
  'func (service *Service) Submit',
  'func (service *Service) Cancel',
  'BuildSessionView',
  'hiddenCardSentinel',
  'FOR UPDATE',
  'addGamePointsWithLimit',
  'insertRecord',
  'deleteSessionAndActive',
  'setCooldown',
];

const requiredJSONFields = [
  'sessionId',
  'difficulty',
  'cardLayout',
  'matchedCards',
  'firstFlippedCard',
  'moveCount',
  'startedAt',
  'expiresAt',
  'config',
  'balance',
  'dailyStats',
  'inCooldown',
  'cooldownRemaining',
  'dailyLimit',
  'pointsLimitReached',
  'activeSession',
  'cardIndex',
  'iconId',
  'matched',
  'completed',
  'matchedCount',
  'move',
  'record',
  'pointsEarned',
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
  'scripts/smoke-memory-go-api.mjs',
];

const requiredSmokeSnippets = [
  'MEMORY_SMOKE_USER_ID',
  'docker-compose-exec-api-and-postgres',
  'checkedMemoryPaths',
  '/api/games/memory/submit',
  'verifySettlement',
  'verifyCleanup',
  'gatewayMemoryRules',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'games', 'memory'),
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
  console.error(`memory cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const memoryPathPattern = /['"`](\/api\/games\/memory\/[^'"`?]+)(?:[?#][^'"`]*)?['"`]/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(memoryPathPattern)) {
    const apiPath = match[1];
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedSet = new Set(expectedMemoryApiPaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedMemoryApiPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedSet.has(apiPath));
if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend memory API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected frontend path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => `unexpected frontend path ${apiPath}`),
  ]);
}

const serverSource = read('backend/internal/httpserver/server.go');
const missingGoRoutes = requiredGoRouteSnippets.filter((snippet) => !serverSource.includes(snippet));
if (missingGoRoutes.length > 0) {
  fail('Go memory routes are incomplete', missingGoRoutes);
}

const handlerSource = read('backend/internal/httpserver/memory_handlers.go');
const missingHandlerSnippets = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
if (missingHandlerSnippets.length > 0) {
  fail('Go memory handlers are missing required snippets', missingHandlerSnippets);
}

const serviceSource = [
  read('backend/internal/memory/types.go'),
  read('backend/internal/memory/service.go'),
].join('\n');
const missingServiceSnippets = requiredServiceSnippets.filter((snippet) => !serviceSource.includes(snippet));
if (missingServiceSnippets.length > 0) {
  fail('Go memory service is missing required snippets', missingServiceSnippets);
}

const goJSONTags = new Set([...serviceSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]));
const missingJSONFields = requiredJSONFields.filter((field) => !goJSONTags.has(field) && !handlerSource.includes(`"${field}"`));
if (missingJSONFields.length > 0) {
  fail('Go memory response JSON fields are incomplete', missingJSONFields);
}

const migrationSource = [
  read('backend/migrations/0001_base.sql'),
  read('backend/migrations/0012_game_runtime.sql'),
].join('\n');
const missingMigrationSnippets = requiredMigrationSnippets.filter((snippet) => !migrationSource.includes(snippet));
if (missingMigrationSnippets.length > 0) {
  fail('memory runtime migrations are incomplete', missingMigrationSnippets);
}

const missingSmokeFiles = requiredSmokeFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingSmokeFiles.length > 0) {
  fail('memory direct API smoke files are missing', missingSmokeFiles);
}
const smokeSource = requiredSmokeFiles.map((relativePath) => read(relativePath)).join('\n');
const missingSmokeSnippets = requiredSmokeSnippets.filter((snippet) => !smokeSource.includes(snippet));
if (missingSmokeSnippets.length > 0) {
  fail('memory direct API smoke script is incomplete', missingSmokeSnippets);
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewayMemoryRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/games/memory'));

const allowedGatewayRules = new Set(expectedMemoryApiPaths.map((apiPath) => `handle ${apiPath} {`));
const missingGatewayRules = [...allowedGatewayRules].filter((line) =>
  !activeGatewayMemoryRules.some((entry) => entry.line === line)
);
const unexpectedGatewayRules = activeGatewayMemoryRules.filter((entry) => !allowedGatewayRules.has(entry.line));
if (missingGatewayRules.length > 0 || unexpectedGatewayRules.length > 0) {
  fail('Gateway memory rules are not the reviewed exact cutover set', [
    ...missingGatewayRules.map((line) => `missing gateway rule ${line}`),
    ...unexpectedGatewayRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`),
  ]);
}

const summary = {
  frontendMemoryApiPaths: Object.fromEntries([...discovered.entries()]),
  goRoutes: requiredGoRouteSnippets,
  migrations: [
    'backend/migrations/0001_base.sql',
    'backend/migrations/0012_game_runtime.sql',
  ],
  smokeFiles: requiredSmokeFiles,
  gatewayMemoryRules: activeGatewayMemoryRules.map((entry) => entry.line),
  wildcardCutover: 'disabled',
};

console.log(JSON.stringify(summary, null, 2));
