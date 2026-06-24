# Profile 精确切流前置审计

本文记录 `/profile` 页面相关 API 从 Next 切到 Go 前必须复核的证据。
当前结论：可以继续做本地验证，但缺少真实 D1 导入验证前不做生产切流结论。

## 当前前端依赖

运行：

```bash
npm run audit:profile-cutover
```

当前脚本会确认前端只依赖以下 profile API：

- `GET /api/profile/overview`
- `GET /api/profile/settings`
- `PUT /api/profile/settings`
- `PUT /api/profile/achievements/equip`

注意：`/api/profile/settings` 同时被 `/profile` 页面和 `SiteSidebar` 使用。

## Go 字段覆盖

Go 当前已返回旧页面需要的字段：

- `settings`：`displayName`、`avatarUrl`、`qqEmail`、`equippedAchievement`、`updatedAt`
- `equip`：`equippedId`、`equipped`
- `overview.user`：`id`、`username`、`customDisplayName`、`customAvatarUrl`、`customQqEmail`
- `overview.points`：`balance`、`recentLogs`
- `overview.cards`：`owned`、`total`、`fragments`、`drawsAvailable`、`completionRate`、`albums`
- `overview.gameplay`：`checkinStreak`、`totalCheckinDays`、`recentRecords`
- `overview.notifications`：`unreadCount`、`recent`
- `overview.achievementStats`：游戏胜率、农场、彩票、环保统计字段
- `overview.achievements`：`grants`、`equippedId`、`equipped`、`items`

## 直连 Go API 冒烟

当前已补可重复执行的直连冒烟脚本：

```bash
node scripts/smoke-profile-go-api.mjs
node scripts/smoke-profile-write-go-api.mjs
```

默认模式通过 `docker compose exec -T api` 直连 Go API 容器，不经过 Gateway；会验证 `/readyz`、`GET /api/profile/overview`、`GET /api/profile/settings`、`PUT /api/profile/settings`、`PUT /api/profile/achievements/equip` 的未登录边界，并确认 `gateway/Caddyfile` 没有 `/api/profile` 规则。

真实导入数据和登录 Cookie 可用后，可以传入 `PROFILE_GO_API_COOKIE`，脚本会额外验证登录态 `GET /api/profile/overview` 与 `GET /api/profile/settings` 的旧兼容响应。

`scripts/smoke-profile-write-go-api.mjs` 会创建专用 Docker PostgreSQL 测试用户，直连 Go API 验证登录态 `PUT /api/profile/settings`、`PUT /api/profile/achievements/equip` 和 `GET /api/profile/overview`。脚本会写入 `beginner` 成就授权，确认资料更新、成就佩戴和 overview 回读一致，然后自动删除测试用户、资料、佩戴记录和授权记录。

## 已知安全空值

以下旧 KV 模块还没有完整 PostgreSQL 化，Go 只能返回安全空值或基于已迁移表的部分数据：

- 卡牌图鉴库存：`cards.owned`、`cards.total`、`cards.fragments`、`cards.albums`
- 签到统计：`gameplay.checkinStreak`、`gameplay.totalCheckinDays`
- 农场土地统计：`achievementStats.farmUnlockedLands`
- 彩票橙子/爱心累计：`achievementStats.lotteryOrangeCount`、`lotteryHeartCount`

因此真实切流前必须确认这些空值对当前页面可接受，或先迁移对应数据。

## 精确 Gateway 草案

只允许评估以下精确规则，不打开 `/api/profile*` 通配：

```caddyfile
handle /api/profile/overview {
	reverse_proxy api:8080
}
handle /api/profile/settings {
	reverse_proxy api:8080
}
handle /api/profile/achievements/equip {
	reverse_proxy api:8080
}
```

## 切流前置条件

1. 真实 D1 导出已可用。
2. 已执行并核对：
   - `migrate-d1 -apply -scope user-profiles`
   - `migrate-d1 -apply -scope user-achievements`
3. `npm run audit:profile-cutover` 通过。
4. `node scripts/smoke-profile-go-api.mjs` 通过；真实登录 Cookie 可用时带 `PROFILE_GO_API_COOKIE` 复跑。
5. `node scripts/smoke-profile-write-go-api.mjs` 通过。
6. `go test ./internal/profile ./internal/httpserver` 通过。
7. 使用真实导入样本账号完成 `/profile` 页面冒烟。
8. 验证 `SiteSidebar` 头像、昵称、佩戴成就显示正常。

## 回滚步骤

若切流后发现资料或成就异常：

1. 从 `gateway/Caddyfile` 移除上面三个 `handle /api/profile/...` 精确规则。
2. 重建并重启 `gateway`。
3. 复验 `/api/profile/overview` 回落到 Next。
4. 保留 PostgreSQL 写入记录，必要时根据 `user_profiles`、`user_equipped_achievements` 做人工对账。
5. 复跑 `npm run audit:profile-cutover`，确认 Gateway profile 规则已清除。
