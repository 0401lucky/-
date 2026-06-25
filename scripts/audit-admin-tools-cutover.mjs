import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function mustContain(source, marker, label, failures) {
  if (!source.includes(marker)) {
    failures.push(`${label} 缺少 ${marker}`);
  }
}

const gateway = read('gateway/Caddyfile');
const server = read('backend/internal/httpserver/server.go');
const adminUserHandler = read('backend/internal/httpserver/admin_user_handlers.go');
const dashboardHandler = read('backend/internal/httpserver/admin_dashboard_handlers.go');
const dashboardService = read('backend/internal/admindashboard/service.go');
const alertsMigration = read('backend/migrations/0026_admin_alerts.sql');
const settingsPage = read('src/app/admin/settings/page.tsx');
const usersPage = read('src/app/admin/users/page.tsx');
const dashboardPage = read('src/app/admin/dashboard/page.tsx');

const productionValueRoutes = [
  '/api/admin/config',
  '/api/admin/alerts/{id}/resolve',
];

const migrationToolRoutes = [
  '/api/admin/sync-users',
  '/api/admin/fix-codes-count',
  '/api/admin/migrate-native-hot-data',
  '/api/admin/migrate-new-user-eligibility',
];

const failures = [];
mustContain(settingsPage, "fetch('/api/admin/config')", '后台设置页', failures);
mustContain(dashboardPage, 'fetch(`/api/admin/alerts/${id}/resolve`', '后台仪表盘告警处理', failures);
if (usersPage.includes("fetch('/api/admin/sync-users'") || usersPage.includes('fetch("/api/admin/sync-users"')) {
  failures.push('后台用户页不应继续调用 /api/admin/sync-users');
}
if (usersPage.includes("fetch('/api/admin/migrate-new-user-eligibility'") || usersPage.includes('fetch("/api/admin/migrate-new-user-eligibility"')) {
  failures.push('后台用户页不应继续调用 /api/admin/migrate-new-user-eligibility');
}
mustContain(server, 'api.Get("/admin/alerts", adminDashboardHandlers.listAlerts)', 'Go 后台告警列表路由', failures);
mustContain(server, 'api.Post("/admin/alerts/{id}/resolve", adminDashboardHandlers.resolveAlert)', 'Go 后台告警处理路由', failures);
mustContain(server, 'api.Post("/admin/sync-users", adminUserHandlers.legacyToolDisabled)', 'Go 旧同步用户工具墓碑路由', failures);
mustContain(server, 'api.Post("/admin/fix-codes-count", adminUserHandlers.legacyToolDisabled)', 'Go 旧修复兑换码统计工具墓碑路由', failures);
mustContain(server, 'api.Post("/admin/migrate-native-hot-data", adminUserHandlers.legacyToolDisabled)', 'Go 旧热数据迁移工具墓碑路由', failures);
mustContain(server, 'api.Post("/admin/migrate-new-user-eligibility", adminUserHandlers.legacyToolDisabled)', 'Go 旧新人资格迁移工具墓碑路由', failures);
mustContain(adminUserHandler, 'func (handlers adminUserHandlers) legacyToolDisabled', 'Go 旧后台工具墓碑 handler', failures);
mustContain(adminUserHandler, 'ADMIN_LEGACY_TOOL_DISABLED', 'Go 旧后台工具墓碑错误码', failures);
mustContain(adminUserHandler, 'rejectUntrustedUnsafeRequest', 'Go 旧后台工具同源校验', failures);
mustContain(dashboardHandler, 'func (handlers adminDashboardHandlers) resolveAlert', 'Go 后台告警处理 handler', failures);
mustContain(dashboardHandler, 'rejectUntrustedUnsafeRequest', 'Go 后台告警处理同源校验', failures);
mustContain(dashboardService, 'func (service *Service) ResolveAlert', 'Go 后台告警处理 service', failures);
mustContain(dashboardService, 'admin_alerts', 'Go 后台仪表盘读取 PostgreSQL 告警', failures);
mustContain(alertsMigration, 'CREATE TABLE IF NOT EXISTS admin_alerts', '后台告警 PostgreSQL migration', failures);
mustContain(alertsMigration, 'CREATE TABLE IF NOT EXISTS admin_alert_point_baselines', '后台告警基线 PostgreSQL migration', failures);
mustContain(gateway, 'handle /api/admin/alerts {', 'Gateway 后台告警列表精确切流', failures);
mustContain(gateway, 'handle /api/admin/alerts/* {', 'Gateway 后台告警处理精确切流', failures);

const activeGatewayLines = gateway
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));
for (const route of migrationToolRoutes) {
  const handle = `handle ${route} {`;
  if (!activeGatewayLines.includes(handle)) {
    failures.push(`旧后台工具必须被 Gateway 精确接到 Go 墓碑，避免回落 Next/KV：${route}`);
  }
}

if (activeGatewayLines.some((line) => line.startsWith('handle /api/admin/*') || line.startsWith('handle /api/admin*'))) {
  failures.push('Gateway 禁止打开 /api/admin* 通配');
}

if (failures.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'admin-tools-cutover-audit',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'admin-tools-cutover-audit',
  status: 'b6-admin-tools-tombstoned',
  productionValueRoutes,
  migrationToolRoutes,
  decision: {
    config: 'migrated-to-go-postgres',
    alertsResolve: 'migrated-to-go-postgres-admin-alerts',
    syncUsers: 'disabled-ui-and-go-tombstone',
    fixCodesCount: 'go-tombstone-cli-only-if-needed',
    migrateNativeHotData: 'go-tombstone-cli-only-if-needed',
    migrateNewUserEligibility: 'disabled-ui-and-go-tombstone',
  },
}, null, 2));
