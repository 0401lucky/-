import { existsSync, readFileSync } from 'node:fs';

const files = {
  caddyfile: 'gateway/Caddyfile',
  startScript: 'scripts/start-zeabur.sh',
};

const requiredSnippets = {
  caddyfile: [
    ':{$PORT:8080} {',
    'reverse_proxy {$API_UPSTREAM:api:8080}',
    'reverse_proxy {$WEB_UPSTREAM:web:3000}',
  ],
  startScript: [
    'WEB_PORT="${WEB_PORT:-3000}"',
    'API_PORT="${API_PORT:-8081}"',
    'GATEWAY_PORT="${GATEWAY_PORT:-8080}"',
    'export API_UPSTREAM="${API_UPSTREAM:-127.0.0.1:${API_PORT}}"',
    'export WEB_UPSTREAM="${WEB_UPSTREAM:-127.0.0.1:${WEB_PORT}}"',
    'PORT="$GATEWAY_PORT"',
    'APP_MODE=api PORT="$API_PORT" /app/api &',
    'APP_MODE=worker /app/worker &',
    'PORT="$WEB_PORT" node /app/server.js &',
    'caddy run --config /app/gateway/Caddyfile --adapter caddyfile &',
  ],
};

function read(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function hasHardcodedUpstream(text) {
  return text.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed === 'reverse_proxy api:8080' || trimmed === 'reverse_proxy web:3000';
  });
}

const missingFiles = Object.values(files).filter((file) => !existsSync(file));
const missingSnippets = [];
const violations = [];

for (const [key, file] of Object.entries(files)) {
  if (!existsSync(file)) {
    continue;
  }
  const text = read(file);
  const missing = requiredSnippets[key].filter((snippet) => !text.includes(snippet));
  if (missing.length > 0) {
    missingSnippets.push({ file, missing });
  }
  if (key === 'caddyfile' && hasHardcodedUpstream(text)) {
    violations.push({
      file,
      reason: 'gateway/Caddyfile 不能硬编码 api:8080 或 web:3000，必须通过启动脚本注入的上游变量转发',
    });
  }
}

if (missingFiles.length > 0 || missingSnippets.length > 0 || violations.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'gateway-upstreams-audit',
    missingFiles,
    missingSnippets,
    violations,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'gateway-upstreams-audit',
  checkedFiles: Object.values(files).length,
  checkedVariables: ['API_UPSTREAM', 'WEB_UPSTREAM', 'WEB_PORT', 'API_PORT', 'GATEWAY_PORT'],
  defaultUpstreams: {
    api: '127.0.0.1:8081',
    web: '127.0.0.1:3000',
  },
}, null, 2));
