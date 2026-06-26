# Go + Zeabur 后端重构迁移计划

## 1. 背景与目标

当前项目以 Next.js + OpenNext 部署在 Cloudflare Workers 上，数据主要通过 Cloudflare D1 承载，并用 `d1-kv.ts` 将 D1 模拟成 Redis/KV 语义。随着项目从兑换码分发扩展为积分、商城、卡牌、抽奖、小游戏、农场、环保行动和后台管理平台，高频写入和状态结算接口开始暴露出明显瓶颈。

本轮重构目标：

1. 将部署形态迁移为 Zeabur 多服务 Docker 部署。
2. 使用 Go 重写高频后端路径，优先解决游戏结算、环保行动拖拽结算、商城购买/兑换的卡顿与失败。
3. 使用 PostgreSQL 作为最终一致的数据源，使用 Redis 处理锁、限流、幂等和热点缓存。
4. 保留 Next.js 前端，按 API 前缀逐步切流到 Go，降低一次性迁移风险。
5. 将本文件作为长期迁移索引，后续每个阶段完成后同步更新进度。

## 2. 当前系统现状

当前技术栈：

- 前端与 API：Next.js 16 App Router
- Cloudflare 部署：OpenNext + Workers
- 主数据层：Cloudflare D1
- D1 兼容层：`d1-kv.ts` 模拟 KV/List/Set/ZSet/Hash
- 对象存储：R2，包括反馈图、卡牌图、OpenNext 增量缓存
- 部分实时/状态能力：Durable Object，用于扫雷会话
- 定时任务：Cloudflare Cron + Worker 自调用

当前主要风险点：

1. 高频业务把 D1 当 Redis 使用，读写链路偏重。
2. 环保行动使用整份 `eco:state:{userId}` JSON 读写，同一用户高频拖拽会被用户锁串行化。
3. 积分、商城、游戏结算依赖多次 KV 操作和手工补偿，缺少真正数据库事务边界。
4. Cloudflare 绑定较多，迁移到普通服务器需要替换 D1、R2、Durable Object、Cron、自引用 Worker 等平台能力。

## 3. 本轮重构范围

本轮优先完成可持续迁移的基础阶段和第一批后端能力：

1. 建立长期重构计划文档。
2. 增加 Zeabur/Docker 多服务部署骨架。
3. 新增 Go 后端基础工程，包括 API 服务、Worker 服务、健康检查、配置加载、日志、数据库和 Redis 客户端。
4. 设计 PostgreSQL 迁移目录和基础 schema 框架。
5. 设计 D1 到 PostgreSQL 的迁移命令入口。
6. 为后续高频 API 迁移预留内部接口和目录结构。

第一批实际业务迁移顺序：

1. 积分账本与商城兑换。
2. 环保行动状态和结算。
3. 游戏会话与结算。
4. 后台定时任务。

## 4. 本轮不做但后续要做的内容

本轮不直接完成全部业务重写，避免一次性改动过大。

后续迁移内容：

1. 抽奖、多人抽奖、发奖队列。
2. 农场全量业务。
3. 卡牌系统全量业务。
4. 反馈墙与图片上传管理。
5. 管理后台 API。
6. 排行榜结算和历史奖励。
7. 完全移除 D1-KV 兼容层。
8. 完全移除 Cloudflare Workers/OpenNext 专用部署链路。

后续优化内容：

1. 将前端直接对接 Go API 类型定义。
2. 给 Go API 增加 OpenAPI 文档。
3. 建立灰度开关和自动回滚策略。
4. 增加性能压测流水线。
5. 增加生产观测看板和告警。

## 5. 目标架构

Zeabur 多服务目标结构：

```text
gateway(Caddy)
├── /api/points*       -> api(Go, 按阶段打开)
├── /api/store*        -> api(Go, 按阶段打开)
├── /api/games/eco*    -> api(Go, 按阶段打开)
├── /api/games/*       -> api(Go, 按阶段打开)
└── 其他请求           -> web(Next.js)

api(Go)
├── PostgreSQL
├── Redis
├── R2(S3 API)
└── new-api 外部服务

worker(Go)
├── 定时结算
├── 发奖队列
├── 邮件提醒
└── 环保行动追查任务
```

服务职责：

- `gateway`：唯一公开入口，负责路径转发和前缀切流。
- `web`：Next.js 前端和未迁移 API。
- `api`：Go HTTP API，逐步接管高频后端。
- `worker`：Go 后台任务，逐步替代 Cloudflare Cron。
- `postgres`：最终一致数据源。
- `redis`：锁、限流、幂等、热点缓存。

## 6. 分阶段实施计划

### 阶段 0：文档与基础设施

完成内容：

- 创建本重构计划文档。
- 新增 Dockerfile、Compose、Gateway 配置。
- 新增 Go 后端基础目录。
- 新增健康检查和就绪检查。
- 验证本地 Docker Compose 能启动。

完成标准：

- `docker compose up` 可以启动 `gateway`、`web`、`api`、`worker`、`postgres`、`redis`。
- `GET /healthz` 返回 200。
- `GET /readyz` 能检测 PostgreSQL 和 Redis。

### 阶段 1：积分与商城

完成内容：

- Go 接管积分账户、积分流水和每日游戏积分上限。
- Go 接管商城列表、兑换、充值、提现。
- Next 未迁移模块通过 Go 内部经济 API 操作积分。
- PostgreSQL transaction 保证扣分、发奖、日志写入一致。

完成标准：

- 积分余额不能被并发扣成负数。
- 商城兑换重复提交不会重复扣分。
- 发奖失败时积分和限购计数能回滚。
- 旧前端无需大改即可使用 Go 返回结果。

### 阶段 2：环保行动

完成内容：

- 将 `eco:state:{userId}` 拆成结构化 PostgreSQL 表。
- Go 接管环保行动状态、拖拽回收、升级购买、道具购买、奖品售卖和偷盗逻辑。
- 前端拖拽请求批量提交，减少单用户高频请求。
- 全服奖品库存用数据库行锁保护。

完成标准：

- 高频拖拽不会频繁返回“结算失败”。
- 同一用户并发 collect 最终积分正确。
- 全服奖品不会超卖。
- 环保排行榜数据可正常生成。

### 阶段 3：游戏结算

完成内容：

- 按游戏完整前缀迁移 start/status/step/submit/cancel。
- 先迁记忆、消消乐、打地鼠。
- 再迁扫雷、Roguelite、连连看。
- 用 golden fixtures 校验 Go 版服务端复算与 TypeScript 版一致。

完成标准：

- 同一 session 重复 submit 只结算一次。
- 会话过期、非本人提交、未完成提交都能被拒绝。
- 游戏记录、每日统计、积分发放一致。

### 阶段 4：后台任务

完成内容：

- Go Worker 接管发奖队列。
- Go Worker 接管数字炸弹结算。
- Go Worker 接管农场成熟邮件提醒。
- Go Worker 接管环保行动偷盗追查。

完成标准：

- 定时任务具备幂等状态。
- Worker 重启后能继续处理未完成任务。
- Cloudflare Cron 可以停用。

### 阶段 5：低频业务逐步收口

完成内容：

- 迁移抽奖、多人抽奖、农场、卡牌、反馈墙、管理后台。
- 移除 D1-KV 兼容层。
- 移除 Cloudflare 专用绑定依赖。

完成标准：

- Cloudflare Workers 部署链路只保留历史归档。
- Zeabur 成为唯一生产部署入口。
- PostgreSQL 成为唯一写入源。

## 7. 数据初始化与可选迁移计划

当前生产策略已调整为 fresh Zeabur 新部署，不从 Cloudflare D1 迁移历史数据。
这样可以更快完成 Zeabur 上线，也避免旧 Cloudflare 数据格式继续拖慢生产切流。

新部署步骤：

1. 在 Zeabur 创建空 PostgreSQL 和 Redis。
2. 部署 `api` 后先执行 `/app/migrate`，应用全部 PostgreSQL migration。
3. 复核 schema 版本、默认配置、商城/卡牌/农场等必要种子数据。
4. 使用新账号、管理员账号和代表性样本流程做真实登录态 API 冒烟与页面级冒烟。
5. 证据包记录 `database.mode=fresh-zeabur`、`database.migrationsApplied=true` 和 `database.seedDataReviewed=true`。
6. 再按精确 Gateway 路径进入切流评估。

D1 导入工具保留为可选归档迁移能力。
只有后续明确要补导旧 Cloudflare 数据时，才执行以下短暂停机迁移：

1. 上线维护模式，阻止生产写入。
2. 从 Cloudflare D1 导出最终数据。
3. 运行 Go 迁移命令导入 PostgreSQL。
4. 校验用户数、积分余额、积分流水、游戏记录、环保状态。
5. 切换 Gateway 前缀到 Go。
6. 冒烟测试通过后关闭维护模式。

数据源优先级：

1. 优先使用 `native_*` 表。
2. 若 native 表没有覆盖，再从 `kv_*` 表读取旧 key。
3. 不迁移旧锁、旧限流计数、过期 session、未完成游戏会话。

核心映射：

- `native_users` -> `users`
- `native_user_points` -> `point_accounts`
- `native_user_point_logs` -> `point_ledger`
- `native_user_daily_game_points` -> `daily_game_points`
- `native_game_sessions` -> `game_sessions`
- `native_game_records` -> `game_records`
- `native_game_daily_stats` -> `game_daily_stats`
- `store:*` -> 商城相关表
- `raffle:entries:*` -> `raffle_entries`
- `eco:state:*` -> `eco_states`、`eco_user_upgrades`、`eco_prize_inventory`、`eco_prize_lots`、`eco_visible_prizes`、`eco_item_purchases`
- `eco:global-prize-stock` -> `eco_global_prize_stock`
- `eco:public-prizes` -> `eco_public_prizes`
- `eco:thefts` -> `eco_thefts`
- `eco:prize-claims:*` -> `eco_prize_claim_stats`
- `eco:trash-rank:*` -> `eco_trash_rankings`
- `eco:lock:*`、`eco:global-prize-stock:lock`、`eco:theft-investigation:lock` -> 不迁移运行时锁

## 8. API 切流计划

切流方式：按 API 前缀逐步切流。

第一批前缀：

- `/api/points`
- `/api/store`
- `/api/games/eco`

第二批前缀：

- `/api/games/memory`
- `/api/games/match3`
- `/api/games/whack-mole`

第三批前缀：

- `/api/games/minesweeper`
- `/api/games/roguelite`
- `/api/games/linkgame`

回滚方式：

- Gateway 将指定前缀重新转回 Next。
- PostgreSQL 保留切流后的写入记录。
- 若需要全量回滚，进入维护模式后按迁移批次生成补偿脚本。

## 9. 测试与验收标准

单元测试：

- 积分加减。
- 每日游戏积分上限。
- 商城兑换和失败回滚。
- 环保行动时间推进。
- 游戏结算幂等。

并发测试：

- 同一用户 100 个并发兑换请求。
- 同一 session 100 次重复 submit。
- 环保 collect 高频并发。
- 全服奖品库存并发扣减。

迁移校验：

- 用户数一致。
- 积分余额一致。
- 积分流水总和一致。
- 游戏记录数一致。
- 环保状态抽样一致。

部署验收：

- `GET /healthz` 返回 200。
- `GET /readyz` 能检测 PostgreSQL、Redis、R2、new-api。
- 高频接口 P95 低于 500ms。
- 切流后 24 小时错误率低于 1%。

## 10. 风险与回滚

主要风险：

1. D1-KV 旧数据格式不统一，迁移时可能漏映射。
2. TypeScript 游戏引擎与 Go 版复算结果不一致。
3. 环保行动大 JSON 拆表后可能出现状态字段遗漏。
4. 切流期间旧 Next API 与新 Go API 双写导致数据不一致。
5. Zeabur 服务变量或私网地址配置错误导致服务无法互通。

控制策略：

- 第一阶段只允许 PostgreSQL 作为唯一写入源。
- 前缀切流，不做同一接口双写。
- 每次迁移前生成 dry-run 报告。
- 每个业务前缀单独回滚。
- 保留 D1 只读归档。

## 11. 后续重构路线图

短期：

- 完成 Docker/Zeabur 基础部署。
- 完成 Go API 健康检查、就绪检查、配置加载。
- 完成 PostgreSQL/Redis 接入。
- 完成积分账本和商城兑换迁移。

中期：

- 完成环保行动迁移。
- 完成普通小游戏结算迁移。
- 完成 Go Worker 后台任务迁移。

长期：

- 完成抽奖、农场、卡牌、反馈墙和管理后台迁移。
- 输出 OpenAPI 文档。
- 建立压测和观测体系。
- 删除 Cloudflare 专用运行时依赖。

## 12. 进度记录

