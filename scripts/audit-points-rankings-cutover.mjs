import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedEcoRankingPaths = [
  '/api/rankings/eco',
];

const requiredGoRouteSnippets = [
  'api.Get("/points", economyHandlers.getPoints)',
  'api.Get("/rankings/eco", ecoHandlers.getTrashLeaderboard)',
];

const requiredHandlerSnippets = [
  'func (handlers economyHandlers) getPoints',
  'GetPointsSummary',
  'func (handlers ecoHandlers) getTrashLeaderboard',
  'GetTrashLeaderboard',
  'privateRankingCacheControl',
];

const requiredPointsFields = [
  'balance',
  'logs',
  'id',
  'amount',
  'source',
  'description',
  'createdAt',
];

const requiredEcoRankingFields = [
  'period',
  'periodKey',
  'generatedAt',
  'totalParticipants',
  'leaderboard',
  'rank',
  'userId',
  'username',
  'displayName',
  'avatarUrl',
  'equippedAchievement',
  'trashCleared',
];

const requiredMigrationSnippets = [
  'CREATE TABLE IF NOT EXISTS point_accounts',
  'CREATE TABLE IF NOT EXISTS point_ledger',
  'CREATE TABLE IF NOT EXISTS eco_trash_rankings',
  'CREATE TABLE IF NOT EXISTS user_achievement_grants',
  'CREATE TABLE IF NOT EXISTS user_equipped_achievements',
  'CREATE TABLE IF NOT EXISTS user_forced_achievements',
];

const requiredSmokeFiles = [
  'scripts/smoke-points-rankings-go-api.mjs',
];

const requiredSmokeSnippets = [
  'POINTS_RANKINGS_SMOKE_USER_ID',
  'docker-compose-exec-api-and-postgres',
  'checkedPaths',
  '/api/points',
  '/api/rankings/eco',
  'verifyCleanup',
  'gatewayRules',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'rankings'),
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
  console.error(`points/rankings cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const rankingPathPattern = /['"`](\/api\/rankings\/eco)(?:[?#][^'"`]*)?['"`]/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(rankingPathPattern)) {
    const apiPath = match[1];
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedSet = new Set(expectedEcoRankingPaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedEcoRankingPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedSet.has(apiPath));
if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend eco ranking API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected frontend path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => `unexpected frontend path ${apiPath}`),
  ]);
}

const serverSource = read('backend/internal/httpserver/server.go');
const missingGoRoutes = requiredGoRouteSnippets.filter((snippet) => !serverSource.includes(snippet));
if (missingGoRoutes.length > 0) {
  fail('Go points/rankings routes are incomplete', missingGoRoutes);
}

const handlerSource = [
  read('backend/internal/httpserver/economy_handlers.go'),
  read('backend/internal/httpserver/eco_handlers.go'),
  read('backend/internal/economy/service.go'),
  read('backend/internal/eco/ranking.go'),
].join('\n');
const missingHandlerSnippets = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
if (missingHandlerSnippets.length > 0) {
  fail('Go points/rankings handlers/services are missing required snippets', missingHandlerSnippets);
}

const typeSource = [
  read('backend/internal/economy/types.go'),
  read('backend/internal/eco/ranking.go'),
].join('\n');
const goJSONTags = new Set([...typeSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]));
const missingPointsFields = requiredPointsFields.filter((field) => !goJSONTags.has(field));
const missingEcoRankingFields = requiredEcoRankingFields.filter((field) => !goJSONTags.has(field));
if (missingPointsFields.length > 0 || missingEcoRankingFields.length > 0) {
  fail('Go points/rankings response JSON fields are incomplete', [
    ...missingPointsFields.map((field) => `missing points field ${field}`),
    ...missingEcoRankingFields.map((field) => `missing eco ranking field ${field}`),
  ]);
}

const migrationSource = [
  read('backend/migrations/0001_base.sql'),
  read('backend/migrations/0010_eco_base.sql'),
  read('backend/migrations/0011_achievements.sql'),
].join('\n');
const missingMigrationSnippets = requiredMigrationSnippets.filter((snippet) => !migrationSource.includes(snippet));
if (missingMigrationSnippets.length > 0) {
  fail('points/rankings migrations are incomplete', missingMigrationSnippets);
}

const missingSmokeFiles = requiredSmokeFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingSmokeFiles.length > 0) {
  fail('points/rankings direct API smoke files are missing', missingSmokeFiles);
}
const smokeSource = requiredSmokeFiles.map((relativePath) => read(relativePath)).join('\n');
const missingSmokeSnippets = requiredSmokeSnippets.filter((snippet) => !smokeSource.includes(snippet));
if (missingSmokeSnippets.length > 0) {
  fail('points/rankings direct API smoke script is incomplete', missingSmokeSnippets);
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewayRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/points') || entry.line.includes('/api/rankings'));

const allowedGatewayRules = new Set([
  'handle /api/points {',
  'handle /api/rankings/eco {',
  'handle /api/rankings/points {',
  'handle /api/rankings/games {',
  'handle /api/rankings/checkin-streak {',
  'handle /api/rankings/history {',
  'handle /api/rankings/lottery {',
]);
const missingGatewayRules = [...allowedGatewayRules].filter((line) =>
  !activeGatewayRules.some((entry) => entry.line === line)
);
const unexpectedGatewayRules = activeGatewayRules.filter((entry) => !allowedGatewayRules.has(entry.line));
if (missingGatewayRules.length > 0 || unexpectedGatewayRules.length > 0) {
  fail('Gateway points/rankings rules are not the reviewed exact cutover set', [
    ...missingGatewayRules.map((line) => `missing gateway rule ${line}`),
    ...unexpectedGatewayRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`),
  ]);
}

const summary = {
  frontendEcoRankingApiPaths: Object.fromEntries([...discovered.entries()]),
  directPointsFrontendUsage: 'none detected in current frontend roots',
  goRoutes: requiredGoRouteSnippets,
  migrations: [
    'backend/migrations/0001_base.sql',
    'backend/migrations/0010_eco_base.sql',
    'backend/migrations/0011_achievements.sql',
  ],
  smokeFiles: requiredSmokeFiles,
  gatewayRules: activeGatewayRules.map((entry) => entry.line),
};

console.log(JSON.stringify(summary, null, 2));
