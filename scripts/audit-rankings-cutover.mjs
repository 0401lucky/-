import { existsSync, readFileSync } from 'node:fs';
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
const handlers = read('backend/internal/httpserver/ranking_handlers.go');
const service = read('backend/internal/rankings/service.go');
const settlementService = read('backend/internal/rankings/settlement.go');
const gateway = read('gateway/Caddyfile');

const expectedRoutes = [
  'api.Get("/rankings/points", rankingHandlers.points)',
  'api.Get("/rankings/games", rankingHandlers.games)',
  'api.Get("/rankings/checkin-streak", rankingHandlers.checkinStreak)',
  'api.Get("/rankings/history", rankingHandlers.history)',
  'api.Post("/admin/rankings/settle", rankingHandlers.settle)',
];

const gatewayRules = [
  '/api/rankings/points',
  '/api/rankings/games',
  '/api/rankings/checkin-streak',
  '/api/rankings/history',
  '/api/admin/rankings/settle',
];

const legacyRouteFiles = [
  'src/app/api/rankings/points/route.ts',
  'src/app/api/rankings/games/route.ts',
  'src/app/api/rankings/checkin-streak/route.ts',
  'src/app/api/rankings/history/route.ts',
];

const failures = [];
for (const route of expectedRoutes) {
  mustContain(server, route, 'Go HTTP 路由', failures);
}
for (const rule of gatewayRules) {
  mustContain(gateway, `handle ${rule} {`, 'Gateway 精确切流', failures);
}

mustContain(handlers, 'func (handlers rankingHandlers) points', 'Go 排行榜 handler', failures);
mustContain(handlers, 'func (handlers rankingHandlers) games', 'Go 排行榜 handler', failures);
mustContain(handlers, 'func (handlers rankingHandlers) checkinStreak', 'Go 排行榜 handler', failures);
mustContain(handlers, 'func (handlers rankingHandlers) history', 'Go 排行榜 handler', failures);
mustContain(handlers, 'func (handlers rankingHandlers) settle', 'Go 排行榜 handler', failures);
mustContain(handlers, 'rejectUntrustedUnsafeRequest', '后台排行榜结算同源校验', failures);
mustContain(handlers, 'rankingsSettleRateLimit', '后台排行榜结算限流', failures);
mustContain(service, 'func (service *Service) PointsLeaderboard', 'Go 排行榜服务', failures);
mustContain(service, 'func (service *Service) AllGamesLeaderboard', 'Go 排行榜服务', failures);
mustContain(service, 'func (service *Service) CheckinStreakLeaderboard', 'Go 排行榜服务', failures);
mustContain(service, 'func (service *Service) MonthlyPeakHistory', 'Go 排行榜服务', failures);
mustContain(service, 'func (service *Service) SettlementHistory', 'Go 排行榜服务', failures);
mustContain(service, 'point_accounts', '积分榜 PostgreSQL 数据源', failures);
mustContain(service, 'point_ledger', '月积分榜 PostgreSQL 数据源', failures);
mustContain(service, 'game_records', '游戏榜 PostgreSQL 数据源', failures);
mustContain(service, 'checkin_records', '签到榜 PostgreSQL 数据源', failures);
mustContain(service, 'ranking_settlements', '排行榜结算历史 PostgreSQL 数据源', failures);
mustContain(settlementService, 'func (service *Service) SettleRankingPeriod', 'Go 排行榜结算服务', failures);
mustContain(settlementService, 'ranking_reward_claims', '排行榜结算派奖幂等表', failures);
mustContain(settlementService, 'point_ledger', '排行榜结算积分账本', failures);
mustContain(settlementService, 'notifications', '排行榜结算通知', failures);
mustContain(settlementService, 'peak_first', '排行榜结算月榜第一成就', failures);

const missingLegacyRouteFiles = legacyRouteFiles.filter((file) => !existsSync(path.join(repoRoot, file)));
const legacyRouteStatus = missingLegacyRouteFiles.length === legacyRouteFiles.length
  ? 'physically-deleted'
  : missingLegacyRouteFiles.length === 0
    ? 'present'
    : 'partially-deleted';
if (legacyRouteStatus === 'partially-deleted') {
  failures.push(`旧 Next 排行榜路由只删除了一部分：${missingLegacyRouteFiles.join(', ')}`);
}
if (legacyRouteStatus === 'present') {
  for (const file of legacyRouteFiles) {
    const source = read(file);
    mustContain(source, 'buildKvUnavailablePayload', `旧 Next 路由 ${file}`, failures);
  }
}

const forbiddenGatewayMarkers = [
  'handle /api/rankings/*',
  'handle /api/rankings*',
  'handle_path /api/rankings',
];
const activeGatewayLines = gateway
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));
const forbiddenActive = forbiddenGatewayMarkers.filter((marker) =>
  activeGatewayLines.some((line) => line.startsWith(marker)),
);

if (forbiddenActive.length > 0) {
  failures.push(`Gateway 禁止排行榜通配仍处于启用状态：${forbiddenActive.join(', ')}`);
}

if (failures.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'rankings-cutover-audit',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'rankings-cutover-audit',
  status: 'rankings-readonly-exact-cutover-ready',
  settlementStatus: 'admin-ranking-settlement-exact-cutover-ready',
  goRoutes: expectedRoutes,
  gatewayRules,
  legacyRouteFiles,
  legacyRouteStatus,
  postgresSources: [
    'point_accounts',
    'point_ledger',
    'game_records',
    'checkin_records',
    'ranking_settlements',
    'ranking_reward_claims',
    'user_profiles',
    'user_equipped_achievements',
  ],
}, null, 2));
