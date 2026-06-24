import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedFrontendRaffleApiPaths = [
  '/api/raffle',
  '/api/raffle/{id}',
  '/api/raffle/{id}/join',
  '/api/admin/raffle',
  '/api/admin/raffle/{id}',
  '/api/admin/raffle/{id}/publish',
  '/api/admin/raffle/{id}/draw',
  '/api/admin/raffle/{id}/cancel',
  '/api/admin/raffle/{id}/retry',
];

const requiredGoRouteSnippets = [
  'api.Get("/raffle", welfareHandlers.listRaffles)',
  'api.Get("/raffle/{id}", welfareHandlers.getRaffleDetail)',
  'api.Post("/raffle/{id}/join", welfareHandlers.joinRaffle)',
  'api.Get("/admin/raffle", welfareHandlers.listAdminRaffles)',
  'api.Post("/admin/raffle", welfareHandlers.createAdminRaffle)',
  'api.Get("/admin/raffle/{id}", welfareHandlers.getAdminRaffleDetail)',
  'api.Put("/admin/raffle/{id}", welfareHandlers.updateAdminRaffle)',
  'api.Delete("/admin/raffle/{id}", welfareHandlers.deleteAdminRaffle)',
  'api.Post("/admin/raffle/{id}/publish", welfareHandlers.publishAdminRaffle)',
  'api.Post("/admin/raffle/{id}/cancel", welfareHandlers.cancelAdminRaffle)',
  'api.Post("/admin/raffle/{id}/draw", welfareHandlers.drawRaffleAdmin)',
  'api.Post("/admin/raffle/{id}/retry", welfareHandlers.retryRaffleRewardsAdmin)',
];

const requiredHandlerSnippets = [
  'func (handlers welfareHandlers) listRaffles',
  'func (handlers welfareHandlers) getRaffleDetail',
  'func (handlers welfareHandlers) joinRaffle',
  'func (handlers welfareHandlers) listAdminRaffles',
  'func (handlers welfareHandlers) createAdminRaffle',
  'func (handlers welfareHandlers) getAdminRaffleDetail',
  'func (handlers welfareHandlers) updateAdminRaffle',
  'func (handlers welfareHandlers) deleteAdminRaffle',
  'func (handlers welfareHandlers) publishAdminRaffle',
  'func (handlers welfareHandlers) cancelAdminRaffle',
  'func (handlers welfareHandlers) drawRaffleAdmin',
  'func (handlers welfareHandlers) retryRaffleRewardsAdmin',
  'rejectUntrustedUnsafeRequest',
  'requireAdmin',
  'GrabRedPacket',
  'JoinRaffle',
  'ExecuteRaffleDraw',
  'DeliverRaffleRewards',
  'ProcessRaffleDeliveryQueue',
];

const requiredTypeJSONFields = [
  'raffles',
  'raffle',
  'entries',
  'userStatus',
  'entry',
  'reward',
  'shouldDraw',
  'deliveryResults',
  'id',
  'mode',
  'title',
  'description',
  'prizes',
  'status',
  'participantsCount',
  'winnersCount',
  'redPacketRemainingPoints',
  'redPacketRemainingSlots',
  'hasJoined',
  'isWinner',
];

const requiredMigrationFiles = [
  'backend/migrations/0003_welfare_lists.sql',
  'backend/migrations/0005_raffle_detail.sql',
  'backend/migrations/0006_raffle_user_wins.sql',
  'backend/migrations/0007_notifications.sql',
  'backend/migrations/0008_raffle_delivery_jobs.sql',
];

const requiredSmokeFiles = [
  'scripts/smoke-raffle-go-api.mjs',
];

const requiredSmokeSnippets = [
  'RAFFLE_SMOKE_USER_ID',
  'docker-compose-exec-api-and-postgres',
  'checkedPublicPaths',
  'checkedAdminPaths',
  '/api/raffle',
  '/api/raffle/{id}/join',
  '/api/admin/raffle',
  'verifyCleanup',
  'gatewayRaffleRules',
];

