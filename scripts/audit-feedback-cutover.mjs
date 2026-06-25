import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedFrontendFeedbackApiPaths = [
  '/api/feedback',
  '/api/feedback/{id}',
  '/api/feedback/{id}/messages',
  '/api/feedback/{id}/like',
  '/api/admin/feedback',
  '/api/admin/feedback/{id}',
  '/api/admin/feedback/{id}/messages',
];

const nextRouteFiles = [
  'src/app/api/feedback/route.ts',
  'src/app/api/feedback/[id]/route.ts',
  'src/app/api/feedback/[id]/messages/route.ts',
  'src/app/api/feedback/[id]/like/route.ts',
  'src/app/api/admin/feedback/route.ts',
  'src/app/api/admin/feedback/[id]/route.ts',
  'src/app/api/admin/feedback/[id]/messages/route.ts',
  'src/app/api/feedback/images/[...path]/route.ts',
];

const requiredMigrationFiles = [
  'backend/migrations/0018_feedback.sql',
  'backend/internal/feedback/media.go',
  'backend/internal/feedback/media_test.go',
  'backend/internal/migration/d1/feedback_importer.go',
  'backend/internal/migration/d1/feedback_importer_test.go',
  'backend/internal/migration/d1/feedback_importer_integration_test.go',
];

const requiredMigrationSnippets = [
  'CREATE TABLE IF NOT EXISTS feedback_items',
  'CREATE TABLE IF NOT EXISTS feedback_messages',
  'CREATE TABLE IF NOT EXISTS feedback_likes',
  'feedback_items_wall_updated_idx',
];

const requiredImporterSnippets = [
  'feedbackItemKeyPrefix',
  'feedbackMessagesKeyPrefix',
  'feedbackLikesKeyPrefix',
  'PlanFeedbackImport',
  'ApplyFeedbackImport',
  'parseLegacyFeedbackItem',
  'parseLegacyFeedbackMessage',
  'parseLegacyFeedbackLike',
];

const requiredGoRouteSnippets = [
  'api.Get("/feedback", feedbackHandlers.list)',
  'api.Post("/feedback", feedbackHandlers.create)',
  'api.Get("/feedback/images/*", feedbackHandlers.getImage)',
  'api.Head("/feedback/images/*", feedbackHandlers.headImage)',
  'api.Get("/feedback/{id}", feedbackHandlers.detail)',
  'api.Post("/feedback/{id}/messages", feedbackHandlers.addMessage)',
  'api.Post("/feedback/{id}/like", feedbackHandlers.toggleLike)',
  'api.Get("/admin/feedback", feedbackHandlers.listAdmin)',
  'api.Get("/admin/feedback/{id}", feedbackHandlers.adminDetail)',
  'api.Patch("/admin/feedback/{id}", feedbackHandlers.updateStatus)',
  'api.Delete("/admin/feedback/{id}", feedbackHandlers.deleteAdmin)',
  'api.Post("/admin/feedback/{id}/messages", feedbackHandlers.addAdminMessage)',
];

const requiredHandlerSnippets = [
  'func (handlers feedbackHandlers) list',
  'func (handlers feedbackHandlers) create',
  'func (handlers feedbackHandlers) getImage',
  'func (handlers feedbackHandlers) headImage',
  'func (handlers feedbackHandlers) detail',
  'func (handlers feedbackHandlers) addMessage',
  'func (handlers feedbackHandlers) toggleLike',
  'func (handlers feedbackHandlers) listAdmin',
  'func (handlers feedbackHandlers) adminDetail',
  'func (handlers feedbackHandlers) updateStatus',
  'func (handlers feedbackHandlers) deleteAdmin',
  'func (handlers feedbackHandlers) addAdminMessage',
  'func (service *Service) Delete',
  'requireUser',
  'requireAdmin',
  'feedbackReadRateLimit',
  'feedbackCreateRateLimit',
  'feedbackMessageRateLimit',
  'feedbackLikeRateLimit',
  'adminFeedbackMessageRateLimit',
  'StoreImages',
  '反馈附件服务暂时不可用',
];

