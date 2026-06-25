import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const expectedFrontendProjectPaths = [
  '/api/projects',
  '/api/projects/my-claims',
  '/api/projects/${id}',
];

const forbiddenProjectGatewaySnippets = [
  '/api/projects*',
];

const requiredGoRouteSnippets = [
  'api.Get("/projects", welfareHandlers.listProjects)',
  'api.Get("/projects/my-claims", welfareHandlers.listMyProjectClaims)',
  'api.Get("/projects/{id}", welfareHandlers.getProjectDetail)',
  'api.Post("/projects/{id}", welfareHandlers.claimProject)',
];

const requiredHandlerSnippets = [
  'func (handlers welfareHandlers) listProjects',
  'func (handlers welfareHandlers) getProjectDetail',
  'func (handlers welfareHandlers) claimProject',
  'func (handlers welfareHandlers) listMyProjectClaims',
  'ListProjects',
  'GetPublicProjectDetail',
  'ClaimPublicProject',
  'ListUserProjectClaimIDs',
  '"projects"',
  '"projectIds"',
];

const requiredJSONFields = [
  'id',
  'name',
  'description',
  'maxClaims',
  'claimedCount',
  'codesCount',
  'status',
  'createdAt',
  'createdBy',
  'rewardType',
  'directPoints',
  'newUserOnly',
  'pinned',
  'pinnedAt',
];

const requiredMigrationFiles = [
  'backend/migrations/0003_welfare_lists.sql',
  'backend/migrations/0027_project_claims.sql',
];

const requiredSmokeFiles = [
  'scripts/smoke-projects-go-api.mjs',
];

const requiredSmokeSnippets = [
  'PROJECTS_SMOKE_ACTIVE_ID',
  'docker-compose-exec-api-and-postgres',
  'checkedPublicPaths',
  '/api/projects',
  '/api/projects/my-claims',
  '/api/projects/',
  'verifyCleanup',
  'gatewayProjectsRules',
];

const frontendRoots = [
  path.join(repoRoot, 'src', 'app', 'page.tsx'),
  path.join(repoRoot, 'src', 'app', 'store'),
  path.join(repoRoot, 'src', 'app', 'projects'),
  path.join(repoRoot, 'src', 'app', 'project'),
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
  console.error(`projects cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const frontendFiles = frontendRoots.flatMap((root) => walkFiles(root));
const projectApiPattern = /['"`](\/api\/projects(?:\/my-claims|\/\$\{id\})?)(?:[?#][^'"`]*)?['"`]/g;
const discovered = new Map();

for (const file of frontendFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(projectApiPattern)) {
    const apiPath = match[1];
    if (!discovered.has(apiPath)) {
      discovered.set(apiPath, []);
    }
    discovered.get(apiPath).push(normalizeSlash(path.relative(repoRoot, file)));
  }
}

const expectedSet = new Set(expectedFrontendProjectPaths);
const discoveredSet = new Set(discovered.keys());
const missingFrontendPaths = expectedFrontendProjectPaths.filter((apiPath) => !discoveredSet.has(apiPath));
const unexpectedFrontendPaths = [...discoveredSet].filter((apiPath) => !expectedSet.has(apiPath));
if (missingFrontendPaths.length > 0 || unexpectedFrontendPaths.length > 0) {
  fail('frontend project API dependencies changed', [
    ...missingFrontendPaths.map((apiPath) => `missing expected frontend path ${apiPath}`),
    ...unexpectedFrontendPaths.map((apiPath) => `unexpected frontend path ${apiPath}`),
  ]);
}

const serverSource = read('backend/internal/httpserver/server.go');
const missingGoRoutes = requiredGoRouteSnippets.filter((snippet) => !serverSource.includes(snippet));
if (missingGoRoutes.length > 0) {
  fail('Go project routes are incomplete', missingGoRoutes);
}

const handlerSource = read('backend/internal/httpserver/welfare_handlers.go');
const serviceSource = `${read('backend/internal/welfare/service.go')}\n${read('backend/internal/welfare/admin_project.go')}`;
const missingHandlerSnippets = requiredHandlerSnippets.filter((snippet) => !`${handlerSource}\n${serviceSource}`.includes(snippet));
if (missingHandlerSnippets.length > 0) {
  fail('Go project list handler/service snippets are missing', missingHandlerSnippets);
}

const typeSource = read('backend/internal/welfare/types.go');
const goJSONTags = new Set([...typeSource.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)].map((match) => match[1]));
const missingJSONFields = requiredJSONFields.filter((field) => !goJSONTags.has(field));
if (missingJSONFields.length > 0) {
  fail('Go project response JSON fields are incomplete', missingJSONFields);
}

const missingMigrationFiles = requiredMigrationFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingMigrationFiles.length > 0) {
  fail('required project migration files are missing', missingMigrationFiles);
}

const missingSmokeFiles = requiredSmokeFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingSmokeFiles.length > 0) {
  fail('project direct API smoke files are missing', missingSmokeFiles);
}
const smokeSource = requiredSmokeFiles.map((relativePath) => read(relativePath)).join('\n');
const missingSmokeSnippets = requiredSmokeSnippets.filter((snippet) => !smokeSource.includes(snippet));
if (missingSmokeSnippets.length > 0) {
  fail('project direct API smoke script is incomplete', missingSmokeSnippets);
}

const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const activeGatewayProjectRules = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/projects') || entry.line.includes('/api/admin/projects'));

const expectedGatewayRules = [
  'handle /api/projects {',
  'handle /api/projects/my-claims {',
  'handle /api/projects/* {',
  'handle /api/admin/projects {',
  'handle /api/admin/projects/* {',
];
const missingGatewayRules = expectedGatewayRules
  .filter((line) => !activeGatewayProjectRules.some((entry) => entry.line === line));
const unexpectedGatewayRules = activeGatewayProjectRules.filter((entry) => !expectedGatewayRules.includes(entry.line));
const forbiddenGatewayRules = activeGatewayProjectRules.filter((entry) =>
  forbiddenProjectGatewaySnippets.some((snippet) => entry.line.includes(snippet))
);
if (missingGatewayRules.length > 0 || unexpectedGatewayRules.length > 0 || forbiddenGatewayRules.length > 0) {
  fail('Gateway project rules are not the reviewed exact cutover set', [
    ...missingGatewayRules.map((line) => `missing gateway rule ${line}`),
    ...unexpectedGatewayRules.map((entry) => `${normalizeSlash(path.relative(repoRoot, gatewayPath))}:${entry.lineNumber} ${entry.line}`),
  ]);
}

const summary = {
  frontendProjectApiPaths: expectedFrontendProjectPaths,
  frontendLocations: Object.fromEntries([...discovered.entries()]),
  goRoutes: requiredGoRouteSnippets,
  migrations: requiredMigrationFiles,
  smokeFiles: requiredSmokeFiles,
  gatewayProjectRules: activeGatewayProjectRules.map((entry) => entry.line),
};

console.log(JSON.stringify(summary, null, 2));
