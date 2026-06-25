import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const apiRoot = path.join(repoRoot, 'src', 'app', 'api');
const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');

const apiLiteralPattern = /['"`](\/api\/[^'"`${}\s?#]+)(?:[?#][^'"`]*)?['"`]/g;
const importPattern = /from\s+['"](@\/lib\/[^'"]+)['"]|import\s*\(\s*['"](@\/lib\/[^'"]+)['"]\s*\)/g;
const kvRiskPatterns = [
  /@\/lib\/d1-kv/,
  /@\/lib\/kv/,
  /@\/lib\/hot-d1/,
  /\bKV_DB\b/,
  /\bKV_REST_API_URL\b/,
  /\bKV_REST_API_TOKEN\b/,
  /\bgetKV\b/,
  /\bcreateD1KV\b/,
  /\bkv\./,
  /@\/lib\/anomaly-detector/,
];

const externallyBlockedPaths = new Set([
  '/api/store/topup',
  '/api/store/withdraw',
]);

const knownLegacyTombstonePaths = new Set([
  '/api/admin/sync-users',
  '/api/admin/fix-codes-count',
  '/api/admin/migrate-native-hot-data',
  '/api/admin/migrate-new-user-eligibility',
  '/api/admin/store/reset',
  '/api/cards/purchase',
  '/api/internal/eco/theft-investigation',
  '/api/internal/farm/maturity-email',
  '/api/internal/number-bomb/settle',
  '/api/internal/raffle/delivery',
]);

function normalizeSlash(value) {
  return value.split(path.sep).join('/');
}

function walkFiles(root, predicate, files = []) {
  if (!existsSync(root)) {
    return files;
  }
  const stat = statSync(root);
  if (stat.isFile()) {
    if (!predicate || predicate(root)) {
      files.push(root);
    }
    return files;
  }
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') {
      continue;
    }
    walkFiles(path.join(root, entry), predicate, files);
  }
  return files;
}

function routePathFromFile(file) {
  const relativeDir = path.dirname(path.relative(apiRoot, file));
  if (relativeDir === '.') {
    return '/api';
  }
  const parts = relativeDir.split(path.sep).filter(Boolean).map((part) => {
    if (/^\[\[\.\.\..+\]\]$/.test(part) || /^\[\.\.\..+\]$/.test(part) || /^\[.+\]$/.test(part)) {
      return '*';
    }
    return part;
  });
  return `/api/${parts.join('/')}`;
}

function routeSortKey(routePath) {
  return routePath.replaceAll('*', '~');
}

