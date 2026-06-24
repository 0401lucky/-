import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'backend/internal/adminusers/types.go',
  'backend/internal/adminusers/achievements.go',
  'backend/internal/adminusers/service.go',
  'backend/internal/httpserver/admin_user_handlers.go',
  'backend/internal/httpserver/admin_user_handlers_test.go',
  'backend/internal/httpserver/admin_user_handlers_integration_test.go',
  'scripts/smoke-admin-users-go-api.mjs',
  'docs/admin-users-cutover-preflight.md',
];

const requiredServerSnippets = [
  'api.Get("/admin/users", adminUserHandlers.list)',
  'api.Get("/admin/users/{id}", adminUserHandlers.detail)',
  'api.Post("/admin/users/{id}/achievements", adminUserHandlers.updateAchievement)',
];

const requiredHandlerSnippets = [
  'func (handlers adminUserHandlers) list',
  'func (handlers adminUserHandlers) detail',
  'func (handlers adminUserHandlers) updateAchievement',
  'requireAdmin',
  'rejectUntrustedUnsafeRequest',
  '该成就不支持手动颁发',
];

const requiredServiceSnippets = [
  'func (service *Service) ListUsers',
  'func (service *Service) GetUserDetail',
  'func (service *Service) SetAchievement',
  'user_achievement_grants',
  'user_equipped_achievements',
  'exchange_logs',
  'raffle_entries',
  'achievementID != "contributor"',
];

function read(path) {
  return readFileSync(path, 'utf8');
}

function fail(message, details = []) {
  console.error(`admin users cutover audit failed: ${message}`);
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
const handlerSource = read('backend/internal/httpserver/admin_user_handlers.go');
const serviceSource = read('backend/internal/adminusers/service.go');
const gatewaySource = read('gateway/Caddyfile');

const missingServer = requiredServerSnippets.filter((snippet) => !serverSource.includes(snippet));
const missingHandler = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
const missingService = requiredServiceSnippets.filter((snippet) => !serviceSource.includes(snippet));

const activeGatewayAdminUserRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/admin/users'));
const expectedGatewayAdminUserRules = [
  'handle /api/admin/users {',
  'handle /api/admin/users/* {',
];
const missingGatewayAdminUserRules = expectedGatewayAdminUserRules
  .filter((line) => !activeGatewayAdminUserRules.some((entry) => entry.line === line));
const unexpectedGatewayAdminUserRules = activeGatewayAdminUserRules
  .filter((entry) => !expectedGatewayAdminUserRules.includes(entry.line));

if (
  missingServer.length > 0 ||
  missingHandler.length > 0 ||
  missingService.length > 0 ||
  missingGatewayAdminUserRules.length > 0 ||
  unexpectedGatewayAdminUserRules.length > 0
) {
  fail('admin users migration is incomplete or Gateway exact cutover is unsafe', [
    ...missingServer.map((item) => `missing server snippet: ${item}`),
    ...missingHandler.map((item) => `missing handler snippet: ${item}`),
    ...missingService.map((item) => `missing service snippet: ${item}`),
    ...missingGatewayAdminUserRules.map((line) => `missing gateway exact rule: ${line}`),
    ...unexpectedGatewayAdminUserRules.map((entry) => `gateway/Caddyfile:${entry.lineNumber} unexpected admin users rule: ${entry.line}`),
  ]);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'admin-users-cutover-audit',
  goRoutes: requiredServerSnippets,
  gatewayAdminUsersCutover: 'enabled-exact',
}, null, 2));
