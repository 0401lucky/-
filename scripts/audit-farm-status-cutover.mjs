import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedFarmApiPaths = [
  '/api/farm/status',
  '/api/farm/plant',
  '/api/farm/water',
  '/api/farm/water-all',
  '/api/farm/harvest',
  '/api/farm/harvest-all',
  '/api/farm/remove',
  '/api/farm/buy-land',
  '/api/farm/shop/buy',
  '/api/farm/seeds/buy',
  '/api/farm/shop/use',
  '/api/farm/pet/adopt',
  '/api/farm/pet/feed',
  '/api/farm/pet/wash',
  '/api/farm/pet/drink',
  '/api/farm/pet/play',
  '/api/farm/pet/dispatch',
  '/api/farm/steal/list',
  '/api/farm/steal/do',
];

const expectedGatewayFarmRules = expectedFarmApiPaths.map((apiPath) => `handle ${apiPath} {`);

const requiredStatusFields = [
  'state',
  'computedLands',
  'world',
  'weatherForecast',
  'shopDailyPurchases',
  'serverNow',
  'plantableCrops',
  'nextSeasonInMs',
  'nextDailyInMs',
];

const requiredLegacySnippets = [
  'export async function getFarmStatus',
  'getOrCreateFarmV2',
  'tickFarm(state, now)',
  'syncStatePointsFromLedger(state)',
  'processPassivePetSkills(state, now)',
  'buildFarmStatusResponseFromState',
  'FARM_V2_STATE_KEY',
];

const requiredFarmMigrationSnippets = [
  'CREATE TABLE IF NOT EXISTS farm_states',
  'state_json JSONB NOT NULL',
  'CREATE TABLE IF NOT EXISTS farm_daily_shop_purchases',
  'CREATE TABLE IF NOT EXISTS farm_maturity_email_dedupes',
  'CREATE TABLE IF NOT EXISTS farm_water_email_dedupes',
];

const requiredD1AnalyzerSnippets = [
  'matchKeyPattern(key, "farmv2:state:*")',
  'farm_states',
  'matchKeyPattern(key, "farmv2:shop:daily:*")',
  'farm_daily_shop_purchases',
  'matchKeyPattern(key, "farmv2:mature-mail:sent:*")',
  'farm_maturity_email_dedupes',
  'matchKeyPattern(key, "farmv2:water-mail:sent:*")',
  'farm_water_email_dedupes',
];

const requiredFarmImporterFiles = [
  'backend/internal/migration/d1/farm_v2_importer.go',
  'backend/internal/migration/d1/farm_v2_importer_test.go',
  'backend/internal/migration/d1/farm_v2_importer_integration_test.go',
  'backend/internal/migration/d1/testdata/farm-v2.sql',
];

const requiredFarmStoreFiles = [
  'backend/internal/farm/types.go',
  'backend/internal/farm/store.go',
  'backend/internal/farm/store_test.go',
  'backend/internal/farm/store_integration_test.go',
];

const requiredFarmStatusServiceFiles = [
  'backend/internal/farm/status_types.go',
  'backend/internal/farm/json_types.go',
  'backend/internal/farm/initial_state.go',
  'backend/internal/farm/engine.go',
  'backend/internal/farm/tick.go',
  'backend/internal/farm/friday_event.go',
  'backend/internal/farm/pet_tick.go',
  'backend/internal/farm/harvest.go',
  'backend/internal/farm/steal.go',
  'backend/internal/farm/shop.go',
  'backend/internal/farm/actions.go',
  'backend/internal/farm/seedrandom.go',
  'backend/internal/farm/service.go',
  'backend/internal/farm/engine_test.go',
  'backend/internal/farm/tick_test.go',
  'backend/internal/farm/friday_event_test.go',
  'backend/internal/farm/pet_tick_test.go',
  'backend/internal/farm/steal_test.go',
  'backend/internal/farm/service_test.go',
  'backend/internal/farm/service_integration_test.go',
];

