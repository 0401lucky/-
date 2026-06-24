# Farm Status 精确切流前置审计

本文记录 `/api/farm/status` 从 Next 切到 Go 前的前置审计结论。
当前结论：已补 PostgreSQL farm runtime 基础表、D1/KV 导入器、Go store、Go 内部 status 服务层、当前前端使用的农场接口、偷菜内部结算、直连 API 未登录/只读冒烟和 Docker 测试库写路径自动冒烟；Go 已注册当前全部前端 `/api/farm` 路径的 method-level 精确内部路由，但暂时不切 Gateway，也不打开 `/api/farm*` 通配。

## 当前前端依赖

运行：

```bash
npm run audit:farm-status-cutover
```

当前脚本会确认农场前端实际涉及以下 API：

- `GET/POST /api/farm/status`
- `POST /api/farm/plant`
- `POST /api/farm/water`
- `POST /api/farm/water-all`
- `POST /api/farm/harvest`
- `POST /api/farm/harvest-all`
- `POST /api/farm/remove`
- `POST /api/farm/buy-land`
- `POST /api/farm/shop/buy`
- `POST /api/farm/seeds/buy`
- `POST /api/farm/shop/use`
- `POST /api/farm/pet/adopt`
- `POST /api/farm/pet/feed`
- `POST /api/farm/pet/wash`
- `POST /api/farm/pet/drink`
- `POST /api/farm/pet/play`
- `POST /api/farm/pet/dispatch`
- `GET /api/farm/steal/list`
- `POST /api/farm/steal/do`

其中 `/api/farm/status` 同时被两个入口使用：

- 桌宠组件读取 `data.state.pet`。
- 完整农场页读取 `FarmStatusResponse` 的完整结构，并在每次写操作后刷新页面状态。

因此不能只为了桌宠返回一个残缺宠物对象，否则农场页会直接失去土地、天气、库存、事件和商店限购状态。

## 旧实现状态

旧 Next 路由位于 `src/app/api/farm/status/route.ts`，`GET` 和 `POST` 都包装到同一个处理函数：

- 登录校验和 `farm:action` 限流由 `withUserRateLimit` 处理。
- 业务层调用 `getFarmStatus(user.id)`。
- 出错时返回 `{ success: false, message: "服务器错误" }` 和 `500`。

`getFarmStatus` 的真实工作不是纯读取：

- 读取或创建 `farmv2:state:{userId}`。
- 执行 tick，推进作物成熟、枯萎、天气、乌鸦、宠物衰减和宠物任务。
- 从积分账本同步余额。
- 执行宠物被动技能。
- 写回状态。
- 再构造完整 `FarmStatusResponse`。

也就是说，`/api/farm/status` 表面是状态接口，实际包含懒结算和写回。

## 数据依赖

当前农场状态仍主要依赖旧 KV/D1 兼容层：

- `farmv2:state:{userId}`：完整玩家农场 JSON 状态。
- `farmv2:lock:{userId}`：农场操作锁。
- `farmv2:shop:daily:{userId}:{date}:{itemKey}`：每日限购计数。
- `farmv2:mature-mail:*` 和 `farmv2:water-mail:*`：成熟/浇水提醒去重。

PostgreSQL 当前已有两类农场表：

- `farm_shop_overrides`：农场商店后台配置覆盖。
- `0015_farm_runtime.sql` 新增的运行时承接表：
  - `farm_states`
  - `farm_daily_shop_purchases`
  - `farm_maturity_email_dedupes`
  - `farm_water_email_dedupes`

`farm_states` 第一阶段保留完整 `state_json`，用于安全承接旧 `farmv2:state:{userId}`。
这样可以先保证导入和兼容，再决定是否进一步拆分土地、宠物、库存和事件表。

D1 导入分析器和 `migrate-d1 -scope farm-v2` 当前已支持：

- `farmv2:state:*` -> `farm_states`
- `farmv2:shop:daily:*` -> `farm_daily_shop_purchases`
- `farmv2:mature-mail:sent:*` -> `farm_maturity_email_dedupes`
- `farmv2:water-mail:sent:*` -> `farm_water_email_dedupes`

## Go 覆盖状态

当前 Go 侧只注册了二十个 method-level 精确农场路由，覆盖当前十九个前端路径：