const requiredAnalyzerSnippets = [
  'feedback:item:*',
  'feedback:messages:*',
  'feedback:likes:*',
  'feedback_items',
  'feedback_messages',
  'feedback_likes',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'feedback'),
  path.join(repoRoot, 'src', 'app', 'admin', 'feedback'),
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

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function fail(message, details = []) {
  console.error(`feedback cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function normalizeFeedbackPath(raw) {
  return raw
    .replace(/\$\{[^}]+\}/g, '{id}')
    .replace(/\?[^'"`]+$/, '')
    .replace(/\/+$/, '');
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const feedbackPathPattern = /\/api\/(?:admin\/)?feedback(?:\/(?:\$\{[^}]+\}|[a-zA-Z0-9_.-]+))*\??[^'"`)]*/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(feedbackPathPattern)) {
    const apiPath = normalizeFeedbackPath(match[0]);
    if (apiPath.startsWith('/api/feedback/images')) {
      continue;
    }
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedSet = new Set(expectedFrontendFeedbackApiPaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedFrontendFeedbackApiPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedSet.has(apiPath));
if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend feedback API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected frontend path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => {
      const locations = discovered.get(apiPath).join(', ');
      return `unexpected frontend path ${apiPath} in ${locations}`;
    }),
  ]);
}

const missingNextRoutes = nextRouteFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingNextRoutes.length > 0) {
  fail('Next feedback route files are missing', missingNextRoutes);
}

if (!existsSync(path.join(repoRoot, 'scripts/smoke-feedback-go-api.mjs'))) {
  fail('feedback Go API smoke script is missing', ['scripts/smoke-feedback-go-api.mjs']);
}

const missingMigrationFiles = requiredMigrationFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingMigrationFiles.length > 0) {
  fail('feedback migration/importer files are missing', missingMigrationFiles);
}

const migrationSource = read('backend/migrations/0018_feedback.sql');
const missingMigrationSnippets = requiredMigrationSnippets.filter((snippet) => !migrationSource.includes(snippet));
if (missingMigrationSnippets.length > 0) {
  fail('feedback PostgreSQL schema is incomplete', missingMigrationSnippets);
}

const importerSource = read('backend/internal/migration/d1/feedback_importer.go');
const missingImporterSnippets = requiredImporterSnippets.filter((snippet) => !importerSource.includes(snippet));
if (missingImporterSnippets.length > 0) {
  fail('feedback D1 importer is incomplete', missingImporterSnippets);
}

const analyzerSource = read('backend/internal/migration/d1/analyzer.go');
const missingAnalyzerSnippets = requiredAnalyzerSnippets.filter((snippet) => !analyzerSource.includes(snippet));
if (missingAnalyzerSnippets.length > 0) {
  fail('D1 analyzer feedback mapping is incomplete', missingAnalyzerSnippets);
}

const serverSource = read('backend/internal/httpserver/server.go');
const missingGoRouteSnippets = requiredGoRouteSnippets.filter((snippet) => !serverSource.includes(snippet));
if (missingGoRouteSnippets.length > 0) {
  fail('Go feedback routes are incomplete', missingGoRouteSnippets);
}

const handlerSource = [
  read('backend/internal/httpserver/feedback_handlers.go'),
  read('backend/internal/httpserver/feedback_media_handlers.go'),
  read('backend/internal/feedback/service.go'),
  read('backend/internal/feedback/media.go'),
].join('\n');
const missingHandlerSnippets = requiredHandlerSnippets.filter((snippet) => !handlerSource.includes(snippet));
if (missingHandlerSnippets.length > 0) {
  fail('Go feedback handlers are incomplete', missingHandlerSnippets);
}