const requiredFarmStatusServiceSnippets = [
  'func (service *Service) GetStatus',
  'type StatusResponse struct',
  'func getWeatherForDate',
  'func buildComputedLands',
  'func getPlantableCrops',
  'func newInitialState',
  'func normalizeState',
  'func (store *Store) GetPointBalance',
  'func (store *Store) EnsureInitialPointGrant',
  'func (store *Store) AddFarmPoints',
  'func (service *Service) syncPointsFromLedger',
  'func tickBasicCropState',
  'func applyRainAutoWater',
  'weatherAutoWaterMinutes',
  'func runCrowChecks',
  'func singleCrowCheck',
  'crowCheckWindow',
  'weatherCrowFactor',
  'func maybeApplyFridayEvent',
  'fridayRandomEvents',
  'func removeRandomSeed',
  'func addToInventory',
  'func processPetLazyState',
  'func processPetDailyDecayMap',
  'func processPetTimeDecayMap',
  'func processPetTaskEndMap',
  'func maybeStopPetWorkOnLowMoodMap',
  'func processPetWaterTask',
  'waterActionLeadMs',
  'func processPassivePetPlant',
  'func pickPetPlantCrop',
  'func plantCropFromInventory',
  'func processPassivePetHarvest',
  'func doHarvestSingle',
  'func computeFinalYield',
  'func rollQualityRates',
  'func bonusFlag',
  'func getStealableMatureIndexes',
  'func pickRandomStealableMatureIndex',
  'func computeStealSuccessRate',
  'func applyWholeStealOnTarget',
  'func (service *Service) ExecuteSteal',
  'func (service *Service) executeSteal',
  'type StealResult struct',
  'func (service *Service) ExecutePlant',
  'func applyPlantAction',
  'func (service *Service) ExecuteWater',
  'func applyWaterAction',
  'func (service *Service) ExecuteWaterAll',
  'func applyWaterAllAction',
  'func (service *Service) ExecuteHarvest',
  'func applyHarvestAction',
  'func (service *Service) ExecuteHarvestAll',
  'func applyHarvestAllAction',
  'func (service *Service) ExecuteRemove',
  'func applyRemoveAction',
  'func (service *Service) ExecuteBuySeeds',
  'func prepareBuySeedsAction',
  'func applyBuySeedsAction',
  'func (service *Service) ExecuteBuyLand',
  'func prepareBuyLandAction',
  'func applyBuyLandAction',
  'func (service *Service) ExecuteBuyShopItem',
  'func prepareBuyShopItemAction',
  'func applyBuyShopItemAction',
  'func itemUsesDailyLimit',
  'func (service *Service) ExecuteUseShopItem',
  'func applyUseShopItemAction',
  'func applyLearnPetSkillItem',
  'func consumeFromInventory',
  'func (service *Service) ExecuteAdoptPet',
  'func prepareAdoptPetAction',
  'func applyAdoptPetAction',
  'func (service *Service) ExecuteFeedPet',
  'func applyFeedPetAction',
  'func (service *Service) ExecuteUsePetItem',
  'func applyPetItemAction',
  'func (service *Service) ExecuteDispatchPet',
  'func applyDispatchPetAction',
  'func isAllowedDispatchPetTask',
  'func (store *Store) getEffectiveShopItemDefTx',
  'func (store *Store) getDailyPurchaseCountForUpdateTx',
  'func (store *Store) incrementDailyPurchaseTx',
  'func validatePetSkillReady',
  'func dispatchPetTask',
  'func (service *Service) ListStealCandidates',
  'func (store *Store) listStealCandidateRecords',
  'func (store *Store) getOrCreateStateForUpdateTx',
  'func (store *Store) saveStateTx',
  'func (store *Store) addFarmPointsTx',
  'func computeActualWaterIntervalMs',
  'func computeWaterMissesAfterWindow',
];

const requiredFarmHTTPFiles = [
  'backend/internal/httpserver/farm_handlers.go',
  'backend/internal/httpserver/farm_handlers_test.go',
  'backend/internal/httpserver/farm_handlers_integration_test.go',
];

const requiredFarmSmokeFiles = [
  'scripts/smoke-farm-go-api.mjs',
  'scripts/smoke-farm-write-go-api.mjs',
];

