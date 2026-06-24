import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedEcoApiPaths = [
  '/api/games/eco/status',
  '/api/games/eco/collect',
  '/api/games/eco/buy',
  '/api/games/eco/claim-prize',
  '/api/games/eco/sell',
  '/api/games/eco/merchant-sell',
  '/api/games/eco/black-market-sell',
  '/api/games/eco/steal',
];

const requiredGoRouteSnippets = [
  'ecoRouter.Get("/status", ecoHandlers.getStatus)',
  'ecoRouter.Post("/collect", ecoHandlers.collectTrash)',
  'ecoRouter.Post("/buy", ecoHandlers.buy)',
  'ecoRouter.Post("/claim-prize", ecoHandlers.claimPrize)',
  'ecoRouter.Post("/sell", ecoHandlers.sellPrize)',
  'ecoRouter.Post("/merchant-sell", ecoHandlers.merchantSellPrize)',
  'ecoRouter.Post("/black-market-sell", ecoHandlers.blackMarketSellPrize)',
  'ecoRouter.Post("/steal", ecoHandlers.stealPrize)',
  'ecoRouter.HandleFunc("/*", notMigratedHandler("eco"))',
];

const requiredHandlerSnippets = [
  'func (handlers ecoHandlers) getStatus',
  'func (handlers ecoHandlers) collectTrash',
  'func (handlers ecoHandlers) buy',
  'func (handlers ecoHandlers) claimPrize',
  'func (handlers ecoHandlers) sellPrize',
  'func (handlers ecoHandlers) merchantSellPrize',
  'func (handlers ecoHandlers) blackMarketSellPrize',
  'func (handlers ecoHandlers) stealPrize',
  'rejectUntrustedUnsafeRequest',
  'ecoCollectRateLimit',
  'ecoGameActionRateLimit',
  'storeExchangeRateLimit',
];

const requiredServiceSnippets = [
  'func (service *Service) GetStatus',
  'func (service *Service) CollectTrash',
  'func (service *Service) BuyUpgrade',
  'func (service *Service) BuyItem',
  'func (service *Service) ClaimPrize',
  'func (service *Service) SellPrize',
  'func (service *Service) SellPrizeToMerchant',
  'func (service *Service) SellStolenPrize',
  'func (service *Service) StealPublicPrize',
  'FOR UPDATE',
  'incrementTrashRankings',
];

const requiredStatusFields = [
  'serverNow',
  'points',
  'pending',
  'pendingTotal',
  'storageCap',
  'pointBuffer',
  'pointDivisor',
  'pointMultiplier',
  'spawnPerMin',
  'autoPerMin',
  'grabSize',
  'exp',
  'lifetimeCleared',
  'lifetimePoints',
  'todayTrashPoints',
  'todayTrashPointsDate',
  'upgrades',
  'items',
  'prizes',
  'publicBoard',
  'visiblePrizes',
  'luckyGenerationsRemaining',
  'gloveUsesRemaining',
];

const requiredMigrationSnippets = [
  'CREATE TABLE IF NOT EXISTS eco_states',
  'CREATE TABLE IF NOT EXISTS eco_user_upgrades',
  'CREATE TABLE IF NOT EXISTS eco_prize_inventory',
  'CREATE TABLE IF NOT EXISTS eco_prize_lots',
  'CREATE TABLE IF NOT EXISTS eco_visible_prizes',
  'CREATE TABLE IF NOT EXISTS eco_item_purchases',
  'CREATE TABLE IF NOT EXISTS eco_global_prize_stock',
  'CREATE TABLE IF NOT EXISTS eco_public_prizes',
  'CREATE TABLE IF NOT EXISTS eco_thefts',
  'CREATE TABLE IF NOT EXISTS eco_prize_claim_stats',
  'CREATE TABLE IF NOT EXISTS eco_trash_rankings',
];

const requiredSmokeFiles = [
  'scripts/smoke-eco-go-api.mjs',
];

const requiredSmokeSnippets = [
  'ECO_SMOKE_USER_ID',
  'docker-compose-exec-api-and-postgres',
  'checkedEcoPaths',
  '/api/games/eco/collect',
  '/api/games/eco/black-market-sell',
  'verifyWrites',
  'verifyCleanup',
  'gatewayEcoRules',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'games', 'eco'),
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

