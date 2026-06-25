import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedFrontendLotteryPaths = [
  '/api/lottery',
  '/api/lottery/spin',
  '/api/lottery/number-bomb',
  '/api/lottery/number-bomb/bet',
  '/api/lottery/number-bomb/cancel',
];

const expectedAdminLotteryPaths = [
  '/api/admin/lottery',
  '/api/admin/lottery/config',
  '/api/admin/lottery/number-bomb',
];

const expectedRankingLotteryPaths = [
  '/api/rankings/lottery',
];

const legacyRouteFiles = [
  'src/app/api/lottery/route.ts',
  'src/app/api/lottery/spin/route.ts',
  'src/app/api/lottery/records/route.ts',
  'src/app/api/lottery/ranking/route.ts',
  'src/app/api/lottery/number-bomb/route.ts',
  'src/app/api/lottery/number-bomb/bet/route.ts',
  'src/app/api/lottery/number-bomb/cancel/route.ts',
  'src/app/api/admin/lottery/route.ts',
  'src/app/api/admin/lottery/config/route.ts',
  'src/app/api/admin/lottery/number-bomb/route.ts',
  'src/app/api/admin/lottery/debug/route.ts',
  'src/app/api/admin/lottery/recalculate/route.ts',
  'src/app/api/admin/lottery/reset/route.ts',
  'src/app/api/admin/lottery/tiers/[tier]/codes/route.ts',
  'src/app/api/admin/lottery/tiers/[tier]/detail/route.ts',
];

const requiredLegacyKvMarkers = [
  'lottery:config',
  'lottery:records',
  'lottery:user:records:',
  'lottery:daily_spin:',
  'number-bomb:draw:',
  'number-bomb:bet:',
  'number-bomb:settlement:',
];

const requiredB41Files = [
  'backend/migrations/0022_lottery.sql',
  'backend/migrations/0023_number_bomb.sql',
  'backend/internal/lottery/types.go',
  'backend/internal/lottery/service.go',
  'backend/internal/lottery/number_bomb.go',
  'backend/internal/lottery/service_integration_test.go',
  'backend/internal/httpserver/lottery_handlers.go',
  'backend/internal/httpserver/lottery_handlers_integration_test.go',
];

const requiredB41MigrationMarkers = [
  'CREATE TABLE IF NOT EXISTS lottery_configs',
  'CREATE TABLE IF NOT EXISTS lottery_tiers',
  'CREATE TABLE IF NOT EXISTS lottery_records',
  'CREATE TABLE IF NOT EXISTS lottery_daily_spins',
  'CREATE TABLE IF NOT EXISTS number_bomb_draws',
  'CREATE TABLE IF NOT EXISTS number_bomb_bets',
];

const requiredB41ServerRoutes = [
  'api.Get("/lottery", lotteryHandlers.page)',
  'api.Get("/admin/lottery", lotteryHandlers.admin)',
];

const requiredB42ServiceMarkers = [
  'func (service *Service) SpinPoints',
  'func consumeSpinCount',
  'func insertLotteryRecord',
  'func insertLotteryGameRecord',
  'func insertLotteryNotification',
];

const requiredB42ServerRoutes = [
  'api.Post("/lottery/spin", lotteryHandlers.spin)',
];

const requiredB43ServiceMarkers = [
  'func (service *Service) UpdateConfig',
  'func mergeTierUpdates',
  'type ValidationError struct',
];

const requiredB43ServerRoutes = [
  'api.Patch("/admin/lottery/config", lotteryHandlers.updateAdminConfig)',
];

const requiredB44ServiceMarkers = [
  'func (service *Service) NumberBombState',
  'func (service *Service) PlaceNumberBombBet',
  'func (service *Service) CancelNumberBombBet',
  'func (service *Service) NumberBombAdminSnapshot',
];

const requiredB44ServerRoutes = [
  'api.Get("/lottery/number-bomb", lotteryHandlers.numberBombState)',
  'api.Post("/lottery/number-bomb/bet", lotteryHandlers.numberBombBet)',
  'api.Post("/lottery/number-bomb/cancel", lotteryHandlers.numberBombCancel)',
  'api.Get("/admin/lottery/number-bomb", lotteryHandlers.adminNumberBomb)',
];

const requiredB45ServiceMarkers = [
  'func (service *Service) SettleNumberBombDate',
  'func settleNumberBombBet',
  'number_bomb_reward',
  '数字炸弹开奖通知',
];

const requiredB45WorkerMarkers = [
  'lottery.NewService(runner.deps.DB).SettleNumberBombDate(ctx, "")',
  '数字炸弹结算完成',
];

