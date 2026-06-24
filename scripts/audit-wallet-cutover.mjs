import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedWalletApiPaths = [
  '/api/store/topup',
  '/api/store/withdraw',
];

const requiredGoRouteSnippets = [
  'api.Get("/store/topup", economyHandlers.getTopupBalance)',
  'api.Post("/store/topup", economyHandlers.topupWallet)',
  'api.Post("/store/withdraw", economyHandlers.withdrawWallet)',
];

const requiredHandlerSnippets = [
  '"newApiQuota"',
  '"newApiUsedQuota"',
  '"newApiBalanceDollars"',
  '"newApiBalanceWholeDollars"',
  '"quotaPerDollar"',
  '"newBalance"',
  '"pointsGained"',
  '"dollars"',
  '"feePoints"',
  '"uncertain"',
  '"NEW_API_NOT_CONFIGURED"',
  '"WALLET_LOCK_UNAVAILABLE"',
];

const requiredWalletJSONFields = [
  'success',
  'message',
  'balance',
  'dollars',
  'feePoints',
  'uncertain',
  'pointsGained',
  'newApiBalanceDollars',
  'newApiBalanceWholeDollars',
  'newApiQuota',
  'newApiUsedQuota',
];

const requiredNewAPIEnvNames = [
  'NEW_API_URL',
  'NEW_API_ADMIN_ACCESS_TOKEN',
  'NEW_API_ADMIN_USER_ID',
];

const requiredWalletSmokeFiles = [
  'scripts/smoke-wallet-go-api.mjs',
  'scripts/smoke-wallet-write-missing-newapi-go-api.mjs',
];

const requiredWalletSmokeSnippets = [
  'WALLET_GO_API_COOKIE',
  'WALLET_GO_API_EXPECT_NEW_API',
  'WALLET_WRITE_SMOKE_USER_ID',
  'docker-compose-exec-api',
  'docker-compose-exec-api-and-postgres',
  'checkedUnauthenticatedPaths',
  'checkedAuthenticatedPaths',
  '/api/store/topup',
  '/api/store/withdraw',
  'NEW_API_NOT_CONFIGURED',
  'verifyNoWrites',
  'verifyCleanup',
  'gatewayWalletRules',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'store'),
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
  console.error(`wallet cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractGoFunction(source, name) {
  const marker = `func (handlers economyHandlers) ${name}(`;
  const start = source.indexOf(marker);
  if (start === -1) {
    return '';
  }
  const nextFunction = source.indexOf('\nfunc ', start + marker.length);
  if (nextFunction === -1) {
    return source.slice(start);
  }
  return source.slice(start, nextFunction);
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const walletPathPattern = /['"`](\/api\/store\/(?:topup|withdraw))(?:[?#][^'"`]*)?['"`]/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(walletPathPattern)) {
    const apiPath = match[1];
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedSet = new Set(expectedWalletApiPaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedWalletApiPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedSet.has(apiPath));

if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend wallet API dependencies changed', [
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
  fail('Go wallet routes are incomplete', missingGoRoutes);
}

const handlerSource = read('backend/internal/httpserver/economy_handlers.go');
const missingHandlerSnippets = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
if (missingHandlerSnippets.length > 0) {
  fail('Go wallet handler compatibility snippets are missing', missingHandlerSnippets);
}

const handlerFunctionRequirements = {
  getTopupBalance: [
    'handlers.requireUser',
    'storeBalanceRateLimit',
    'GetWalletQuotaBalance',
  ],
  topupWallet: [
    'rejectUntrustedUnsafeRequest',
    'handlers.requireUser',
    'storeExchangeRateLimit',
    'ExecuteTopup',
  ],
  withdrawWallet: [
    'rejectUntrustedUnsafeRequest',
    'handlers.requireUser',
    'storeExchangeRateLimit',
    'ExecuteWithdraw',
  ],
};

const missingFunctionSnippets = Object.entries(handlerFunctionRequirements).flatMap(([functionName, snippets]) => {
  const functionSource = extractGoFunction(handlerSource, functionName);
  if (functionSource === '') {
    return [`${functionName}: function missing`];
  }
  return snippets
    .filter((snippet) => !functionSource.includes(snippet))
    .map((snippet) => `${functionName}: ${snippet}`);
});
if (missingFunctionSnippets.length > 0) {
  fail('Go wallet handler protections are incomplete', missingFunctionSnippets);
}

const walletSource = read('backend/internal/economy/wallet.go');
const newAPISource = read('backend/internal/platform/newapi/client.go');
const walletTags = new Set(
  [...walletSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]),
);
const newAPITags = new Set(
  [...newAPISource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]),
);
const availableJSONFields = new Set([...walletTags, ...newAPITags, 'newBalance']);
const missingWalletJSONFields = requiredWalletJSONFields.filter((field) => !availableJSONFields.has(field));
if (missingWalletJSONFields.length > 0) {
  fail('Go wallet response JSON fields are incomplete', missingWalletJSONFields);
}

const configSource = read('backend/internal/config/config.go');
const newAPIClientSource = read('backend/internal/platform/newapi/client.go');
const missingEnvNames = requiredNewAPIEnvNames.filter(
  (envName) => !configSource.includes(envName) || !newAPIClientSource.includes(envName),
);
if (missingEnvNames.length > 0) {
  fail('new-api environment checks are incomplete', missingEnvNames);
}

const requiredMigrationFiles = [
  'backend/migrations/0004_wallet.sql',
];
const missingMigrationFiles = requiredMigrationFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingMigrationFiles.length > 0) {
  fail('required PostgreSQL migration files are missing', missingMigrationFiles);
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewayWalletRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) =>
    entry.line.includes('/api/store/topup') ||
    entry.line.includes('/api/store/withdraw') ||
    entry.line.includes('/api/store*'),
  );

if (activeGatewayWalletRules.length > 0) {
  fail(
    'Gateway already contains active wallet routing rules; review before declaring this a pre-cutover state',
    activeGatewayWalletRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`),
  );
}

const missingWalletSmokeFiles = requiredWalletSmokeFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingWalletSmokeFiles.length > 0) {
  fail('wallet direct API smoke files are missing', missingWalletSmokeFiles);
}
const walletSmokeSource = requiredWalletSmokeFiles
  .map((relativePath) => read(relativePath))
  .join('\n');
const missingWalletSmokeSnippets = requiredWalletSmokeSnippets.filter((snippet) => !walletSmokeSource.includes(snippet));
if (missingWalletSmokeSnippets.length > 0) {
  fail('wallet direct API smoke script is incomplete', missingWalletSmokeSnippets);
}

const summary = {
  frontendWalletApiPaths: expectedWalletApiPaths,
  frontendLocations: Object.fromEntries([...discovered.entries()]),
  goRoutes: requiredGoRouteSnippets,
  goWalletJSONFields: requiredWalletJSONFields,
  newAPIEnvNames: requiredNewAPIEnvNames,
  migrations: requiredMigrationFiles,
  walletSmokeFiles: requiredWalletSmokeFiles,
  gatewayWalletRules: 'none',
};

console.log(JSON.stringify(summary, null, 2));
