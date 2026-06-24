import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedFrontendCardApiPaths = [
  '/api/cards/inventory',
  '/api/cards/rules',
  '/api/cards/draw',
  '/api/cards/claim-reward',
  '/api/cards/exchange',
];

const expectedNextCardRoutePaths = [
  '/api/cards/inventory',
  '/api/cards/rules',
  '/api/cards/draw',
  '/api/cards/purchase',
  '/api/cards/claim-reward',
  '/api/cards/exchange',
];

const requiredNextRouteFiles = {
  '/api/cards/inventory': 'src/app/api/cards/inventory/route.ts',
  '/api/cards/rules': 'src/app/api/cards/rules/route.ts',
  '/api/cards/draw': 'src/app/api/cards/draw/route.ts',
  '/api/cards/purchase': 'src/app/api/cards/purchase/route.ts',
  '/api/cards/claim-reward': 'src/app/api/cards/claim-reward/route.ts',
  '/api/cards/exchange': 'src/app/api/cards/exchange/route.ts',
};

const unsafeRouteRequirements = {
  '/api/cards/draw': [
    'enforceTrustedApiRequest',
    'checkRateLimit',
    'drawCards',
  ],
  '/api/cards/purchase': [
    'enforceTrustedApiRequest',
    'checkRateLimit',
    'deductPoints',
    'addCardDraws',
    'addPoints',
  ],
  '/api/cards/claim-reward': [
    'enforceTrustedApiRequest',
    'checkRateLimit',
    'claimCollectionReward',
  ],
  '/api/cards/exchange': [
    'enforceTrustedApiRequest',
    'checkRateLimit',
    'exchangeFragmentsForCard',
  ],
};

const requiredCardDataSnippets = [
  'cards:user:${userId}',
  "const CARD_RULES_KEY = 'cards:rules:config'",
  'inventory',
  'fragments',
  'pityCounter',
  'pityRare',
  'pityEpic',
  'pityLegendary',
  'pityLegendaryRare',
  'drawsAvailable',
  'collectionRewards',
  'recentDraws',
];

const requiredMigrationFiles = [
  'backend/migrations/0016_cards.sql',
  'backend/internal/migration/d1/cards_importer.go',
  'backend/internal/migration/d1/cards_importer_test.go',
  'backend/internal/migration/d1/cards_importer_integration_test.go',
  'backend/internal/migration/d1/testdata/cards.sql',
];

const requiredMigrationSnippets = [
  'CREATE TABLE IF NOT EXISTS card_user_states',
  'CREATE TABLE IF NOT EXISTS card_rules',
  'CREATE TABLE IF NOT EXISTS card_draw_logs',
  'CREATE TABLE IF NOT EXISTS card_reward_claims',
  'PlanCardsImport',
  'ApplyCardsImport',
  'cards 导入结果',
  'card_user_states',
  'card_rules',
  'draws_available',
  'collection_rewards',
  'pity_legendary_rare',
];

const requiredStoreFiles = [
  'backend/internal/cards/types.go',
  'backend/internal/cards/catalog.go',
  'backend/internal/cards/store.go',
  'backend/internal/cards/algorithm.go',
  'backend/internal/cards/service.go',
  'backend/internal/economy/store.go',
  'backend/internal/httpserver/card_handlers.go',
  'backend/internal/cards/store_test.go',
  'backend/internal/cards/catalog_test.go',
  'backend/internal/cards/algorithm_test.go',
  'backend/internal/cards/store_integration_test.go',
  'backend/internal/economy/service_integration_test.go',
  'backend/internal/httpserver/card_handlers_test.go',
  'backend/internal/httpserver/card_handlers_integration_test.go',
  'scripts/smoke-cards-go-api.mjs',
  'scripts/smoke-cards-write-go-api.mjs',
];

