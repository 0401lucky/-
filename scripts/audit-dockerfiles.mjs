import { existsSync, readFileSync } from 'node:fs';

const files = {
  web: 'Dockerfile',
  backend: 'backend/Dockerfile',
  gateway: 'gateway/Dockerfile',
  dockerignore: '.dockerignore',
};

const requiredSnippets = {
  web: [
    'FROM node:22-alpine AS deps',
    'RUN npm ci',
    'FROM node:22-alpine AS builder',
    'ENV NEXT_TELEMETRY_DISABLED=1',
    'ENV SKIP_OPENNEXT_DEV_INIT=1',
    'RUN npm run build',
    'FROM node:22-alpine AS runner',
    'ENV NODE_ENV=production',
    'ENV HOSTNAME=0.0.0.0',
    'COPY --from=builder /app/public ./public',
    'COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./',
    'COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static',
    'USER nextjs',
    'EXPOSE 3000',
    'CMD ["node", "server.js"]',
  ],
  backend: [
    'FROM golang:1.23-alpine AS builder',
    'RUN go mod download',
    'CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build',
    '-o /out/api ./cmd/api',
    '-o /out/worker ./cmd/worker',
    '-o /out/migrate ./cmd/migrate',
    '-o /out/migrate-d1 ./cmd/migrate-d1',
    'FROM alpine:3.20',
    'RUN adduser -D -H appuser',
    'COPY --from=builder /out/api /app/api',
    'COPY --from=builder /out/worker /app/worker',
    'COPY --from=builder /out/migrate /app/migrate',
    'COPY --from=builder /out/migrate-d1 /app/migrate-d1',
    'COPY migrations /app/migrations',
    'USER appuser',
    'EXPOSE 8080',
    'CMD ["/app/api"]',
  ],
  gateway: [
    'FROM caddy:2-alpine',
    'COPY Caddyfile /etc/caddy/Caddyfile',
    'EXPOSE 8080',
  ],
  dockerignore: [
    'node_modules',
    '.next',
    '.open-next',
    '.wrangler',
    '.env',
    '.env.*',
    'backend',
    'gateway',
    'backups',
  ],
};

const missingFiles = Object.values(files).filter((file) => !existsSync(file));
const missingSnippets = [];

for (const [name, file] of Object.entries(files)) {
  if (!existsSync(file)) {
    continue;
  }
  const content = readFileSync(file, 'utf8');
  const missing = requiredSnippets[name].filter((snippet) => !content.includes(snippet));
  if (missing.length > 0) {
    missingSnippets.push({ file, missing });
  }
}

if (missingFiles.length > 0 || missingSnippets.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'dockerfile-audit',
    missingFiles,
    missingSnippets,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'dockerfile-audit',
  checkedFiles: Object.values(files),
  checkedSnippets: Object.values(requiredSnippets).reduce((count, snippets) => count + snippets.length, 0),
}, null, 2));
