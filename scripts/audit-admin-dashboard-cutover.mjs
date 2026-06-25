import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'backend/internal/admindashboard/types.go',
  'backend/internal/admindashboard/service.go',
  'backend/internal/httpserver/admin_dashboard_handlers.go',
  'backend/internal/httpserver/admin_dashboard_handlers_test.go',
  'backend/internal/httpserver/admin_dashboard_handlers_integration_test.go',
  'backend/migrations/0026_admin_alerts.sql',
  'scripts/audit-admin-alerts-cutover.mjs',
  'scripts/smoke-admin-dashboard-go-api.mjs',
  'docs/admin-dashboard-cutover-preflight.md',
];

const requiredServerSnippets = [
  'api.Get("/admin/dashboard", adminDashboardHandlers.get)',
  'api.Get("/admin/alerts", adminDashboardHandlers.listAlerts)',
  'api.Post("/admin/alerts/{id}/resolve", adminDashboardHandlers.resolveAlert)',
];

const requiredHandlerSnippets = [
  'func (handlers adminDashboardHandlers) get',
  'func (handlers adminDashboardHandlers) listAlerts',
  'func (handlers adminDashboardHandlers) resolveAlert',
  'requireAdmin',
  'rejectUntrustedUnsafeRequest',
  '仪表盘数据库未配置',
];

const requiredServiceSnippets = [
  'func (service *Service) Get',
  'countActiveUsers',
  'point_ledger',
  'exchange_logs',
  'game_records',
  'raffle_entries',
  'admin_alerts',
  'admin_alert_point_baselines',
  'getAlertsSnapshot',
  'runAnomalyDetection',
  'ResolveAlert',
];

function read(path) {
  return readFileSync(path, 'utf8');
}

function fail(message, details = []) {
  console.error(`admin dashboard cutover audit failed: ${message}`);
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
const handlerSource = read('backend/internal/httpserver/admin_dashboard_handlers.go');
const serviceSource = read('backend/internal/admindashboard/service.go');
const migrationSource = read('backend/migrations/0026_admin_alerts.sql');
const gatewaySource = read('gateway/Caddyfile');

const missingServer = requiredServerSnippets.filter((snippet) => !serverSource.includes(snippet));
const missingHandler = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
const missingService = requiredServiceSnippets.filter((snippet) => !serviceSource.includes(snippet));
const missingMigration = [
  'CREATE TABLE IF NOT EXISTS admin_alerts',
  'CREATE TABLE IF NOT EXISTS admin_alert_point_baselines',
].filter((snippet) => !migrationSource.includes(snippet));

const activeGatewayDashboardRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/admin/dashboard') || entry.line.includes('/api/admin/alerts'));
const expectedGatewayDashboardRules = [
  'handle /api/admin/dashboard {',
  'handle /api/admin/alerts {',
  'handle /api/admin/alerts/* {',
];
const missingGatewayDashboardRules = expectedGatewayDashboardRules
  .filter((line) => !activeGatewayDashboardRules.some((entry) => entry.line === line));
const unexpectedGatewayDashboardRules = activeGatewayDashboardRules
  .filter((entry) => !expectedGatewayDashboardRules.includes(entry.line));

if (
  missingServer.length > 0 ||
  missingHandler.length > 0 ||
  missingService.length > 0 ||
  missingMigration.length > 0 ||
  missingGatewayDashboardRules.length > 0 ||
  unexpectedGatewayDashboardRules.length > 0
) {
  fail('admin dashboard migration is incomplete or Gateway exact cutover is unsafe', [
    ...missingServer.map((item) => `missing server snippet: ${item}`),
    ...missingHandler.map((item) => `missing handler snippet: ${item}`),
    ...missingService.map((item) => `missing service snippet: ${item}`),
    ...missingMigration.map((item) => `missing migration snippet: ${item}`),
    ...missingGatewayDashboardRules.map((line) => `missing gateway exact rule: ${line}`),
    ...unexpectedGatewayDashboardRules.map((entry) => `gateway/Caddyfile:${entry.lineNumber} unexpected admin dashboard rule: ${entry.line}`),
  ]);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'admin-dashboard-cutover-audit',
  goRoutes: requiredServerSnippets,
  gatewayAdminDashboardCutover: 'enabled-exact',
}, null, 2));