| 日期 | 阶段 | 内容 | 状态 |
| --- | --- | --- | --- |
| 2026-06-22 | 阶段 0 | 创建 Go + Zeabur 后端重构迁移计划文档 | 已完成 |
| 2026-06-22 | 阶段 0 | 新增 Docker/Compose/Gateway/Go API/Go Worker 基础骨架 | 已完成 |
| 2026-06-22 | 阶段 0 | 新增 D1 导出 dry-run 分析命令，真实导入待字段映射确认 | 已完成 |
| 2026-06-22 | 阶段 0 | `go test ./...`、`go build ./cmd/api ./cmd/worker ./cmd/migrate-d1`、`npm run typecheck`、`npm run build` 验证通过 | 已完成 |
| 2026-06-22 | 阶段 0 | `docker compose config` 验证通过；本机 Docker Engine 未运行，镜像构建待 Docker 启动后复验 | 已由后续容器实测补齐 |
| 2026-06-22 | 阶段 1 | 新增 PostgreSQL migration runner 与 `0002_store.sql` 商城/用户资产 schema | 已完成 |
| 2026-06-22 | 阶段 1 | Go 接管 `/api/points`、`/api/store`、`/api/store/exchange` 的核心实现，支持事务扣分、限购、库存、兑换日志、幂等键 | 代码完成 |
| 2026-06-22 | 阶段 1 | `/api/store/topup`、`/api/store/withdraw` 暂不切到 Go，避免外部额度半迁移 | 待迁移 |
| 2026-06-22 | 阶段 1 | `go test ./...`、`go build ./cmd/api ./cmd/worker ./cmd/migrate ./cmd/migrate-d1`、`go run ./cmd/migrate -dry-run`、`docker compose config`、`npm run typecheck` 验证通过 | 已完成 |
| 2026-06-22 | 阶段 1 | Docker Desktop 恢复后，`docker compose up --build -d` 成功启动 gateway/web/api/worker/postgres/redis | 已完成 |
| 2026-06-22 | 阶段 1 | 容器冒烟测试通过：`/healthz`、`/readyz`、首页经 Gateway 均返回 200，`/readyz` 显示 PostgreSQL 与 Redis 可连接 | 已完成 |
| 2026-06-22 | 阶段 1 | 浏览器打开首页标题正常；旧 Next API 中 `/api/projects`、`/api/raffle` 因缺少 `KV_DB` 或 `KV_REST_API_URL/KV_REST_API_TOKEN` 在 Docker 下返回 500 | 部分可用 |
| 2026-06-22 | 阶段 1 | 修复后端镜像默认命令：`CMD /app/api` 支持 `docker compose run api /app/migrate` 一次性命令覆盖 | 已完成 |
| 2026-06-22 | 阶段 1 | 容器内 `/app/migrate` 已在主库应用 `0001_base.sql`、`0002_store.sql`，`/readyz` 复验通过 | 已完成 |
| 2026-06-22 | 阶段 1 | 创建 Docker PostgreSQL `app_test` 测试库并执行 `go test -tags integration ./internal/economy`，真实并发兑换测试通过 | 已完成 |
| 2026-06-22 | 阶段 1 | 新增 `0003_welfare_lists.sql`，建立公开福利项目与抽奖活动列表的 PostgreSQL 表 | 已完成 |
| 2026-06-22 | 阶段 1 | Go 接管 `GET /api/projects` 与 `GET /api/raffle` 公开只读列表，Gateway 精确路径切流，不影响抽奖详情/参与/后台管理 | 已完成 |
| 2026-06-22 | 阶段 1 | `go test ./...`、`go test -tags integration ./internal/economy ./internal/welfare`、Docker 镜像重建、主库 migration、接口冒烟与浏览器检查通过 | 已完成 |
| 2026-06-22 | 阶段 1 | Docker 首页控制台中 `/api/projects`、`/api/raffle` 的 500 已消除，剩余错误为未登录接口返回 401 | 已完成 |
| 2026-06-22 | 阶段 1 Review | 修复幂等键并发漏洞：事务开始先占用幂等键，重复请求等待并复用首次结果 | 已完成 |
| 2026-06-22 | 阶段 1 Review | 事务策略调整为 `Read Committed + FOR UPDATE` 热点行锁，并保留 `40001` 与死锁有限重试，避免高并发兑换暴露瞬时失败 | 已完成 |
| 2026-06-22 | 阶段 1 Review | 新增 `go test -tags integration ./internal/economy` PostgreSQL 并发兑换测试入口，需 `TEST_DATABASE_URL` 指向测试库 | 已完成 |
| 2026-06-22 | 阶段 1 迁移映射 | 增强 `migrate-d1` dry-run：输出 native/KV 源数据到 PostgreSQL 目标表/字段的映射估算 | 已完成 |
| 2026-06-22 | 阶段 1 迁移映射 | dry-run 可识别积分、商城商品/分类、兑换记录、每日限购、额外抽奖、补签卡、卡牌抽卡次数 | 已完成 |
| 2026-06-22 | 阶段 1 迁移映射 | dry-run 会列出 `wallet:*`、`eco:*`、`exchange_uncertain:*` 等未映射数据源，避免真实导入遗漏 | 已完成 |
| 2026-06-22 | 阶段 1 迁移映射 | dry-run 补齐 `projects:*`、`project:list`、`raffle:*`、`raffle:list`、`raffle:active` 到 PostgreSQL 公开列表表的映射 | 已完成 |
| 2026-06-22 | 阶段 1 迁移导入 | `migrate-d1 -apply -scope public-lists` 已开放，只写入 `projects` 与 `raffles`，默认 dry-run 不变 | 已完成 |
| 2026-06-22 | 阶段 1 迁移导入 | public-lists 导入器已通过单元测试、PostgreSQL integration、本地 CLI dry-run/apply、Docker 容器内 apply 验证 | 已完成 |
| 2026-06-22 | 阶段 1 迁移导入 | `migrate-d1 -apply -scope users-points` 已开放，写入 `users` 与 `point_accounts`，native 余额优先于 legacy `points:*` | 已完成 |
| 2026-06-22 | 阶段 1 迁移导入 | users-points 导入器已通过单元测试、PostgreSQL integration、本地 CLI dry-run/apply、Docker 容器内 apply、`/readyz` 复验 | 已完成 |
| 2026-06-22 | 阶段 1 迁移导入 | `migrate-d1 -apply -scope points-history` 已开放，写入 `point_ledger` 与 `daily_game_points`，缺失用户会创建占位用户 | 已完成 |
| 2026-06-22 | 阶段 1 迁移导入 | points-history 导入器已通过单元测试、PostgreSQL integration、本地 CLI dry-run/apply、Docker 容器内 apply、`/readyz` 复验 | 已完成 |
| 2026-06-22 | 阶段 1 迁移导入 | `migrate-d1 -apply -scope store-data` 已开放，写入商城分类、商品、购买次数、兑换日志与每日限购计数 | 已完成 |
| 2026-06-22 | 阶段 1 迁移导入 | store-data 导入器已通过单元测试、PostgreSQL integration、本地 CLI dry-run/apply、Docker 容器内 apply、Compose 配置与 `/readyz` 复验 | 已完成 |
| 2026-06-22 | 阶段 1 迁移导入 | `migrate-d1 -apply -scope user-assets` 已开放，写入 `user_assets`，native 抽奖/卡牌次数优先于 legacy 来源，补签卡使用 legacy 来源 | 已完成 |
| 2026-06-22 | 阶段 1 迁移导入 | user-assets 导入器已通过单元测试、PostgreSQL integration、本地 CLI dry-run/apply、Docker 容器内 apply、Compose 配置与 `/readyz` 复验 | 已完成 |
| 2026-06-22 | 阶段 1 商城后台 | Go 侧实现 `/api/store/admin` 商品/分类管理 GET/POST/PUT/PATCH/DELETE，农场商品配置仍返回 `NOT_MIGRATED` | 代码完成 |
| 2026-06-22 | 阶段 1 商城后台 | `go test ./...`、PostgreSQL integration、Docker 镜像重建、容器内 `/api/store/admin` 未登录 401、`/readyz` 复验通过；Gateway 仍未切流 | 已完成 |
| 2026-06-22 | 阶段 1 钱包接口 | 已复核 `/api/store/topup` 与 `/api/store/withdraw` 旧实现；迁移前需先补 Go new-api client、钱包交易审计表与失败补偿测试 | 待实现 |
| 2026-06-22 | 阶段 1 钱包基础 | 新增 `0004_wallet.sql`，建立 `wallet_transactions` 审计表，覆盖 pending/success/failed/uncertain、积分变化、额度变化、手续费与 new-api 余额快照 | 已完成 |
| 2026-06-22 | 阶段 1 钱包基础 | 新增 Go 侧提现/充值纯计算规则，保持与 `wallet-rules.ts` 的最低门槛、积分美元比例和阶梯手续费一致 | 已完成 |
| 2026-06-22 | 阶段 1 钱包基础 | `go test ./...`、PostgreSQL integration、`go run ./cmd/migrate -dry-run`、Docker 镜像重建、容器内 `/app/migrate`、schema 检查与 `/readyz` 复验通过 | 已完成 |
| 2026-06-22 | 阶段 1 钱包基础 | 新增 Go 侧 new-api 管理端 client 与配置字段，支持余额查询、加额度、扣额度和失败后二次 GET 验证；测试使用 `httptest`，未触发真实外部请求 | 已完成 |
| 2026-06-22 | 阶段 1 钱包基础 | new-api client 已通过 `go test ./...`、PostgreSQL integration、Docker 镜像重建、容器启动和 `/readyz` 复验；`/api/store/topup` 与 `/api/store/withdraw` 仍未接入 | 已完成 |
| 2026-06-22 | 阶段 1 钱包基础 | 新增钱包交易创建/状态更新服务方法，可写入 pending 并更新 success/failed/uncertain 及 new-api 余额快照 | 已完成 |
| 2026-06-22 | 阶段 1 钱包基础 | 钱包交易服务已通过 PostgreSQL integration 生命周期测试、`go test ./...`、Docker 镜像重建、容器启动和 `/readyz` 复验 | 已完成 |
| 2026-06-22 | 阶段 1 钱包基础 | 新增 Redis 用户级钱包操作锁，使用 `SET NX` + token 校验释放，防止同一用户并发提现/充值请求交错 | 已完成 |
| 2026-06-22 | 阶段 1 钱包基础 | 钱包锁已通过 fake Redis 单元测试、PostgreSQL integration、Docker 镜像重建、容器启动和 `/readyz` 复验 | 已完成 |
| 2026-06-23 | 阶段 1 钱包服务层 | 新增 Go 侧 `ExecuteWithdraw` / `ExecuteTopup`，串联 Redis 钱包锁、`wallet_transactions`、积分账本与 new-api quota client，暂不接 HTTP 路由 | 已完成 |
| 2026-06-23 | 阶段 1 钱包服务层 | 已覆盖提现成功、提现 uncertain、提现失败退款、充值成功、充值扣额度 uncertain、充值积分入账失败后额度回滚、钱包锁 busy 等路径 | 已完成 |
| 2026-06-23 | 阶段 1 钱包服务层 | `go test ./...` 与 `go test -tags integration ./internal/economy ./internal/migration/d1 ./internal/welfare` 验证通过；`/api/store/topup`、`/api/store/withdraw` 与 Gateway 商城切流仍未打开 | 已完成 |
| 2026-06-23 | 阶段 1 钱包 HTTP | Go API 接入 `GET /api/store/topup`、`POST /api/store/topup`、`POST /api/store/withdraw`，注入真实 new-api client；配置缺失时返回 503，不影响服务启动 | 已完成 |
| 2026-06-23 | 阶段 1 钱包 HTTP | 新增 HTTP 单元测试覆盖未登录、请求体校验、new-api 未配置 503；容器内直连 `/api/store/topup` 返回 401，证明 Go 路由已注册 | 已完成 |
| 2026-06-23 | 阶段 1 钱包 HTTP | `go test ./...`、PostgreSQL integration、Docker 镜像重建、api/worker 容器重启、`/readyz` 与 Caddyfile 切流检查均通过；Gateway 仍未转发商城路径 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖详情 | 新增 `0005_raffle_detail.sql`，为 `raffles` 增加 `winners`、`red_packet_packets`，并建立 `raffle_entries` 详情读取表 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖详情 | Go 侧接入内部 `GET /api/raffle/{id}`，返回公开详情、最近参与记录与可选登录用户参与/中奖状态；参与和开奖写路径仍未迁移 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖详情 | public-lists 导入器保留旧 raffle JSON 中的 `winners` 与 `redPacketPackets`；详情 integration 覆盖草稿隐藏、entries、userStatus 与 ended winners | 已完成 |
| 2026-06-23 | 阶段 1 抽奖详情 | `go test ./...`、PostgreSQL integration、`go run ./cmd/migrate -dry-run`、Docker build、容器内 `/app/migrate`、schema 检查与 `/readyz` 验证通过；Gateway 仍只精确转发 `/api/raffle` 列表 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖迁移导入 | `migrate-d1 -apply -scope raffle-entries` 已开放，只导入旧 D1 `kv_lists:raffle:entries:*` 到 PostgreSQL `raffle_entries`，缺失活动会 warning 跳过 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖迁移导入 | raffle-entries 导入器已通过单元测试、PostgreSQL integration、CLI dry-run/apply、Docker 镜像重建、容器内 apply 与 `/readyz` 复验；Gateway 仍未切 `/api/raffle/*` | 已完成 |
| 2026-06-23 | 阶段 1 抽奖参与服务层 | Go 侧新增普通抽奖 `JoinRaffle` 服务层，使用 PostgreSQL 行锁串行同一活动参与，事务内写入 `raffle_entries` 并回写参与人数；抢红包与开奖发奖仍未迁移 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖参与服务层 | 覆盖重复参与、异常状态、导入人数延续、20 并发参与一致性测试；`go test ./...`、PostgreSQL integration、Docker build、容器内 migration 与 `/readyz` 验证通过；尚未接 HTTP 路由和 Gateway | 已完成 |
| 2026-06-23 | 阶段 1 抽奖开奖服务层 | Go 侧新增普通抽奖 `ExecuteRaffleDraw` 服务层，使用 PostgreSQL 行锁保证同一活动只开奖一次，支持无人参与直接结束和有参与者生成 pending winners | 已完成 |
| 2026-06-23 | 阶段 1 抽奖开奖服务层 | 覆盖开奖保存 winners、历史 dollars 奖品兜底为 points、空活动结束、红包/非 active 拒绝、并发重复开奖只成功一次；`go test ./...`、PostgreSQL integration、Docker build、容器内 migration 与 `/readyz` 验证通过；发奖队列与 HTTP/Gateway 仍未接 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖发奖服务层 | Go 侧新增普通抽奖 `DeliverRaffleRewards` 服务层，复用积分账本幂等键发放 `raffle_win` 积分，并将 winners 状态更新为 delivered/pending | 已完成 |
| 2026-06-23 | 阶段 1 抽奖发奖服务层 | 覆盖开奖后发积分、重复发奖不重复加分、未开奖拒绝、坏奖品保持 pending；`go test ./...`、PostgreSQL integration、Docker build、容器内 migration 与 `/readyz` 验证通过；通知、中奖列表、异步队列、HTTP/Gateway 仍未接 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖 Join HTTP | Go API 接入内部 `POST /api/raffle/{id}/join`，普通抽奖参与成功后可串联 Join、Draw、Deliver；红包仍未迁移，不能切 `/api/raffle/*` | 已完成 |
| 2026-06-23 | 阶段 1 抽奖 Join HTTP | 覆盖未登录 401、阈值抽奖参与后自动开奖并发奖；`go test ./...`、HTTP/PostgreSQL integration、Docker build、容器内 migration、`/readyz`、容器内 join 路由 401 验证通过；Gateway 仍只精确转发 `/api/raffle` 列表 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖管理开奖 HTTP | Go API 接入内部 `POST /api/admin/raffle/{id}/draw`，管理员可手动触发普通抽奖开奖并同步发奖；异步发奖队列、通知和中奖列表仍待迁移 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖管理开奖 HTTP | 覆盖非管理员 403、管理员开奖发奖 integration；`go test ./...`、HTTP/PostgreSQL integration、Docker build、容器内 migration、`/readyz`、容器内后台开奖路由 403 验证通过；Gateway 未转发 `/api/admin/*` | 已完成 |
| 2026-06-23 | 阶段 1 抢红包服务层 | Go 侧新增 `GrabRedPacket` 服务层，使用 PostgreSQL 行锁串行同一活动抢红包，按 `red_packet_packets` 弹出整数积分包，写入参与记录和 winners，并即时走积分账本幂等发奖 | 已完成 |
| 2026-06-23 | 阶段 1 抢红包服务层 | 覆盖红包队列生成、最后一个红包发奖并结束、重复抢不消耗名额、12 并发抢 5 个名额不超发、空队列自动结束；`go test ./...`、PostgreSQL integration、Docker build、容器内 migration 与 `/readyz` 验证通过；HTTP/Gateway 仍未接 | 已完成 |
| 2026-06-23 | 阶段 1 抢红包 HTTP | Go 内部 `POST /api/raffle/{id}/join` 已按活动 mode 分派：普通抽奖走 `JoinRaffle`，抢红包走 `GrabRedPacket`，成功响应包含 `reward` | 已完成 |
| 2026-06-23 | 阶段 1 抢红包 HTTP | 覆盖红包 HTTP 参与、即时到账、活动结束和余额入账；`go test ./...`、HTTP/PostgreSQL integration、Docker build、容器内 migration 与 `/readyz` 验证通过；Gateway 仍只精确转发 `/api/raffle` 列表 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台重试发奖 HTTP | Go 内部接入 `POST /api/admin/raffle/{id}/retry`，复用 `DeliverRaffleRewards` 重试 pending winners，并沿用管理员校验和同源校验 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台重试发奖 HTTP | 覆盖非管理员 403、管理员重试 pending winner 后积分到账并写回 delivered；`go test ./...`、HTTP/PostgreSQL integration、Docker build、容器内 migration 与 `/readyz` 验证通过；Gateway 未转发 `/api/admin/*` | 已完成 |
| 2026-06-23 | 阶段 1 用户中奖列表 | 新增 `0006_raffle_user_wins.sql`，用 `user_raffle_wins` 保存用户维度中奖记录；发奖成功后尽力 upsert，失败不影响主发奖链路 | 已完成 |
| 2026-06-23 | 阶段 1 用户中奖列表 | 覆盖普通抽奖发奖、重复发奖不重复插入、抢红包即时发奖写入中奖列表；`go test ./...`、PostgreSQL integration、Docker build、容器内 migration、schema 检查与 `/readyz` 验证通过 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖中奖通知 | 新增 `0007_notifications.sql` 通用通知表；发奖成功后尽力写入确定性 `raffle_win:<entryId>` 通知，重试发奖不会重复通知 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖中奖通知 | 覆盖普通抽奖发奖、重复发奖和抢红包即时发奖的 `raffle_win` 通知写入；`go test ./...`、PostgreSQL integration、Docker build、容器内 migration、schema 检查与 `/readyz` 验证通过 | 已完成 |
| 2026-06-23 | 阶段 1 异步发奖队列 | 新增 `0008_raffle_delivery_jobs.sql` PostgreSQL 发奖队列；自动阈值开奖后改为入队，Go Worker 每 10 秒批量处理队列，后台手动开奖仍同步发奖 | 已完成 |
| 2026-06-23 | 阶段 1 异步发奖队列 | 覆盖入队去重、队列处理 pending winner、HTTP 自动开奖入队后手动处理队列到账；`go test ./...`、PostgreSQL integration、Docker build、容器内 migration、schema 检查与 `/readyz` 验证通过 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖公开路径 Gateway 切流 | Gateway 已打开 `/api/raffle/*` 到 Go；公开列表、详情、参与进入 Go，`/api/admin/raffle/*` 仍留在 Next | 已完成 |
| 2026-06-23 | 阶段 1 抽奖公开路径 Gateway 切流 | `go test ./...`、PostgreSQL integration、`docker compose config`、Gateway build/restart、Caddy validate、`/readyz`、`/api/raffle`、`/api/raffle/{id}` 404、`/api/raffle/{id}/join` 401、`/api/admin/raffle/{id}/draw` 仍走 Next 验证通过 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台只读 HTTP | Go 内部接入 `GET /api/admin/raffle` 与 `GET /api/admin/raffle/{id}`，支持管理员读取草稿/进行中/已结束/已取消活动、完整 winners、红包队列和参与记录 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台只读 HTTP | 覆盖非管理员 403、管理员列表读取 draft、详情读取 entries；`go test ./...`、HTTP/PostgreSQL integration、Docker build、容器内 migration、`/readyz`、容器内未登录 401 验证通过；Gateway 未转发 `/api/admin/*` | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台创建 HTTP | Go 内部接入 `POST /api/admin/raffle`，支持创建普通抽奖和抢红包草稿；红包草稿暂不生成 packets，发布时再生成 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台创建 HTTP | 覆盖非管理员 403、管理员创建普通抽奖/红包草稿、`go test ./...`、PostgreSQL integration、Docker build、容器内 migration 与 `/readyz`；Gateway 未转发 `/api/admin/*` | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台发布 HTTP | Go 内部接入 `POST /api/admin/raffle/{id}/publish`，仅允许 draft 发布；普通抽奖切 active，抢红包发布时生成 packets 并重置 remaining | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台发布 HTTP | 覆盖非管理员 403、普通抽奖发布、抢红包发布 packets 数量/总和、重复发布 400；`go test ./...`、PostgreSQL integration、Docker build、容器内 migration、`/readyz` 与 Caddy validate 通过；Gateway 未转发 `/api/admin/*` | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台取消 HTTP | Go 内部接入 `POST /api/admin/raffle/{id}/cancel`，支持取消 draft/active/cancelled 活动，并拒绝取消 ended 活动 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台取消 HTTP | 覆盖非管理员 403、active 活动取消成功、ended 活动取消 400；`go test ./...`、PostgreSQL integration、Docker build、容器内 migration 与 `/readyz` 通过；Gateway 未转发 `/api/admin/*` | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台删除 HTTP | Go 内部接入 `DELETE /api/admin/raffle/{id}`，仅允许删除 draft/cancelled 活动；删除前清理该活动发奖任务，`raffle_entries` 由外键级联删除 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台删除 HTTP | 覆盖非管理员 403、draft 删除成功、active 删除 400、cancelled 删除成功和数据库行删除确认；`go test ./...`、PostgreSQL integration、Docker build、容器内 migration、`/readyz` 与 Caddy validate 通过；Gateway 未转发 `/api/admin/*` | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台更新 HTTP | Go 内部接入 `PUT /api/admin/raffle/{id}`，仅允许更新 draft；支持普通抽奖字段更新、切换红包草稿，并保持红包 packets 发布时生成 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台更新 HTTP | 覆盖非管理员 403、普通抽奖更新、普通抽奖切红包、active 更新 400；`go test ./...`、PostgreSQL integration、Docker build、容器内 migration、`/readyz` 与 Caddy validate 通过；Gateway 未转发 `/api/admin/*` | 已完成 |
| 2026-06-23 | 阶段 1 后台认证冒烟 | `compose.yml` 已给 Go API 补齐 `ADMIN_USERNAMES`，`backend/README.md` 与 `deploy/zeabur.env.example` 明确 Web/Go API 的 `SESSION_SECRET`、`ADMIN_USERNAMES` 必须一致 | 已完成 |
| 2026-06-23 | 阶段 1 后台认证冒烟 | 容器内直连 Go API 验证：Next 同格式 `app_session` 管理员 cookie 可访问 `/api/admin/raffle` 并返回 `success:true`，普通用户 cookie 返回 403；Gateway 仍未转发 `/api/admin/*` | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台 Gateway 切流 | Gateway 精确打开 `/api/admin/raffle` 与 `/api/admin/raffle/*` 到 Go，其它 `/api/admin/*`、商城和环保路径仍留在 Next 或未切状态 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台 Gateway 切流 | `docker compose build gateway`、Gateway 重启、Caddy validate、`/readyz`、匿名列表 401、普通用户列表 403、管理员列表 200、管理员创建 200、删除清理 200 验证通过 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台页面冒烟 | Playwright 注入 Next 同格式管理员 `app_session` 后打开 `/admin/raffle`，页面正常显示“多人抽奖管理”和活动列表，网络请求 `/api/admin/raffle` 经 Gateway 返回 200 | 已完成 |
| 2026-06-23 | 阶段 1 抽奖后台页面冒烟 | 页面存在一个既有 `/api/farm/status` 500 控制台错误，和抽奖后台切流无关；后续迁移农场/环保相关接口时单独处理 | 已完成 |
| 2026-06-23 | 阶段 1 商城后台农场商品配置 | 新增 `farm_shop_overrides`，Go 侧 `/api/store/admin` GET 返回 `farmItems`，PATCH `kind:"farm-item"` 可保存农场商品 override；Gateway 仍未切 `/api/store*` | 已完成 |
| 2026-06-23 | 阶段 1 商城后台农场商品配置 | 对齐 Next `SHOP_ITEMS_V2` 字段、稳定排序和 override merge 语义；`go test ./...`、串行 PostgreSQL integration、Docker build、容器 migration、`/readyz`、直连 Go API PATCH/GET 验证通过 | 已完成 |
| 2026-06-23 | 阶段 1 商城后台 Gateway 切流 | Gateway 精确打开 `/api/store/admin` 到 Go，商城前台 `/api/store`、`/api/store/exchange`、`/api/store/topup`、`/api/store/withdraw` 和完整 `/api/store*` 仍未切 | 已完成 |
| 2026-06-23 | 阶段 1 商城后台 Gateway 切流 | `docker compose build gateway`、Gateway 重启、Caddy validate、`/readyz`、匿名 401、管理员 GET/PATCH 200、浏览器打开 `/admin/store` 并保存农场商品配置验证通过 | 已完成 |
| 2026-06-23 | 阶段 1 商城后台 Gateway 切流 | 浏览器仍可见既有 `/api/farm/status` 500 控制台错误，来源为农场状态接口，和商城后台 `/api/store/admin` 切流无关 | 已完成 |
| 2026-06-23 | 阶段 1 商城前台切流准备 | Go 侧为 `/api/store/exchange`、`/api/store/topup`、`/api/store/withdraw` 补齐可信来源校验，并为商城兑换/钱包写接口补齐 `store:exchange` 60 秒 20 次限流；`/api/store/topup` GET 补齐 `store:balance` 60 秒 30 次限流 | 已完成 |
| 2026-06-23 | 阶段 1 商城前台 Gateway 切流 | Gateway 精确打开 `/api/store` 与 `/api/store/exchange` 到 Go；钱包 `/api/store/topup`、`/api/store/withdraw` 和完整 `/api/store*` 仍未切 | 已完成 |
| 2026-06-23 | 阶段 1 商城前台 Gateway 切流 | `go test ./...`、串行 PostgreSQL integration、Docker build、API/Worker/Gateway 重启、容器 migration、Caddy validate、`/readyz`、匿名/跨站/限流冒烟、真实补签卡兑换与幂等重放验证通过 | 已完成 |
| 2026-06-23 | 阶段 1 商城前台 Gateway 切流 | 浏览器打开 `/store` 可正常显示福利商店、940 积分余额和商品列表；网络请求 `/api/store`、`/api/projects`、`/api/raffle?active=true` 均为 200，既有 `/api/farm/status` 500 仍待后续农场迁移处理 | 已完成 |
| 2026-06-23 | 阶段 1 积分查询 Gateway 切流 | Gateway 精确打开 `/api/points` 到 Go，保持 `{ success, data: { balance, logs } }` 响应结构；不使用 `/api/points*` 通配 | 已完成 |
| 2026-06-23 | 阶段 1 积分查询 Gateway 切流 | Gateway build/restart、Caddy validate、`/readyz`、匿名 401、登录烟测用户返回 940 余额与最近积分流水验证通过 | 已完成 |
| 2026-06-23 | 阶段 2 环保基础 schema | 新增 `0010_eco_base.sql`，建立环保状态、升级、奖品库存、奖品批次、公开奖品、偷盗记录、奖品领取统计和垃圾排行榜等 PostgreSQL 表 | 已完成 |
| 2026-06-23 | 阶段 2 环保 dry-run 映射 | D1 dry-run 已将 `eco:state:*`、`eco:global-prize-stock`、`eco:public-prizes`、`eco:thefts`、`eco:prize-claims:*`、`eco:trash-rank:*` 映射到结构化目标表；运行时锁仍保持不迁移 | 已完成 |
| 2026-06-23 | 阶段 2 环保基础 schema | `go test ./...`、串行 PostgreSQL integration、`go run ./cmd/migrate -dry-run`、Docker build、容器 migration、主库 `eco_*` 表检查、`/readyz` 和 Gateway 未切 `/api/games/eco*` 复核通过 | 已完成 |
| 2026-06-23 | 阶段 2 环保状态导入 | `migrate-d1 -apply -scope eco-state` 已开放，导入旧 `eco:state:{userId}` 到 `eco_states`、升级、奖品库存、奖品批次、可见奖品和道具购买表；公开奖品、偷盗、排行榜仍留到 `eco-global` 小块 | 已完成 |
| 2026-06-23 | 阶段 2 环保状态导入 | D1 dry-run 对 `eco:state:*` 已显示 6 张目标表映射；样例 testdata、单元测试、PostgreSQL integration、本地 CLI dry-run/apply、Docker 镜像重建、容器内 apply 与 `/readyz` 验证通过 | 已完成 |
| 2026-06-23 | 阶段 2 环保全局导入 | `migrate-d1 -apply -scope eco-global` 已开放，导入全局奖品库存、公开奖品、偷盗记录、奖品领取统计和垃圾排行榜；空公开奖品/偷盗数组会按快照清空目标表 | 已完成 |
| 2026-06-23 | 阶段 2 环保全局导入 | 覆盖 owner/thief 占位用户、JSON 数组解析、hash 统计、zset 排行榜、快照清空；`go test ./...`、PostgreSQL integration、本地 CLI dry-run/apply、Docker 镜像重建、容器内 apply 与 `/readyz` 验证通过 | 已完成 |
| 2026-06-23 | 阶段 2 环保服务层只读 | 新增 Go `internal/eco` 服务层，可从 `eco_states`、升级、库存、奖品批次、可见奖品和道具购买表重组用户状态快照；缺失状态时返回内存初始快照 | 已完成 |
| 2026-06-23 | 阶段 2 环保服务层只读 | 新增纯函数 `AdvanceState`，按刷新速度、容量和自动回收等级计算时间推进；当前不生成奖品、不写库、不改积分、不接 HTTP/Gateway | 已完成 |
| 2026-06-23 | 阶段 2 环保服务层只读 | `go test ./...`、`go test -tags integration ./internal/eco ...`、Docker 镜像重建、API/Worker 重启、`/readyz` 验证通过；Gateway 仍未打开 `/api/games/eco*` | 已完成 |
| 2026-06-23 | 阶段 2 环保批量回收服务层 | 新增 Go `CollectTrash` 服务层，使用 PostgreSQL 事务和 `eco_states FOR UPDATE` 串行同一用户拖拽回收；事务内完成时间推进、自动回收结算、手套加成、积分账本、每日环保积分和垃圾排行榜更新 | 已完成 |
| 2026-06-23 | 阶段 2 环保批量回收服务层 | 覆盖单次拖拽扣减、积分折算、每日统计重置、排行榜写入和 20 并发 collect 串行一致性；`go test ./...` 与 PostgreSQL integration 验证通过；当前仍不接 HTTP/Gateway | 已完成 |
| 2026-06-23 | 阶段 2 环保批量回收服务层 | Docker Desktop 恢复后已补跑 `docker compose build api worker`、`docker compose up -d api worker`、`docker compose ps` 与 `/readyz`，API/Worker/PostgreSQL/Redis 均正常 | 已完成 |
| 2026-06-23 | 阶段 2 环保 collect HTTP | Go 内部接入 `POST /api/games/eco/collect`，复用 `CollectTrash` 服务层，补齐同源校验、登录校验、`eco:collect` 60 秒 60 次限流和请求体校验 | 已完成 |
| 2026-06-23 | 阶段 2 环保 collect HTTP | 覆盖未登录 401、跨站 403、非法请求 400、无数据库 503、真实 PostgreSQL 回收入账和状态更新；`go test ./...`、串行 PostgreSQL integration、Docker build/restart、`/readyz` 均通过；Gateway 仍未打开 `/api/games/eco*` | 已完成 |
| 2026-06-23 | 阶段 2 环保 status HTTP | Go 内部接入 `GET /api/games/eco/status`，从结构化表重组旧前端 `EcoStatusResponse` 字段，包含升级、道具、奖品、公开奖品面板、可见奖品和价格历史；`collect` 成功后会尽量带回完整 `status` | 已完成 |
| 2026-06-23 | 阶段 2 环保 status HTTP | 当前 status 为只读兼容响应：会在内存中计算时间推进展示值，但不写回 `eco_states`、不生成在线奖品、不执行偷盗追查；`go test ./...`、串行 PostgreSQL integration、Docker build/restart、`/readyz` 均通过；Gateway 仍未打开 `/api/games/eco*` | 已完成 |
| 2026-06-23 | 阶段 2 环保升级购买 HTTP | Go 内部接入 `POST /api/games/eco/buy` 的 `type:"upgrade"` 分支，事务内串行用户环保状态、推进自动回收、扣积分、写积分流水、更新升级等级并返回最新 status | 已完成 |
| 2026-06-23 | 阶段 2 环保升级购买 HTTP | 覆盖未登录 401、参数错误 400、无数据库 503、真实 PostgreSQL 扣 50 积分升级 `spawn` 到 1 级并返回 status；`go test ./...`、串行 PostgreSQL integration、Docker build/restart、`/readyz` 均通过；Gateway 仍未打开 `/api/games/eco*` | 已完成 |
| 2026-06-23 | 阶段 2 环保道具购买 HTTP | Go 内部接入 `POST /api/games/eco/buy` 的 `type:"item"` 分支，支持清运车、幸运手电和回收手套；事务内串行用户环保状态、推进自动回收、扣积分、写积分流水、更新每日购买次数、应用道具效果并返回最新 status | 已完成 |
| 2026-06-23 | 阶段 2 环保道具购买 HTTP | 覆盖未登录 401、参数错误 400、无数据库 503、真实 PostgreSQL 购买清运车扣 35 积分、待回收垃圾补到容量上限、每日购买次数入库和 status 更新；`go test ./...`、串行 PostgreSQL integration、Docker build/restart、`/readyz` 均通过；Gateway 仍未打开 `/api/games/eco*` | 已完成 |
| 2026-06-23 | 阶段 2 环保奖品领取 HTTP | Go 内部接入 `POST /api/games/eco/claim-prize`，支持从可见奖品领取到库存和奖品批次，可选 `makePublic:true` 写入公开奖品面板，并记录每日奖品领取统计 | 已完成 |
| 2026-06-23 | 阶段 2 环保奖品领取 HTTP | 覆盖未登录 401、参数错误 400、无数据库 503、真实 PostgreSQL 公示领取钻石：可见奖品删除、库存/批次/公示表/领取统计写入、status 更新；`go test ./...`、串行 PostgreSQL integration、Docker build/restart、`/readyz` 均通过；Gateway 仍未打开 `/api/games/eco*` | 已完成 |
| 2026-06-23 | 阶段 2 环保奖品出售 HTTP | Go 内部接入 `POST /api/games/eco/sell`，支持背包库存校验、次日 6 点可售限制、按日动态价格、积分入账、库存/批次扣减、公示条目清理和受限奖品全服库存回退 | 已完成 |
| 2026-06-23 | 阶段 2 环保奖品出售 HTTP | 覆盖未登录 401、参数错误 400、数量无效 400、无数据库 503、真实 PostgreSQL 出售已公示钻石：积分到账、库存清零、批次删除、公示删除、全服库存回退、status 更新；`go test ./...`、串行 PostgreSQL integration、Docker build/restart、`/readyz` 均通过；Gateway 仍未打开 `/api/games/eco*` | 已完成 |
| 2026-06-23 | 阶段 2 环保商人收购 HTTP | Go 内部接入 `POST /api/games/eco/merchant-sell`，支持公开批次筛选、商人次日 6 点可收购限制、按日动态价 1.2 倍入账、库存/批次扣减、公示条目清理和受限奖品全服库存回退 | 已完成 |
| 2026-06-23 | 阶段 2 环保商人收购 HTTP | 覆盖未登录 401、参数错误 400、无数据库 503、真实 PostgreSQL 商人收购已公示钻石：积分到账、库存清零、批次删除、公示删除、全服库存回退、status 更新；`go test ./...`、串行 PostgreSQL integration、Docker build/restart、`/readyz` 均通过；Gateway 仍未打开 `/api/games/eco*` | 已完成 |
| 2026-06-23 | 阶段 2 环保黑市出售 HTTP | Go 内部接入 `POST /api/games/eco/black-market-sell`，支持偷盗批次筛选、24 小时追查后黑市接货限制、按奖品最高价入账、库存/批次扣减、偷盗记录 `escaped` 结算、公示条目清理和受限奖品全服库存回退 | 已完成 |
| 2026-06-23 | 阶段 2 环保黑市出售 HTTP | 覆盖未登录 401、参数错误 400、无数据库 503、真实 PostgreSQL 黑市出售偷来的钻石：积分到账、库存清零、批次删除、公示删除、全服库存回退、偷盗记录标记逃脱、status 更新；`go test ./...`、串行 PostgreSQL integration、Docker build/restart、`/readyz` 均通过；Gateway 仍未打开 `/api/games/eco*` | 已完成 |
| 2026-06-23 | 阶段 2 环保偷盗 HTTP | Go 内部接入 `POST /api/games/eco/steal`，支持留言校验、目标公示行锁、不能偷自己、偷盗者未结算偷盗校验、原主人/偷盗者双用户状态推进、库存转移、偷盗批次创建、公示状态改为 `stolen` 和偷盗记录创建 | 已完成 |
| 2026-06-23 | 阶段 2 环保偷盗 HTTP | 覆盖未登录 401、参数错误 400、无数据库 503、真实 PostgreSQL 公开钻石偷盗：原主人库存和批次扣减、偷盗者库存和偷盗批次增加、公示条目标记偷盗、偷盗记录未结算且黑市时间延后、status 更新；`go test ./...`、串行 PostgreSQL integration、Docker build/restart、`/readyz` 均通过；Gateway 仍未打开 `/api/games/eco*` | 已完成 |
| 2026-06-23 | 阶段 2 环保 status 写回 | `GET /api/games/eco/status` 改为先在 PostgreSQL 事务内锁定用户状态、推进时间、结算自动回收积分、写回 `eco_states` 和积分流水，再读取完整快照组装兼容响应 | 已完成 |
| 2026-06-23 | 阶段 2 环保 status 写回 | 覆盖真实 PostgreSQL 10 分钟自动回收写回：pending 补到容量上限、自动回收积分到账、`last_tick_at_ms` 更新、生命周期统计和积分流水落库；`go test ./...`、串行 PostgreSQL integration、Docker build/restart、`/readyz` 均通过；Gateway 仍未打开 `/api/games/eco*` | 已完成 |
| 2026-06-23 | 阶段 2 环保在线奖品生成 | Go 环保时间推进新增在线奖品生成：清理过期可见奖品并释放受限全服库存，按旧概率生成可见奖品，遵守最多 12 个可见奖品、幸运手电倍率/次数和全服限量库存；`status`、回收、购买、领取、出售等写路径已接入，偷盗双用户推进保持不生成在线奖品 | 已完成 |
| 2026-06-23 | 阶段 2 环保在线奖品生成 | 覆盖纯函数奖品生成占用生成槽、真实 PostgreSQL 过期金币释放库存并强制生成 10 个钻石、幸运手电次数写回、全服库存预约；`go test ./...`、串行 PostgreSQL integration、Docker build/restart、`/readyz` 均通过；Gateway 仍未打开 `/api/games/eco*` | 已完成 |
| 2026-06-23 | 阶段 2 成就基础表 | 新增 `0011_achievements.sql`，建立用户成就授予、当前佩戴和强制佩戴 3 张 PostgreSQL 表，为环保偷盗追查的 `thief` 成就落库做前置准备 | 已完成 |
| 2026-06-23 | 阶段 2 成就基础表 | 新增 Go `internal/achievement` 事务内授予并强制佩戴方法，覆盖 `thief` 自动授予、过期时间延长、当前佩戴和强制佩戴写入；`go test ./...` 与串行 PostgreSQL integration 已通过 | 已完成 |
| 2026-06-23 | 阶段 2 环保偷盗追查 | 新增 Go `ProcessTheftInvestigations` 服务层，按到期 `eco_thefts` 分批追查；支持 24 小时后逃脱清理公示、未抓获重排、抓获后恢复原主人批次、扣偷盗者 10% 当日价罚金、给原主人 50% 赔偿并强制佩戴 `thief` 成就 10 小时 | 已完成 |
| 2026-06-23 | 阶段 2 环保偷盗追查 | Go worker 每 10 分钟处理 25 条到期追查；覆盖逃脱、重排、抓获恢复和成就强制佩戴 3 条 PostgreSQL 集成测试，`go test ./...` 与串行 PostgreSQL integration 已通过；Gateway 仍未打开 `/api/games/eco*` | 已完成 |
| 2026-06-23 | 阶段 2 环保排行榜 | Go 内部接入 `GET /api/rankings/eco`，从 `eco_trash_rankings` 读取日/周/月环保排行榜，按垃圾数降序和用户 ID 升序排序，返回旧前端兼容的 `period`、`periodKey`、`generatedAt`、`totalParticipants`、`leaderboard` 和佩戴成就字段 | 已完成 |
| 2026-06-23 | 阶段 2 环保排行榜 | Gateway 已精确切流 `/api/rankings/eco` 到 Go，不打开 `/api/games/eco*`；覆盖未登录、无数据库、服务层真实 PostgreSQL 和 HTTP+PostgreSQL 集成测试，`go test ./...`、串行 PostgreSQL integration、Docker build/restart、`/readyz` 和未登录冒烟均通过 | 已完成 |
| 2026-06-23 | 阶段 2 环保排行榜 | 本地容器主库已补应用 `0011_achievements.sql`；带测试登录 cookie 通过网关请求 `/api/rankings/eco` 返回 200，排行榜页能渲染并请求环保榜成功；页面顶部仍会显示其它旧排行榜 KV 503，不属于环保榜回归 | 已完成 |
| 2026-06-23 | 阶段 2 环保精确切流 | Gateway 已精确切流 `/api/games/eco/status`、`collect`、`buy`、`claim-prize`、`sell`、`merchant-sell`、`black-market-sell`、`steal` 8 个前端已使用路径到 Go；完整 `/api/games/eco*` 通配仍保持注释，未知子路径仍回落 Next | 已完成 |
| 2026-06-23 | 阶段 2 环保页面冒烟 | 直连 Go API 与经 Gateway 的 `status`、`collect` 均返回 200；浏览器打开 `/games/eco` 成功加载环保页面，`/api/games/eco/status` 请求为 200，页面内 collect 后积分进度从 `2/10` 到 `3/10`、待回收从 `80 / 80` 到 `79 / 80` | 已完成 |
| 2026-06-23 | 阶段 2 环保深度冒烟 | 使用本地 Docker 高位测试用户验证经 Gateway 的高风险写路径：可见奖品领取并公示返回 200，商人收购返回 200 且金币收购入账 `10800`，偷盗返回 200，黑市出售返回 200 且奖杯入账 `5000`；`/readyz` 与容器状态正常 | 已完成 |
| 2026-06-23 | 阶段 2 环保追查 worker 冒烟 | 本地 Docker 构造到期偷盗记录 `worker-smoke-theft-1782186434711`，等待 worker 10 分钟定时任务真实处理；worker 日志显示 `checked=1 escaped=1`，数据库确认偷盗记录 `outcome=escaped`、公示行删除、偷盗者库存和偷盗批次保留 | 已完成 |
| 2026-06-23 | 阶段 2 环保页面公示/偷盗冒烟 | 浏览器使用本地测试用户打开 `/games/eco`，经页面上下文领取并公开项链后，公开栏从空状态变为显示 `项链 / eco_page_owner 持有 / 自己的奖品`；切换偷盗用户后公开栏显示偷盗入口，执行偷盗返回 200，页面刷新后显示 `已被偷走，警察追查中`、留言 `page smoke` 和 `追查中` | 已完成 |
| 2026-06-23 | 阶段 2 环保收尾 review | 核对前端环保页调用的 8 个 `/api/games/eco/*` 路径、Go `ecoRouter` 注册和 Gateway 精确切流规则完全一致；`# handle /api/games/eco*` 仍保持注释；`go test ./internal/eco ./internal/httpserver` 与 `/readyz` 通过 | 已完成 |
| 2026-06-23 | 阶段 3 记忆游戏基础运行表 | 新增 `0012_game_runtime.sql`，补齐普通游戏迁移所需的 `game_cooldowns` 和 `game_daily_stats`，复用既有 `game_sessions`、`active_game_sessions`、`game_records` 与积分表 | 已完成 |
| 2026-06-23 | 阶段 3 记忆游戏闭环迁移 | Go 内部接入 `/api/games/memory/status`、`start`、`flip`、`submit`、`cancel`；服务端保留完整布局，响应只返回已翻开/已匹配卡片；结算使用服务端 moveLog 复算，事务内写积分、每日统计、游戏记录、冷却并清理活跃会话 | 已完成 |
| 2026-06-23 | 阶段 3 记忆游戏测试 | 覆盖 TypeScript 同算法洗牌 golden fixture、分数计算、隐藏布局、未登录/无数据库/参数错误 HTTP、真实 PostgreSQL 完整开局翻牌结算，以及结算后 20 并发重复 submit 不重复发积分；`go test ./...` 与串行 PostgreSQL integration 通过 | 已完成 |
| 2026-06-23 | 阶段 3 记忆游戏 Gateway 切流 | Gateway 精确切流 `/api/games/memory/status`、`start`、`flip`、`submit`、`cancel` 到 Go，不打开 `/api/games/memory*` 或 `/api/games/*` 通配；本地 Docker 已应用 `0012`、重建 API/Gateway，`/readyz` 通过，经 Gateway 的 status/start/cancel 冒烟 200，start 返回 16 张隐藏卡 | 已完成 |
| 2026-06-23 | 阶段 3 消消乐引擎迁移 | Go 新增 `internal/match3`，复刻 `seedrandom@3.0.5` 默认 ARC4 随机数、初始棋盘生成、相邻交换校验、消除/下落/补块、连锁计分和积分折算；golden fixture 与 TypeScript 固定 seed 的随机数、棋盘和单步模拟结果一致 | 已完成 |
| 2026-06-23 | 阶段 3 消消乐闭环迁移 | Go 内部接入 `/api/games/match3/status`、`start`、`submit`、`cancel`；start 返回旧前端需要的 `sessionId`、`seed`、`config`、`timeLimitMs` 和时间戳，submit 使用服务端同算法复算 moves，事务内写积分、每日统计、游戏记录、冷却并清理活跃会话 | 已完成 |
| 2026-06-23 | 阶段 3 消消乐测试 | 覆盖 `seedrandom` 兼容、初始棋盘、单步模拟、积分折算、未登录/无数据库/参数错误 HTTP、真实 PostgreSQL 完整开局与合法一步结算，以及结算后 20 并发重复 submit 不重复发积分；`go test ./...` 与串行 PostgreSQL integration 通过 | 已完成 |
| 2026-06-23 | 阶段 3 消消乐 Gateway 切流 | Gateway 精确切流 `/api/games/match3/status`、`start`、`submit`、`cancel` 到 Go，不打开 `/api/games/match3*` 或 `/api/games/*` 通配；API/Gateway 已重建重启，`/readyz` 通过，经 Gateway 的 status/start/cancel 冒烟 200，start 返回 8x8 配置和 32 位 seed | 已完成 |
| 2026-06-23 | 阶段 3 打地鼠引擎迁移 | Go 新增 `internal/whackmole`，复刻 `seedrandom@3.0.5`、动态刷新 tick、棋盘生成、炸弹数量、连击计分、重复命中判定和难度积分折算；golden fixture 与 TypeScript 固定 seed 的随机数、棋盘和单次命中结果一致 | 已完成 |
| 2026-06-23 | 阶段 3 打地鼠闭环迁移 | Go 内部接入 `/api/games/whack-mole/status`、`sync`、`start`、`submit`、`cancel`；`sync` 审计为只读会话视图，submit 使用事件列表在服务端复算分数，事务内写积分、每日统计、游戏记录、冷却并清理活跃会话 | 已完成 |
| 2026-06-23 | 阶段 3 打地鼠测试 | 覆盖 `seedrandom` 兼容、棋盘生成、单次命中计分、难度积分折算、未登录/无数据库/参数错误 HTTP、真实 PostgreSQL 完整开局、sync、合法事件结算，以及结算后 20 并发重复 submit 不重复发积分；`go test ./...` 与串行 PostgreSQL integration 通过 | 已完成 |
| 2026-06-23 | 阶段 3 打地鼠 Gateway 切流 | Gateway 精确切流 `/api/games/whack-mole/status`、`sync`、`start`、`submit`、`cancel` 到 Go，不打开 `/api/games/whack-mole*` 或 `/api/games/*` 通配；API/Gateway 已重建重启，`/readyz` 通过，经 Gateway 的 status/start/sync/cancel 冒烟 200，start 返回 16 个洞位 | 已完成 |
| 2026-06-23 | 阶段 3 扫雷引擎迁移 | Go 新增 `internal/minesweeper`，复刻 `seedrandom@3.0.5`、首次翻开后布雷、首点九宫格安全、翻开/插旗/快速展开、批量操作跳过规则、状态视图和分数/积分折算；golden fixture 与 TypeScript 固定 seed 的布雷结果一致 | 已完成 |
| 2026-06-23 | 阶段 3 扫雷闭环迁移 | Go 内部接入 `/api/games/minesweeper/status`、`start`、`step`、`submit`、`cancel`；`step` 由 Go 在 PostgreSQL 事务内接管权威会话推进并更新 `game_sessions.payload`，submit 只允许已结束局结算并支持已结算记录回放 | 已完成 |
| 2026-06-23 | 阶段 3 扫雷测试 | 覆盖 `seedrandom` 兼容、布雷 golden fixture、首次翻开安全区、批量操作跳过、计分奖励、未登录/无数据库/参数错误 HTTP、真实 PostgreSQL 开局、step 踩雷、结算，以及结算后 20 并发重复 submit 不重复发积分；`go test ./...` 与串行 PostgreSQL integration 通过 | 已完成 |
| 2026-06-23 | 阶段 3 扫雷 Gateway 切流 | Gateway 精确切流 `/api/games/minesweeper/status`、`start`、`step`、`submit`、`cancel` 到 Go，不打开 `/api/games/minesweeper*` 或 `/api/games/*` 通配；API/Gateway 已重建重启，Caddy validate 和 `/readyz` 通过，经 Gateway 的 status/start/step/cancel 冒烟 200，首翻返回 `revealedSafe=23` | 已完成 |
| 2026-06-23 | 阶段 3 连连看引擎迁移 | Go 新增 `internal/linkgame`，复刻 `seedrandom@3.0.5`、2D 连线路径、困难 3D 堆叠遮挡、困难计划死局、moves 重放验证、结算时长校验、分数和积分折算；easy 固定 seed 布局 golden fixture 与 TypeScript 一致 | 已完成 |
| 2026-06-23 | 阶段 3 连连看闭环迁移 | Go 内部接入 `/api/games/linkgame/status`、`start`、`submit`、`cancel`；submit 使用服务端保存的 `tileLayout` 重放 moves，不信任客户端分数，事务内写积分、每日统计、游戏记录、冷却并清理活跃会话，重复 submit 回放已结算记录 | 已完成 |
| 2026-06-23 | 阶段 3 连连看测试 | 覆盖随机数兼容、easy 布局 golden、3D 堆叠可匹配/遮挡不可匹配、困难死局结算、无效道具、时长校验、分数奖励、未登录/无数据库/参数错误 HTTP、真实 PostgreSQL 完整开局结算，以及结算后 20 并发重复 submit 不重复发积分；`go test ./...` 与串行 PostgreSQL integration 通过 | 已完成 |
| 2026-06-23 | 阶段 3 连连看 Gateway 切流 | Gateway 精确切流 `/api/games/linkgame/status`、`start`、`submit`、`cancel` 到 Go，不打开 `/api/games/linkgame*` 或 `/api/games/*` 通配；API/Gateway 已重建重启，Caddy validate 和 `/readyz` 通过，经 Gateway 的 status/start/cancel 冒烟 200，start 返回 64 个格子和 180 秒剩余时间 | 已完成 |
| 2026-06-23 | 阶段 3 Roguelite 引擎迁移 | Go 新增 `internal/roguelite`，复刻 `seedrandom@3.0.5`、程序化世界坐标地图、视野构建、移动/战斗/事件/商店/宝箱/撤离状态推进、楼层推进、分数和积分折算；`go test ./internal/roguelite` 与 `go test ./...` 通过；暂未接 HTTP/Gateway | 已完成 |
| 2026-06-23 | 阶段 3 Roguelite 服务层迁移 | Go 服务层接入 PostgreSQL `game_sessions.payload` 权威状态，`step` 在事务内锁定活跃会话并推进状态，保留 `actionCount`、`moveCount` 与最近 120 条动作压缩，`submit` 只允许 `escaped/defeated` 并回放已结算记录；`go test ./internal/roguelite`、`go test ./...` 与 PostgreSQL integration 通过 | 已完成 |
| 2026-06-23 | 阶段 3 Roguelite HTTP 接入 | Go 内部注册 `/api/games/roguelite/status`、`start`、`step`、`submit`、`cancel`；`step` 使用手动 JSON action 校验并保留错误响应中的 session 同步能力；覆盖未登录、无数据库、参数错误、真实 HTTP 开局、step、结算和 20 并发重复 submit；暂未改 Gateway | 已完成 |
| 2026-06-23 | 阶段 3 Roguelite Gateway 切流 | Gateway 精确切流 `/api/games/roguelite/status`、`start`、`step`、`submit`、`cancel` 到 Go，不打开 `/api/games/roguelite*` 或 `/api/games/*` 通配；API/Gateway 已重建重启，Caddy validate、`/readyz` 通过，经 Gateway 的 status/start/step/cancel 冒烟 200，step 返回 `当前位置已确认` 且 `actionsCount=1` | 已完成 |
| 2026-06-23 | 阶段 3 普通游戏总 review | 核对记忆游戏、消消乐、打地鼠、扫雷、连连看和 Roguelite 的前端实际调用、Go `server.go` 注册和 Gateway 精确规则一致；各游戏仍保留 `notMigratedHandler` 兜底，`/api/games/*` 及各游戏通配仍未打开；`go test ./...` 通过 | 已完成 |
| 2026-06-23 | 阶段 4 个人资料读取基础 | 新增 `0013_user_profiles.sql`、Go `internal/profile` 和 `GET /api/profile/settings` 内部路由，返回旧前端兼容的 `displayName`、`avatarUrl`、`qqEmail`、`equippedAchievement`、`updatedAt`；覆盖未登录、无数据库、限流、PostgreSQL 资料读取、强制成就优先级和 HTTP integration；暂不切 Gateway，需先导入旧 `user:profile:custom:*` | 已完成 |
| 2026-06-23 | 阶段 4 个人资料导入 | `migrate-d1 -apply -scope user-profiles` 已开放，导入旧 D1/KV `user:profile:custom:{userId}` 到 PostgreSQL `user_profiles`，字段校验贴近旧 `user-profile.ts`：昵称 trim 与 UTF-16 长度、头像 data/http(s)、QQ 邮箱规范化和 `updatedAt` 时间戳 | 已完成 |
| 2026-06-23 | 阶段 4 个人资料导入 review | 导入器只处理 `kv_data:user:profile:custom:*`，不会吞掉 `user:profile:session:*`；`AnalyzeSQL` 映射已放在泛化 `user:* -> users` 前；无效字段逐项 warning，整条空资料跳过，清空资料但带 `updatedAt` 时保留空 profile 行；`go test ./internal/migration/d1`、PostgreSQL integration、`go test ./...` 和 CLI dry-run 均通过；Gateway 仍未切 `/api/profile/settings` | 已完成 |
| 2026-06-23 | 阶段 4 个人资料写接口 | Go 内部接入 `PUT /api/profile/settings`，复刻旧 Next patch 语义：仅更新传入字段，`null`/空串清空，省略字段保留；校验昵称、头像和 QQ 邮箱，事务内锁定并 upsert `user_profiles`，缺失用户时补占位 `users` 行 | 已完成 |
| 2026-06-23 | 阶段 4 个人资料写接口 review | PUT 已接同源校验、登录校验和 `profile:overview` 限流；修正 pgx 空行判断，避免无资料/无成就用户被误判 500；覆盖校验单测、HTTP 参数/跨站/无数据库、PostgreSQL GET/PUT 集成和 `go test ./...`；Gateway 仍未切 `/api/profile/settings`，需真实导入和页面冒烟后再切 | 已完成 |
| 2026-06-23 | 阶段 4 成就佩戴接口 | Go 内部接入 `PUT /api/profile/achievements/equip`，支持佩戴 PostgreSQL 已授予且未过期的成就、`achievementId:null`/缺省取消佩戴、强制佩戴期间拒绝更换，并返回旧前端兼容的 `equippedId` 与 `equipped` | 已完成 |
| 2026-06-23 | 阶段 4 成就佩戴接口 review | 已接同源校验、登录校验和 `profile:overview` 限流；未知/非字符串成就返回“未知成就”，未解锁返回“只能佩戴已解锁的成就”，强制佩戴返回“当前有强制佩戴成就，暂时无法更换”；覆盖 service/HTTP 单测、PostgreSQL integration 和 `go test ./...`；Gateway 仍未切 `/api/profile/achievements/equip`，需先完成 `profile/overview` 与旧成就导入/冒烟 | 已完成 |
| 2026-06-23 | 阶段 4 旧成就导入 | `migrate-d1 -apply -scope user-achievements` 已开放，导入旧 D1/KV `user:achievements:{userId}`、`user:achievement:equipped:{userId}`、`user:achievement:forced:{userId}` 到 PostgreSQL 成就授予、当前佩戴和强制佩戴表 | 已完成 |
| 2026-06-23 | 阶段 4 旧成就导入 review | 导入器支持旧 grants 的数组/对象两种形态，保留 `source`、`grantedAt`、`expiresAt`、`reason`、`grantedBy` 和对象型 `metadata`；未知成就、无效用户和无效强制佩戴会 warning 跳过；`AnalyzeSQL` 映射已放在泛化 `user:*` 前；`go test ./internal/migration/d1`、PostgreSQL integration、`go test ./...` 和 CLI dry-run 均通过 | 已完成 |
| 2026-06-23 | 阶段 4 个人主页 overview 基础闭环 | Go 内部接入 `GET /api/profile/overview`，返回旧前端兼容的 `user`、`points`、`cards`、`gameplay`、`notifications`、`achievementStats`、`achievements` 结构；从 PostgreSQL 已迁移表聚合自定义资料、积分、抽卡次数、游戏记录、通知和环保统计，卡牌图鉴/农场/彩票等未迁移模块保持安全空值 | 已完成 |
| 2026-06-23 | 阶段 4 个人主页 overview review | `profile/overview` 自动授予只基于 PostgreSQL 可证明数据写入成就授予表，且当前条件已满足时会刷新旧导入中的同 ID 过期自动成就；`achievements.items` 始终包含全部定义；覆盖未登录、无数据库、service PostgreSQL 聚合与 HTTP PostgreSQL 集成测试；`go test ./internal/profile ./internal/httpserver`、`go test -tags integration ... -run Overview` 和 `go test ./...` 均通过；Gateway 仍未切 `/api/profile/overview` 或 `/api/profile*` 通配 | 已完成 |
| 2026-06-23 | 阶段 4 个人资料本地接口冒烟 | 在本地 Docker PostgreSQL 写入高位测试用户，使用临时 Node 容器生成合法 `app_session` Cookie 并直连 `api:8080`，验证 `GET /api/profile/overview`、`PUT /api/profile/settings`、`GET /api/profile/settings`、`PUT /api/profile/achievements/equip`、再次 `GET /api/profile/overview` 全链路通过 | 已完成 |
| 2026-06-23 | 阶段 4 个人资料本地接口冒烟 review | 冒烟确认 overview 返回 12000 积分、未读通知、`beginner/tycoon/lottery_player/eco_ambassador/xiaoc_fan` 解锁，settings 可更新昵称并清空 QQ 邮箱，成就可佩戴且 overview 回读 `equippedId=beginner`；该冒烟直连 Go API，不经过 Gateway，`/api/profile*` 仍未切流 | 已完成 |
| 2026-06-23 | 阶段 4 个人资料页面冒烟 | 启动临时 Go API 容器映射 `127.0.0.1:18080`，浏览器注入同格式 `app_session`，只把 `/api/profile/overview`、`/api/profile/settings`、`/api/profile/achievements/equip` 三个精确路径拦截转发到 Go，打开 `/profile` 页面验证渲染兼容 | 已完成 |
| 2026-06-23 | 阶段 4 个人资料页面冒烟 review | 页面冒烟确认 3 个 profile 请求均返回 200，页面显示 `冒烟已更新`、`12,000` 积分和成就墙；点击已解锁“大富翁”触发页面层面的 `PUT /api/profile/achievements/equip` 并回显佩戴，PostgreSQL 回读 `user_equipped_achievements=tycoon`；临时 API 容器已停止，Gateway 仍未切 `/api/profile*` | 已完成 |
| 2026-06-23 | 阶段 4 profile 精确切流前置审计 | 新增 `npm run audit:profile-cutover`，自动核对前端 profile API 依赖只包含 `/api/profile/overview`、`/api/profile/settings`、`/api/profile/achievements/equip`，Go `server.go` 已注册对应 GET/PUT 路由，Gateway 当前没有活跃 `/api/profile` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 profile 精确切流前置审计 review | 审计脚本输出确认 `settings` 被 `/profile` 页面和 `SiteSidebar` 使用，`overview` 与 `achievements/equip` 只被 `/profile` 页面使用；`go test ./internal/profile ./internal/httpserver`、`/readyz` 通过，临时冒烟容器无残留；Gateway 仍未切 `/api/profile*` | 已完成 |
| 2026-06-23 | 阶段 4 profile 字段兼容与回滚审计 | 扩展 `npm run audit:profile-cutover`，增加 Go `types.go` JSON 字段校验；新增 `docs/profile-cutover-preflight.md`，记录字段覆盖、安全空值、三个精确 Gateway 规则草案、切流前置条件和回滚步骤 | 已完成 |
| 2026-06-23 | 阶段 4 profile 字段兼容与回滚审计 review | 审计脚本确认 Go 输出包含旧页面所需 `settings`、`equip`、`overview` 关键 JSON 字段；文档明确卡牌图鉴、签到、农场土地、彩票累计仍为安全空值或未完整迁移；`npm run audit:profile-cutover`、`go test ./internal/profile ./internal/httpserver` 和 `/readyz` 均通过；Gateway 仍未切 `/api/profile*` | 已完成 |
| 2026-06-23 | 阶段 4 profile 直连 API 冒烟门禁 | 新增 `scripts/smoke-profile-go-api.mjs`，默认通过 `docker compose exec -T api` 直连 Go API 容器，验证 `/readyz`、profile 三个前端路径未登录边界和 Gateway 未切 profile；支持后续传入 `PROFILE_GO_API_COOKIE` 做登录态只读冒烟 | 已完成 |
| 2026-06-23 | 阶段 4 profile 直连 API 冒烟门禁 review | `node scripts/smoke-profile-go-api.mjs` 通过，覆盖 4 个未登录路径检查；`npm run audit:profile-cutover` 已纳入该脚本存在性和关键片段校验；Gateway 仍无 `/api/profile` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 通知未读数内部路由 | Go 新增 `internal/notifications` 服务层和 `GET /api/notifications/unread-count` 内部路由，复用旧 `notifications:list` 60 秒 60 次限流，返回旧前端兼容的 `{ success, data: { unreadCount } }` | 已完成 |
| 2026-06-23 | 阶段 4 通知未读数 review | 覆盖未登录、无数据库、限流、PostgreSQL 仅统计当前用户未读通知和 HTTP integration；`go test ./internal/notifications ./internal/httpserver`、通知 integration、`go test ./...`、Docker API build/restart、容器内 migration、`/readyz` 与直连 API 冒烟均通过；Gateway 仍未切 `/api/notifications*` 或 `/api/notifications/unread-count` | 已完成 |
| 2026-06-23 | 阶段 4 通知列表内部路由 | Go 内部接入 `GET /api/notifications`，支持 `page`、`limit`、`type`、`filter` 参数，返回旧前端兼容的 `items`、`unreadCount`、`pagination`、`counts`；分类规则复刻 prize/reply/system/redeem，PostgreSQL 查询不再受旧 KV 最近 1000 条索引限制 | 已完成 |
| 2026-06-23 | 阶段 4 通知列表 review | 覆盖列表未登录、无数据库、分页、未读筛选、类型筛选、分类计数和 HTTP integration；`go test ./internal/notifications ./internal/httpserver`、通知 integration、`go test ./...`、Docker API build/restart、容器内 migration、`/readyz` 与列表直连冒烟均通过；Gateway 仍未切 `/api/notifications*` | 已完成 |
| 2026-06-23 | 阶段 4 通知数据导入 | `migrate-d1 -apply -scope notifications` 已开放，以旧 KV `notifications:item:{id}` 为主源导入 PostgreSQL `notifications`，缺失用户会创建占位用户；dry-run 映射同时识别用户通知索引、未读集合和公告去重集合 | 已完成 |
| 2026-06-23 | 阶段 4 通知数据导入 review | 导入器校验用户 ID、通知类型、标题/内容、`createdAt/readAt` 和 `data` 对象，坏数据 warning 跳过或降级为空对象；重复导入按通知 ID upsert；`go test ./internal/migration/d1`、notifications importer integration、`go test ./...`、`migrate-d1 -scope notifications` dry-run 和 Docker API build 均通过；仍未使用真实 D1 导出验证 | 已完成 |
| 2026-06-23 | 阶段 4 通知已读接口 | Go 内部接入 `POST /api/notifications/read`，支持指定 `ids` 和 `markAll=true`，仅更新当前用户通知，返回旧前端兼容的 `message`、`updated` 和 `unreadCount`；接入同源校验与 `notifications:read` 60 秒 60 次限流 | 已完成 |
| 2026-06-23 | 阶段 4 通知已读接口 review | 覆盖空请求 400、无数据库 503、指定 ID 标记、全部已读、其他用户不受影响和 HTTP integration；`go test ./internal/notifications ./internal/httpserver`、通知 integration、`go test ./...`、Docker API build/restart、`/readyz` 与直连 POST 冒烟均通过；Gateway 仍未切 `/api/notifications*` | 已完成 |
| 2026-06-23 | 阶段 4 通知删除接口 | Go 内部接入 `POST /api/notifications/delete`，仅允许删除当前用户已读通知，返回旧前端兼容的 `message`、`deleted` 和 `unreadCount`；接入同源校验与 `notifications:delete` 60 秒 30 次限流 | 已完成 |
| 2026-06-23 | 阶段 4 通知删除接口 review | 覆盖空请求 400、无数据库 503、未读不可删、已读可删、跨用户不误删和 HTTP integration；`go test ./internal/notifications ./internal/httpserver`、通知 integration、`go test ./...`、Docker API build/restart、`/readyz` 与直连删除冒烟均通过；Gateway 仍未切 `/api/notifications*` | 已完成 |
| 2026-06-23 | 阶段 4 通知领取审计 | 已审计旧 `POST /api/notifications/claim`：接口不仅更新通知状态，还按 `notification.data.rewardBatchId/rewardType/rewardAmount/claimStatus` 读取奖励领取记录，发放积分或 new-api 额度，更新通知已读、领取状态和批次统计 | 已完成 |
| 2026-06-23 | 阶段 4 通知领取审计 review | Go 侧已有通知表、积分账本、钱包额度 client 和 Redis 锁，但缺少奖励批次与领取记录结构化表；迁移 `claim` 前需先新增 `reward_batches`、`reward_claims`、D1/KV 导入器和并发领取测试，不能直接只接 HTTP；Gateway 仍未切 `/api/notifications*` | 已完成 |
| 2026-06-23 | 阶段 4 奖励领取数据基础 | 新增 `0014_reward_claims.sql`，建立 `reward_batches` 与 `reward_claims`；`migrate-d1 -apply -scope reward-claims` 已开放，可导入旧 `rewards:batch:*`、`rewards:claim:*`，并能从 reward 通知 data 中补建缺失的 pending claim | 已完成 |
| 2026-06-23 | 阶段 4 奖励领取数据基础 review | dry-run 已映射 `rewards:batch:* -> reward_batches`、`rewards:claim:* -> reward_claims`、批次列表和通知去重集合；运行时领取锁仍保持未映射；覆盖单元测试、PostgreSQL integration、CLI dry-run、`go run ./cmd/migrate -dry-run` 和 `go test ./...` | 已完成 |
| 2026-06-23 | 阶段 4 奖励领取服务层 | 新增 Go `internal/rewards` 服务层，支持奖励通知归属/类型校验、从通知 data 恢复缺失 claim、积分奖励事务内入账、更新 claim/通知已读/批次统计，quota 奖励预留 new-api client 路径 | 已完成 |
| 2026-06-23 | 阶段 4 奖励领取服务层 review | 并发测试曾暴露“领取事务 + 积分服务独立事务”会形成用户行锁等待，已调整为领取事务内锁积分账户并写入流水；PostgreSQL integration 覆盖重复领取不重复加分、缺失 claim 恢复、8 并发只入账一次；`go test ./...` 和相关 integration 通过 | 已完成 |
| 2026-06-23 | 阶段 4 通知领取 HTTP | Go 内部接入 `POST /api/notifications/claim`，复刻旧响应 `{ success, message, data: { claimStatus } }`，接入同源校验、登录校验和 `rewards:claim` 60 秒 20 次限流；积分奖励可完整领取，quota 奖励在 new-api 未配置时返回 503 | 已完成 |
| 2026-06-23 | 阶段 4 通知领取 HTTP review | 覆盖空通知 ID、无数据库、HTTP PostgreSQL 积分领取、重复领取幂等；`go test ./internal/httpserver`、通知 HTTP integration、`go test ./...`、奖励/通知/导入相关 integration、Docker API build/restart、容器内 migration、`/readyz` 与直连 claim 冒烟均通过；Gateway 仍未切 `/api/notifications*` | 已完成 |
| 2026-06-23 | 阶段 4 通知前端依赖审计 | 已审计前端通知调用：侧边栏只用 `/api/notifications/unread-count`，通知页使用列表、已读、领取、删除，首页公告栏使用 `GET /api/notifications?type=announcement` 与 `POST /api/notifications/read` | 已完成 |
| 2026-06-23 | 阶段 4 通知前端依赖审计 review | 前端实际通知路径共 5 个：`GET /api/notifications`、`GET /api/notifications/unread-count`、`POST /api/notifications/read`、`POST /api/notifications/claim`、`POST /api/notifications/delete`，Go 均已覆盖；Caddyfile 当前没有活跃 `/api/notifications*` 规则，仍未切流 | 已完成 |
| 2026-06-23 | 阶段 4 通知页面级冒烟 | 启动临时 Go API 容器映射 `127.0.0.1:18080`，浏览器打开 Gateway `/notifications`，仅将 5 个通知 API 精确拦截到 Go，插入高位测试奖励通知并点击领取 | 已完成 |
| 2026-06-23 | 阶段 4 通知页面级冒烟 review | 页面显示测试奖励、点击领取后未读数归零、卡片和弹窗均显示“已领取 23 积分”；PostgreSQL 回读余额 `11 -> 34`、claim/通知为 `claimed`、`claimed_count=1`、奖励流水 1 条；临时数据和临时 API 容器已清理，Gateway 仍未切 `/api/notifications*` | 已完成 |
| 2026-06-23 | 阶段 4 通知切流前置审计 | 新增 `npm run audit:notifications-cutover` 和 `docs/notifications-cutover-preflight.md`，自动核对通知前端 5 个实际 API、Go 路由、Go JSON 字段、D1 导入 scope、PostgreSQL migration 文件和 Gateway 未提前切流状态 | 已完成 |
| 2026-06-23 | 阶段 4 通知切流前置审计 review | 审计脚本确认通知路径只包含列表、未读数、已读、领取、删除；`notifications` 与 `reward-claims` 导入 scope、`0007_notifications.sql`、`0014_reward_claims.sql` 均存在；Gateway 当前没有活跃 `/api/notifications` 规则；`go test ./internal/notifications ./internal/rewards ./internal/httpserver` 与 `docker compose config --quiet` 通过 | 已完成 |
| 2026-06-23 | 阶段 4 钱包切流前置审计 | 新增 `npm run audit:wallet-cutover` 和 `docs/wallet-cutover-preflight.md`，自动核对 `/store` 钱包前端调用、Go 钱包路由、响应字段、new-api 环境变量、`0004_wallet.sql` 和 Gateway 未提前切流状态 | 已完成 |
| 2026-06-23 | 阶段 4 钱包切流前置审计 review | 审计脚本确认前端钱包只调用 `/api/store/topup` 与 `/api/store/withdraw`，Go 已注册 `GET/POST topup` 与 `POST withdraw`，Gateway 当前没有活跃 `/api/store/topup`、`/api/store/withdraw` 或 `/api/store*` 规则；仍需 Zeabur new-api 配置和真实认证冒烟后再评估精确切流 | 已完成 |
| 2026-06-23 | 阶段 4 游戏中心汇总迁移 | 新增 Go `internal/gamesummary` 和内部路由 `GET /api/games/overview`、`GET /api/games/profile`，从 PostgreSQL `point_accounts`、`game_daily_stats`、`game_records` 聚合余额、今日战绩、最高分、常玩游戏、胜率、最多胜利和连胜 | 已完成 |
| 2026-06-23 | 阶段 4 游戏中心汇总迁移 review | Go 聚合按每个游戏最近 50 条记录对齐旧 `RECORD_FETCH_LIMIT`，保留前端 `perGame` key：`roguelite`、`minesweeper`、`whack-mole`、`memory`、`match3`、`linkgame`；`go test ./...`、PostgreSQL integration、Docker API build/restart、`/readyz` 和认证直连 profile/overview 冒烟通过；Gateway 仍未切 `/api/games/profile` 或 `/api/games/overview` | 已完成 |
| 2026-06-23 | 阶段 4 游戏中心切流前置审计 | 新增 `npm run audit:games-summary-cutover` 和 `docs/games-summary-cutover-preflight.md`，自动核对前端游戏中心实际只调用 `/api/games/profile`、Go 汇总路由和 JSON 字段齐全、Gateway 没有活跃 `/api/games/profile`、`/api/games/overview` 或 `/api/games/*` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 游戏中心 Gateway 切流 | Gateway 精确打开 `/api/games/profile` 到 Go；`/api/games/overview` 因当前无前端直接调用暂不切，完整 `/api/games/*` 通配继续关闭 | 已完成 |
| 2026-06-23 | 阶段 4 游戏中心 Gateway 切流 review | `npm run audit:games-summary-cutover` 已调整为允许唯一精确规则 `/api/games/profile`，仍禁止 `/api/games/overview` 和 `/api/games/*`；Gateway build/restart、Caddy validate、`/readyz`、经 Gateway 认证 API 冒烟和 `/games` 页面冒烟通过；页面仍可见既有 `/api/profile/settings` 503 与 `/api/farm/status` 500 | 已完成 |
| 2026-06-23 | 阶段 4 农场 status 前置审计 | 新增 `npm run audit:farm-status-cutover` 和 `docs/farm-status-cutover-preflight.md`，自动核对农场前端实际 API、旧 status 完整响应字段、旧 KV/D1 状态依赖、D1 导入器缺少 `farmv2:*` 映射、Go 未注册 farm 路由和 Gateway 未提前切流状态 | 已完成 |
| 2026-06-23 | 阶段 4 农场 status 前置审计 review | 审计确认 `/api/farm/status` 同时被桌宠和完整农场页依赖，且旧实现包含 tick、积分同步、宠物被动技能和状态写回；当前只能记录为不切流结论，后续需先补 D1/KV 导入器和完整 Go 状态构造，不允许只为了桌宠返回残缺状态 | 已完成 |
| 2026-06-23 | 阶段 4 农场 runtime schema | 新增 `0015_farm_runtime.sql`，用 `farm_states.state_json` 承接旧 `farmv2:state:{userId}` 完整 JSON，并新增每日商店购买、成熟提醒去重和浇水提醒去重表，为后续导入器和 Go status 实现铺底 | 已完成 |
| 2026-06-23 | 阶段 4 农场 runtime schema review | `npm run audit:farm-status-cutover` 已更新为要求 `0015_farm_runtime.sql` 存在；schema 小块完成后仍不切 `/api/farm/status`，继续等待 D1 导入器和 Go status 服务层补齐 | 已完成 |
| 2026-06-23 | 阶段 4 农场 D1/KV 导入器 | 新增 `migrate-d1 -apply -scope farm-v2`，支持导入 `farmv2:state:*`、`farmv2:shop:daily:*`、`farmv2:mature-mail:sent:*` 和 `farmv2:water-mail:sent:*` 到 `0015` 的四张 runtime 表 | 已完成 |
| 2026-06-23 | 阶段 4 农场 D1/KV 导入器 review | D1 analyzer 已映射 farmv2 目标表；`go test ./internal/migration/d1`、`TEST_DATABASE_URL=... go test -p 1 -tags integration ./internal/migration/d1 -run FarmV2 -count=1`、`go run ./cmd/migrate-d1 -input ./internal/migration/d1/testdata/farm-v2.sql -scope farm-v2`、本地 CLI `-apply` 冒烟和 `go test ./...` 均通过；fixture 测试数据已清理，Gateway 仍未切 farm | 已完成 |
| 2026-06-23 | 阶段 4 农场 PostgreSQL store | 新增 Go `internal/farm` store，提供 `farm_states` 读取/写回和 `farm_daily_shop_purchases` 按日期读取能力，为后续 Go status 服务层复用同一状态源 | 已完成 |
| 2026-06-23 | 阶段 4 农场 PostgreSQL store review | Store 只接数据库边界，不注册 HTTP 路由、不执行 tick、不改 Gateway；覆盖无数据库错误、缺失状态、状态保存/读取、每日限购读取和 PostgreSQL integration；`go test ./internal/farm`、`TEST_DATABASE_URL=... go test -p 1 -tags integration ./internal/farm -count=1`、`go test ./...` 与 `npm run audit:farm-status-cutover` 均通过 | 已完成 |
| 2026-06-23 | 阶段 4 农场 status 服务层骨架 | 新增 Go `internal/farm` status 类型、JSON 兼容处理、seedrandom 天气、基础农场引擎和 `Service.GetStatus`，可从 PostgreSQL 现有状态构造旧前端兼容的 status 顶层字段、派生土地、天气预报、可种作物和每日限购计数 | 已完成 |
| 2026-06-23 | 阶段 4 农场 status 服务层 review | 本小块只提供内部服务层，不注册 HTTP、不改 Gateway；review 中修正了 `ComputedLand` 匿名嵌入导致派生字段不输出的问题，并去掉 `shopDailyPurchases` 的 `omitempty`；覆盖日历/天气 golden、computed lands、JSON shape、无 store 错误、PostgreSQL service 读取与缺失状态；`go test ./internal/farm` 和 farm integration 已通过，后续仍需补完整 tick、积分同步、宠物被动技能与 get-or-create 后再评估接口层 | 已完成 |
| 2026-06-23 | 阶段 4 农场 get-or-create 初始状态 | `Service.GetStatus` 在 `farm_states` 缺失时创建并保存初始农场状态，包含 4 块空地、4 块锁定地、新手种子礼包、欢迎事件和基础时间戳；本小块暂不做旧实现里的初始 100 积分账本入账 | 已完成 |
| 2026-06-23 | 阶段 4 农场 get-or-create review | PostgreSQL integration 覆盖缺失状态自动落库并返回完整 status；仍不注册 HTTP、不改 Gateway；下一步需补积分账本同步和 tick 写回，避免切流后状态积分与福利积分分叉 | 已完成 |
| 2026-06-23 | 阶段 4 农场积分余额同步 | `Service.GetStatus` 对已有农场状态读取 `point_accounts.balance`，同步 `state.points` 并写回 `farm_states.state_json`，避免 status 返回旧农场 JSON 中的过期积分 | 已完成 |
| 2026-06-23 | 阶段 4 农场积分余额同步 review | 覆盖无数据库错误、PostgreSQL 已有状态同步并落库；本小块不做新用户初始 100 积分入账，不注册 HTTP、不改 Gateway；后续仍需补 tick、宠物被动技能和新用户初始积分账本写入 | 已完成 |
| 2026-06-23 | 阶段 4 农场基础作物 tick | 新增 Go `tickBasicCropState`，在 `Service.GetStatus` 内执行并写回基础作物状态：换季枯萎、缺水累计、3 次缺水枯萎、成熟状态、过熟 48 小时枯萎和事件追加 | 已完成 |
| 2026-06-23 | 阶段 4 农场基础作物 tick review | 覆盖成熟事件、缺水枯萎、换季枯萎和 PostgreSQL status 写回；本小块仍不做雨天自动浇水、乌鸦窗口、周五随机事件、宠物衰减、宠物任务或 HTTP/Gateway 切流 | 已完成 |
| 2026-06-23 | 阶段 4 农场雨天自动浇水 tick | Go `tickBasicCropState` 补齐旧 `applyRainAutoWater` 逻辑，小雨每 30 分钟、暴雨每 15 分钟自动给未成熟作物浇水，最多回溯 6 小时，并刷新 `lastWaterAt`、`nextWaterDueAt` 和土地状态 | 已完成 |
| 2026-06-23 | 阶段 4 农场雨天自动浇水 review | 覆盖雨天恢复缺水作物、保留历史缺水次数、跳过成熟后的雨点，并通过 PostgreSQL status 写回验证；review 中修正测试假设，保持与旧 TS “成熟前雨点仍可生效”的行为一致；仍不做乌鸦、周五事件、宠物或 HTTP/Gateway 切流 | 已完成 |
| 2026-06-23 | 阶段 4 农场乌鸦窗口 tick | Go `tickBasicCropState` 补齐旧 `runCrowChecks` 核心逻辑，按用户和窗口稳定 seed 推进乌鸦判定，支持天气/季节概率、防鸟网、稻草人、宠物守护/赶乌鸦最小状态读取，命中后写成 `eaten` 并追加事件 | 已完成 |
| 2026-06-23 | 阶段 4 农场乌鸦窗口 review | 覆盖确定性乌鸦吃作物、防鸟网保护、成熟/过熟测试隔离乌鸦影响，并通过 PostgreSQL status 写回验证；执行顺序保持在成熟判定前，仍不做周五随机事件、宠物衰减、宠物任务结束或 HTTP/Gateway 切流 | 已完成 |
| 2026-06-23 | 阶段 4 农场周五随机事件 tick | 新增 Go `friday_event.go`，补齐旧 `maybeApplyFridayEvent` 的 8 类随机事件：送种子、送普通肥料、午后云雨、宠物/牛奶、干燥热风、杂草延迟成熟、乌鸦突袭和货车损失；按中国日期和稳定 seed 每周五每用户最多触发一次 | 已完成 |
| 2026-06-23 | 阶段 4 农场周五随机事件 review | 覆盖非周五跳过、同一中国日期只触发一次、送种子、午后云雨、乌鸦突袭和 PostgreSQL status 写回；事件会修改种子库存、道具库存、宠物 JSON、作物状态和事件列表；仍不做宠物衰减、宠物任务结束、宠物被动技能或 HTTP/Gateway 切流 | 已完成 |
| 2026-06-23 | 阶段 4 农场初始积分入账 | `Service.GetStatus` 创建缺失农场状态时调用 `EnsureInitialPointGrant`，在 `point_accounts.balance=0` 时发放 100 初始积分，并写入确定性 `point_ledger` 流水 `farm_initial_{userId}` | 已完成 |
| 2026-06-23 | 阶段 4 农场初始积分入账 review | 覆盖无数据库错误、首次创建农场后积分账户为 100、初始流水唯一存在；已有正余额用户不会被覆盖；仍不注册 HTTP、不改 Gateway，后续继续补宠物衰减、宠物任务结束和宠物被动技能 | 已完成 |
| 2026-06-23 | 阶段 4 农场宠物基础懒结算 | 新增 Go `pet_tick.go`，在 status tick 中补宠物每日衰减、按小时衰减、每日喂养/清洁/喂水/陪玩计数重置、非偷菜/非浇水任务结束、低情绪罢工和宠物任务事件写回 | 已完成 |
| 2026-06-23 | 阶段 4 农场宠物基础懒结算 review | 覆盖每日与小时衰减、每日偷菜计数清零、结束守护任务、低情绪停止任务和 PostgreSQL status 写回；当前刻意不清理 `water` 和 `steal` 任务，等待后续宠物自动浇水/偷菜专门结算小块 | 已完成 |
| 2026-06-23 | 阶段 4 农场宠物自动浇水 | Go `processPetWaterTask` 补齐旧宠物自动浇水懒结算：按 `nextWaterDueAt - 10 分钟`、任务开始时间和种植时间计算浇水窗口，推进作物 `lastWaterAt`、`nextWaterDueAt` 和土地状态，任务结束后清空 `water` 任务但保留冷却 | 已完成 |
| 2026-06-23 | 阶段 4 农场宠物自动浇水 review | 覆盖提前浇水、任务到期清空、成熟土地跳过和 PostgreSQL status 写回；review 中修正测试假设，水间隔需按实际天气/季节计算，并用防鸟网隔离乌鸦窗口影响 | 已完成 |
| 2026-06-23 | 阶段 4 农场宠物被动播种 | Go `processPassivePetPlant` 补齐成年宠物 `plant` 被动：自动在 `empty/eaten` 土地播种当前季节、已解锁且库存存在的最高收益种子，消耗 `seedInventory`，设置作物成长/浇水时间并追加 `pet_task` 事件 | 已完成 |
| 2026-06-23 | 阶段 4 农场宠物被动播种 review | 覆盖收益优先选择、库存消耗、事件写入、未成年宠物不触发和 PostgreSQL status 写回；本小块不做被动收菜积分入账，下一步单独处理宠物被动收菜 | 已完成 |
| 2026-06-23 | 阶段 4 农场宠物被动收菜 | 新增 Go 收获算法和 `Service.GetStatus` 被动技能步骤，补齐成年宠物 `harvest` 被动：成熟作物自动收获、按品质/缺水/季节/过熟/偷菜扣减计算收益、清空土地、写入 harvest/pet_task 事件，并通过确定性积分流水幂等入账；首次收获补 `firstHarvest` 标记和 10 积分奖励 | 已完成 |
| 2026-06-23 | 阶段 4 农场宠物被动收菜 review | 覆盖被动收菜清空成熟土地、事件写入、未成年宠物不触发、PostgreSQL 积分账户/流水和状态持久化；同时把被动播种从纯 tick 尾部移到服务层被动技能步骤，保持旧逻辑“先收菜、再播种”的顺序；仍不注册 farm HTTP、不改 Gateway | 已完成 |
| 2026-06-23 | 阶段 4 农场偷菜纯算法 | 新增 Go `steal.go`，迁移旧偷菜核心算法：可偷成熟作物筛选、随机选择、按宠物类型/情绪/健康/饥饿/清洁/口渴/目标守护/铃铛计算成功率，以及目标成熟作物被整棵偷走后的清地、被偷计数、`stolenByMap` 和 `stolen_in` 事件 | 已完成 |
| 2026-06-23 | 阶段 4 农场偷菜纯算法 review | 覆盖成功率修正、低状态归零、目标清地、计数和事件写入；本小块不做双用户 PostgreSQL 事务、不注册 `/api/farm/steal/*`、不改 Gateway，下一步需要实现偷菜 endpoint 的原子读写和积分入账 | 已完成 |
| 2026-06-23 | 阶段 4 农场偷菜双用户事务结算 | 新增内部 `Service.ExecuteSteal`，在同一 PostgreSQL 事务中按用户 ID 顺序锁定双方 `farm_states`，执行双方 tick、宠物偷菜技能校验和派遣；成功时清空目标成熟作物、写 `stolen_in/stolen_out` 事件、更新双方偷菜计数，并通过确定性 `farm_steal_{thief}_{target}_{date}` 积分流水给偷菜者入账；失败时只消耗偷菜者当日对该目标次数并写失败事件 | 已完成 |
| 2026-06-23 | 阶段 4 农场偷菜双用户事务结算 review | 覆盖成功偷菜双方状态持久化、偷菜者积分账户和流水、宠物偷菜任务记录、失败偷菜不改目标作物且不写积分流水；仍不注册 `/api/farm/steal/*` HTTP 路由、不改 Gateway，下一步应补偷菜 HTTP handler 与认证包装后再做页面冒烟 | 已完成 |
| 2026-06-23 | 阶段 4 农场偷菜 HTTP handler | 新增 Go `farm_handlers.go` 并注册精确 `POST /api/farm/steal/do`，复用现有 session 登录校验、可信来源校验和 `farmActionRateLimit`；兼容旧请求体 `{ targetUserId }`，调用 `ExecuteSteal` 后再调用 `GetStatus` 返回 `{ success, data, steal }` | 已完成 |
| 2026-06-23 | 阶段 4 农场偷菜 HTTP handler review | 覆盖未登录、参数无效、无数据库错误；`npm run audit:farm-status-cutover` 允许唯一精确 Go 路由 `/farm/steal/do`，仍要求 Gateway 没有 `/api/farm` 规则；本小块不做 Gateway 切流和页面冒烟 | 已完成 |
| 2026-06-23 | 阶段 4 农场 status HTTP handler | Go 注册精确 `GET /api/farm/status` 与 `POST /api/farm/status`，复用 session 登录校验和 `farmActionRateLimit`，调用 `Service.GetStatus` 返回旧兼容 `{ success, data }` 响应，保留 status 懒结算写回语义 | 已完成 |
| 2026-06-23 | 阶段 4 农场 status HTTP handler review | 覆盖未登录、GET/POST 无数据库错误；`npm run audit:farm-status-cutover` 允许精确 `/farm/status` 与 `/farm/steal/do`，仍要求 Gateway 无 `/api/farm` 规则；本小块不做 Gateway 切流和页面冒烟 | 已完成 |
| 2026-06-23 | 阶段 4 农场 HTTP PostgreSQL integration | 新增 farm HTTP 集成测试，真实 PostgreSQL 下覆盖 `GET /api/farm/status` 初始状态/积分账户/积分流水落库，以及 `POST /api/farm/steal/do` 认证请求、响应形状、双方状态和偷菜流水一致性 | 已完成 |
| 2026-06-23 | 阶段 4 农场 HTTP PostgreSQL integration review | `go test ./internal/httpserver ./internal/farm`、`TEST_DATABASE_URL=... go test -p 1 -tags integration ./internal/httpserver -run Farm -count=1` 通过；review 确认只新增测试和文档/审计，不改 Gateway、不打开 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 农场种植接口 | Go 内部接入 `POST /api/farm/plant`，兼容旧请求体 `{ plotIndex, cropId }` 和响应 `{ success, data, balance }`；服务层在 PostgreSQL 事务中锁当前用户农场状态，完成 tick、积分同步、土地/季节/解锁/种子校验、播种写回和 plant 事件 | 已完成 |
| 2026-06-23 | 阶段 4 农场种植接口 review | 覆盖种植规则单元测试、服务层 PostgreSQL 落库、HTTP 参数/无数据库错误和真实 PostgreSQL HTTP integration；本小块只注册 Go 内部精确路由，Gateway 仍无 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 农场浇水接口 | Go 内部接入 `POST /api/farm/water`，兼容旧请求体 `{ plotIndex }` 和响应 `{ success, data, bonus }`；服务层在 PostgreSQL 事务中锁当前用户农场状态，完成 tick、积分同步、单块作物浇水和首次浇水奖励流水 | 已完成 |
| 2026-06-23 | 阶段 4 农场浇水接口 review | 覆盖浇水规则单元测试、服务层 PostgreSQL 积分/状态落库、HTTP 参数/无数据库错误和真实 PostgreSQL HTTP integration；本小块只注册 Go 内部精确路由，Gateway 仍无 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 农场一键浇水接口 | Go 内部接入 `POST /api/farm/water-all`，兼容旧无请求体调用和响应 `{ success, data, count }`；服务层在 PostgreSQL 事务中锁当前用户农场状态，完成 tick、积分同步和可浇作物批量刷新浇水时间 | 已完成 |
| 2026-06-23 | 阶段 4 农场一键浇水接口 review | 覆盖一键浇水规则单元测试、服务层 PostgreSQL 状态落库、HTTP 未登录/无数据库错误和真实 PostgreSQL HTTP integration；review 中修正成熟作物测试夹具，保证 `matureAt` 与状态一致；Gateway 仍无 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 农场手动收获接口 | Go 内部接入 `POST /api/farm/harvest`，兼容旧请求体 `{ plotIndex }` 和响应 `{ success, data, harvest, balance }`；服务层在 PostgreSQL 事务中锁当前用户农场状态，完成 tick、积分同步、成熟作物收获、收益流水和首次收获奖励流水 | 已完成 |
| 2026-06-23 | 阶段 4 农场手动收获接口 review | 覆盖收获规则单元测试、服务层 PostgreSQL 积分/状态落库、HTTP 参数/无数据库错误和真实 PostgreSQL HTTP integration；`harvest` 响应字段已用 lowerCamel JSON tag 对齐旧前端；Gateway 仍无 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 农场一键收获接口 | Go 内部接入 `POST /api/farm/harvest-all`，兼容旧无请求体调用和响应 `{ success, data, harvests, total, balance }`；服务层在 PostgreSQL 事务中锁当前用户农场状态，完成 tick、积分同步、所有成熟作物收获、批量收益流水和首次收获奖励流水 | 已完成 |
| 2026-06-23 | 阶段 4 农场一键收获接口 review | 覆盖一键收获规则单元测试、服务层 PostgreSQL 积分/状态落库、HTTP 未登录/无数据库错误和真实 PostgreSQL HTTP integration；review 中用防鸟网隔离成熟作物夹具的乌鸦窗口影响；Gateway 仍无 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 农场清除枯萎接口 | Go 内部接入 `POST /api/farm/remove`，兼容旧请求体 `{ plotIndex }` 和响应 `{ success, data }`；服务层在 PostgreSQL 事务中锁当前用户农场状态，完成 tick、积分同步，并只允许清除 `withered` 或 `eaten` 土地 | 已完成 |
| 2026-06-23 | 阶段 4 农场清除枯萎接口 review | 覆盖清除规则单元测试、服务层 PostgreSQL 状态落库、HTTP 未登录/参数/无数据库错误和真实 PostgreSQL HTTP integration；审计脚本允许唯一新增精确 Go 路由 `/farm/remove`，Gateway 仍无 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 农场购买种子接口 | Go 内部接入 `POST /api/farm/seeds/buy`，兼容旧请求体 `{ cropId, qty }` 和响应 `{ success, data, balance }`；服务层在 PostgreSQL 事务中锁当前用户农场状态，完成 tick、积分同步、作物/数量/解锁/余额校验、积分扣减和种子库存增加 | 已完成 |
| 2026-06-23 | 阶段 4 农场购买种子接口 review | 覆盖购买规则单元测试、服务层 PostgreSQL 积分扣减/库存落库、HTTP 未登录/参数/无数据库错误和真实 PostgreSQL HTTP integration；消费流水使用 `exchange` 来源；Gateway 仍无 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 农场购买土地接口 | Go 内部接入 `POST /api/farm/buy-land`，兼容旧请求体 `{ landIndex }` 和响应 `{ success, data, balance }`；服务层在 PostgreSQL 事务中锁当前用户农场状态，完成 tick、积分同步、1 基土地编号/顺序解锁/余额校验、积分扣减、土地解锁和 `land_buy` 事件写入 | 已完成 |
| 2026-06-23 | 阶段 4 农场购买土地接口 review | 覆盖购买土地规则单元测试、服务层 PostgreSQL 积分扣减/土地落库、HTTP 未登录/参数/无数据库错误和真实 PostgreSQL HTTP integration；消费流水使用 `exchange` 来源；Gateway 仍无 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 农场购买道具接口 | Go 内部接入 `POST /api/farm/shop/buy`，兼容旧请求体 `{ key, qty }` 和响应 `{ success, data, balance }`；服务层在 PostgreSQL 事务中锁当前用户农场状态，完成 tick、积分同步、商品 override、一次性设备、每日限购、余额校验、积分扣减、库存增加和每日购买计数更新 | 已完成 |
| 2026-06-23 | 阶段 4 农场购买道具接口 review | 覆盖购买道具规则单元测试、服务层 PostgreSQL 积分扣减/库存/每日限购落库、HTTP 未登录/参数/无数据库错误和真实 PostgreSQL HTTP integration；消费流水使用 `exchange` 来源；Gateway 仍无 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 农场使用道具接口 | Go 内部接入 `POST /api/farm/shop/use`，兼容旧请求体 `{ key, plotIndex? }` 和响应 `{ success, data }`；服务层在 PostgreSQL 事务中锁当前用户农场状态，完成 tick、商品 override、背包扣减、肥料/保护/加速/天气/技能书/最后的晚餐等道具效果写回 | 已完成 |
| 2026-06-23 | 阶段 4 农场使用道具接口 review | 覆盖使用道具规则单元测试、服务层 PostgreSQL 状态落库、HTTP 未登录/参数/无数据库错误和真实 PostgreSQL HTTP integration；仅新增 Go 内部精确路由 `/farm/shop/use`，Gateway 仍无 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 农场宠物领养接口 | Go 内部接入 `POST /api/farm/pet/adopt`，兼容旧请求体 `{ type, name? }` 和响应 `{ success, data, balance }`；服务层在 PostgreSQL 事务中锁当前用户农场状态，完成 tick、积分同步、宠物类型/重复领养校验、首次领养奖励、再次领养扣费、宠物初始状态和事件写回 | 已完成 |
| 2026-06-23 | 阶段 4 农场宠物领养接口 review | 覆盖领养规则单元测试、服务层 PostgreSQL 宠物/奖励流水落库、HTTP 未登录/参数/无数据库错误和真实 PostgreSQL HTTP integration；仅新增 Go 内部精确路由 `/farm/pet/adopt`，Gateway 仍无 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 农场宠物喂养接口 | Go 内部接入 `POST /api/farm/pet/feed`，兼容旧请求体 `{ kind }` 和响应 `{ success, data, balance }`；服务层在 PostgreSQL 事务中锁当前用户农场状态，完成 tick、宠物懒结算、积分同步、宠粮库存扣减、每日次数和宠物数值写回 | 已完成 |
| 2026-06-23 | 阶段 4 农场宠物喂养接口 review | 覆盖喂养规则单元测试、服务层 PostgreSQL 宠物/库存落库、HTTP 未登录/参数/无数据库错误和真实 PostgreSQL HTTP integration；仅新增 Go 内部精确路由 `/farm/pet/feed`，Gateway 仍无 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 农场宠物物品接口 | Go 内部接入 `POST /api/farm/pet/wash`、`POST /api/farm/pet/drink`、`POST /api/farm/pet/play`，兼容旧请求体 `{ itemKey? }` 与 `{ mode?, itemKey? }`；服务层复用 `ExecuteUsePetItem` 处理 `care`/`drink`/`rest`/`play` 分类、免费默认物品、付费背包扣减、每日限制和宠物数值写回 | 已完成 |
| 2026-06-23 | 阶段 4 农场宠物物品接口 review | 覆盖宠物物品规则单元测试、服务层 PostgreSQL 宠物/库存落库、HTTP 未登录/无数据库错误和真实 PostgreSQL HTTP integration；仅新增三条 Go 内部精确路由，Gateway 仍无 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 农场宠物派遣接口 | Go 内部接入 `POST /api/farm/pet/dispatch`，兼容旧请求体 `{ task }` 和响应 `{ success, data, message }`；服务层在 PostgreSQL 事务中锁当前用户农场状态，完成 tick、宠物懒结算、积分同步、五类允许任务校验、任务时长/冷却写回、宠物收菜入账和宠物种菜自动播种 | 已完成 |
| 2026-06-23 | 阶段 4 农场宠物派遣接口 review | 覆盖派遣规则单元测试、服务层 PostgreSQL 宠物/土地/积分流水落库、HTTP 未登录/参数/无数据库错误和真实 PostgreSQL HTTP integration；仅新增 Go 内部精确路由 `/farm/pet/dispatch`，Gateway 仍无 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 农场偷菜候选列表接口 | Go 内部接入 `GET /api/farm/steal/list`，兼容旧响应 `{ success, data: { candidates } }`；服务层从 PostgreSQL `farm_states`、`users`、`user_profiles` 组合候选，过滤自己、今日已偷目标、被偷次数达上限目标和无成熟作物目标 | 已完成 |
| 2026-06-23 | 阶段 4 农场偷菜候选列表接口 review | 覆盖服务层 PostgreSQL 候选筛选、HTTP 未登录/无数据库错误和真实 PostgreSQL HTTP integration；至此当前前端使用的农场路径均已有 Go 内部精确 handler，Gateway 仍无 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 农场直连 API 冒烟门禁 | 新增 `scripts/smoke-farm-go-api.mjs`，默认通过 `docker compose exec -T api` 直连 Go API 容器，验证 `/readyz`、当前全部前端 `/api/farm` 路径未登录边界和 Gateway 未切农场；支持后续传入 `FARM_GO_API_COOKIE` 做登录态只读冒烟 | 已完成 |
| 2026-06-23 | 阶段 4 农场直连 API 冒烟门禁 review | `node scripts/smoke-farm-go-api.mjs` 通过，覆盖 20 个未登录路径检查；`npm run audit:farm-status-cutover` 已纳入该脚本存在性和关键片段校验；Gateway 仍无 `/api/farm` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 通知直连 API 冒烟门禁 | 新增 `scripts/smoke-notifications-go-api.mjs`，默认通过 `docker compose exec -T api` 直连 Go API 容器，验证 `/readyz`、通知列表/未读数/已读/删除/领取 5 个路径未登录边界和 Gateway 未切通知；支持后续传入 `NOTIFICATIONS_GO_API_COOKIE` 做登录态只读冒烟 | 已完成 |
| 2026-06-23 | 阶段 4 通知直连 API 冒烟门禁 review | `node scripts/smoke-notifications-go-api.mjs` 通过，覆盖 5 个未登录路径检查；`npm run audit:notifications-cutover` 已纳入该脚本存在性和关键片段校验；`docker compose config --quiet` 和 Gateway `/api/notifications` 检查通过，Gateway 仍无 `/api/notifications` 规则 | 已完成 |
| 2026-06-23 | 阶段 4 钱包直连 API 冒烟门禁 | 新增 `scripts/smoke-wallet-go-api.mjs`，默认通过 `docker compose exec -T api` 直连 Go API 容器，验证 `/readyz`、充值余额/充值/提现 3 个路径未登录边界和 Gateway 未切钱包；支持后续传入 `WALLET_GO_API_COOKIE` 做登录态只读余额冒烟，并可用 `WALLET_GO_API_EXPECT_NEW_API=1` 要求 new-api 配置真实可用 | 已完成 |
| 2026-06-23 | 阶段 4 钱包直连 API 冒烟门禁 review | `node scripts/smoke-wallet-go-api.mjs` 通过，覆盖 3 个未登录路径检查；`npm run audit:wallet-cutover` 已纳入该脚本存在性和关键片段校验；Gateway `/api/store/topup`、`/api/store/withdraw` 和 `/api/store*` 检查通过，Gateway 仍无钱包切流规则 | 已完成 |
| 2026-06-23 | 阶段 4 卡牌前台切流前置审计 | 新增 `scripts/audit-cards-cutover.mjs` 和 `docs/cards-cutover-preflight.md`，自动核对前台卡牌页面实际依赖的 `/api/cards/inventory`、`/api/cards/rules`、`/api/cards/draw`、`/api/cards/claim-reward`、`/api/cards/exchange`，并记录旧 `cards:user:{userId}` 与 `cards:rules:config` 数据形状 | 已完成 |
| 2026-06-23 | 阶段 4 卡牌前台切流前置审计 review | `node --check scripts/audit-cards-cutover.mjs`、`node scripts/audit-cards-cutover.mjs`、`npm test -- src/lib/cards/__tests__`、`docker compose config --quiet` 和 Gateway `/api/cards` 检查通过；审计确认 Go 尚无卡牌路由，Gateway 仍无 `/api/cards*` 或 `/api/admin/cards*` 规则；本小块不做卡牌 Go 实现、不切 Gateway | 已完成 |
| 2026-06-23 | 阶段 4 卡牌 PostgreSQL schema | 新增 `0016_cards.sql`，建立 `card_user_states`、`card_rules`、`card_draw_logs` 和 `card_reward_claims`，承接旧 `cards:user:{userId}` 完整状态、`cards:rules:config` 规则、抽卡审计和卡册奖励幂等领取记录 | 已完成 |
| 2026-06-23 | 阶段 4 卡牌 PostgreSQL schema review | `go run ./cmd/migrate -dry-run` 已包含 `0016_cards.sql`；`go test ./internal/migration/postgres`、`node scripts/audit-cards-cutover.mjs` 和 `docker compose config --quiet` 通过；本小块不做 D1 导入器、Go 服务层、HTTP handler 或 Gateway 切流 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌 D1/KV 导入器 | 新增 `migrate-d1 -apply -scope cards`，支持导入 `native_user_cards`、legacy `cards:user:*` 和 `cards:rules:config` 到 `card_user_states` 与 `card_rules`；同一用户 native/legacy 并存时按旧读穿语义合并库存、领奖记录、碎片、保底计数、抽卡次数和最近抽卡记录 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌 D1/KV 导入器 review | 覆盖单元测试、PostgreSQL integration、CLI dry-run/apply fixture 和数据库写入复查；`node scripts/audit-cards-cutover.mjs` 已纳入 `cards` scope、导入器、fixture 和 `0016_cards.sql` 校验；本小块不接 Go 服务层、HTTP handler 或 Gateway | 已完成 |
| 2026-06-24 | 阶段 4 卡牌 PostgreSQL store | 新增 `internal/cards` PostgreSQL store，支持默认规则、用户状态缺失兜底、用户卡牌状态读取/保存和导入规则读取，默认概率、保底、抽卡价格、碎片价值与旧 TypeScript 常量对齐 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌 PostgreSQL store review | `audit-cards-cutover` 已纳入 store 文件和关键实现校验；覆盖 Go 单元测试、PostgreSQL integration、全量 Go 测试、Compose 配置和 Gateway 卡牌规则检查；本小块不实现抽卡服务层、HTTP handler 或 Gateway 切流 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌抽卡纯算法 | 新增 Go `ApplyDraws` 纯算法，按旧逻辑完成 1-10 连抽校验、抽卡次数扣减、保底递增、最高保底优先、概率选稀有度、重复卡转碎片、分层保底重置和最近抽卡 10 条保留 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌抽卡纯算法 review | 覆盖普通概率抽卡、稀有/传说稀有保底、重复卡碎片、最近抽卡上限和非法/次数不足输入；`audit-cards-cutover` 已纳入算法文件与关键测试校验；本小块不接数据库事务、HTTP handler 或 Gateway | 已完成 |
| 2026-06-24 | 阶段 4 卡牌抽卡事务服务层 | 新增 `internal/cards.Service.ExecuteDraws`，在 PostgreSQL transaction 中锁定 `card_user_states` 用户行，读取默认/导入规则，执行抽卡纯算法，保存状态并写入 `card_draw_logs` | 已完成 |
| 2026-06-24 | 阶段 4 卡牌抽卡事务服务层 review | 覆盖已有状态重复卡碎片落库、缺失状态默认初始化、抽卡日志写入和次数不足不写日志；`audit-cards-cutover` 已纳入服务层与 integration 测试校验；本小块不接 HTTP handler 或 Gateway | 已完成 |
| 2026-06-24 | 阶段 4 卡牌碎片兑换服务层 | 新增 `ApplyFragmentExchange` 与 `Service.ExecuteFragmentExchange`，对齐旧逻辑处理无效卡、已拥有、碎片不足和成功扣碎片加库存，并在 PostgreSQL transaction 中锁定用户卡牌状态后写回 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌碎片兑换服务层 review | 覆盖纯算法成功/无效/已拥有/碎片不足，PostgreSQL integration 覆盖成功兑换落库和碎片不足不写状态；`audit-cards-cutover` 已纳入兑换关键实现与测试校验；本小块不接 HTTP handler 或 Gateway | 已完成 |
| 2026-06-24 | 阶段 4 卡牌卡册奖励服务层 | 新增 `ApplyRewardClaim` 与 `Service.ExecuteRewardClaim`，对齐旧逻辑处理奖励 key、重复领取、未集齐、奖励积分异常，并在同一 PostgreSQL transaction 中写 `card_reward_claims`、`point_accounts`、`point_ledger` 和用户卡牌状态 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌卡册奖励服务层 review | 覆盖纯算法成功/重复/未集齐/配置异常，PostgreSQL integration 覆盖成功发积分与重复领取不重复发放；`audit-cards-cutover` 已纳入奖励关键实现与测试校验；本小块不接 HTTP handler 或 Gateway | 已完成 |
| 2026-06-24 | 阶段 4 卡牌只读 HTTP handler | Go 内部注册 `GET /api/cards/inventory` 与 `GET /api/cards/rules` 精确路由，库存响应保持旧前端 lowerCamel 字段，规则响应保持 `rarityProbabilities`、`pityThresholds`、`cardDrawPrice`、`fragmentValues`、`exchangePrices`、`updatedAt` 形状 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌只读 HTTP handler review | 覆盖未登录/无数据库边界、真实 PostgreSQL 库存响应和导入规则响应；`audit-cards-cutover` 已允许且要求仅这两条只读 Go 路由；Gateway 仍无 `/api/cards*` 或 `/api/admin/cards*` 规则 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌只读直连 API 冒烟门禁 | 新增 `scripts/smoke-cards-go-api.mjs`，默认通过 `docker compose exec -T api` 直连 Go API 容器，验证 `/readyz`、公开规则读取、库存未登录边界和 Gateway 未切卡牌；支持后续传入 `CARDS_GO_API_COOKIE` 做登录态只读库存冒烟 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌只读直连 API 冒烟门禁 review | `node scripts/smoke-cards-go-api.mjs` 通过；`audit-cards-cutover` 已纳入冒烟脚本存在性和关键片段校验；Gateway 仍无 `/api/cards*` 或 `/api/admin/cards*` 规则 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌静态 catalog | 新增 Go `AllCards` / `CardsByAlbum` 静态 catalog，按前端 `config.ts` 同源规则生成 137 张卡，保留旧前端需要的 `id`、`name`、`rarity`、`image`、`thumbnailImage`、`originalImage`、`backImage`、`probability`、`albumId` 字段 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌静态 catalog review | 覆盖总数 137、卡册数量 `animal-s1=20`、`animal-s2=39`、`tarot=78`、稀有度数量和关键卡牌资源路径；`audit-cards-cutover` 已纳入 catalog 文件与测试校验；本小块为 `POST /api/cards/draw` handler 前置，不切 Gateway | 已完成 |
| 2026-06-24 | 阶段 4 卡牌抽卡 HTTP handler | Go 内部注册 `POST /api/cards/draw` 精确路由，复用可信来源校验、登录校验和 `ratelimit:cards:draw`，响应兼容旧单抽 `data.card` 与多抽 `data.cards` 形状 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌抽卡 HTTP handler review | 覆盖跨站拦截、无数据库边界、真实 PostgreSQL 单抽成功落库和次数不足失败；`smoke-cards-go-api` 已覆盖抽卡未登录边界；Gateway 仍无 `/api/cards*` 或 `/api/admin/cards*` 规则 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌碎片兑换 HTTP handler | Go 内部注册 `POST /api/cards/exchange` 精确路由，复用可信来源校验、登录校验和 `ratelimit:cards:exchange`，响应兼容旧 Next 成功 `{ success, message }` 与业务失败 400 形状 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌碎片兑换 HTTP handler review | 覆盖未登录、跨站拦截、缺少卡牌 ID、无数据库边界、真实 PostgreSQL 成功兑换落库和碎片不足不写状态；`smoke-cards-go-api` 已覆盖兑换未登录边界；Gateway 仍无 `/api/cards*` 或 `/api/admin/cards*` 规则 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌奖励领取 HTTP handler | Go 内部注册 `POST /api/cards/claim-reward` 精确路由，复用可信来源校验、登录校验和 `ratelimit:cards:claim-reward`，按静态卡册默认奖励发放 `pointsAwarded` 与 `newBalance` | 已完成 |
| 2026-06-24 | 阶段 4 卡牌奖励领取 HTTP handler review | 覆盖未登录、跨站拦截、无效奖励类型、无效卡册、无数据库边界、真实 PostgreSQL 成功发放积分和未集齐失败不写奖励/积分；`smoke-cards-go-api` 已覆盖奖励领取未登录边界；Gateway 仍无 `/api/cards*` 或 `/api/admin/cards*` 规则 | 已完成 |
| 2026-06-24 | 阶段 4 卡牌购买抽卡次数入口评估 | 审计确认当前前台没有直接调用 `POST /api/cards/purchase`，实际入口是商城 `card_draw` 商品；修复 Go 商城兑换只写 `user_assets.card_draws` 的分叉问题，同一事务同步更新 `card_user_states.draws_available` | 已完成 |
| 2026-06-24 | 阶段 4 卡牌购买抽卡次数入口评估 review | 扩展商城兑换幂等 PostgreSQL integration，确认重复幂等请求只扣一次积分，同时 `user_assets.card_draws` 增加 1、`card_user_states.draws_available` 按旧默认 1 加购买次数后为 2；Gateway 仍无 `/api/cards*` 或 `/api/admin/cards*` 规则 | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌切流前置审计 | 新增 `scripts/audit-admin-cards-cutover.mjs` 和 `docs/admin-cards-cutover-preflight.md`，自动核对 `/admin/cards` 实际依赖的 `/api/admin/cards/users`、`/api/admin/cards/user/[userId]`、`/api/admin/cards/reset`、`/api/admin/cards/albums`、`/api/admin/cards/rules`，并记录 `cards:album_rewards` 与 `cards:tier_rewards` 后台自定义奖励键 | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌切流前置审计 review | `node --check scripts/audit-admin-cards-cutover.mjs`、`node scripts/audit-admin-cards-cutover.mjs`、前台卡牌审计、Compose 配置和 Gateway 卡牌规则检查通过；审计确认 Go 尚无 `/admin/cards` 路由，Gateway 仍无 `/api/cards*` 或 `/api/admin/cards*` 规则；本小块不做后台卡牌 Go 实现、不切 Gateway | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌自定义奖励 schema | 新增 `0017_card_admin_rewards.sql`，建立 `card_album_rewards` 与 `card_tier_rewards`，承接旧后台 `cards:album_rewards` 和 `cards:tier_rewards` 自定义奖励配置 | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌自定义奖励 schema review | `audit-admin-cards-cutover` 已纳入 migration 文件和关键约束校验；`go run ./cmd/migrate -dry-run`、PostgreSQL migration 测试、后台/前台卡牌审计、Compose 配置和 Gateway 卡牌规则检查通过；本小块不接 D1 导入器、Go admin handler 或 Gateway | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌自定义奖励 D1 导入器 | 扩展 `migrate-d1 -apply -scope cards`，导入 `cards:album_rewards` 到 `card_album_rewards`，导入 `cards:tier_rewards` 到 `card_tier_rewards`，CLI 输出新增两类 upsert 计数 | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌自定义奖励 D1 导入器 review | 覆盖 importer 单元测试、PostgreSQL integration、fixture dry-run/apply、后台/前台卡牌审计、Compose 配置和 Gateway 卡牌规则检查；本小块不接 Go admin service、HTTP handler 或 Gateway | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌只读 service | 新增 `internal/cards.AdminService`，支持后台用户列表聚合、搜索、分页、单用户卡牌详情、规则读取，以及 `card_album_rewards` / `card_tier_rewards` 覆盖静态默认奖励的只读配置 | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌只读 service review | 覆盖无数据库边界、分页规范化、默认奖励/覆盖值、真实 PostgreSQL 用户列表/搜索/详情/奖励覆盖；`audit-admin-cards-cutover` 已纳入只读 service 和测试校验，同时继续禁止 Go `/admin/cards` 路由与 Gateway 卡牌规则 | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌只读 HTTP handler 方法 | 新增 `adminCardHandlers` 只读方法，覆盖后台用户列表、单用户详情、卡册/稀有度奖励读取和规则读取，响应保持旧后台 lowerCamel 字段；本小块不在 `server.go` 注册 `/api/admin/cards/*` 路由 | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌只读 HTTP handler 方法 review | 覆盖未登录、非管理员、无数据库边界、用户 ID 校验和真实 PostgreSQL 旧响应形状；`audit-admin-cards-cutover` 已纳入 handler 文件与测试校验，同时继续禁止 Go `/admin/cards` 路由与 Gateway 卡牌规则 | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌写路径 service | 扩展 `internal/cards.AdminService`，支持重置用户卡牌进度、更新卡牌规则、更新卡册奖励和更新稀有度奖励；重置会删除 `card_user_states` 与 `card_reward_claims`，保留 `card_draw_logs` 作为审计记录 | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌写路径 service review | 覆盖无数据库边界、非法输入、概率合计校验、真实 PostgreSQL 规则 upsert、奖励 upsert、重置后状态回默认和领奖记录删除/抽卡日志保留；本小块不接写路径 HTTP handler、不注册 Go 路由、不切 Gateway | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌写路径 HTTP handler 方法 | 扩展 `adminCardHandlers`，新增重置用户卡牌进度、更新卡册/稀有度奖励、更新卡牌规则三个写路径方法，复用管理员鉴权、可信来源校验、参数校验和旧响应文案 | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌写路径 HTTP handler 方法 review | 覆盖写路径无数据库边界、跨站拦截、非法 userId/奖励值、真实 PostgreSQL 奖励更新、规则更新和重置删除状态；本小块仍不在 `server.go` 注册 `/api/admin/cards/*`，Gateway 保持无卡牌规则 | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌 Go 内部精确路由与冒烟门禁 | 在 Go API 内部注册后台卡牌 7 条精确路由，新增 `scripts/smoke-admin-cards-go-api.mjs`，默认通过 `docker compose exec -T api` 直连验证 `/readyz`、后台卡牌读写路径未登录边界和 Gateway 未切卡牌 | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌 Go 内部精确路由与冒烟门禁 review | `audit-admin-cards-cutover` 已改为要求精确 Go admin cards 路由与冒烟脚本，同时继续要求 Gateway 无 `/api/cards*` 和 `/api/admin/cards*`；仍未用真实管理员 Cookie 做读路径冒烟，也未做后台页面级 review | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌管理员 Cookie 直连冒烟 review | 使用本地 Docker Compose 管理员会话 Cookie 运行 `ADMIN_CARDS_GO_API_COOKIE=... node scripts/smoke-admin-cards-go-api.mjs`，覆盖后台卡牌用户列表、奖励配置和规则 3 个管理员只读路径；review 中发现本地 `app` 库缺 `0017_card_admin_rewards.sql`，已通过 `/app/migrate` 补齐后冒烟通过 | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌非管理员 403 直连冒烟 review | 扩展 `smoke-admin-cards-go-api` 支持 `ADMIN_CARDS_GO_API_NON_ADMIN_COOKIE`，本地 Docker Compose 下覆盖普通登录用户访问后台卡牌用户列表和重置写路径返回 403；后台卡牌审计已纳入该门禁 | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌页面只读冒烟 review | 在不修改 Gateway 的前提下，用本地临时代理将 `/admin/cards` 页面内的后台卡牌请求转发到 Go API，验证用户列表、奖励配置和规则三个 tab 均可读取；验证后已停止临时代理，Gateway 仍无 `/api/cards*` 或 `/api/admin/cards*` 规则 | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌页面写路径冒烟 review | 使用 Docker PostgreSQL 专用测试用户通过 `/admin/cards` 页面真实按钮验证重置进度、卡册奖励保存、稀有度奖励保存和规则保存；发现并修复本地代理 `PATCH` 提前断开导致的 `context canceled`，复验后清理测试用户、规则/奖励配置和临时代理；Gateway 仍无 `/api/cards*` 或 `/api/admin/cards*` 规则 | 已完成 |
| 2026-06-24 | 阶段 4 后台卡牌写路径自动冒烟门禁 | 新增 `scripts/smoke-admin-cards-write-go-api.mjs`，默认通过 Docker 直连 Go API 与 PostgreSQL，自动备份原始全局配置、创建专用测试用户、验证重置/奖励/规则写路径、查库确认并恢复清理 | 已完成 |
| 2026-06-24 | 阶段 4 profile 写路径自动冒烟门禁 | 新增 `scripts/smoke-profile-write-go-api.mjs`，默认通过 Docker 直连 Go API 与 PostgreSQL，创建专用测试用户并验证资料更新、成就佩戴和 overview 回读一致，最后自动清理测试用户、资料、佩戴记录和授权记录 | 已完成 |
| 2026-06-24 | 阶段 4 notifications 写路径自动冒烟门禁 | 新增 `scripts/smoke-notifications-write-go-api.mjs`，默认通过 Docker 直连 Go API 与 PostgreSQL，创建专用测试用户、普通通知和 points 奖励通知，验证列表/未读数、标记已读、删除已读、领取奖励与重复领取幂等，最后清理通知、奖励、积分流水和测试用户 | 已完成 |
| 2026-06-24 | 阶段 4 前台卡牌写路径自动冒烟门禁 | 新增 `scripts/smoke-cards-write-go-api.mjs`，默认通过 Docker 直连 Go API 与 PostgreSQL，创建专用测试用户并验证登录态库存、碎片兑换、抽卡、卡册奖励领取、积分入账和测试数据清理 | 已完成 |
| 2026-06-24 | 阶段 4 农场写路径自动冒烟门禁 | 新增 `scripts/smoke-farm-write-go-api.mjs`，默认通过 Docker 直连 Go API 与 PostgreSQL，创建专用测试用户和偷菜目标，验证状态初始化、买种子、种植、浇水、收获、购买/使用道具、宠物领养/喂养/互动、偷菜候选和偷菜执行，最后清理测试数据 | 已完成 |
| 2026-06-24 | 阶段 4 钱包缺配置写路径安全门禁 | 新增 `scripts/smoke-wallet-write-missing-newapi-go-api.mjs`，默认通过 Docker 直连 Go API 与 PostgreSQL，验证本地未配置 new-api 管理端时，认证余额/充值/提现均返回 `NEW_API_NOT_CONFIGURED`，且不写钱包交易、积分流水或余额变化 | 已完成 |
| 2026-06-24 | 阶段 4 游戏汇总直连聚合冒烟门禁 | 新增 `scripts/smoke-games-summary-go-api.mjs`，默认通过 Docker 直连 Go API 与 PostgreSQL，创建专用测试用户、今日统计和游戏记录，验证 `/api/games/profile` 与内部 `/api/games/overview` 聚合响应，并确认 Gateway 只打开 `/api/games/profile` 精确规则 | 已完成 |
| 2026-06-24 | 阶段 4 抽奖切流独立审计与直连冒烟门禁 | 新增 `scripts/audit-raffle-cutover.mjs`、`scripts/smoke-raffle-go-api.mjs` 和 `docs/raffle-cutover-preflight.md`，核对公开抽奖与后台抽奖前端依赖、Go 精确路由、Gateway 精确规则，并用 Docker 测试抽奖验证公开列表/详情/参与、重复参与、后台 401/403 和管理员只读路径 | 已完成 |
| 2026-06-24 | 阶段 4 福利项目公开列表独立审计与直连冒烟门禁 | 新增 `scripts/audit-projects-cutover.mjs`、`scripts/smoke-projects-go-api.mjs` 和 `docs/projects-cutover-preflight.md`，核对 `GET /api/projects` 精确切流、Go 列表响应字段、Gateway 禁止 `/api/projects/*` 与 `/api/admin/projects*`，并用 Docker 测试项目验证 active 可见、paused 不公开 | 已完成 |
| 2026-06-24 | 阶段 4 商城核心独立审计与直连冒烟门禁 | 新增 `scripts/audit-store-cutover.mjs`、`scripts/smoke-store-go-api.mjs` 和 `docs/store-cutover-preflight.md`，核对商城前台/后台已知依赖、Go 核心与后台精确路由、`0002_store.sql`、Gateway 只打开 `/api/store`、`/api/store/exchange`、`/api/store/admin`，并用 Docker 测试商品验证兑换写入和幂等不重复扣分 | 已完成 |
| 2026-06-24 | 阶段 4 积分查询与环保排行榜独立审计/直连冒烟门禁 | 新增 `scripts/audit-points-rankings-cutover.mjs`、`scripts/smoke-points-rankings-go-api.mjs` 和 `docs/points-rankings-cutover-preflight.md`，核对 `/api/points` 与 `/api/rankings/eco` 精确 Gateway、Go 路由、响应字段和 PostgreSQL schema，并用 Docker 测试用户验证积分余额/流水、环保榜排序和成就字段 | 已完成 |
| 2026-06-24 | 阶段 4 环保行动独立审计与直连写路径冒烟门禁 | 新增 `scripts/audit-eco-cutover.mjs`、`scripts/smoke-eco-go-api.mjs` 和 `docs/eco-cutover-preflight.md`，核对环保页 8 条前端路径、Go 精确路由、`0010_eco_base.sql` 与 Gateway 8 条精确规则，并用 Docker 测试用户验证拖拽结算、购买、领奖、公示、普通出售、商人收购、黑市出售和偷盗写入 | 已完成 |
| 2026-06-24 | 阶段 4 记忆游戏独立审计与直连结算冒烟门禁 | 新增 `scripts/audit-memory-cutover.mjs`、`scripts/smoke-memory-go-api.mjs` 和 `docs/memory-cutover-preflight.md`，核对记忆游戏 5 条前端路径、Go 精确路由、runtime schema 与 Gateway 5 条精确规则，并用 Docker 测试用户验证开局隐藏布局、翻牌、取消、结算写积分/记录和重复提交拒绝 | 已完成 |
| 2026-06-24 | 阶段 4 消消乐独立审计与直连结算冒烟门禁 | 新增 `scripts/audit-match3-cutover.mjs`、`scripts/smoke-match3-go-api.mjs` 和 `docs/match3-cutover-preflight.md`，核对消消乐 4 条前端路径、Go 精确路由、runtime schema 与 Gateway 4 条精确规则，并用 Docker 测试用户验证固定 seed 合法交换结算、积分/记录写入和重复提交拒绝 | 已完成 |
| 2026-06-24 | 阶段 4 打地鼠独立审计与直连结算冒烟门禁 | 新增 `scripts/audit-whack-mole-cutover.mjs`、`scripts/smoke-whack-mole-go-api.mjs` 和 `docs/whack-mole-cutover-preflight.md`，核对打地鼠 4 条前端路径、Go/Gateway 5 条精确路径、runtime schema 与禁通配规则，并用 Docker 测试用户验证固定 seed 命中结算、积分/记录写入和重复提交拒绝 | 已完成 |
| 2026-06-24 | 阶段 4 扫雷独立审计与直连结算冒烟门禁 | 新增 `scripts/audit-minesweeper-cutover.mjs`、`scripts/smoke-minesweeper-go-api.mjs` 和 `docs/minesweeper-cutover-preflight.md`，核对扫雷 5 条前端路径、Go 精确路由、runtime schema 与 Gateway 5 条精确规则，并用 Docker 测试用户验证 step 推进、失败局结算、重复 submit 回放和不重复发分 | 已完成 |
| 2026-06-24 | 阶段 4 连连看独立审计与直连结算冒烟门禁 | 新增 `scripts/audit-linkgame-cutover.mjs`、`scripts/smoke-linkgame-go-api.mjs` 和 `docs/linkgame-cutover-preflight.md`，核对连连看 4 条前端路径、Go 精确路由、runtime schema 与 Gateway 4 条精确规则，并用 Docker 测试用户验证两牌夹具结算、重复 submit 回放和不重复发分 | 已完成 |
| 2026-06-24 | 阶段 4 Roguelite 独立审计与直连结算冒烟门禁 | 新增 `scripts/audit-roguelite-cutover.mjs`、`scripts/smoke-roguelite-go-api.mjs` 和 `docs/roguelite-cutover-preflight.md`，核对 Roguelite 5 条前端路径、Go 精确路由、runtime schema 与 Gateway 5 条精确规则，并用 Docker 测试用户验证 step 推进、escaped 结算、重复 submit 回放和不重复发分 | 已完成 |
| 2026-06-24 | 阶段 4 Gateway 禁切守卫 | 新增 `scripts/audit-gateway-cutover-guard.mjs` 和 `docs/gateway-cutover-guard.md`，固化当前仍禁止切流的 `/api/farm*`、`/api/profile*`、`/api/notifications*`、钱包充值/提现、卡牌、游戏 overview、games 通配、projects 通配和 admin 通配规则，避免后续误开 Gateway | 已完成 |
| 2026-06-24 | 阶段 4 普通游戏一键门禁套件 | 新增 `scripts/smoke-game-cutovers-go-api.mjs` 和 `docs/game-cutover-suite.md`，串行执行 Gateway 禁切守卫、6 个普通游戏独立审计和 Docker 直连结算冒烟，用于本地/Zeabur 部署前统一复核 | 已完成 |
| 2026-06-24 | 阶段 4 Zeabur 部署前总预检 | 新增 `scripts/preflight-zeabur-go-api.mjs` 和 `docs/zeabur-deployment-preflight.md`，串行执行 Compose 配置校验、Gateway 禁切守卫、积分/商城/环保/项目/抽奖/游戏聚合、普通游戏一键门禁和钱包缺配置安全冒烟；默认不打开未切流模块，`ZEABUR_PREFLIGHT_INCLUDE_INTERNAL=1` 可额外复跑 profile、notifications、cards、admin cards、farm 本地写路径门禁 | 已完成 |
| 2026-06-24 | 阶段 4 Zeabur 部署前总预检 review | `node --check scripts/preflight-zeabur-go-api.mjs`、默认总预检、`ZEABUR_PREFLIGHT_INCLUDE_INTERNAL=1` 扩展总预检、`docker compose config --quiet` 和 Gateway 禁切守卫均通过；扩展预检确认未切流模块仍只做本地直连门禁，不改变 Gateway | 已完成 |
| 2026-06-24 | 阶段 4 生产切流准备审计 | 新增 `scripts/audit-production-cutover-readiness.mjs` 和 `docs/production-cutover-readiness.md`，将 wallet、profile、notifications、farm、cards 的真实 D1 导出、真实 Cookie、new-api 配置和页面级冒烟缺口转成可执行检查；当时本地审计输出 `ready:false`，5 个模块均因缺真实条件继续禁止切流；阶段 5 后已追加 `auth` 为第 6 个生产 readiness 阻塞模块 | 已完成 |
| 2026-06-24 | 阶段 4 生产切流准备审计 review | `node --check scripts/audit-production-cutover-readiness.mjs`、`node scripts/audit-production-cutover-readiness.mjs` 和 Gateway 禁切守卫均通过；审计确认 `/api/farm*`、`/api/profile*`、`/api/notifications*`、钱包充值/提现、卡牌和 admin/games/projects 通配仍关闭 | 已完成 |
| 2026-06-24 | 阶段 4 后端 README 同步 | 更新 `backend/README.md`，同步当前 Go 内部路由、钱包 HTTP、普通游戏、profile、notifications、farm、cards/admin cards 迁移状态，补齐 `migrate-d1 -apply` 已开放的 14 个 scope 和部署前总预检/readiness 审计命令 | 已完成 |
| 2026-06-24 | 阶段 4 后端 README 同步 review | 过期描述 `暂未接入钱包 HTTP`、`开放五个小范围`、`环保行动等完整导入仍未开放` 已清除；`node --check` 两个新增门禁脚本、生产切流准备审计和 `docker compose config --quiet` 均通过 | 已完成 |
| 2026-06-24 | 阶段 4 Zeabur 环境变量样例审计 | 新增 `scripts/audit-zeabur-env-example.mjs` 和 `docs/zeabur-env-audit.md`，检查 `deploy/zeabur.env.example` 覆盖 Web、共享认证、Go Runtime、new-api、Worker/Cron 和对象存储 20 个关键变量，并要求密钥类变量使用占位值避免误提交真实密钥 | 已完成 |
| 2026-06-24 | 阶段 4 Zeabur 环境变量样例审计 review | `node --check scripts/audit-zeabur-env-example.mjs`、`node scripts/audit-zeabur-env-example.mjs`、Gateway 禁切守卫和接入 env 审计后的默认 Zeabur 部署前总预检均通过；总预检第一步已固定为 env 样例审计 | 已完成 |
| 2026-06-24 | 阶段 4 D1 导入 scope 一致性审计 | 新增 `scripts/audit-migrate-d1-scopes.mjs` 和 `docs/migrate-d1-scope-audit.md`，静态核对 `migrate-d1` 帮助文案、scope 白名单、`switch *scope` 分支与 `backend/README.md` 命令/说明是否一致覆盖 14 个导入范围 | 已完成 |
| 2026-06-24 | 阶段 4 D1 导入 scope 一致性审计 review | `node --check scripts/audit-migrate-d1-scopes.mjs`、`node scripts/audit-migrate-d1-scopes.mjs`、Gateway 禁切守卫、`docker compose config --quiet` 和接入 scope 审计后的默认 Zeabur 部署前总预检均通过；总预检第二步已固定为 D1 scope 审计 | 已完成 |
| 2026-06-24 | 阶段 4 Zeabur 部署运行手册 | 新增 `docs/zeabur-deployment-runbook.md` 和 `scripts/audit-zeabur-runbook.mjs`，固化本地预检、Zeabur 环境变量、真实 D1 dry-run/import、生产 readiness、禁切路径、发布后冒烟和精确路径回滚顺序 | 已完成 |
| 2026-06-24 | 阶段 4 Zeabur 部署运行手册 review | `node --check scripts/audit-zeabur-runbook.mjs`、`node scripts/audit-zeabur-runbook.mjs`、D1 scope 审计、Gateway 禁切守卫和接入 runbook 审计后的默认 Zeabur 部署前总预检均通过；总预检第三步已固定为运行手册审计 | 已完成 |
| 2026-06-24 | 阶段 4 Zeabur 运行时基础冒烟 | 新增 `scripts/smoke-zeabur-runtime.mjs` 和 `docs/zeabur-runtime-smoke.md`，经 Gateway 检查 `/healthz`、`/readyz`、首页、公开项目/抽奖列表，以及积分、商城、游戏中心、环保、记忆游戏的未登录边界；支持 `ZEABUR_RUNTIME_BASE_URL` 指向 Zeabur 域名 | 已完成 |
| 2026-06-24 | 阶段 4 Zeabur 运行时基础冒烟 review | `node --check scripts/smoke-zeabur-runtime.mjs`、`node scripts/smoke-zeabur-runtime.mjs`、运行手册审计、Gateway 禁切守卫、`docker compose config --quiet`、接入 runtime smoke 后的默认总预检和 `ZEABUR_PREFLIGHT_INCLUDE_INTERNAL=1` 扩展总预检均通过；总预检已固定 runtime smoke 步骤 | 已完成 |
| 2026-06-24 | 阶段 4 Zeabur 真实环境变量审计 | 新增 `scripts/audit-zeabur-runtime-env.mjs`，并更新 `docs/zeabur-env-audit.md`、`docs/zeabur-deployment-runbook.md` 和运行手册审计；真实 env 审计会检查缺失/空值/占位值、本地地址、HTTPS、`NODE_ENV=production` 和密钥最小长度，不打印真实密钥值 | 已完成 |
| 2026-06-24 | 阶段 4 Zeabur 真实环境变量审计 review | `node --check scripts/audit-zeabur-runtime-env.mjs` 通过；使用临时完整环境变量运行 `node scripts/audit-zeabur-runtime-env.mjs` 通过；使用 `ZEABUR_ENV_FILE=deploy/zeabur.env.example` 运行会按预期失败并列出占位字段；运行手册审计、env 样例审计、Gateway 禁切守卫、`docker compose config --quiet` 和默认总预检均通过 | 已完成 |
| 2026-06-24 | 阶段 4 生产 readiness 接入真实 env 审计 | 更新 `scripts/audit-production-cutover-readiness.mjs`，当传入 `ZEABUR_ENV_FILE` 时先执行 `scripts/audit-zeabur-runtime-env.mjs`，拦截占位值、本地地址、非 HTTPS、过短密钥和 env 文件路径不存在等上线配置问题 | 已完成 |
| 2026-06-24 | 阶段 4 生产 readiness 接入真实 env 审计 review | 默认 readiness 仍输出 `ready:false` 且不失败；临时完整 env 文件可通过 runtime env 前置审计并继续输出业务缺口；`ZEABUR_ENV_FILE=deploy/zeabur.env.example` 和不存在的 env 文件路径均按预期失败；`node --check`、Gateway 禁切守卫和默认总预检均通过 | 已完成 |
| 2026-06-24 | 阶段 4 迁移产物索引审计 | 新增 `scripts/audit-migration-artifacts.mjs` 和 `docs/migration-artifact-audit.md`，静态检查 Zeabur/Docker 核心文件、18 个模块的审计/冒烟/预检文档、总预检核心引用和迁移计划关键部署收口记录，避免后续产物缺失或引用漂移 | 已完成 |
| 2026-06-24 | 阶段 4 迁移产物索引审计 review | `node --check scripts/audit-migration-artifacts.mjs`、`node scripts/audit-migration-artifacts.mjs`、运行手册审计、Gateway 禁切守卫、`docker compose config --quiet` 和接入 artifact 审计后的默认总预检均通过；artifact 审计确认 22 个核心文件、18 个模块和 60 个模块产物齐全 | 已完成 |
| 2026-06-24 | 阶段 4 Docker Compose 拓扑审计 | 新增 `scripts/audit-compose-topology.mjs` 和 `docs/compose-topology-audit.md`，静态检查 `compose.yml` 中 gateway/web/api/worker/postgres/redis 六服务、构建上下文、端口、volume、healthcheck、关键本地环境变量和 7 条服务依赖关系 | 已完成 |
| 2026-06-24 | 阶段 4 Docker Compose 拓扑审计 review | `node --check scripts/audit-compose-topology.mjs`、`node scripts/audit-compose-topology.mjs`、迁移产物索引审计、运行手册审计、Gateway 禁切守卫、`docker compose config --quiet` 和接入拓扑审计后的默认总预检均通过；拓扑审计确认 5 个基础文件、42 个关键片段和 7 条依赖关系 | 已完成 |
| 2026-06-24 | 阶段 4 Dockerfile 构建产物审计 | 新增 `scripts/audit-dockerfiles.mjs` 和 `docs/dockerfile-audit.md`，静态检查 Web Next standalone 镜像、Go api/worker/migrate/migrate-d1 四二进制镜像、Caddy Gateway 镜像和 `.dockerignore` 的关键构建入口 | 已完成 |
| 2026-06-24 | 阶段 4 Dockerfile 构建产物审计 review | `node --check scripts/audit-dockerfiles.mjs`、`node scripts/audit-dockerfiles.mjs`、迁移产物索引审计、运行手册审计、Gateway 禁切守卫、`docker compose config --quiet` 和接入 Dockerfile 审计后的默认总预检均通过；Dockerfile 审计确认 4 个构建相关文件和 44 个关键片段 | 已完成 |
| 2026-06-24 | 阶段 4 Gateway 允许切流清单审计 | 新增 `scripts/audit-gateway-allowed-cutovers.mjs` 和 `docs/gateway-allowed-cutovers.md`，正向校验 `gateway/Caddyfile` 中所有转发到 `api:8080` 的活跃 `handle` 必须与当前允许清单完全一致，并禁止 `handle_path` | 已完成 |
| 2026-06-24 | 阶段 4 Gateway 允许切流清单审计 review | `node --check scripts/audit-gateway-allowed-cutovers.mjs`、`node scripts/audit-gateway-allowed-cutovers.mjs`、Gateway 禁切守卫、迁移产物索引审计、运行手册审计、`docker compose config --quiet` 和接入允许清单审计后的默认总预检均通过；当前 49 条 Go API 转发与允许清单完全一致 | 已完成 |
| 2026-06-24 | 阶段 4 生产切流证据包模板与审计 | 新增 `deploy/production-cutover-evidence.example.json`、`scripts/audit-production-cutover-evidence.mjs` 和 `docs/production-cutover-evidence.md`，结构化记录 wallet、profile、notifications、farm、cards 的真实 D1 导入、Zeabur env、真实登录态 API 冒烟、页面级冒烟和 Gateway 切流审批证据；阶段 5 后证据包已扩展覆盖 `auth`；脚本会拦截 Cookie、Token、Secret 等敏感值写入证据文件 | 已完成 |
| 2026-06-24 | 阶段 4 生产切流证据包模板与审计 review | `node --check scripts/audit-production-cutover-evidence.mjs`、证据包模板审计、strict 模式预期失败检查、生产 readiness 审计、迁移产物索引审计、运行手册审计、Gateway 双门禁、`docker compose config --quiet` 和接入证据包审计后的默认总预检均通过；当时真实证据仍未齐全，5 个高风险模块继续保持禁切；阶段 5 后已追加 `auth` 生产证据门禁 | 已完成 |
| 2026-06-24 | 阶段 4 Zeabur 服务计划模板与审计 | 新增 `deploy/zeabur-services.example.json`、`scripts/audit-zeabur-service-plan.mjs` 和 `docs/zeabur-service-plan.md`，固化 Zeabur 上 gateway、web、api、worker、postgres、redis 六服务的 Docker 构建入口、端口、依赖、环境变量名和发布后检查，并要求只有 Gateway 对公网开放 | 已完成 |
| 2026-06-24 | 阶段 4 Zeabur 服务计划模板与审计 review | `node --check scripts/audit-zeabur-service-plan.mjs`、服务计划审计、Compose 拓扑审计、Zeabur env 样例审计、迁移产物索引审计、运行手册审计、`docker compose config --quiet` 和接入服务计划审计后的默认总预检均通过；审计确认 6 个服务、7 条依赖、30 个环境变量引用和 Gateway 唯一公网入口 | 已完成 |
| 2026-06-24 | 阶段 4 PostgreSQL migration 审计 | 新增 `scripts/audit-postgres-migrations.mjs` 和 `docs/postgres-migration-audit.md`，静态校验 `backend/migrations` 连续编号、`-- +goose Up`、后端镜像 `/app/migrate` 与 `/app/migrations` 打包、migration runner 和 Zeabur 运行手册入口 | 已完成 |
| 2026-06-24 | 阶段 4 PostgreSQL migration 审计 review | `node --check scripts/audit-postgres-migrations.mjs`、PostgreSQL migration 审计、本地 `go run ./cmd/migrate -dry-run`、容器内 `/app/migrate -dry-run`、Dockerfile 审计、迁移产物索引审计、运行手册审计、`docker compose config --quiet` 和接入 migration 审计后的默认总预检均通过；当前 17 个 migration 从 `0001_base.sql` 到 `0017_card_admin_rewards.sql` 连续有效 | 已完成 |
| 2026-06-24 | 阶段 4 PostgreSQL 实库 schema 审计 | 新增 `scripts/audit-postgres-live-schema.mjs` 和 `docs/postgres-live-schema-audit.md`，只读 Docker PostgreSQL 的 `schema_migrations`，确认当前运行库已应用全部 `backend/migrations/*.sql`，并拦截缺失或未知 migration 版本 | 已完成 |
| 2026-06-24 | 阶段 4 PostgreSQL 实库 schema 审计 review | `node --check scripts/audit-postgres-live-schema.mjs`、实库 schema 审计、静态 migration 审计、迁移产物索引审计、运行手册审计、`docker compose config --quiet` 和接入实库审计后的默认总预检均通过；当前 Docker PostgreSQL 已应用 17/17 个 migration，最新版本为 `0017_card_admin_rewards.sql` | 已完成 |
| 2026-06-24 | 阶段 4 Zeabur 远端运行时冒烟 strict 模式 | 增强 `scripts/smoke-zeabur-runtime.mjs`，新增 `ZEABUR_RUNTIME_REQUIRE_REMOTE=1`，发布后冒烟可强制 `ZEABUR_RUNTIME_BASE_URL` 必须为 HTTPS 且不能指向 localhost/loopback，避免误用本地 Gateway 结果当作 Zeabur 验证 | 已完成 |
| 2026-06-24 | 阶段 4 Zeabur 远端运行时冒烟 strict 模式 review | `node --check scripts/smoke-zeabur-runtime.mjs`、本地默认 runtime smoke、`ZEABUR_RUNTIME_REQUIRE_REMOTE=1` 拒绝本地地址的预期失败检查、运行手册审计、迁移产物索引审计、Gateway 双门禁、`docker compose config --quiet` 和默认总预检均通过；默认本地冒烟不受影响，发布后可强制远端 HTTPS 目标 | 已完成 |
| 2026-06-24 | 阶段 4 部署产物敏感信息卫生审计 | 新增 `scripts/audit-deploy-secret-hygiene.mjs` 和 `docs/deploy-secret-hygiene-audit.md`，统一扫描 `deploy/` 模板、Zeabur 文档和生产切流证据模板，拦截真实 Bearer token、Cookie session、JWT、`sk-*` key、AWS access key、private key block 和长 secret 赋值 | 已完成 |
| 2026-06-24 | 阶段 4 部署产物敏感信息卫生审计 review | `node --check scripts/audit-deploy-secret-hygiene.mjs`、敏感信息卫生审计、Zeabur env 样例审计、生产切流证据包审计、Zeabur 服务计划审计、运行手册审计、迁移产物索引审计、`docker compose config --quiet` 和接入敏感信息审计后的默认总预检均通过；当前扫描 8 个部署相关文件，未发现真实凭据模式 | 已完成 |
| 2026-06-24 | 阶段 4 生产 readiness 合并切流证据包缺口 | 增强 `scripts/audit-production-cutover-readiness.mjs`，当传入 `CUTOVER_EVIDENCE_FILE` 时解析证据包审计输出，并把 wallet、profile、notifications、farm、cards 的证据缺口合并进对应模块 `blockers`，避免证据未齐时 readiness 只看环境变量和 Cookie；阶段 5 后同一机制已扩展覆盖 `auth` | 已完成 |
| 2026-06-24 | 阶段 4 生产 readiness 合并切流证据包缺口 review | `node --check scripts/audit-production-cutover-readiness.mjs`、默认 readiness、带 `CUTOVER_EVIDENCE_FILE=deploy/production-cutover-evidence.example.json` 的 readiness、证据包审计、迁移产物索引审计、运行手册审计、Gateway 双门禁、`docker compose config --quiet` 和默认总预检均通过；默认模式只标记模板已校验，传入证据文件时会将证据缺口合并到模块 blockers | 已完成 |
| 2026-06-24 | 阶段 4 Gateway 上游可配置化 | Gateway 转发上游改为 `API_UPSTREAM` 与 `WEB_UPSTREAM`，本地默认仍是 `api:8080` 和 `web:3000`，Zeabur 服务名不一致时可只覆盖变量，不扩大切流清单 | 已完成 |
| 2026-06-24 | 阶段 4 Gateway 上游可配置化 review | `node --check` 覆盖 Gateway/Zeabur 相关审计脚本，Gateway 允许清单审计、Gateway 禁切守卫、Compose 拓扑审计、Zeabur env 样例审计、Zeabur 服务计划审计、运行手册审计、`docker compose config --quiet`、迁移产物索引审计、部署产物敏感信息卫生审计和默认总预检均通过；当前仍保持 49 条精确 Go API 转发和 11 个禁切路径 | 已完成 |
| 2026-06-24 | 阶段 4 Gateway 上游一致性审计 | 新增 `scripts/audit-gateway-upstreams.mjs` 和 `docs/gateway-upstream-audit.md`，静态校验 Caddyfile、Compose、Zeabur env 样例、Zeabur 服务计划和部署文档中的 `API_UPSTREAM` / `WEB_UPSTREAM` 一致性，并接入默认总预检 | 已完成 |
| 2026-06-24 | 阶段 4 Gateway 上游一致性审计 review | `node --check scripts/audit-gateway-upstreams.mjs`、上游一致性审计、迁移产物索引审计、部署产物敏感信息卫生审计、运行手册审计、Gateway 双门禁、`docker compose config --quiet` 和接入上游审计后的默认总预检均通过；总预检已包含 `gateway upstreams audit` 步骤 | 已完成 |
| 2026-06-24 | 阶段 4 生产 readiness 接入 Gateway 上游审计 | 增强 `scripts/audit-production-cutover-readiness.mjs`，生产切流准备审计会先执行 `scripts/audit-gateway-upstreams.mjs`，并在输出中标记 `gatewayUpstreamsConfigured: true`，避免单独跑 readiness 时漏掉 Gateway 上游变量漂移 | 已完成 |
| 2026-06-24 | 阶段 4 生产 readiness 接入 Gateway 上游审计 review | `node --check scripts/audit-production-cutover-readiness.mjs`、默认 readiness、带 `CUTOVER_EVIDENCE_FILE=deploy/production-cutover-evidence.example.json` 的 readiness、Gateway 上游一致性审计、Gateway 禁切守卫、迁移产物索引审计、部署产物敏感信息卫生审计和默认总预检均通过；readiness 仍保持 `ok: true`、`ready: false` 语义，真实证据未齐时不误报可切流 | 已完成 |
| 2026-06-24 | 阶段 4 PostgreSQL 冒烟测试残留审计 | 新增 `scripts/audit-postgres-smoke-residue.mjs` 和 `docs/postgres-smoke-residue-audit.md`，只读扫描 Docker PostgreSQL 中 `999900..999999` smoke 用户段在 `users.id`、`user_id`、`owner_user_id`、`thief_user_id`、`original_user_id` 上的残留，并接入默认总预检末尾 | 已完成 |
| 2026-06-24 | 阶段 4 PostgreSQL 冒烟测试残留审计 review | `node --check scripts/audit-postgres-smoke-residue.mjs`、PostgreSQL 冒烟残留审计、运行手册审计、迁移产物索引审计、默认总预检和 `ZEABUR_PREFLIGHT_INCLUDE_INTERNAL=1` 扩展总预检均通过；残留审计已调整为总预检最后一步，覆盖 internal 写路径 smoke 后的本地库状态，当前动态检查 39 个用户关联列且 `999900..999999` 测试用户段残留为 0 | 已完成 |
| 2026-06-24 | 阶段 4 生产证据包加入 Zeabur 远端冒烟要求 | 增强 `deploy/production-cutover-evidence.example.json`、`scripts/audit-production-cutover-evidence.mjs` 和证据文档，新增 `zeaburEnv.remoteRuntimeSmokePassed`，要求真实证据包必须记录 `ZEABUR_RUNTIME_REQUIRE_REMOTE=1` 指向 Zeabur HTTPS 域名的运行时冒烟结果 | 已完成 |
| 2026-06-24 | 阶段 4 生产证据包加入 Zeabur 远端冒烟要求 review | `node --check scripts/audit-production-cutover-evidence.mjs`、生产证据包审计、默认 readiness、带 `CUTOVER_EVIDENCE_FILE=deploy/production-cutover-evidence.example.json` 的 readiness、部署产物敏感信息卫生审计、迁移产物索引审计和默认总预检均通过；证据包 blocker 已包含 `zeaburEnv.remoteRuntimeSmokePassed 未通过`，避免用本地 Gateway 冒烟代替 Zeabur 远端验证 | 已完成 |
| 2026-06-24 | 阶段 4 真实部署文件忽略防护 | `.gitignore` 与 `.dockerignore` 新增 `deploy/zeabur.env`、`deploy/production-cutover-evidence.json` 忽略规则，并增强 `scripts/audit-deploy-secret-hygiene.mjs` 检查这 4 条忽略规则，降低真实 env 或生产切流证据误提交、误打包风险 | 已完成 |
| 2026-06-24 | 阶段 4 真实部署文件忽略防护 review | `node --check scripts/audit-deploy-secret-hygiene.mjs`、部署产物敏感信息卫生审计、Dockerfile 构建产物审计、迁移产物索引审计、`docker compose config --quiet` 和默认总预检均通过；敏感信息审计当前扫描 9 个部署相关文件、4 条忽略规则和 7 类敏感值模式 | 已完成 |
| 2026-06-24 | 阶段 4 生产 readiness 可选远端冒烟 | 增强 `scripts/audit-production-cutover-readiness.mjs`，当传入 `ZEABUR_RUNTIME_BASE_URL` 时自动用 `ZEABUR_RUNTIME_REQUIRE_REMOTE=1` 执行 `scripts/smoke-zeabur-runtime.mjs`，未传远端域名时保持跳过 | 已完成 |
| 2026-06-24 | 阶段 4 生产 readiness 可选远端冒烟 review | `node --check scripts/audit-production-cutover-readiness.mjs`、默认 readiness、带证据包模板 readiness、`ZEABUR_RUNTIME_BASE_URL=http://127.0.0.1:8080` 预期失败检查、部署产物敏感信息卫生审计、迁移产物索引审计和默认总预检均通过；readiness 输出新增 `remoteRuntimeSmoke`，可防止传入本地或非 HTTPS 地址冒充 Zeabur 远端结果 | 已完成 |
| 2026-06-24 | 阶段 4 生产 readiness 严格模式 | 增强 `scripts/audit-production-cutover-readiness.mjs`，新增 `PRODUCTION_CUTOVER_READINESS_STRICT=1`，严格模式下只要 `ready:false` 就退出非 0，适合真实切流前 CI 或最终门禁 | 已完成 |
| 2026-06-24 | 阶段 4 生产 readiness 严格模式 review | `node --check scripts/audit-production-cutover-readiness.mjs`、默认 readiness、`PRODUCTION_CUTOVER_READINESS_STRICT=1 CUTOVER_EVIDENCE_FILE=deploy/production-cutover-evidence.example.json` 预期失败检查、生产证据包审计、部署产物敏感信息卫生审计、迁移产物索引审计和默认总预检均通过；默认模式仍保持 `ok:true / ready:false` 的日常审计语义 | 已完成 |
| 2026-06-24 | 阶段 4 生产证据包真实文件校验 | 增强 `scripts/audit-production-cutover-evidence.mjs`，真实证据文件模式会要求 `generatedAt`、`reviewOwner`、`d1Export.file`、`zeaburEnv.envFile` 不能继续使用占位值，并校验 D1 导出文件和 Zeabur env 文件路径真实存在 | 已完成 |
| 2026-06-24 | 阶段 4 生产证据包真实文件校验 review | `node --check scripts/audit-production-cutover-evidence.mjs`、模板证据包审计、临时复制 example 作为真实证据文件的预期失败检查、默认 readiness、部署产物敏感信息卫生审计、迁移产物索引审计和默认总预检均通过；真实证据文件若仍含占位值会输出 `realEvidenceViolations` 并失败 | 已完成 |
| 2026-06-24 | 阶段 4 生产切流最终预检 | 新增 `scripts/preflight-production-cutover.mjs` 和 `docs/production-cutover-preflight.md`，最终切流前必须显式提供 `CUTOVER_EVIDENCE_FILE`、`ZEABUR_ENV_FILE`、`ZEABUR_RUNTIME_BASE_URL`，脚本串联敏感信息卫生、Gateway 上游、Gateway 双门禁、生产证据包 strict 审计和生产 readiness strict 审计 | 已完成 |
| 2026-06-24 | 阶段 4 生产切流最终预检 review | `node --check scripts/preflight-production-cutover.mjs`、缺少必需生产输入的预期失败检查、使用 example 证据/env 和本地 URL 的预期失败检查、运行手册审计、迁移产物索引审计、部署产物敏感信息卫生审计和默认总预检均通过；最终预检不会接入默认预检，避免没有真实生产输入时阻塞日常 review | 已完成 |
| 2026-06-24 | 阶段 4 运行手册审计覆盖最终预检 | 增强 `scripts/audit-zeabur-runbook.mjs`，把生产切流最终预检命令纳入运行手册必需片段，防止 `docs/zeabur-deployment-runbook.md` 后续遗漏 strict 总门禁入口 | 已完成 |
| 2026-06-24 | 阶段 4 运行手册审计覆盖最终预检 review | `node --check scripts/audit-zeabur-runbook.mjs`、运行手册审计、迁移产物索引审计和默认总预检均通过；运行手册审计当前检查 29 个关键片段、14 个 D1 导入 scope 和 11 个禁切路径 | 已完成 |
| 2026-06-24 | 阶段 4 敏感信息审计覆盖最终预检文档 | 增强 `scripts/audit-deploy-secret-hygiene.mjs` 和 `docs/deploy-secret-hygiene-audit.md`，把 `docs/production-cutover-preflight.md` 纳入部署敏感信息扫描范围 | 已完成 |
| 2026-06-24 | 阶段 4 敏感信息审计覆盖最终预检文档 review | `node --check scripts/audit-deploy-secret-hygiene.mjs`、部署产物敏感信息卫生审计、迁移产物索引审计和默认总预检均通过；敏感信息审计当前扫描 10 个部署相关文件、4 条忽略规则和 7 类敏感值模式 | 已完成 |
| 2026-06-24 | 阶段 4 真实部署文件 Git 跟踪防护 | 增强 `scripts/audit-deploy-secret-hygiene.mjs`，使用 `git ls-files` 确认 `deploy/zeabur.env` 和 `deploy/production-cutover-evidence.json` 没有被 Git 跟踪，避免忽略规则补晚后真实文件仍被提交 | 已完成 |
| 2026-06-24 | 阶段 4 真实部署文件 Git 跟踪防护 review | `node --check scripts/audit-deploy-secret-hygiene.mjs`、部署产物敏感信息卫生审计、`git ls-files -- deploy/zeabur.env deploy/production-cutover-evidence.json`、迁移产物索引审计和默认总预检均通过；敏感信息审计当前检查 2 个禁止跟踪文件且未发现已跟踪真实部署文件 | 已完成 |
| 2026-06-24 | 阶段 4 生产最终预检 example 输入拦截 | 增强 `scripts/preflight-production-cutover.mjs`，入口处直接拒绝 `CUTOVER_EVIDENCE_FILE` 或 `ZEABUR_ENV_FILE` 指向 `.example` 文件，避免最终切流预检使用模板文件进入较深审计步骤才失败 | 已完成 |
| 2026-06-24 | 阶段 4 生产最终预检 example 输入拦截 review | `node --check scripts/preflight-production-cutover.mjs`、缺少必需输入预期失败检查、`CUTOVER_EVIDENCE_FILE=deploy/production-cutover-evidence.example.json ZEABUR_ENV_FILE=deploy/zeabur.env.example` 预期失败检查、部署产物敏感信息卫生审计、迁移产物索引审计和默认总预检均通过；错误输出会明确提示必须指向真实非 example 文件 | 已完成 |
| 2026-06-24 | 阶段 4 生产最终预检远端 URL 前置校验 | 增强 `scripts/preflight-production-cutover.mjs` 和 `docs/production-cutover-preflight.md`，入口校验 `ZEABUR_RUNTIME_BASE_URL` 必须是 HTTPS 且不能指向 localhost、127.0.0.1、0.0.0.0 或 loopback，避免用本地 Gateway 冒烟冒充 Zeabur 远端验证 | 已完成 |
| 2026-06-24 | 阶段 4 生产最终预检远端 URL 前置校验 review | `node --check scripts/preflight-production-cutover.mjs`、缺少必需输入预期失败检查、使用非 example 文件路径和 `http://127.0.0.1:8080` 的本地 URL 预期失败检查、部署产物敏感信息卫生审计、迁移产物索引审计和默认总预检均通过 | 已完成 |
| 2026-06-24 | 阶段 4 生产最终预检漂移审计 | 新增 `scripts/audit-production-cutover-preflight.mjs`，静态校验最终预检脚本、预检文档和默认总预检，防止必需生产输入、`.example` 拦截、远端 HTTPS 校验、Gateway 双门禁、证据包 strict 或 readiness strict 步骤被后续改动移除 | 已完成 |
| 2026-06-24 | 阶段 4 生产最终预检漂移审计 review | `node --check scripts/audit-production-cutover-preflight.mjs`、最终预检漂移审计、运行手册审计、部署产物敏感信息卫生审计、迁移产物索引审计、缺输入/本地 URL 预期失败断言和默认总预检均通过；默认总预检已新增 `production cutover preflight audit` 步骤 | 已完成 |
| 2026-06-24 | 阶段 4 生产证据包切流审批一致性 | 增强 `scripts/audit-production-cutover-evidence.mjs`，任一模块只要 `gatewayCutoverApproved=true`，该模块必须已经没有 blocker；否则即使不是 strict 模式也会失败，避免证据未齐时提前批准 Gateway 切流 | 已完成 |
| 2026-06-24 | 阶段 4 生产证据包切流审批一致性 review | `node --check scripts/audit-production-cutover-evidence.mjs`、证据包模板审计、临时真实证据文件提前审批预期失败断言、默认 readiness、部署产物敏感信息卫生审计、迁移产物索引审计和默认总预检均通过；模板仍保持 `ok:true / ready:false` 日常语义 | 已完成 |
| 2026-06-24 | 阶段 4 生产证据包输入路径一致性 | 增强 `scripts/audit-production-cutover-evidence.mjs` 和 `scripts/preflight-production-cutover.mjs`，真实证据审计在传入 `ZEABUR_ENV_FILE` 或 `D1_EXPORT_SQL` 时会要求它们分别匹配证据包中的 `zeaburEnv.envFile` 与 `d1Export.file`，避免审计文件和证据记录不一致 | 已完成 |
| 2026-06-24 | 阶段 4 生产证据包输入路径一致性 review | `node --check` 覆盖生产证据包审计与最终预检，证据包模板审计、最终预检漂移审计、`ZEABUR_ENV_FILE` 路径不一致预期失败、`D1_EXPORT_SQL` 路径不一致预期失败、默认 readiness、部署产物敏感信息卫生审计、迁移产物索引审计和默认总预检均通过 | 已完成 |
| 2026-06-24 | 阶段 4 生产切流 guard 失败路径自动化 | 新增 `scripts/test-production-cutover-guards.mjs`，自动验证缺生产输入、example 输入、本地/非 HTTPS URL、证据未齐提前审批、`ZEABUR_ENV_FILE` 不一致和 `D1_EXPORT_SQL` 不一致 6 类失败路径，并接入默认总预检 | 已完成 |
| 2026-06-24 | 阶段 4 生产切流 guard 失败路径自动化 review | `node --check scripts/test-production-cutover-guards.mjs`、生产切流 guard 测试、最终预检漂移审计、迁移产物索引审计、部署产物敏感信息卫生审计和默认总预检均通过；总预检新增 `production cutover guards test` 步骤且临时文件已清理 | 已完成 |
| 2026-06-24 | 阶段 4 迁移产物索引覆盖生产切流收口记录 | 增强 `scripts/audit-migration-artifacts.mjs` 和 `docs/migration-artifact-audit.md`，把最终预检漂移审计、证据包切流审批一致性、证据包输入路径一致性和生产切流 guard 失败路径自动化纳入迁移计划关键记录检查 | 已完成 |
| 2026-06-24 | 阶段 4 迁移产物索引覆盖生产切流收口记录 review | `node --check scripts/audit-migration-artifacts.mjs`、迁移产物索引审计、生产切流 guard 测试和默认总预检均通过；迁移产物索引当前检查 48 个核心文件、18 个模块、60 个模块产物、19 个总预检引用和 16 条关键计划短语 | 已完成 |
| 2026-06-24 | 阶段 4 生产最终预检显式 D1 导出输入 | 增强 `scripts/preflight-production-cutover.mjs`，最终生产预检现在必须显式提供 `D1_EXPORT_SQL`，并传给生产证据包 strict 审计与证据包 `d1Export.file` 做一致性校验，避免只靠证据文件间接引用真实 D1 导出 | 已完成 |
| 2026-06-24 | 阶段 4 生产最终预检显式 D1 导出输入 review | `node --check` 覆盖最终预检、最终预检漂移审计、生产切流 guard 测试和运行手册审计；最终预检漂移审计、guard 测试、运行手册审计、缺少 `D1_EXPORT_SQL` 预期失败断言、部署产物敏感信息卫生审计、迁移产物索引审计、生产 readiness 和默认总预检均通过 | 已完成 |
| 2026-06-24 | 阶段 4 迁移产物索引覆盖 D1 最终预检记录 | 增强 `scripts/audit-migration-artifacts.mjs` 和 `docs/migration-artifact-audit.md`，把“生产最终预检显式 D1 导出输入”纳入迁移计划关键短语检查，防止最终切流必需输入要求被文档回退遗漏 | 已完成 |
| 2026-06-24 | 阶段 4 迁移产物索引覆盖 D1 最终预检记录 review | `node --check scripts/audit-migration-artifacts.mjs`、迁移产物索引审计、最终预检漂移审计、生产切流 guard 测试和默认总预检均通过；迁移产物索引继续覆盖 48 个核心文件、18 个模块、60 个模块产物和 19 个总预检引用 | 已完成 |
| 2026-06-24 | 阶段 4 运行手册显式覆盖生产切流 guard 测试 | 更新 `docs/zeabur-deployment-runbook.md` 和 `scripts/audit-zeabur-runbook.mjs`，把 `node scripts/test-production-cutover-guards.mjs` 加入 Zeabur 运行手册 Review 命令，并纳入运行手册必需片段检查 | 已完成 |
| 2026-06-24 | 阶段 4 运行手册显式覆盖生产切流 guard 测试 review | `node --check scripts/audit-zeabur-runbook.mjs`、运行手册审计、生产切流 guard 测试、迁移产物索引审计和默认总预检均通过；运行手册审计当前检查 31 个关键片段、14 个 D1 导入 scope 和 11 个禁切路径 | 已完成 |
| 2026-06-24 | 阶段 4 生产最终预检 D1 example 输入拦截文档化 | 更新 `docs/production-cutover-preflight.md`、`scripts/audit-production-cutover-preflight.mjs` 和 `scripts/test-production-cutover-guards.mjs`，明确 `D1_EXPORT_SQL` 也不能指向 `.example` 文件，并新增 D1 example 输入预期失败用例 | 已完成 |
| 2026-06-24 | 阶段 4 生产最终预检 D1 example 输入拦截文档化 review | `node --check` 覆盖最终预检漂移审计和生产切流 guard 测试；最终预检漂移审计、7 类生产切流 guard 失败路径测试、迁移产物索引审计、部署产物敏感信息卫生审计和默认总预检均通过；guard 测试新增 `example d1 export input` 场景 | 已完成 |
| 2026-06-24 | 阶段 4 生产切流 guard 覆盖漂移审计 | 增强 `scripts/audit-production-cutover-preflight.mjs`，除检查 guard 脚本被默认总预检调用外，还静态检查 7 个失败场景名称，防止缺输入、example、远端 URL、提前审批和路径不一致任一 guard 被后续删掉 | 已完成 |
| 2026-06-24 | 阶段 4 生产切流 guard 覆盖漂移审计 review | `node --check scripts/audit-production-cutover-preflight.mjs`、最终预检漂移审计、生产切流 guard 测试、迁移产物索引审计、部署产物敏感信息卫生审计和默认总预检均通过；漂移审计输出已包含 `checkedGuardTestSnippets: 7` | 已完成 |
| 2026-06-24 | 阶段 4 迁移产物索引覆盖本轮最终预检记录 | 增强 `scripts/audit-migration-artifacts.mjs` 和 `docs/migration-artifact-audit.md`，把 D1 example 输入拦截文档化与生产切流 guard 覆盖漂移审计纳入迁移计划关键短语检查 | 已完成 |
| 2026-06-24 | 阶段 4 迁移产物索引覆盖本轮最终预检记录 review | `node --check scripts/audit-migration-artifacts.mjs`、迁移产物索引审计、最终预检漂移审计、生产切流 guard 测试和默认总预检均通过；迁移产物索引继续覆盖 48 个核心文件、18 个模块、60 个模块产物和 19 个总预检引用 | 已完成 |
| 2026-06-24 | 阶段 4 运行手册同步生产切流 guard 场景 | 更新 `docs/zeabur-deployment-runbook.md` 和 `scripts/audit-zeabur-runbook.mjs`，在最终切流 strict 门禁旁明确 `test-production-cutover-guards.mjs` 必须覆盖 7 类失败路径，并纳入运行手册必需片段检查 | 已完成 |
| 2026-06-24 | 阶段 4 运行手册同步生产切流 guard 场景 review | `node --check scripts/audit-zeabur-runbook.mjs`、运行手册审计、生产切流 guard 测试、迁移产物索引审计和默认总预检均通过；运行手册审计当前检查 32 个关键片段、14 个 D1 导入 scope 和 11 个禁切路径 | 已完成 |
| 2026-06-24 | 阶段 4 生产 readiness 显式传递证据输入 | 增强 `scripts/preflight-production-cutover.mjs` 和 `scripts/audit-production-cutover-readiness.mjs`，最终预检会显式把 `D1_EXPORT_SQL` 传给 readiness strict，readiness 在调用证据包审计时也会显式传入 `D1_EXPORT_SQL` 与 `ZEABUR_ENV_FILE`，确保证据包路径一致性校验不依赖隐式环境继承 | 已完成 |
| 2026-06-24 | 阶段 4 生产 readiness 显式传递证据输入 review | `node --check` 覆盖最终预检、生产 readiness 与最终预检漂移审计；默认 readiness、生产切流 guard 测试、临时真实证据文件 D1 路径不一致预期失败、迁移产物索引审计、部署产物敏感信息卫生审计和默认总预检均通过 | 已完成 |
| 2026-06-24 | 阶段 4 生产 readiness 证据路径一致性自动 guard | 扩展 `scripts/test-production-cutover-guards.mjs`、最终预检文档和运行手册，将 readiness 合并证据包审计时的 `D1_EXPORT_SQL` 路径不一致纳入失败路径，guard 场景从 7 类增加到 8 类 | 已完成 |
| 2026-06-24 | 阶段 4 生产 readiness 证据路径一致性自动 guard review | `node --check` 覆盖生产切流 guard 测试、最终预检漂移审计和运行手册审计；生产切流 guard 测试、最终预检漂移审计、运行手册审计、迁移产物索引审计、部署产物敏感信息卫生审计和默认总预检均通过；guard 输出 `checkedFailureCases: 8` | 已完成 |
| 2026-06-24 | 阶段 4 迁移产物索引覆盖 readiness 收口记录 | 增强 `scripts/audit-migration-artifacts.mjs` 和 `docs/migration-artifact-audit.md`，把“生产 readiness 显式传递证据输入”和“生产 readiness 证据路径一致性自动 guard”纳入迁移计划关键短语检查 | 已完成 |
| 2026-06-24 | 阶段 4 迁移产物索引覆盖 readiness 收口记录 review | `node --check scripts/audit-migration-artifacts.mjs`、迁移产物索引审计、最终预检漂移审计、生产切流 guard 测试和默认总预检均通过；迁移产物索引继续覆盖 48 个核心文件、18 个模块、60 个模块产物和 19 个总预检引用 | 已完成 |
| 2026-06-24 | 阶段 5 反馈墙数据迁移基础 | 新增 `0018_feedback.sql`、`internal/migration/d1/feedback_importer.go`、`migrate-d1 -apply -scope feedback`、`scripts/audit-feedback-cutover.mjs` 和 `docs/feedback-cutover-preflight.md`，把旧 `feedback:item:*`、`feedback:messages:*`、`feedback:likes:*` 导入 PostgreSQL 反馈主体、留言和点赞表；暂不切 `/api/feedback*` 或 `/api/admin/feedback*` | 已完成 |
| 2026-06-24 | 阶段 5 反馈墙数据迁移基础 review | `go test ./...`、`go test ./internal/migration/d1 -run "Feedback\|Analyze" -count=1`、反馈墙 cutover 前置审计、D1 scope 审计、Zeabur 运行手册审计、迁移产物索引审计和默认总预检均通过；本地 Docker API 镜像已重建并执行 `/app/migrate` 应用 `0018_feedback.sql`；审计输出明确 `status:data-import-foundation-only`，Go HTTP handler、图片存储迁移、真实导入和页面冒烟仍待后续小块 | 已完成 |
| 2026-06-24 | 阶段 1-4 总体 review | 新增 `docs/stage-1-4-review.md`，复核阶段 1-4 的 Gateway 精确切流、禁切清单、生产 readiness、PostgreSQL migration 和后续接新 PR 的 Go 迁移处理规则 | 已完成 |
| 2026-06-24 | 阶段 1-4 总体 review 验证 | `node scripts/audit-gateway-allowed-cutovers.mjs`、Gateway 禁切守卫、生产 readiness、PostgreSQL migration 审计和反馈墙迁移前置审计均通过；当前 49 条精确 Go 转发仍受允许清单管理，生产 readiness 仍因真实 D1、真实 Cookie、New API 配置和 Zeabur 远端证据缺失保持 `ready:false` | 已完成 |
| 2026-06-24 | 阶段 5 反馈墙只读 Go API | 新增 `internal/feedback` 只读聚合服务和 4 个 Go 内部 HTTP 路由：`GET /api/feedback`、`GET /api/feedback/{id}`、`GET /api/admin/feedback`、`GET /api/admin/feedback/{id}`；覆盖公开墙、我的反馈、后台列表、详情、匿名可见性、联系方式权限、点赞数、本人点赞状态、首条留言、最近管理员回复和回复数；暂不切 `/api/feedback*` 或 `/api/admin/feedback*` Gateway | 已完成 |
| 2026-06-24 | 阶段 5 反馈墙只读 Go API review | `TEST_DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go test -tags integration ./internal/httpserver -run Feedback -count=1`、`node --check scripts/audit-feedback-cutover.mjs`、`node scripts/audit-feedback-cutover.mjs` 和 `go test ./...` 均通过；真实 Docker PostgreSQL 集成测试确认只读路由不是跳过式通过，审计仍输出剩余 blocker：写路径、图片存储、真实 D1 导入和页面级冒烟 | 已完成 |
| 2026-06-24 | 阶段 5 反馈墙文本写路径 Go API | 接入 `POST /api/feedback/{id}/messages`、`POST /api/feedback/{id}/like`、`PATCH /api/admin/feedback/{id}`、`POST /api/admin/feedback/{id}/messages` 的 Go 内部路由；用户留言、点赞切换、后台回复和后台状态更新均写 PostgreSQL，留言/状态变化会同步写 `feedback_reply` 与 `feedback_status` 通知；带附件留言暂时显式拦截，避免图片存储未迁移时产生半迁移数据 | 已完成 |
| 2026-06-24 | 阶段 5 反馈墙文本写路径 Go API review | `TEST_DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go test -tags integration ./internal/httpserver -run Feedback -count=1`、`node --check scripts/audit-feedback-cutover.mjs`、`node scripts/audit-feedback-cutover.mjs` 和 `go test ./...` 均通过；审计输出 `status:text-write-handlers-ready`，Gateway 仍无 feedback 规则，剩余 blocker 为图片/附件存储、`POST /api/feedback` 新建反馈、真实 D1 导入和页面级冒烟 | 已完成 |
| 2026-06-24 | 阶段 5 反馈墙文本新建反馈 Go API | 接入 `POST /api/feedback` Go 内部路由；文本新建反馈会写入 `feedback_items` 和第一条 `feedback_messages`，返回 `feedback` 与 `firstMessage`，并沿用标题、内容、联系方式长度限制；带附件新建反馈仍显式拦截，等待 Zeabur 可用对象存储方案 | 已完成 |
| 2026-06-24 | 阶段 5 反馈墙文本新建反馈 Go API review | 真实 Docker PostgreSQL 集成测试覆盖文本新建反馈和附件新建反馈阻断；`node --check scripts/audit-feedback-cutover.mjs`、反馈墙 cutover 审计、`go test ./internal/feedback ./internal/httpserver`、`go test ./...`、迁移产物索引审计和默认 Zeabur Go API 总预检均通过；审计输出 `status:text-feedback-api-ready`，Gateway 仍无 feedback 规则，剩余 blocker 为图片/附件存储、真实 D1 导入和页面级冒烟 | 已完成 |
| 2026-06-24 | 阶段 5 反馈墙本地附件存储 | 新增 `internal/feedback/media.go` 本地媒体存储，支持 PNG/JPG/WEBP/GIF 与 MP4/WEBM/MOV，沿用最多 4 个附件、图片 2MB、视频 20MB 限制；`POST /api/feedback` 与 `/messages` 可把 data URL 写入 `FEEDBACK_MEDIA_DIR`，并返回 `/api/feedback/images/feedback/...` 或 `FEEDBACK_MEDIA_PUBLIC_URL` URL；新增 `GET/HEAD /api/feedback/images/*` 读取路由 | 已完成 |
| 2026-06-24 | 阶段 5 反馈墙本地附件存储 review | `go test ./internal/feedback ./internal/httpserver` 和真实 Docker PostgreSQL feedback integration 均通过，集成测试覆盖附件新建反馈、落盘 URL、图片读取状态码、Content-Type 与 body 长度；`compose.yml` 新增 `feedback-media-data` 卷，`deploy/zeabur.env.example` 与运行手册新增 `FEEDBACK_MEDIA_DIR` / `FEEDBACK_MEDIA_PUBLIC_URL`；Gateway 仍无 feedback 规则，生产切流前仍需真实 D1 导入和页面级冒烟 | 已完成 |
| 2026-06-24 | 阶段 5 反馈墙 Docker 直连冒烟门禁 | 新增 `scripts/smoke-feedback-go-api.mjs`，直连本地 Docker Go API 容器和 PostgreSQL，自动种 smoke 用户，覆盖未登录 401、反馈新建、公开墙列表、详情、点赞、用户评论、管理员回复、管理员状态更新，并校验 `feedback_items`、`feedback_messages`、`feedback_likes` 与 `notifications` 写入结果和清理结果 | 已完成 |
| 2026-06-24 | 阶段 5 反馈墙 Docker 直连冒烟门禁 review | 重建本地 API 容器后 `node scripts/smoke-feedback-go-api.mjs` 通过，输出 `checkedPaths` 8 个反馈墙核心路径、`messages:3`、`likes:1`、`replyNotifications:2`、`statusNotifications:2`、清理后 smoke 用户/反馈/通知均为 0；脚本已接入默认 `scripts/preflight-zeabur-go-api.mjs`、迁移产物索引和反馈墙 cutover 审计；Gateway 仍无 feedback 规则 | 已完成 |
| 2026-06-24 | 部署策略调整 | 生产主线改为 fresh Zeabur 新部署，不再要求 Cloudflare D1 导出；`migrate-d1` 保留为可选归档迁移工具，生产证据包、readiness、最终预检和运行手册改为检查新库 migration、种子/默认数据、真实登录态 API 冒烟与页面级冒烟 | 已完成 |
| 2026-06-24 | PR #9 2048 Go 迁移：规则引擎 | 新增 `backend/internal/game2048` 纯规则引擎，覆盖 5x5 2048 种子刷块、移动合并、服务端重放、胜负/死局判断和积分奖励；新增 `docs/game-2048-cutover-preflight.md` 与 `scripts/audit-game-2048-cutover.mjs`，当前状态明确为 `engine-only`，禁止 `/api/games/2048*` Gateway 切流 | 已完成 |
| 2026-06-24 | PR #9 2048 Go 迁移：内部 API | 新增 2048 PostgreSQL 服务层和 Go 内部 HTTP handler，注册 `GET /api/games/2048/status`、`POST /api/games/2048/start`、`POST /api/games/2048/checkpoint`、`POST /api/games/2048/submit`、`POST /api/games/2048/cancel`；真实 PostgreSQL integration 覆盖 checkpoint、submit、重复 submit 回放和积分只发一次；状态提升为 `internal-api-ready`，Gateway 仍禁止 `/api/games/2048*` | 已完成 |
| 2026-06-24 | PR #9 2048 Go 迁移：Docker 直连冒烟门禁 | 新增 `scripts/smoke-game-2048-go-api.mjs` 并接入默认 Zeabur Go API 预检；本地 API 容器重建后 smoke 通过，覆盖未登录、status/start/checkpoint/submit/cancel、重复提交回放、96 积分只发一次、PostgreSQL 记录核对和清理零残留；状态提升为 `docker-smoke-ready`，Gateway 仍无 `/api/games/2048` 规则 | 已完成 |
| 2026-06-24 | PR #9 后台反馈删除 Go 迁移 | 接入 `DELETE /api/admin/feedback/{id}` Go 内部路由，PostgreSQL 侧硬删除反馈主体并级联删除留言和点赞；更新 feedback integration、Docker 直连 smoke、反馈 cutover 审计和文档，Gateway 仍无 `/api/feedback*` 或 `/api/admin/feedback*` 规则 | 已完成 |
| 2026-06-24 | PR #9 后台环保管理 Go 迁移 | 接入 `GET/PATCH /api/admin/eco` Go 内部路由，新增 `eco_prize_rate_settings` 保存奖品概率配置；后台概览从 PostgreSQL 聚合奖品持有人、偷盗记录和近 7 天环保回收量；在线奖品生成与状态返回读取当前概率；新增 admin eco 审计、Docker 直连 smoke 和前置文档，Gateway 仍禁止 `/api/admin/eco` 与 `/api/admin/*` 通配 | 已完成 |
| 2026-06-24 | PR #9 后台积分管理 Go 迁移 | 接入 `GET/POST /api/admin/points` Go 内部路由；GET 返回目标用户积分余额、分页流水和分页信息，POST 支持管理员加减积分、单次 100 万上限、说明写入管理员前缀和积分不足业务失败；新增 admin points 审计、Docker 直连 smoke 和前置文档，Gateway 仍禁止 `/api/admin/points` 与 `/api/admin/*` 通配 | 已完成 |
| 2026-06-24 | PR #9 后台用户管理 Go 迁移 | 接入 `GET /api/admin/users`、`GET /api/admin/users/{id}`、`POST /api/admin/users/{id}/achievements` Go 内部路由；后台用户列表支持分页搜索和统计，详情聚合 Go 侧兑换记录、抽奖参与记录和成就状态，成就写路径仅允许管理员颁发/撤销 `contributor`；新增 admin users 审计、Docker 直连 smoke 和前置文档，Gateway 仍禁止 `/api/admin/users*` 与 `/api/admin/*` 通配 | 已完成 |
| 2026-06-24 | PR #9 后台仪表盘 Go 迁移 | 接入 `GET /api/admin/dashboard` Go 内部只读路由；用户活跃、兑换量、抽奖次数、积分流转和游戏参与率均从 PostgreSQL 聚合，告警存储和异常检测写路径暂不伪迁移，`detect=1` 返回扫描用户数与 0 触发告警；新增 admin dashboard 审计、Docker 直连 smoke 和前置文档，Gateway 仍禁止 `/api/admin/dashboard` 与 `/api/admin/*` 通配 | 已完成 |
| 2026-06-24 | PR #9 后台项目管理 Go 迁移 | 接入 `GET/POST /api/admin/projects`、`GET/PATCH/DELETE/POST /api/admin/projects/{id}` Go 内部路由；后台项目列表、直充积分项目创建、详情记录、状态/置顶/名额更新、删除和追加名额均写 PostgreSQL，历史 code 项目保持只读追加保护；新增 admin projects 审计、Docker 直连 smoke 和前置文档，Gateway 仍禁止 `/api/admin/projects*` 与 `/api/admin/*` 通配 | 已完成 |
| 2026-06-24 | PR #9 部署测试精确切流 | Gateway 精确打开 `/api/games/2048/status/start/checkpoint/submit/cancel`、`/api/admin/eco`、`/api/admin/points`、`/api/admin/users{,/*}`、`/api/admin/dashboard`、`/api/admin/projects{,/*}`、`/api/admin/feedback{,/*}`；同步允许清单、模块审计和 smoke 门禁，继续禁止 `/api/admin/*`、`/api/games/*`、`/api/projects/*`、公开 `/api/feedback*` 通配 | 已完成 |
| 2026-06-25 | 阶段 5 A1 个人主页与资料 Gateway 精确切流 | 按第 14 节 A1 打开 `GET /api/profile/overview`、`GET/PUT /api/profile/settings`、`PUT /api/profile/achievements/equip` 三个精确 Gateway 规则；同步 profile cutover 审计、Gateway 禁切守卫、Gateway 允许清单、profile smoke 和预检文档，仍禁止 `/api/profile*` 通配 | 已完成 |
| 2026-06-25 | 阶段 5 A1 个人主页与资料 review | `npm run audit:profile-cutover`、Gateway 禁切守卫、Gateway 允许清单、`go test ./internal/profile ./internal/httpserver`、`docker compose config --quiet`、`node scripts/smoke-profile-go-api.mjs`、`node scripts/smoke-profile-write-go-api.mjs` 均通过；写路径 smoke 覆盖资料更新、成就佩戴、overview 回读、PostgreSQL 验证和清理零残留；Zeabur 重新部署新镜像后 `/profile` 应不再落回旧 Next/KV | 已完成 |
| 2026-06-25 | 阶段 5 PR #9 补接清单 | 新增 `docs/pr-9-go-reconciliation.md`，确认 PR #9 仍为 open、不能直接 merge 到当前 Go/Zeabur 主线；按后台页面、API/运行时、游戏业务库和组件拆出补接清单，要求每块按 Go/PostgreSQL/Redis 路线移植并单独 review | 已完成 |
| 2026-06-25 | 阶段 5 A2 通知中心 Gateway 精确切流 | 按第 14 节 A2 打开 `GET /api/notifications`、`GET /api/notifications/unread-count`、`POST /api/notifications/read`、`POST /api/notifications/delete`、`POST /api/notifications/claim` 五个精确 Gateway 规则；同步通知 cutover 审计、Gateway 禁切守卫、Gateway 允许清单、通知 smoke 和预检文档，仍禁止 `/api/notifications*` 通配 | 已完成 |
| 2026-06-25 | 阶段 5 A2 通知中心 review | `npm run audit:notifications-cutover`、Gateway 禁切守卫、Gateway 允许清单、`go test ./internal/notifications ./internal/rewards ./internal/httpserver`、`docker compose config --quiet`、`node scripts/smoke-notifications-go-api.mjs`、`node scripts/smoke-notifications-write-go-api.mjs` 均通过；写路径 smoke 覆盖列表、未读数、标记已读、删除已读、points 奖励领取、重复领取幂等、PostgreSQL 验证和清理零残留；Zeabur 重新部署新镜像后通知中心不再落回旧 Next/KV | 已完成 |
| 2026-06-25 | 阶段 5 A3 反馈墙公开路径 Gateway 精确切流 | 按第 14 节 A3 打开 `/api/feedback` 与 `/api/feedback/*` 到 Go，覆盖公开墙列表、新建、详情、留言、点赞和附件读取；后台 `/api/admin/feedback{,/*}` 保持已切流；同步 feedback cutover 审计、Gateway 允许清单、反馈 smoke 和预检文档 | 已完成 |
| 2026-06-25 | 阶段 5 A3 反馈墙公开路径 review | `node scripts/audit-feedback-cutover.mjs`、Gateway 禁切守卫、Gateway 允许清单、`go test ./internal/feedback ./internal/httpserver -run Feedback -count=1`、`docker compose config --quiet`、`node scripts/smoke-feedback-go-api.mjs` 均通过；smoke 覆盖公开反馈新建、公开墙列表、详情、点赞、用户评论、后台回复、后台状态更新、后台删除、PostgreSQL 验证和清理零残留；Zeabur 附件持久化仍需确认 `/data/feedback-media` 卷挂载 | 已完成 |
| 2026-06-25 | 阶段 5 登录态用户同步修复 | 新增 Go `GET /api/auth/me` 精确切流，接口解析现有 `app_session`/`session` cookie 后 upsert `users` 与 `point_accounts`；Next 登录成功后调用 Go 内部 `/api/auth/me` 同步新用户，修复新用户登录后后台用户管理查不到、2048 等 Go 游戏无法稳定识别新账号的问题 | 已完成 |
| 2026-06-25 | 阶段 5 登录态用户同步 review | `go test ./internal/httpserver`、`TEST_DATABASE_URL=... go test -tags=integration ./internal/httpserver -run TestAuthMeSyncsAuthenticatedUserToPostgres -count=1`、`node scripts/smoke-auth-me-go-api.mjs` 均通过；Docker smoke 覆盖未登录 401、登录 200、首次创建 `users`/`point_accounts`、二次更新展示名和清理零残留；总预检已接入 auth/me 同步冒烟 | 已完成 |
| 2026-06-25 | 阶段 5 登录同步生产回归修复 | 根据 Zeabur 实测反馈，“朋友能登录但 2048 不能玩、后台用户管理看不到该账号”说明 best-effort 同步会掩盖 Go/PostgreSQL 写入失败；已改为配置了 Go 内部地址时同步失败直接返回 503，并在日志中输出内部同步 URL、HTTP 状态和响应片段，避免继续产生只存在于 Next session、未进入 Go 数据源的半登录用户 | 已完成 |
| 2026-06-25 | 阶段 5 登录同步生产回归 review | `go test ./internal/auth ./internal/httpserver ./internal/game2048 ./internal/adminusers`、`npx tsc --noEmit --pretty false`、`node --check scripts/smoke-auth-me-go-api.mjs`、`node scripts/smoke-auth-me-go-api.mjs` 均通过；Docker smoke 再次确认新登录态用户会写入 `users` 和 `point_accounts`，后台用户管理与 2048 共用该数据源 | 已完成 |
| 2026-06-25 | 阶段 5 B1 登出与 session revocation | Go 端 `auth.User` 保留 `iat/exp/jti`，`requireUser` 统一检查 Redis `auth:session:blacklist:{jti}` 与 `auth:session:revoked-after:{userId}`；新增 `POST /api/auth/logout`，通过同源校验后写 Redis 黑名单并清理 `app_session`、`session`、`new_api_session`，Gateway 只精确打开 `/api/auth/logout`，仍不切 `/api/auth/login` 或 `/api/auth*` 通配 | 已完成 |
| 2026-06-25 | 阶段 5 B1 登出与 session revocation review | `go test ./internal/auth ./internal/httpserver ./internal/game2048 ./internal/adminusers`、`TEST_REDIS_URL=redis://127.0.0.1:6379/0 go test -tags=integration ./internal/httpserver -run TestLogoutRevokesSessionInRedis -count=1`、Gateway 双门禁、`npx tsc --noEmit --pretty false`、Docker Caddy validate、`node scripts/smoke-auth-me-go-api.mjs`、`node scripts/smoke-auth-logout-go-api.mjs` 均通过；logout smoke 覆盖旧 cookie 登出后再访问 `/api/auth/me` 返回 401 | 已完成 |
| 2026-06-25 | 阶段 5 本地 Compose web 目标修复 | 根目录 `Dockerfile` 保持 Zeabur 单容器最终产物，同时新增 `web-runtime` 构建阶段；`compose.yml` 的 `web` 服务改为构建该阶段，只启动 Next，避免多服务 Compose 中误启动单容器的 Go API/Worker/Caddy 并因缺少 `DATABASE_URL` 退出 | 已完成 |
| 2026-06-25 | 阶段 5 本地 Compose web 目标 review | `node scripts/audit-compose-topology.mjs`、`node scripts/audit-dockerfiles.mjs`、`docker compose config --quiet`、`docker compose up -d --build web gateway`、强制重建 gateway 端口绑定、`http://127.0.0.1:8080/healthz`、`node scripts/smoke-zeabur-runtime.mjs` 均通过；本地 `api`、`web`、`gateway`、PostgreSQL、Redis 已恢复运行 | 已完成 |
| 2026-06-25 | 阶段 5 A4 卡牌前台与后台 Gateway 精确切流 | 按第 14 节 A4 打开 `/api/cards/inventory`、`/api/cards/rules`、`/api/cards/draw`、`/api/cards/exchange`、`/api/cards/claim-reward` 与后台 `/api/admin/cards/users`、`/api/admin/cards/user/*`、`/api/admin/cards/reset`、`/api/admin/cards/albums`、`/api/admin/cards/rules`；继续禁止 `/api/cards*` 和 `/api/admin/cards*` 通配 | 已完成 |
| 2026-06-25 | 阶段 5 A4 卡牌前台与后台 review | `node scripts/audit-cards-cutover.mjs`、`node scripts/audit-admin-cards-cutover.mjs`、Gateway 双门禁、`go test ./internal/cards ./internal/httpserver ./internal/game2048 ./internal/adminusers`、`npx tsc --noEmit --pretty false`、`node scripts/smoke-cards-go-api.mjs`、`node scripts/smoke-cards-write-go-api.mjs`、`node scripts/smoke-admin-cards-go-api.mjs`、`node scripts/smoke-admin-cards-write-go-api.mjs` 均通过；写路径 smoke 覆盖抽卡、碎片兑换、领奖、后台重置、后台奖励配置、后台规则更新、PostgreSQL 验证和清理零残留 | 已完成 |
| 2026-06-25 | 阶段 5 A5 农场全路径 Gateway 精确切流 | 按第 14 节 A5 打开当前前端使用的 19 条 `/api/farm` 精确路径，覆盖 status、种植、浇水、收获、清除、买地、商店、种子、宠物和偷菜；同步农场 cutover 审计、Gateway 允许清单、Gateway 禁切守卫和农场预检文档，继续禁止 `/api/farm` 根路径、`/api/farm*` 和 `/api/farm/*` 通配 | 已完成 |
| 2026-06-25 | 阶段 5 A5 农场全路径 review | `node scripts/audit-farm-status-cutover.mjs`、Gateway 双门禁、`go test ./internal/farm ./internal/httpserver`、`TEST_DATABASE_URL=... go test -tags=integration ./internal/httpserver -run Farm -count=1`、`docker compose config --quiet`、`node scripts/smoke-farm-go-api.mjs`、`node scripts/smoke-farm-write-go-api.mjs`、Docker Caddy `validate` 均通过；写路径 smoke 覆盖状态、买种子、种植、浇水、收获、买/用道具、宠物、偷菜、PostgreSQL 验证和清理零残留 | 已完成 |
| 2026-06-25 | 阶段 5 A6 钱包充值与提现本地 review | `node scripts/audit-wallet-cutover.mjs`、`node scripts/smoke-wallet-go-api.mjs`、`node scripts/smoke-wallet-write-missing-newapi-go-api.mjs`、`go test ./internal/economy ./internal/httpserver` 均通过；缺少 `NEW_API_URL`、`NEW_API_ADMIN_ACCESS_TOKEN`、`NEW_API_ADMIN_USER_ID` 的本地环境下，认证余额/充值/提现均返回 `NEW_API_NOT_CONFIGURED`，且不写 `wallet_transactions`、不写积分流水、不改变余额；A6 Gateway 切流等待 Zeabur 配置真实 new-api 后再做登录态只读余额、小额充值和小额提现冒烟 | 待外部配置 |
| 2026-06-25 | 阶段 5 B1 登录内部 Go API | 新增 Go `POST /api/auth/login` 内部实现：同源校验、Redis 登录失败计数与限流、调用 `NEW_API_URL /api/user/login`、生成兼容 `app_session`/`session` 的 HMAC 会话 token、同步 `users` 与 `point_accounts`，并设置 `new_api_session`；Gateway 仍未切 `/api/auth/login` | 内部完成 |
| 2026-06-25 | 阶段 5 B1 登录内部 Go API review | `go test ./internal/auth ./internal/platform/newapi ./internal/httpserver ./internal/game2048 ./internal/adminusers`、`TEST_DATABASE_URL=... TEST_REDIS_URL=... go test -tags=integration ./internal/httpserver -run 'TestAuthLoginCreatesSessionAndSyncsUser|TestLogoutRevokesSessionInRedis' -count=1`、Gateway 双门禁、`node --check scripts/smoke-auth-login-go-api.mjs`、`node scripts/smoke-auth-login-go-api.mjs` 均通过；smoke 使用 fake new-api 验证登录成功后 PostgreSQL 创建用户和积分账户，修复新用户只存在旧会话、不进入后台用户管理与 2048 数据源的问题；本轮还修复 Windows 下 smoke 结束后临时 `go run` 子进程残留导致超时的问题 | 已完成 |
| 2026-06-25 | 阶段 5 B1 登录 Gateway 精确切流 | Gateway 新增 `handle /api/auth/login` 到 Go API，认证三条核心路径变为 `login/me/logout` 精确切流；同步 Gateway 允许清单、禁切守卫摘要、auth 三个 smoke 的规则预期，并把 `scripts/smoke-auth-login-go-api.mjs` 加入默认 Zeabur 总预检 | 已完成 |
| 2026-06-25 | 阶段 5 B1 登录 Gateway 精确切流 review | `node --check` 覆盖 auth 三个 smoke 与总预检、Gateway 双门禁、`go test ./internal/auth ./internal/platform/newapi ./internal/httpserver ./internal/game2048 ./internal/adminusers`、真实 PostgreSQL/Redis auth integration、`node scripts/smoke-auth-login-go-api.mjs`、`node scripts/smoke-auth-me-go-api.mjs`、`node scripts/smoke-auth-logout-go-api.mjs`、`docker compose up -d --build gateway`、Caddy validate、`node scripts/smoke-zeabur-runtime.mjs` 均通过；本地 gateway `POST /api/auth/login` 探针返回 Go 的 `new-api 登录服务未配置` 503，确认已落到 Go 而不是旧 Next；生产重新构建 GHCR 镜像并配置 `NEW_API_URL` 后，新用户登录会直接写入 PostgreSQL，后台用户管理与 2048 读取同一用户源 | 已完成 |
| 2026-06-25 | 阶段 5 B1 登录新用户资产同步补强 | 根据 Zeabur 测试反馈“朋友能登录但后台用户管理没有账号、2048 玩不了”，将 Go 登录和 `/api/auth/me` 同步用户扩展为同时 upsert `users`、`point_accounts` 与 `user_assets`，避免新用户缺基础资产行导致后续资料、卡牌、签到等链路分叉 | 已完成 |
| 2026-06-25 | 阶段 5 B1 登录新用户资产同步 review | `go test ./internal/httpserver -run 'Auth|AdminUser|Game2048|Checkin' -count=1`、`go test ./internal/checkin -count=1`、真实 PostgreSQL/Redis auth 与 2048 integration、`node --check scripts/smoke-auth-login-go-api.mjs`、`node scripts/smoke-auth-login-go-api.mjs` 均通过；auth/login smoke 已验证 `users=1`、`accounts=1`、`assets=1`，该修复需要重新构建并部署 GHCR 镜像后才会在 Zeabur 生效 | 已完成 |
| 2026-06-25 | 阶段 5 B2 签到 Go 迁移与 Gateway 精确切流 | 新增 PostgreSQL `checkin_records`、Go `internal/checkin` 服务和 `GET/POST /api/checkin`、`POST /api/checkin/makeup` handler；Gateway 精确打开 `/api/checkin` 与 `/api/checkin/makeup`，同步允许清单、禁切守卫、`scripts/audit-checkin-cutover.mjs`、`scripts/smoke-checkin-go-api.mjs`、`docs/checkin-cutover-preflight.md` 和 Zeabur 总预检 | 已完成 |
| 2026-06-25 | 阶段 5 B2 签到 review | `node --check` 覆盖签到 audit/smoke/总预检、`node scripts/audit-checkin-cutover.mjs`、Gateway 双门禁、`go test ./internal/checkin ./internal/httpserver -run Checkin -count=1`、真实 PostgreSQL checkin integration、Docker API/Gateway build、容器内 `/app/migrate`、Caddy validate、`/readyz`、`node scripts/smoke-checkin-go-api.mjs` 均通过；smoke 覆盖未登录边界、每日签到、重复签到 400、补签成功、PostgreSQL `checkin_records`/`point_ledger`/`user_assets` 验证和清理零残留；review 期间修复补签成功时 `makeupCards=0` 被 `omitempty` 省略的兼容问题 | 已完成 |
| 2026-06-25 | 阶段 5 B3 公告 Go 迁移与 Gateway 精确切流 | 新增 PostgreSQL `announcements` 与 `announcement_notifications`、Go `internal/announcements` 服务和 `GET /api/announcements`、`GET/POST /api/admin/announcements`、`PATCH/DELETE /api/admin/announcements/{id}` handler；发布时 fanout 写入 `notifications`，通过 `(announcement_id,user_id)` 保证重复发布不重复通知；Gateway 精确打开公告 3 条规则，继续禁止 `/api/announcements*` 公开通配和完整 `/api/admin/*` 通配 | 已完成 |
| 2026-06-25 | 阶段 5 B3 公告 review | `go test ./internal/announcements ./internal/httpserver -run Announcement -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/announcements -run Announcement -count=1`、`node --check` 覆盖公告 audit/smoke/总预检、`node scripts/audit-announcements-cutover.mjs`、Gateway 双门禁、Docker API/Gateway build、容器内 `/app/migrate`、Caddy validate、`/readyz`、`node scripts/smoke-announcements-go-api.mjs` 均通过；smoke 覆盖未登录、非管理员 403、创建草稿、后台列表、发布 fanout、重复发布幂等、公开列表、归档和 PostgreSQL 清理零残留；Zeabur 重新部署新镜像后首页公告与后台公告管理不再落回旧 Next/KV | 已完成 |
| 2026-06-25 | 阶段 5 B4-0 彩票与数字炸弹切流审计 | 新增 `docs/lottery-cutover-preflight.md` 与 `scripts/audit-lottery-cutover.mjs`，确认当前前台彩票路径为 `/api/lottery`、`/api/lottery/spin`、`/api/lottery/number-bomb{,/bet,/cancel}`，后台页面路径为 `/api/admin/lottery`、`/api/admin/lottery/config`、`/api/admin/lottery/number-bomb`，排行榜依赖 `/api/rankings/lottery`；Gateway 禁切守卫新增 `/api/lottery*` 和 `/api/admin/lottery*`，总预检纳入彩票禁切审计 | 已完成 |
| 2026-06-25 | 阶段 5 B4-0 review | `node --check scripts/audit-lottery-cutover.mjs`、`node scripts/audit-lottery-cutover.mjs`、Gateway 双门禁、`node --check scripts/preflight-zeabur-go-api.mjs` 均通过；审计确认旧实现仍依赖 `lottery:config`、`lottery:records`、`lottery:user:records:*`、`lottery:daily_spin:*`、`number-bomb:draw:*`、`number-bomb:bet:*`、`number-bomb:settlement:*`，因此彩票/数字炸弹仍未切 Gateway；下一小块 B4-1 建 PostgreSQL 表并先迁 `GET /api/lottery` 与 `GET /api/admin/lottery` 只读 | 已完成 |
| 2026-06-25 | 阶段 5 B4-1 彩票基础表与 Go 只读接口 | 新增 `0022_lottery.sql`、Go `internal/lottery` 服务和 `GET /api/lottery`、`GET /api/admin/lottery` 内部 handler；前台只读返回旧页面需要的用户、记录、配置、档位、每日次数、额外次数和可抽状态，后台只读返回配置、档位库存、概率映射、统计、记录和分页；暂不注册 `spin`、后台配置、数字炸弹或排行榜写/聚合路径，Gateway 彩票规则继续关闭 | 已完成 |
| 2026-06-25 | 阶段 5 B4-1 review | `go test ./internal/lottery ./internal/httpserver -run Lottery -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/lottery -run TestServiceBuildsPageAndAdminSnapshot -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/httpserver -run Lottery -count=1`、`node scripts/audit-lottery-cutover.mjs` 均通过；审计状态提升为 `read-only-internal-ready-not-cutover`，仍强制禁止 `/api/lottery*` 与 `/api/admin/lottery*` Gateway 切流 | 已完成 |
| 2026-06-25 | 阶段 5 B4-2 转盘抽奖写路径 | 新增 `POST /api/lottery/spin` Go 内部 handler 和 `internal/lottery.SpinPoints` 事务服务；points 模式会同步用户基础表，锁定每日次数与额外次数，发放积分，写 `point_ledger`、`lottery_records`、`game_records` 和 `lottery_win` 通知；`pts_0` 谢谢惠顾只写业务记录、游戏记录和通知，不写积分流水；非 points 模式明确拒绝，避免半迁移 | 已完成 |
| 2026-06-25 | 阶段 5 B4-2 review | `go test ./internal/lottery ./internal/httpserver -run Lottery -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/lottery -run 'TestServiceBuildsPageAndAdminSnapshot|TestServiceSpinPoints' -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/httpserver -run Lottery -count=1`、`node --check scripts/audit-lottery-cutover.mjs`、`node scripts/audit-lottery-cutover.mjs`、Gateway 双门禁和 PostgreSQL migration 审计均通过；测试覆盖未登录、跨站、无 DB、points 模式成功抽奖、重复超过每日限制、额外次数消耗、免费次数占用、余额/流水/记录/通知/游戏记录落库和 `pts_0` 零积分记录；Gateway 彩票规则仍保持关闭，下一小块继续 B4-3 后台配置或 B4-4 数字炸弹 | 已完成 |
| 2026-06-25 | 阶段 5 B4-3 后台彩票配置 | 新增 `PATCH /api/admin/lottery/config` Go 内部 handler 和 `internal/lottery.UpdateConfig`；只允许 points 模式，校验每日抽奖次数 1-100、提交档位完整性、启用奖项数量、启用概率合计 100%、档位名称/积分/颜色/概率/启停状态，并写入 `lottery_configs` 与 `lottery_tiers` | 已完成 |
| 2026-06-25 | 阶段 5 B4-3 review | `go test ./internal/lottery ./internal/httpserver -run Lottery -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/lottery -run 'TestServiceBuildsPageAndAdminSnapshot|TestServiceSpinPoints|TestServiceUpdateConfig' -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/httpserver -run Lottery -count=1`、`node --check scripts/audit-lottery-cutover.mjs`、`node scripts/audit-lottery-cutover.mjs`、Gateway 双门禁和 PostgreSQL migration 审计均通过；审计状态为 `admin-config-internal-ready-not-cutover`，Gateway 继续禁止 `/api/lottery*` 与 `/api/admin/lottery*` | 已完成 |
| 2026-06-25 | 阶段 5 B4-4 数字炸弹投注与读取 | 新增 `0023_number_bomb.sql`、Go `number_bomb` 服务和 `GET /api/lottery/number-bomb`、`POST /api/lottery/number-bomb/bet`、`POST /api/lottery/number-bomb/cancel`、`GET /api/admin/lottery/number-bomb` 内部路由；下注、修改和取消均在 PostgreSQL 事务内锁定积分账户与当天投注，按差额扣分/退款并写 `point_ledger`，后台可读取今日系统数字和最近 7 天统计；结算 worker 和奖励发放留给 B4-5 | 已完成 |
| 2026-06-25 | 阶段 5 B4-4 review | 串行通过 `go test ./internal/lottery ./internal/httpserver -run 'Lottery|NumberBomb' -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/lottery -run 'TestService.*NumberBomb|TestServiceBuildsPageAndAdminSnapshot|TestServiceSpinPoints|TestServiceUpdateConfig' -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/httpserver -run 'Lottery|NumberBomb' -count=1`、`node --check scripts/audit-lottery-cutover.mjs`、`node scripts/audit-lottery-cutover.mjs`、Gateway 双门禁和 PostgreSQL migration 审计；审计状态为 `number-bomb-internal-ready-not-cutover`，Gateway 继续禁止 `/api/lottery*` 与 `/api/admin/lottery*` | 已完成 |
| 2026-06-25 | 阶段 5 B4-5 数字炸弹 Worker 结算 | 新增 `SettleNumberBombDate`，Go Worker 每天北京时间 00:00 结算昨日数字炸弹；只处理 pending 投注，中奖按 `ticketCost * 2` 发 `number_bomb_reward` 积分，失败写系统通知，取消投注计入 skipped；`number_bomb_draws` 汇总从投注事实派生回写，重复执行不重复派奖或重复通知 | 已完成 |
| 2026-06-25 | 阶段 5 B4-5 review | `go test ./internal/lottery ./internal/httpserver -run 'Lottery\|NumberBomb' -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/lottery -run 'TestService.*NumberBomb\|TestServiceBuildsPageAndAdminSnapshot\|TestServiceSpinPoints\|TestServiceUpdateConfig' -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/httpserver -run 'Lottery\|NumberBomb' -count=1`、`go test ./internal/worker -count=1`、`node --check scripts/audit-lottery-cutover.mjs`、`node scripts/audit-lottery-cutover.mjs`、Gateway 双门禁和 PostgreSQL migration 审计均通过；彩票/数字炸弹仍未切 Gateway，下一步继续 `/api/rankings/lottery`、`/api/lottery/records`/`ranking` 和旧后台彩票工具审计 | 已完成 |
| 2026-06-25 | 阶段 5 B4-6 彩票排行榜与记录只读接口 | 新增 Go 内部 `GET /api/rankings/lottery`、`GET /api/lottery/ranking` 和 `GET /api/lottery/records`；周期榜按 `lottery_records` 的北京时间日/周/月窗口实时聚合，保留旧顶层字段和 `data` 包装，用户记录接口兼容旧 `records` 响应；`equippedAchievement` 暂返回 `null`，留给 B5 全排行榜统一用户展示聚合 | 已完成 |
| 2026-06-25 | 阶段 5 B4-6 review | `go test ./internal/lottery ./internal/httpserver -run 'Lottery\|NumberBomb' -count=1`、真实 PostgreSQL 串行 `go test -tags=integration ./internal/lottery -run 'TestService.*NumberBomb\|TestServiceLotteryRanking\|TestServiceBuildsPageAndAdminSnapshot\|TestServiceSpinPoints\|TestServiceUpdateConfig' -count=1` 和 `go test -tags=integration ./internal/httpserver -run 'Lottery\|NumberBomb' -count=1`、`node --check scripts/audit-lottery-cutover.mjs`、`node scripts/audit-lottery-cutover.mjs` 均通过；Gateway 仍无 `/api/lottery*`、`/api/admin/lottery*` 或 `/api/rankings/lottery` 规则，下一步处理旧后台彩票工具或进入 B5 其它排行榜 | 已完成 |
| 2026-06-25 | 阶段 5 B5-1 排行榜只读接口 | 新增 Go `internal/rankings` 服务与 `GET /api/rankings/points`、`GET /api/rankings/games`、`GET /api/rankings/checkin-streak`；积分榜从 `point_accounts`/`point_ledger` 聚合，游戏榜从 `game_records` 聚合，签到榜从 `checkin_records` 计算连续签到，并统一补 `users`、`user_profiles` 与佩戴成就字段 | 已完成 |
| 2026-06-25 | 阶段 5 B5-1 review | Gateway 已精确切流 `/api/rankings/points`、`/api/rankings/games`、`/api/rankings/checkin-streak`，并新增 `/api/rankings/*` 禁切守卫；`go test ./internal/rankings ./internal/httpserver -run 'Ranking\|Rankings' -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/rankings -run TestServiceReadOnlyLeaderboardsUsePostgres -count=1`、`node --check scripts/audit-rankings-cutover.mjs`、`node scripts/audit-rankings-cutover.mjs`、Gateway 双门禁、旧 `points/rankings` 审计均通过；`/api/rankings/history` 和 `/api/admin/rankings/settle` 仍未迁移 | 已完成 |
| 2026-06-25 | 阶段 5 B5-2 排行榜历史只读接口 | 新增 `0024_ranking_settlements.sql` 与 Go `GET /api/rankings/history`；`mode=monthly-peaks` 按已结束自然月从 `point_ledger` 的正向积分窗口聚合近 12 个月历史巅峰榜，默认模式从 `ranking_settlements` 分页读取周/月结算历史，为后续后台发奖接口做 PostgreSQL 数据模型准备 | 已完成 |
| 2026-06-25 | 阶段 5 B5-2 review | 修复历史月榜窗口只按起点过滤的问题，改为 `[startAt,endAt)` 闭区间起点、开区间终点；Gateway 已精确切流 `/api/rankings/history`，仍禁止 `/api/rankings/*` 通配；`go test ./internal/rankings ./internal/httpserver -run 'Ranking\|Rankings' -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/rankings -run TestServiceReadOnlyLeaderboardsUsePostgres -count=1`、`node scripts/audit-rankings-cutover.mjs`、Gateway 双门禁、旧 `points/rankings` 审计和 PostgreSQL migration 审计均通过；下一步迁 `POST /api/admin/rankings/settle` | 已完成 |
| 2026-06-25 | 阶段 5 B5-3 排行榜后台结算接口 | 新增 Go `POST /api/admin/rankings/settle`；按北京时间上一个自然周/月聚合游戏总榜，使用 `ranking_settlements` 保存结算记录、`ranking_reward_claims` 防重复派奖，奖励写入 `point_accounts`/`point_ledger`，同步创建系统通知；月榜第一授予并强制佩戴 30 天 `peak_first` 成就；`dryRun` 只预演不写结算记录、不占派奖 claim、不发积分 | 已完成 |
| 2026-06-25 | 阶段 5 B5-3 review | Gateway 已精确切流 `/api/admin/rankings/settle`，继续禁止 `/api/rankings/*` 与 `/api/admin/*` 通配；`go test ./internal/rankings ./internal/httpserver -run 'Ranking\|Rankings' -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/rankings -run 'TestServiceReadOnlyLeaderboardsUsePostgres\|TestServiceSettleRankingPeriodGrantsRewardsIdempotently' -count=1` 已通过；专项审计、Gateway 允许清单和预检文档已更新 | 已完成 |
| 2026-06-25 | 阶段 5 B6-0 剩余后台工具审计 | 新增 `docs/admin-tools-cutover-preflight.md` 与 `scripts/audit-admin-tools-cutover.mjs`；确认 `/api/admin/config` 与 `/api/admin/alerts/{id}/resolve` 有生产价值，应迁到 Go；`/api/admin/sync-users`、`/api/admin/fix-codes-count`、`/api/admin/migrate-native-hot-data`、`/api/admin/migrate-new-user-eligibility` 属于旧 KV/D1 迁移或修复工具，不应原样暴露生产 API | 已完成 |
| 2026-06-25 | 阶段 5 B6-0 review | 审计门禁要求 B6 未完成迁移 review 前不得切 `/api/admin/config`、`/api/admin/alerts*`、`/api/admin/sync-users`、`/api/admin/fix-codes-count`、`/api/admin/migrate-*`，并继续禁止 `/api/admin*` 通配；下一小块优先迁 `GET/PUT /api/admin/config`，同时让 Go 游戏读取同一 PostgreSQL 每日积分上限 | 已完成 |
| 2026-06-25 | 阶段 5 B6-1 后台系统配置 | 新增 `0025_system_config.sql`、Go `internal/systemconfig` 和 `GET/PUT /api/admin/config`；后台系统设置读写 PostgreSQL `system_config.daily_points_limit`，Go 游戏状态、结算、商城首页和游戏中心概览均改为读取同一配置，避免后台保存成功但游戏仍使用常量 | 已完成 |
| 2026-06-25 | 阶段 5 B6-1 review | Gateway 已精确切流 `/api/admin/config`，继续禁止 `/api/admin/*` 通配；新增 `scripts/audit-admin-config-cutover.mjs` 固化 Go 路由、PostgreSQL 表、游戏动态 dailyLimit 和 Gateway 精确规则；`go test` 覆盖 systemconfig、httpserver、7 个普通游戏、gamesummary 与 economy，真实 PostgreSQL systemconfig 集成测试覆盖更新后事务内读取 | 已完成 |
| 2026-06-25 | 阶段 5 B6-2 后台告警处理 | 新增 `0026_admin_alerts.sql`，建立 `admin_alerts` 与 `admin_alert_point_baselines`；Go 仪表盘从 PostgreSQL 返回 active/history 告警和 active/warning/critical 统计，`detect=1` 会按积分短时增长与彩票高频阈值写入去重告警；新增 `GET /api/admin/alerts` 与 `POST /api/admin/alerts/{id}/resolve`，处理告警真实更新 `resolved`、`resolved_at_ms`、`resolved_by` | 已完成 |
| 2026-06-25 | 阶段 5 B6-2 review | Gateway 已精确切流 `/api/admin/alerts` 与 `/api/admin/alerts/*`，继续禁止 `/api/admin/*` 通配和旧迁移工具 API；`go test ./internal/admindashboard ./internal/httpserver -run 'AdminDashboard\|AdminAlerts\|AdminAlert' -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/httpserver -run AdminDashboard -count=1`、`node scripts/audit-admin-alerts-cutover.mjs`、`node scripts/audit-admin-tools-cutover.mjs`、Gateway 双门禁和 PostgreSQL migration 审计均通过 | 已完成 |
| 2026-06-25 | 阶段 5 B6-3 旧后台迁移工具生产收口 | `/admin/users` 页面移除 `同步历史用户` 与 `迁移新人资格` 两个旧工具入口；Go 新增 `POST /api/admin/sync-users`、`/api/admin/fix-codes-count`、`/api/admin/migrate-native-hot-data`、`/api/admin/migrate-new-user-eligibility` 精确墓碑路由，管理员可信来源请求返回 410 `ADMIN_LEGACY_TOOL_DISABLED`，不执行旧 Cloudflare/KV/D1 迁移逻辑 | 已完成 |
| 2026-06-25 | 阶段 5 B6-3 review | Gateway 已精确接住 4 个旧工具路径到 Go 墓碑，避免回落 Next/KV；`/api/admin/*` 通配继续关闭；`go test ./internal/httpserver -run 'AdminUsers\|AdminLegacyTools' -count=1`、`node scripts/audit-admin-tools-cutover.mjs`、Gateway 双门禁和默认 Zeabur 全预检均通过；旧工具如仍需执行，应改离线 SQL/CLI 或受控后台任务 | 已完成 |
| 2026-06-25 | 阶段 5 B4-7 旧后台彩票工具墓碑化与精确切流 | 新增 Go 墓碑路由接住 `/api/admin/lottery/debug`、`/api/admin/lottery/recalculate`、`/api/admin/lottery/reset`、`/api/admin/lottery/tiers/{tier}/codes`、`/api/admin/lottery/tiers/{tier}/detail`；管理员返回 410 且不再落回 Next/KV；Gateway 打开彩票和数字炸弹已审精确路径，同时继续禁止彩票和后台彩票通配 | 已完成 |
| 2026-06-25 | 阶段 5 B4-7 review | `go test ./internal/lottery ./internal/httpserver -run 'Lottery\|NumberBomb' -count=1`、真实 PostgreSQL 串行 `go test -tags=integration ./internal/lottery -run 'TestService.*NumberBomb\|TestServiceLotteryRanking\|TestServiceBuildsPageAndAdminSnapshot\|TestServiceSpinPoints\|TestServiceUpdateConfig' -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/httpserver -run 'Lottery\|NumberBomb' -count=1`、`node --check scripts/audit-lottery-cutover.mjs`、`node scripts/audit-lottery-cutover.mjs`、Gateway 双门禁和 PostgreSQL migration 审计均通过；旧后台彩票工具已墓碑化，Gateway 已打开已审精确路径，仍禁止所有 lottery/admin lottery 通配 | 已完成 |
| 2026-06-25 | 阶段 C Next API 回落风险审计 | 新增 `scripts/audit-next-api-fallback-risk.mjs` 与 `docs/phase-c-next-api-fallback-audit.md`，枚举 154 个 Next API 文件并和 Gateway Go 规则对齐；首次审计确认 136 个已 Go 接管、4 个已 Go 墓碑化、8 个仍需迁移或墓碑化、2 个 new-api 充值提现暂缓、4 个内部入口待 Worker 对齐 | 已完成 |
| 2026-06-25 | 阶段 C projects 公开路径收口 | Go 新增 `GET /api/projects/{id}`、`POST /api/projects/{id}`、`GET /api/projects/my-claims`；直充项目领取在 PostgreSQL 事务内锁项目、发积分、写 `point_ledger` 与 `exchange_logs`，重复领取幂等返回已领取结果；新增 `0027_project_claims.sql` 唯一索引兜底；Gateway 精确打开 `/api/projects/my-claims` 与 `/api/projects/*` | 已完成 |
| 2026-06-25 | 阶段 C projects review | `go test ./internal/welfare ./internal/httpserver -run 'Project\|Welfare' -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/httpserver -run 'PublicProject\|AdminProject' -count=1`、`npm run typecheck`、projects 审计、Gateway 双门禁、阶段 C 回落审计、Docker API/Gateway rebuild、容器内 `/app/migrate`、`node scripts/smoke-zeabur-runtime.mjs`、`node scripts/smoke-projects-go-api.mjs` 均通过；阶段 C `mustMigrateOrTombstone` 从 8 降到 6 | 已完成 |
| 2026-06-25 | 阶段 C 后台奖励收口 | Go 新增 `GET/POST /api/admin/rewards` 与 `GET /api/admin/rewards/{batchId}`；后台发放写 PostgreSQL `reward_batches`、`reward_claims`、`notifications`，用户领取继续走 Go `/api/notifications/claim` 并写积分账户/流水；Gateway 精确打开 `/api/admin/rewards` 与 `/api/admin/rewards/*` | 已完成 |
| 2026-06-25 | 阶段 C 后台奖励 review | `go test ./internal/rewards ./internal/httpserver -run 'Reward\|AdminRewards\|Notification' -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/rewards ./internal/httpserver -run 'AdminCreateListDetailAndClaimPointsReward\|AdminRewards\|NotificationClaimHTTPClaimsPointsReward' -count=1`、`node scripts/audit-admin-rewards-cutover.mjs`、Gateway 双门禁、阶段 C 回落审计、Docker API/Gateway rebuild、`node scripts/smoke-admin-rewards-go-api.mjs`、`node scripts/smoke-zeabur-runtime.mjs` 均通过；阶段 C `mustMigrateOrTombstone` 从 6 降到 4 | 已完成 |
| 2026-06-25 | 阶段 C 旧商店重置接口墓碑化 | Go 新增 `POST /api/admin/store/reset` 墓碑路由，管理员可信来源请求返回 410 `ADMIN_STORE_RESET_DISABLED`；旧接口只删除 Cloudflare D1/KV `store:items`，Zeabur/PostgreSQL 生产不再允许执行该重置动作；Gateway 精确打开该路径到 Go | 已完成 |
| 2026-06-25 | 阶段 C 旧商店重置 review | `go test ./internal/httpserver -run 'AdminStoreReset\|AdminLegacyTools\|Store' -count=1`、`node scripts/audit-admin-store-reset-tombstone.mjs`、Gateway 双门禁、阶段 C 回落审计、Docker API/Gateway rebuild、`node scripts/smoke-admin-store-reset-go-api.mjs`、`node scripts/smoke-zeabur-runtime.mjs` 均通过；阶段 C `mustMigrateOrTombstone` 从 4 降到 3 | 已完成 |
| 2026-06-25 | 阶段 C 游戏 overview 精确切流 | Gateway 精确打开 `/api/games/overview` 到 Go 游戏汇总服务，继续禁止 `/api/games/*` 通配；同步 games summary 审计、Gateway 允许清单、禁切守卫、Zeabur 总预检和阶段 C 回落审计 | 已完成 |
| 2026-06-25 | 阶段 C 游戏 overview review | `go test ./internal/gamesummary ./internal/httpserver -run "GameSummary\|Games" -count=1`、games summary 审计、Gateway 双门禁、阶段 C 回落审计、Docker API/Gateway rebuild、Caddy validate、`node scripts/smoke-games-summary-go-api.mjs`、`node scripts/smoke-zeabur-runtime.mjs`、`npm run typecheck` 和默认 `node scripts/preflight-zeabur-go-api.mjs` 均通过；阶段 C `mustMigrateOrTombstone` 从 3 降到 2 | 已完成 |
| 2026-06-25 | 阶段 C 卡牌旧直购接口墓碑化 | Go 新增 `POST /api/cards/purchase` 墓碑路由，可信已登录请求返回 410 `CARD_PURCHASE_DISABLED`；当前前台购买抽卡次数继续使用商城 `card_draw` 商品，不恢复旧 KV 直购链路；Gateway 精确打开该路径到 Go | 已完成 |
| 2026-06-25 | 阶段 C 卡牌旧直购 review | `go test ./internal/cards ./internal/httpserver -run "Card\|Cards" -count=1`、`node scripts/audit-cards-cutover.mjs`、Gateway 双门禁、阶段 C 回落审计、Docker API/Gateway rebuild、`node scripts/smoke-cards-write-go-api.mjs` 与 `node scripts/smoke-zeabur-runtime.mjs` 均通过；卡牌 smoke 已验证 `/api/cards/purchase` 直连 Go 与经 Gateway 均返回 410；阶段 C `mustMigrateOrTombstone` 从 2 降到 1 | 已完成 |
| 2026-06-25 | 阶段 C 农场旧商店只读接口收口 | Go 新增 `GET /api/farm/shop`，兼容旧 Next 响应 `items/inventory/balance/scarecrowUntil/bellUntil`；商品列表来自 Go 静态配置并套用 PostgreSQL `farm_shop_overrides` 覆盖；Gateway 精确打开该路径到 Go，继续禁止 `/api/farm*` 通配 | 已完成 |
| 2026-06-25 | 阶段 C 农场旧商店只读 review | `docker compose build --pull=false api gateway`、`docker compose up -d --no-deps api gateway`、`node scripts/smoke-farm-write-go-api.mjs`、`node scripts/smoke-farm-go-api.mjs`、`node scripts/smoke-zeabur-runtime.mjs`、Docker Caddy `validate`、`npm run typecheck` 和默认 `node scripts/preflight-zeabur-go-api.mjs` 均通过；阶段 C 回落审计确认 `mustMigrateOrTombstone` 已从 1 降到 0，剩余 2 个 `blockedByExternalConfig` 与 4 个 `internalOnly` 后续处理 | 已完成 |
| 2026-06-25 | 阶段 C internal cron 旧入口墓碑化 | 确认 Go Worker 已接管环保偷盗追查、数字炸弹结算和抽奖发奖队列；Gateway 对 `/api/internal/eco/theft-investigation`、`/api/internal/number-bomb/settle`、`/api/internal/raffle/delivery` 直接返回 410，避免继续落回 Next；农场成熟邮件提醒暂不处理，等待 Go Worker 迁移 | 已完成 |
| 2026-06-25 | 阶段 C internal cron review | `node --check scripts/audit-next-api-fallback-risk.mjs`、Gateway 双门禁、Caddy validate、Gateway rebuild/restart 与 3 条旧 internal 路径本地 HTTP 410 smoke 均通过；阶段 C 回落审计确认 `gatewayGoneRules=3`，`alreadyGoTombstoned` 从 6 增至 9，`internalOnly` 从 4 降至 1 | 已完成 |
| 2026-06-25 | 阶段 C 农场邮件提醒 Worker 收口 | Go Worker 新增农场成熟/浇水邮件提醒扫描，每 5 分钟分批处理农场状态；邮件发送使用 Resend 配置，未配置时跳过且不影响 Worker；成熟与浇水提醒去重写 PostgreSQL，失败会回滚去重占位；Gateway 对 `/api/internal/farm/maturity-email` 直接返回 410，避免继续落回 Next/KV | 已完成 |
| 2026-06-25 | 阶段 C 农场邮件提醒 review | `go test ./internal/farm ./internal/worker -run "Maturity\|Farm" -count=1`、真实 PostgreSQL `go test -tags=integration ./internal/farm -run "ProcessMaturityEmails" -count=1`、阶段 C 回落审计、Gateway 双门禁、Docker API/Gateway rebuild、`node scripts/smoke-zeabur-runtime.mjs`、Caddy validate 和 4 条旧 internal 路径本地 HTTP 410 smoke 均通过；阶段 C 回落审计确认 `gatewayGoneRules=4`，`alreadyGoTombstoned=10`，`internalOnly=0` | 已完成 |
| 2026-06-25 | 阶段 C 钱包外部阻塞复核 | 复核 `/api/store/topup`、`/api/store/withdraw`：Go 服务层、HTTP 路由、可信来源校验、限流、Redis 钱包锁、`wallet_transactions` 审计和缺 new-api 配置安全失败均已存在；Gateway 仍无活跃钱包切流规则，继续等待 Zeabur 配置 `NEW_API_URL`、`NEW_API_ADMIN_ACCESS_TOKEN`、`NEW_API_ADMIN_USER_ID` 后做真实 Cookie 只读余额、小额充值和小额提现冒烟 | 待外部配置 |
| 2026-06-25 | 阶段 C 钱包外部阻塞 review | `npm run audit:wallet-cutover`、`go test ./internal/economy ./internal/httpserver -run "Wallet\|Economy" -count=1`、`node scripts/smoke-wallet-go-api.mjs`、`node scripts/smoke-wallet-write-missing-newapi-go-api.mjs` 均通过；缺配置写路径验证认证余额/充值/提现均返回 `NEW_API_NOT_CONFIGURED`，且不写 `wallet_transactions`、不写积分流水、不改变余额，清理后无残留 | 待外部配置 |
| 2026-06-26 | 阶段 C 钱包 Gateway 精确切流 | 线上提现失败日志显示请求仍落回旧 Next/KV；Gateway 精确打开 `/api/store/topup` 与 `/api/store/withdraw` 到 Go，同步 Gateway 允许清单、禁切守卫、商城/钱包审计和 smoke 脚本，继续禁止 `/api/store*` 通配 | 已完成 |
| 2026-06-26 | 阶段 C 钱包 Gateway review | `npm run audit:wallet-cutover`、`node scripts/audit-store-cutover.mjs`、Gateway 双门禁、`node scripts/smoke-wallet-go-api.mjs`、`node scripts/smoke-wallet-write-missing-newapi-go-api.mjs`、`go test ./internal/httpserver ./internal/economy`、Caddy validate、本地 Gateway 钱包 3 路径 401 和 `node scripts/smoke-zeabur-runtime.mjs` 均通过；生产仍需配置 new-api 后做真实余额/小额充值/小额提现冒烟 | 已完成 |
| 2026-06-26 | 阶段 C 钱包 new-api 鉴权对齐 | 对照 `0401lucky/new-api` fork：管理接口仍为 `/api/user/:id` 与 `/api/user/manage`，额度动作为 `add_quota` + `add/subtract`；Go client 改为按文档发送 `Authorization: Bearer <token>`，并兼容误复制的 `Authorization: Bearer ...` 环境变量值 | 已完成 |
| 2026-06-26 | 阶段 C 钱包 new-api 鉴权失败保护 review | new-api 返回 `Unauthorized, invalid access token`、`New-Api-User` 不匹配或 401/403 时会识别为 `NEW_API_AUTH_FAILED`；充值不再把鉴权失败当作不确定扣款继续发积分，提现会退回已扣积分；`go test ./internal/platform/newapi ./internal/economy ./internal/httpserver` 与真实 PostgreSQL `go test -tags=integration ./internal/economy -run "ExecuteTopup\|ExecuteWithdraw" -count=1` 已通过 | 已完成 |
| 2026-06-26 | PR #9 排行榜与页面差异复核 | 2048 排行榜已补接到 Go `rankings.supportedGames` 与前端排行榜页；复核 PR #9 后台环保、2048 页面、后台用户页和环保页差异，确认不恢复旧 `games/fallback`、旧同步历史用户工具、旧新人资格迁移按钮和 Go 契约不存在的 `stealProtectedUntil`/`theftCaughtCount` 展示字段 | 已完成 |
| 2026-06-26 | PR #9 文档与门禁 review | 更新 `docs/pr-9-go-reconciliation.md`、`docs/phase-c-next-api-fallback-audit.md`、`docs/stage-1-4-review.md`，同步阶段 C 最新审计统计 `gatewayHandledRules=151`、`gatewayGoRules=147`、`alreadyGoCutover=144`，并明确生产 readiness 当前阻塞模块为 `auth`、`wallet`、`profile`、`notifications`、`farm`、`cards` 6 个；`node scripts/audit-production-cutover-evidence.mjs`、`node scripts/audit-production-cutover-readiness.mjs`、Gateway 双门禁、`go test ./internal/rankings -count=1` 和 `npm run typecheck` 均通过 | 已完成 |
| 2026-06-26 | PR #9 Go 对账机器审计 | 新增 `scripts/audit-pr-9-go-reconciliation.mjs` 与 `npm run audit:pr-9-go-reconciliation`，校验 2048 排行榜 Go/前端/测试三方接入、2048 素材和 v3.0 公告存在、公告使用 Go 版服务端权威结算口径，并防止旧 `requestGameFallback`、旧用户迁移按钮和 Go 契约不存在的环保字段回到生产页面 | 已完成 |
| 2026-06-26 | 当前 Go/Zeabur 发版汇总审计 | 新增 `scripts/audit-current-go-zeabur-release.mjs` 与 `npm run audit:current-go-zeabur-release`，聚合迁移产物、PR #9 对账、Zeabur 单服务计划、Dockerfile、GHCR workflow、C1-C3 readiness 和生产 readiness；硬门禁失败时阻止发版，真实 Cookie/远端证据与 C1-C3 物理清理仅作为 soft blockers 输出 | 已完成 |
| 2026-06-26 | 当前 Go/Zeabur 测试部署状态文档 | 新增 `docs/current-go-zeabur-release-readiness.md`，明确当前 `deployForTestingReady=true`、严格生产证据仍缺 `auth/wallet/profile/notifications/farm/cards`、C1-C3 物理清理未执行，并固化 GHCR 部署、`/app/migrate`、`/data` 持久卷和 new-api access token 要点；发版汇总审计已检查该文档关键提示 | 已完成 |
| 2026-06-26 | 生产证据收集 runbook | 新增 `docs/production-evidence-collection-runbook.md`，按 `auth`、`wallet`、`profile`、`notifications`、`farm`、`cards` 六个 soft blocker 记录真实登录态 Cookie 变量、远端 smoke 命令、页面冒烟项、证据包字段和敏感环境变量清理方式；发版汇总审计已检查该文档关键命令与“不记录 Cookie 原文”要求 | 已完成 |
| 2026-06-26 | C1-C3 旧 Cloudflare 残留清理前置审计 | 新增 `scripts/audit-legacy-cloudflare-residuals.mjs`、`docs/c1-c3-legacy-cleanup-audit.md` 和 `npm run audit:legacy-cloudflare-residuals`，按生产源码残留、Cloudflare 部署产物、可选 D1 归档工具、迁移文档/脚本和测试残留分类盘点；默认只读不失败，`LEGACY_CLOUDFLARE_RESIDUALS_STRICT=1` 可作为最终清零门禁；暂不执行物理删除 | 已完成 |
| 2026-06-26 | C1-C3 旧 Next API 删除候选审计 | 扩展 `scripts/audit-legacy-cloudflare-residuals.mjs` 输出 `nextApiRouteDeletionPlan`；当前 154 个 `src/app/api/**/route.ts` 全部属于候选，其中 144 个已由 Gateway 精确转 Go，10 个已由 Gateway 显式 410，`manualReviewRoutes=0`、`readyForRouteDeletion=true`；这只证明具备删除候选条件，实际物理删除仍需单独确认 | 已完成 |
| 2026-06-26 | C1-C3 旧 Next API 删除分批计划 | `nextApiRouteDeletionPlan` 新增批次摘要和 `LEGACY_CLOUDFLARE_RESIDUALS_FULL=1` 全量候选列表输出；建议按 `01-tombstoned-legacy-tools`、`03-auth-routes`、`04-admin-routes`、`05-game-routes`、`06-user-feature-routes`、`07-public-and-misc-routes` 分批删除并逐批 review | 已完成 |
| 2026-06-26 | C1-C3 旧 Next API 删除执行器 dry-run | 新增 `scripts/remove-next-api-routes.mjs` 与 `npm run cleanup:next-api-routes:dry-run`；默认只输出指定批次候选文件，真正删除必须同时传 `--execute` 和 `CONFIRM_DELETE_NEXT_API_ROUTES=<batch>`；本轮只准备执行器，不执行物理删除 | 已完成 |
| 2026-06-26 | C1-C3 旧 Next API 删除防误删 guard | 新增 `scripts/test-remove-next-api-routes-guards.mjs` 与 `npm run test:next-api-route-cleanup-guards`，覆盖非法批次失败、未设置确认口令时 `--execute` 失败、dry-run 删除数为 0 且候选文件仍存在；默认 Zeabur 预检已接入该 guard | 已完成 |
| 2026-06-26 | C3 Cloudflare 部署产物删除执行器 dry-run | 新增 `scripts/remove-cloudflare-deploy-artifacts.mjs`、`scripts/test-remove-cloudflare-deploy-artifacts-guards.mjs`、`npm run cleanup:cloudflare-deploy-artifacts:dry-run` 和 `npm run test:cloudflare-deploy-cleanup-guards`；覆盖 5 个文件型部署产物，真正删除必须传 `--execute` 与 `CONFIRM_DELETE_CLOUDFLARE_DEPLOY_ARTIFACTS=cloudflare-deploy-artifacts`；本轮仍不执行物理删除 | 已完成 |
| 2026-06-26 | C3 package 级 Cloudflare 信号清理 dry-run | 新增 `scripts/plan-package-cloudflare-cleanup.mjs`、`scripts/test-package-cloudflare-cleanup-guards.mjs`、`npm run cleanup:package-cloudflare:dry-run` 和 `npm run test:package-cloudflare-cleanup-guards`；覆盖 OpenNext/Wrangler 脚本、`@vercel/kv`、`@opennextjs/cloudflare`、`wrangler`，真正应用必须传 `--apply` 与 `CONFIRM_CLEAN_PACKAGE_CLOUDFLARE=package-cloudflare-signals`，且应用后再运行 `npm install` 更新 lockfile；本轮仍不改依赖 | 已完成 |
| 2026-06-26 | C1-C3 物理清理 readiness 审计 | 新增 `scripts/audit-c1-c3-cleanup-readiness.mjs` 与 `npm run audit:c1-c3-cleanup-readiness`，统一执行旧 Next API 全批次 dry-run、旧 API guard、Cloudflare 文件产物 dry-run/guard、package 信号 dry-run/guard，并输出真实清理前的执行顺序和确认口令；默认 Zeabur 预检已接入，本轮仍不执行物理删除 | 已完成 |
| 2026-06-26 | C1-C3 物理清理执行手册 | 新增 `docs/c1-c3-physical-cleanup-runbook.md`，将旧 Next API 6 个批次、Cloudflare/OpenNext 文件产物和 package 信号清理拆成 8 个执行批次；每批记录 dry-run、真实执行口令、review 命令、完成标准和回滚方式，等待人工确认后再逐批执行 | 已完成 |
| 2026-06-26 | C1-C3 物理清理 runbook 审计 | 新增 `scripts/audit-c1-c3-cleanup-runbook.mjs` 与 `npm run audit:c1-c3-cleanup-runbook`，校验 runbook 必须包含 8 个批次、各批 dry-run/执行口令、预期删除数量、最终清零标准和禁止事项；默认 Zeabur 预检已接入，避免真实清理步骤文档漂移 | 已完成 |

