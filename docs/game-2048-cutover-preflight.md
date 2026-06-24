# 2048 Cutover Preflight

当前结论：PR #9 新增的 2048 游戏已完成 Go 纯规则引擎、PostgreSQL 服务层、Go 内部 HTTP 路由、真实 PostgreSQL integration 和 Docker 直连 Go API 冒烟；Gateway 已精确切流 `status/start/checkpoint/submit/cancel`，仍禁止 `/api/games/2048/*` 和 `/api/games/*` 通配。

## 已完成

- 新增 `backend/internal/game2048` 包。
- 迁移 5x5 2048 核心规则：
  - 种子刷块。
  - 上下左右移动。
  - 单次合并规则。
  - 服务端重放模拟。
  - 最高方块、胜利、死局判断。
  - 积分奖励计算。
- 单元测试覆盖 PR #9 TypeScript 规则里的固定种子期望值。
- Go 服务层接管 `start/status/checkpoint/submit/cancel`。
- `checkpoint` 会把分段进度写回 `game_sessions` payload。
- `submit` 会基于 checkpoint 继续服务端重放，写入 `game_records`、`game_daily_stats`、`daily_game_points` 和 `point_ledger`。
- 重复 `submit` 会回放已结算记录，不重复发积分。
- Docker 直连 smoke 覆盖未登录、`status/start/checkpoint/submit/cancel`、重复提交回放、积分只发一次和清理验证。
- Go 内部路由已注册：
  - `GET /api/games/2048/status`
  - `POST /api/games/2048/start`
  - `POST /api/games/2048/checkpoint`
  - `POST /api/games/2048/submit`
  - `POST /api/games/2048/cancel`

## Gateway 规则

允许保留：

- `/api/games/2048/status`
- `/api/games/2048/start`
- `/api/games/2048/checkpoint`
- `/api/games/2048/submit`
- `/api/games/2048/cancel`

禁止添加以下规则：

- `/api/games/2048/*` 通配
- `/api/games/*`

## Review 命令

```bash
go test ./internal/game2048
TEST_DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go test -tags integration ./internal/httpserver -run Game2048 -count=1
node scripts/smoke-game-2048-go-api.mjs
node --check scripts/audit-game-2048-cutover.mjs
node scripts/audit-game-2048-cutover.mjs
```