const requiredFarmSmokeSnippets = [
  'FARM_GO_API_COOKIE',
  'FARM_WRITE_SMOKE_USER_ID',
  'docker-compose-exec-api',
  'docker-compose-exec-api-and-postgres',
  'checkedUnauthenticatedPaths',
  'checkedAuthenticatedPaths',
  'verifyCleanup',
  '/api/farm/seeds/buy',
  '/api/farm/plant',
  '/api/farm/water',
  '/api/farm/harvest',
  '/api/farm/shop/buy',
  '/api/farm/shop/use',
  '/api/farm/pet/adopt',
  '/api/farm/pet/feed',
  '/api/farm/pet/dispatch',
  '/api/farm/steal/list',
  '/api/farm/steal/do',
  'gatewayFarmRules',
];

const allowedGoFarmRoutes = [
  'api.Get("/farm/status", farmHandlers.status)',
  'api.Post("/farm/status", farmHandlers.status)',
  'api.Post("/farm/plant", farmHandlers.plant)',
  'api.Post("/farm/water", farmHandlers.water)',
  'api.Post("/farm/water-all", farmHandlers.waterAll)',
  'api.Post("/farm/harvest", farmHandlers.harvest)',
  'api.Post("/farm/harvest-all", farmHandlers.harvestAll)',
  'api.Post("/farm/remove", farmHandlers.remove)',
  'api.Post("/farm/buy-land", farmHandlers.buyLand)',
  'api.Post("/farm/shop/buy", farmHandlers.buyShopItem)',
  'api.Post("/farm/shop/use", farmHandlers.useShopItem)',
  'api.Post("/farm/seeds/buy", farmHandlers.buySeeds)',
  'api.Post("/farm/pet/adopt", farmHandlers.adoptPet)',
  'api.Post("/farm/pet/feed", farmHandlers.feedPet)',
  'api.Post("/farm/pet/wash", farmHandlers.washPet)',
  'api.Post("/farm/pet/drink", farmHandlers.drinkPet)',
  'api.Post("/farm/pet/play", farmHandlers.playPet)',
  'api.Post("/farm/pet/dispatch", farmHandlers.dispatchPet)',
  'api.Get("/farm/steal/list", farmHandlers.stealList)',
  'api.Post("/farm/steal/do", farmHandlers.stealDo)',
];

const requiredFarmHTTPSnippets = [
  'func newFarmHandlers',
  'func (handlers farmHandlers) status',
  'func (handlers farmHandlers) plant',
  'func (handlers farmHandlers) water',
  'func (handlers farmHandlers) waterAll',
  'func (handlers farmHandlers) harvest',
  'func (handlers farmHandlers) harvestAll',
  'func (handlers farmHandlers) remove',
  'func (handlers farmHandlers) buyLand',
  'func (handlers farmHandlers) buyShopItem',
  'func (handlers farmHandlers) useShopItem',
  'func (handlers farmHandlers) buySeeds',
  'func (handlers farmHandlers) adoptPet',
  'func (handlers farmHandlers) feedPet',
  'func (handlers farmHandlers) washPet',
  'func (handlers farmHandlers) drinkPet',
  'func (handlers farmHandlers) playPet',
  'func (handlers farmHandlers) dispatchPet',
  'func (handlers farmHandlers) usePetItem',
  'func (handlers farmHandlers) stealList',
  'func (handlers farmHandlers) stealDo',
  'shared.rejectUntrustedUnsafeRequest',
  'shared.requireUser',
  'farmActionRateLimit',
  'handlers.service.ExecuteSteal',
  'handlers.service.ExecutePlant',
  'handlers.service.ExecuteWater',
  'handlers.service.ExecuteWaterAll',
  'handlers.service.ExecuteHarvest',
  'handlers.service.ExecuteHarvestAll',
  'handlers.service.ExecuteRemove',
  'handlers.service.ExecuteBuyLand',
  'handlers.service.ExecuteBuyShopItem',
  'handlers.service.ExecuteUseShopItem',
  'handlers.service.ExecuteBuySeeds',
  'handlers.service.ExecuteAdoptPet',
  'handlers.service.ExecuteFeedPet',
  'handlers.service.ExecuteUsePetItem',
  'handlers.service.ExecuteDispatchPet',
  'handlers.service.ListStealCandidates',
  'handlers.service.GetStatus',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'farm'),
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
  console.error(`farm status cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const farmPathPattern = /['"`](\/api\/farm(?:\/[a-zA-Z0-9_-]+)*)(?:[?#][^'"`]*)?['"`]/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(farmPathPattern)) {
    const apiPath = match[1];
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedSet = new Set(expectedFarmApiPaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedFarmApiPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedSet.has(apiPath));

if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend farm API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected frontend path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => {
      const locations = discovered.get(apiPath).join(', ');
      return `unexpected frontend path ${apiPath} in ${locations}`;
    }),
  ]);
}

