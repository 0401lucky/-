# Gateway Upstream Audit

本文记录 Gateway 上游变量的一致性审计。
它只做静态检查，不访问网络、不修改 Gateway、不接触数据库。

## 运行方式

```bash
node scripts/audit-gateway-upstreams.mjs
```

## 检查范围

脚本会检查：

- `gateway/Caddyfile` 的活跃 `reverse_proxy` 使用 `API_UPSTREAM` 和 `WEB_UPSTREAM`。
- `compose.yml` 保留本地默认 `API_UPSTREAM=api:8080` 和 `WEB_UPSTREAM=web:3000`。
- `deploy/zeabur.env.example` 声明这两个变量。
- `deploy/zeabur-services.example.json` 的 `gateway` 服务声明这两个变量。
- Zeabur env 文档、服务计划文档、Gateway 允许清单文档和部署运行手册都说明这两个变量。

默认值仍然是：

- `API_UPSTREAM=api:8080`
- `WEB_UPSTREAM=web:3000`

Zeabur 内网服务名或端口不同的时候，只覆盖变量值。
不要直接改 `gateway/Caddyfile` 的路径切流清单。

## Review 命令

```bash
node --check scripts/audit-gateway-upstreams.mjs
node scripts/audit-gateway-upstreams.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
node scripts/audit-gateway-cutover-guard.mjs
node scripts/preflight-zeabur-go-api.mjs
```
