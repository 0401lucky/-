import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = process.cwd();
const strict = process.env.LEGACY_CLOUDFLARE_RESIDUALS_STRICT === '1';
const includeFullLists = process.env.LEGACY_CLOUDFLARE_RESIDUALS_FULL === '1';

const ignoredDirs = new Set([
  '.git',
  '.next',
  '.open-next',
  '.wrangler',
  '.gocache',
  'backups',
  'node_modules',
]);

const productionRoots = [
  'src/app',
  'src/components',
  'src/lib',
  'src/durable-objects',
  'cloudflare-env.d.ts',
  'open-next.config.ts',
  'worker-wrapper.mjs',
  'wrangler.jsonc',
  'package.json',
];

const testPathPatterns = [
  /(^|\/)__tests__(\/|$)/,
  /\.test\.[tj]sx?$/,
  /(^|\/)vitest\./,
];

const d1ArchivePathPatterns = [
  /^backend\/cmd\/migrate-d1\//,
  /^backend\/internal\/migration\/d1\//,
  /^scripts\/audit-migrate-d1-scopes\.mjs$/,
  /^docs\/migrate-d1-scope-audit\.md$/,
];

const cloudflareDeployArtifacts = [
  'cloudflare-env.d.ts',
  'open-next.config.ts',
  'worker-wrapper.mjs',
  'wrangler.jsonc',
  'src/types/cloudflare-durable.d.ts',
  'src/durable-objects/minesweeper-session.ts',
];

const legacyPatterns = [
  { name: 'd1-kv import', pattern: /@\/lib\/d1-kv/ },
  { name: 'kv lib import', pattern: /@\/lib\/kv/ },
  { name: 'hot-d1 import', pattern: /@\/lib\/hot-d1/ },
  { name: 'Cloudflare env binding', pattern: /\bKV_DB\b|\bD1Database\b|\bR2Bucket\b/ },
  { name: 'KV REST env', pattern: /\bKV_REST_API_URL\b|\bKV_REST_API_TOKEN\b/ },
  { name: 'OpenNext Cloudflare', pattern: /@opennextjs\/cloudflare|opennextjs-cloudflare|\.open-next/ },
  { name: 'Wrangler', pattern: /\bwrangler\b/ },
  { name: 'Cloudflare Workers module', pattern: /cloudflare:workers/ },
];

function normalizeSlash(value) {
  return value.split(path.sep).join('/');
}

function walkFiles(root, files = []) {
  if (!existsSync(root)) {
    return files;
  }
  const stat = statSync(root);
  if (stat.isFile()) {
    files.push(root);
    return files;
  }
  for (const entry of readdirSync(root)) {
    if (ignoredDirs.has(entry)) {
      continue;
    }
    walkFiles(path.join(root, entry), files);
  }
  return files;
}

function readJSONCommand(command, args) {
  const output = execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

function packageCloudflareSignals() {
  if (!existsSync('package.json')) {
    return [];
  }
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const signals = [];
  for (const [name, script] of Object.entries(pkg.scripts || {})) {
    if (
      name === 'audit:legacy-cloudflare-residuals' ||
      name === 'cleanup:cloudflare-deploy-artifacts:dry-run' ||
      name === 'test:cloudflare-deploy-cleanup-guards' ||
      name === 'cleanup:package-cloudflare:dry-run' ||
      name === 'test:package-cloudflare-cleanup-guards'
    ) {
      continue;
    }
    if (/cloudflare|opennext|wrangler/i.test(String(script)) || /^(preview|deploy|upload|cf-typegen|opennext:patch)$/.test(name)) {
      signals.push({ kind: 'script', name, value: script });
    }
  }
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(pkg[section] || {})) {
      if (/cloudflare|wrangler|vercel\/kv/.test(name)) {
        signals.push({ kind: section, name, value: version });
      }
    }
  }
  return signals;
}