const requiredStoreSnippets = [
  'type UserState struct',
  'type Rules struct',
  'func DefaultUserState',
  'func DefaultRules',
  'func AllCards',
  'func CardsByAlbum',
  'func AlbumExists',
  'func RewardPoints',
  'func (store *Store) GetUserState',
  'func (store *Store) SaveUserState',
  'func (store *Store) GetRules',
  'func ApplyDraws',
  'func ApplyFragmentExchange',
  'func ApplyRewardClaim',
  'func RewardKey',
  'func GetGuaranteedRarity',
  'func NewService',
  'func (service *Service) ExecuteDraws',
  'func (service *Service) ExecuteFragmentExchange',
  'func (service *Service) ExecuteRewardClaim',
  'incrementCardUserStateDrawsReturning',
  'draws_available = card_user_states.draws_available',
  'func newCardHandlers',
  'func (handlers cardHandlers) inventory',
  'func (handlers cardHandlers) rules',
  'func (handlers cardHandlers) draw',
  'func (handlers cardHandlers) exchange',
  'func (handlers cardHandlers) claimReward',
  'cardsExchangeRateLimit',
  'cardsClaimRewardRateLimit',
  'parseCardRewardType',
  'normalizeCardDrawCount',
  'drawResultsResponse',
  'cardStateResponse',
  'cardRulesResponse',
  'animal-s1-legendary_rare-熊猫',
  'tarot-common-隐士',
  'ErrInsufficientDraws',
  'RecentDrawsLimit',
  'resetPityCountersAfterDraw',
  'FOR UPDATE',
  'card_draw_logs',
  'card_reward_claims',
  'point_ledger',
  'card_user_states',
  'card_rules',
  'TestDefaultRulesMatchLegacyCardRules',
  'TestAllCardsMatchesLegacyCatalogCounts',
  'TestAllCardsMatchesLegacyCardShape',
  'TestApplyDrawsTriggersLegendaryRarePityAndResetsAllCounters',
  'TestApplyDrawsConvertsDuplicateToFragmentsAndKeepsRecentLimit',
  'TestApplyFragmentExchangeUpdatesInventoryAndFragments',
  'TestApplyFragmentExchangeRejectsInvalidOwnedAndInsufficient',
  'TestApplyRewardClaimUpdatesCollectionRewards',
  'TestApplyRewardClaimRejectsDuplicateMissingAndInvalidConfig',
  'TestServiceExecuteDrawsPersistsStateAndLogs',
  'TestServiceExecuteDrawsCreatesMissingStateAndRejectsInsufficientDraws',
  'TestServiceExecuteFragmentExchangePersistsState',
  'TestServiceExecuteFragmentExchangeRejectsInsufficientWithoutWriting',
  'TestServiceExecuteRewardClaimGrantsPointsAndPreventsDuplicate',
  'TestExchangeItemDuplicateIdempotencyKey',
  'expected card state draws to include default draw plus one purchase',
  'TestCardInventoryRequiresLogin',
  'TestCardDrawRequiresTrustedOrigin',
  'TestCardDrawReturnsUnavailableWithoutDatabase',
  'TestCardExchangeRequiresLogin',
  'TestCardExchangeRequiresTrustedOrigin',
  'TestCardExchangeRejectsMissingCardID',
  'TestCardExchangeReturnsUnavailableWithoutDatabase',
  'TestCardClaimRewardRequiresLogin',
  'TestCardClaimRewardRequiresTrustedOrigin',
  'TestCardClaimRewardRejectsInvalidPayload',
  'TestCardClaimRewardReturnsUnavailableWithoutDatabase',
  'TestCardInventoryHTTPReturnsMigratedState',
  'TestCardRulesHTTPReturnsImportedRules',
  'TestCardDrawHTTPExecutesSingleDraw',
  'TestCardDrawHTTPRejectsInsufficientDraws',
  'TestCardExchangeHTTPPersistsState',
  'TestCardExchangeHTTPRejectsInsufficientFragments',
  'TestCardClaimRewardHTTPGrantsPoints',
  'TestCardClaimRewardHTTPRejectsIncompleteAlbum',
  'assertGatewayCardRulesDisabled',
  'CARDS_GO_API_COOKIE',
  'CARDS_WRITE_SMOKE_USER_ID',
  'docker-compose-exec-api-and-postgres',
  'checkedAuthenticatedPaths',
  'verifyCleanup',
  '/api/cards/inventory',
  '/api/cards/rules',
  '/api/cards/draw',
  '/api/cards/exchange',
  '/api/cards/claim-reward',
  'TestStoreReadsAndWritesCardTables',
];

