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
const handler = read('backend/internal/httpserver/admin_config_handlers.go');
const service = read('backend/internal/systemconfig/service.go');
const migration = read('backend/migrations/0025_system_config.sql');
const gateway = read('gateway/Caddyfile');

const gameFiles = [
  'backend/internal/memory/service.go',
  'backend/internal/match3/service.go',
  'backend/internal/whackmole/service.go',
  'backend/internal/minesweeper/service.go',
  'backend/internal/linkgame/service.go',
  'backend/internal/roguelite/service.go',
  'backend/internal/game2048/service.go',
  'backend/internal/gamesummary/service.go',
  'backend/internal/economy/service.go',
];

const failures = [];
mustContain(server, 'api.Get("/admin/config", adminConfigHandlers.get)', 'Go admin config GET 路由', failures);
mustContain(server, 'api.Put("/admin/config", adminConfigHandlers.update)', 'Go admin config PUT 路由', failures);
mustContain(handler, 'func (handlers adminConfigHandlers) get', 'Go admin config handler', failures);
mustContain(handler, 'func (handlers adminConfigHandlers) update', 'Go admin config handler', failures);
mustContain(handler, 'rejectUntrustedUnsafeRequest', 'Go admin config 同源校验', failures);
mustContain(service, 'func DailyPointsLimit', '系统配置每日积分上限读取 helper', failures);
mustContain(migration, 'CREATE TABLE IF NOT EXISTS system_config', '系统配置 PostgreSQL migration', failures);
mustContain(migration, 'daily_points_limit', '系统配置 PostgreSQL migration', failures);
mustContain(gateway, 'handle /api/admin/config {', 'Gateway 精确切流', failures);

for (const file of gameFiles) {
  const source = read(file);
  if (source.includes('economy.DailyPointsLimit')) {
    failures.push(`${file} 仍在读取旧常量 economy.DailyPointsLimit`);
  }
  if (!source.includes('systemconfig.DailyPointsLimit')) {
    failures.push(`${file} 未读取 PostgreSQL systemconfig.DailyPointsLimit`);
  }
}

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
    mode: 'admin-config-cutover-audit',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'admin-config-cutover-audit',
  status: 'admin-config-exact-cutover-ready',
  gatewayRules: ['/api/admin/config'],
  postgresSources: ['system_config'],
  dynamicDailyLimitConsumers: gameFiles,
}, null, 2));