const requiredB46ServiceMarkers = [
  'func (service *Service) LotteryRanking',
  'func (service *Service) LotteryDailyRanking',
  'func (service *Service) lotteryRankingRows',
];

const requiredB46ServerRoutes = [
  'api.Get("/lottery/records", lotteryHandlers.records)',
  'api.Get("/lottery/ranking", lotteryHandlers.dailyRanking)',
  'api.Get("/rankings/lottery", lotteryHandlers.periodRanking)',
];

const requiredB47ServerRoutes = [
  'api.Get("/admin/lottery/debug", lotteryHandlers.adminLegacyToolDisabled)',
  'api.Post("/admin/lottery/recalculate", lotteryHandlers.adminLegacyToolDisabled)',
  'api.Post("/admin/lottery/reset", lotteryHandlers.adminLegacyToolDisabled)',
  'api.Get("/admin/lottery/tiers/{tier}/codes", lotteryHandlers.adminLegacyToolDisabled)',
  'api.Post("/admin/lottery/tiers/{tier}/codes", lotteryHandlers.adminLegacyToolDisabled)',
  'api.Delete("/admin/lottery/tiers/{tier}/codes", lotteryHandlers.adminLegacyToolDisabled)',
  'api.Get("/admin/lottery/tiers/{tier}/detail", lotteryHandlers.adminLegacyToolDisabled)',
];

const expectedLotteryGatewayRules = [
  '/api/lottery',
  '/api/lottery/spin',
  '/api/lottery/records',
  '/api/lottery/ranking',
  '/api/lottery/number-bomb',
  '/api/lottery/number-bomb/bet',
  '/api/lottery/number-bomb/cancel',
  '/api/rankings/lottery',
  '/api/admin/lottery',
  '/api/admin/lottery/config',
  '/api/admin/lottery/number-bomb',
  '/api/admin/lottery/debug',
  '/api/admin/lottery/recalculate',
  '/api/admin/lottery/reset',
  '/api/admin/lottery/tiers/*',
];

const forbiddenB44ServerRoutes = [
  'api.Post("/internal/number-bomb/settle"',
];

