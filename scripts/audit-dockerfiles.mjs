import { existsSync, readFileSync } from 'node:fs';

const rootDockerfile = 'Dockerfile';
const startScript = 'scripts/start-zeabur.sh';
const dockerignore = '.dockerignore';
const caddyfile = 'gateway/Caddyfile';

const forbiddenRootDockerfiles = [
  'Dockerfile.app',
  'Dockerfile.web',
  'Dockerfile.api',
  'Dockerfile.worker',
  'Dockerfile.gateway',
];

const requiredSnippets = {
  [rootDockerfile]: [
    '# Zeabur single-container entry.',
    'FROM node:22-alpine AS web-deps',
    'FROM node:22-alpine AS web-builder',
    'FROM golang:1.23-alpine AS go-builder',
    'FROM node:22-alpine AS runtime',
    'RUN apk add --no-cache caddy ca-certificates',
    'COPY --from=web-builder /app/public ./public',
    'COPY --from=web-builder --chown=app:app /app/.next/standalone ./',
    'COPY --from=web-builder --chown=app:app /app/.next/static ./.next/static',
    'COPY --from=go-builder /out/api /app/api',
    'COPY --from=go-builder /out/worker /app/worker',
    'COPY --from=go-builder /out/migrate /app/migrate',
    'COPY --from=go-builder /out/migrate-d1 /app/migrate-d1',
    'COPY --from=go-builder /src/migrations /app/migrations',
    'COPY gateway/Caddyfile /app/gateway/Caddyfile',
    'COPY scripts/start-zeabur.sh /app/start-zeabur.sh',
    'CMD ["/app/start-zeabur.sh"]',
  ],
  [startScript]: [
    '#!/bin/sh',
    'WEB_PORT="${WEB_PORT:-3000}"',
    'API_PORT="${API_PORT:-8081}"',
    'GATEWAY_PORT="${GATEWAY_PORT:-8080}"',
    'APP_MODE=api PORT="$API_PORT" /app/api &',
    'APP_MODE=worker /app/worker &',
    'PORT="$WEB_PORT" node /app/server.js &',
    'caddy run --config /app/gateway/Caddyfile --adapter caddyfile &',
  ],
  [dockerignore]: [
    'node_modules',
    '.next',
    '.open-next',
    '.wrangler',
    '.vercel',
    '.gocache',
    '.tmp',
    '.git',
    '.env',
    '.env.*',
    '.dev.vars',
    '/images',
    'backups',
  ],
  [caddyfile]: [
    ':{$PORT:8080} {',
    'handle /healthz {',
    'handle /readyz {',
    'reverse_proxy {$API_UPSTREAM:api:8080}',
    'reverse_proxy {$WEB_UPSTREAM:web:3000}',
  ],
};

const missingFiles = [rootDockerfile, startScript, dockerignore, caddyfile].filter((file) => !existsSync(file));
const forbiddenFiles = forbiddenRootDockerfiles.filter((file) => existsSync(file));
const missingSnippets = [];

for (const file of [rootDockerfile, startScript, dockerignore, caddyfile]) {
  if (!existsSync(file)) {
    continue;
  }
  const content = readFileSync(file, 'utf8');
  const missing = (requiredSnippets[file] || []).filter((snippet) => !content.includes(snippet));
  if (missing.length > 0) {
    missingSnippets.push({ file, missing });
  }
}

if (missingFiles.length > 0 || forbiddenFiles.length > 0 || missingSnippets.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'dockerfile-audit',
    missingFiles,
    forbiddenFiles,
    missingSnippets,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'dockerfile-audit',
  checkedFiles: [rootDockerfile, startScript, dockerignore, caddyfile],
  checkedSnippets: Object.values(requiredSnippets).reduce((count, snippets) => count + snippets.length, 0),
}, null, 2));
