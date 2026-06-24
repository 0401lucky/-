# Go 后端迁移骨架

这个目录用于承载 Zeabur 上的 Go API 与 Go Worker。

当前状态：

- 已实现 `/healthz`
- 已实现 `/readyz`
- 已接入 PostgreSQL 与 Redis
- 已提供现有 Next HMAC Session 的解析基础包
- 已实现积分查询、商城核心、商城后台、钱包充值/提现内部路由
- 已实现公开项目、抽奖公开/后台、环保行动、环保排行榜、游戏中心聚合
- 已实现记忆、消消乐、打地鼠、扫雷、连连看、Roguelite 普通游戏结算
- 已实现 profile、notifications、farm、cards、admin cards 的 Go 内部路由和本地门禁
- 已新增钱包交易审计表、Redis 用户级钱包操作锁和 new-api 管理端 client
- 尚未完成真实导入/真实 Cookie/页面级 review 的业务仍禁止切到 Gateway
- 游戏和环保等子路由保留 `NOT_MIGRATED` fallback，不要将完整生产业务通配前缀切到 Go

本地运行：

```bash
go run ./cmd/migrate -dry-run
go run ./cmd/api
go run ./cmd/worker
go run ./cmd/migrate-d1 -input ./d1-export.sql
DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go run ./cmd/migrate-d1 -input ./d1-export.sql -apply -scope public-lists
DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go run ./cmd/migrate-d1 -input ./d1-export.sql -apply -scope users-points
DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go run ./cmd/migrate-d1 -input ./d1-export.sql -apply -scope points-history
DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go run ./cmd/migrate-d1 -input ./d1-export.sql -apply -scope store-data
DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go run ./cmd/migrate-d1 -input ./d1-export.sql -apply -scope user-assets
DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go run ./cmd/migrate-d1 -input ./d1-export.sql -apply -scope user-profiles
DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go run ./cmd/migrate-d1 -input ./d1-export.sql -apply -scope user-achievements
DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go run ./cmd/migrate-d1 -input ./d1-export.sql -apply -scope notifications
DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go run ./cmd/migrate-d1 -input ./d1-export.sql -apply -scope reward-claims
DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go run ./cmd/migrate-d1 -input ./d1-export.sql -apply -scope raffle-entries
DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go run ./cmd/migrate-d1 -input ./d1-export.sql -apply -scope eco-state
DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go run ./cmd/migrate-d1 -input ./d1-export.sql -apply -scope eco-global
DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go run ./cmd/migrate-d1 -input ./d1-export.sql -apply -scope farm-v2
DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go run ./cmd/migrate-d1 -input ./d1-export.sql -apply -scope cards
DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go run ./cmd/migrate-d1 -input ./d1-export.sql -apply -scope feedback
```

PostgreSQL 集成并发测试：

```bash
TEST_DATABASE_URL=postgres://app:app@localhost:5432/app_test?sslmode=disable go test -tags integration ./internal/economy
```

集成测试会写入 `TEST_DATABASE_URL` 指向的数据库，只能指向临时测试库。

必要环境变量：

```env
DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable
REDIS_URL=redis://localhost:6379/0
SESSION_SECRET=replace-with-a-long-random-secret-at-least-32-chars
ADMIN_USERNAMES=admin,lucky
INTERNAL_API_SECRET=replace-with-a-random-internal-secret
```

迁移脚本和业务模块会按 `docs/go-zeabur-refactor-plan.md` 继续补齐。

Docker 运行：

```bash
docker compose up --build
docker compose run --rm api /app/migrate
docker compose run --rm api /app/migrate-d1 -input /path/in/container/d1-export.sql
docker compose run --rm api /app/migrate-d1 -input /path/in/container/d1-export.sql -apply -scope public-lists
docker compose run --rm api /app/migrate-d1 -input /path/in/container/d1-export.sql -apply -scope users-points
docker compose run --rm api /app/migrate-d1 -input /path/in/container/d1-export.sql -apply -scope points-history
docker compose run --rm api /app/migrate-d1 -input /path/in/container/d1-export.sql -apply -scope store-data
docker compose run --rm api /app/migrate-d1 -input /path/in/container/d1-export.sql -apply -scope user-assets
docker compose run --rm api /app/migrate-d1 -input /path/in/container/d1-export.sql -apply -scope user-profiles
docker compose run --rm api /app/migrate-d1 -input /path/in/container/d1-export.sql -apply -scope user-achievements
docker compose run --rm api /app/migrate-d1 -input /path/in/container/d1-export.sql -apply -scope notifications
docker compose run --rm api /app/migrate-d1 -input /path/in/container/d1-export.sql -apply -scope reward-claims
docker compose run --rm api /app/migrate-d1 -input /path/in/container/d1-export.sql -apply -scope raffle-entries
docker compose run --rm api /app/migrate-d1 -input /path/in/container/d1-export.sql -apply -scope eco-state
docker compose run --rm api /app/migrate-d1 -input /path/in/container/d1-export.sql -apply -scope eco-global
docker compose run --rm api /app/migrate-d1 -input /path/in/container/d1-export.sql -apply -scope farm-v2
docker compose run --rm api /app/migrate-d1 -input /path/in/container/d1-export.sql -apply -scope cards
docker compose run --rm api /app/migrate-d1 -input /path/in/container/d1-export.sql -apply -scope feedback
```

注意：`migrate-d1 -apply` 当前开放以下范围：

- `public-lists`：写入 `projects` 和 `raffles` 公开列表表。
- `users-points`：写入 `users` 和 `point_accounts`；同一用户同时存在
  `native_user_points` 与 legacy `points:*` 时，优先使用 native 余额。
- `points-history`：写入 `point_ledger` 和 `daily_game_points`；缺失用户时会
  创建占位用户以满足外键约束。
- `store-data`：写入 `store_categories`、`store_items`、`exchange_logs` 和
  `store_daily_purchases`；缺失用户会创建占位用户，缺失商品的每日限购计数会
  跳过并输出 warning。
- `user-assets`：写入 `user_assets`；`native_user_assets` /
  `native_user_cards` 优先于对应 legacy key，`user:makeup_cards:*` 继续作为补签卡来源。
- `user-profiles`：写入 `user_profiles`，并补齐缺失用户。
- `user-achievements`：写入用户成就授权、强制成就和佩戴状态。
- `notifications`：写入通知列表。
- `reward-claims`：写入奖励批次和领取状态。
- `raffle-entries`：写入抽奖参与记录。
- `eco-state`：写入环保用户状态、升级、库存、奖品批次、可见奖品和道具购买记录。
- `eco-global`：写入环保全局库存、公示奖品、偷盗、领奖统计和垃圾排行榜。
- `farm-v2`：写入农场状态、每日购买和邮件去重记录。
- `cards`：写入卡牌用户状态、规则、自定义卡册奖励和稀有度奖励。
- `feedback`：写入反馈墙主体、留言和点赞记录。

真实生产导入前仍必须先执行 dry-run，并按 `docs/production-cutover-readiness.md`
核对真实 D1 导出、真实样本 Cookie 和页面级 review。

部署前总预检：

```bash
node scripts/preflight-zeabur-go-api.mjs
ZEABUR_PREFLIGHT_INCLUDE_INTERNAL=1 node scripts/preflight-zeabur-go-api.mjs
node scripts/audit-production-cutover-readiness.mjs
```

这些脚本只做审计和本地门禁，不会自动打开 Gateway 切流规则。