## 13. 下一轮执行清单

下一轮继续阶段 5；阶段 4 的部署、生产证据、readiness 和最终切流 guard 已形成完整门禁链路，不再把日常开发重点放在继续加固阶段 4。记忆游戏、消消乐、打地鼠、扫雷、连连看和 Roguelite 已完整精确切流，且均已补独立审计、预检文档和 Docker 直连结算冒烟门禁；Gateway 禁切守卫已固化当前仍不能打开的高风险路径，Gateway 允许清单审计已固化当前 49 条 Go API 精确转发，生产切流证据包模板已固化真实导入、真实登录态和页面冒烟记录格式，Zeabur 服务计划模板已固化 6 服务部署拓扑，PostgreSQL migration 审计已固化 schema 文件连续性和 `/app/migrate` 打包入口，PostgreSQL 实库 schema 审计已固化运行库 migration 状态复核，部署产物敏感信息卫生审计已固化模板/文档/证据文件的密钥泄漏检查，普通游戏一键门禁套件、Zeabur 部署前总预检、生产切流准备审计、生产最终预检漂移审计、生产切流 guard 失败路径自动化、Zeabur 环境变量样例审计、Zeabur 真实环境变量审计、D1 导入 scope 一致性审计、Zeabur 部署运行手册、Zeabur 运行时基础冒烟、迁移产物索引审计、Docker Compose 拓扑审计和 Dockerfile 构建产物审计可用于部署前统一复核。仍不要打开 `/api/games/memory*`、`/api/games/match3*`、`/api/games/whack-mole*`、`/api/games/minesweeper*`、`/api/games/linkgame*`、`/api/games/roguelite*` 或 `/api/games/*` 通配。继续按“完成一小块就 review”的节奏处理阶段 5 低频业务和剩余高风险写路径。