const allowedGoCardRoutes = [
  'api.Get("/cards/inventory", cardHandlers.inventory)',
  'api.Get("/cards/rules", cardHandlers.rules)',
  'api.Post("/cards/draw", cardHandlers.draw)',
  'api.Post("/cards/exchange", cardHandlers.exchange)',
  'api.Post("/cards/claim-reward", cardHandlers.claimReward)',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'cards'),
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
  console.error(`cards cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const cardPathPattern = /['"`](\/api\/cards(?:\/[^'"`?#]+)?)(?:[?#][^'"`]*)?['"`]/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(cardPathPattern)) {
    const apiPath = match[1];
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedFrontendSet = new Set(expectedFrontendCardApiPaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedFrontendCardApiPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedFrontendSet.has(apiPath));

if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend card API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected frontend path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => {
      const locations = discovered.get(apiPath).join(', ');
      return `unexpected frontend path ${apiPath} in ${locations}`;
    }),
  ]);
}

const missingRouteFiles = expectedNextCardRoutePaths
  .map((apiPath) => [apiPath, requiredNextRouteFiles[apiPath]])
  .filter(([, relativePath]) => !existsSync(path.join(repoRoot, relativePath)))
  .map(([apiPath, relativePath]) => `${apiPath} -> ${relativePath}`);
if (missingRouteFiles.length > 0) {
  fail('Next card API route files are incomplete', missingRouteFiles);
}

const missingUnsafeSnippets = Object.entries(unsafeRouteRequirements).flatMap(([apiPath, snippets]) => {
  const source = read(requiredNextRouteFiles[apiPath]);
  return snippets
    .filter((snippet) => !source.includes(snippet))
    .map((snippet) => `${apiPath}: ${snippet}`);
});
if (missingUnsafeSnippets.length > 0) {
  fail('Next card write route protections are incomplete', missingUnsafeSnippets);
}

const cardDataSource = [
  read('src/lib/cards/draw.ts'),
  read('src/lib/cards/rules.ts'),
].join('\n');
const missingCardDataSnippets = requiredCardDataSnippets.filter((snippet) => !cardDataSource.includes(snippet));
if (missingCardDataSnippets.length > 0) {
  fail('legacy card data shape snippets are missing', missingCardDataSnippets);
}

const missingMigrationFiles = requiredMigrationFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingMigrationFiles.length > 0) {
  fail('required PostgreSQL card migration files are missing', missingMigrationFiles);
}
const migrationSource = requiredMigrationFiles
  .map((relativePath) => read(relativePath))
  .join('\n') + '\n' + read('backend/cmd/migrate-d1/main.go');
const missingMigrationSnippets = requiredMigrationSnippets.filter((snippet) => !migrationSource.includes(snippet));
if (missingMigrationSnippets.length > 0) {
  fail('PostgreSQL card migration is incomplete', missingMigrationSnippets);
}

const migrateD1Source = read('backend/cmd/migrate-d1/main.go');
if (!migrateD1Source.includes('"cards"') || !migrateD1Source.includes('PlanCardsImport') || !migrateD1Source.includes('ApplyCardsImport')) {
  fail('migrate-d1 cards scope is incomplete', ['backend/cmd/migrate-d1/main.go must expose cards scope']);
}

const missingStoreFiles = requiredStoreFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingStoreFiles.length > 0) {
  fail('required Go card store files are missing', missingStoreFiles);
}
const storeSource = requiredStoreFiles
  .map((relativePath) => read(relativePath))
  .join('\n');
const missingStoreSnippets = requiredStoreSnippets.filter((snippet) => !storeSource.includes(snippet));
if (missingStoreSnippets.length > 0) {
  fail('Go card PostgreSQL store is incomplete', missingStoreSnippets);
}

const serverSource = existsSync(path.join(repoRoot, 'backend/internal/httpserver/server.go'))
  ? read('backend/internal/httpserver/server.go')
  : '';
const activeGoCardRoutes = serverSource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line.includes('"/cards'));
const missingAllowedGoCardRoutes = allowedGoCardRoutes.filter((route) => !serverSource.includes(route));
const unexpectedGoCardRoutes = activeGoCardRoutes.filter((entry) => !allowedGoCardRoutes.includes(entry.line));
if (missingAllowedGoCardRoutes.length > 0 || unexpectedGoCardRoutes.length > 0) {
  fail(
    'Go card routes must stay limited to reviewed card handlers before remaining write handlers and smoke tests are complete',
    [
      ...missingAllowedGoCardRoutes.map((route) => `missing allowed read-only route ${route}`),
      ...unexpectedGoCardRoutes.map((entry) => `unexpected route backend/internal/httpserver/server.go:${entry.lineNumber} ${entry.line}`),
    ],
  );
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewayCardRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/cards') || entry.line.includes('/api/admin/cards'));

if (activeGatewayCardRules.length > 0) {
  fail(
    'Gateway already contains active card routing rules; cards must stay on Next until Go implementation and import are complete',
    activeGatewayCardRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`),
  );
}

const summary = {
  frontendCardApiPaths: expectedFrontendCardApiPaths,
  frontendLocations: Object.fromEntries([...discovered.entries()]),
  nextCardRoutePaths: expectedNextCardRoutePaths,
  legacyCardDataKeys: [
    'cards:user:{userId}',
    'cards:rules:config',
  ],
  migrations: requiredMigrationFiles,
  importScopes: ['cards'],
  store: requiredStoreFiles,
  goCardRoutes: allowedGoCardRoutes,
  gatewayCardRules: 'none',
};

console.log(JSON.stringify(summary, null, 2));
