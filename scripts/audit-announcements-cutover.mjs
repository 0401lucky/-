import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedAnnouncementApiPaths = [
  '/api/announcements',
  '/api/admin/announcements',
  '/api/admin/announcements/*',
];

const requiredGoRouteSnippets = [
  'api.Get("/announcements", announcementHandlers.listPublished)',
  'api.Get("/admin/announcements", announcementHandlers.listAdmin)',
  'api.Post("/admin/announcements", announcementHandlers.createAdmin)',
  'api.Patch("/admin/announcements/{id}", announcementHandlers.updateAdmin)',
  'api.Delete("/admin/announcements/{id}", announcementHandlers.archiveAdmin)',
];

const expectedGatewayAnnouncementRules = [
  'handle /api/announcements {',
  'handle /api/admin/announcements {',
  'handle /api/admin/announcements/* {',
];

const requiredJSONFields = [
  'id',
  'title',
  'content',
  'status',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdById',
  'createdBy',
  'updatedById',
  'updatedBy',
  'items',
  'pagination',
  'announcement',
  'notifiedUsers',
];

const requiredSmokeSnippets = [
  'ANNOUNCEMENTS_SMOKE_USER_ID',
  'announcements-go-api-smoke',
  'GET /api/announcements',
  'POST /api/admin/announcements',
  'PATCH /api/admin/announcements/{id}',
  'DELETE /api/admin/announcements/{id}',
  'verifyCleanup',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'page.tsx'),
  path.join(repoRoot, 'src', 'app', 'admin', 'announcements'),
];

function fail(message, details = []) {
  console.error(`announcements cutover audit failed: ${message}`);
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

const frontendPaths = new Set();
for (const file of frontendRoots.flatMap((root) => walkFiles(root))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/['"`](\/api\/(?:admin\/)?announcements(?:\/[^'"`?#]+)?)(?:[?#][^'"`]*)?['"`]/g)) {
    const normalized = match[1].replace(/\/\$\{[^}]+}/g, '/*');
    frontendPaths.add(normalized);
  }
}

for (const apiPath of expectedAnnouncementApiPaths) {
  if (!frontendPaths.has(apiPath)) {
    fail('frontend announcement API dependencies changed', [`missing expected frontend path ${apiPath}`]);
  }
}
for (const apiPath of frontendPaths) {
  if (!expectedAnnouncementApiPaths.includes(apiPath)) {
    fail('frontend announcement API dependencies changed', [`unexpected frontend path ${apiPath}`]);
  }
}

const serverSource = read('backend/internal/httpserver/server.go');
const missingGoRoutes = requiredGoRouteSnippets.filter((snippet) => !serverSource.includes(snippet));
if (missingGoRoutes.length > 0) {
  fail('Go announcement routes are incomplete', missingGoRoutes);
}

const typesSource = read('backend/internal/announcements/types.go');
const goJSONTags = new Set(
  [...typesSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]),
);
const missingJSONFields = requiredJSONFields.filter((field) => !goJSONTags.has(field));
if (missingJSONFields.length > 0) {
  fail('Go announcement response JSON fields are incomplete', missingJSONFields);
}

if (!existsSync(path.join(repoRoot, 'backend/migrations/0021_announcements.sql'))) {
  fail('announcement migration is missing', ['backend/migrations/0021_announcements.sql']);
}
const migrationSource = read('backend/migrations/0021_announcements.sql');
for (const snippet of [
  'CREATE TABLE IF NOT EXISTS announcements',
  'CREATE TABLE IF NOT EXISTS announcement_notifications',
  'PRIMARY KEY (announcement_id, user_id)',
]) {
  if (!migrationSource.includes(snippet)) {
    fail('announcement migration shape is incomplete', [snippet]);
  }
}

const gatewaySource = read('gateway/Caddyfile');
const activeGatewayRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line.includes('/api/announcements') || entry.line.includes('/api/admin/announcements'))
  .filter((entry) => !entry.line.startsWith('#'));
const actualGatewayRules = new Set(activeGatewayRules.map((entry) => entry.line));
const missingGatewayRules = expectedGatewayAnnouncementRules.filter((line) => !actualGatewayRules.has(line));
const unexpectedGatewayRules = activeGatewayRules
  .filter((entry) => !expectedGatewayAnnouncementRules.includes(entry.line))
  .map((entry) => `gateway/Caddyfile:${entry.lineNumber} ${entry.line}`);
if (missingGatewayRules.length > 0 || unexpectedGatewayRules.length > 0) {
  fail('Gateway announcement rules must stay limited to approved exact paths', [
    ...missingGatewayRules.map((line) => `missing ${line}`),
    ...unexpectedGatewayRules.map((line) => `unexpected ${line}`),
  ]);
}

const smokePath = path.join(repoRoot, 'scripts/smoke-announcements-go-api.mjs');
if (!existsSync(smokePath)) {
  fail('announcement smoke script is missing', ['scripts/smoke-announcements-go-api.mjs']);
}
const smokeSource = readFileSync(smokePath, 'utf8');
const missingSmokeSnippets = requiredSmokeSnippets.filter((snippet) => !smokeSource.includes(snippet));
if (missingSmokeSnippets.length > 0) {
  fail('announcement smoke script is incomplete', missingSmokeSnippets);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'announcements-cutover-audit',
  frontendAnnouncementApiPaths: expectedAnnouncementApiPaths,
  goRoutes: requiredGoRouteSnippets,
  goJSONFields: requiredJSONFields,
  gatewayAnnouncementRules: expectedGatewayAnnouncementRules,
  smoke: 'scripts/smoke-announcements-go-api.mjs',
}, null, 2));
