import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedFrontendApiPaths = [
  '/api/games/profile',
];

const requiredGoRouteSnippets = [
  'api.Get("/games/overview", gameSummaryHandlers.getOverview)',
  'api.Get("/games/profile", gameSummaryHandlers.getProfile)',
];

const requiredGoJSONFields = [
  'balance',
  'dailyStats',
  'gamesPlayed',
  'pointsEarned',
  'dailyLimit',
  'pointsLimitReached',
  'totalGamesPlayed',
  'peakScore',
  'peakGame',
  'favoriteGame',
  'mostWinsGame',
  'mostWinsCount',
  'bestStreakGame',
  'bestStreak',
  'winRate',
  'perGame',
  'totalPlays',
  'bestScore',
  'totalPointsEarned',
  'hasWinFlag',
  'wins',
  'bestWinStreak',
];

const requiredSmokeFiles = [
  'scripts/smoke-games-summary-go-api.mjs',
];

const requiredSmokeSnippets = [
  'GAMES_SUMMARY_SMOKE_USER_ID',
  'docker-compose-exec-api-and-postgres',
  'checkedUnauthenticatedPaths',
  'checkedAuthenticatedPaths',
  '/api/games/profile',
  '/api/games/overview',
  'verifyCleanup',
  'gatewayGamesSummaryRules',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'games'),
  path.join(repoRoot, 'src', 'components'),
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
  console.error(`games summary cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const gamesSummaryPathPattern = /['"`](\/api\/games\/(?:overview|profile))(?:[?#][^'"`]*)?['"`]/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(gamesSummaryPathPattern)) {
    const apiPath = match[1];
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedSet = new Set(expectedFrontendApiPaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedFrontendApiPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedSet.has(apiPath));

if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend games summary API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected frontend path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => {
      const locations = discovered.get(apiPath).join(', ');
      return `unexpected frontend path ${apiPath} in ${locations}`;
    }),
  ]);
}

const serverSource = read('backend/internal/httpserver/server.go');
const missingGoRoutes = requiredGoRouteSnippets.filter((snippet) => !serverSource.includes(snippet));
if (missingGoRoutes.length > 0) {
  fail('Go games summary routes are incomplete', missingGoRoutes);
}

const typesSource = read('backend/internal/gamesummary/types.go');
const goJSONTags = new Set(
  [...typesSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]),
);
const missingJSONFields = requiredGoJSONFields.filter((field) => !goJSONTags.has(field));
if (missingJSONFields.length > 0) {
  fail('Go games summary response JSON fields are incomplete', missingJSONFields);
}

const serviceSource = read('backend/internal/gamesummary/service.go');
const requiredServiceSnippets = [
  'ROW_NUMBER() OVER (PARTITION BY game_type ORDER BY created_at DESC, id DESC)',
  'recordFetchLimit = 50',
  'return row.Score >= 1200',
  'whackMoleWinScore',
  'toAPIKey',
];
const missingServiceSnippets = requiredServiceSnippets.filter((snippet) => !serviceSource.includes(snippet));
if (missingServiceSnippets.length > 0) {
  fail('Go games summary aggregation snippets are missing', missingServiceSnippets);
}

const missingSmokeFiles = requiredSmokeFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingSmokeFiles.length > 0) {
  fail('games summary direct API smoke files are missing', missingSmokeFiles);
}
const smokeSource = requiredSmokeFiles.map((relativePath) => read(relativePath)).join('\n');
const missingSmokeSnippets = requiredSmokeSnippets.filter((snippet) => !smokeSource.includes(snippet));
if (missingSmokeSnippets.length > 0) {
  fail('games summary direct API smoke script is incomplete', missingSmokeSnippets);
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewaySummaryLines = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/games/profile') || entry.line.includes('/api/games/overview') || entry.line.includes('/api/games/*'));

const allowedGatewaySummaryRules = new Set([
  'handle /api/games/overview {',
  'handle /api/games/profile {',
]);
const unexpectedGatewaySummaryRules = activeGatewaySummaryLines.filter((entry) => !allowedGatewaySummaryRules.has(entry.line));

if (unexpectedGatewaySummaryRules.length > 0) {
  fail(
    'Gateway contains unexpected games summary or games wildcard routing rules',
    unexpectedGatewaySummaryRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`),
  );
}

const summary = {
  frontendGamesSummaryApiPaths: expectedFrontendApiPaths,
  frontendLocations: Object.fromEntries([...discovered.entries()]),
  goRoutes: requiredGoRouteSnippets,
  goJSONFields: requiredGoJSONFields,
  smokeFiles: requiredSmokeFiles,
  gatewayGamesSummaryRules: activeGatewaySummaryLines.length === 0 ? 'none' : activeGatewaySummaryLines.map((entry) => entry.line),
};

console.log(JSON.stringify(summary, null, 2));