function classifyFile(relativePath, source) {
  const normalized = normalizeSlash(relativePath);
  const matches = legacyPatterns
    .filter(({ pattern }) => pattern.test(source))
    .map(({ name }) => name);

  if (d1ArchivePathPatterns.some((pattern) => pattern.test(normalized))) {
    return { bucket: 'optionalD1ArchiveTools', file: normalized, matches: matches.length > 0 ? matches : ['D1 archive tool'] };
  }
  if (matches.length === 0) {
    return null;
  }
  if (testPathPatterns.some((pattern) => pattern.test(normalized))) {
    return { bucket: 'testLegacyReferences', file: normalized, matches };
  }
  if (normalized.startsWith('docs/') || normalized.startsWith('scripts/')) {
    return { bucket: 'migrationAuditDocsAndScripts', file: normalized, matches };
  }
  if (cloudflareDeployArtifacts.includes(normalized) || normalized.startsWith('src/durable-objects/')) {
    return { bucket: 'cloudflareDeployArtifacts', file: normalized, matches };
  }
  return { bucket: 'productionSourceLegacyReferences', file: normalized, matches };
}

function collectLegacyReferences() {
  const candidates = [];
  for (const root of productionRoots) {
    candidates.push(...walkFiles(path.join(repoRoot, root)));
  }
  candidates.push(...walkFiles(path.join(repoRoot, 'docs')));
  candidates.push(...walkFiles(path.join(repoRoot, 'scripts')));
  candidates.push(...walkFiles(path.join(repoRoot, 'backend', 'cmd', 'migrate-d1')));
  candidates.push(...walkFiles(path.join(repoRoot, 'backend', 'internal', 'migration', 'd1')));

  const seen = new Set();
  const buckets = {
    productionSourceLegacyReferences: [],
    cloudflareDeployArtifacts: [],
    optionalD1ArchiveTools: [],
    migrationAuditDocsAndScripts: [],
    testLegacyReferences: [],
  };

  for (const file of candidates) {
    const relative = normalizeSlash(path.relative(repoRoot, file));
    if (seen.has(relative) || !/\.(go|mjs|cjs|js|jsx|ts|tsx|json|jsonc|md)$/.test(relative)) {
      continue;
    }
    seen.add(relative);
    const item = classifyFile(relative, readFileSync(file, 'utf8'));
    if (item) {
      buckets[item.bucket].push(item);
    }
  }

  for (const items of Object.values(buckets)) {
    items.sort((a, b) => a.file.localeCompare(b.file));
  }

  return buckets;
}

function summarizeBucket(items) {
  return {
    count: items.length,
    samples: items.slice(0, 12),
  };
}

