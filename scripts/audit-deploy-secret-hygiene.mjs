import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = [
  'deploy/zeabur.env.example',
  'deploy/zeabur-services.example.json',
  'deploy/production-cutover-evidence.example.json',
  'docs/zeabur-env-audit.md',
  'docs/zeabur-service-plan.md',
  'docs/production-cutover-evidence.md',
  'docs/production-cutover-readiness.md',
  'docs/production-cutover-preflight.md',
  'docs/zeabur-deployment-runbook.md',
  'docs/gateway-upstream-audit.md',
];

const allowedPlaceholders = [
  'replace-with-',
  'your-domain.example.com',
  'your-new-api.example.com',
  'r2.example.com',
  'account-id.r2.cloudflarestorage.com',
  '${POSTGRES_CONNECTION_STRING}',
  '${REDIS_CONNECTION_STRING}',
];

const sensitiveValuePatterns = [
  { name: 'bearer-token', pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i },
  { name: 'cookie-session', pattern: /\b(session|connect\.sid|next-auth\.session-token|cf_clearance)=([^;\s]{16,})/i },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'openai-style-key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private-key-block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
  { name: 'long-secret-assignment', pattern: /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*(?!replace-with-|your-|[$][{])[A-Za-z0-9._~+/=-]{24,}/ },
];

const missingFiles = files.filter((file) => !existsSync(file));
const violations = [];
const requiredIgnoreEntries = [
  ['.gitignore', '/deploy/zeabur.env'],
  ['.gitignore', '/deploy/production-cutover-evidence.json'],
  ['.dockerignore', 'deploy/zeabur.env'],
  ['.dockerignore', 'deploy/production-cutover-evidence.json'],
];
const forbiddenTrackedFiles = [
  'deploy/zeabur.env',
  'deploy/production-cutover-evidence.json',
];
const missingIgnoreEntries = [];
const trackedForbiddenFiles = [];

function isAllowedPlaceholder(line) {
  return allowedPlaceholders.some((placeholder) => line.includes(placeholder));
}

for (const file of files) {
  if (!existsSync(file)) {
    continue;
  }
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (isAllowedPlaceholder(line)) {
      return;
    }
    for (const { name, pattern } of sensitiveValuePatterns) {
      if (pattern.test(line)) {
        violations.push({
          file,
          lineNumber: index + 1,
          pattern: name,
          line: line.trim().slice(0, 160),
        });
      }
    }
  });
}

for (const [file, entry] of requiredIgnoreEntries) {
  if (!existsSync(file)) {
    missingIgnoreEntries.push({ file, entry, reason: 'ignore file missing' });
    continue;
  }
  const lines = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim());
  if (!lines.includes(entry)) {
    missingIgnoreEntries.push({ file, entry });
  }
}

const gitResult = spawnSync('git', ['ls-files', '--', ...forbiddenTrackedFiles], {
  encoding: 'utf8',
  timeout: 60000,
  maxBuffer: 1024 * 1024,
});
if (gitResult.status === 0) {
  trackedForbiddenFiles.push(
    ...gitResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
} else {
  violations.push({
    file: '.git',
    lineNumber: 0,
    pattern: 'git-ls-files',
    line: (gitResult.stderr || gitResult.stdout || 'git ls-files failed').trim().slice(0, 160),
  });
}

if (
  missingFiles.length > 0 ||
  violations.length > 0 ||
  missingIgnoreEntries.length > 0 ||
  trackedForbiddenFiles.length > 0
) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'deploy-secret-hygiene-audit',
    missingFiles,
    violations,
    missingIgnoreEntries,
    trackedForbiddenFiles,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'deploy-secret-hygiene-audit',
  checkedFiles: files.length,
  checkedIgnoreEntries: requiredIgnoreEntries.length,
  checkedForbiddenTrackedFiles: forbiddenTrackedFiles.length,
  checkedPatterns: sensitiveValuePatterns.map((pattern) => pattern.name),
}, null, 2));
