import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'backend/internal/rewards/service.go',
  'backend/internal/httpserver/admin_reward_handlers.go',
  'backend/internal/httpserver/admin_reward_handlers_test.go',
  'backend/internal/rewards/service_integration_test.go',
  'scripts/smoke-admin-rewards-go-api.mjs',
];

const requiredServerSnippets = [
  'adminRewardHandlers := newAdminRewardHandlers(deps)',
  'api.Get("/admin/rewards", adminRewardHandlers.list)',
  'api.Post("/admin/rewards", adminRewardHandlers.create)',
  'api.Get("/admin/rewards/{batchId}", adminRewardHandlers.detail)',
];

const requiredHandlerSnippets = [
  'type adminRewardHandlers struct',
  'func (handlers adminRewardHandlers) list',
  'func (handlers adminRewardHandlers) create',
  'func (handlers adminRewardHandlers) detail',
  'requireAdmin',
  'rejectUntrustedUnsafeRequest',
  'adminRewardsRateLimit',
];

const requiredServiceSnippets = [
  'func (service *Service) ListRewardBatches',
  'func (service *Service) GetRewardBatch',
  'func (service *Service) CreateAndDistributeRewardBatch',
  'reward_batches',
  'reward_claims',
  'notifications',
  'claimStatus',
];

function fail(message, details = []) {
  console.error(`admin rewards cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(path) {
  return readFileSync(path, 'utf8');
}

const missingFiles = requiredFiles.filter((file) => !existsSync(file));
if (missingFiles.length > 0) {
  fail('required files are missing', missingFiles);
}

const serverSource = read('backend/internal/httpserver/server.go');
const handlerSource = read('backend/internal/httpserver/admin_reward_handlers.go');
const serviceSource = read('backend/internal/rewards/service.go');
const gatewaySource = read('gateway/Caddyfile');

const missingServer = requiredServerSnippets.filter((snippet) => !serverSource.includes(snippet));
const missingHandler = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
const missingService = requiredServiceSnippets.filter((snippet) => !serviceSource.includes(snippet));

const activeGatewayRewardsRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/admin/rewards'));

const expectedGatewayRewardsRules = [
  'handle /api/admin/rewards {',
  'handle /api/admin/rewards/* {',
];
const missingGatewayRewardsRules = expectedGatewayRewardsRules
  .filter((line) => !activeGatewayRewardsRules.some((entry) => entry.line === line));
const unexpectedGatewayRewardsRules = activeGatewayRewardsRules
  .filter((entry) => !expectedGatewayRewardsRules.includes(entry.line));

if (
  missingServer.length > 0 ||
  missingHandler.length > 0 ||
  missingService.length > 0 ||
  missingGatewayRewardsRules.length > 0 ||
  unexpectedGatewayRewardsRules.length > 0
) {
  fail('admin rewards migration is incomplete or Gateway exact cutover is unsafe', [
    ...missingServer.map((item) => `missing server snippet: ${item}`),
    ...missingHandler.map((item) => `missing handler snippet: ${item}`),
    ...missingService.map((item) => `missing service snippet: ${item}`),
    ...missingGatewayRewardsRules.map((line) => `missing gateway exact rule: ${line}`),
    ...unexpectedGatewayRewardsRules.map((entry) => `gateway/Caddyfile:${entry.lineNumber} unexpected admin rewards rule: ${entry.line}`),
  ]);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'admin-rewards-cutover-audit',
  goRoutes: requiredServerSnippets.slice(1),
  gatewayAdminRewardsCutover: 'enabled-exact',
}, null, 2));