1. 下一小块建议继续阶段 5：用真实 D1 导出执行 `migrate-d1 -apply -scope feedback`，并用真实用户 Cookie / 管理员 Cookie 复跑 `/feedback`、`/admin/feedback` 页面级冒烟；在真实证据齐全前暂不切 `/api/feedback*` 或 `/api/admin/feedback*` Gateway。
2. 环保 status、collect、公示领取、公开栏显示、页面偷盗、商人收购、黑市出售和追查 worker 已通过本地 Gateway/数据库/浏览器冒烟；新增独立审计、预检文档和 Docker 直连写路径自动冒烟门禁，覆盖拖拽结算、购买、领奖、公示、出售、黑市和偷盗；环保暂保持精确切流，不打开通配。
3. 继续保持 `/api/games/eco*`、`/api/games/memory*`、`/api/games/match3*`、`/api/games/whack-mole*`、`/api/games/minesweeper*`、`/api/games/linkgame*`、`/api/games/roguelite*`、`/api/games/*` 通配关闭；只有完成最终未知路径审计后，再评估是否打开通配或继续保留精确切流。
4. `/api/points`、`/api/rankings/eco`、环保 8 个前端路径、记忆游戏 5 个路径、消消乐 4 个路径、打地鼠 5 个路径、扫雷 5 个路径、连连看 4 个路径、Roguelite 5 个路径、`/api/games/profile`、`/api/games/overview`、`/api/store`、`/api/store/exchange`、`/api/store/topup`、`/api/store/withdraw`、`/api/store/admin`、`GET /api/projects`、`/api/raffle*`、`/api/admin/raffle*` 已精确切到 Go；积分查询、环保排行榜、环保行动、记忆游戏、消消乐、打地鼠、扫雷、连连看、Roguelite、游戏汇总、商城核心、钱包、抽奖和公开项目列表已补独立审计、预检文档和 Docker 直连冒烟门禁；`scripts/audit-gateway-cutover-guard.mjs` 已固化禁切检查，`scripts/audit-gateway-allowed-cutovers.mjs` 已固化允许清单正向检查，`scripts/smoke-game-cutovers-go-api.mjs` 可一键复跑普通游戏门禁，`scripts/preflight-zeabur-go-api.mjs` 可一键复跑当前默认部署前总预检；完整 `/api/store*`、完整 `/api/games/eco*`、完整 `/api/games/memory*`、完整 `/api/games/match3*`、完整 `/api/games/whack-mole*`、完整 `/api/games/minesweeper*`、完整 `/api/games/linkgame*`、完整 `/api/games/roguelite*`、完整 `/api/games/*`、完整 `/api/projects/*`、完整 `/api/admin/*` 仍不要打开。
5. `/api/store/topup` 与 `/api/store/withdraw` 已精确切到 Go：Go 服务层、HTTP 路由、可信来源校验、限流、`npm run audit:wallet-cutover`、直连 Go API 容器冒烟、本地缺 new-api 配置写路径安全门禁和 `docs/wallet-cutover-preflight.md` 已完成；生产仍需要配置 `NEW_API_URL`、`NEW_API_ADMIN_ACCESS_TOKEN`、`NEW_API_ADMIN_USER_ID` 后，用真实账号完成余额、小额充值和小额提现冒烟。
6. 个人资料 GET/PUT、成就佩戴、`profile/overview` Go 内部路由、自定义资料导入器、旧成就导入器、直连 Go API 只读/未登录冒烟和 Docker 写路径自动冒烟脚本已完成但 Gateway 未切；切流前仍需要用真实导出完成本地导入并用真实登录态复跑接口/页面冒烟，避免用户自定义资料或成就佩戴临时不可见、不可更新或写入分叉。
7. 通知未读数 `GET /api/notifications/unread-count`、通知列表 `GET /api/notifications`、通知已读 `POST /api/notifications/read`、通知删除 `POST /api/notifications/delete`、通知领取 `POST /api/notifications/claim`、`migrate-d1 -apply -scope notifications` 和 `migrate-d1 -apply -scope reward-claims` 已完成；前端通知依赖审计、页面级拦截冒烟、直连 Go API 容器冒烟、Docker 写路径自动冒烟和 `docs/notifications-cutover-preflight.md` 均已完成，但尚未用真实 D1 导出执行导入，也未用真实样本账号 Cookie 复跑登录态只读冒烟。暂不切 `/api/notifications*`。
8. 游戏中心 `GET /api/games/profile` 与 `GET /api/games/overview` 已精确切到 Go，并通过直连 Go API 聚合冒烟；`overview` 已加入 Gateway 认证冒烟，完整 `/api/games/*` 通配仍关闭。
9. 农场 `/api/farm/status` 已完成前置审计、`0015_farm_runtime.sql`、`migrate-d1 -apply -scope farm-v2`、Go PostgreSQL store、内部 status 服务层、缺失状态 get-or-create、已有状态积分余额同步、新用户初始积分入账、基础作物 tick、雨天自动浇水、乌鸦窗口推进、周五随机事件、宠物基础懒结算、宠物自动浇水、宠物被动收菜、宠物被动播种、种植、浇水、一键浇水、手动收获、一键收获、清除枯萎作物、购买土地、购买道具、使用道具、购买种子、宠物领养、宠物喂养、宠物保养/喂水/互动、宠物派遣、偷菜候选列表、偷菜纯算法、偷菜双用户事务结算，并已给当前前端使用的全部 `/api/farm` 路径补 Go 内部精确 handler、真实 PostgreSQL HTTP integration、直连 Go API 冒烟脚本和 Docker 测试库写路径自动冒烟门禁；但仍不适合切流：尚未做真实导入数据后的登录态直连 API 和页面级冒烟。继续禁止 `/api/farm/status` 和 `/api/farm*` Gateway 切流，下一步农场应进入真实导入数据冒烟与页面级 review。
10. 卡牌前台切流前置审计、PostgreSQL schema、`migrate-d1 -apply -scope cards`、`internal/cards` PostgreSQL store、静态 catalog、抽卡纯算法、抽卡 PostgreSQL 事务服务层、碎片兑换服务层、卡册奖励服务层、库存/规则/抽卡/兑换/奖励领取 HTTP handler、商城 `card_draw` 奖励同步、旧直购抽卡接口墓碑化、直连 API 冒烟门禁和 Docker 测试库写路径自动冒烟门禁已完成，当前确认 `/cards`、`/cards/draw`、`/cards/[albumId]` 依赖 5 个 `/api/cards/*` 路径，旧状态来自 `native_user_cards`、`cards:user:{userId}` 与 `cards:rules:config`；直接 `POST /api/cards/purchase` 当前无前台入口，已精确切到 Go 墓碑，继续禁止 `/api/cards*` 与 `/api/admin/cards*` 通配切流。后台 `/api/admin/cards/*` 已完成前置审计、自定义奖励 schema、自定义奖励 D1 导入器、Go admin 读写 service、读写 HTTP handler 方法、Go 内部精确路由、直连未登录冒烟门禁、本地管理员 Cookie 只读冒烟、`/admin/cards` 页面只读冒烟和本地夹具页面写路径冒烟；下一步是用真实导入数据或生产等价样本账号完成最终后台页面复核，最后才评估 Gateway 精确切流。

