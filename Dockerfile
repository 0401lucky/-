# Zeabur single-container entry.

FROM node:22-alpine AS web-deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS web-builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV SKIP_OPENNEXT_DEV_INIT=1

COPY --from=web-deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM golang:1.23-alpine AS go-builder
WORKDIR /src

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api \
	&& CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/worker ./cmd/worker \
	&& CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate \
	&& CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/migrate-d1 ./cmd/migrate-d1

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV WEB_PORT=3000
ENV API_PORT=8081
ENV GATEWAY_PORT=8080

RUN apk add --no-cache caddy ca-certificates && \
	addgroup -S app && adduser -S app -G app && \
	mkdir -p /data/feedback-media && chown -R app:app /data

COPY --from=web-builder /app/public ./public
COPY --from=web-builder --chown=app:app /app/.next/standalone ./
COPY --from=web-builder --chown=app:app /app/.next/static ./.next/static
COPY --from=go-builder /out/api /app/api
COPY --from=go-builder /out/worker /app/worker
COPY --from=go-builder /out/migrate /app/migrate
COPY --from=go-builder /out/migrate-d1 /app/migrate-d1
COPY --from=go-builder /src/migrations /app/migrations
COPY gateway/Caddyfile /app/gateway/Caddyfile
COPY scripts/start-zeabur.sh /app/start-zeabur.sh

RUN chmod +x /app/start-zeabur.sh && chown -R app:app /app

USER app

EXPOSE 8080

CMD ["/app/start-zeabur.sh"]
