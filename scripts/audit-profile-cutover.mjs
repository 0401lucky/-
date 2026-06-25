import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedProfileApiPaths = [
  '/api/profile/overview',
  '/api/profile/settings',
  '/api/profile/achievements/equip',
];

const requiredGoRouteSnippets = [
  'api.Get("/profile/overview", profileHandlers.getOverview)',
  'api.Get("/profile/settings", profileHandlers.getSettings)',
  'api.Put("/profile/settings", profileHandlers.updateSettings)',
  'api.Put("/profile/achievements/equip", profileHandlers.equipAchievement)',
];

const requiredProfileSmokeFiles = [
  'scripts/smoke-profile-go-api.mjs',
  'scripts/smoke-profile-write-go-api.mjs',
];

const expectedGatewayProfileRules = [
  'handle /api/profile/overview {',
  'handle /api/profile/settings {',
  'handle /api/profile/achievements/equip {',
];

const requiredProfileSmokeSnippets = [
  'PROFILE_GO_API_COOKIE',
  'PROFILE_WRITE_SMOKE_USER_ID',
  'docker-compose-exec-api',
  'docker-compose-exec-api-and-postgres',
  'checkedUnauthenticatedPaths',
  'checkedAuthenticatedPaths',
  '/api/profile/overview',
  '/api/profile/settings',
  '/api/profile/achievements/equip',
  'verifyCleanup',
  'gatewayProfileRules',
];

const requiredGoJSONFields = {
  settings: [
    'displayName',
    'avatarUrl',
    'qqEmail',
    'equippedAchievement',
    'updatedAt',
  ],
  equipAchievement: [
    'equippedId',
    'equipped',
  ],
  overviewTopLevel: [
    'user',
    'points',
    'cards',
    'gameplay',
    'notifications',
    'achievementStats',
    'achievements',
  ],
  overviewUser: [
    'id',
    'username',
    'customDisplayName',
    'customAvatarUrl',
    'customQqEmail',
  ],
  overviewPoints: [
    'balance',
    'recentLogs',
    'amount',
    'source',
    'description',
    'createdAt',
  ],
  overviewCards: [
    'owned',
    'total',
    'fragments',
    'drawsAvailable',
    'completionRate',
    'albums',
  ],
  overviewGameplay: [
    'checkinStreak',
    'totalCheckinDays',
    'recentRecords',
    'gameType',
    'score',
    'pointsEarned',
  ],
  overviewNotifications: [
    'unreadCount',
    'recent',
    'title',
    'content',
    'type',
    'isRead',
  ],
  overviewAchievementStats: [
    'gameWinRate',
    'gameWinPlays',
    'farmUnlockedLands',
    'lotteryOrangeCount',
    'lotteryHeartCount',
    'ecoLifetimeCleared',
    'ecoLifetimePrizeClaims',
    'ecoLifetimePhotoClaims',
  ],
  overviewAchievements: [
    'grants',
    'equippedId',
    'equipped',
    'items',
    'unlocked',
    'shine',
    'series',
    'unlockMode',
    'grantedAt',
    'expiresAt',
  ],
};

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'profile'),
  path.join(repoRoot, 'src', 'components'),
];

function walkFiles(root, files = []) {
  if (!existsSync(root)) {
    return files;
  }
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
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
  console.error(`profile cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const profilePathPattern = /['"`](\/api\/profile\/[^'"`?#]+)['"`]/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(profilePathPattern)) {
    const apiPath = match[1];
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedSet = new Set(expectedProfileApiPaths);
const discoveredSet = new Set(discovered.keys());

const missingFrontendPaths = expectedProfileApiPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedSet.has(apiPath));

if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend profile API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected frontend path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => {
      const locations = discovered.get(apiPath).join(', ');
      return `unexpected frontend path ${apiPath} in ${locations}`;
    }),
  ]);
}

const serverPath = path.join(repoRoot, 'backend', 'internal', 'httpserver', 'server.go');
const serverSource = readFileSync(serverPath, 'utf8');
const missingGoRoutes = requiredGoRouteSnippets.filter((snippet) => !serverSource.includes(snippet));
if (missingGoRoutes.length > 0) {
  fail('Go profile routes are incomplete', missingGoRoutes);
}

const profileTypesPath = path.join(repoRoot, 'backend', 'internal', 'profile', 'types.go');
const profileTypesSource = readFileSync(profileTypesPath, 'utf8');
const goJSONTags = new Set(
  [...profileTypesSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]),
);
const missingGoJSONFields = Object.entries(requiredGoJSONFields).flatMap(([group, fields]) =>
  fields
    .filter((field) => !goJSONTags.has(field))
    .map((field) => `${group}.${field}`),
);
if (missingGoJSONFields.length > 0) {
  fail('Go profile response JSON fields are incomplete', missingGoJSONFields);
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewayProfileRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line.includes('/api/profile') && !entry.line.startsWith('#'));

const activeGatewayProfileRuleSet = new Set(activeGatewayProfileRules.map((entry) => entry.line));
const missingGatewayProfileRules = expectedGatewayProfileRules.filter((line) => !activeGatewayProfileRuleSet.has(line));
const unexpectedGatewayProfileRules = activeGatewayProfileRules
  .filter((entry) => !expectedGatewayProfileRules.includes(entry.line))
  .map((entry) => `${gatewayPath}:${entry.lineNumber} ${entry.line}`);

if (missingGatewayProfileRules.length > 0 || unexpectedGatewayProfileRules.length > 0) {
  fail(
    'Gateway profile routing rules must stay limited to the approved exact cutover paths',
    [
      ...missingGatewayProfileRules.map((line) => `missing ${line}`),
      ...unexpectedGatewayProfileRules.map((line) => `unexpected ${line}`),
    ],
  );
}

const missingProfileSmokeFiles = requiredProfileSmokeFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingProfileSmokeFiles.length > 0) {
  fail('profile direct API smoke files are missing', missingProfileSmokeFiles);
}
const profileSmokeSource = requiredProfileSmokeFiles
  .map((relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8'))
  .join('\n');
const missingProfileSmokeSnippets = requiredProfileSmokeSnippets.filter((snippet) => !profileSmokeSource.includes(snippet));
if (missingProfileSmokeSnippets.length > 0) {
  fail('profile direct API smoke script is incomplete', missingProfileSmokeSnippets);
}

const summary = {
  frontendProfileApiPaths: expectedProfileApiPaths,
  frontendLocations: Object.fromEntries([...discovered.entries()]),
  goRoutes: requiredGoRouteSnippets,
  goJSONFieldGroups: requiredGoJSONFields,
  profileSmokeFiles: requiredProfileSmokeFiles,
  gatewayProfileRules: expectedGatewayProfileRules,
};

console.log(JSON.stringify(summary, null, 2));
