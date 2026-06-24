import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedNotificationApiPaths = [
  '/api/notifications',
  '/api/notifications/unread-count',
  '/api/notifications/read',
  '/api/notifications/claim',
  '/api/notifications/delete',
];

const requiredGoRouteSnippets = [
  'api.Get("/notifications", notificationHandlers.list)',
  'api.Get("/notifications/unread-count", notificationHandlers.getUnreadCount)',
  'api.Post("/notifications/read", notificationHandlers.markRead)',
  'api.Post("/notifications/delete", notificationHandlers.delete)',
  'api.Post("/notifications/claim", notificationHandlers.claim)',
];

const requiredNotificationsSmokeFiles = [
  'scripts/smoke-notifications-go-api.mjs',
  'scripts/smoke-notifications-write-go-api.mjs',
];

const requiredNotificationsSmokeSnippets = [
  'NOTIFICATIONS_GO_API_COOKIE',
  'NOTIFICATIONS_WRITE_SMOKE_USER_ID',
  'docker-compose-exec-api',
  'docker-compose-exec-api-and-postgres',
  'checkedUnauthenticatedPaths',
  'checkedAuthenticatedPaths',
  '/api/notifications?page=1&limit=5',
  '/api/notifications/unread-count',
  '/api/notifications/read',
  '/api/notifications/delete',
  '/api/notifications/claim',
  'verifyCleanup',
  'gatewayNotificationRules',
];

const requiredNotificationsJSONFields = [
  'items',
  'unreadCount',
  'pagination',
  'counts',
  'id',
  'userId',
  'type',
  'title',
  'content',
  'data',
  'createdAt',
  'readAt',
  'isRead',
  'page',
  'limit',
  'total',
  'totalPages',
  'hasMore',
  'all',
  'unread',
  'prize',
  'reply',
  'system',
  'redeem',
  'updated',
  'deleted',
];

const requiredRewardJSONFields = [
  'success',
  'message',
  'claimStatus',
];

const requiredImportScopes = [
  'notifications',
  'reward-claims',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'notifications'),
  path.join(repoRoot, 'src', 'components'),
  path.join(repoRoot, 'src', 'app', 'page.tsx'),
];

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
    const fullPath = path.join(root, entry);
    const entryStat = statSync(fullPath);
    if (entryStat.isDirectory()) {
      walkFiles(fullPath, files);
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizeSlash(value) {
  return value.split(path.sep).join('/');
}

function fail(message, details = []) {
  console.error(`notifications cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const notificationPathPattern = /['"`](\/api\/notifications(?:\/[^'"`?#]+)?)(?:[?#][^'"`]*)?['"`]/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(notificationPathPattern)) {
    const apiPath = match[1];
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedSet = new Set(expectedNotificationApiPaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedNotificationApiPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedSet.has(apiPath));

if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend notification API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected frontend path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => {
      const locations = discovered.get(apiPath).join(', ');
      return `unexpected frontend path ${apiPath} in ${locations}`;
    }),
  ]);
}

const serverSource = read('backend/internal/httpserver/server.go');
const missingGoRoutes = requiredGoRouteSnippets.filter((snippet) => !serverSource.includes(snippet));
if (missingGoRoutes.length > 0) {
  fail('Go notification routes are incomplete', missingGoRoutes);
}

const notificationsSource = read('backend/internal/notifications/service.go');
const rewardsSource = read('backend/internal/rewards/service.go');
const notificationTags = new Set(
  [...notificationsSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]),
);
const rewardTags = new Set(
  [...rewardsSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]),
);
const missingNotificationFields = requiredNotificationsJSONFields.filter((field) => !notificationTags.has(field));
const missingRewardFields = requiredRewardJSONFields.filter((field) => !rewardTags.has(field));

if (missingNotificationFields.length > 0 || missingRewardFields.length > 0) {
  fail('Go notification response JSON fields are incomplete', [
    ...missingNotificationFields.map((field) => `notifications.${field}`),
    ...missingRewardFields.map((field) => `rewards.${field}`),
  ]);
}

const notificationHandlerSource = read('backend/internal/httpserver/notification_handlers.go');
const requiredHandlerSnippets = [
  '"claimStatus": result.ClaimStatus',
  '"标记已读成功"',
  '"通知已删除"',
  '"缺少通知 ID"',
  '"通知不存在"',
  '"无权操作此通知"',
  '"此通知不是奖励通知"',
  '"通知数据无效"',
];
const missingHandlerSnippets = requiredHandlerSnippets.filter((snippet) => !notificationHandlerSource.includes(snippet));
if (missingHandlerSnippets.length > 0) {
  fail('Go notification handler compatibility snippets are missing', missingHandlerSnippets);
}

const migrateD1Source = read('backend/cmd/migrate-d1/main.go');
const missingImportScopes = requiredImportScopes.filter((scope) => !migrateD1Source.includes(`"${scope}"`));
if (missingImportScopes.length > 0) {
  fail('D1 import scopes are incomplete', missingImportScopes);
}

const requiredMigrationFiles = [
  'backend/migrations/0007_notifications.sql',
  'backend/migrations/0014_reward_claims.sql',
];
const missingMigrationFiles = requiredMigrationFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingMigrationFiles.length > 0) {
  fail('required PostgreSQL migration files are missing', missingMigrationFiles);
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewayNotificationRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line.includes('/api/notifications') && !entry.line.startsWith('#'));

if (activeGatewayNotificationRules.length > 0) {
  fail(
    'Gateway already contains active notification routing rules; review before declaring this a pre-cutover state',
    activeGatewayNotificationRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`),
  );
}

const missingNotificationsSmokeFiles = requiredNotificationsSmokeFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingNotificationsSmokeFiles.length > 0) {
  fail('notifications direct API smoke files are missing', missingNotificationsSmokeFiles);
}
const notificationsSmokeSource = requiredNotificationsSmokeFiles
  .map((relativePath) => read(relativePath))
  .join('\n');
const missingNotificationsSmokeSnippets = requiredNotificationsSmokeSnippets.filter((snippet) => !notificationsSmokeSource.includes(snippet));
if (missingNotificationsSmokeSnippets.length > 0) {
  fail('notifications direct API smoke script is incomplete', missingNotificationsSmokeSnippets);
}

const summary = {
  frontendNotificationApiPaths: expectedNotificationApiPaths,
  frontendLocations: Object.fromEntries([...discovered.entries()]),
  goRoutes: requiredGoRouteSnippets,
  goNotificationJSONFields: requiredNotificationsJSONFields,
  goRewardJSONFields: requiredRewardJSONFields,
  importScopes: requiredImportScopes,
  migrations: requiredMigrationFiles,
  notificationsSmokeFiles: requiredNotificationsSmokeFiles,
  gatewayNotificationRules: 'none',
};

console.log(JSON.stringify(summary, null, 2));
