# 阶段 1-4 Review

日期：2026-06-24

本文用于复核 Go + Docker + Zeabur 迁移前 4 个阶段的当前状态，也作为后续接入新 PR 时的基线。

## 总结论

前 4 个阶段的代码迁移、Docker/Zeabur 部署骨架、Gateway 精确切流和生产切流门禁已经形成可复跑的验证链路。

当前还不能直接宣称“可生产全量切流”，原因不是本地代码缺主干能力，而是缺少生产侧证据：

- 真实 D1 导出文件。
- Zeabur 真实环境变量。
- Zeabur HTTPS 远端运行时冒烟。
- 真实用户 Cookie / 管理员 Cookie。
- New API 钱包配置。

生产 readiness 当前输出为 `ok:true`、`ready:false`，属于预期状态。

## 阶段 1 Review

阶段 1 已覆盖：

- Go API 基础服务。
- PostgreSQL migration 基础链路。
- Docker / Compose / Gateway 骨架。
- 积分、排行榜、商城核心、抽奖、公开项目等第一批 Go API。

当前证据：

- `scripts/audit-gateway-allowed-cutovers.mjs` 通过。
- 当前 Gateway 允许 49 条精确 Go API 转发。
- `/api/store`、`/api/store/exchange`、`/api/store/admin` 已精确切流。
- `/api/projects`、`/api/raffle`、`/api/admin/raffle*` 已精确切流。

保留风险：

- 不允许打开 `/api/store/topup`、`/api/store/withdraw`。
- 不允许打开完整 `/api/store*`。
- 不允许打开完整 `/api/admin/*`。

## 阶段 2 Review

阶段 2 已覆盖：

- 环保行动核心高频路径。
- 积分结算、购买、出售、公示、偷盗等并发敏感路径的 Go 侧迁移。
- 独立审计与 Docker 直连写路径冒烟。

当前证据：

- Gateway 允许清单包含 `/api/games/eco` 的 8 条精确路径。
- Gateway 禁切守卫仍禁止完整 `/api/games/eco*` 和 `/api/games/*` 通配。

保留风险：

- 不要为了省规则直接打开 `/api/games/*`。
- 环保仍需要真实生产数据和页面冒烟后再扩大切流范围。

## 阶段 3 Review

阶段 3 已覆盖：

- 记忆游戏。
- 消消乐。
- 打地鼠。
- 扫雷。
- 连连看。
- Roguelite。

当前证据：

- Gateway 允许清单包含 6 个普通游戏的精确 status/start/step/submit/cancel 等路径。
- `scripts/smoke-game-cutovers-go-api.mjs` 可一键复跑普通游戏门禁。
- Gateway 禁切守卫仍禁止完整 `/api/games/*`。

保留风险：

- `/api/games/overview` 已在阶段 C 精确打开到 Go；仍不要打开 `/api/games/*` 通配。
- 不要打开任意游戏通配路径。
- 后续新增游戏或新增动作接口时，必须先补 Go handler、审计脚本和 smoke，再评估 Gateway 精确规则。

## 阶段 4 Review

阶段 4 已覆盖：

- Docker/Zeabur 部署产物审计。
- Gateway 上游可配置化。
- 生产证据包模板。
- 生产 readiness 审计。
- 最终生产切流预检。
- 生产切流 guard 失败路径自动化。
- 敏感信息卫生审计。
- PostgreSQL migration 和运行库 schema 审计。
- PostgreSQL 冒烟残留审计。

当前证据：

- `scripts/audit-production-cutover-readiness.mjs` 输出 `ok:true`、`ready:false`。
- 当前 blocked modules 为 `auth`、`wallet`、`profile`、`notifications`、`farm`、`cards`。
- `scripts/audit-gateway-cutover-guard.mjs` 通过。
- 禁切路径仍包括 `/api/auth*`、`/api/farm*`、`/api/profile*`、`/api/notifications*`、`/api/cards*`、`/api/admin/cards*`、`/api/games/*`、`/api/admin/*`。
- `scripts/audit-postgres-migrations.mjs` 通过，当前最新 migration 为 `0018_feedback.sql`。

保留风险：

- 阶段 4 不应该继续无限加 guard。
- 后续重点应转入阶段 5 的低频业务迁移和真实生产证据收集。

## 接新 PR 的处理规则

朋友的新 PR 合进来前后，按下面顺序处理：

1. 先找新增或变化的 API 路径。
2. 判断是否仍依赖 Next API、D1/KV、Cloudflare 绑定或 OpenNext 运行时。
3. 如果是用户态业务路径，优先补 Go service、PostgreSQL schema、HTTP handler 和 smoke。
4. 如果是后台路径，先补管理员鉴权、同源校验、限流和审计，再考虑页面冒烟。
5. 如果涉及图片、文件或对象存储，先确认 Zeabur 可用存储方案，不直接照搬 Cloudflare 绑定。
6. 每完成一小块，都更新 `docs/go-zeabur-refactor-plan.md` 并跑对应 review 命令。

## 本次 Review 命令

```bash
node scripts/audit-gateway-allowed-cutovers.mjs
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-production-cutover-readiness.mjs
node scripts/audit-postgres-migrations.mjs
node scripts/audit-feedback-cutover.mjs
```

本次命令均通过。
