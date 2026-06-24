import { existsSync, readFileSync } from 'node:fs';

const files = {
  caddyfile: 'gateway/Caddyfile',
  compose: 'compose.yml',
  envExample: 'deploy/zeabur.env.example',
  servicePlan: 'deploy/zeabur-services.example.json',
  envDoc: 'docs/zeabur-env-audit.md',
  servicePlanDoc: 'docs/zeabur-service-plan.md',
  gatewayDoc: 'docs/gateway-allowed-cutovers.md',
  runbook: 'docs/zeabur-deployment-runbook.md',
};

const requiredFiles = Object.values(files);
const missingFiles = requiredFiles.filter((file) => !existsSync(file));
const violations = [];

function read(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function activeLines(text) {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'));
}

function requireSnippet(file, text, snippet, reason) {
  if (!text.includes(snippet)) {
    violations.push({ file, reason, expected: snippet });
  }
}

if (missingFiles.length === 0) {
  const caddyfile = read(files.caddyfile);
  const compose = read(files.compose);
  const envExample = read(files.envExample);
  const envDoc = read(files.envDoc);
  const servicePlanDoc = read(files.servicePlanDoc);
  const gatewayDoc = read(files.gatewayDoc);
  const runbook = read(files.runbook);

  requireSnippet(
    files.caddyfile,
    caddyfile,
    '{$API_UPSTREAM:api:8080}',
    'Gateway API 转发必须通过 API_UPSTREAM 配置，并保留本地默认值',
  );
  requireSnippet(
    files.caddyfile,
    caddyfile,
    '{$WEB_UPSTREAM:web:3000}',
    'Gateway Web 兜底必须通过 WEB_UPSTREAM 配置，并保留本地默认值',
  );

  for (const entry of activeLines(caddyfile)) {
    const proxyMatch = entry.line.match(/^reverse_proxy\s+(.+)$/);
    if (!proxyMatch) {
      continue;
    }
    const target = proxyMatch[1].trim();
    if (target === 'api:8080' || target === 'web:3000') {
      violations.push({
        file: files.caddyfile,
        lineNumber: entry.lineNumber,
        reason: '活跃 reverse_proxy 不能继续硬编码本地服务名，必须使用上游变量',
        line: entry.line,
      });
    }
  }

  requireSnippet(files.compose, compose, 'API_UPSTREAM: api:8080', 'Compose Gateway 环境变量缺少 API_UPSTREAM 默认值');
  requireSnippet(files.compose, compose, 'WEB_UPSTREAM: web:3000', 'Compose Gateway 环境变量缺少 WEB_UPSTREAM 默认值');
  requireSnippet(files.envExample, envExample, 'API_UPSTREAM=api:8080', 'Zeabur env 样例缺少 API_UPSTREAM 默认值');
  requireSnippet(files.envExample, envExample, 'WEB_UPSTREAM=web:3000', 'Zeabur env 样例缺少 WEB_UPSTREAM 默认值');

  try {
    const servicePlan = JSON.parse(read(files.servicePlan));
    const gatewayEnvironment = servicePlan?.services?.gateway?.environment || [];
    for (const key of ['API_UPSTREAM', 'WEB_UPSTREAM']) {
      if (!gatewayEnvironment.includes(key)) {
        violations.push({
          file: files.servicePlan,
          reason: `Zeabur gateway 服务计划缺少 ${key}`,
        });
      }
    }
  } catch (error) {
    violations.push({
      file: files.servicePlan,
      reason: 'Zeabur 服务计划不是合法 JSON',
      error: error.message,
    });
  }

  for (const [file, text] of [
    [files.envDoc, envDoc],
    [files.servicePlanDoc, servicePlanDoc],
    [files.gatewayDoc, gatewayDoc],
    [files.runbook, runbook],
  ]) {
    requireSnippet(file, text, 'API_UPSTREAM', '文档缺少 API_UPSTREAM 说明');
    requireSnippet(file, text, 'WEB_UPSTREAM', '文档缺少 WEB_UPSTREAM 说明');
  }
}

if (missingFiles.length > 0 || violations.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'gateway-upstreams-audit',
    missingFiles,
    violations,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'gateway-upstreams-audit',
  checkedFiles: requiredFiles.length,
  checkedVariables: ['API_UPSTREAM', 'WEB_UPSTREAM'],
  defaultUpstreams: {
    api: 'api:8080',
    web: 'web:3000',
  },
}, null, 2));
