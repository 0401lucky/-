# Production Evidence Collection Runbook

本文记录 Zeabur 测试部署后，如何收集严格生产 readiness 所需的真实证据。

当前 fresh Zeabur 策略：

- 不从 Cloudflare D1 导入历史数据。
- 先运行 `/app/migrate` 初始化 PostgreSQL。
- 只用测试账号和管理员账号做真实登录态冒烟。
- 不把 Cookie、Token、Secret 或真实生产密钥提交到仓库。

## 前置步骤

1. 部署 GHCR 镜像：

```text
ghcr.io/0401lucky/redemption-zeabur:latest
Port: 8080
```

2. 进入 Zeabur app shell 执行 migration：

```bash
/app/migrate
```

3. 检查远端健康状态：

```bash
ZEABUR_RUNTIME_BASE_URL=https://你的域名 ZEABUR_RUNTIME_REQUIRE_REMOTE=1 node scripts/smoke-zeabur-runtime.mjs
```

4. 准备本地私有证据文件：

```text
deploy/production-cutover-evidence.json
```

可以从 `deploy/production-cutover-evidence.example.json` 复制，但不要提交真实证据文件。

## Cookie 获取方式

用测试账号登录 Zeabur 域名后，从浏览器开发者工具复制请求 Cookie。

建议只复制测试账号 Cookie，并且仅保存在本地终端环境变量中：

```bash
AUTH_GO_API_COOKIE='app_session=...'
WALLET_GO_API_COOKIE='app_session=...'
PROFILE_GO_API_COOKIE='app_session=...'
NOTIFICATIONS_GO_API_COOKIE='app_session=...'
FARM_GO_API_COOKIE='app_session=...'
CARDS_GO_API_COOKIE='app_session=...'
ADMIN_CARDS_GO_API_COOKIE='app_session=...'
```

Windows PowerShell 示例：

```powershell
$env:AUTH_GO_API_COOKIE='app_session=...'
$env:WALLET_GO_API_COOKIE='app_session=...'
$env:PROFILE_GO_API_COOKIE='app_session=...'
$env:NOTIFICATIONS_GO_API_COOKIE='app_session=...'
$env:FARM_GO_API_COOKIE='app_session=...'
$env:CARDS_GO_API_COOKIE='app_session=...'
$env:ADMIN_CARDS_GO_API_COOKIE='app_session=...'
```

证据文件只记录 smoke 是否通过，不记录 Cookie 原文。

## Auth 证据

命令：

```bash
node scripts/smoke-auth-login-go-api.mjs
AUTH_GO_API_COOKIE='app_session=...' node scripts/smoke-auth-me-go-api.mjs
AUTH_GO_API_COOKIE='app_session=...' node scripts/smoke-auth-logout-go-api.mjs
```

页面冒烟：

- 打开 `/login`。
- 使用测试账号登录。
- 访问 `/api/auth/me` 或刷新首页确认用户态存在。
- 执行退出登录，确认旧 Cookie 失效。

证据包字段：

- `modules.auth.loginApiSmokePassed`
- `modules.auth.meApiSmokePassed`
- `modules.auth.logoutApiSmokePassed`
- `modules.auth.pageSmokePassed`

## Wallet 证据

前提：

- `NEW_API_URL` 已配置。
- `NEW_API_ADMIN_ACCESS_TOKEN` 是 new-api 管理员系统访问令牌。
- `NEW_API_ADMIN_USER_ID` 是同一管理员账号数字 ID。

命令：

```bash
WALLET_GO_API_COOKIE='app_session=...' WALLET_GO_API_EXPECT_NEW_API=1 node scripts/smoke-wallet-go-api.mjs
```

页面冒烟：

- 打开商城或钱包入口。
- 查询余额。
- 使用小额测试完成积分充值额度。
- 使用小额测试完成额度提现积分。
- 核对 new-api 后台有对应额度记录。

证据包字段：

- `modules.wallet.newApiConfigured`
- `modules.wallet.authenticatedApiSmokePassed`
- `modules.wallet.pageSmokePassed`

## Profile 证据

命令：

```bash
PROFILE_GO_API_COOKIE='app_session=...' node scripts/smoke-profile-go-api.mjs
```

页面冒烟：

- 打开个人主页。
- 修改或读取资料设置。
- 确认默认成就/统计不报错。

证据包字段：

- `modules.profile.authenticatedApiSmokePassed`
- `modules.profile.pageSmokePassed`

## Notifications 证据

命令：

```bash
NOTIFICATIONS_GO_API_COOKIE='app_session=...' node scripts/smoke-notifications-go-api.mjs
```

页面冒烟：

- 打开通知中心。
- 查看公告或系统通知详情。
- 检查未读数量接口正常。

证据包字段：

- `modules.notifications.authenticatedApiSmokePassed`
- `modules.notifications.pageSmokePassed`

## Farm 证据

命令：

```bash
FARM_GO_API_COOKIE='app_session=...' node scripts/smoke-farm-go-api.mjs
```

页面冒烟：

- 打开农场。
- 检查初始地块和作物状态。
- 做一次购买、种植、收获或可逆的小额操作。
- 确认积分扣减和状态更新一致。

证据包字段：

- `modules.farm.authenticatedApiSmokePassed`
- `modules.farm.pageSmokePassed`

## Cards 证据

前台命令：

```bash
CARDS_GO_API_COOKIE='app_session=...' node scripts/smoke-cards-go-api.mjs
```

后台命令：

```bash
ADMIN_CARDS_GO_API_COOKIE='app_session=...' node scripts/smoke-admin-cards-go-api.mjs
```

页面冒烟：

- 打开 `/cards`。
- 查看规则、库存、抽卡入口。
- 用管理员账号打开 `/admin/cards`。
- 检查规则和配置页不报错。

证据包字段：

- `modules.cards.authenticatedApiSmokePassed`
- `modules.cards.adminAuthenticatedApiSmokePassed`
- `modules.cards.pageSmokePassed`
- `modules.cards.adminPageSmokePassed`

## 审计证据文件

填写本地证据文件后运行：

```bash
CUTOVER_EVIDENCE_FILE=./deploy/production-cutover-evidence.json node scripts/audit-production-cutover-evidence.mjs
CUTOVER_EVIDENCE_FILE=./deploy/production-cutover-evidence.json node scripts/audit-production-cutover-readiness.mjs
```

严格模式：

```bash
CUTOVER_EVIDENCE_FILE=./deploy/production-cutover-evidence.json CUTOVER_EVIDENCE_STRICT=1 node scripts/audit-production-cutover-evidence.mjs
```

完成标准：

- `blockedModules = []`
- `readyModules` 包含 `auth`、`wallet`、`profile`、`notifications`、`farm`、`cards`
- `productionEvidenceReady = true`

## 清理本地敏感环境变量

PowerShell：

```powershell
Remove-Item Env:\AUTH_GO_API_COOKIE -ErrorAction SilentlyContinue
Remove-Item Env:\WALLET_GO_API_COOKIE -ErrorAction SilentlyContinue
Remove-Item Env:\PROFILE_GO_API_COOKIE -ErrorAction SilentlyContinue
Remove-Item Env:\NOTIFICATIONS_GO_API_COOKIE -ErrorAction SilentlyContinue
Remove-Item Env:\FARM_GO_API_COOKIE -ErrorAction SilentlyContinue
Remove-Item Env:\CARDS_GO_API_COOKIE -ErrorAction SilentlyContinue
Remove-Item Env:\ADMIN_CARDS_GO_API_COOKIE -ErrorAction SilentlyContinue
```
