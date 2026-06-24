import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedAdminCardApiPaths = [
  '/api/admin/cards/users',
  '/api/admin/cards/user',
  '/api/admin/cards/reset',
  '/api/admin/cards/albums',
  '/api/admin/cards/rules',
];

const requiredNextRouteFiles = {
  '/api/admin/cards/users': 'src/app/api/admin/cards/users/route.ts',
  '/api/admin/cards/user': 'src/app/api/admin/cards/user/[userId]/route.ts',
  '/api/admin/cards/reset': 'src/app/api/admin/cards/reset/route.ts',
  '/api/admin/cards/albums': 'src/app/api/admin/cards/albums/route.ts',
  '/api/admin/cards/rules': 'src/app/api/admin/cards/rules/route.ts',
};

const routeRequirements = {
  '/api/admin/cards/users': [
    'withAdmin',
    'getAllUsers',
    'getUserCardData',
    'pagination',
    'drawsAvailable',
  ],
  '/api/admin/cards/user': [
    'withAdmin',
    'context: { params: Promise<{ userId: string }> }',
    'getUserCardData',
  ],
  '/api/admin/cards/reset': [
    'withAdmin',
    'deleteUserCardData',
    '用户卡牌进度重置成功',
  ],
  '/api/admin/cards/albums': [
    'withAdmin',
    "const ALBUM_REWARDS_KEY = 'cards:album_rewards'",
    'getAllTierRewards',
    'setTierReward',
  ],
  '/api/admin/cards/rules': [
    'withAdmin',
    'getCardRulesConfig',
    'updateCardRulesConfig',
    '卡牌规则已保存',
  ],
};

const requiredLegacyDataSnippets = [
  "const CARD_RULES_KEY = 'cards:rules:config'",
  "const ALBUM_REWARDS_KEY = 'cards:album_rewards'",
  "const TIER_REWARDS_KEY = 'cards:tier_rewards'",
  'getAllUsers',
  'getUserCardData',
  'deleteUserCardData',
  'updateCardRulesConfig',
];

const requiredMigrationFiles = [
  'backend/migrations/0017_card_admin_rewards.sql',
  'backend/internal/migration/d1/cards_importer.go',
  'backend/internal/migration/d1/cards_importer_test.go',
  'backend/internal/migration/d1/cards_importer_integration_test.go',
  'backend/internal/migration/d1/testdata/cards.sql',
  'backend/cmd/migrate-d1/main.go',
];

const requiredMigrationSnippets = [
  'CREATE TABLE IF NOT EXISTS card_album_rewards',
  'CREATE TABLE IF NOT EXISTS card_tier_rewards',
  'reward_points BIGINT NOT NULL',
  "reward_type IN ('common', 'rare', 'epic', 'legendary', 'legendary_rare', 'full_set')",
  'DROP TABLE IF EXISTS card_tier_rewards',
  'DROP TABLE IF EXISTS card_album_rewards',
  'cardAlbumRewardsKey = "cards:album_rewards"',
  'cardTierRewardsKey  = "cards:tier_rewards"',
  'type CardAlbumRewardImportRecord struct',
  'type CardTierRewardImportRecord struct',
  'parseCardAlbumRewards',
  'parseCardTierRewards',
  'AlbumRewardsUpserted',
  'TierRewardsUpserted',
  'card album rewards upserted',
  'card tier rewards upserted',
  'TestPlanCardsImportMergesNativeAndLegacyCardStates',
  'TestApplyCardsImportWritesCardStateAndRules',
];

const requiredGoAdminReadOnlyFiles = [
  'backend/internal/cards/admin.go',
  'backend/internal/cards/admin_test.go',
  'backend/internal/cards/admin_integration_test.go',
];

const requiredGoAdminReadOnlySnippets = [
  'type AdminService struct',
  'func NewAdminService',
  'func (service *AdminService) ListUsers',
  'func (service *AdminService) GetUserDetail',
  'func (service *AdminService) GetRules',
  'func (service *AdminService) GetRewardConfig',
  'func (service *AdminService) ResetUserProgress',
  'func (service *AdminService) UpdateRules',
  'func (service *AdminService) UpdateReward',
  'card_album_rewards',
  'card_tier_rewards',
  'card_reward_claims',
  'draws_available',
  'pity_legendary_rare',
  'ErrInvalidAdminCardInput',
  'TestAdminServiceReturnsUnavailableWithoutDatabase',
  'TestBuildAdminRewardConfigUsesDefaultsAndOverrides',
  'TestAdminServiceListsUsersDetailsAndRewardConfig',
  'TestAdminServiceWritesRulesRewardsAndReset',
];

const requiredGoAdminReadOnlyHandlerFiles = [
  'backend/internal/httpserver/admin_card_handlers.go',
  'backend/internal/httpserver/admin_card_handlers_test.go',
  'backend/internal/httpserver/admin_card_handlers_integration_test.go',
];