## 14. Zeabur 全量 Go 收口计划

### 14.1 当前线上问题判断

Zeabur 当前已经是单容器多进程部署：Caddy 对外、Next.js 承载前端、Go API 承载已切流接口、Go Worker 承载后台任务。
因此当前不是“没有 Go 后端”，而是“部分接口还没有切到 Go，或者还没有完成 Go 迁移”。

当前个人主页出现“个人主页数据服务暂时不可用”，优先判断为：

1. `/api/profile/overview` 已有 Go 内部实现，但 `gateway/Caddyfile` 仍未切到 Go。
2. 请求落回 Next 旧 API 后，旧链路继续调用 `d1-kv.ts`。
3. Zeabur 没有 Cloudflare `KV_DB` 绑定，也没有 `KV_REST_API_URL` / `KV_REST_API_TOKEN`，所以旧 KV 报错。

修复方向不是继续补 Cloudflare KV，而是按下面计划把旧 Next API 全部收口到 Go/PostgreSQL/Redis。

### 14.2 全量完成标准

完成标准必须同时满足：

1. Zeabur 生产入口只需要 `ghcr.io/0401lucky/redemption-zeabur:latest` 单容器镜像。
2. Caddy 可以把全部业务 `/api/*` 流量转发到 Go，Next.js 只保留页面渲染和静态资源。
3. 线上日志不再出现 `KV backend not configured`。
4. 运行时不再需要 `KV_DB`、`KV_REST_API_URL`、`KV_REST_API_TOKEN`。
5. `src/lib/d1-kv.ts` 和旧 Cloudflare/OpenNext 专用运行依赖进入删除清单。
6. PostgreSQL 是唯一业务写入源，Redis 只负责锁、限流、幂等和缓存。
7. `/readyz`、登录、个人主页、通知、农场、卡牌、反馈、抽奖、商城、游戏和后台核心页面均完成 Zeabur 登录态冒烟。