function routeDeletionPlan(fallbackAudit) {
  const buckets = fallbackAudit.buckets || {};
  const goCutoverCandidates = buckets.alreadyGoCutover || [];
  const tombstoneCandidates = buckets.alreadyGoTombstoned || [];
  const manualReviewRoutes = [
    ...(buckets.mustMigrateOrTombstone || []),
    ...(buckets.blockedByExternalConfig || []),
    ...(buckets.internalOnly || []),
    ...(buckets.testOnlyOrNoFrontendCaller || []),
  ];
  const candidateFiles = [...goCutoverCandidates, ...tombstoneCandidates]
    .map((route) => route.file)
    .filter(Boolean)
    .sort();
  const candidateRoutes = [...goCutoverCandidates, ...tombstoneCandidates]
    .map((route) => ({
      path: route.path,
      file: route.file,
      bucket: route.bucket,
      hasFrontendCaller: route.hasFrontendCaller,
      hasKvRisk: route.hasKvRisk,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
  const batches = buildRouteDeletionBatches(candidateRoutes);

  const plan = {
    totalNextApiRoutes: fallbackAudit.summary?.totalNextApiRoutes ?? 0,
    deleteCandidateRoutes: goCutoverCandidates.length + tombstoneCandidates.length,
    goCutoverCandidates: goCutoverCandidates.length,
    tombstoneCandidates: tombstoneCandidates.length,
    manualReviewRoutes: manualReviewRoutes.length,
    readyForRouteDeletion:
      (fallbackAudit.summary?.totalNextApiRoutes ?? 0) > 0 &&
      manualReviewRoutes.length === 0 &&
      goCutoverCandidates.length + tombstoneCandidates.length === (fallbackAudit.summary?.totalNextApiRoutes ?? 0),
    batches,
    candidateFileSamples: candidateFiles.slice(0, 20),
    manualReviewSamples: manualReviewRoutes.slice(0, 20).map((route) => ({
      path: route.path,
      file: route.file,
      bucket: route.bucket,
    })),
  };
  if (includeFullLists) {
    plan.candidateRoutes = candidateRoutes;
    plan.candidateFiles = candidateFiles;
  }
  return plan;
}

function batchNameForRoute(route) {
  if (route.bucket === 'alreadyGoTombstoned') {
    return '01-tombstoned-legacy-tools';
  }
  if (route.path.startsWith('/api/internal/')) {
    return '02-internal-cron-routes';
  }
  if (route.path.startsWith('/api/auth/')) {
    return '03-auth-routes';
  }
  if (route.path.startsWith('/api/admin/')) {
    return '04-admin-routes';
  }
  if (route.path.startsWith('/api/games/')) {
    return '05-game-routes';
  }
  if (
    route.path.startsWith('/api/farm') ||
    route.path.startsWith('/api/cards') ||
    route.path.startsWith('/api/store') ||
    route.path.startsWith('/api/profile') ||
    route.path.startsWith('/api/notifications')
  ) {
    return '06-user-feature-routes';
  }
  return '07-public-and-misc-routes';
}

function buildRouteDeletionBatches(candidateRoutes) {
  const byName = new Map();
  for (const route of candidateRoutes) {
    const name = batchNameForRoute(route);
    if (!byName.has(name)) {
      byName.set(name, []);
    }
    byName.get(name).push(route);
  }

  return [...byName.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, routes]) => ({
      name,
      count: routes.length,
      goCutover: routes.filter((route) => route.bucket === 'alreadyGoCutover').length,
      tombstoned: routes.filter((route) => route.bucket === 'alreadyGoTombstoned').length,
      hasFrontendCaller: routes.filter((route) => route.hasFrontendCaller).length,
      hasKvRisk: routes.filter((route) => route.hasKvRisk).length,
      fileSamples: routes.map((route) => route.file).sort().slice(0, 12),
    }));
}

let fallbackAudit;
try {
  fallbackAudit = readJSONCommand('node', ['scripts/audit-next-api-fallback-risk.mjs']);
} catch (error) {
  console.error('legacy residual audit failed: unable to run audit-next-api-fallback-risk.mjs');
  console.error(error?.stderr || error?.message || error);
  process.exit(1);
}

const buckets = collectLegacyReferences();
const packageSignals = packageCloudflareSignals();
const nextApiRouteDeletionPlan = routeDeletionPlan(fallbackAudit);

const productionFallbackSummary = fallbackAudit.summary || {};
const productionFallbackClean =
  productionFallbackSummary.mustMigrateOrTombstone === 0 &&
  productionFallbackSummary.blockedByExternalConfig === 0 &&
  productionFallbackSummary.internalOnly === 0;

const strictReady =
  productionFallbackClean &&
  buckets.productionSourceLegacyReferences.length === 0 &&
  buckets.cloudflareDeployArtifacts.length === 0 &&
  packageSignals.length === 0;

const result = {
  ok: !strict || strictReady,
  readyForPhysicalDeletion: false,
  strict,
  mode: 'legacy-cloudflare-residuals-audit',
  productionFallbackClean,
  productionFallbackSummary,
  packageCloudflareSignals: {
    count: packageSignals.length,
    samples: packageSignals.slice(0, 12),
  },
  nextApiRouteDeletionPlan,
  buckets: {
    productionSourceLegacyReferences: summarizeBucket(buckets.productionSourceLegacyReferences),
    cloudflareDeployArtifacts: summarizeBucket(buckets.cloudflareDeployArtifacts),
    optionalD1ArchiveTools: summarizeBucket(buckets.optionalD1ArchiveTools),
    migrationAuditDocsAndScripts: summarizeBucket(buckets.migrationAuditDocsAndScripts),
    testLegacyReferences: summarizeBucket(buckets.testLegacyReferences),
  },
  nextActions: [
    '先保留 optionalD1ArchiveTools，除非明确决定不再提供 D1 归档迁移。',
    '物理删除 cloudflareDeployArtifacts、OpenNext/Wrangler package scripts 和旧 Next API 文件前需要单独确认。',
    'productionSourceLegacyReferences 归零后，才适合开启 LEGACY_CLOUDFLARE_RESIDUALS_STRICT=1 作为最终门禁。',
  ],
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}