const requiredGoAdminReadOnlyHandlerSnippets = [
  'type adminCardHandlers struct',
  'func newAdminCardHandlers',
  'func (handlers adminCardHandlers) users',
  'func (handlers adminCardHandlers) userDetail',
  'func (handlers adminCardHandlers) albums',
  'func (handlers adminCardHandlers) updateReward',
  'func (handlers adminCardHandlers) rules',
  'func (handlers adminCardHandlers) updateRules',
  'func (handlers adminCardHandlers) reset',
  'adminCardUsersResponse',
  'adminCardDetailResponse',
  'adminAlbumRewardsResponse',
  'adminTierRewardsResponse',
  'TestAdminCardReadHandlersRequireAdmin',
  'TestAdminCardReadHandlersReturnUnavailableWithoutDatabase',
  'TestAdminCardWriteHandlersValidatePayloadAndOrigin',
  'TestAdminCardReadHandlersReturnLegacyShapes',
];

const expectedGoAdminCardRoutes = [
  'api.Get("/admin/cards/users", adminCardHandlers.users)',
  'api.Get("/admin/cards/user/{userId}", adminCardHandlers.userDetail)',
  'api.Post("/admin/cards/reset", adminCardHandlers.reset)',
  'api.Get("/admin/cards/albums", adminCardHandlers.albums)',
  'api.Post("/admin/cards/albums", adminCardHandlers.updateReward)',
  'api.Get("/admin/cards/rules", adminCardHandlers.rules)',
  'api.Patch("/admin/cards/rules", adminCardHandlers.updateRules)',
];

const requiredGoAdminCardSmokeFiles = [
  'scripts/smoke-admin-cards-go-api.mjs',
  'scripts/smoke-admin-cards-write-go-api.mjs',
  'scripts/proxy-admin-cards-go-api.mjs',
];

const requiredGoAdminCardSmokeSnippets = [
  'ADMIN_CARDS_GO_API_COOKIE',
  'ADMIN_CARDS_GO_API_NON_ADMIN_COOKIE',
  'ADMIN_CARDS_GO_API_PROXY_PORT',
  'ADMIN_CARDS_WRITE_SMOKE_USER_ID',
  'assertGatewayCardRulesDisabled',
  '/api/admin/cards/users',
  '/api/admin/cards/user/1',
  '/api/admin/cards/reset',
  '/api/admin/cards/albums',
  '/api/admin/cards/rules',
  'backupAdminCardConfig',
  'verifyCleanup',
  'checkedWritePaths',
  'checkedUnauthenticatedReadPaths',
  'checkedUnauthenticatedWritePaths',
  'checkedNonAdminPaths',
  '(printf %s',
  'sleep 1',
  'gatewayCardRules',
];

