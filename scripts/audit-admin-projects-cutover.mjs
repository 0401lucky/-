import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'backend/internal/welfare/admin_project.go',
  'backend/internal/welfare/types.go',
  'backend/internal/httpserver/welfare_handlers.go',
  'backend/internal/httpserver/welfare_handlers_test.go',
  'backend/internal/httpserver/welfare_handlers_integration_test.go',
  'scripts/smoke-admin-projects-go-api.mjs',
  'docs/admin-projects-cutover-preflight.md',
];

const requiredServerSnippets = [
  'api.Get("/admin/projects", welfareHandlers.listAdminProjects)',
  'api.Post("/admin/projects", welfareHandlers.createAdminProject)',
  'api.Get("/admin/projects/{id}", welfareHandlers.getAdminProjectDetail)',
  'api.Patch("/admin/projects/{id}", welfareHandlers.updateAdminProject)',
  'api.Delete("/admin/projects/{id}", welfareHandlers.deleteAdminProject)',
  'api.Post("/admin/projects/{id}", welfareHandlers.appendAdminProjectClaims)',
];

const requiredHandlerSnippets = [
  'func (handlers welfareHandlers) listAdminProjects',
  'func (handlers welfareHandlers) createAdminProject',
  'func (handlers welfareHandlers) getAdminProjectDetail',
  'func (handlers welfareHandlers) updateAdminProject',
  'func (handlers welfareHandlers) deleteAdminProject',
  'func (handlers welfareHandlers) appendAdminProjectClaims',
  'parseCreateAdminProjectForm',
  'parseUpdateAdminProjectJSON',
  'parseAppendClaimsForm',
  'requireAdmin',
  'rejectUntrustedUnsafeRequest',
];

const requiredServiceSnippets = [
  'func (service *Service) ListAdminProjects',
  'func (service *Service) CreateAdminProject',
  'func (service *Service) GetAdminProjectDetail',
  'func (service *Service) UpdateAdminProject',
  'func (service *Service) DeleteAdminProject',
  'func (service *Service) AppendAdminProjectClaims',
  'reward_type',
  'direct_points',
  'exchange_logs',
  '历史兑换码项目已设为只读，不能继续追加兑换码',
];

function read(path) {
  return readFileSync(path, 'utf8');
}

function fail(message, details = []) {
  console.error(`admin projects cutover audit failed: ${message}`);
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
const handlerSource = read('backend/internal/httpserver/welfare_handlers.go');
const serviceSource = read('backend/internal/welfare/admin_project.go');
const gatewaySource = read('gateway/Caddyfile');

const missingServer = requiredServerSnippets.filter((snippet) => !serverSource.includes(snippet));
const missingHandler = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
const missingService = requiredServiceSnippets.filter((snippet) => !serviceSource.includes(snippet));

const activeGatewayAdminProjectRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/admin/projects'));
const expectedGatewayAdminProjectRules = [
  'handle /api/admin/projects {',
  'handle /api/admin/projects/* {',
];
const missingGatewayAdminProjectRules = expectedGatewayAdminProjectRules
  .filter((line) => !activeGatewayAdminProjectRules.some((entry) => entry.line === line));
const unexpectedGatewayAdminProjectRules = activeGatewayAdminProjectRules
  .filter((entry) => !expectedGatewayAdminProjectRules.includes(entry.line));

if (
  missingServer.length > 0 ||
  missingHandler.length > 0 ||
  missingService.length > 0 ||
  missingGatewayAdminProjectRules.length > 0 ||
  unexpectedGatewayAdminProjectRules.length > 0
) {
  fail('admin projects migration is incomplete or Gateway exact cutover is unsafe', [
    ...missingServer.map((item) => `missing server snippet: ${item}`),
    ...missingHandler.map((item) => `missing handler snippet: ${item}`),
    ...missingService.map((item) => `missing service snippet: ${item}`),
    ...missingGatewayAdminProjectRules.map((line) => `missing gateway exact rule: ${line}`),
    ...unexpectedGatewayAdminProjectRules.map((entry) => `gateway/Caddyfile:${entry.lineNumber} unexpected admin projects rule: ${entry.line}`),
  ]);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'admin-projects-cutover-audit',
  goRoutes: requiredServerSnippets,
  gatewayAdminProjectsCutover: 'enabled-exact',
}, null, 2));
