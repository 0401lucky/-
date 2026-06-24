# Admin Eco 内部迁移前置审计

本文记录 PR #9 后台环保管理接口 `/api/admin/eco` 的 Go 迁移证据。

当前结论：Go 内部 API 已覆盖后台环保管理页需要的 `GET` 概览和 `PATCH` 奖品概率配置；Gateway 已精确切流 `/api/admin/eco`，仍禁止 `/api/admin/*` 通配。

## Go 覆盖范围

- `GET /api/admin/eco`
  - 返回 `generatedAt`。
  - 返回 `prizes`，包含奖品默认概率、当前概率、全服限量、持有人、库存和批次。
  - 返回 `thefts`，包含偷盗双方、留言、状态和奖品信息。
  - 返回 `manualTrash`，从 PostgreSQL `eco_trash_rankings` 聚合近 7 天每日环保回收量。
- `PATCH /api/admin/eco`
  - 接收 `prizeRates`。
  - 校验单项概率必须在 0 到 1。
  - 校验 5 个奖品概率合计不能超过 1。
  - 写入 `eco_prize_rate_settings`。
  - 在线奖品生成和状态响应均读取该配置。

## PostgreSQL 迁移

- `0019_eco_admin_settings.sql`
  - 新增 `eco_prize_rate_settings`。
  - 只保存覆盖值，未配置奖品回退到 Go 默认概率。

## Review 命令

```bash
node --check scripts/audit-admin-eco-cutover.mjs
node --check scripts/smoke-admin-eco-go-api.mjs
node scripts/audit-admin-eco-cutover.mjs
go test ./internal/eco ./internal/httpserver -run 'Eco|Admin' -count=1
TEST_DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go test -tags integration ./internal/eco -run AdminEco -count=1
node scripts/smoke-admin-eco-go-api.mjs
```

## Gateway 状态

允许保留：

```caddyfile
handle /api/admin/eco {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/admin/* {
	reverse_proxy api:8080
}
```

部署测试阶段只允许保留精确切流 `/api/admin/eco`，禁止新增 `/api/admin/*`。

## 回滚步骤

如后台环保概率保存或概览异常：

1. 临时移除 Gateway 中 `/api/admin/eco` 精确规则，让该路径回到 Web/Next。
2. 回退 Go `server.go` 中 `/api/admin/eco` 内部路由。
3. 如需回退配置，清空或恢复 `eco_prize_rate_settings` 对应奖品行。
4. 复跑 `node scripts/audit-admin-eco-cutover.mjs`，确认 Gateway 仍未打开该路径。