### 14.3 阶段 A：先切已完成 Go 实现，止住旧 KV 报错

目标：优先处理“Go 已经写好，但 Gateway 没切”的接口。
这一阶段不做大重构，只做精确切流、验证和 review。

小块 A1：个人主页与资料

- 切流路径：
  - `GET /api/profile/overview`
  - `GET /api/profile/settings`
  - `PUT /api/profile/settings`
  - `PUT /api/profile/achievements/equip`
- 完成标准：
  - `/profile` 不再显示“个人主页数据服务暂时不可用”。
  - 修改昵称、头像、QQ 邮箱和佩戴成就可正常写入 PostgreSQL。
  - Zeabur 日志不再因个人主页触发 `KV backend not configured`。
- review：
  - 复跑 `audit:profile-cutover`。
  - 用真实登录 Cookie 冒烟 `/profile` 页面。

小块 A2：通知中心

- 切流路径：
  - `GET /api/notifications`
  - `GET /api/notifications/unread-count`
  - `POST /api/notifications/read`
  - `POST /api/notifications/delete`
  - `POST /api/notifications/claim`
- 完成标准：
  - 侧边栏未读数正常。
  - 通知页列表、已读、删除和领取奖励正常。
  - 奖励领取重复提交不重复发积分或额度。
- review：
  - 复跑 `audit:notifications-cutover`。
  - 用真实登录 Cookie 冒烟 `/notifications` 页面。

