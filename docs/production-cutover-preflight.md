# Production Cutover Preflight

本文记录生产切流前最终预检入口。
它和默认 Zeabur 预检不同：默认预检用于日常本地/部署检查，本脚本必须提供真实生产证据输入，任一项不满足都会失败。

## 运行方式

```bash
CUTOVER_EVIDENCE_FILE=./deploy/production-cutover-evidence.json ZEABUR_ENV_FILE=./deploy/zeabur.env ZEABUR_RUNTIME_BASE_URL=https://your-domain.example.com node scripts/preflight-production-cutover.mjs
```

Windows PowerShell：

```powershell
$env:CUTOVER_EVIDENCE_FILE='./deploy/production-cutover-evidence.json'
$env:ZEABUR_ENV_FILE='./deploy/zeabur.env'
$env:ZEABUR_RUNTIME_BASE_URL='https://your-domain.example.com'
node scripts/preflight-production-cutover.mjs
Remove-Item Env:\CUTOVER_EVIDENCE_FILE
Remove-Item Env:\ZEABUR_ENV_FILE
Remove-Item Env:\ZEABUR_RUNTIME_BASE_URL
```

## 必需输入

- `CUTOVER_EVIDENCE_FILE`：真实生产切流证据包，不能是 example。
- `ZEABUR_ENV_FILE`：真实 Zeabur 环境变量文件。
- `ZEABUR_RUNTIME_BASE_URL`：Zeabur 远端 HTTPS 域名。

`CUTOVER_EVIDENCE_FILE` 和 `ZEABUR_ENV_FILE` 不能指向 `.example` 文件。
`ZEABUR_RUNTIME_BASE_URL` 必须是 `https://`，且不能是 localhost、127.0.0.1、0.0.0.0 或 loopback 地址。

fresh Zeabur 部署不要求 Cloudflare D1 导出。
`D1_EXPORT_SQL` 是可选的真实 D1 导出 SQL 文件，仅在选择 d1-import 归档迁移时传入。
如果传入 `D1_EXPORT_SQL`，它必须和证据包里的 `d1Export.file` 一致，且不能指向 `.example` 文件。

## 执行门禁

脚本会串联：

- 部署产物敏感信息卫生审计。
- Gateway 上游一致性审计。
- Gateway 禁切守卫。
- Gateway 允许切流清单审计。
- 生产证据包 strict 审计。
- 生产 readiness strict 审计。

生产 readiness strict 审计会进一步执行真实 env 审计和 Zeabur 远端 HTTPS 冒烟。
只有全部通过，才表示具备进入精确 Gateway 切流评估的条件。

## 漂移审计

`scripts/audit-production-cutover-preflight.mjs` 会静态校验最终预检入口、本文档和默认 Zeabur 总预检。
它会拦截以下漂移：

- 必需生产输入或 `.example` 拦截被移除。
- `ZEABUR_RUNTIME_BASE_URL` 的 HTTPS / 非本地地址校验被移除。
- 敏感信息、Gateway 上游、Gateway 双门禁、证据包 strict、readiness strict 任一门禁步骤缺失。
- 默认总预检没有继续覆盖最终预检脚本审计。

`scripts/test-production-cutover-guards.mjs` 会自动验证最终预检和证据包审计的关键失败路径：

- 缺少生产输入必须失败。
- example 证据/env 文件必须失败。
- 可选 D1 文件如果指向 example 也必须失败。
- 本地或非 HTTPS 运行时 URL 必须失败。
- 证据未齐时提前 `gatewayCutoverApproved=true` 必须失败。
- `ZEABUR_ENV_FILE` 和证据包路径不一致必须失败。
- 选择 d1-import 归档迁移时，`D1_EXPORT_SQL` 和证据包路径不一致必须失败。

## Review 命令

```bash
node --check scripts/audit-production-cutover-preflight.mjs
node scripts/audit-production-cutover-preflight.mjs
node --check scripts/test-production-cutover-guards.mjs
node scripts/test-production-cutover-guards.mjs
node --check scripts/preflight-production-cutover.mjs
node scripts/preflight-production-cutover.mjs
node scripts/audit-production-cutover-readiness.mjs
node scripts/preflight-zeabur-go-api.mjs
```
