import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'backend/internal/economy/admin_points.go',
  'backend/internal/httpserver/admin_points_handlers.go',
  'backend/internal/httpserver/admin_points_handlers_test.go',
  'backend/internal/economy/service_integration_test.go',
  'scripts/smoke-admin-points-go-api.mjs',
  'docs/admin-points-cutover-preflight.md',
];

const requiredServerSnippets = [
  'api.Get("/admin/points", economyHandlers.getAdminUserPoints)',
  'api.Post("/admin/points", economyHandlers.adjustAdminUserPoints)',
];

const requiredHandlerSnippets = [
  'func (handlers economyHandlers) getAdminUserPoints',
  'func (handlers economyHandlers) adjustAdminUserPoints',
  'parsePositiveInt64Query',
  'parseSafeNonZeroInt64Raw',
  'requireAdmin',
  'rejectUntrustedUnsafeRequest',
  '单次调整不能超过 1,000,000 积分',
];

const requiredServiceSnippets = [
  'func (service *Service) GetAdminUserPoints',
  'func (service *Service) AdjustAdminUserPoints',
  'countPointLogs',
  'listPointLogsPage',
  'Source:      "admin_adjust"',
  '"[管理员:" + adminName + "] "',
];

function read(path) {
  return readFileSync(path, 'utf8');
}

function fail(message, details = []) {
  console.error(`admin points cutover audit failed: ${message}`);
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
const handlerSource = read('backend/internal/httpserver/admin_points_handlers.go');
const serviceSource = read('backend/internal/economy/admin_points.go');
const gatewaySource = read('gateway/Caddyfile');

const missingServer = requiredServerSnippets.filter((snippet) => !serverSource.includes(snippet));
const missingHandler = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
const missingService = requiredServiceSnippets.filter((snippet) => !serviceSource.includes(snippet));

const activeGatewayAdminPointsRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/admin/points'));
const expectedGatewayAdminPointsRules = ['handle /api/admin/points {'];
const missingGatewayAdminPointsRules = expectedGatewayAdminPointsRules
  .filter((line) => !activeGatewayAdminPointsRules.some((entry) => entry.line === line));
const unexpectedGatewayAdminPointsRules = activeGatewayAdminPointsRules
  .filter((entry) => !expectedGatewayAdminPointsRules.includes(entry.line));

if (
  missingServer.length > 0 ||
  missingHandler.length > 0 ||
  missingService.length > 0 ||
  missingGatewayAdminPointsRules.length > 0 ||
  unexpectedGatewayAdminPointsRules.length > 0
) {
  fail('admin points migration is incomplete or Gateway exact cutover is unsafe', [
    ...missingServer.map((item) => `missing server snippet: ${item}`),
    ...missingHandler.map((item) => `missing handler snippet: ${item}`),
    ...missingService.map((item) => `missing service snippet: ${item}`),
    ...missingGatewayAdminPointsRules.map((line) => `missing gateway exact rule: ${line}`),
    ...unexpectedGatewayAdminPointsRules.map((entry) => `gateway/Caddyfile:${entry.lineNumber} unexpected admin points rule: ${entry.line}`),
  ]);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'admin-points-cutover-audit',
  goRoutes: requiredServerSnippets,
  gatewayAdminPointsCutover: 'enabled-exact',
}, null, 2));