- `GET /api/farm/status`
- `POST /api/farm/status`
- `POST /api/farm/plant`
- `POST /api/farm/water`
- `POST /api/farm/water-all`
- `POST /api/farm/harvest`
- `POST /api/farm/harvest-all`
- `POST /api/farm/remove`
- `POST /api/farm/buy-land`
- `POST /api/farm/shop/buy`
- `POST /api/farm/shop/use`
- `POST /api/farm/seeds/buy`
- `POST /api/farm/pet/adopt`
- `POST /api/farm/pet/feed`
- `POST /api/farm/pet/wash`
- `POST /api/farm/pet/drink`
- `POST /api/farm/pet/play`
- `POST /api/farm/pet/dispatch`
- `GET /api/farm/steal/list`
- `POST /api/farm/steal/do`

`/api/farm/status` 已按旧 Next 路由兼容 `{ success, data }` 响应形状，内部调用 `GetStatus` 执行懒结算和写回。
`/api/farm/plant` 已按旧 Next 路由兼容 `{ plotIndex, cropId }` 请求体和 `{ success, data, balance }` 响应形状，内部完成土地、季节、作物解锁和种子库存校验，写回播种状态后再返回完整农场状态。
`/api/farm/water` 已按旧 Next 路由兼容 `{ plotIndex }` 请求体和 `{ success, data, bonus }` 响应形状，内部完成单块作物浇水、首次浇水奖励入账和状态写回。
`/api/farm/water-all` 已按旧 Next 路由兼容无请求体和 `{ success, data, count }` 响应形状，内部批量给可浇水作物刷新浇水时间并写回状态。
`/api/farm/harvest` 已按旧 Next 路由兼容 `{ plotIndex }` 请求体和 `{ success, data, harvest, balance }` 响应形状，内部完成单块成熟作物收获、收益入账、首次收获奖励入账和状态写回。
`/api/farm/harvest-all` 已按旧 Next 路由兼容无请求体和 `{ success, data, harvests, total, balance }` 响应形状，内部批量收获所有成熟作物、写入批量收益流水、首次收获奖励入账并写回状态。
`/api/farm/remove` 已按旧 Next 路由兼容 `{ plotIndex }` 请求体和 `{ success, data }` 响应形状，内部只允许清除 `withered` 或 `eaten` 土地，成功后把土地恢复为空地并写回状态。
`/api/farm/buy-land` 已按旧 Next 路由兼容 `{ landIndex }` 请求体和 `{ success, data, balance }` 响应形状，内部按 1 基土地编号、顺序解锁和土地价格表扣减积分，成功后解锁土地并写入 `land_buy` 事件。
`/api/farm/shop/buy` 已按旧 Next 路由兼容 `{ key, qty }` 请求体和 `{ success, data, balance }` 响应形状，内部完成商品配置、数量、一次性设备、每日限购和积分余额校验，扣减积分后增加背包库存、更新每日购买计数并写回状态。
`/api/farm/shop/use` 已按旧 Next 路由兼容 `{ key, plotIndex? }` 请求体和 `{ success, data }` 响应形状，内部完成商品配置读取、背包扣减、肥料、稻草人、铃铛、防鸟网、烟花、云朵瓶、加速券、宠物技能书和最后的晚餐等道具效果并写回状态。
`/api/farm/seeds/buy` 已按旧 Next 路由兼容 `{ cropId, qty }` 请求体和 `{ success, data, balance }` 响应形状，内部完成作物、数量、解锁土地和积分余额校验，扣减积分后增加种子库存并写回状态。
`/api/farm/pet/adopt` 已按旧 Next 路由兼容 `{ type, name? }` 请求体和 `{ success, data, balance }` 响应形状，内部完成宠物类型、重复领养、首次领养奖励、再次领养扣费、宠物初始状态和领养事件写回。
`/api/farm/pet/feed` 已按旧 Next 路由兼容 `{ kind }` 请求体和 `{ success, data, balance }` 响应形状，内部完成普通/高级宠粮校验、背包扣减、每日喂养次数和宠物饱食/口渴/情绪/健康/成长数值写回。
`/api/farm/pet/wash` 已按旧 Next 路由兼容 `{ itemKey? }` 请求体和 `{ success, data, balance }` 响应形状，默认使用免费 `pet_care_basic`，也支持保养类付费物品背包扣减和宠物健康/情绪/成长写回。
`/api/farm/pet/drink` 已按旧 Next 路由兼容 `{ itemKey? }` 请求体和 `{ success, data }` 响应形状，默认使用免费 `pet_water_basic`，也支持喂水类付费物品背包扣减和宠物口渴/饱食/情绪/成长写回。
`/api/farm/pet/play` 已按旧 Next 路由兼容 `{ mode?, itemKey? }` 请求体和 `{ success, data }` 响应形状，`mode=rest` 默认使用 `pet_rest_basic`，否则默认使用 `pet_play_basic`，并支持对应类别付费物品背包扣减和宠物数值写回。
`/api/farm/pet/dispatch` 已按旧 Next 路由兼容 `{ task }` 请求体和 `{ success, data, message }` 响应形状，只允许 `water`、`guard`、`chase_crow`、`harvest`、`plant`；内部完成宠物技能状态校验、任务持续时间和冷却时间写回，`harvest` 分支会批量收获成熟作物并入账，`plant` 分支会按当前季节最多自动播种 3 块土地。
`/api/farm/steal/list` 已按旧 Next 路由兼容 `{ success, data: { candidates } }` 响应形状，内部扫描 PostgreSQL `farm_states`，排除自己、今天已偷过的目标、被偷次数达上限的目标和没有成熟作物的目标，并从 `users` / `user_profiles` 生成昵称与头像。
`/api/farm/steal/do` 已按旧 Next 路由兼容 `{ targetUserId }` 请求体和 `{ success, data, steal }` 响应形状，内部执行 `ExecuteSteal` 后再调用 `GetStatus` 返回完整农场状态。
这些目前只是 Go 内部能力，Gateway 仍没有任何 `/api/farm` 规则。

