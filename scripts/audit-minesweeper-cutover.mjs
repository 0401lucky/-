import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedMinesweeperApiPaths = [
  '/api/games/minesweeper/status',
  '/api/games/minesweeper/start',
  '/api/games/minesweeper/step',
  '/api/games/minesweeper/submit',
  '/api/games/minesweeper/cancel',
];

const requiredGoRouteSnippets = [
  'minesweeperRouter.Get("/status", minesweeperHandlers.status)',
  'minesweeperRouter.Post("/start", minesweeperHandlers.start)',
  'minesweeperRouter.Post("/step", minesweeperHandlers.step)',
  'minesweeperRouter.Post("/submit", minesweeperHandlers.submit)',
  'minesweeperRouter.Post("/cancel", minesweeperHandlers.cancel)',
  'minesweeperRouter.HandleFunc("/*", notMigratedHandler("minesweeper"))',
];

const requiredHandlerSnippets = [
  'func (handlers minesweeperHandlers) status',
  'func (handlers minesweeperHandlers) start',
  'func (handlers minesweeperHandlers) step',
  'func (handlers minesweeperHandlers) submit',
  'func (handlers minesweeperHandlers) cancel',
  'decodeMinesweeperStepInput',
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
  'ResolveAction',
  'ResolveActions',
  'CalculateScore',
  'CalculatePointReward',
  'settledRecordOrFailure',
  'FOR UPDATE',
  'addGamePointsWithLimit',
  'insertRecord',
  'updateSession',
  'deleteSessionAndActive',
  'setCooldown',
];

const requiredJSONFields = [
  'sessionId',
  'difficulty',
  'startedAt',
  'expiresAt',
  'actionsCount',
  'state',
  'scorePreview',
  'pointRewardPreview',
  'rows',
  'cols',
  'mines',
  'status',
  'cells',
  'revealedSafe',
  'flagsUsed',
  'moves',
  'outcome',
  'outcomes',
  'skipped',
  'record',
  'pointsEarned',
  'won',
  'score',
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
  'difficulties',
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
  'scripts/smoke-minesweeper-go-api.mjs',
];

const requiredSmokeSnippets = [
  'MINESWEEPER_SMOKE_USER_ID',
  'docker-compose-exec-api-and-postgres',
  'checkedMinesweeperPaths',
  '/api/games/minesweeper/step',
  'firstMinePosition',
  'verifySettlement',
  'verifyCleanup',
  'gatewayMinesweeperRules',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'games', 'minesweeper'),
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
  console.error(`minesweeper cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const minesweeperPathPattern = /['"`](\/api\/games\/minesweeper\/[^'"`?]+)(?:[?#][^'"`]*)?['"`]/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(minesweeperPathPattern)) {
    const apiPath = match[1];
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedSet = new Set(expectedMinesweeperApiPaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedMinesweeperApiPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedSet.has(apiPath));
if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend minesweeper API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected frontend path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => `unexpected frontend path ${apiPath}`),
  ]);
}

const serverSource = read('backend/internal/httpserver/server.go');
const missingGoRoutes = requiredGoRouteSnippets.filter((snippet) => !serverSource.includes(snippet));
if (missingGoRoutes.length > 0) {
  fail('Go minesweeper routes are incomplete', missingGoRoutes);
}

const handlerSource = read('backend/internal/httpserver/minesweeper_handlers.go');
const missingHandlerSnippets = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
if (missingHandlerSnippets.length > 0) {
  fail('Go minesweeper handlers are missing required snippets', missingHandlerSnippets);
}

const serviceSource = [
  read('backend/internal/minesweeper/types.go'),
  read('backend/internal/minesweeper/service.go'),
  read('backend/internal/minesweeper/engine.go'),
].join('\n');
const missingServiceSnippets = requiredServiceSnippets.filter((snippet) => !serviceSource.includes(snippet));
if (missingServiceSnippets.length > 0) {
  fail('Go minesweeper service is missing required snippets', missingServiceSnippets);
}

const goJSONTags = new Set([...serviceSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]));
const missingJSONFields = requiredJSONFields.filter((field) => !goJSONTags.has(field) && !handlerSource.includes(`"${field}"`));
if (missingJSONFields.length > 0) {
  fail('Go minesweeper response JSON fields are incomplete', missingJSONFields);
}

const migrationSource = [
  read('backend/migrations/0001_base.sql'),
  read('backend/migrations/0012_game_runtime.sql'),
].join('\n');
const missingMigrationSnippets = requiredMigrationSnippets.filter((snippet) => !migrationSource.includes(snippet));
if (missingMigrationSnippets.length > 0) {
  fail('minesweeper runtime migrations are incomplete', missingMigrationSnippets);
}

const missingSmokeFiles = requiredSmokeFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingSmokeFiles.length > 0) {
  fail('minesweeper direct API smoke files are missing', missingSmokeFiles);
}
const smokeSource = requiredSmokeFiles.map((relativePath) => read(relativePath)).join('\n');
const missingSmokeSnippets = requiredSmokeSnippets.filter((snippet) => !smokeSource.includes(snippet));
if (missingSmokeSnippets.length > 0) {
  fail('minesweeper direct API smoke script is incomplete', missingSmokeSnippets);
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewayLines = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'));
const activeGatewayMinesweeperRules = activeGatewayLines.filter((entry) => entry.line.includes('/api/games/minesweeper'));

const allowedGatewayRules = new Set(expectedMinesweeperApiPaths.map((apiPath) => `handle ${apiPath} {`));
const missingGatewayRules = [...allowedGatewayRules].filter((line) =>
  !activeGatewayMinesweeperRules.some((entry) => entry.line === line)
);
const unexpectedGatewayRules = activeGatewayMinesweeperRules.filter((entry) => !allowedGatewayRules.has(entry.line));
const forbiddenGatewayRules = activeGatewayLines.filter((entry) =>
  entry.line === 'handle /api/games/* {' ||
  entry.line === 'handle /api/games/minesweeper* {' ||
  entry.line === 'handle /api/games/minesweeper/* {'
);
if (missingGatewayRules.length > 0 || unexpectedGatewayRules.length > 0 || forbiddenGatewayRules.length > 0) {
  fail('Gateway minesweeper rules are not the reviewed exact cutover set', [
    ...missingGatewayRules.map((line) => `missing gateway rule ${line}`),
    ...unexpectedGatewayRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`),
    ...forbiddenGatewayRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} forbidden ${entry.line}`),
  ]);
}

const summary = {
  frontendMinesweeperApiPaths: Object.fromEntries([...discovered.entries()]),
  goRoutes: requiredGoRouteSnippets,
  migrations: [
    'backend/migrations/0001_base.sql',
    'backend/migrations/0012_game_runtime.sql',
  ],
  smokeFiles: requiredSmokeFiles,
  gatewayMinesweeperRules: activeGatewayMinesweeperRules.map((entry) => entry.line),
  wildcardCutover: 'disabled',
};

console.log(JSON.stringify(summary, null, 2));
