import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'backend/internal/httpserver/store_admin_handlers.go',
  'backend/internal/httpserver/admin_user_handlers_test.go',
  'scripts/smoke-admin-store-reset-go-api.mjs',
];

const requiredServerSnippets = [
  'api.Post("/admin/store/reset", economyHandlers.adminStoreResetDisabled)',
];

const requiredHandlerSnippets = [
  'func (handlers economyHandlers) adminStoreResetDisabled',
  'ADMIN_STORE_RESET_DISABLED',
  'rejectUntrustedUnsafeRequest',
  'requireAdmin',
  'http.StatusGone',
];

function fail(message, details = []) {
  console.error(`admin store reset tombstone audit failed: ${message}`);
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
const handlerSource = read('backend/internal/httpserver/store_admin_handlers.go');
const gatewaySource = read('gateway/Caddyfile');

const missingServer = requiredServerSnippets.filter((snippet) => !serverSource.includes(snippet));
const missingHandler = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));

const activeGatewayRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/admin/store/reset'));

const expectedGatewayRules = ['handle /api/admin/store/reset {'];
const missingGatewayRules = expectedGatewayRules.filter((line) => !activeGatewayRules.some((entry) => entry.line === line));
const unexpectedGatewayRules = activeGatewayRules.filter((entry) => !expectedGatewayRules.includes(entry.line));

if (
  missingServer.length > 0 ||
  missingHandler.length > 0 ||
  missingGatewayRules.length > 0 ||
  unexpectedGatewayRules.length > 0
) {
  fail('admin store reset tombstone is incomplete or Gateway rule is unsafe', [
    ...missingServer.map((item) => `missing server snippet: ${item}`),
    ...missingHandler.map((item) => `missing handler snippet: ${item}`),
    ...missingGatewayRules.map((line) => `missing gateway exact rule: ${line}`),
    ...unexpectedGatewayRules.map((entry) => `gateway/Caddyfile:${entry.lineNumber} unexpected admin store reset rule: ${entry.line}`),
  ]);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'admin-store-reset-tombstone-audit',
  goRoutes: requiredServerSnippets,
  gatewayCutover: 'enabled-exact-tombstone',
}, null, 2));
