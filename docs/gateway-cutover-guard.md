# Gateway Cutover Guard

本文记录当前 Gateway 禁切守卫。
目标是把迁移文档中“还不能切 Gateway”的高风险路径固化为脚本，避免后续重构时误开通配或误切未完成路径。
已允许切流路径的完整白名单由 `docs/gateway-allowed-cutovers.md` 和 `scripts/audit-gateway-allowed-cutovers.mjs` 单独维护。

## 运行方式

```bash
node scripts/audit-gateway-cutover-guard.mjs
```

脚本只读取 `gateway/Caddyfile` 中的活跃规则，忽略空行和注释行。

## 当前允许的既有切流

脚本允许当前已审的精确切流继续存在，包括：

- `/api/points`
- `/api/auth/login`
- `/api/auth/me`
- `/api/auth/logout`
- `/api/checkin`
- `/api/checkin/makeup`
- `/api/rankings/eco`
- `/api/games/profile`
- `/api/profile/overview`
- `/api/profile/settings`
- `/api/profile/achievements/equip`
- `/api/notifications`
- `/api/notifications/unread-count`
- `/api/notifications/read`
- `/api/notifications/delete`
- `/api/notifications/claim`
- `/api/announcements`
- `/api/admin/announcements`
- `/api/admin/announcements/*`
- 农场 19 条精确路径
- 环保行动 8 条精确路径
- 记忆游戏 5 条精确路径
- 消消乐 4 条精确路径
- 打地鼠 5 条精确路径
- 扫雷 5 条精确路径
- 连连看 4 条精确路径
- Roguelite 5 条精确路径
- `/api/store`
- `/api/store/exchange`
- `/api/store/admin`
- 卡牌前台 5 条精确路径
- 后台卡牌 5 条精确路径
- `/api/feedback`
- `/api/feedback/*`
- `/api/projects`
- `/api/raffle`
- `/api/raffle/*`
- `/api/admin/raffle`
- `/api/admin/raffle/*`

## 当前禁止打开

以下路径仍不能在 Gateway 打开：

- `/api/farm` 根路径或通配
- `/api/profile*` 通配
- `/api/notifications*` 通配
- `/api/announcements*` 通配
- `/api/lottery*`
- `/api/admin/lottery*`
- `/api/store/topup`
- `/api/store/withdraw`
- `/api/cards` 根路径或通配
- `/api/admin/cards` 根路径或通配
- `/api/games/overview`
- `/api/games/*`
- `/api/projects/*`
- `/api/admin/*`
- `/api/checkin*` 通配

## 禁切原因

- 签到：已允许 `/api/checkin` 和 `/api/checkin/makeup` 两条精确路径，仍禁止 `/api/checkin*` 通配和路径改写。
- 农场：已允许当前前端使用的 19 条精确路径，仍禁止 `/api/farm*` 通配和路径改写。
- 个人资料：已允许 `overview`、`settings`、`achievements/equip` 三条精确路径，仍禁止 `/api/profile*` 通配。
- 通知：已允许列表、未读、已读、删除、领取五条精确路径，仍禁止 `/api/notifications*` 通配。
- 公告：已允许公开列表和后台公告管理路径，仍禁止公开公告通配和路径改写。
- 彩票/数字炸弹：仍依赖旧 KV，需要完成 Go/PostgreSQL 迁移、审计和 smoke 后才能逐条精确切流。
- 钱包充值/提现：需要 Zeabur/new-api 配置后再做认证只读余额冒烟。
- 卡牌前台/后台：已允许精确路径，仍禁止根路径和通配，避免误转发未审路径。
- `/api/games/overview`：Go 内部已完成，但当前无前端直接调用。
- `/api/games/*`：普通游戏已用精确路径切流，仍禁止通配。
- `/api/projects/*`：当前只切公开项目列表，不切详情或后台项目。
- `/api/admin/*`：当前只允许已审的 raffle 后台精确规则，不切完整后台通配。

## Review 命令

```bash
node --check scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
docker compose config --quiet
```