const migrateMain = read('backend/cmd/migrate-d1/main.go');
for (const snippet of ['cards、feedback', 'case "feedback"', 'PlanFeedbackImport', 'ApplyFeedbackImport']) {
  if (!migrateMain.includes(snippet)) {
    fail('migrate-d1 feedback scope is incomplete', [snippet]);
  }
}

const readme = read('backend/README.md');
for (const snippet of ['-scope feedback', '- `feedback`']) {
  if (!readme.includes(snippet)) {
    fail('backend README feedback scope coverage is incomplete', [snippet]);
  }
}

const configSource = read('backend/internal/config/config.go');
for (const snippet of ['FeedbackMediaDir', 'FeedbackMediaURL', 'FEEDBACK_MEDIA_DIR', 'FEEDBACK_MEDIA_PUBLIC_URL']) {
  if (!configSource.includes(snippet)) {
    fail('feedback media config is incomplete', [snippet]);
  }
}

const composeSource = read('compose.yml');
for (const snippet of ['FEEDBACK_MEDIA_DIR: /data/feedback-media', 'feedback-media-data:/data/feedback-media', 'feedback-media-data:']) {
  if (!composeSource.includes(snippet)) {
    fail('compose feedback media volume is incomplete', [snippet]);
  }
}

const zeaburEnvExample = read('deploy/zeabur.env.example');
for (const snippet of ['FEEDBACK_MEDIA_DIR=/data/feedback-media', 'FEEDBACK_MEDIA_PUBLIC_URL=']) {
  if (!zeaburEnvExample.includes(snippet)) {
    fail('Zeabur env example feedback media config is incomplete', [snippet]);
  }
}

const feedbackSmokeSource = read('scripts/smoke-feedback-go-api.mjs');
for (const snippet of ['DELETE /api/admin/feedback/{id}', 'verifyFeedbackDeleted', 'method === \'PATCH\' || method === \'DELETE\'']) {
  if (!feedbackSmokeSource.includes(snippet)) {
    fail('feedback smoke delete coverage is incomplete', [snippet]);
  }
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeFeedbackGatewayRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/feedback') || entry.line.includes('/api/admin/feedback'));
const expectedFeedbackGatewayRules = [
  'handle /api/feedback {',
  'handle /api/feedback/* {',
  'handle /api/admin/feedback {',
  'handle /api/admin/feedback/* {',
];
const missingFeedbackGatewayRules = expectedFeedbackGatewayRules
  .filter((line) => !activeFeedbackGatewayRules.some((entry) => entry.line === line));
const unexpectedFeedbackGatewayRules = activeFeedbackGatewayRules
  .filter((entry) => !expectedFeedbackGatewayRules.includes(entry.line));
if (missingFeedbackGatewayRules.length > 0 || unexpectedFeedbackGatewayRules.length > 0) {
  fail(
    'Gateway feedback rules must stay on the reviewed public/admin feedback cutover set',
    [
      ...missingFeedbackGatewayRules.map((line) => `missing gateway exact rule: ${line}`),
      ...unexpectedFeedbackGatewayRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`),
    ]
  );
}

console.log(JSON.stringify({
  ok: true,
  mode: 'feedback-cutover-audit',
  status: 'feedback-delete-ready',
  frontendFeedbackApiPaths: expectedFrontendFeedbackApiPaths,
  frontendLocations: Object.fromEntries([...discovered.entries()]),
  nextRouteFiles,
  migrationFiles: requiredMigrationFiles,
  goRoutes: requiredGoRouteSnippets,
  gatewayFeedbackRules: activeFeedbackGatewayRules.map((entry) => entry.line),
  remainingBeforeCutover: [
    'ensure Zeabur mounts /data/feedback-media if attachment persistence is required',
    'fresh Zeabur deployment smoke with sample user/admin cookies',
    'page-level smoke for /feedback public wall after public Gateway cutover',
  ],
}, null, 2));
