# Admin Cards 精确切流前置审计

本文记录后台卡牌管理从 Next 切到 Go 前必须复核的证据。
当前结论：已完成后台卡牌页面依赖、旧数据键审计、PostgreSQL 自定义奖励 schema、`cards:album_rewards` / `cards:tier_rewards` D1 导入器、Go admin service 读写路径、Go admin HTTP handler 方法、Go 内部精确路由、直连 API 未登录冒烟、本地管理员 Cookie 只读冒烟、`/admin/cards` 页面只读冒烟和本地夹具页面写路径冒烟；尚未使用真实导入数据做最终后台验证，不能切 Gateway。

## 当前后台依赖

运行：

```bash
node scripts/audit-admin-cards-cutover.mjs
```

当前脚本会确认 `/admin/cards` 页面只依赖以下 API：

- `GET /api/admin/cards/users`
- `GET /api/admin/cards/user/[userId]`
- `POST /api/admin/cards/reset`
- `GET /api/admin/cards/albums`
- `POST /api/admin/cards/albums`
- `GET /api/admin/cards/rules`
- `PATCH /api/admin/cards/rules`

页面能力：

- 用户卡牌列表：分页、搜索、展示卡牌数、碎片、抽卡次数和保底计数。
- 用户详情：读取单个用户完整卡牌状态。
- 用户重置：清空指定用户卡牌进度。
- 卡册奖励：读取和更新卡册全套奖励。
- 稀有度奖励：读取和更新稀有度奖励。
- 卡牌规则：读取和更新概率、保底、抽卡价格、碎片价值和兑换价格。

## 旧数据与行为范围

后台卡牌管理依赖以下旧数据源：

- `cards:user:{userId}`：用户卡牌状态。
- `native_user_cards`：native 热路径用户卡牌状态。
- `cards:rules:config`：卡牌概率、保底、抽卡价格、碎片价值和兑换价格。
- `cards:album_rewards`：后台自定义卡册全套奖励。
- `cards:tier_rewards`：后台自定义稀有度奖励。
- 用户列表：来自旧用户数据源 `getAllUsers()`。

写路径当前包含：

- 重置用户卡牌进度：删除旧 KV 和 native 热路径数据。
- 更新卡牌规则：写回 `cards:rules:config`。
- 更新卡册奖励：写回 `cards:album_rewards`。
- 更新稀有度奖励：写回 `cards:tier_rewards`。

## Go 迁移前置工作

后台卡牌建议拆成以下小块：

1. 新增 PostgreSQL schema，已完成于 `backend/migrations/0017_card_admin_rewards.sql`：
   - `card_album_rewards` 保存后台自定义卡册奖励。
   - `card_tier_rewards` 保存后台自定义稀有度奖励。
   - 明确重置操作是否保留审计日志。
2. 扩展 `migrate-d1 -apply -scope cards`，已完成：
   - 导入 `cards:album_rewards` 到 `card_album_rewards`。
   - 导入 `cards:tier_rewards` 到 `card_tier_rewards`。
   - 保留坏数据 warning 和默认值兜底。
3. 新增 Go admin card service：
   - 用户列表聚合 `users` 与 `card_user_states`，已完成只读列表、搜索和分页。
   - 单用户卡牌详情读取，已完成。
   - 卡牌规则读取，已完成。
   - 卡册奖励和稀有度奖励读取，已完成，支持 `card_album_rewards` / `card_tier_rewards` 覆盖默认值。
   - 用户卡牌重置事务，已完成；删除 `card_user_states` 和 `card_reward_claims`，保留 `card_draw_logs` 作为审计日志。
   - 卡牌规则更新，已完成；写入 `card_rules` 并校验概率合计为 100%。
   - 卡册奖励和稀有度奖励更新，已完成；写入 `card_album_rewards` 与 `card_tier_rewards`。
4. 新增 Go HTTP handler：
   - `GET /api/admin/cards/users`，Go 内部精确路由已注册。
   - `GET /api/admin/cards/user/{userId}`，Go 内部精确路由已注册。
   - `GET /api/admin/cards/albums`，Go 内部精确路由已注册。
   - `GET /api/admin/cards/rules`，Go 内部精确路由已注册。
   - `POST /api/admin/cards/reset`，Go 内部精确路由已注册。
   - `POST /api/admin/cards/albums`，Go 内部精确路由已注册。
   - `PATCH /api/admin/cards/rules`，Go 内部精确路由已注册。