小块 A3：反馈墙公开路径

- 当前后台反馈路径已经精确切流，公开反馈路径仍需补齐切流。
- 切流路径：
  - `GET /api/feedback`
  - `POST /api/feedback`
  - `GET /api/feedback/{id}`
  - `POST /api/feedback/{id}/messages`
  - `POST /api/feedback/{id}/like`
  - `GET/HEAD /api/feedback/images/*`
- 完成标准：
  - `/feedback` 页面列表、详情、新建、评论、点赞和附件显示正常。
  - 附件写入 `FEEDBACK_MEDIA_DIR`。
  - 需要持久化附件时 Zeabur 必须挂载 `/data/feedback-media` 卷。
- review：
  - 复跑 feedback Go API smoke。
  - 页面级检查新建文本反馈和带图反馈。

小块 A4：卡牌前台与后台

- 切流路径：
  - `GET /api/cards/inventory`
  - `GET /api/cards/rules`
  - `POST /api/cards/draw`
  - `POST /api/cards/exchange`
  - `POST /api/cards/claim-reward`
  - `GET /api/admin/cards/users`
  - `GET /api/admin/cards/user/{userId}`
  - `POST /api/admin/cards/reset`
  - `GET/POST /api/admin/cards/albums`
  - `GET/PATCH /api/admin/cards/rules`
