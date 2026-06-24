import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'backend/internal/eco/admin.go',
  'backend/internal/httpserver/eco_handlers.go',
  'backend/internal/httpserver/server.go',
  'backend/migrations/0019_eco_admin_settings.sql',
  'backend/internal/eco/service_integration_test.go',
  'scripts/smoke-admin-eco-go-api.mjs',
  'docs/admin-eco-cutover-preflight.md',
];

const requiredServerSnippets = [
  'api.Get("/admin/eco", ecoHandlers.getAdminOverview)',
  'api.Patch("/admin/eco", ecoHandlers.updateAdminSettings)',
];

const requiredHandlerSnippets = [
  'func (handlers ecoHandlers) getAdminOverview',
  'func (handlers ecoHandlers) updateAdminSettings',
  'parseEcoPrizeRatePatch',
  'requireAdmin',
  'rejectUntrustedUnsafeRequest',
  'eco.ErrInvalidPrizeRateSettings',
];

const requiredServiceSnippets = [
  'func (service *Service) GetAdminOverview',
  'func (service *Service) UpdatePrizeRateSettings',
  'func (service *Service) loadPrizeRateSettings',
  'func loadPrizeRateSettingsTx',
  'buildAdminPrizeSummaries',
  'buildAdminTheftViews',
  'buildAdminManualTrash',
  'eco_prize_rate_settings',
];

const requiredMigrationSnippets = [
  'CREATE TABLE IF NOT EXISTS eco_prize_rate_settings',
  'spawn_rate DOUBLE PRECISION NOT NULL',
  "CHECK (prize_key IN ('diamond', 'coin', 'necklace', 'trophy', 'photo'))",
  'CHECK (spawn_rate <= 1)',
];

const requiredOnlineSnippets = [
  'rates, err := loadPrizeRateSettingsTx(ctx, tx)',
  'rollEcoGeneratedPrize(multiplier, rates)',
];

const requiredStatusSnippets = [
  'rates, err := service.loadPrizeRateSettings(ctx)',
  'SpawnRate:                 rates[key]',
];

function read(path) {
  return readFileSync(path, 'utf8');
}

function fail(message, details = []) {
  console.error(`admin eco cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

const missingFiles = requiredFiles.filter((file) => !existsSync(file));
if (missingFiles.length > 0) {
  fail('required files are missing', missingFiles);
}

const serverSource = read('backend/internal/httpserver/server.go');
const handlerSource = read('backend/internal/httpserver/eco_handlers.go');
const serviceSource = read('backend/internal/eco/admin.go');
const migrationSource = read('backend/migrations/0019_eco_admin_settings.sql');
const onlineSource = read('backend/internal/eco/online.go');
const statusSource = read('backend/internal/eco/status.go');

const missingServer = requiredServerSnippets.filter((snippet) => !serverSource.includes(snippet));
const missingHandler = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
const missingService = requiredServiceSnippets.filter((snippet) => !serviceSource.includes(snippet));
const missingMigration = requiredMigrationSnippets.filter((snippet) => !migrationSource.includes(snippet));
const missingOnline = requiredOnlineSnippets.filter((snippet) => !onlineSource.includes(snippet));
const missingStatus = requiredStatusSnippets.filter((snippet) => !statusSource.includes(snippet));

const gatewaySource = read('gateway/Caddyfile');
const activeGatewayAdminEcoRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/admin/eco'));
const expectedGatewayAdminEcoRules = ['handle /api/admin/eco {'];
const missingGatewayAdminEcoRules = expectedGatewayAdminEcoRules
  .filter((line) => !activeGatewayAdminEcoRules.some((entry) => entry.line === line));
const unexpectedGatewayAdminEcoRules = activeGatewayAdminEcoRules
  .filter((entry) => !expectedGatewayAdminEcoRules.includes(entry.line));

if (
  missingServer.length > 0 ||
  missingHandler.length > 0 ||
  missingService.length > 0 ||
  missingMigration.length > 0 ||
  missingOnline.length > 0 ||
  missingStatus.length > 0 ||
  missingGatewayAdminEcoRules.length > 0 ||
  unexpectedGatewayAdminEcoRules.length > 0
) {
  fail('admin eco migration is incomplete or Gateway exact cutover is unsafe', [
    ...missingServer.map((item) => `missing server snippet: ${item}`),
    ...missingHandler.map((item) => `missing handler snippet: ${item}`),
    ...missingService.map((item) => `missing service snippet: ${item}`),
    ...missingMigration.map((item) => `missing migration snippet: ${item}`),
    ...missingOnline.map((item) => `missing online snippet: ${item}`),
    ...missingStatus.map((item) => `missing status snippet: ${item}`),
    ...missingGatewayAdminEcoRules.map((line) => `missing gateway exact rule: ${line}`),
    ...unexpectedGatewayAdminEcoRules.map((entry) => `gateway/Caddyfile:${entry.lineNumber} unexpected admin eco rule: ${entry.line}`),
  ]);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'admin-eco-cutover-audit',
  goRoutes: requiredServerSnippets,
  migration: 'backend/migrations/0019_eco_admin_settings.sql',
  gatewayAdminEcoCutover: 'enabled-exact',
}, null, 2));
