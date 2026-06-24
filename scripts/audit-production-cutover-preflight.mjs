import { existsSync, readFileSync } from 'node:fs';

const preflightPath = 'scripts/preflight-production-cutover.mjs';
const preflightDocPath = 'docs/production-cutover-preflight.md';
const defaultPreflightPath = 'scripts/preflight-zeabur-go-api.mjs';
const guardsTestPath = 'scripts/test-production-cutover-guards.mjs';

const requiredFiles = [
  preflightPath,
  preflightDocPath,
  defaultPreflightPath,
  guardsTestPath,
];

const requiredPreflightSnippets = [
  "['CUTOVER_EVIDENCE_FILE', process.env.CUTOVER_EVIDENCE_FILE]",
  "['ZEABUR_ENV_FILE', process.env.ZEABUR_ENV_FILE]",
  "['ZEABUR_RUNTIME_BASE_URL', process.env.ZEABUR_RUNTIME_BASE_URL]",
  'const optionalEnvFiles = [',
  "'D1_EXPORT_SQL'",
  "deploymentMode: process.env.D1_EXPORT_SQL ? 'd1-import' : 'fresh-zeabur'",
  String.raw`/\.example(?:\.|$)/`,
  "runtimeURL.protocol !== 'https:'",
  'isLocalHost(runtimeURL.hostname)',
  "'deploy secret hygiene audit'",
  "'scripts/audit-deploy-secret-hygiene.mjs'",
  "'gateway upstreams audit'",
  "'scripts/audit-gateway-upstreams.mjs'",
  "'gateway guard'",
  "'scripts/audit-gateway-cutover-guard.mjs'",
  "'gateway allowed cutovers audit'",
  "'scripts/audit-gateway-allowed-cutovers.mjs'",
  "'production cutover evidence strict audit'",
  "'scripts/audit-production-cutover-evidence.mjs'",
  "CUTOVER_EVIDENCE_STRICT: '1'",
  "D1_EXPORT_SQL: process.env.D1_EXPORT_SQL || ''",
  "'production cutover readiness strict audit'",
  "'scripts/audit-production-cutover-readiness.mjs'",
  "PRODUCTION_CUTOVER_READINESS_STRICT: '1'",
  "D1_EXPORT_SQL: process.env.D1_EXPORT_SQL || ''",
  'ZEABUR_ENV_FILE: process.env.ZEABUR_ENV_FILE',
  'ZEABUR_RUNTIME_BASE_URL: process.env.ZEABUR_RUNTIME_BASE_URL',
];

const requiredDocSnippets = [
  'CUTOVER_EVIDENCE_FILE=./deploy/production-cutover-evidence.json ZEABUR_ENV_FILE=./deploy/zeabur.env ZEABUR_RUNTIME_BASE_URL=https://your-domain.example.com node scripts/preflight-production-cutover.mjs',
  '`CUTOVER_EVIDENCE_FILE`：真实生产切流证据包，不能是 example。',
  '`D1_EXPORT_SQL` 是可选的真实 D1 导出 SQL 文件，仅在选择 d1-import 归档迁移时传入。',
  '`ZEABUR_ENV_FILE`：真实 Zeabur 环境变量文件。',
  '`ZEABUR_RUNTIME_BASE_URL`：Zeabur 远端 HTTPS 域名。',
  '`CUTOVER_EVIDENCE_FILE` 和 `ZEABUR_ENV_FILE` 不能指向 `.example` 文件。',
  'example 证据/env 文件必须失败。',
  '可选 D1 文件如果指向 example 也必须失败。',
  'fresh Zeabur 部署不要求 Cloudflare D1 导出。',
  '`ZEABUR_RUNTIME_BASE_URL` 必须是 `https://`',
  '部署产物敏感信息卫生审计',
  'Gateway 上游一致性审计',
  'Gateway 禁切守卫',
  'Gateway 允许切流清单审计',
  '生产证据包 strict 审计',
  '生产 readiness strict 审计',
  'node scripts/audit-production-cutover-preflight.mjs',
];

const requiredDefaultPreflightSnippets = [
  "'production cutover preflight audit'",
  "'scripts/audit-production-cutover-preflight.mjs'",
  "'production cutover guards test'",
  "'scripts/test-production-cutover-guards.mjs'",
];

const requiredGuardTestSnippets = [
  "'missing production cutover inputs'",
  "'example production cutover inputs'",
  "'optional example d1 export input'",
  "'local runtime url'",
  "'gateway approval before blockers resolved'",
  "'zeabur env evidence mismatch'",
  "'d1 export evidence mismatch'",
  "'d1 import evidence mismatch'",
];

const missingFiles = requiredFiles.filter((file) => !existsSync(file));

const preflight = existsSync(preflightPath) ? readFileSync(preflightPath, 'utf8') : '';
const doc = existsSync(preflightDocPath) ? readFileSync(preflightDocPath, 'utf8') : '';
const defaultPreflight = existsSync(defaultPreflightPath) ? readFileSync(defaultPreflightPath, 'utf8') : '';
const guardsTest = existsSync(guardsTestPath) ? readFileSync(guardsTestPath, 'utf8') : '';

const missingPreflightSnippets = requiredPreflightSnippets
  .filter((snippet) => !preflight.includes(snippet));
const missingDocSnippets = requiredDocSnippets
  .filter((snippet) => !doc.includes(snippet));
const missingDefaultPreflightSnippets = requiredDefaultPreflightSnippets
  .filter((snippet) => !defaultPreflight.includes(snippet));
const missingGuardTestSnippets = requiredGuardTestSnippets
  .filter((snippet) => !guardsTest.includes(snippet));

if (
  missingFiles.length > 0 ||
  missingPreflightSnippets.length > 0 ||
  missingDocSnippets.length > 0 ||
  missingDefaultPreflightSnippets.length > 0 ||
  missingGuardTestSnippets.length > 0
) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'production-cutover-preflight-audit',
    missingFiles,
    missingPreflightSnippets,
    missingDocSnippets,
    missingDefaultPreflightSnippets,
    missingGuardTestSnippets,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'production-cutover-preflight-audit',
  checkedFiles: requiredFiles.length,
  checkedPreflightSnippets: requiredPreflightSnippets.length,
  checkedDocSnippets: requiredDocSnippets.length,
  checkedDefaultPreflightSnippets: requiredDefaultPreflightSnippets.length,
  checkedGuardTestSnippets: requiredGuardTestSnippets.length,
}, null, 2));