- 完成标准：
  - 抽卡次数、碎片、库存、图鉴奖励和后台规则全部写 PostgreSQL。
  - 商城购买卡抽次数后，卡牌页能立即看到次数。
- review：
  - 复跑 cards cutover 审计。
  - 冒烟 `/cards`、`/cards/draw`、`/admin/cards`。

小块 A5：农场全路径

- 切流路径：
  - `/api/farm/status`
  - `/api/farm/plant`
  - `/api/farm/water`
  - `/api/farm/water-all`
  - `/api/farm/harvest`
  - `/api/farm/harvest-all`
  - `/api/farm/remove`
  - `/api/farm/buy-land`
  - `/api/farm/shop/buy`
  - `/api/farm/shop/use`
  - `/api/farm/seeds/buy`
  - `/api/farm/pet/adopt`
  - `/api/farm/pet/feed`
  - `/api/farm/pet/wash`
  - `/api/farm/pet/drink`
  - `/api/farm/pet/play`
  - `/api/farm/pet/dispatch`
  - `/api/farm/steal/list`
  - `/api/farm/steal/do`
- 完成标准：
  - 农场页面状态、种植、浇水、收获、购买、宠物、偷菜均正常。
  - 高频操作不会落回 Next 旧 KV。
- review：
  - 复跑 farm Go API smoke。
  - 页面级检查至少一个完整种植到收获闭环。

小块 A6：钱包充值与提现

- 切流路径：
  - `GET /api/store/topup`
  - `POST /api/store/topup`
  - `POST /api/store/withdraw`
- 前置条件：
  - `NEW_API_URL`
  - `NEW_API_ADMIN_ACCESS_TOKEN`
  - `NEW_API_ADMIN_USER_ID`
- 完成标准：
  - new-api 配置缺失时返回明确 503，不产生半写入。
  - 配置正确时充值和提现写 PostgreSQL 流水，并和外部额度一致。
- review：
  - 复跑 wallet smoke。
  - 用小额真实账号做一次只读余额检查，写路径按风险单独确认。

### 14.4 阶段 B：迁移仍依赖 Next/KV 的核心业务

目标：把还没有 Go 实现、但页面仍会调用的旧 API 迁掉。
每个小块都必须先做前端依赖审计，再实现 Go，再加 smoke，最后才切 Gateway。

小块 B1：认证与会话

- 迁移范围：
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
  - 登录失败计数
  - session revocation
  - public session profile
- 目标设计：
  - 用户主表继续使用 PostgreSQL `users`。
  - session 签名继续兼容现有 `SESSION_SECRET`。
  - 撤销、失败计数和临时登录状态放 Redis。
- 完成标准：
  - 登录、登出、刷新页面保持登录态均不再访问 `d1-kv.ts`。
  - Zeabur 多副本时不会因为内存 fallback 导致登录状态不一致。

小块 B2：签到

- 迁移范围：
  - `GET/POST /api/checkin`
  - `POST /api/checkin/makeup`
- 目标设计：
  - 新增或复用 PostgreSQL 签到表。
  - 签到奖励通过 Go economy 事务入账。
  - 补签消耗和奖励幂等处理。
- 完成标准：
  - 每日重复签到不重复发奖励。
  - 补签并发不会重复扣分或重复奖励。

小块 B3：公告

- 迁移范围：
  - 公开公告列表。
  - `/api/admin/announcements`
  - `/api/admin/announcements/{id}`
  - 公告通知 fanout 去重。
- 目标设计：
  - PostgreSQL 保存公告主体。
  - Redis 或 PostgreSQL 唯一约束做 fanout 幂等。
- 完成标准：
  - 首页公告、后台公告管理和公告通知都不再访问 KV。

小块 B4：彩票与数字炸弹

- 迁移范围：
  - `/api/lottery`
  - `/api/lottery/spin`
  - `/api/lottery/records`
  - `/api/lottery/ranking`
  - `/api/lottery/number-bomb`
  - `/api/lottery/number-bomb/bet`
  - `/api/lottery/number-bomb/cancel`
  - `/api/admin/lottery/*`
- 目标设计：
  - 奖池、奖品码、投注、记录、排行榜全部结构化入 PostgreSQL。
  - 数字炸弹结算由 Go Worker 幂等处理。
- 完成标准：
  - 抽奖码不会重复发放。
  - 投注、取消、结算和排行榜一致。

小块 B5：排行榜与历史奖励

- 迁移范围：
  - `/api/rankings/points`
  - `/api/rankings/games`
  - `/api/rankings/lottery`
  - `/api/rankings/checkin-streak`
  - `/api/rankings/history`
  - `/api/admin/rankings/settle`
- 目标设计：
  - 从 PostgreSQL 事实表实时聚合或定时写入快照。
  - 历史奖励走 `reward_claims` 幂等发放。
- 完成标准：
  - 排行榜页面不再读 KV。
  - 后台结算可重复执行但不重复发奖。

小块 B6：剩余后台工具

- 迁移范围：
  - `/api/admin/config`
  - `/api/admin/alerts`
  - `/api/admin/alerts/{id}/resolve`
  - `/api/admin/sync-users`
  - `/api/admin/fix-codes-count`
  - `/api/admin/migrate-*`
- 处理原则：
  - 有生产价值的迁到 Go。
  - 只为旧 Cloudflare/D1 服务的迁移工具改为 CLI 或删除。
- 完成标准：
  - 后台管理页不再触发旧 KV。
  - 生产环境不暴露一次性迁移 API。

### 14.5 阶段 C：Gateway 全量切流与删除旧链路

阶段 C 前置审计：

- 新增 `scripts/audit-next-api-fallback-risk.mjs`，用于枚举 `src/app/api/**/route.ts`、解析 `gateway/Caddyfile` 已转发 Go 的精确规则，并识别仍会落回 Next/KV 的路径。
- 新增 `docs/phase-c-next-api-fallback-audit.md`，记录阶段 C 的剩余风险清单和处理顺序。
- 当前审计结果：154 个 Next API 文件中，142 个已由 Gateway 切到 Go，10 个旧工具/旧 internal 入口已墓碑化，仍需迁移或墓碑化 0 个，new-api 充值/提现暂缓 2 个，内部定时入口待 Worker 对齐 0 个。
- 阶段 C 已完成 `/api/projects/my-claims`、`/api/projects/*`、`/api/admin/rewards{,/*}`、`/api/admin/store/reset` 墓碑化、`/api/games/overview` 精确切流、`/api/cards/purchase` 墓碑化、`/api/farm/shop` 只读兼容切流，以及 4 个已由 Go Worker 接管的旧 internal cron 入口 Gateway 410；下一步只剩等待 new-api 配置后处理充值/提现。

小块 C1：Gateway 从精确规则切到 Go 优先

- 先把所有已迁路径精确切到 Go。
- 再评估是否打开 `/api/* -> Go`。
- 保留明确例外：
  - `/_next/*`
  - 静态资源
  - 普通页面路由

完成标准：

- 访问任何业务 API 时，Go 日志都能看到请求。
- Next 日志不再出现旧 API 的业务错误。

小块 C2：删除 Next 旧 API

- 删除或归档 `src/app/api/*` 中已经被 Go 接管的 route。
- 保留必要的前端页面代码。
- 删除未使用的旧 `src/lib/*` 业务 KV 模块。

完成标准：

- `rg "d1-kv|KV_REST_API|KV_DB" src` 不再命中生产代码。
- `npm run typecheck` 通过。
- Go 全量测试通过。

小块 C3：删除 Cloudflare 专用部署链路

- 删除或归档 OpenNext / Workers 专用配置。
- 文档统一为 Zeabur GHCR 镜像部署。
- 环境变量样例移除 Cloudflare D1/KV 相关项。

完成标准：

- 新人只看 Zeabur 文档即可部署。
- 生产环境不再要求任何 Cloudflare binding。

### 14.6 每小块 review 模板

每完成一个小块必须记录：

1. 改动范围：列出 Go 服务、Gateway、前端和 migration 文件。
2. 路由清单：列出新增或切流的全部 API。
3. 数据源：确认写入 PostgreSQL，临时状态写入 Redis。
4. 幂等性：说明重复提交、重复发奖、并发扣分如何处理。
5. 验证命令：列出实际运行过的测试、审计和 smoke。
6. 页面冒烟：列出实际打开的页面和核心操作。
7. Zeabur 影响：说明是否需要新环境变量、卷、重启或重新构建镜像。
8. 回滚方式：说明可以回滚到上一镜像，或关掉对应 Gateway 精确规则。

### 14.7 推荐执行顺序

优先级按“当前线上报错影响”和“Go 已完成程度”排序：

1. A1 个人主页与资料：直接修复当前截图中的个人主页报错。
2. A2 通知中心：消除侧边栏和通知页 KV 报错。
3. A3 反馈墙公开路径：后台已切，公开路径应一起收口。
4. A4 卡牌前台与后台：避免卡牌页面继续触发旧 KV。
5. A5 农场全路径：代码已完成度高，但页面复杂，单独 review。
6. A6 钱包充值与提现：依赖 new-api，放在已确认环境变量后。
7. B1 认证与会话：这是彻底移除旧 KV 的关键路径。
8. B2 签到。
9. B3 公告。
10. B4 彩票与数字炸弹。
11. B5 排行榜与历史奖励。
12. B6 剩余后台工具。
13. C1-C3 全量 Gateway 切流、删除旧 API 和删除 Cloudflare 专用链路。

### 14.8 Zeabur 环境变量收口目标

全量迁完后，生产应保留：

- `PORT=8080`
- `GATEWAY_PORT=8080`
- `WEB_PORT=3000`
- `API_PORT=8081`
- `DATABASE_URL`
- `REDIS_URL`
- `SESSION_SECRET`
- `INTERNAL_API_SECRET`
- `ADMIN_USERNAMES`
- `CRON_SECRET`
- `RAFFLE_DELIVERY_CRON_SECRET`
- `NEW_API_URL`
- `NEW_API_ADMIN_ACCESS_TOKEN`
- `NEW_API_ADMIN_USER_ID`
- `FEEDBACK_MEDIA_DIR=/data/feedback-media`
- `FEEDBACK_MEDIA_PUBLIC_URL`，可选
- `NEXT_PUBLIC_BASE_URL`
- `NODE_ENV=production`

全量迁完后，应删除或不再需要：

- `KV_DB`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- Cloudflare D1 binding
- Cloudflare R2 binding，除非后续明确改为 S3/R2 兼容对象存储
- OpenNext/Workers 生产部署变量
