# Zeabur Go API 部署前总预检

本文记录 Zeabur / Docker 部署前的总预检入口。
它不会修改数据库 schema，不会改变 Gateway 切流规则，也不会打开仍处于禁切状态的高风险路径。

## 运行方式

默认预检：

```bash
node scripts/preflight-zeabur-go-api.mjs
```

包含未切流模块的本地写路径安全门禁：

```bash
ZEABUR_PREFLIGHT_INCLUDE_INTERNAL=1 node scripts/preflight-zeabur-go-api.mjs
```

Windows PowerShell：

```powershell
$env:ZEABUR_PREFLIGHT_INCLUDE_INTERNAL='1'
node scripts/preflight-zeabur-go-api.mjs
Remove-Item Env:\ZEABUR_PREFLIGHT_INCLUDE_INTERNAL
```

## 默认覆盖范围

默认预检会串行执行：

- 迁移产物索引审计：`scripts/audit-migration-artifacts.mjs`
- Docker Compose 拓扑审计：`scripts/audit-compose-topology.mjs`
- Dockerfile 构建产物审计：`scripts/audit-dockerfiles.mjs`
- PostgreSQL migration 审计：`scripts/audit-postgres-migrations.mjs`
- PostgreSQL 实库 schema 审计：`scripts/audit-postgres-live-schema.mjs`
- Zeabur 服务计划审计：`scripts/audit-zeabur-service-plan.mjs`
- 生产切流证据包模板审计：`scripts/audit-production-cutover-evidence.mjs`
- 部署产物敏感信息卫生审计：`scripts/audit-deploy-secret-hygiene.mjs`
- Zeabur 环境变量样例审计：`scripts/audit-zeabur-env-example.mjs`
- D1 导入 scope 一致性审计：`scripts/audit-migrate-d1-scopes.mjs`
- Zeabur 部署运行手册审计：`scripts/audit-zeabur-runbook.mjs`
- `docker compose config --quiet`
- Gateway 禁切守卫：`scripts/audit-gateway-cutover-guard.mjs`
- Gateway 允许切流清单审计：`scripts/audit-gateway-allowed-cutovers.mjs`
- Zeabur 运行时基础冒烟：`scripts/smoke-zeabur-runtime.mjs`
- 登录接口切流冒烟：`scripts/smoke-auth-login-go-api.mjs`
- 登录态用户同步冒烟：`scripts/smoke-auth-me-go-api.mjs`
- 登出撤销会话冒烟：`scripts/smoke-auth-logout-go-api.mjs`
- 签到审计和写路径冒烟：`scripts/audit-checkin-cutover.mjs`、`scripts/smoke-checkin-go-api.mjs`
- 公告审计和写路径冒烟：`scripts/audit-announcements-cutover.mjs`、`scripts/smoke-announcements-go-api.mjs`
- 彩票/数字炸弹禁切审计：`scripts/audit-lottery-cutover.mjs`
- 积分查询与环保排行榜审计和直连冒烟
- 商城核心审计和直连冒烟
- 环保行动审计和直连写路径冒烟
- 公开项目列表审计和直连冒烟
- 抽奖审计和直连冒烟
- 游戏中心聚合审计和直连冒烟
- 普通游戏一键门禁套件
- 钱包缺少 new-api 配置时的写路径安全冒烟
- 农场审计和写路径冒烟

## 扩展覆盖范围

设置 `ZEABUR_PREFLIGHT_INCLUDE_INTERNAL=1` 后会额外执行：

- 个人资料审计和写路径冒烟
- 通知审计和写路径冒烟
- 前台卡牌审计和写路径冒烟
- 后台卡牌审计和写路径冒烟

这些是更重的写路径复核。
它们只证明 Go 路由、PostgreSQL 写入、测试数据清理和 Gateway 约束在本地可复核；是否已切流以 Gateway 允许清单为准。

## 前置条件

- Docker Desktop 已启动。
- `docker compose up --build -d` 已启动 `api`、`postgres`、`redis`、`gateway` 等服务。
- 主库已执行 `/app/migrate`。
- 本地未配置真实 `NEW_API_URL`、`NEW_API_ADMIN_ACCESS_TOKEN` 时，钱包预检只验证安全失败路径。

## 仍禁止打开的 Gateway 路径

总预检会通过 Gateway 禁切守卫持续确认以下路径没有被误开：

- `/api/farm` 根路径或通配
- `/api/profile*`
- `/api/notifications*`
- `/api/announcements*`
- `/api/lottery*`
- `/api/admin/lottery*`
- `/api/store/topup`
- `/api/store/withdraw`
- `/api/cards*`
- `/api/admin/cards*`
- `/api/games/*`
- `/api/projects/*`
- `/api/admin/*`

这些路径必须等真实 D1 导出导入、真实样本账号 Cookie、页面级冒烟和独立 review 都完成后，再评估是否精确切流。

## Review 命令

```bash
node --check scripts/preflight-zeabur-go-api.mjs
node --check scripts/audit-postgres-migrations.mjs
node --check scripts/audit-postgres-live-schema.mjs
node --check scripts/audit-zeabur-service-plan.mjs
node --check scripts/audit-production-cutover-evidence.mjs
node --check scripts/audit-deploy-secret-hygiene.mjs
node scripts/preflight-zeabur-go-api.mjs
docker compose config --quiet
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
```