function normalizeAPIPath(raw) {
  return raw.split('?', 1)[0];
}

function fail(message, details = []) {
  console.error(`eco cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const ecoPathPattern = /['"`](\/api\/games\/eco\/[^'"`?]+)(?:[?#][^'"`]*)?['"`]/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(ecoPathPattern)) {
    const apiPath = normalizeAPIPath(match[1]);
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedSet = new Set(expectedEcoApiPaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedEcoApiPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedSet.has(apiPath));
if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend eco API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected frontend path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => `unexpected frontend path ${apiPath}`),
  ]);
}

const serverSource = read('backend/internal/httpserver/server.go');
const missingGoRoutes = requiredGoRouteSnippets.filter((snippet) => !serverSource.includes(snippet));
if (missingGoRoutes.length > 0) {
  fail('Go eco routes are incomplete', missingGoRoutes);
}

const handlerSource = read('backend/internal/httpserver/eco_handlers.go');
const missingHandlerSnippets = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
if (missingHandlerSnippets.length > 0) {
  fail('Go eco handlers are missing required snippets', missingHandlerSnippets);
}

const serviceSource = [
  read('backend/internal/eco/status.go'),
  read('backend/internal/eco/collect.go'),
  read('backend/internal/eco/upgrade.go'),
  read('backend/internal/eco/item.go'),
  read('backend/internal/eco/prize.go'),
].join('\n');
const missingServiceSnippets = requiredServiceSnippets.filter((snippet) => !serviceSource.includes(snippet));
if (missingServiceSnippets.length > 0) {
  fail('Go eco services are missing required snippets', missingServiceSnippets);
}

const goJSONTags = new Set([...serviceSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]));
const missingStatusFields = requiredStatusFields.filter((field) => !goJSONTags.has(field));
if (missingStatusFields.length > 0) {
  fail('Go eco status response JSON fields are incomplete', missingStatusFields);
}

const migrationSource = read('backend/migrations/0010_eco_base.sql');
const missingMigrationSnippets = requiredMigrationSnippets.filter((snippet) => !migrationSource.includes(snippet));
if (missingMigrationSnippets.length > 0) {
  fail('eco migration is incomplete', missingMigrationSnippets);
}

const missingSmokeFiles = requiredSmokeFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingSmokeFiles.length > 0) {
  fail('eco direct API smoke files are missing', missingSmokeFiles);
}
const smokeSource = requiredSmokeFiles.map((relativePath) => read(relativePath)).join('\n');
const missingSmokeSnippets = requiredSmokeSnippets.filter((snippet) => !smokeSource.includes(snippet));
if (missingSmokeSnippets.length > 0) {
  fail('eco direct API smoke script is incomplete', missingSmokeSnippets);
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewayEcoRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/games/eco'));

const allowedGatewayRules = new Set(expectedEcoApiPaths.map((apiPath) => `handle ${apiPath} {`));
const missingGatewayRules = [...allowedGatewayRules].filter((line) =>
  !activeGatewayEcoRules.some((entry) => entry.line === line)
);
const unexpectedGatewayRules = activeGatewayEcoRules.filter((entry) => !allowedGatewayRules.has(entry.line));
if (missingGatewayRules.length > 0 || unexpectedGatewayRules.length > 0) {
  fail('Gateway eco rules are not the reviewed exact cutover set', [
    ...missingGatewayRules.map((line) => `missing gateway rule ${line}`),
    ...unexpectedGatewayRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`),
  ]);
}

const summary = {
  frontendEcoApiPaths: Object.fromEntries([...discovered.entries()]),
  goRoutes: requiredGoRouteSnippets,
  migrations: ['backend/migrations/0010_eco_base.sql'],
  smokeFiles: requiredSmokeFiles,
  gatewayEcoRules: activeGatewayEcoRules.map((entry) => entry.line),
  wildcardCutover: 'disabled',
};

console.log(JSON.stringify(summary, null, 2));