const allowedGatewayRaffleRules = [
  'handle /api/admin/raffle {',
  'handle /api/admin/raffle/* {',
  'handle /api/raffle {',
  'handle /api/raffle/* {',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'raffle'),
  path.join(repoRoot, 'src', 'app', 'admin', 'raffle'),
  path.join(repoRoot, 'src', 'app', 'project'),
  path.join(repoRoot, 'src', 'app', 'store'),
  path.join(repoRoot, 'src', 'app', 'page.tsx'),
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
  console.error(`raffle cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function normalizeRafflePath(raw) {
  return raw
    .replace(/\$\{[^}]+\}/g, '{id}')
    .replace(/\?[^'"`]+$/, '')
    .replace(/\/+$/, '');
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const rafflePathPattern = /\/api\/(?:admin\/)?raffle(?:\/(?:\$\{[^}]+\}|[a-zA-Z0-9_-]+))*\??[^'"`)]*/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(rafflePathPattern)) {
    const apiPath = normalizeRafflePath(match[0]);
    if (!apiPath.startsWith('/api/raffle') && !apiPath.startsWith('/api/admin/raffle')) {
      continue;
    }
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedSet = new Set(expectedFrontendRaffleApiPaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedFrontendRaffleApiPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedSet.has(apiPath));

if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend raffle API dependencies changed', [
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
  fail('Go raffle routes are incomplete', missingGoRoutes);
}

const handlerSource = read('backend/internal/httpserver/welfare_handlers.go');
const missingHandlerSnippets = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
if (missingHandlerSnippets.length > 0) {
  fail('Go raffle handler snippets are missing', missingHandlerSnippets);
}

const typeSource = read('backend/internal/welfare/types.go');
const handlerJSONFields = new Set([...handlerSource.matchAll(/"([a-zA-Z][a-zA-Z0-9]*)"\s*:/g)].map((match) => match[1]));
const typeJSONFields = new Set([...typeSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]));
const availableFields = new Set([...handlerJSONFields, ...typeJSONFields]);
const missingJSONFields = requiredTypeJSONFields.filter((field) => !availableFields.has(field));
if (missingJSONFields.length > 0) {
  fail('Go raffle response JSON fields are incomplete', missingJSONFields);
}

const missingMigrationFiles = requiredMigrationFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingMigrationFiles.length > 0) {
  fail('required raffle migration files are missing', missingMigrationFiles);
}

const missingSmokeFiles = requiredSmokeFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingSmokeFiles.length > 0) {
  fail('raffle direct API smoke files are missing', missingSmokeFiles);
}
const smokeSource = requiredSmokeFiles.map((relativePath) => read(relativePath)).join('\n');
const missingSmokeSnippets = requiredSmokeSnippets.filter((snippet) => !smokeSource.includes(snippet));
if (missingSmokeSnippets.length > 0) {
  fail('raffle direct API smoke script is incomplete', missingSmokeSnippets);
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewayRaffleRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) =>
    entry.line.includes('/api/raffle') ||
    entry.line.includes('/api/admin/raffle') ||
    entry.line.includes('/api/admin/*')
  );
const unexpectedGatewayRaffleRules = activeGatewayRaffleRules
  .filter((entry) => !allowedGatewayRaffleRules.includes(entry.line));
const missingGatewayRaffleRules = allowedGatewayRaffleRules
  .filter((line) => !activeGatewayRaffleRules.some((entry) => entry.line === line));
if (unexpectedGatewayRaffleRules.length > 0 || missingGatewayRaffleRules.length > 0) {
  fail('Gateway raffle rules are not the reviewed exact cutover set', [
    ...missingGatewayRaffleRules.map((line) => `missing gateway rule ${line}`),
    ...unexpectedGatewayRaffleRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`),
  ]);
}

const summary = {
  frontendRaffleApiPaths: expectedFrontendRaffleApiPaths,
  frontendLocations: Object.fromEntries([...discovered.entries()]),
  goRoutes: requiredGoRouteSnippets,
  migrations: requiredMigrationFiles,
  smokeFiles: requiredSmokeFiles,
  gatewayRaffleRules: activeGatewayRaffleRules.map((entry) => entry.line),
};

console.log(JSON.stringify(summary, null, 2));
