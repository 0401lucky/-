# Profile 精确切流前置审计

本文记录 `/profile` 页面相关 API 从 Next 切到 Go 的复核证据。
当前结论：Zeabur fresh 新部署不再迁 Cloudflare D1 历史资料，已允许三个 profile 精确路径切到 Go；仍禁止 `/api/profile*` 通配。

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

默认模式通过 `docker compose exec -T api` 直连 Go API 容器，不经过 Gateway；会验证 `/readyz`、`GET /api/profile/overview`、`GET /api/profile/settings`、`PUT /api/profile/settings`、`PUT /api/profile/achievements/equip` 的未登录边界，并确认 `gateway/Caddyfile` 只包含三个已批准的 profile 精确规则。

真实导入数据和登录 Cookie 可用后，可以传入 `PROFILE_GO_API_COOKIE`，脚本会额外验证登录态 `GET /api/profile/overview` 与 `GET /api/profile/settings` 的旧兼容响应。

`scripts/smoke-profile-write-go-api.mjs` 会创建专用 Docker PostgreSQL 测试用户，直连 Go API 验证登录态 `PUT /api/profile/settings`、`PUT /api/profile/achievements/equip` 和 `GET /api/profile/overview`。脚本会写入 `beginner` 成就授权，确认资料更新、成就佩戴和 overview 回读一致，然后自动删除测试用户、资料、佩戴记录和授权记录。

## 已知安全空值

以下旧 KV 模块还没有完整 PostgreSQL 化，Go 只能返回安全空值或基于已迁移表的部分数据：

- 卡牌图鉴库存：`cards.owned`、`cards.total`、`cards.fragments`、`cards.albums`
- 签到统计：`gameplay.checkinStreak`、`gameplay.totalCheckinDays`
- 农场土地统计：`achievementStats.farmUnlockedLands`
- 彩票橙子/爱心累计：`achievementStats.lotteryOrangeCount`、`lotteryHeartCount`

Zeabur fresh 新部署接受这些安全空值；后续签到、农场和彩票迁到 Go 后再补齐对应统计。

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

## 切流检查项

1. `npm run audit:profile-cutover` 通过。
2. `node scripts/smoke-profile-go-api.mjs` 通过；真实登录 Cookie 可用时带 `PROFILE_GO_API_COOKIE` 复跑。
3. `node scripts/smoke-profile-write-go-api.mjs` 通过。
4. `go test ./internal/profile ./internal/httpserver` 通过。
5. Zeabur 上访问 `/profile` 不再显示“个人主页数据服务暂时不可用”。
6. 验证 `SiteSidebar` 头像、昵称、佩戴成就显示正常。

## 回滚步骤

若切流后发现资料或成就异常：

1. 从 `gateway/Caddyfile` 移除上面三个 `handle /api/profile/...` 精确规则。
2. 重新构建并重启 Zeabur 单容器镜像。
3. 复验 `/api/profile/overview` 回落到 Next。
4. 保留 PostgreSQL 写入记录，必要时根据 `user_profiles`、`user_equipped_achievements` 做人工对账。
5. 若回滚到旧 Next API，临时补齐 `KV_REST_API_URL` / `KV_REST_API_TOKEN`，否则旧 KV 路径仍会报错。