HTTP 层已补 PostgreSQL integration 覆盖：

- `GET /api/farm/status` 在真实 PostgreSQL 下创建缺失农场状态、写入初始 100 积分账户和确定性积分流水。
- `POST /api/farm/plant` 在真实 PostgreSQL 下完成认证请求、播种响应和作物状态持久化校验。
- `POST /api/farm/water` 在真实 PostgreSQL 下完成认证请求、浇水响应、首次浇水奖励流水和状态持久化校验。
- `POST /api/farm/water-all` 在真实 PostgreSQL 下完成认证请求、一键浇水数量和批量状态持久化校验。
- `POST /api/farm/harvest` 在真实 PostgreSQL 下完成认证请求、手动收获响应、收获流水、首次收获奖励流水和状态持久化校验。
- `POST /api/farm/harvest-all` 在真实 PostgreSQL 下完成认证请求、一键收获响应、批量收获流水、首次收获奖励流水和状态持久化校验。
- `POST /api/farm/remove` 在真实 PostgreSQL 下完成认证请求、清除枯萎作物响应和状态持久化校验。
- `POST /api/farm/buy-land` 在真实 PostgreSQL 下完成认证请求、积分扣减、`exchange` 消费流水、土地解锁和状态持久化校验。
- `POST /api/farm/shop/buy` 在真实 PostgreSQL 下完成认证请求、积分扣减、`exchange` 消费流水、背包库存增加、每日限购计数和状态持久化校验。
- `POST /api/farm/shop/use` 在真实 PostgreSQL 下完成认证请求、背包库存扣减、道具效果写回和状态持久化校验。
- `POST /api/farm/seeds/buy` 在真实 PostgreSQL 下完成认证请求、积分扣减、`exchange` 消费流水、种子库存增加和状态持久化校验。
- `POST /api/farm/pet/adopt` 在真实 PostgreSQL 下完成认证请求、首次领养奖励流水、宠物状态写回和状态持久化校验。
- `POST /api/farm/pet/feed` 在真实 PostgreSQL 下完成认证请求、背包库存扣减、宠物数值与每日计数写回和状态持久化校验。
- `POST /api/farm/pet/wash`、`POST /api/farm/pet/drink`、`POST /api/farm/pet/play` 在真实 PostgreSQL 下完成认证请求、免费/付费宠物物品效果、背包库存扣减和状态持久化校验。
- `POST /api/farm/pet/dispatch` 在真实 PostgreSQL 下完成认证请求、宠物任务派遣响应和任务状态持久化校验。
- `GET /api/farm/steal/list` 在真实 PostgreSQL 下完成认证请求、候选目标筛选和旧响应结构校验。
- `POST /api/farm/steal/do` 在真实 PostgreSQL 下完成认证请求、偷菜结算响应和双方状态持久化校验；成功/失败分支都验证状态一致性。

当前已补直连 Go API 冒烟脚本：

```bash
node scripts/smoke-farm-go-api.mjs
```