const typeSource = read('src/lib/types/farm-v2.ts');
const statusInterfaceMatch = typeSource.match(/export interface FarmStatusResponse \{([\s\S]*?)\n\}/);
if (!statusInterfaceMatch) {
  fail('FarmStatusResponse type is missing');
}
const statusInterfaceSource = statusInterfaceMatch[1];
const missingStatusFields = requiredStatusFields.filter((field) => !new RegExp(`\\b${field}\\??:`).test(statusInterfaceSource));
if (missingStatusFields.length > 0) {
  fail('FarmStatusResponse fields changed', missingStatusFields);
}

const farmIndexSource = read('src/lib/farm-v2/index.ts');
const stealSource = read('src/lib/farm-v2/steal.ts');
const legacySource = `${farmIndexSource}\n${stealSource}`;
const missingLegacySnippets = requiredLegacySnippets.filter((snippet) => !legacySource.includes(snippet));
if (missingLegacySnippets.length > 0) {
  fail('legacy farm status implementation shape changed', missingLegacySnippets);
}

const routeSource = read('src/app/api/farm/status/route.ts');
if (!/withUserRateLimit\(\s*['"]farm:action['"]/.test(routeSource) || !routeSource.includes('const data = await getFarmStatus(user.id)')) {
  fail('legacy /api/farm/status route no longer matches expected wrapper');
}

const requiredMigrationPath = 'backend/migrations/0015_farm_runtime.sql';
if (!existsSync(path.join(repoRoot, requiredMigrationPath))) {
  fail('required farm runtime migration is missing', [requiredMigrationPath]);
}

const farmMigrationSource = read(requiredMigrationPath);
const missingFarmMigrationSnippets = requiredFarmMigrationSnippets.filter((snippet) => !farmMigrationSource.includes(snippet));
if (missingFarmMigrationSnippets.length > 0) {
  fail('farm runtime migration is incomplete', missingFarmMigrationSnippets);
}

const missingFarmImporterFiles = requiredFarmImporterFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingFarmImporterFiles.length > 0) {
  fail('farm-v2 D1 importer files are missing', missingFarmImporterFiles);
}

const missingFarmStoreFiles = requiredFarmStoreFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingFarmStoreFiles.length > 0) {
  fail('farm PostgreSQL store files are missing', missingFarmStoreFiles);
}

const missingFarmStatusServiceFiles = requiredFarmStatusServiceFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingFarmStatusServiceFiles.length > 0) {
  fail('farm status service files are missing', missingFarmStatusServiceFiles);
}

const farmStatusServiceSource = [
  read('backend/internal/farm/status_types.go'),
  read('backend/internal/farm/store.go'),
  read('backend/internal/farm/initial_state.go'),
  read('backend/internal/farm/engine.go'),
  read('backend/internal/farm/tick.go'),
  read('backend/internal/farm/friday_event.go'),
  read('backend/internal/farm/pet_tick.go'),
  read('backend/internal/farm/harvest.go'),
  read('backend/internal/farm/steal.go'),
  read('backend/internal/farm/shop.go'),
  read('backend/internal/farm/actions.go'),
  read('backend/internal/farm/service.go'),
].join('\n');
const missingFarmStatusServiceSnippets = requiredFarmStatusServiceSnippets.filter((snippet) => !farmStatusServiceSource.includes(snippet));
if (missingFarmStatusServiceSnippets.length > 0) {
  fail('farm status service is incomplete', missingFarmStatusServiceSnippets);
}

const farmHTTPSource = read('backend/internal/httpserver/farm_handlers.go');
const missingFarmHTTPFiles = requiredFarmHTTPFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingFarmHTTPFiles.length > 0) {
  fail('farm HTTP handler test coverage files are missing', missingFarmHTTPFiles);
}
const missingFarmHTTPSnippets = requiredFarmHTTPSnippets.filter((snippet) => !farmHTTPSource.includes(snippet));
if (missingFarmHTTPSnippets.length > 0) {
  fail('farm HTTP handler is incomplete', missingFarmHTTPSnippets);
}