function fail(message, details = []) {
  console.error(`lottery cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function walkFiles(root, files = []) {
  if (!existsSync(root)) {
    return files;
  }
  const stat = statSync(root);
  if (stat.isFile()) {
    if (/\.(tsx?|jsx?)$/.test(root)) {
      files.push(root);
    }
    return files;
  }
  for (const entry of readdirSync(root)) {
    walkFiles(path.join(root, entry), files);
  }
  return files;
}

function discoverApiPaths(roots, pattern) {
  const discovered = new Set();
  for (const file of roots.flatMap((root) => walkFiles(path.join(repoRoot, root)))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      discovered.add(match[1]);
    }
  }
  return discovered;
}

const frontendLotteryPaths = discoverApiPaths(
  ['src/app/lottery'],
  /['"`](\/api\/lottery(?:\/[^'"`?#]+)?)(?:[?#][^'"`]*)?['"`]/g,
);
const adminLotteryPaths = discoverApiPaths(
  ['src/app/admin/lottery'],
  /['"`](\/api\/admin\/lottery(?:\/[^'"`?#]+)?)(?:[?#][^'"`]*)?['"`]/g,
);
const rankingLotteryPaths = discoverApiPaths(
  ['src/app/rankings'],
  /['"`](\/api\/rankings\/lottery)(?:[?#][^'"`]*)?['"`]/g,
);

for (const [label, expected, actual] of [
  ['frontend lottery', expectedFrontendLotteryPaths, frontendLotteryPaths],
  ['admin lottery', expectedAdminLotteryPaths, adminLotteryPaths],
  ['ranking lottery', expectedRankingLotteryPaths, rankingLotteryPaths],
]) {
  const missing = expected.filter((apiPath) => !actual.has(apiPath));
  const unexpected = [...actual].filter((apiPath) => !expected.includes(apiPath));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(`${label} API dependencies changed`, [
      ...missing.map((apiPath) => `missing ${apiPath}`),
      ...unexpected.map((apiPath) => `unexpected ${apiPath}`),
    ]);
  }
}

const missingRouteFiles = legacyRouteFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingRouteFiles.length > 0) {
  fail('legacy lottery route files changed before Go migration was updated', missingRouteFiles);
}

const legacySource = [
  read('src/lib/lottery.ts'),
  read('src/lib/number-bomb.ts'),
].join('\n');
const missingKvMarkers = requiredLegacyKvMarkers.filter((marker) => !legacySource.includes(marker));
if (missingKvMarkers.length > 0) {
  fail('legacy lottery KV markers changed; update the Go migration plan first', missingKvMarkers);
}

const missingB41Files = requiredB41Files.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingB41Files.length > 0) {
  fail('B4-1 lottery Go read-only files are missing', missingB41Files);
}

const lotteryMigrationSource = [
  read('backend/migrations/0022_lottery.sql'),
  read('backend/migrations/0023_number_bomb.sql'),
].join('\n');
const missingMigrationMarkers = requiredB41MigrationMarkers.filter((marker) => !lotteryMigrationSource.includes(marker));
if (missingMigrationMarkers.length > 0) {
  fail('B4-1 lottery migration lost required tables', missingMigrationMarkers);
}

const lotteryServiceSource = read('backend/internal/lottery/service.go');
const missingServiceMarkers = [
  'func (service *Service) PagePayload',
  'func (service *Service) AdminSnapshot',
  'func (service *Service) TodayDirectTotal',
].filter((marker) => !lotteryServiceSource.includes(marker));
if (missingServiceMarkers.length > 0) {
  fail('B4-1 lottery service lost required read-only methods', missingServiceMarkers);
}

const serverSource = read('backend/internal/httpserver/server.go');
const missingServerRoutes = requiredB41ServerRoutes.filter((route) => !serverSource.includes(route));
if (missingServerRoutes.length > 0) {
  fail('B4-1 lottery read-only routes are not registered in Go server', missingServerRoutes);
}
const missingB42ServiceMarkers = requiredB42ServiceMarkers.filter((marker) => !lotteryServiceSource.includes(marker));
if (missingB42ServiceMarkers.length > 0) {
  fail('B4-2 lottery spin service lost required transactional methods', missingB42ServiceMarkers);
}
const missingB42ServerRoutes = requiredB42ServerRoutes.filter((route) => !serverSource.includes(route));
if (missingB42ServerRoutes.length > 0) {
  fail('B4-2 lottery spin route is not registered in Go server', missingB42ServerRoutes);
}
const missingB43ServiceMarkers = requiredB43ServiceMarkers.filter((marker) => !lotteryServiceSource.includes(marker));
if (missingB43ServiceMarkers.length > 0) {
  fail('B4-3 lottery admin config service lost required methods', missingB43ServiceMarkers);
}
const missingB43ServerRoutes = requiredB43ServerRoutes.filter((route) => !serverSource.includes(route));
if (missingB43ServerRoutes.length > 0) {
  fail('B4-3 lottery admin config route is not registered in Go server', missingB43ServerRoutes);
}
const numberBombServiceSource = read('backend/internal/lottery/number_bomb.go');
const missingB44ServiceMarkers = requiredB44ServiceMarkers.filter((marker) => !numberBombServiceSource.includes(marker));
if (missingB44ServiceMarkers.length > 0) {
  fail('B4-4 number bomb service lost required methods', missingB44ServiceMarkers);
}
const missingB45ServiceMarkers = requiredB45ServiceMarkers.filter((marker) => !numberBombServiceSource.includes(marker));
if (missingB45ServiceMarkers.length > 0) {
  fail('B4-5 number bomb settlement service lost required methods', missingB45ServiceMarkers);
}
const missingB44ServerRoutes = requiredB44ServerRoutes.filter((route) => !serverSource.includes(route));
if (missingB44ServerRoutes.length > 0) {
  fail('B4-4 number bomb routes are not registered in Go server', missingB44ServerRoutes);
}
const unexpectedServerRoutes = forbiddenB44ServerRoutes.filter((route) => serverSource.includes(route));
if (unexpectedServerRoutes.length > 0) {
  fail('B4-4 must not register settlement worker or lottery ranking routes yet', unexpectedServerRoutes);
}
const workerSource = read('backend/internal/worker/worker.go');
const missingB45WorkerMarkers = requiredB45WorkerMarkers.filter((marker) => !workerSource.includes(marker));
if (missingB45WorkerMarkers.length > 0) {
  fail('B4-5 number bomb worker settlement is not wired', missingB45WorkerMarkers);
}
if (workerSource.includes('后台任务占位：数字炸弹结算等待迁移')) {
  fail('B4-5 number bomb worker still contains placeholder task');
}
const rankingSource = read('backend/internal/lottery/ranking.go');
const missingB46ServiceMarkers = requiredB46ServiceMarkers.filter((marker) => !rankingSource.includes(marker));
if (missingB46ServiceMarkers.length > 0) {
  fail('B4-6 lottery ranking service lost required methods', missingB46ServiceMarkers);
}
const missingB46ServerRoutes = requiredB46ServerRoutes.filter((route) => !serverSource.includes(route));
if (missingB46ServerRoutes.length > 0) {
  fail('B4-6 lottery ranking routes are not registered in Go server', missingB46ServerRoutes);
}
const missingB47ServerRoutes = requiredB47ServerRoutes.filter((route) => !serverSource.includes(route));
if (missingB47ServerRoutes.length > 0) {
  fail('B4-7 legacy admin lottery tombstone routes are not registered in Go server', missingB47ServerRoutes);
}
const lotteryHandlerSource = read('backend/internal/httpserver/lottery_handlers.go');
if (!lotteryHandlerSource.includes('func (handlers lotteryHandlers) adminLegacyToolDisabled') || !lotteryHandlerSource.includes('旧彩票兑换码工具已停用')) {
  fail('B4-7 legacy admin lottery tombstone handler is missing');
}

const gatewaySource = read('gateway/Caddyfile');
const activeLotteryGatewayRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => !entry.line.startsWith('#'))
  .filter((entry) => /^handle(?:_path)?\s+\/api\/(?:(?:admin\/)?lottery|rankings\/lottery)(?:\s|\/|\*|\{)/.test(entry.line))
  .map((entry) => {
    const match = entry.line.match(/^handle(?:_path)?\s+([^\s{]+)/);
    return { ...entry, path: match?.[1] ?? '' };
  });
const activeLotteryGatewayPaths = activeLotteryGatewayRules.map((entry) => entry.path);
const missingGatewayRules = expectedLotteryGatewayRules.filter((route) => !activeLotteryGatewayPaths.includes(route));
const unexpectedGatewayRules = activeLotteryGatewayRules
  .filter((entry) => !expectedLotteryGatewayRules.includes(entry.path))
  .map((entry) => `gateway/Caddyfile:${entry.lineNumber} ${entry.line}`);
if (missingGatewayRules.length > 0 || unexpectedGatewayRules.length > 0) {
  fail('lottery Gateway rules must stay exact after B4 cutover', [
    ...missingGatewayRules.map((route) => `missing ${route}`),
    ...unexpectedGatewayRules.map((line) => `unexpected ${line}`),
  ]);
}
const forbiddenLotteryGatewayRules = activeLotteryGatewayRules
  .filter((entry) => entry.line.startsWith('handle_path') || entry.path === '/api/lottery/*' || entry.path === '/api/admin/lottery/*' || entry.path === '/api/lottery*' || entry.path === '/api/admin/lottery*');
if (forbiddenLotteryGatewayRules.length > 0) {
  fail('lottery Gateway must not use wildcard or handle_path cutovers', forbiddenLotteryGatewayRules.map((entry) => `gateway/Caddyfile:${entry.lineNumber} ${entry.line}`));
}

if (!existsSync(path.join(repoRoot, 'docs/lottery-cutover-preflight.md'))) {
  fail('lottery cutover preflight doc is missing', ['docs/lottery-cutover-preflight.md']);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'lottery-cutover-audit',
  status: 'lottery-exact-cutover-ready',
  frontendLotteryPaths: expectedFrontendLotteryPaths,
  adminLotteryPaths: expectedAdminLotteryPaths,
  rankingLotteryPaths: expectedRankingLotteryPaths,
  goReadOnlyRoutes: requiredB41ServerRoutes,
  goSpinRoute: requiredB42ServerRoutes,
  goSpinTransactionalMarkers: requiredB42ServiceMarkers,
  goAdminConfigRoute: requiredB43ServerRoutes,
  goAdminConfigMarkers: requiredB43ServiceMarkers,
  goNumberBombRoutes: requiredB44ServerRoutes,
  goNumberBombMarkers: requiredB44ServiceMarkers,
  goNumberBombSettlementMarkers: requiredB45ServiceMarkers,
  goNumberBombWorkerMarkers: requiredB45WorkerMarkers,
  goLotteryRankingRoutes: requiredB46ServerRoutes,
  goLotteryRankingMarkers: requiredB46ServiceMarkers,
  goLegacyAdminLotteryTombstoneRoutes: requiredB47ServerRoutes,
  goTables: requiredB41MigrationMarkers.map((marker) => marker.replace('CREATE TABLE IF NOT EXISTS ', '')),
  legacyRouteFiles,
  legacyKvMarkers: requiredLegacyKvMarkers,
  gatewayLotteryRules: expectedLotteryGatewayRules,
}, null, 2));