默认模式通过 `docker compose exec -T api` 直连 Go API 容器，不经过 Gateway；会验证 `/readyz`、当前全部前端 `/api/farm` 路径的未登录边界，并确认 `gateway/Caddyfile` 没有 `/api/farm` 规则。
真实导入数据和登录 Cookie 可用后，可以传入 `FARM_GO_API_COOKIE`，脚本会额外验证登录态 `GET /api/farm/status` 与 `GET /api/farm/steal/list` 的旧兼容响应。

当前已补 Docker 测试库写路径自动冒烟脚本：

```bash
node scripts/smoke-farm-write-go-api.mjs
```

默认模式通过 `docker compose exec -T api` 直连 Go API 容器，并用 PostgreSQL 专用高位测试用户验证：

- `GET /api/farm/status`
- `POST /api/farm/seeds/buy`
- `POST /api/farm/plant`
- `POST /api/farm/water`
- `POST /api/farm/harvest`
- `POST /api/farm/shop/buy`
- `POST /api/farm/shop/use`
- `POST /api/farm/pet/adopt`
- `POST /api/farm/pet/feed`
- `POST /api/farm/pet/wash`
- `POST /api/farm/pet/drink`
- `POST /api/farm/pet/play`
- `GET /api/farm/steal/list`
- `POST /api/farm/steal/do`

脚本会查库确认农场状态、积分流水、每日购买计数、宠物状态和偷菜目标状态发生写入，并在最后自动清理测试用户、农场状态、积分账户、积分流水和每日购买记录。

Go 当前已补一个底层 PostgreSQL store：

- `GetState`：读取 `farm_states.state_json`。
- `SaveState`：写回完整农场 JSON 状态。
- `ListDailyPurchases`：读取某天农场商店限购计数。
- `AddFarmPoints`：按确定性 `point_ledger.id` 幂等写入农场懒结算积分流水，并更新 `point_accounts.balance`。

这个 store 只提供数据边界，不直接处理 HTTP。

Go 当前也已补内部 status 服务层骨架：

