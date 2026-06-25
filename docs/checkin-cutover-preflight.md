# 签到 Go 切流预检

本文记录 `/api/checkin` 与 `/api/checkin/makeup` 的 Go 迁移证据。

当前结论：签到状态、每日签到和补签已由 Go API + PostgreSQL 接管，Gateway 只开放两个精确路径，禁止 `/api/checkin*` 通配。

## 切流路径

- `GET /api/checkin`
- `POST /api/checkin`
- `POST /api/checkin/makeup`

## 数据源

- `checkin_records`：签到事实表，按 `(user_id, checkin_date)` 唯一。
- `user_assets.extra_spins`：签到和补签发放额外抽奖次数。
- `user_assets.makeup_cards`：补签消耗。
- `point_accounts` 与 `point_ledger`：签到积分入账和流水。

## 幂等与并发

- 每日签到先插入 `checkin_records` 占位，唯一冲突直接返回“今天已经签到过了”，不会重复发积分或抽奖次数。
- 补签同样依赖 `(user_id, checkin_date)` 唯一键，事务内扣补签卡、加抽奖次数、加积分。
- Go 服务使用可重试事务处理 PostgreSQL 可重试冲突。

## Review 命令

```bash
node --check scripts/audit-checkin-cutover.mjs
node --check scripts/smoke-checkin-go-api.mjs
node scripts/audit-checkin-cutover.mjs
go test ./internal/checkin ./internal/httpserver -run Checkin -count=1
TEST_DATABASE_URL=postgres://app:app@127.0.0.1:5432/app?sslmode=disable go test -tags=integration ./internal/checkin -count=1
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
node scripts/smoke-checkin-go-api.mjs
```

## 回滚方式

如签到页面异常：

1. 临时移除 `gateway/Caddyfile` 中 `/api/checkin` 与 `/api/checkin/makeup` 两个精确规则，让请求回到 Web/Next。
2. 复跑 Gateway 双门禁，确认没有误开通配。
3. 保留 PostgreSQL 表，不需要删除数据；修复后可重新切回 Go。
