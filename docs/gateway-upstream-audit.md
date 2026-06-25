# Gateway Upstream Audit

本文记录 Gateway 上游变量的一致性审计。
它只做静态检查，不访问网络、不修改 Gateway、不接触数据库。

## 运行方式

```bash
node scripts/audit-gateway-upstreams.mjs
```

## 检查范围

脚本会检查：

- `gateway/Caddyfile` 的活跃 `reverse_proxy` 继续使用 `API_UPSTREAM` 和 `WEB_UPSTREAM`。
- `scripts/start-zeabur.sh` 会在单容器启动时把这两个变量默认注入为本机回环地址。
- `docs/zeabur-deployment-runbook.md` 说明当前 Zeabur 只使用单容器 `app` 服务。

单容器默认值现在是：

- `API_UPSTREAM=127.0.0.1:8081`
- `WEB_UPSTREAM=127.0.0.1:3000`

这些值由启动脚本注入，不需要手动写进 Zeabur 环境变量。
不要直接改 `gateway/Caddyfile` 的路径切流清单。

## Review 命令

```bash
node --check scripts/audit-gateway-upstreams.mjs
node scripts/audit-gateway-upstreams.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
node scripts/audit-gateway-cutover-guard.mjs
node scripts/preflight-zeabur-go-api.mjs
```
