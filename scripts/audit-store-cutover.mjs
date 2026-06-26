import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedFrontendStorePaths = [
  '/api/store',
  '/api/store/exchange',
  '/api/store/topup',
  '/api/store/withdraw',
  '/api/store/admin',
];

const coreCutoverPaths = [
  '/api/store',
  '/api/store/exchange',
  '/api/store/topup',
  '/api/store/withdraw',
  '/api/store/admin',
];

const requiredGoRouteSnippets = [
  'api.Get("/store", economyHandlers.getStore)',
  'api.Post("/store/exchange", economyHandlers.exchangeItem)',
  'api.Get("/store/topup", economyHandlers.getTopupBalance)',
  'api.Post("/store/topup", economyHandlers.topupWallet)',
  'api.Post("/store/withdraw", economyHandlers.withdrawWallet)',
  'api.Get("/store/admin", economyHandlers.getStoreAdmin)',
  'api.Post("/store/admin", economyHandlers.createStoreAdminItem)',
  'api.Put("/store/admin", economyHandlers.updateStoreAdminItem)',
  'api.Patch("/store/admin", economyHandlers.saveStoreAdminCategory)',
  'api.Delete("/store/admin", economyHandlers.deleteStoreAdminItem)',
];

const requiredHandlerSnippets = [
  'func (handlers economyHandlers) getStore',
  'func (handlers economyHandlers) exchangeItem',
  'func (handlers economyHandlers) getTopupBalance',
  'func (handlers economyHandlers) topupWallet',
  'func (handlers economyHandlers) withdrawWallet',
  'func (handlers economyHandlers) getStoreAdmin',
  'func (handlers economyHandlers) createStoreAdminItem',
  'func (handlers economyHandlers) updateStoreAdminItem',
  'func (handlers economyHandlers) saveStoreAdminCategory',
  'func (handlers economyHandlers) deleteStoreAdminItem',
  'rejectUntrustedUnsafeRequest',
  'storeExchangeRateLimit',
];

const requiredStoreResponseFields = [
  'items',
  'categories',
  'balance',
  'recentExchanges',
  'dailyLimit',
  'dailyEarned',
];

const requiredExchangeResponseFields = [
  'newBalance',
  'drawsAvailable',
  'rewardAssetKind',
];

const requiredMigrationSnippets = [
  'CREATE TABLE IF NOT EXISTS store_categories',
  'CREATE TABLE IF NOT EXISTS store_items',
  'CREATE TABLE IF NOT EXISTS store_daily_purchases',
  'CREATE TABLE IF NOT EXISTS exchange_logs',
  'CREATE TABLE IF NOT EXISTS user_assets',
];

const requiredSmokeFiles = [
  'scripts/smoke-store-go-api.mjs',
];

const requiredSmokeSnippets = [
  'STORE_SMOKE_USER_ID',
  'STORE_SMOKE_ADMIN_USER_ID',
  'docker-compose-exec-api-and-postgres',
  'checkedCorePaths',
  '/api/store/exchange',
  'verifyIdempotentExchange',
  'gatewayStoreRules',
  'verifyCleanup',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'store'),
  path.join(repoRoot, 'src', 'app', 'admin', 'store'),
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
  console.error(`store cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const storePathPattern = /['"`](\/api\/store(?:\/(?:exchange|topup|withdraw|admin))?)(?:[?#][^'"`]*)?['"`]/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(storePathPattern)) {
    const apiPath = match[1];
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedSet = new Set(expectedFrontendStorePaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedFrontendStorePaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedSet.has(apiPath));
if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend store API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected frontend path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => `unexpected frontend path ${apiPath}`),
  ]);
}

const serverSource = read('backend/internal/httpserver/server.go');
const missingGoRoutes = requiredGoRouteSnippets.filter((snippet) => !serverSource.includes(snippet));
if (missingGoRoutes.length > 0) {
  fail('Go store core/admin routes are incomplete', missingGoRoutes);
}

const handlerSource = [
  read('backend/internal/httpserver/economy_handlers.go'),
  read('backend/internal/httpserver/store_admin_handlers.go'),
  read('backend/internal/economy/service.go'),
].join('\n');
const missingHandlerSnippets = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
if (missingHandlerSnippets.length > 0) {
  fail('Go store handlers/services are missing required snippets', missingHandlerSnippets);
}

const typeSource = read('backend/internal/economy/types.go');
const goJSONTags = new Set([...typeSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]));
const missingStoreFields = requiredStoreResponseFields.filter((field) => !goJSONTags.has(field));
const missingExchangeFields = requiredExchangeResponseFields.filter((field) => !handlerSource.includes(`"${field}"`));
if (missingStoreFields.length > 0 || missingExchangeFields.length > 0) {
  fail('Go store response JSON fields are incomplete', [
    ...missingStoreFields.map((field) => `missing store home field ${field}`),
    ...missingExchangeFields.map((field) => `missing exchange field ${field}`),
  ]);
}

const migrationSource = read('backend/migrations/0002_store.sql');
const missingMigrationSnippets = requiredMigrationSnippets.filter((snippet) => !migrationSource.includes(snippet));
if (missingMigrationSnippets.length > 0) {
  fail('store migration is incomplete', missingMigrationSnippets);
}

const missingSmokeFiles = requiredSmokeFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingSmokeFiles.length > 0) {
  fail('store direct API smoke files are missing', missingSmokeFiles);
}
const smokeSource = requiredSmokeFiles.map((relativePath) => read(relativePath)).join('\n');
const missingSmokeSnippets = requiredSmokeSnippets.filter((snippet) => !smokeSource.includes(snippet));
if (missingSmokeSnippets.length > 0) {
  fail('store direct API smoke script is incomplete', missingSmokeSnippets);
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewayStoreRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/store'));

const allowedGatewayRules = new Set([
  'handle /api/store {',
  'handle /api/store/exchange {',
  'handle /api/store/topup {',
  'handle /api/store/withdraw {',
  'handle /api/store/admin {',
]);
const missingGatewayRules = [...allowedGatewayRules].filter((line) =>
  !activeGatewayStoreRules.some((entry) => entry.line === line)
);
const unexpectedGatewayRules = activeGatewayStoreRules.filter((entry) => !allowedGatewayRules.has(entry.line));
if (missingGatewayRules.length > 0 || unexpectedGatewayRules.length > 0) {
  fail('Gateway store rules are not the reviewed exact cutover set', [
    ...missingGatewayRules.map((line) => `missing gateway rule ${line}`),
    ...unexpectedGatewayRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`),
  ]);
}

const summary = {
  frontendStoreApiPaths: Object.fromEntries([...discovered.entries()]),
  coreCutoverPaths,
  goRoutes: requiredGoRouteSnippets,
  migrations: ['backend/migrations/0002_store.sql'],
  smokeFiles: requiredSmokeFiles,
  gatewayStoreRules: activeGatewayStoreRules.map((entry) => entry.line),
};

console.log(JSON.stringify(summary, null, 2));