function countBraces(line) {
  return (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
}

function parseGatewayApiCutovers(caddyfile) {
  const activeLines = caddyfile
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'));

  const rules = [];
  let current = null;
  let braceDepth = 0;

  for (const entry of activeLines) {
    const handleMatch = entry.line.match(/^handle\s+([^\s{]+)\s*\{/);
    if (!current && handleMatch) {
      current = {
        matcher: handleMatch[1],
        lineNumber: entry.lineNumber,
        proxiesToGo: false,
        respondsGone: false,
      };
      braceDepth = countBraces(entry.line);
      continue;
    }

    if (current) {
      const proxyMatch = entry.line.match(/^reverse_proxy\s+([^\s]+)/);
      if (proxyMatch && (proxyMatch[1] === '{$API_UPSTREAM:api:8080}' || proxyMatch[1] === 'api:8080')) {
        current.proxiesToGo = true;
      }
      const respondMatch = entry.line.match(/^respond\s+(?:"[^"]*"\s+)?(\d{3})\b/);
      if (respondMatch && respondMatch[1] === '410') {
        current.respondsGone = true;
      }
      braceDepth += countBraces(entry.line);
      if (braceDepth <= 0) {
        if (current.proxiesToGo || current.respondsGone) {
          rules.push({
            path: current.matcher,
            lineNumber: current.lineNumber,
            kind: current.respondsGone ? 'gone' : 'go',
          });
        }
        current = null;
      }
    }
  }

  return rules;
}

function gatewayRuleCoversRoute(rulePath, routePath) {
  if (rulePath === routePath) {
    return true;
  }
  if (rulePath.endsWith('*')) {
    const prefix = rulePath.slice(0, -1);
    return routePath.startsWith(prefix);
  }
  return false;
}

function directRiskMatches(source) {
  return kvRiskPatterns
    .filter((pattern) => pattern.test(source))
    .map((pattern) => pattern.source);
}

function localLibPath(importId) {
  const relative = importId.replace(/^@\//, '');
  const base = path.join(repoRoot, 'src', relative);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function indirectRiskImports(source) {
  const risky = [];
  for (const match of source.matchAll(importPattern)) {
    const importId = match[1] || match[2];
    const file = localLibPath(importId);
    if (!file) {
      continue;
    }
    const importedSource = readFileSync(file, 'utf8');
    if (directRiskMatches(importedSource).length > 0) {
      risky.push(importId);
    }
  }
  return [...new Set(risky)].sort();
}

function collectFrontendApiCallers() {
  const files = [
    ...walkFiles(path.join(repoRoot, 'src', 'app'), (file) => /\.(tsx?|jsx?)$/.test(file)),
    ...walkFiles(path.join(repoRoot, 'src', 'components'), (file) => /\.(tsx?|jsx?)$/.test(file)),
  ].filter((file) => !normalizeSlash(path.relative(repoRoot, file)).startsWith('src/app/api/'));

  const callers = new Map();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(apiLiteralPattern)) {
      const apiPath = match[1].replace(/\/$/, '');
      if (!callers.has(apiPath)) {
        callers.set(apiPath, new Set());
      }
      callers.get(apiPath).add(normalizeSlash(path.relative(repoRoot, file)));
    }
  }
  return callers;
}

function callersForRoute(callers, routePath) {
  const files = new Set();
  if (!routePath.includes('*')) {
    for (const [apiPath, apiCallers] of callers) {
      if (apiPath === routePath) {
        for (const file of apiCallers) {
          files.add(file);
        }
      }
    }
    return [...files].sort();
  }

  const prefix = routePath.slice(0, routePath.indexOf('*'));
  for (const [apiPath, apiCallers] of callers) {
    if (apiPath.startsWith(prefix)) {
      for (const file of apiCallers) {
        files.add(file);
      }
    }
  }
  return [...files].sort();
}

const gatewayRules = parseGatewayApiCutovers(readFileSync(gatewayPath, 'utf8'));
const frontendCallers = collectFrontendApiCallers();

const routes = walkFiles(apiRoot, (file) => path.basename(file) === 'route.ts')
  .map((file) => {
    const routePath = routePathFromFile(file);
    const source = readFileSync(file, 'utf8');
    const coveredByGatewayRules = gatewayRules
      .filter((rule) => gatewayRuleCoversRoute(rule.path, routePath))
      .map((rule) => `${rule.path} at gateway/Caddyfile:${rule.lineNumber}`);
    const callers = callersForRoute(frontendCallers, routePath);
    const directRisks = directRiskMatches(source);
    const indirectRisks = indirectRiskImports(source);
    const relativeFile = normalizeSlash(path.relative(repoRoot, file));
    const hasKvRisk = directRisks.length > 0 || indirectRisks.length > 0;
    const hasFrontendCaller = callers.length > 0;
    const coveredByGateway = coveredByGatewayRules.length > 0;

    let bucket = 'testOnlyOrNoFrontendCaller';
    if (coveredByGateway) {
      bucket = knownLegacyTombstonePaths.has(routePath)
        ? 'alreadyGoTombstoned'
        : 'alreadyGoCutover';
    } else if (externallyBlockedPaths.has(routePath)) {
      bucket = 'blockedByExternalConfig';
    } else if (routePath.startsWith('/api/internal/')) {
      bucket = 'internalOnly';
    } else if (hasFrontendCaller || hasKvRisk) {
      bucket = 'mustMigrateOrTombstone';
    }

    return {
      path: routePath,
      file: relativeFile,
      bucket,
      coveredByGateway,
      coveredByGatewayRules,
      hasFrontendCaller,
      callers,
      hasKvRisk,
      directRisks,
      indirectRisks,
    };
  })
  .sort((a, b) => routeSortKey(a.path).localeCompare(routeSortKey(b.path)));

const byBucket = routes.reduce((acc, route) => {
  if (!acc[route.bucket]) {
    acc[route.bucket] = [];
  }
  acc[route.bucket].push(route);
  return acc;
}, {});

const summary = {
  totalNextApiRoutes: routes.length,
  gatewayHandledRules: gatewayRules.length,
  gatewayGoRules: gatewayRules.filter((rule) => rule.kind === 'go').length,
  gatewayGoneRules: gatewayRules.filter((rule) => rule.kind === 'gone').length,
  alreadyGoCutover: byBucket.alreadyGoCutover?.length ?? 0,
  alreadyGoTombstoned: byBucket.alreadyGoTombstoned?.length ?? 0,
  mustMigrateOrTombstone: byBucket.mustMigrateOrTombstone?.length ?? 0,
  blockedByExternalConfig: byBucket.blockedByExternalConfig?.length ?? 0,
  internalOnly: byBucket.internalOnly?.length ?? 0,
  testOnlyOrNoFrontendCaller: byBucket.testOnlyOrNoFrontendCaller?.length ?? 0,
};

const nextActions = [];
if (summary.mustMigrateOrTombstone > 0) {
  nextActions.push('优先处理 mustMigrateOrTombstone 中带 frontend caller 的路径。');
}
if (summary.blockedByExternalConfig > 0) {
  nextActions.push('blockedByExternalConfig 需要先确认外部 new-api 配置和提现/充值策略。');
}
if (summary.internalOnly > 0) {
  nextActions.push('internalOnly 需要和 Go Worker 定时任务逐项对齐后再墓碑化。');
}
if (nextActions.length === 0) {
  nextActions.push('当前未发现需要继续迁移或墓碑化的 Next API 回落路径。');
}

const report = {
  ok: true,
  mode: 'next-api-fallback-risk-audit',
  summary,
  nextActions,
  buckets: byBucket,
};

console.log(JSON.stringify(report, null, 2));