const missingFarmSmokeFiles = requiredFarmSmokeFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingFarmSmokeFiles.length > 0) {
  fail('farm direct API smoke files are missing', missingFarmSmokeFiles);
}
const farmSmokeSource = requiredFarmSmokeFiles.map((relativePath) => read(relativePath)).join('\n');
const missingFarmSmokeSnippets = requiredFarmSmokeSnippets.filter((snippet) => !farmSmokeSource.includes(snippet));
if (missingFarmSmokeSnippets.length > 0) {
  fail('farm direct API smoke script is incomplete', missingFarmSmokeSnippets);
}

const analyzerSource = read('backend/internal/migration/d1/analyzer.go');
const missingD1AnalyzerSnippets = requiredD1AnalyzerSnippets.filter((snippet) => !analyzerSource.includes(snippet));
if (missingD1AnalyzerSnippets.length > 0) {
  fail('D1 analyzer farmv2 mappings are incomplete', missingD1AnalyzerSnippets);
}

const migrateD1Source = read('backend/cmd/migrate-d1/main.go');
if (!migrateD1Source.includes('"farm-v2"') || !migrateD1Source.includes('PlanFarmV2Import') || !migrateD1Source.includes('ApplyFarmV2Import')) {
  fail('migrate-d1 farm-v2 scope is not wired');
}

const serverSource = read('backend/internal/httpserver/server.go');
const activeGoFarmRoutes = serverSource
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^api\.(Get|Post|Put|Delete)\("\/farm\//.test(line));

const unexpectedGoFarmRoutes = activeGoFarmRoutes.filter((line) => !allowedGoFarmRoutes.includes(line));
const missingAllowedGoFarmRoutes = allowedGoFarmRoutes.filter((line) => !activeGoFarmRoutes.includes(line));

if (unexpectedGoFarmRoutes.length > 0) {
  fail('Go HTTP server registers unexpected farm routes; keep farm migration on exact reviewed paths only', unexpectedGoFarmRoutes);
}
if (missingAllowedGoFarmRoutes.length > 0) {
  fail('expected reviewed Go farm routes are missing', missingAllowedGoFarmRoutes);
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewayFarmRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/farm'));

const activeGatewayFarmRuleLines = activeGatewayFarmRules.map((entry) => entry.line);
const missingGatewayFarmRules = expectedGatewayFarmRules.filter((line) => !activeGatewayFarmRuleLines.includes(line));
const unexpectedGatewayFarmRules = activeGatewayFarmRules
  .filter((entry) => !expectedGatewayFarmRules.includes(entry.line))
  .map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`);

if (missingGatewayFarmRules.length > 0 || unexpectedGatewayFarmRules.length > 0) {
  fail(
    'Gateway farm routing rules must stay exact on reviewed frontend paths',
    [
      ...missingGatewayFarmRules.map((line) => `missing ${line}`),
      ...unexpectedGatewayFarmRules.map((line) => `unexpected ${line}`),
    ],
  );
}

const summary = {
  frontendFarmApiPaths: expectedFarmApiPaths,
  frontendLocations: Object.fromEntries([...discovered.entries()]),
  statusFields: requiredStatusFields,
  legacyStateStorage: 'kv_data key farmv2:state:{userId}',
  legacyDailyPurchaseStorage: 'kv_data key farmv2:shop:daily:{userId}:{date}:{itemKey}',
  postgresFarmStateMigrations: [requiredMigrationPath],
  d1FarmImportMappings: 'farm-v2',
  farmImporterFiles: requiredFarmImporterFiles,
  farmStoreFiles: requiredFarmStoreFiles,
  farmStatusServiceFiles: requiredFarmStatusServiceFiles,
  farmHTTPFiles: requiredFarmHTTPFiles,
  farmSmokeFiles: requiredFarmSmokeFiles,
  goFarmRoutes: allowedGoFarmRoutes,
  gatewayFarmRules: expectedGatewayFarmRules,
  cutoverRecommendation: 'Go has exact internal farm handlers for every current frontend /api/farm path plus PostgreSQL HTTP integration coverage; Gateway may cut only these exact paths and must keep /api/farm* wildcard closed',
};

console.log(JSON.stringify(summary, null, 2));