5. 新增后台直连 Go API 冒烟：
   - 未登录返回 401，已完成于 `scripts/smoke-admin-cards-go-api.mjs`。
   - 非管理员返回 403，可通过 `ADMIN_CARDS_GO_API_NON_ADMIN_COOKIE` 覆盖。
   - 管理员读取列表/规则/卡册成功，已用本地 Docker Compose 管理员会话 Cookie 跑通 `ADMIN_CARDS_GO_API_COOKIE`。
   - 管理员写路径已完成可重复 Docker 冒烟于 `scripts/smoke-admin-cards-write-go-api.mjs`，覆盖重置进度、卡册奖励保存、稀有度奖励保存和规则保存，并自动恢复全局配置与清理测试用户。
   - 写路径跨站请求被拒绝，已由 Go handler 测试覆盖。
   - Gateway 不包含 `/api/admin/cards*`，已由冒烟和审计脚本覆盖。

本地 Docker review 中发现 `app` 数据库尚未应用 `0017_card_admin_rewards.sql` 时，管理员读取 `/api/admin/cards/albums` 会因为缺少 `card_album_rewards` 表返回 500；已通过 `docker compose exec -T api /app/migrate` 补齐，随后 `ADMIN_CARDS_GO_API_COOKIE=... node scripts/smoke-admin-cards-go-api.mjs` 通过，覆盖 4 个未登录读路径、3 个未登录写路径和 3 个管理员只读路径。脚本也支持 `ADMIN_CARDS_GO_API_NON_ADMIN_COOKIE`，用于验证普通登录用户访问后台卡牌读写路径返回 403。

本地页面级只读 review 已通过：在不修改 Gateway 的前提下，用 `scripts/proxy-admin-cards-go-api.mjs` 将 `/admin/cards` 页面内的 `/api/admin/cards/*` 请求临时转发到 Go API，验证用户列表、奖励配置和规则三个 tab 均可正常读取。命中的 Go API 路径为 `GET /api/admin/cards/users?page=1&limit=50`、`GET /api/admin/cards/albums`、`GET /api/admin/cards/rules`，失败命中为空。验证后已停止临时代理并删除 `.admin-cards-proxy.pid`。

本地页面级写路径 review 已通过：先在 Docker PostgreSQL 中创建专用测试用户 `admin_cards_page_smoke_user`，再通过 `/admin/cards` 页面真实按钮触发重置进度、卡册奖励保存、稀有度奖励保存和规则保存。数据库核验结果为：重置后 `card_user_states` 与 `card_reward_claims` 被删除，`card_draw_logs` 保留；`card_album_rewards.animal-s1=777`、`card_tier_rewards.common=888`、`card_rules.card_draw_price=902` 均落库。测试结束后已删除本次创建的规则/奖励配置、测试用户和抽卡日志，并停止临时代理。review 中发现临时代理的 `PATCH` 原始请求会提前断开，导致 Go 侧 `context canceled`；已修复为发送请求后等待响应，`PATCH /api/admin/cards/rules` 页面保存复验通过。后续自动化门禁可运行 `node scripts/smoke-admin-cards-write-go-api.mjs` 复验同一组写路径。

## 精确 Gateway 草案

只允许在 Go 实现、真实导入和后台页面冒烟全部完成后评估以下精确规则，不打开 `/api/admin/cards*` 通配：

```caddyfile
handle /api/admin/cards/users {
	reverse_proxy api:8080
}
handle /api/admin/cards/user/* {
	reverse_proxy api:8080
}
handle /api/admin/cards/reset {
	reverse_proxy api:8080
}
handle /api/admin/cards/albums {
	reverse_proxy api:8080
}
handle /api/admin/cards/rules {
	reverse_proxy api:8080
}
```

## 切流前置条件

1. `node scripts/audit-admin-cards-cutover.mjs` 通过。
2. 后台自定义奖励配置已经导入 PostgreSQL。
3. Go admin card service 和 HTTP handler 完成。
4. 管理员权限、跨站拦截、参数校验和无数据库边界均有测试。
5. 重置用户卡牌进度有 PostgreSQL transaction 或明确审计策略。
6. 使用管理员登录态完成 `/admin/cards` 页面级只读和写路径冒烟。
7. 使用真实导入数据或生产等价样本账号复跑后台页面验证。
8. Gateway 只打开已验证的精确路径，不打开 `/api/admin/cards*` 或 `/api/cards*` 通配。

## 当前不切流原因

- 本地夹具已验证重置进度、奖励保存和规则保存，但尚未使用真实导入数据或生产等价样本账号复跑。
- 后台卡牌配置是全局配置，切 Gateway 前还需要真实数据导入后的最终人工/自动复核。
- Gateway 当前没有活跃 `/api/cards*` 或 `/api/admin/cards*` 规则，保持 Next 回落更稳妥。
