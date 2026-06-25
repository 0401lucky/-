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

const gatewaySource = read('gateway/Caddyfile');
const activeLotteryGatewayRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => !entry.line.startsWith('#'))
  .filter((entry) => /^handle(?:_path)?\s+\/api\/(?:admin\/)?lottery(?:\s|\/|\*|\{)/.test(entry.line));
if (activeLotteryGatewayRules.length > 0) {
  fail('lottery Gateway rules must stay closed until Go migration and smoke are complete', activeLotteryGatewayRules.map((entry) => `gateway/Caddyfile:${entry.lineNumber} ${entry.line}`));
}

if (!existsSync(path.join(repoRoot, 'docs/lottery-cutover-preflight.md'))) {
  fail('lottery cutover preflight doc is missing', ['docs/lottery-cutover-preflight.md']);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'lottery-cutover-audit',
  status: 'not-cutover',
  frontendLotteryPaths: expectedFrontendLotteryPaths,
  adminLotteryPaths: expectedAdminLotteryPaths,
  rankingLotteryPaths: expectedRankingLotteryPaths,
  legacyRouteFiles,
  legacyKvMarkers: requiredLegacyKvMarkers,
  gatewayLotteryRules: 'closed',
}, null, 2));
