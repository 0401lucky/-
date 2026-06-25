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

const server = read('backend/internal/httpserver/server.go');
const handler = read('backend/internal/httpserver/admin_dashboard_handlers.go');
const service = read('backend/internal/admindashboard/service.go');
const types = read('backend/internal/admindashboard/types.go');
const migration = read('backend/migrations/0026_admin_alerts.sql');
const gateway = read('gateway/Caddyfile');
const dashboardPage = read('src/app/admin/dashboard/page.tsx');

const failures = [];

mustContain(server, 'api.Get("/admin/dashboard", adminDashboardHandlers.get)', 'Go 仪表盘路由', failures);
mustContain(server, 'api.Get("/admin/alerts", adminDashboardHandlers.listAlerts)', 'Go 告警列表路由', failures);
mustContain(server, 'api.Post("/admin/alerts/{id}/resolve", adminDashboardHandlers.resolveAlert)', 'Go 告警处理路由', failures);
mustContain(handler, 'func (handlers adminDashboardHandlers) listAlerts', 'Go 告警列表 handler', failures);
mustContain(handler, 'func (handlers adminDashboardHandlers) resolveAlert', 'Go 告警处理 handler', failures);
mustContain(handler, 'rejectUntrustedUnsafeRequest', 'Go 告警处理同源校验', failures);
mustContain(handler, 'adminAlertsRateLimit', 'Go 告警接口限流', failures);
mustContain(service, 'func (service *Service) GetAlerts', 'Go 告警列表 service', failures);
mustContain(service, 'func (service *Service) ResolveAlert', 'Go 告警处理 service', failures);
mustContain(service, 'func (service *Service) runAnomalyDetection', 'Go 告警检测 service', failures);
mustContain(service, 'admin_alerts', 'Go 告警 PostgreSQL 读写', failures);
mustContain(service, 'admin_alert_point_baselines', 'Go 告警积分基线', failures);
mustContain(types, 'type AlertsSnapshot struct', 'Go 告警响应类型', failures);
mustContain(migration, 'CREATE TABLE IF NOT EXISTS admin_alerts', '后台告警 migration', failures);
mustContain(migration, 'source_key TEXT UNIQUE', '后台告警单日去重键', failures);
mustContain(migration, 'CREATE TABLE IF NOT EXISTS admin_alert_point_baselines', '后台告警积分基线 migration', failures);
mustContain(gateway, 'handle /api/admin/alerts {', 'Gateway 告警列表精确切流', failures);
mustContain(gateway, 'handle /api/admin/alerts/* {', 'Gateway 告警处理精确切流', failures);
mustContain(dashboardPage, 'fetch(`/api/admin/alerts/${id}/resolve`', '后台仪表盘告警处理调用', failures);

const activeGatewayLines = gateway
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));
if (activeGatewayLines.some((line) => line.startsWith('handle /api/admin/*') || line.startsWith('handle /api/admin*'))) {
  failures.push('Gateway 禁止打开 /api/admin* 通配');
}

if (failures.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'admin-alerts-cutover-audit',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'admin-alerts-cutover-audit',
  status: 'admin-alerts-exact-cutover-ready',
  gatewayRules: ['/api/admin/alerts', '/api/admin/alerts/*'],
  postgresSources: ['admin_alerts', 'admin_alert_point_baselines'],
}, null, 2));
