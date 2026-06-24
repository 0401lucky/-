# Cards 精确切流前置审计

本文记录前台卡牌系统从 Next 切到 Go 前必须复核的证据。
当前结论：已完成前台卡牌依赖、旧数据形状审计、PostgreSQL schema、D1/KV 导入器、Go PostgreSQL store、Go 静态卡牌 catalog、抽卡纯算法、抽卡 PostgreSQL 事务服务层、碎片兑换服务层、卡册奖励服务层、Go 库存/规则/抽卡/兑换/奖励领取 HTTP handler、商城 `card_draw` 奖励同步、只读直连 API 冒烟门禁和测试库写路径自动冒烟门禁；缺少真实导入验证和登录态页面冒烟前不做生产切流结论。

## 当前前端依赖

运行：

```bash
node scripts/audit-cards-cutover.mjs
```

当前脚本会确认前台卡牌页面只依赖以下 API：

- `GET /api/cards/inventory`
- `GET /api/cards/rules`
- `POST /api/cards/draw`
- `POST /api/cards/claim-reward`
- `POST /api/cards/exchange`

调用位置：

- `/cards`：读取卡牌库存和卡牌规则。
- `/cards/draw`：读取库存、读取规则、提交抽卡。
- `/cards/[albumId]`：读取库存、领取卡册奖励、用碎片兑换卡牌。

旧 Next 还保留 `POST /api/cards/purchase`，当前前台页面未直接调用；当前实际购买抽卡次数入口是商城 `card_draw` 商品，经 `/api/store/exchange` 兑换。

后台卡牌管理路径 `/api/admin/cards/*` 不属于本文前台卡牌切流范围，已拆到 `docs/admin-cards-cutover-preflight.md` 单独审计。

## 旧数据与行为范围

旧卡牌数据主要依赖：

- `cards:user:{userId}`：用户卡牌 JSON。
- `cards:rules:config`：卡牌概率、保底、价格、碎片和兑换规则。

用户卡牌 JSON 至少包含：

- `inventory`
- `fragments`
- `pityCounter`
- `pityRare`
- `pityEpic`
- `pityLegendary`
- `pityLegendaryRare`
- `drawsAvailable`
- `collectionRewards`
- `recentDraws`

写路径当前包含：

- 抽卡：扣减 `drawsAvailable`、推进保底计数、写入卡牌或碎片、追加最近抽卡记录。
- 碎片兑换：扣减碎片、写入目标卡牌。
- 卡册奖励：校验卡册完成状态、发放积分、写入已领取奖励。
- 购买抽卡次数：前台通过商城 `card_draw` 商品兑换，Go 商城事务会同时更新 `user_assets.card_draws` 和 `card_user_states.draws_available`，避免个人资料与卡牌抽卡页分叉。

这些写路径必须在 Go 中使用 PostgreSQL transaction 和用户级锁重新实现，不能只迁移只读库存。

## Go 迁移前置工作

后续 Go 重写建议拆成以下小块：

1. 新增 PostgreSQL schema，已完成于 `backend/migrations/0016_cards.sql`：
   - `card_user_states`
   - `card_rules`
   - `card_draw_logs`
   - `card_reward_claims`
2. 新增 `migrate-d1 -apply -scope cards`，已完成：
   - 导入 `cards:user:*`
   - 导入 `native_user_cards`
   - 导入 `cards:rules:config`
   - 保留旧 JSON 字段兼容和坏数据 warning。
3. 新增 Go `internal/cards`：
   - 静态卡牌 catalog，已完成，总计 137 张卡，覆盖 `animal-s1`、`animal-s2` 和 `tarot`。
   - 规则读取和默认规则兜底，已完成。
   - 用户卡牌状态读取、缺失状态初始化、状态保存，已完成。
   - 抽卡概率、保底、重复卡转碎片和最近抽卡记录算法，已完成纯函数与单元测试。
   - 抽卡 PostgreSQL 事务服务层，已完成状态行锁、规则读取、状态保存和抽卡日志写入。
   - 碎片兑换纯算法和 PostgreSQL 事务服务层，已完成。
   - 卡册奖励纯算法和 PostgreSQL 事务服务层，已完成。