const adminPageRoot = path.join(repoRoot, 'src', 'app', 'admin', 'cards');
const adminPathPattern = /['"`](\/api\/admin\/cards(?:\/[^'"`?#{}$]+)?)(?:[?#][^'"`]*)?['"`]/g;

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
  console.error(`admin cards cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function canonicalAdminPath(apiPath) {
  if (apiPath.startsWith('/api/admin/cards/user/')) {
    return '/api/admin/cards/user';
  }
  return apiPath;
}

const adminFiles = walkFiles(adminPageRoot);
const discovered = new Map();
for (const file of adminFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(adminPathPattern)) {
    const apiPath = canonicalAdminPath(match[1]);
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
  if (source.includes('/api/admin/cards/user/${')) {
    const apiPath = '/api/admin/cards/user';
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedSet = new Set(expectedAdminCardApiPaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedAdminCardApiPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedSet.has(apiPath));
if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('admin card API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected admin card path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => {
      const locations = discovered.get(apiPath).join(', ');
      return `unexpected admin card path ${apiPath} in ${locations}`;
    }),
  ]);
}

const missingRouteFiles = expectedAdminCardApiPaths
  .map((apiPath) => [apiPath, requiredNextRouteFiles[apiPath]])
  .filter(([, relativePath]) => !existsSync(path.join(repoRoot, relativePath)))
  .map(([apiPath, relativePath]) => `${apiPath} -> ${relativePath}`);
if (missingRouteFiles.length > 0) {
  fail('Next admin card API route files are incomplete', missingRouteFiles);
}

const missingRouteSnippets = Object.entries(routeRequirements).flatMap(([apiPath, snippets]) => {
  const source = read(requiredNextRouteFiles[apiPath]);
  return snippets
    .filter((snippet) => !source.includes(snippet))
    .map((snippet) => `${apiPath}: ${snippet}`);
});
if (missingRouteSnippets.length > 0) {
  fail('Next admin card API route behavior changed', missingRouteSnippets);
}

const legacySource = [
  read('src/lib/cards/draw.ts'),
  read('src/lib/cards/rules.ts'),
  read('src/lib/cards/albumRewards.ts'),
  read('src/lib/kv.ts'),
].join('\n');
const missingLegacySnippets = requiredLegacyDataSnippets.filter((snippet) => !legacySource.includes(snippet));
if (missingLegacySnippets.length > 0) {
  fail('legacy admin card data dependencies are missing', missingLegacySnippets);
}

const missingMigrationFiles = requiredMigrationFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingMigrationFiles.length > 0) {
  fail('required PostgreSQL admin card migration files are missing', missingMigrationFiles);
}
const migrationSource = requiredMigrationFiles.map((relativePath) => read(relativePath)).join('\n');
const missingMigrationSnippets = requiredMigrationSnippets.filter((snippet) => !migrationSource.includes(snippet));
if (missingMigrationSnippets.length > 0) {
  fail('PostgreSQL admin card reward migration is incomplete', missingMigrationSnippets);
}

const missingGoAdminReadOnlyFiles = requiredGoAdminReadOnlyFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingGoAdminReadOnlyFiles.length > 0) {
  fail('Go admin card read-only service files are incomplete', missingGoAdminReadOnlyFiles);
}
const goAdminReadOnlySource = requiredGoAdminReadOnlyFiles.map((relativePath) => read(relativePath)).join('\n');
const missingGoAdminReadOnlySnippets = requiredGoAdminReadOnlySnippets.filter((snippet) => !goAdminReadOnlySource.includes(snippet));
if (missingGoAdminReadOnlySnippets.length > 0) {
  fail('Go admin card read-only service is incomplete', missingGoAdminReadOnlySnippets);
}

const missingGoAdminReadOnlyHandlerFiles = requiredGoAdminReadOnlyHandlerFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingGoAdminReadOnlyHandlerFiles.length > 0) {
  fail('Go admin card read-only handler files are incomplete', missingGoAdminReadOnlyHandlerFiles);
}
const goAdminReadOnlyHandlerSource = requiredGoAdminReadOnlyHandlerFiles.map((relativePath) => read(relativePath)).join('\n');
const missingGoAdminReadOnlyHandlerSnippets = requiredGoAdminReadOnlyHandlerSnippets.filter((snippet) => !goAdminReadOnlyHandlerSource.includes(snippet));
if (missingGoAdminReadOnlyHandlerSnippets.length > 0) {
  fail('Go admin card read-only handler is incomplete', missingGoAdminReadOnlyHandlerSnippets);
}

const missingGoAdminCardSmokeFiles = requiredGoAdminCardSmokeFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingGoAdminCardSmokeFiles.length > 0) {
  fail('Go admin card smoke files are incomplete', missingGoAdminCardSmokeFiles);
}
const goAdminCardSmokeSource = requiredGoAdminCardSmokeFiles.map((relativePath) => read(relativePath)).join('\n');
const missingGoAdminCardSmokeSnippets = requiredGoAdminCardSmokeSnippets.filter((snippet) => !goAdminCardSmokeSource.includes(snippet));
if (missingGoAdminCardSmokeSnippets.length > 0) {
  fail('Go admin card smoke script is incomplete', missingGoAdminCardSmokeSnippets);
}

const serverSource = existsSync(path.join(repoRoot, 'backend/internal/httpserver/server.go'))
  ? read('backend/internal/httpserver/server.go')
  : '';
const activeGoAdminCardRoutes = serverSource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line.includes('"/admin/cards'));
const activeGoAdminCardRouteLines = activeGoAdminCardRoutes.map((entry) => entry.line);
const missingGoAdminCardRoutes = expectedGoAdminCardRoutes.filter((route) => !activeGoAdminCardRouteLines.includes(route));
const unexpectedGoAdminCardRoutes = activeGoAdminCardRouteLines.filter((route) => !expectedGoAdminCardRoutes.includes(route));
if (missingGoAdminCardRoutes.length > 0 || unexpectedGoAdminCardRoutes.length > 0) {
  fail(
    'Go admin card routes must stay exact and reviewed',
    [
      ...missingGoAdminCardRoutes.map((route) => `missing ${route}`),
      ...unexpectedGoAdminCardRoutes.map((route) => {
        const entry = activeGoAdminCardRoutes.find((candidate) => candidate.line === route);
        return `unexpected backend/internal/httpserver/server.go:${entry?.lineNumber ?? '?'} ${route}`;
      }),
    ],
  );
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewayAdminCardRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/admin/cards') || entry.line.includes('/api/cards'));
if (activeGatewayAdminCardRules.length > 0) {
  fail(
    'Gateway already contains active card/admin-card routing rules; admin cards must stay on Next until Go implementation and import are complete',
    activeGatewayAdminCardRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`),
  );
}

const summary = {
  adminCardApiPaths: expectedAdminCardApiPaths,
  adminFrontendLocations: Object.fromEntries([...discovered.entries()]),
  nextRouteFiles: requiredNextRouteFiles,
  legacyKeys: [
    'cards:user:{userId}',
    'cards:rules:config',
    'cards:album_rewards',
    'cards:tier_rewards',
  ],
  migrations: requiredMigrationFiles,
  goAdminReadOnlyService: requiredGoAdminReadOnlyFiles,
  goAdminReadOnlyHandlers: requiredGoAdminReadOnlyHandlerFiles,
  goAdminCardSmoke: requiredGoAdminCardSmokeFiles,
  goAdminCardRoutes: expectedGoAdminCardRoutes,
  gatewayCardRules: 'none',
};

console.log(JSON.stringify(summary, null, 2));
