# 生产切流准备审计

本文记录剩余高风险模块在真实切流前的可执行准备检查。
它用于回答“现在到底还差什么才能切”，不用于自动打开 Gateway。
真实切流前还需要维护 `docs/production-cutover-evidence.md` 定义的证据包，避免 fresh Zeabur 新库初始化、Zeabur 远端运行时冒烟、真实登录态 API 冒烟和页面级冒烟结果只停留在人工记录里。
当前生产策略是不从 Cloudflare D1 迁移历史数据；D1 导入只作为可选归档迁移路径。

## 运行方式

本地默认审计：

```bash
node scripts/audit-production-cutover-readiness.mjs
```

如果有 Zeabur 环境变量文件：

```bash
ZEABUR_ENV_FILE=./deploy/zeabur.env node scripts/audit-production-cutover-readiness.mjs
```

如果已有 Zeabur 远端 HTTPS 域名：

```bash
ZEABUR_RUNTIME_BASE_URL=https://your-domain.example.com node scripts/audit-production-cutover-readiness.mjs
```

传入 `ZEABUR_RUNTIME_BASE_URL` 时，readiness 会强制使用远端模式运行：

```bash
ZEABUR_RUNTIME_BASE_URL=https://your-domain.example.com ZEABUR_RUNTIME_REQUIRE_REMOTE=1 node scripts/smoke-zeabur-runtime.mjs
```

如果地址不是 HTTPS，或指向 localhost / loopback，readiness 会直接失败。

如果已经维护真实证据包：

```bash
CUTOVER_EVIDENCE_FILE=./deploy/production-cutover-evidence.json node scripts/audit-production-cutover-readiness.mjs
```

真实切流前可以启用严格模式：

```bash
PRODUCTION_CUTOVER_READINESS_STRICT=1 CUTOVER_EVIDENCE_FILE=./deploy/production-cutover-evidence.json node scripts/audit-production-cutover-readiness.mjs
```

严格模式下，只要 `ready:false` 就会退出非 0，适合 CI 或最终切流门禁。

传入 `CUTOVER_EVIDENCE_FILE` 后，readiness 会读取证据包审计结果，并把 `modules[].blockers` 合并到对应模块的 readiness 缺口中。
如果证据包结构有效但证据未齐，readiness 仍会保持 `ok: true`、`ready: false`，并在模块 blocker 中显示 `证据包未满足: ...`。
如果同时传入可选的 `D1_EXPORT_SQL` 或 `ZEABUR_ENV_FILE`，readiness 会把它们传给证据包审计，校验证据包里的 `d1Export.file` 与 `zeaburEnv.envFile` 是否一致。

传入 `ZEABUR_ENV_FILE` 时，脚本会先运行：

```bash
ZEABUR_ENV_FILE=./deploy/zeabur.env node scripts/audit-zeabur-runtime-env.mjs
```

如果真实 env 仍有占位值、本地地址、非 HTTPS URL、过短密钥或缺失关键变量，readiness 会直接失败。

Windows PowerShell：

```powershell
$env:ZEABUR_ENV_FILE='./deploy/zeabur.env'
node scripts/audit-production-cutover-readiness.mjs
Remove-Item Env:\ZEABUR_ENV_FILE
```

## 输出含义

- `ok: true`：审计脚本本身、必需文档、必需门禁脚本、真实 env 审计、可选 Zeabur 远端运行时冒烟、Gateway 上游一致性审计和 Gateway 禁切守卫通过。
- `ready: false`：仍缺真实 Cookie、生产配置、远端冒烟或证据审批。这是预期状态，不代表脚本失败。
- `strict: true`：启用严格模式；此时 `ready:false` 会使脚本失败。
- `evidenceAudit.ok: true`：证据包模板或真实证据文件结构有效，且没有 Cookie、Token、Secret 泄漏。
- `evidenceAudit.ready: false`：传入真实证据文件时，证据包仍有模块未满足；这些缺口会合并到 `modules[].blockers`。
- `remoteRuntimeSmoke.ok: true`：未传 `ZEABUR_RUNTIME_BASE_URL` 时表示跳过；传入后表示 Zeabur 远端 HTTPS 冒烟通过。
- `blockedModules`：当前还不能进入生产切流评估的模块。
- `modules[].blockers`：每个模块的具体缺口。
- `requiredReviewCommands`：补齐条件后需要执行的复核命令。

## 当前审计模块

审计覆盖以下仍禁止通配切流的模块：

- `wallet`：需要 new-api 管理端配置和真实登录态只读余额冒烟。
- `auth`：需要 Go 登录、`auth/me` 用户同步、登出撤销会话和真实登录/退出页面冒烟。
- `profile`：需要新库默认资料/成就状态复核和真实登录态冒烟。
- `notifications`：需要新库通知/奖励领取默认状态复核和真实登录态冒烟。
- `farm`：需要新库农场初始状态、种子数据、真实登录态直连冒烟和页面级冒烟。
- `cards`：需要新库卡牌规则/默认奖励/后台配置、真实用户和管理员样本冒烟。

## 可选输入

脚本会读取当前环境变量，也可以通过 `ZEABUR_ENV_FILE` 读取一个本地 env 文件。
敏感值只用于判断是否存在，不会打印具体内容。

可选变量：

- `D1_EXPORT_SQL`
- `ZEABUR_RUNTIME_BASE_URL`
- `NEW_API_URL`
- `NEW_API_ADMIN_ACCESS_TOKEN`
- `NEW_API_ADMIN_USER_ID`
- `AUTH_GO_API_COOKIE`
- `WALLET_GO_API_COOKIE`
- `PROFILE_GO_API_COOKIE`
- `NOTIFICATIONS_GO_API_COOKIE`
- `FARM_GO_API_COOKIE`
- `CARDS_GO_API_COOKIE`
- `ADMIN_CARDS_GO_API_COOKIE`

## 仍禁止的动作

即使某个模块显示 `ready: true`，也不能直接打开通配。
仍必须完成独立 review，并只评估精确路径切流。

继续禁止：

- `/api/farm*`
- `/api/auth*`
- `/api/profile*`
- `/api/notifications*`
- `/api/store/topup`
- `/api/store/withdraw`
- `/api/cards*`
- `/api/admin/cards*`
- `/api/games/*`
- `/api/projects/*`
- `/api/admin/*`

## Review 命令

```bash
node --check scripts/audit-production-cutover-readiness.mjs
node scripts/audit-production-cutover-evidence.mjs
node scripts/audit-production-cutover-readiness.mjs
CUTOVER_EVIDENCE_FILE=./deploy/production-cutover-evidence.example.json node scripts/audit-production-cutover-readiness.mjs
PRODUCTION_CUTOVER_READINESS_STRICT=1 CUTOVER_EVIDENCE_FILE=./deploy/production-cutover-evidence.example.json node scripts/audit-production-cutover-readiness.mjs
ZEABUR_ENV_FILE=./deploy/zeabur.env node scripts/audit-production-cutover-readiness.mjs
ZEABUR_RUNTIME_BASE_URL=https://your-domain.example.com node scripts/audit-production-cutover-readiness.mjs
node scripts/audit-gateway-upstreams.mjs
node scripts/audit-gateway-cutover-guard.mjs
```