4. 新增 Go HTTP handler：
   - `GET /api/cards/inventory`，Go 内部路由已完成。
   - `GET /api/cards/rules`，Go 内部路由已完成。
   - `POST /api/cards/draw`，Go 内部路由已完成。
   - `POST /api/cards/exchange`，Go 内部路由已完成。
   - `POST /api/cards/claim-reward`，Go 内部路由已完成。
   - `POST /api/cards/purchase` 当前无前台直接入口，暂不接 Go。
5. 新增直连 Go API 冒烟脚本：
   - 未登录库存和抽卡边界，已完成。
   - 未登录兑换边界，已完成。
   - 未登录奖励领取边界，已完成。
   - 公开规则读取，已完成。
   - 登录态只读库存，脚本已支持 `CARDS_GO_API_COOKIE`，真实样本账号待执行。
   - Docker 测试库写路径自动冒烟，已完成，覆盖登录态库存、碎片兑换、抽卡、卡册奖励领取、积分入账和测试用户清理。
   - 小样本抽卡、兑换和奖励领取只在测试库执行，真实导入后仍需用样本账号复验。

## 精确 Gateway 草案

只允许在 Go 实现、真实导入和页面冒烟全部完成后评估以下精确规则，不打开 `/api/cards*` 通配：

```caddyfile
handle /api/cards/inventory {
	reverse_proxy api:8080
}
handle /api/cards/rules {
	reverse_proxy api:8080
}
handle /api/cards/draw {
	reverse_proxy api:8080
}
handle /api/cards/claim-reward {
	reverse_proxy api:8080
}
handle /api/cards/exchange {
	reverse_proxy api:8080
}
```

`POST /api/cards/purchase` 当前无前台直接入口，不加入本轮 Gateway 草案；若后续恢复直接购买入口，再单独增加精确规则，不能用通配兜底。

## 切流前置条件

1. `node scripts/audit-cards-cutover.mjs` 通过。
2. `migrate-d1 -apply -scope cards` 已用真实 D1 导出执行并核对。
3. Go 卡牌服务层和 HTTP handler 已完成。
4. 抽卡概率、保底、重复卡转碎片、碎片兑换、奖励领取、购买抽卡次数均有单元测试和 PostgreSQL integration。
5. 直连 Go API 未登录边界、测试库写路径和登录态只读冒烟通过。
6. 使用真实导入样本账号完成 `/cards`、`/cards/draw`、`/cards/[albumId]` 页面冒烟。
7. Gateway 只打开已验证的精确路径，不打开 `/api/cards*` 或 `/api/admin/cards*` 通配。

## 当前不切流原因

- 后台自定义卡册/稀有度奖励配置键尚未纳入 PostgreSQL 导入，本轮奖励领取先按静态卡册默认值对齐。
- 只读直连 Go API 冒烟脚本和测试库写路径自动冒烟脚本已完成，但还未用真实样本账号 Cookie 做登录态库存与写路径复验。
- 旧卡牌状态仍混合 `cards:user:*`、native hot store 读穿和 D1-KV 回写语义，直接切流容易导致卡牌库存或抽卡次数分叉。
- 抽卡、兑换和奖励领取都是写路径；Go 内部 handler 与测试库自动冒烟已完成，但还未做真实导入后的登录态接口和页面级冒烟。
- Gateway 当前没有活跃 `/api/cards*` 或 `/api/admin/cards*` 规则，保持 Next 回落更稳妥。

## 数据导入顺序

真实 D1 导出可用后，先 dry-run：

```bash
go run ./cmd/migrate-d1 -input ./d1-export.sql -scope cards
```

确认映射中至少包含：

- `native_user_cards -> card_user_states`
- `kv_data:cards:user:* -> card_user_states`
- `kv_data:cards:rules:config -> card_rules`

需要执行真实导入时增加 `-apply`，并确保 `DATABASE_URL` 指向目标 PostgreSQL：

```bash
DATABASE_URL=... go run ./cmd/migrate-d1 -input ./d1-export.sql -scope cards -apply
```

导入后至少核对：

- `card_user_states` 行数与 `native_user_cards`、`cards:user:*` 合并后的用户数一致或差异有 warning 可解释。
- `card_rules` 至少存在 `default` 规则；缺失旧规则时后续 Go 服务层必须使用默认规则兜底。
- 同一用户同时存在 native 和 legacy 状态时，库存、领奖记录、碎片、保底计数和抽卡次数符合合并策略。
- `user_assets.card_draws` 仍由 `user-assets` scope 负责，`cards` scope 不替代资产导入。
