# Feedback 迁移前置审计

本文记录反馈墙进入阶段 5 后的第一块迁移结果。
当前结论：已完成 PostgreSQL schema、旧 D1/KV 反馈数据导入器、CLI scope 接入、Go 读写 HTTP handler、本地附件存储、后台删除反馈和 Docker 直连冒烟；尚未完成真实 Zeabur 页面级冒烟，因此不能切 Gateway。

## 当前前端依赖

运行：

```bash
node scripts/audit-feedback-cutover.mjs
```

当前脚本确认 `/feedback` 和 `/admin/feedback` 依赖以下业务 API：

- `GET /api/feedback`
- `POST /api/feedback`
- `GET /api/feedback/images/*`
- `HEAD /api/feedback/images/*`
- `GET /api/feedback/{id}`
- `POST /api/feedback/{id}/messages`
- `POST /api/feedback/{id}/like`
- `GET /api/admin/feedback`
- `GET /api/admin/feedback/{id}`
- `PATCH /api/admin/feedback/{id}`
- `DELETE /api/admin/feedback/{id}`
- `POST /api/admin/feedback/{id}/messages`

图片读取仍走 `/api/feedback/images/*`，当前仍属于 Next/Cloudflare 侧逻辑，后续必须单独迁移或替换为 Zeabur 可用的对象存储方案。

## 旧数据来源

反馈墙旧数据来自：

- `kv_data:feedback:item:{feedbackId}`：反馈主体。
- `kv_lists:feedback:messages:{feedbackId}`：反馈留言。
- `kv_sets:feedback:likes:{feedbackId}`：点赞集合。

以下索引 key 仅用于旧 D1/KV 查询加速，本次不直接导入：

- `feedback:index:*`
- `feedback:list`
- `feedback:user:{userId}`

PostgreSQL 会用表索引重建列表能力，不依赖旧 KV 索引。

## PostgreSQL 覆盖范围

新增 `0018_feedback.sql`：

- `feedback_items`：反馈主体、状态、匿名标记、归档时间和原始 JSON。
- `feedback_messages`：反馈留言、角色、附件 JSON 和原始 JSON。
- `feedback_likes`：反馈点赞关系。

索引覆盖：

- 用户反馈列表。
- 后台按状态查看。
- 公开反馈墙按更新时间查看。
- 已归档反馈查看。

## Go API 覆盖范围

已接入 Go 内部路由：

- `GET /api/feedback`
- `POST /api/feedback`
- `GET /api/feedback/{id}`
- `POST /api/feedback/{id}/messages`
- `POST /api/feedback/{id}/like`
- `GET /api/admin/feedback`
- `GET /api/admin/feedback/{id}`
- `PATCH /api/admin/feedback/{id}`
- `DELETE /api/admin/feedback/{id}`
- `POST /api/admin/feedback/{id}/messages`

读路径行为：

- 前台公开墙 `scope=wall` 只返回非匿名、未归档反馈。
- 前台详情中，匿名反馈只有作者本人可读。
- 前台详情只有作者本人能看到联系方式。
- 后台列表和详情要求管理员登录。
- 列表分页、状态过滤、点赞数、本人点赞状态、首条留言、最近管理员回复和回复数均由 PostgreSQL 查询。

写路径当前限制：

- 文本新建反馈会写入 `feedback_items` 和第一条 `feedback_messages`。
- 用户留言、点赞、后台改状态和后台回复已接入 PostgreSQL。
- 后台删除反馈会硬删除 `feedback_items`，并通过 PostgreSQL 外键级联删除 `feedback_messages` 和 `feedback_likes`。
- 文本留言会同步更新反馈状态，并写入 `feedback_reply` / `feedback_status` 通知。
- 带附件的新建反馈和留言会通过 `FEEDBACK_MEDIA_DIR` 写入本地媒体目录，并返回 `/api/feedback/images/feedback/...` URL。
- `GET/HEAD /api/feedback/images/*` 会从 `FEEDBACK_MEDIA_DIR` 读取附件，并设置长期缓存头。
- 如果 `FEEDBACK_MEDIA_PUBLIC_URL` 已配置，写入结果会返回该外部公共 URL 前缀；未配置时返回 Go API 内部读取路由。

## D1 导入

已新增：

- `PlanFeedbackImport`
- `ApplyFeedbackImport`
- `migrate-d1 -apply -scope feedback`

导入策略：

- 反馈主体导入到 `feedback_items`。
- 留言导入到 `feedback_messages`，目标反馈不存在时跳过并 warning。
- 点赞导入到 `feedback_likes`，目标反馈不存在时跳过并 warning。
- 反馈作者和点赞用户会创建占位 `users` 行。
- 重复执行同一导入应保持 upsert 幂等。

真实导入命令：

```bash
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL" -apply -scope feedback
```

## 当前不切流原因

当前已精确打开 `/api/admin/feedback` 与 `/api/admin/feedback/*`，用于后台反馈部署测试；暂不打开公开 `/api/feedback*` Gateway 规则，原因是：

- 生产侧仍需决定反馈附件使用 Zeabur 挂载卷，还是继续补 S3/R2 实现。
- 尚未用真实用户 Cookie 做公开 `/feedback` 页面级冒烟。

## Review 命令

```bash
node --check scripts/audit-feedback-cutover.mjs
node scripts/audit-feedback-cutover.mjs
node --check scripts/audit-migrate-d1-scopes.mjs
node scripts/audit-migrate-d1-scopes.mjs
go test ./internal/migration/d1 -run 'Feedback|Analyze' -count=1
go test ./internal/feedback ./internal/httpserver -run Feedback -count=1
node scripts/smoke-feedback-go-api.mjs
```

如果有 `TEST_DATABASE_URL`，补充运行：

```bash
go test -tags integration ./internal/migration/d1 -run Feedback -count=1
go test -tags integration ./internal/httpserver -run Feedback -count=1
```

## 下一步

1. 决定生产反馈附件使用 Zeabur 挂载卷，还是继续补 S3/R2 实现。
2. 使用真实导入和真实登录态完成 API 与页面冒烟后，再评估精确 Gateway 切流。

## Docker 直连冒烟

`scripts/smoke-feedback-go-api.mjs` 会直连本地 Docker Go API 容器，并通过 PostgreSQL 种子数据覆盖：

- 未登录读写返回 401。
- `POST /api/feedback` 新建反馈。
- `GET /api/feedback?scope=wall` 公开墙列表。
- `GET /api/feedback/{id}` 详情。
- `POST /api/feedback/{id}/like` 点赞。
- `POST /api/feedback/{id}/messages` 用户评论。
- `POST /api/admin/feedback/{id}/messages` 管理员回复。
- `PATCH /api/admin/feedback/{id}` 管理员状态更新。
- `DELETE /api/admin/feedback/{id}` 管理员删除反馈。

脚本会校验 `feedback_items`、`feedback_messages`、`feedback_likes` 和 `notifications` 写入结果，并清理 smoke 用户、反馈和通知数据。