- `GetStatus`：读取已有 `farm_states.state_json`。
- 状态缺失时创建并保存初始农场状态：4 块空地、4 块锁定地、新手种子礼包、欢迎事件和基础时间戳。
- 首次创建农场时，如果福利积分账户余额为 0，会写入 100 初始积分和确定性积分流水 `farm_initial:{userId}` 语义对应的 Go 流水 ID。
- 对已有状态读取 PostgreSQL `point_accounts.balance`，同步 `state.points` 并写回 `farm_states.state_json`。
- 执行基础作物 tick 并写回：换季枯萎、雨天自动浇水、缺水累计、3 次缺水枯萎、乌鸦窗口推进、周五随机事件、成熟状态、过熟 48 小时枯萎和事件追加。
- 执行宠物基础懒结算并写回：每日衰减、按小时衰减、每日计数重置、非偷菜任务结束、情绪过低罢工、自动浇水任务、被动收菜、被动播种和任务事件。
- 宠物被动收菜会按旧品质/缺水/季节/过熟/偷菜扣减规则计算收益，清空成熟土地，写入 harvest/pet_task 事件，并通过 PostgreSQL 积分账本入账；首次收获会补 `firstHarvest` 标记和 10 积分奖励。
- 种植内部结算已补：`ExecutePlant` 在 PostgreSQL 事务中锁定当前用户 `farm_states`，执行 tick、同步积分余额，校验 0 基 `plotIndex`、土地状态、作物季节、作物解锁土地数和种子库存，成功时消耗种子、写入成长/浇水时间和 plant 事件。
- 浇水内部结算已补：`ExecuteWater` 在 PostgreSQL 事务中锁定当前用户 `farm_states`，执行 tick、同步积分余额，校验单块土地和作物状态，更新 `lastWaterAt` / `nextWaterDueAt` / 土地状态；首次浇水会写入确定性 `farm_first_water_{userId}` 积分流水并设置 `firstWater` 标记。
- 一键浇水内部结算已补：`ExecuteWaterAll` 在 PostgreSQL 事务中锁定当前用户 `farm_states`，执行 tick、同步积分余额，跳过成熟/枯萎/被吃/空地/锁定土地，只给可浇水作物刷新 `lastWaterAt` / `nextWaterDueAt` 并返回处理数量。
- 手动收获内部结算已补：`ExecuteHarvest` 在 PostgreSQL 事务中锁定当前用户 `farm_states`，执行 tick、同步积分余额，校验单块土地和作物状态，按品质/缺水/季节/过熟/偷菜扣减计算收益，清空土地，写入确定性 `farm_harvest_{userId}_{plotIndex}_{plantedAt}_{cropId}` 收获流水；首次收获会写入 `farm_first_harvest_{userId}` 奖励流水并设置 `firstHarvest` 标记。
- 一键收获内部结算已补：`ExecuteHarvestAll` 在 PostgreSQL 事务中锁定当前用户 `farm_states`，执行 tick、同步积分余额，批量收获所有成熟作物，按稳定作物组件生成确定性 `farm_harvest_all_{userId}_{...}` 批量收获流水；没有可收获作物时返回旧兼容错误文案。
- 清除枯萎作物内部结算已补：`ExecuteRemove` 在 PostgreSQL 事务中锁定当前用户 `farm_states`，执行 tick、同步积分余额，只允许清除 `withered` 或 `eaten` 土地，并将土地恢复为 `empty`、`crop=null`。
- 购买土地内部结算已补：`ExecuteBuyLand` 在 PostgreSQL 事务中锁定当前用户 `farm_states`，执行 tick、同步积分余额，校验 1 基土地编号、锁定状态、顺序解锁和积分余额；扣积分成功后解锁土地、写入 `exchange` 消费流水和 `land_buy` 事件。
- 购买道具内部结算已补：`ExecuteBuyShopItem` 在 PostgreSQL 事务中锁定当前用户 `farm_states`，执行 tick、同步积分余额，读取 `farm_shop_overrides` 覆盖后的商品价格/每日限购，校验一次性设备、每日限购和余额；扣积分成功后写入 `exchange` 消费流水、增加背包库存并更新 `farm_daily_shop_purchases`。
- 使用道具内部结算已补：`ExecuteUseShopItem` 在 PostgreSQL 事务中锁定当前用户 `farm_states`，执行 tick，读取 `farm_shop_overrides` 覆盖后的商品持续时间/加速分钟数，按旧逻辑处理肥料、稻草人、铃铛、防鸟网、烟花、云朵瓶、加速券、宠物技能书和最后的晚餐，成功时扣减背包库存并写回状态。
- 购买种子内部结算已补：`ExecuteBuySeeds` 在 PostgreSQL 事务中锁定当前用户 `farm_states`，执行 tick、同步积分余额，校验作物、数量、解锁土地和余额；扣积分成功后写入 `exchange` 消费流水、增加 `seedInventory` 并写回状态。
- 宠物领养内部结算已补：`ExecuteAdoptPet` 在 PostgreSQL 事务中锁定当前用户 `farm_states`，执行 tick、同步积分余额，校验宠物类型和重复领养；首次领养写入 `farm_first_adopt_{userId}` 奖励流水并设置 `firstAdopt`，再次领养扣减 50 积分并写入 `exchange` 消费流水。
- 宠物喂养内部结算已补：`ExecuteFeedPet` 在 PostgreSQL 事务中锁定当前用户 `farm_states`，执行 tick、宠物懒结算和积分同步，读取宠粮商品配置，校验普通/高级宠粮类型、库存和每日次数，成功时扣减背包并更新宠物饱食、口渴、情绪、健康、成长和 `feedToday`。
- 宠物物品内部结算已补：`ExecuteUsePetItem` 在 PostgreSQL 事务中锁定当前用户 `farm_states`，执行 tick、宠物懒结算和积分同步，读取商城商品配置，按旧分类校验 `drink`/`care`/`rest`/`play`，成功时扣减付费物品背包并更新宠物数值和每日限制字段。
- 宠物派遣内部结算已补：`ExecuteDispatchPet` 在 PostgreSQL 事务中锁定当前用户 `farm_states`，执行 tick、宠物懒结算和积分同步，只允许旧路由支持的五类任务；普通派遣写回任务时间和冷却，收菜派遣批量收获成熟作物并写入 `宠物收菜` 积分流水，种菜派遣按当前季节和库存最多播种 3 块空地。
- 偷菜候选列表已补：`ListStealCandidates` 读取当前用户已偷目标计数，并从 PostgreSQL `farm_states`、`users`、`user_profiles` 组合出候选；筛选逻辑覆盖可偷成熟作物、每日每目标偷菜限制和目标每日被偷上限。
- 偷菜内部结算已补：可偷成熟作物筛选、随机选择、按宠物状态/目标守护/铃铛计算成功率；`ExecuteSteal` 在同一 PostgreSQL 事务中锁定双方 `farm_states`，执行双方 tick、宠物偷菜技能校验和派遣，成功时清空目标成熟作物、写双方事件、更新双方偷菜计数，并通过确定性 `point_ledger.id` 给偷菜者入账；失败时消耗当日偷菜次数但不改目标作物、不写积分流水。
- 构造旧前端兼容的 `FarmStatusResponse` 顶层字段。
- 复刻中国时区日期、季节轮转、天气随机、明日天气预报、下一次每日刷新和下一次换季时间。
- 推导 `computedLands`，包含土地状态、成长阶段、进度、剩余时间、下次浇水、过熟系数、防护状态和防鸟网状态。
- 推导当前季节 `plantableCrops`。
- 从 `farm_daily_shop_purchases` 读取当日商店限购计数。

