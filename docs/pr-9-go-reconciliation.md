# PR #9 Go 迁移补接清单

## 当前结论

PR #9 仍是 GitHub 上的 open PR，尚未 merge 到 `main`。
当前 Zeabur GHCR 镜像从 `main` 构建，因此 PR #9 里的部分后台优化和兼容性改动不会出现在部署环境。

不能直接 merge PR #9：该 PR 基于旧 Cloudflare/Next 架构，直接合并会删除当前 `backend/`、Docker、Zeabur 文档和审计脚本等迁移成果。
正确策略是按功能逐块 cherry-pick/移植，并把涉及旧 Next API 的部分改成 Go/PostgreSQL/Redis。

## 已经接入或已有 Go 替代的部分

- 2048 素材已在 `main`。
- `src/app/games/2048/page.tsx` 已在 `main`，但与 PR #9 仍有差异，需单独复核。
- `backend/internal/game2048` 已实现 Go 规则、服务层和 HTTP handler。
- Gateway 已精确切流：
  - `/api/games/2048/status`
  - `/api/games/2048/start`
  - `/api/games/2048/checkpoint`
  - `/api/games/2048/submit`
  - `/api/games/2048/cancel`
- PR #9 后台 API 的 Go 替代已部分实现并切流：
  - `/api/admin/eco`
  - `/api/admin/points`
  - `/api/admin/users`
  - `/api/admin/users/*`
  - `/api/admin/dashboard`
  - `/api/admin/projects`
  - `/api/admin/projects/*`
  - `/api/admin/feedback`
  - `/api/admin/feedback/*`
- PR #9 后台环保入口和页面已补接到 `main`：
  - `src/components/admin/AdminSidebar.tsx`
  - `src/app/admin/eco/page.tsx`
- PR #9 浏览器兼容层已补接到 `main`：
  - `src/components/BrowserCompatibility.tsx`
  - `src/app/layout.tsx`
  - `src/app/globals.css`
- PR #9 后台项目自动暂停已迁到 Go 并补接页面：
  - `backend/migrations/0028_project_auto_pause.sql`
  - `backend/internal/welfare/admin_project.go`
  - `backend/internal/httpserver/welfare_handlers.go`
  - `backend/internal/worker/worker.go`
  - `src/app/admin/page.tsx`
  - `src/lib/time.ts`
- PR #9 后台反馈删除入口已补接到 `main`：
  - `src/app/admin/feedback/page.tsx`

## 当前仍缺的 PR #9 前端/页面改动

优先补接这些，因为用户在 Zeabur 部署里看不到的“后台优化”主要来自这里：

- `src/app/admin/dashboard/page.tsx`
- `src/app/admin/users/page.tsx`
- `src/app/admin/project/[id]/page.tsx`
- `src/app/admin/raffle/page.tsx`
- `src/app/admin/raffle/[id]/page.tsx`
- `src/app/admin/raffle/create/page.tsx`
- `src/app/admin/announcements/page.tsx`
- `src/components/MarkdownPreview.tsx`

补接要求：

1. 页面可直接使用已切到 Go 的后台 API 时，优先保留页面改动。
2. 页面依赖尚未 Go 化的 API 时，先标记阻塞，不把旧 KV 写路径带进生产。
3. 每个后台页面补接后必须做页面级 smoke 或至少 API mock/未登录边界验证。

## 当前仍缺的 PR #9 API/运行时改动

这些文件仍在 PR #9 与当前 `main` 的差异里，不能原样接入，需要逐个判断是否要迁成 Go：

- `src/app/api/internal/scheduled-maintenance/route.ts`
- `src/app/api/games/fallback/route.ts`
- `src/app/api/auth/me/route.ts`
- `src/app/api/announcements/route.ts`
- `src/app/api/notifications/route.ts`
- `src/app/api/store/topup/route.ts`
- `src/app/api/store/withdraw/route.ts`
- `src/app/games/_lib/fallback.ts`
- `src/lib/game-fallback.ts`

处理原则：

1. `auth/me` 属于第 14 节 B1 认证与会话迁移范围，不继续加固旧 Next/KV。
2. `announcements` 属于第 14 节 B3 公告迁移范围，需要 Go API 和 PostgreSQL 表。
3. `notifications` 已有 Go 实现，优先通过 A2 切流，不再补旧 Next 优化。
4. `store/topup`、`store/withdraw` 属于 A6 钱包切流范围，依赖 new-api 环境变量确认。
5. `scheduled-maintenance` 应改为 Go Worker 任务或 CLI，不作为生产 Next API 暴露。
6. `games/fallback` 和 `game-fallback` 需要先确认前端降级价值，再决定是否保留为纯前端工具或迁到 Go。

## 当前仍缺的 PR #9 游戏与业务库改动

这些是旧 TypeScript 业务层的优化，不能盲目覆盖，因为当前高频路径已经由 Go 接管：

- `src/lib/memory.ts`
- `src/lib/match3.ts`
- `src/lib/whack-mole.ts`
- `src/lib/minesweeper.ts`
- `src/lib/linkgame-server.ts`
- `src/lib/roguelite.ts`
- `src/lib/game-2048.ts`
- `src/lib/eco.ts`
- `src/lib/eco-engine.ts`
- `src/lib/farm-v2/index.ts`
- `src/lib/wallet.ts`
- `src/lib/points.ts`
- `src/lib/raffle.ts`
- `src/lib/notifications.ts`
- `src/lib/anomaly-detector.ts`
- `src/lib/hot-d1.ts`
- `src/lib/kv.ts`
- `src/lib/new-api.ts`
- `src/lib/profile.ts`
- `src/lib/rankings.ts`
- `src/lib/feedback.ts`
- `src/lib/time.ts`

处理原则：

1. 已经由 Go 接管的结算逻辑，不把 TypeScript 旧逻辑重新变成权威实现。
2. 如果 PR #9 修的是前端展示兼容、请求重试、降级提示，可以移植到页面层。
3. 如果 PR #9 修的是旧 KV 并发、补偿、发奖逻辑，应迁移到对应 Go service 或 worker。
4. 每个迁移点都必须补 Go 测试或 smoke，不以 TypeScript 旧测试通过作为生产切流依据。

## 建议补接顺序

1. 后台导航和页面可见性：
   - `AdminSidebar`
   - `/admin`
   - `/admin/eco`
2. 已有 Go API 支撑的后台页：
   - `/admin/dashboard`
   - `/admin/users`
   - `/admin/projects`
   - `/admin/feedback`
   - `/admin/raffle`
3. 通用前端组件：
   - `BrowserCompatibility`
   - `MarkdownPreview`
4. 2048 前端差异复核：
   - `src/app/games/2048/page.tsx`
   - `src/lib/game-2048.ts`
   - `src/lib/__tests__/game-2048.test.ts`
5. 通知、公告、认证、钱包等 API 改动按第 14 节 A/B 阶段迁到 Go。
6. scheduled maintenance 改为 Go Worker，不接旧 Next route。

## 每小块 review 要求

每接一块 PR #9 内容，都要记录：

1. 来源文件：PR #9 中对应文件。
2. 接入方式：原样移植、改写为 Go、只保留前端、或放弃。
3. API 归属：Go、Next 页面辅助、或待迁移。
4. 验证命令：typecheck、Go test、模块 smoke 或页面 smoke。
5. 部署影响：是否需要重新构建 GHCR 镜像，是否需要新环境变量。
