# Production Cutover Evidence

本文记录生产切流证据包的格式和审计入口。
它用于把 fresh Zeabur 新库初始化、Zeabur 环境变量审计、Zeabur 远端运行时冒烟、真实登录态 API 冒烟和页面级冒烟的结果结构化，避免只靠聊天记录或人工记忆判断能否切 Gateway。
默认生产策略是不从 Cloudflare D1 迁移历史数据；D1 导入只保留为可选归档迁移路径。

## 运行方式

默认审计 example 模板：

```bash
node scripts/audit-production-cutover-evidence.mjs
```

审计真实证据文件：

```bash
CUTOVER_EVIDENCE_FILE=./deploy/production-cutover-evidence.json node scripts/audit-production-cutover-evidence.mjs
```

强制要求全部模块证据齐全：

```bash
CUTOVER_EVIDENCE_FILE=./deploy/production-cutover-evidence.json CUTOVER_EVIDENCE_STRICT=1 node scripts/audit-production-cutover-evidence.mjs
```

Windows PowerShell：

```powershell
$env:CUTOVER_EVIDENCE_FILE='./deploy/production-cutover-evidence.json'
$env:CUTOVER_EVIDENCE_STRICT='1'
node scripts/audit-production-cutover-evidence.mjs
Remove-Item Env:\CUTOVER_EVIDENCE_FILE
Remove-Item Env:\CUTOVER_EVIDENCE_STRICT
```

## 文件位置

模板文件：

```text
deploy/production-cutover-evidence.example.json
```

真实文件建议放在本地或 Zeabur 私有配置环境中，不要提交真实证据文件。
证据文件只记录复核状态和本地文件路径，不能写入 Cookie、Token、Secret、Authorization 或真实生产密钥。

## 模块证据

当前需要证据包覆盖 6 个仍阻塞生产切流的模块：

- `auth`：Go 登录、`auth/me` 用户同步、登出撤销会话、登录/退出页面级冒烟、Gateway 切流审批。
- `wallet`：new-api 配置、真实登录态 API 冒烟、页面级冒烟、Gateway 切流审批。
- `profile`：新库默认资料/成就状态复核、真实登录态 API 冒烟、页面级冒烟、Gateway 切流审批。
- `notifications`：新库通知/奖励领取默认状态复核、真实登录态 API 冒烟、页面级冒烟、Gateway 切流审批。
- `farm`：新库农场初始状态和种子数据复核、真实登录态 API 冒烟、页面级冒烟、Gateway 切流审批。
- `cards`：新库卡牌规则/默认奖励/后台配置复核、前台/后台真实登录态 API 冒烟、前台/后台页面级冒烟、Gateway 切流审批。

## Zeabur 远端冒烟证据

真实证据包中的 `zeaburEnv.remoteRuntimeSmokePassed` 只有在以下命令通过后才能设为 `true`：

```bash
ZEABUR_RUNTIME_BASE_URL=https://your-domain.example.com ZEABUR_RUNTIME_REQUIRE_REMOTE=1 node scripts/smoke-zeabur-runtime.mjs
```

该检查必须指向 Zeabur 远端 HTTPS 域名。
不能用 localhost、本地 Gateway 或 Docker Compose 结果替代。

## 审计行为

- 模板模式只检查结构、占位值和敏感值泄漏。
- 真实证据文件模式会校验 `generatedAt`、`reviewOwner` 和 `zeaburEnv.envFile` 已替换为真实值。
- 真实证据文件模式会检查 `zeaburEnv.envFile` 指向的本地文件真实存在。
- fresh Zeabur 模式要求 `database.mode=fresh-zeabur`、`database.migrationsApplied=true` 和 `database.seedDataReviewed=true`。
- 如果选择 `database.mode=d1-import`，才要求 `d1Export.file`、`d1Export.dryRunReviewed` 和各模块导入 scope 证据。
- 如果审计时传入 `ZEABUR_ENV_FILE` 或可选的 `D1_EXPORT_SQL`，它们必须分别和证据包里的 `zeaburEnv.envFile`、`d1Export.file` 一致。
- 真实证据文件模式会输出 `readyModules` 与 `blockedModules`。
- 任一模块只要 `gatewayCutoverApproved=true`，该模块必须已经没有 blocker；否则即使不是 strict 模式也会失败。
- 默认模式下 `ready=false` 不会导致脚本失败。
- `CUTOVER_EVIDENCE_STRICT=1` 会在任一模块证据不齐时失败，适合真正切 Gateway 前使用。

## Review 命令

```bash
node --check scripts/audit-production-cutover-evidence.mjs
node scripts/audit-production-cutover-evidence.mjs
node scripts/audit-production-cutover-readiness.mjs
ZEABUR_RUNTIME_BASE_URL=https://your-domain.example.com ZEABUR_RUNTIME_REQUIRE_REMOTE=1 node scripts/smoke-zeabur-runtime.mjs
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
```