该服务层当前仍只开放为 Go 内部精确路由能力，Gateway 仍没有任何 `/api/farm` 规则。

即使只迁移 `/api/farm/status`，也必须先完整覆盖旧 `FarmStatusResponse`：

- `state`
- `computedLands`
- `world`
- `weatherForecast`
- `shopDailyPurchases`
- `serverNow`
- `plantableCrops`
- `nextSeasonInMs`
- `nextDailyInMs`

同时还必须覆盖懒结算与写回语义，否则前端显示会和后续写接口出现状态分叉。

## 当前不切流原因

1. PostgreSQL 已有 farm runtime 基础表、Go store、内部 status 服务层和主要写接口结算能力，但还没有用真实导入数据完成直连 API 与页面级冒烟。
2. D1/KV 导入器已完成最小承接，但尚未用真实生产 D1 导出执行全量导入。
3. Go 已实现当前前端使用的全部农场路径内部能力：状态、种植、浇水、一键浇水、手动收获、一键收获、清除枯萎作物、购买土地、购买道具、使用道具、购买种子、宠物领养、宠物喂养、宠物保养/喂水/互动、宠物派遣、偷菜候选列表和偷菜执行；真实 PostgreSQL 下的 HTTP integration 和测试库写路径自动冒烟已覆盖，但尚未完成真实导入数据后的直连 API 冒烟和前端路径级冒烟。
4. `/api/farm/status` 不是纯读接口，直接迁移只读版本会丢失懒结算写回。
5. 农场写接口仍留在 Next，单独切 status 容易造成 Go/Next 双写或读写分叉。

## 后续迁移建议

建议把农场拆成独立阶段，不和普通游戏结算混在一起：

1. 用真实 D1 导出执行 `migrate-d1 -apply -scope farm-v2`，并核对导入数量。
2. 使用真实导入数据做直连 API 冒烟：
   - 先跑 `node scripts/smoke-farm-go-api.mjs`，确认 Gateway 仍未切流且全部 Go 内部农场路径可达。
   - 带真实登录 Cookie 设置 `FARM_GO_API_COOKIE` 后复跑脚本，确认登录态只读响应兼容。
   - `GET/POST /api/farm/status`。
   - 已迁移的单用户写接口、`GET /api/farm/steal/list` 和 `POST /api/farm/steal/do`。
   - 先用测试夹具复跑 `node scripts/smoke-farm-write-go-api.mjs`，再用真实样本账号做页面级复核。
3. 使用真实导入数据做页面冒烟：
   - 桌宠页面。
   - `/farm` 农场页完整渲染。
   - 打开农场后懒结算写回可复验。
4. 最后再评估是否按精确路径逐步切流，仍不建议打开 `/api/farm*` 通配。

写接口迁移要在 status 稳定后分批处理，不建议一次性打开 `/api/farm*`。

## Gateway 原则

当前禁止添加：

```caddyfile
handle /api/farm* {
	reverse_proxy api:8080
}
```

在完整状态迁移和页面冒烟完成前，也不要添加：

```caddyfile
handle /api/farm/status {
	reverse_proxy api:8080
}
```

## 回滚思路

如果未来切流后发现农场状态异常：

1. 从 `gateway/Caddyfile` 移除 `/api/farm/status` 精确规则。
2. 重建并重启 `gateway`。
3. 验证 `/api/farm/status` 回落到 Next。
4. 对比 PostgreSQL `farm_states` 与旧导入源，确认是否发生状态分叉。
5. 暂停农场写接口迁移，先修复导入或 tick 兼容问题。
