# 钱包与站内 VIP 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建独立钱包页 `/wallet`（迁走 `/store` 的提现充值弹窗、补齐交易流水、新增每日提现限次），并新建时长制站内 VIP 月卡（三项特权 + 累计时长上限），所有数值后台可改。

**Architecture:** 新建 `backend/internal/vip` 包只提供「查状态 + 续期」两个无状态函数，购买用例放在 `economy` 包以避免 `vip ↔ economy` 循环依赖。提现限次与手续费折扣接进既有的 `executeWithdrawInner`（它外层已有 Redis 操作锁）；VIP 购买接进 `withRetryableTx` 事务并复用 `ExchangeItem` 的幂等范式。前端新建 `/wallet` 页承载全部资金操作，`/store` 只留一个跳转入口。

**Tech Stack:** Go 1.x + pgx/v5 + PostgreSQL（goose 风格迁移，自研 runner）；Next.js App Router + TypeScript + React 客户端组件；Caddy 网关；vitest（前端）+ `go test`（后端，集成测试用 `//go:build integration`）。

**Spec:** `docs/superpowers/specs/2026-08-31-wallet-and-vip-design.md`

## Global Constraints

- **一切自然语言输出必须是简体中文**：提交信息、代码注释、UI 文案、错误提示、日志。代码标识符沿用项目既有英文命名。
- **迁移文件不得包含 `DO $$ ... $$` 块或任何含分号的函数体**。`backend/internal/migration/postgres/runner.go` 的 `splitStatements` 按 `;` 朴素切分 SQL，会把它们切碎。只写简单语句。`ADD CONSTRAINT` 没有 `IF NOT EXISTS`，靠 `schema_migrations` 表保证只执行一次。
- **`systemconfig.Update` 的「nil → 重置为默认值」语义不改**（`backend/internal/systemconfig/service.go:66-69` 的既有行为）。因此 `/admin/settings` 的 `handleSave` **必须一次性提交全部 8 个字段**，漏提交的字段会被静默重置。
- **`previewWithdraw` 前后端双实现必须逐字对齐**：同样的乘法顺序、同样的 `/ 100` 位置、同样的 `ceil`。偏差会在边界值上造成 ±1 积分的预览差异。
- **网关只加精确路径，禁止通配**。`gateway/Caddyfile` 与 `scripts/audit-gateway-allowed-cutovers.mjs` 白名单必须同步，审计脚本必须 `ok: true`。
- **`TEST_DATABASE_URL` 必须指向独立测试库，绝对不能指向开发库 `app`**。本计划新增的集成测试会对相关表做清理性写入。动手前先建独立测试库。
- **集成测试文件必须带 `//go:build integration` 构建标签**，并在 `TEST_DATABASE_URL` 为空时 `t.Skip`。
- **VIP 时长加法统一用固定时长 `24h × days`**，与 `vip.Extend` 的 SQL `days * INTERVAL '1 day'` 对齐。禁止用 `time.AddDate`。
- **提现每日限次对管理员同样生效**，不做 `IsAdmin` bypass（抽奖的 bypass 是既有行为，保持不动）。

## 改动前既已存在的失败（不在本计划修复范围，不要试图修）

- `npm test` 有 2 个 vitest 超时（`lucky-td` / `piano-tiles` golden vector）
- `TestAdminCardReadHandlersReturnLegacyShapes`（开发库脏数据导致）
- `scripts/audit-lottery-cutover.mjs` 自 commit `d8505c8` 起损坏（依赖已删除的 `src/lib/lottery.ts`）

---

## File Structure

### 新增

| 文件 | 责任 |
|---|---|
| `backend/migrations/0032_wallet_daily_withdrawals.sql` | 每日提现次数表 |
| `backend/migrations/0033_vip.sql` | VIP 会籍与购买流水表 |
| `backend/migrations/0034_system_config_wallet_vip.sql` | 后台配置 7 列 |
| `backend/migrations/0035_lottery_free_spins.sql` | 抽奖免费次数计数化 |
| `backend/internal/vip/vip.go` | `Status` / `Get` / `GetExpiry` / `Extend`，仅此四个导出符号 |
| `backend/internal/vip/vip_integration_test.go` | 续期与累加的集成测试 |
| `backend/internal/economy/wallet_limit.go` | 提现限次的读取、校验、计数与时区 helper |
| `backend/internal/economy/wallet_limit_test.go` | 时区与限次纯函数的单元测试 |
| `backend/internal/economy/wallet_limit_integration_test.go` | 限次的集成测试 |
| `backend/internal/economy/vip_purchase.go` | `PurchaseVIP` + `vipPurchaseWindow` 纯函数 |
| `backend/internal/economy/vip_purchase_test.go` | `vipPurchaseWindow` 边界的单元测试 |
| `backend/internal/economy/vip_purchase_integration_test.go` | 购买、累加、上限、幂等的集成测试 |
| `backend/internal/systemconfig/service_test.go` | 7 个校验函数与跨字段校验的单元测试 |
| `src/lib/__tests__/wallet-rules.test.ts` | 与 Go 共用同一组输入输出向量 |
| `src/app/wallet/page.tsx` | 钱包页 |

### 修改

| 文件 | 改动 |
|---|---|
| `backend/internal/economy/wallet.go` | `PreviewWithdraw` 加 `feePercent` 参数 |
| `backend/internal/economy/wallet_test.go` | 既有用例补 `100` 参数；新增折扣向量 |
| `backend/internal/economy/wallet_service.go` | `executeWithdrawInner` 接入限次与折扣 |
| `backend/internal/economy/wallet_store.go` | 新增 `ListWalletTransactions` |
| `backend/internal/economy/wallet_overview.go`（新） | `GetWalletOverview` 聚合 |
| `backend/internal/economy/types.go` | `SourceVIPPurchase` 常量 |
| `backend/internal/systemconfig/service.go` | 7 个字段、7 个校验函数、1 个跨字段校验函数 |
| `backend/internal/lottery/service.go` | `consumeSpinCount` / `spinPointsOnceInTx` / `spinPointsTimes` / `dailySpinUsage` / `PagePayload` |
| `backend/internal/lottery/types.go` | `PagePayload` 两个新字段 |
| `backend/internal/lottery/service_integration_test.go` | 补 `free_used_count` 断言 |
| `backend/internal/httpserver/economy_handlers.go` | 3 个新 handler |
| `backend/internal/httpserver/admin_config_handlers.go` | 7 个字段的解析与校验 |
| `backend/internal/httpserver/lottery_handlers.go` | 下发 2 个新字段 |
| `backend/internal/httpserver/server.go` | 3 条路由 |
| `gateway/Caddyfile` | 3 条精确路径 |
| `scripts/audit-gateway-allowed-cutovers.mjs` | 白名单 3 条 |
| `src/lib/wallet-rules.ts` | `previewWithdraw` 加 `feePercent` |
| `src/app/store/page.tsx` | 摘除钱包弹窗 |
| `src/app/lottery/page.tsx` | 免费次数 pill 与乐观更新 |
| `src/app/admin/settings/page.tsx` | 新增配置区块 |

---

### Task 1: 数据库迁移

**Files:**
- Create: `backend/migrations/0032_wallet_daily_withdrawals.sql`
- Create: `backend/migrations/0033_vip.sql`
- Create: `backend/migrations/0034_system_config_wallet_vip.sql`
- Create: `backend/migrations/0035_lottery_free_spins.sql`

**Interfaces:**
- Consumes: 既有表 `users`、`system_config`、`lottery_daily_spins`
- Produces: 表 `wallet_daily_withdrawals(user_id, withdraw_date, used_count, updated_at)`；表 `vip_memberships(user_id, expires_at, created_at, updated_at)`；表 `vip_purchases(id, user_id, points_cost, days, expires_at_before, expires_at_after, created_at)`；`system_config` 新增 7 列 `daily_withdraw_limit` / `vip_daily_withdraw_limit` / `vip_price_points` / `vip_duration_days` / `vip_withdraw_fee_percent` / `vip_daily_lottery_spins` / `vip_max_total_days`；`lottery_daily_spins` 新增列 `free_used_count`

- [ ] **Step 1: 创建 `0032_wallet_daily_withdrawals.sql`**

结构对齐 `lottery_daily_spins` 的既有范式。

```sql
-- +goose Up
CREATE TABLE IF NOT EXISTS wallet_daily_withdrawals (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  withdraw_date DATE NOT NULL,
  used_count BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, withdraw_date),
  CHECK (user_id > 0),
  CHECK (used_count >= 0)
);

-- +goose Down
DROP TABLE IF EXISTS wallet_daily_withdrawals;
```

- [ ] **Step 2: 创建 `0033_vip.sql`**

会籍单行记录当前到期时间，不存历史；到期不删行（保留续费时的历史锚点），只是判定为非 VIP。

```sql
-- +goose Up
CREATE TABLE IF NOT EXISTS vip_memberships (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id > 0)
);

CREATE INDEX IF NOT EXISTS idx_vip_memberships_expires_at
  ON vip_memberships(expires_at DESC);

CREATE TABLE IF NOT EXISTS vip_purchases (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points_cost BIGINT NOT NULL,
  days BIGINT NOT NULL,
  expires_at_before TIMESTAMPTZ,
  expires_at_after TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id <> ''),
  CHECK (user_id > 0),
  CHECK (points_cost > 0),
  CHECK (days > 0)
);

CREATE INDEX IF NOT EXISTS idx_vip_purchases_user_created_at
  ON vip_purchases(user_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS vip_purchases;
DROP TABLE IF EXISTS vip_memberships;
```

- [ ] **Step 3: 创建 `0034_system_config_wallet_vip.sql`**

最后两条 CHECK 是跨列约束的兜底：若 `vip_max_total_days < vip_duration_days`，非 VIP 用户第一次购买就会被上限拒绝（0 + 30 > 20），功能直接不可用。

```sql
-- +goose Up
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS daily_withdraw_limit BIGINT NOT NULL DEFAULT 4;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_daily_withdraw_limit BIGINT NOT NULL DEFAULT 8;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_price_points BIGINT NOT NULL DEFAULT 3000;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_duration_days BIGINT NOT NULL DEFAULT 30;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_withdraw_fee_percent BIGINT NOT NULL DEFAULT 50;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_daily_lottery_spins BIGINT NOT NULL DEFAULT 2;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_max_total_days BIGINT NOT NULL DEFAULT 365;

ALTER TABLE system_config ADD CONSTRAINT system_config_daily_withdraw_limit_check
  CHECK (daily_withdraw_limit BETWEEN 1 AND 100);
ALTER TABLE system_config ADD CONSTRAINT system_config_vip_daily_withdraw_limit_check
  CHECK (vip_daily_withdraw_limit BETWEEN 1 AND 100);
ALTER TABLE system_config ADD CONSTRAINT system_config_vip_price_points_check
  CHECK (vip_price_points BETWEEN 1 AND 1000000);
ALTER TABLE system_config ADD CONSTRAINT system_config_vip_duration_days_check
  CHECK (vip_duration_days BETWEEN 1 AND 365);
ALTER TABLE system_config ADD CONSTRAINT system_config_vip_withdraw_fee_percent_check
  CHECK (vip_withdraw_fee_percent BETWEEN 0 AND 100);
ALTER TABLE system_config ADD CONSTRAINT system_config_vip_daily_lottery_spins_check
  CHECK (vip_daily_lottery_spins BETWEEN 0 AND 50);
ALTER TABLE system_config ADD CONSTRAINT system_config_vip_max_total_days_check
  CHECK (vip_max_total_days BETWEEN 1 AND 3650);
ALTER TABLE system_config ADD CONSTRAINT system_config_vip_max_total_days_gte_duration_check
  CHECK (vip_max_total_days >= vip_duration_days);

-- +goose Down
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_max_total_days_gte_duration_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_max_total_days_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_daily_lottery_spins_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_withdraw_fee_percent_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_duration_days_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_price_points_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_daily_withdraw_limit_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_daily_withdraw_limit_check;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_max_total_days;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_daily_lottery_spins;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_withdraw_fee_percent;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_duration_days;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_price_points;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_daily_withdraw_limit;
ALTER TABLE system_config DROP COLUMN IF EXISTS daily_withdraw_limit;
```

- [ ] **Step 4: 创建 `0035_lottery_free_spins.sql`**

```sql
-- +goose Up
ALTER TABLE lottery_daily_spins ADD COLUMN IF NOT EXISTS free_used_count BIGINT NOT NULL DEFAULT 0;
UPDATE lottery_daily_spins SET free_used_count = 1 WHERE daily_free_claimed AND free_used_count = 0;
ALTER TABLE lottery_daily_spins ADD CONSTRAINT lottery_daily_spins_free_used_count_check
  CHECK (free_used_count >= 0);

-- +goose Down
ALTER TABLE lottery_daily_spins DROP CONSTRAINT IF EXISTS lottery_daily_spins_free_used_count_check;
ALTER TABLE lottery_daily_spins DROP COLUMN IF EXISTS free_used_count;
```

- [ ] **Step 5: 应用迁移并验证**

任一既有集成测试都会在启动时 `Apply` 全部迁移，用它来跑通迁移。

Run:
```bash
cd backend && TEST_DATABASE_URL="<独立测试库连接串>" go test -tags=integration ./internal/economy/ -run TestExchangeItemDuplicateIdempotencyKey -v
```
Expected: PASS（迁移无语法错误）

- [ ] **Step 6: 确认 schema 落地**

Run:
```bash
psql "<独立测试库连接串>" -c "\d wallet_daily_withdrawals" -c "\d vip_memberships" -c "\d vip_purchases" -c "SELECT daily_withdraw_limit, vip_daily_withdraw_limit, vip_price_points, vip_duration_days, vip_withdraw_fee_percent, vip_daily_lottery_spins, vip_max_total_days FROM system_config WHERE id = 'system';" -c "SELECT free_used_count FROM lottery_daily_spins LIMIT 1;"
```
Expected: 三张表结构正确；7 个配置列可查（无 system_config 行时返回 0 行也算通过，默认值由 `systemconfig.Get` 兜底）；`free_used_count` 列存在。

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/0032_wallet_daily_withdrawals.sql backend/migrations/0033_vip.sql backend/migrations/0034_system_config_wallet_vip.sql backend/migrations/0035_lottery_free_spins.sql
git commit -m "feat: 新增钱包限次、VIP 会籍与后台配置迁移"
```

---

### Task 2: `vip` 包

**Files:**
- Create: `backend/internal/vip/vip.go`
- Test: `backend/internal/vip/vip_integration_test.go`

**Interfaces:**
- Consumes: Task 1 的 `vip_memberships` 表
- Produces:
  - `vip.Status{Active bool, ExpiresAt *int64}`（`ExpiresAt` 为毫秒时间戳，从未购买过时为 nil）
  - `vip.QueryRower` 接口：`QueryRow(ctx, sql, args...) pgx.Row`
  - `vip.Get(ctx context.Context, querier QueryRower, userID int64) (Status, error)`
  - `vip.GetExpiry(ctx context.Context, querier QueryRower, userID int64) (time.Time, bool, error)`
  - `vip.Extend(ctx context.Context, tx pgx.Tx, userID int64, days int64, now time.Time) (time.Time, error)`

> **为什么需要 `GetExpiry`（spec §5.1 只列了 `Get` 与 `Extend`）**：`Status.ExpiresAt` 是毫秒时间戳，供 JSON 下发；但 PostgreSQL 的 `timestamptz` 是微秒精度。Task 6 的上限校验要拿现有到期时间做时间计算，若用毫秒截断值当基准，算出的 `newExpiresAt` 会与 `Extend` 的 SQL 结果差不到 1 毫秒，集成测试就无法断言两者相等。`GetExpiry` 返回未截断的原始值，`Get` 基于它实现。

- [ ] **Step 1: 写失败的集成测试**

创建 `backend/internal/vip/vip_integration_test.go`：

```go
//go:build integration

package vip

import (
	"context"
	"os"
	"testing"
	"time"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func newVIPTestDB(t *testing.T, ctx context.Context) (*pgxpool.Pool, int64) {
	t.Helper()

	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 VIP 集成测试")
	}
	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	if _, err := pgmigration.NewRunner(db, "../../migrations").Apply(ctx, false); err != nil {
		db.Close()
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(88801 + time.Now().UnixNano()%1_000_000_000)
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'vip_user', 'VIP User', now(), now())`,
		userID,
	); err != nil {
		db.Close()
		t.Fatalf("seed user failed: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM vip_memberships WHERE user_id = $1`, userID)
		_, _ = db.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		db.Close()
	})
	return db, userID
}

func TestGetReturnsZeroStatusWhenNeverPurchased(t *testing.T) {
	ctx := context.Background()
	db, userID := newVIPTestDB(t, ctx)

	status, err := Get(ctx, db, userID)
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if status.Active || status.ExpiresAt != nil {
		t.Fatalf("expected zero status, got %+v", status)
	}

	if _, ok, err := GetExpiry(ctx, db, userID); err != nil || ok {
		t.Fatalf("expected no membership, ok=%v err=%v", ok, err)
	}
}

func TestExtendAccumulatesFromExistingExpiry(t *testing.T) {
	ctx := context.Background()
	db, userID := newVIPTestDB(t, ctx)

	now := time.Now()
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatalf("begin failed: %v", err)
	}
	first, err := Extend(ctx, tx, userID, 30, now)
	if err != nil {
		t.Fatalf("first extend failed: %v", err)
	}
	// 未过期时从原到期时间累加
	second, err := Extend(ctx, tx, userID, 30, now)
	if err != nil {
		t.Fatalf("second extend failed: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit failed: %v", err)
	}

	wantFirst := now.Add(30 * 24 * time.Hour)
	if first.Sub(wantFirst).Abs() > time.Millisecond {
		t.Fatalf("first expiry = %v, want %v", first, wantFirst)
	}
	wantSecond := first.Add(30 * 24 * time.Hour)
	if second.Sub(wantSecond).Abs() > time.Millisecond {
		t.Fatalf("second expiry = %v, want %v", second, wantSecond)
	}

	status, err := Get(ctx, db, userID)
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if !status.Active || status.ExpiresAt == nil {
		t.Fatalf("expected active membership, got %+v", status)
	}
}

func TestExtendRestartsFromNowWhenExpired(t *testing.T) {
	ctx := context.Background()
	db, userID := newVIPTestDB(t, ctx)

	past := time.Now().Add(-100 * 24 * time.Hour)
	if _, err := db.Exec(ctx,
		`INSERT INTO vip_memberships (user_id, expires_at, created_at, updated_at)
		 VALUES ($1, $2, now(), now())`,
		userID, past,
	); err != nil {
		t.Fatalf("seed expired membership failed: %v", err)
	}

	// 已过期时应从当前时间重新起算，而不是从 100 天前累加
	now := time.Now()
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatalf("begin failed: %v", err)
	}
	got, err := Extend(ctx, tx, userID, 30, now)
	if err != nil {
		t.Fatalf("extend failed: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit failed: %v", err)
	}

	want := now.Add(30 * 24 * time.Hour)
	if got.Sub(want).Abs() > time.Millisecond {
		t.Fatalf("expiry = %v, want %v", got, want)
	}
}

func TestGetReportsInactiveForExpiredMembership(t *testing.T) {
	ctx := context.Background()
	db, userID := newVIPTestDB(t, ctx)

	past := time.Now().Add(-1 * time.Hour)
	if _, err := db.Exec(ctx,
		`INSERT INTO vip_memberships (user_id, expires_at, created_at, updated_at)
		 VALUES ($1, $2, now(), now())`,
		userID, past,
	); err != nil {
		t.Fatalf("seed expired membership failed: %v", err)
	}

	status, err := Get(ctx, db, userID)
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	// 到期不删行：ExpiresAt 仍有值，但 Active 为 false
	if status.Active {
		t.Fatalf("expected inactive membership, got %+v", status)
	}
	if status.ExpiresAt == nil {
		t.Fatalf("expected expiry timestamp to be retained, got %+v", status)
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && TEST_DATABASE_URL="<测试库>" go test -tags=integration ./internal/vip/ -v`
Expected: 编译失败，`undefined: Get` / `undefined: GetExpiry` / `undefined: Extend`

- [ ] **Step 3: 写实现**

创建 `backend/internal/vip/vip.go`：

```go
// Package vip 提供站内 VIP 会籍的查询与续期。
//
// 本包只做「查状态 + 续期」，不含购买用例：扣积分的能力在 economy 包，
// 若这里提供 Purchase 就会形成 vip ↔ economy 的循环依赖。
// 购买由 economy.PurchaseVIP 在自己的事务里扣分后调用 Extend，保持单向依赖。
package vip

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Status 描述用户当前的 VIP 会籍状态。
type Status struct {
	Active bool `json:"active"`
	// ExpiresAt 是毫秒时间戳。从未购买过时为 nil；
	// 会籍到期后行仍保留，此时 Active 为 false 但 ExpiresAt 非 nil。
	ExpiresAt *int64 `json:"expiresAt,omitempty"`
}

// QueryRower 让查询既能用连接池，也能用调用方的事务。
type QueryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// GetExpiry 返回未截断的原始到期时间。
// ok 为 false 表示该用户从未购买过 VIP。
// 需要对到期时间做算术的调用方必须用这个函数而不是 Get —— Status.ExpiresAt
// 是毫秒精度，而数据库是微秒精度，截断会让计算结果与 SQL 结果产生亚毫秒偏差。
func GetExpiry(ctx context.Context, querier QueryRower, userID int64) (time.Time, bool, error) {
	var expiresAt time.Time
	err := querier.QueryRow(ctx,
		`SELECT expires_at FROM vip_memberships WHERE user_id = $1`,
		userID,
	).Scan(&expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, false, nil
	}
	if err != nil {
		return time.Time{}, false, err
	}
	return expiresAt, true, nil
}

// Get 查询 VIP 状态。从未购买过时返回零值，不报错。
func Get(ctx context.Context, querier QueryRower, userID int64) (Status, error) {
	expiresAt, ok, err := GetExpiry(ctx, querier, userID)
	if err != nil || !ok {
		return Status{}, err
	}
	milliseconds := expiresAt.UnixMilli()
	return Status{Active: expiresAt.After(time.Now()), ExpiresAt: &milliseconds}, nil
}

// Extend 在调用方的事务内续期，返回续期后的到期时间。
//
// GREATEST(现有到期时间, now) 同时覆盖两种情形：会籍未过期则从原到期时间累加，
// 已过期则从当前时间重新起算。
//
// 天数用 double precision 相乘而不是 make_interval，是为了与调用方 Go 侧的
// 固定时长加法（24h × days）逐位对齐；timestamptz 以 UTC 存储，无 DST 干扰。
func Extend(ctx context.Context, tx pgx.Tx, userID int64, days int64, now time.Time) (time.Time, error) {
	var expiresAt time.Time
	err := tx.QueryRow(ctx,
		`INSERT INTO vip_memberships (user_id, expires_at, created_at, updated_at)
		 VALUES ($1, $2 + ($3::double precision * INTERVAL '1 day'), now(), now())
		 ON CONFLICT (user_id) DO UPDATE SET
		   expires_at = GREATEST(vip_memberships.expires_at, $2) + ($3::double precision * INTERVAL '1 day'),
		   updated_at = now()
		 RETURNING expires_at`,
		userID, now, days,
	).Scan(&expiresAt)
	return expiresAt, err
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd backend && TEST_DATABASE_URL="<测试库>" go test -tags=integration ./internal/vip/ -v`
Expected: 4 个测试全部 PASS

- [ ] **Step 5: 确认编译与静态检查**

Run: `cd backend && go build ./... && go vet ./...`
Expected: 无输出

- [ ] **Step 6: Commit**

```bash
git add backend/internal/vip/
git commit -m "feat: 新增 vip 包，提供会籍查询与时长累加续期"
```

---

### Task 3: `systemconfig` 扩展 7 个字段

**Files:**
- Modify: `backend/internal/systemconfig/service.go`
- Test: `backend/internal/systemconfig/service_test.go`（新建）

**Interfaces:**
- Consumes: Task 1 的 `system_config` 7 个新列
- Produces:
  - `systemconfig.Config` 新增 7 个字段：`DailyWithdrawLimit` / `VIPDailyWithdrawLimit` / `VIPPricePoints` / `VIPDurationDays` / `VIPWithdrawFeePercent` / `VIPDailyLotterySpins` / `VIPMaxTotalDays`（均为 `int64`）
  - `systemconfig.UpdateInput` 新增同名 7 个 `*int64` 字段
  - 校验函数：`ValidDailyWithdrawLimit` / `ValidVIPDailyWithdrawLimit` / `ValidVIPPricePoints` / `ValidVIPDurationDays` / `ValidVIPWithdrawFeePercent` / `ValidVIPDailyLotterySpins` / `ValidVIPMaxTotalDays`，签名均为 `func(int64) bool`
  - 跨字段校验：`ValidVIPDurationAgainstMaxTotal(durationDays int64, maxTotalDays int64) bool`
  - 默认值与边界常量（见 Step 3）

- [ ] **Step 1: 写失败的单元测试**

创建 `backend/internal/systemconfig/service_test.go`：

```go
package systemconfig

import "testing"

func TestValidatorsAcceptBoundariesAndRejectOutOfRange(t *testing.T) {
	cases := []struct {
		name    string
		valid   func(int64) bool
		low     int64
		high    int64
	}{
		{"dailyWithdrawLimit", ValidDailyWithdrawLimit, MinDailyWithdrawLimit, MaxDailyWithdrawLimit},
		{"vipDailyWithdrawLimit", ValidVIPDailyWithdrawLimit, MinDailyWithdrawLimit, MaxDailyWithdrawLimit},
		{"vipPricePoints", ValidVIPPricePoints, MinVIPPricePoints, MaxVIPPricePoints},
		{"vipDurationDays", ValidVIPDurationDays, MinVIPDurationDays, MaxVIPDurationDays},
		{"vipWithdrawFeePercent", ValidVIPWithdrawFeePercent, MinVIPWithdrawFeePercent, MaxVIPWithdrawFeePercent},
		{"vipDailyLotterySpins", ValidVIPDailyLotterySpins, MinVIPDailyLotterySpins, MaxVIPDailyLotterySpins},
		{"vipMaxTotalDays", ValidVIPMaxTotalDays, MinVIPMaxTotalDays, MaxVIPMaxTotalDays},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if !tt.valid(tt.low) || !tt.valid(tt.high) {
				t.Fatalf("boundaries %d/%d should be valid", tt.low, tt.high)
			}
			if tt.valid(tt.low-1) || tt.valid(tt.high+1) {
				t.Fatalf("out-of-range values %d/%d should be invalid", tt.low-1, tt.high+1)
			}
		})
	}
}

func TestValidVIPDurationAgainstMaxTotal(t *testing.T) {
	// 上限小于月卡时长时，用户第一次购买就会被拒，功能不可用
	if ValidVIPDurationAgainstMaxTotal(30, 20) {
		t.Fatal("max < duration should be invalid")
	}
	// 相等是允许的：恰好只能买一次
	if !ValidVIPDurationAgainstMaxTotal(30, 30) {
		t.Fatal("max == duration should be valid")
	}
	if !ValidVIPDurationAgainstMaxTotal(30, 365) {
		t.Fatal("max > duration should be valid")
	}
}

func TestDefaultsSatisfyTheirOwnValidators(t *testing.T) {
	if !ValidDailyPointsLimit(DefaultDailyPointsLimit) ||
		!ValidDailyWithdrawLimit(DefaultDailyWithdrawLimit) ||
		!ValidVIPDailyWithdrawLimit(DefaultVIPDailyWithdrawLimit) ||
		!ValidVIPPricePoints(DefaultVIPPricePoints) ||
		!ValidVIPDurationDays(DefaultVIPDurationDays) ||
		!ValidVIPWithdrawFeePercent(DefaultVIPWithdrawFeePercent) ||
		!ValidVIPDailyLotterySpins(DefaultVIPDailyLotterySpins) ||
		!ValidVIPMaxTotalDays(DefaultVIPMaxTotalDays) {
		t.Fatal("every default value must satisfy its own validator")
	}
	if !ValidVIPDurationAgainstMaxTotal(DefaultVIPDurationDays, DefaultVIPMaxTotalDays) {
		t.Fatal("default duration/max pair must be valid")
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && go test ./internal/systemconfig/ -v`
Expected: 编译失败，`undefined: ValidDailyWithdrawLimit` 等

- [ ] **Step 3: 扩展常量与校验函数**

在 `backend/internal/systemconfig/service.go` 的既有 `const` 块后追加：

```go
const (
	DefaultDailyWithdrawLimit    = int64(4)
	DefaultVIPDailyWithdrawLimit = int64(8)
	MinDailyWithdrawLimit        = int64(1)
	MaxDailyWithdrawLimit        = int64(100)

	DefaultVIPPricePoints = int64(3000)
	MinVIPPricePoints     = int64(1)
	MaxVIPPricePoints     = int64(1000000)

	DefaultVIPDurationDays = int64(30)
	MinVIPDurationDays     = int64(1)
	MaxVIPDurationDays     = int64(365)

	DefaultVIPWithdrawFeePercent = int64(50)
	MinVIPWithdrawFeePercent     = int64(0)
	MaxVIPWithdrawFeePercent     = int64(100)

	DefaultVIPDailyLotterySpins = int64(2)
	MinVIPDailyLotterySpins     = int64(0)
	MaxVIPDailyLotterySpins     = int64(50)

	DefaultVIPMaxTotalDays = int64(365)
	MinVIPMaxTotalDays     = int64(1)
	MaxVIPMaxTotalDays     = int64(3650)
)
```

在文件末尾 `ValidDailyPointsLimit` 之后追加：

```go
func ValidDailyWithdrawLimit(limit int64) bool {
	return limit >= MinDailyWithdrawLimit && limit <= MaxDailyWithdrawLimit
}

func ValidVIPDailyWithdrawLimit(limit int64) bool {
	return limit >= MinDailyWithdrawLimit && limit <= MaxDailyWithdrawLimit
}

func ValidVIPPricePoints(points int64) bool {
	return points >= MinVIPPricePoints && points <= MaxVIPPricePoints
}

func ValidVIPDurationDays(days int64) bool {
	return days >= MinVIPDurationDays && days <= MaxVIPDurationDays
}

func ValidVIPWithdrawFeePercent(percent int64) bool {
	return percent >= MinVIPWithdrawFeePercent && percent <= MaxVIPWithdrawFeePercent
}

func ValidVIPDailyLotterySpins(spins int64) bool {
	return spins >= MinVIPDailyLotterySpins && spins <= MaxVIPDailyLotterySpins
}

func ValidVIPMaxTotalDays(days int64) bool {
	return days >= MinVIPMaxTotalDays && days <= MaxVIPMaxTotalDays
}

// ValidVIPDurationAgainstMaxTotal 校验累计时长上限不低于月卡时长。
// 若上限更小，非 VIP 用户第一次购买就会被上限拒绝（0 + 时长 > 上限），功能直接不可用。
func ValidVIPDurationAgainstMaxTotal(durationDays int64, maxTotalDays int64) bool {
	return maxTotalDays >= durationDays
}
```

- [ ] **Step 4: 扩展 `Config` 与 `UpdateInput`**

替换既有的 `Config` 与 `UpdateInput` 定义：

```go
type Config struct {
	DailyPointsLimit      int64   `json:"dailyPointsLimit"`
	DailyWithdrawLimit    int64   `json:"dailyWithdrawLimit"`
	VIPDailyWithdrawLimit int64   `json:"vipDailyWithdrawLimit"`
	VIPPricePoints        int64   `json:"vipPricePoints"`
	VIPDurationDays       int64   `json:"vipDurationDays"`
	VIPWithdrawFeePercent int64   `json:"vipWithdrawFeePercent"`
	VIPDailyLotterySpins  int64   `json:"vipDailyLotterySpins"`
	VIPMaxTotalDays       int64   `json:"vipMaxTotalDays"`
	UpdatedAt             *int64  `json:"updatedAt,omitempty"`
	UpdatedBy             *string `json:"updatedBy,omitempty"`
}

// UpdateInput 的每个字段为 nil 时会被重置为默认值，不是「保持原值」。
// 调用方必须一次性提交全部字段，漏传的字段会被静默重置。
type UpdateInput struct {
	DailyPointsLimit      *int64
	DailyWithdrawLimit    *int64
	VIPDailyWithdrawLimit *int64
	VIPPricePoints        *int64
	VIPDurationDays       *int64
	VIPWithdrawFeePercent *int64
	VIPDailyLotterySpins  *int64
	VIPMaxTotalDays       *int64
	UpdatedBy             string
	Now                   time.Time
}
```

- [ ] **Step 5: 扩展 `Update`**

替换既有 `Update` 方法体中从 `limit := DefaultDailyPointsLimit` 到 `Exec` 结束的部分：

```go
func (service *Service) Update(ctx context.Context, input UpdateInput) (Config, error) {
	if service.db == nil {
		return Config{}, ErrUnavailable
	}

	// nil 一律归一化为默认值，再统一校验。
	limit := valueOrDefault(input.DailyPointsLimit, DefaultDailyPointsLimit)
	withdrawLimit := valueOrDefault(input.DailyWithdrawLimit, DefaultDailyWithdrawLimit)
	vipWithdrawLimit := valueOrDefault(input.VIPDailyWithdrawLimit, DefaultVIPDailyWithdrawLimit)
	vipPrice := valueOrDefault(input.VIPPricePoints, DefaultVIPPricePoints)
	vipDuration := valueOrDefault(input.VIPDurationDays, DefaultVIPDurationDays)
	vipFeePercent := valueOrDefault(input.VIPWithdrawFeePercent, DefaultVIPWithdrawFeePercent)
	vipLotterySpins := valueOrDefault(input.VIPDailyLotterySpins, DefaultVIPDailyLotterySpins)
	vipMaxTotalDays := valueOrDefault(input.VIPMaxTotalDays, DefaultVIPMaxTotalDays)

	if !ValidDailyPointsLimit(limit) ||
		!ValidDailyWithdrawLimit(withdrawLimit) ||
		!ValidVIPDailyWithdrawLimit(vipWithdrawLimit) ||
		!ValidVIPPricePoints(vipPrice) ||
		!ValidVIPDurationDays(vipDuration) ||
		!ValidVIPWithdrawFeePercent(vipFeePercent) ||
		!ValidVIPDailyLotterySpins(vipLotterySpins) ||
		!ValidVIPMaxTotalDays(vipMaxTotalDays) ||
		!ValidVIPDurationAgainstMaxTotal(vipDuration, vipMaxTotalDays) {
		return Config{}, ErrInvalid
	}

	now := input.Now
	if now.IsZero() {
		now = service.now()
	}
	nowMs := now.UnixMilli()
	_, err := service.db.Exec(ctx,
		`INSERT INTO system_config (
		   id, daily_points_limit, daily_withdraw_limit, vip_daily_withdraw_limit,
		   vip_price_points, vip_duration_days, vip_withdraw_fee_percent,
		   vip_daily_lottery_spins, vip_max_total_days,
		   updated_at_ms, updated_by, updated_at
		 )
		 VALUES ('system', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
		 ON CONFLICT (id) DO UPDATE SET
		   daily_points_limit = excluded.daily_points_limit,
		   daily_withdraw_limit = excluded.daily_withdraw_limit,
		   vip_daily_withdraw_limit = excluded.vip_daily_withdraw_limit,
		   vip_price_points = excluded.vip_price_points,
		   vip_duration_days = excluded.vip_duration_days,
		   vip_withdraw_fee_percent = excluded.vip_withdraw_fee_percent,
		   vip_daily_lottery_spins = excluded.vip_daily_lottery_spins,
		   vip_max_total_days = excluded.vip_max_total_days,
		   updated_at_ms = excluded.updated_at_ms,
		   updated_by = excluded.updated_by,
		   updated_at = now()`,
		limit, withdrawLimit, vipWithdrawLimit, vipPrice, vipDuration,
		vipFeePercent, vipLotterySpins, vipMaxTotalDays,
		nowMs, emptyStringToNil(input.UpdatedBy),
	)
	if err != nil {
		return Config{}, err
	}
	return Get(ctx, service.db)
}

func valueOrDefault(value *int64, fallback int64) int64 {
	if value == nil {
		return fallback
	}
	return *value
}
```

- [ ] **Step 6: 扩展 `Get`**

替换既有 `Get` 函数：

```go
func Get(ctx context.Context, queryer QueryRower) (Config, error) {
	config := defaultConfig()
	var updatedBy *string
	var updatedAt int64
	err := queryer.QueryRow(ctx,
		`SELECT daily_points_limit, daily_withdraw_limit, vip_daily_withdraw_limit,
		        vip_price_points, vip_duration_days, vip_withdraw_fee_percent,
		        vip_daily_lottery_spins, vip_max_total_days,
		        updated_at_ms, updated_by
		   FROM system_config
		  WHERE id = 'system'`,
	).Scan(
		&config.DailyPointsLimit,
		&config.DailyWithdrawLimit,
		&config.VIPDailyWithdrawLimit,
		&config.VIPPricePoints,
		&config.VIPDurationDays,
		&config.VIPWithdrawFeePercent,
		&config.VIPDailyLotterySpins,
		&config.VIPMaxTotalDays,
		&updatedAt,
		&updatedBy,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return config, nil
	}
	if err != nil {
		return Config{}, err
	}

	// 任一列越界都回落到默认值，避免脏数据把下游算崩。
	fallbacks := defaultConfig()
	if !ValidDailyPointsLimit(config.DailyPointsLimit) {
		config.DailyPointsLimit = fallbacks.DailyPointsLimit
	}
	if !ValidDailyWithdrawLimit(config.DailyWithdrawLimit) {
		config.DailyWithdrawLimit = fallbacks.DailyWithdrawLimit
	}
	if !ValidVIPDailyWithdrawLimit(config.VIPDailyWithdrawLimit) {
		config.VIPDailyWithdrawLimit = fallbacks.VIPDailyWithdrawLimit
	}
	if !ValidVIPPricePoints(config.VIPPricePoints) {
		config.VIPPricePoints = fallbacks.VIPPricePoints
	}
	if !ValidVIPDurationDays(config.VIPDurationDays) {
		config.VIPDurationDays = fallbacks.VIPDurationDays
	}
	if !ValidVIPWithdrawFeePercent(config.VIPWithdrawFeePercent) {
		config.VIPWithdrawFeePercent = fallbacks.VIPWithdrawFeePercent
	}
	if !ValidVIPDailyLotterySpins(config.VIPDailyLotterySpins) {
		config.VIPDailyLotterySpins = fallbacks.VIPDailyLotterySpins
	}
	if !ValidVIPMaxTotalDays(config.VIPMaxTotalDays) {
		config.VIPMaxTotalDays = fallbacks.VIPMaxTotalDays
	}
	if !ValidVIPDurationAgainstMaxTotal(config.VIPDurationDays, config.VIPMaxTotalDays) {
		config.VIPDurationDays = fallbacks.VIPDurationDays
		config.VIPMaxTotalDays = fallbacks.VIPMaxTotalDays
	}

	if updatedAt > 1 {
		config.UpdatedAt = &updatedAt
	}
	config.UpdatedBy = updatedBy
	return config, nil
}

func defaultConfig() Config {
	return Config{
		DailyPointsLimit:      DefaultDailyPointsLimit,
		DailyWithdrawLimit:    DefaultDailyWithdrawLimit,
		VIPDailyWithdrawLimit: DefaultVIPDailyWithdrawLimit,
		VIPPricePoints:        DefaultVIPPricePoints,
		VIPDurationDays:       DefaultVIPDurationDays,
		VIPWithdrawFeePercent: DefaultVIPWithdrawFeePercent,
		VIPDailyLotterySpins:  DefaultVIPDailyLotterySpins,
		VIPMaxTotalDays:       DefaultVIPMaxTotalDays,
	}
}
```

- [ ] **Step 7: 运行测试，确认通过**

Run: `cd backend && go test ./internal/systemconfig/ -v && go build ./... && go vet ./...`
Expected: 3 个测试 PASS，编译与 vet 无输出

- [ ] **Step 8: 运行既有 systemconfig 集成测试**

Run: `cd backend && TEST_DATABASE_URL="<测试库>" go test -tags=integration ./internal/systemconfig/ -v`
Expected: PASS（既有用例只断言 `DailyPointsLimit`，新字段不影响它）

- [ ] **Step 9: Commit**

```bash
git add backend/internal/systemconfig/
git commit -m "feat: 系统配置新增钱包与 VIP 的 7 个可配项"
```

---

### Task 4: `previewWithdraw` 前后端参数化

Go 与 TypeScript 两份实现放在同一个任务里，是为了让「逐字对齐」能在同一个测试周期内被验证。两边用**同一组输入输出向量**。

**Files:**
- Modify: `backend/internal/economy/wallet.go:123-144`（`PreviewWithdraw`）
- Modify: `backend/internal/economy/wallet_test.go:26`（既有调用点补参数）
- Modify: `src/lib/wallet-rules.ts:56-87`（`previewWithdraw`）
- Test: `backend/internal/economy/wallet_test.go`
- Test: `src/lib/__tests__/wallet-rules.test.ts`（新建）

**Interfaces:**
- Consumes: 无
- Produces:
  - Go: `economy.PreviewWithdraw(points int64, feePercent int64) WithdrawPreview`
  - TS: `previewWithdraw(points: number, feePercent = 100): WithdrawPreview`
  - 两者语义一致：`feePercent` 是手续费按原阶梯费率收取的百分比，`100` = 原价，`50` = 五折，`0` = 免手续费

> **调用方保证 `feePercent ∈ [0, 100]`**，由 `system_config` 的 CHECK 与 `systemconfig.ValidVIPWithdrawFeePercent` 共同保证。函数内部不做 clamp。

- [ ] **Step 1: 写失败的 Go 单元测试**

替换 `backend/internal/economy/wallet_test.go` 中的 `TestPreviewWithdrawMatchesWalletRules`，并在其后新增折扣用例。注意既有 5 个向量全部保留，只是补上 `feePercent` 列：

```go
// walletPreviewVector 是 Go 与 TypeScript 两份实现共用的输入输出向量。
// 修改这里时必须同步修改 src/lib/__tests__/wallet-rules.test.ts 的同名表。
type walletPreviewVector struct {
	name       string
	points     int64
	feePercent int64
	feePoints  int64
	netPoints  int64
	feeRate    float64
	dollars    float64
}

var walletPreviewVectors = []walletPreviewVector{
	{name: "min tier", points: 10, feePercent: 100, feePoints: 1, netPoints: 9, feeRate: 0.05, dollars: 0.9},
	{name: "hundred tier", points: 100, feePercent: 100, feePoints: 3, netPoints: 97, feeRate: 0.03, dollars: 9.7},
	{name: "thousand tier", points: 1000, feePercent: 100, feePoints: 20, netPoints: 980, feeRate: 0.02, dollars: 98},
	{name: "ten thousand tier", points: 10000, feePercent: 100, feePoints: 100, netPoints: 9900, feeRate: 0.01, dollars: 990},
	{name: "ceil fee", points: 101, feePercent: 100, feePoints: 4, netPoints: 97, feeRate: 0.03, dollars: 9.7},

	// 五折：向上取整让低额提现的折扣不显效，这是既定行为不是缺陷
	{name: "half off min tier stays one", points: 10, feePercent: 50, feePoints: 1, netPoints: 9, feeRate: 0.05, dollars: 0.9},
	{name: "half off hundred tier", points: 100, feePercent: 50, feePoints: 2, netPoints: 98, feeRate: 0.03, dollars: 9.8},
	{name: "half off thousand tier", points: 1000, feePercent: 50, feePoints: 10, netPoints: 990, feeRate: 0.02, dollars: 99},
	{name: "half off ten thousand tier", points: 10000, feePercent: 50, feePoints: 50, netPoints: 9950, feeRate: 0.01, dollars: 995},
	{name: "half off ceil fee", points: 101, feePercent: 50, feePoints: 2, netPoints: 99, feeRate: 0.03, dollars: 9.9},

	// 免手续费
	{name: "zero percent min tier", points: 10, feePercent: 0, feePoints: 0, netPoints: 10, feeRate: 0.05, dollars: 1},
	{name: "zero percent ten thousand tier", points: 10000, feePercent: 0, feePoints: 0, netPoints: 10000, feeRate: 0.01, dollars: 1000},
}

func TestPreviewWithdrawMatchesWalletRules(t *testing.T) {
	for _, tt := range walletPreviewVectors {
		t.Run(tt.name, func(t *testing.T) {
			got := PreviewWithdraw(tt.points, tt.feePercent)
			if !got.OK {
				t.Fatalf("expected ok preview, got %+v", got)
			}
			if got.Deducted != tt.points ||
				got.FeePoints != tt.feePoints ||
				got.NetPoints != tt.netPoints ||
				got.FeeRate != tt.feeRate ||
				got.Dollars != tt.dollars {
				t.Fatalf("unexpected preview: %+v", got)
			}
		})
	}
}
```

同时把 `TestPreviewWithdrawRejectsInvalidValues` 里的调用改为 `PreviewWithdraw(points, 100)`。

- [ ] **Step 2: 运行 Go 测试，确认失败**

Run: `cd backend && go test ./internal/economy/ -run TestPreviewWithdraw -v`
Expected: 编译失败，`too many arguments in call to PreviewWithdraw`

- [ ] **Step 3: 改 Go 实现**

替换 `backend/internal/economy/wallet.go` 的 `PreviewWithdraw`：

```go
// PreviewWithdraw 计算提现预览（不修改任何状态）。
//
// feePercent 是手续费按原阶梯费率收取的百分比：100 = 原价，50 = 五折，0 = 免手续费。
// 调用方保证它落在 [0, 100]，由 system_config 的 CHECK 与 systemconfig 校验共同保证。
//
// 乘法顺序与 / 100 的位置必须与 src/lib/wallet-rules.ts 的 previewWithdraw 逐字一致，
// 否则浮点结合律差异会在边界值上造成 ±1 积分的预览偏差。
func PreviewWithdraw(points int64, feePercent int64) WithdrawPreview {
	if points <= 0 {
		return WithdrawPreview{Message: "积分数量必须为正整数"}
	}
	if points < MinWithdrawPoints {
		return WithdrawPreview{Message: fmt.Sprintf("最低提现 %d 积分", MinWithdrawPoints)}
	}

	feeRate := GetWithdrawFeeRate(points)
	feePoints := int64(math.Ceil(float64(points) * feeRate * float64(feePercent) / 100))
	netPoints := maxInt64(0, points-feePoints)
	dollars := math.Round((float64(netPoints)/float64(PointsPerDollar))*100) / 100

	return WithdrawPreview{
		OK:        true,
		Deducted:  points,
		FeePoints: feePoints,
		NetPoints: netPoints,
		FeeRate:   feeRate,
		Dollars:   dollars,
	}
}
```

- [ ] **Step 4: 修复唯一的生产调用点**

`backend/internal/economy/wallet_service.go:60` 暂时改为 `PreviewWithdraw(points, 100)`。Task 5 会把它换成按 VIP 状态解析出的真实值。

```go
	preview := PreviewWithdraw(points, 100)
```

- [ ] **Step 5: 运行 Go 测试，确认通过**

Run: `cd backend && go test ./internal/economy/ -run TestPreview -v && go build ./... && go vet ./...`
Expected: 12 个子测试全部 PASS

- [ ] **Step 6: 写失败的 TypeScript 测试**

创建 `src/lib/__tests__/wallet-rules.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { MIN_WITHDRAW_POINTS, previewWithdraw } from '@/lib/wallet-rules';

/**
 * 与 backend/internal/economy/wallet_test.go 的 walletPreviewVectors 完全同源。
 * 修改任何一边都必须同步另一边 —— 两份实现的浮点表达式必须逐字对齐。
 */
const VECTORS = [
  { name: 'min tier', points: 10, feePercent: 100, feePoints: 1, netPoints: 9, feeRate: 0.05, dollars: 0.9 },
  { name: 'hundred tier', points: 100, feePercent: 100, feePoints: 3, netPoints: 97, feeRate: 0.03, dollars: 9.7 },
  { name: 'thousand tier', points: 1000, feePercent: 100, feePoints: 20, netPoints: 980, feeRate: 0.02, dollars: 98 },
  { name: 'ten thousand tier', points: 10000, feePercent: 100, feePoints: 100, netPoints: 9900, feeRate: 0.01, dollars: 990 },
  { name: 'ceil fee', points: 101, feePercent: 100, feePoints: 4, netPoints: 97, feeRate: 0.03, dollars: 9.7 },
  { name: 'half off min tier stays one', points: 10, feePercent: 50, feePoints: 1, netPoints: 9, feeRate: 0.05, dollars: 0.9 },
  { name: 'half off hundred tier', points: 100, feePercent: 50, feePoints: 2, netPoints: 98, feeRate: 0.03, dollars: 9.8 },
  { name: 'half off thousand tier', points: 1000, feePercent: 50, feePoints: 10, netPoints: 990, feeRate: 0.02, dollars: 99 },
  { name: 'half off ten thousand tier', points: 10000, feePercent: 50, feePoints: 50, netPoints: 9950, feeRate: 0.01, dollars: 995 },
  { name: 'half off ceil fee', points: 101, feePercent: 50, feePoints: 2, netPoints: 99, feeRate: 0.03, dollars: 9.9 },
  { name: 'zero percent min tier', points: 10, feePercent: 0, feePoints: 0, netPoints: 10, feeRate: 0.05, dollars: 1 },
  { name: 'zero percent ten thousand tier', points: 10000, feePercent: 0, feePoints: 0, netPoints: 10000, feeRate: 0.01, dollars: 1000 },
];

describe('previewWithdraw', () => {
  it.each(VECTORS)('$name', ({ points, feePercent, feePoints, netPoints, feeRate, dollars }) => {
    const got = previewWithdraw(points, feePercent);
    expect(got.ok).toBe(true);
    expect(got.deducted).toBe(points);
    expect(got.feePoints).toBe(feePoints);
    expect(got.netPoints).toBe(netPoints);
    expect(got.feeRate).toBe(feeRate);
    expect(got.dollars).toBe(dollars);
  });

  it('默认不打折，与显式传 100 等价', () => {
    expect(previewWithdraw(101)).toEqual(previewWithdraw(101, 100));
  });

  it('拒绝非法输入', () => {
    for (const points of [-1, 0, MIN_WITHDRAW_POINTS - 1, 1.5, Number.NaN]) {
      expect(previewWithdraw(points).ok).toBe(false);
    }
  });
});
```

- [ ] **Step 7: 运行 TS 测试，确认失败**

Run: `npx vitest run src/lib/__tests__/wallet-rules.test.ts`
Expected: 五折与 0% 的向量全部 FAIL（当前实现忽略第二个参数）

- [ ] **Step 8: 改 TypeScript 实现**

替换 `src/lib/wallet-rules.ts` 的 `previewWithdraw` 签名与费用计算行：

```ts
/**
 * 计算提现的预览（不修改任何状态）
 * - points 必须为正整数
 * - 手续费向上取整，避免给系统留零头损失
 * - feePercent 是手续费按原阶梯费率收取的百分比：100 = 原价，50 = 五折，0 = 免手续费
 *
 * 乘法顺序与 / 100 的位置必须与 backend/internal/economy/wallet.go 的
 * PreviewWithdraw 逐字一致，否则浮点结合律差异会造成 ±1 积分的预览偏差。
 */
export function previewWithdraw(points: number, feePercent = 100): WithdrawPreview {
```

以及函数体内的这一行：

```ts
  const feePoints = Math.ceil((points * feeRate * feePercent) / 100);
```

其余行不动。

- [ ] **Step 9: 运行 TS 测试与类型检查，确认通过**

Run: `npx vitest run src/lib/__tests__/wallet-rules.test.ts && npx tsc --noEmit && npm run lint`
Expected: 14 个用例全部 PASS；tsc 与 lint 无错误（`src/app/store/page.tsx` 的既有调用点因默认参数不受影响）

- [ ] **Step 10: Commit**

```bash
git add backend/internal/economy/wallet.go backend/internal/economy/wallet_test.go backend/internal/economy/wallet_service.go src/lib/wallet-rules.ts src/lib/__tests__/wallet-rules.test.ts
git commit -m "feat: 提现预览支持手续费折扣百分比，前后端共用同一组测试向量"
```

---

### Task 5: 提现每日限次

**Files:**
- Create: `backend/internal/economy/wallet_limit.go`
- Create: `backend/internal/economy/wallet_limit_test.go`
- Create: `backend/internal/economy/wallet_limit_integration_test.go`
- Modify: `backend/internal/economy/wallet.go`（`WithdrawResult` 加 3 个字段）
- Modify: `backend/internal/economy/wallet_service.go:54-215`（`executeWithdrawInner`）

**Interfaces:**
- Consumes: `vip.Get`（Task 2）、`systemconfig.Get` 的 `DailyWithdrawLimit` / `VIPDailyWithdrawLimit` / `VIPWithdrawFeePercent`（Task 3）、`PreviewWithdraw(points, feePercent)`（Task 4）、Task 1 的 `wallet_daily_withdrawals` 表
- Produces:
  - `economy.WithdrawDailyUsage{Used, Limit, Remaining, ResetAtMs int64}`
  - `economy.CodeWithdrawDailyLimit = "WITHDRAW_DAILY_LIMIT"`
  - `(*economy.Service).GetWithdrawDailyUsage(ctx, userID int64) (WithdrawDailyUsage, error)`
  - `economy.WithdrawResult` 新增 `Code string` / `DailyWithdrawUsed int64` / `DailyWithdrawLimit int64`
  - 包内：`chinaZone()` / `nextChinaMidnightMillis(now)` / `withdrawDailyLimitFor(config, vipActive)` / `countWithdrawUsedToday` / `bumpWithdrawUsedToday`

> **检查与计数必须在 `executeWithdrawInner` 内，不能放 HTTP handler 层。** `ExecuteWithdraw` 外层已有 `RunWithWalletOperationLock`（Redis 操作锁）保证同一用户的提现串行；handler 层没有这层保护，两个并发请求会同时通过检查。

- [ ] **Step 1: 写失败的纯函数单元测试**

创建 `backend/internal/economy/wallet_limit_test.go`：

```go
package economy

import (
	"testing"
	"time"

	"redemption/backend/internal/systemconfig"
)

func TestNextChinaMidnightMillis(t *testing.T) {
	china := time.FixedZone("CST", 8*60*60)

	cases := []struct {
		name string
		now  time.Time
		want time.Time
	}{
		{
			name: "中国时区上午",
			now:  time.Date(2026, 8, 31, 10, 30, 0, 0, china),
			want: time.Date(2026, 9, 1, 0, 0, 0, 0, china),
		},
		{
			name: "跨月边界",
			now:  time.Date(2026, 8, 31, 23, 59, 59, 0, china),
			want: time.Date(2026, 9, 1, 0, 0, 0, 0, china),
		},
		{
			name: "UTC 时刻按中国日历折算",
			// UTC 2026-08-31 17:00 = 中国 2026-09-01 01:00，次日 0 点应是 09-02
			now:  time.Date(2026, 8, 31, 17, 0, 0, 0, time.UTC),
			want: time.Date(2026, 9, 2, 0, 0, 0, 0, china),
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := nextChinaMidnightMillis(tt.now); got != tt.want.UnixMilli() {
				t.Fatalf("nextChinaMidnightMillis = %d, want %d", got, tt.want.UnixMilli())
			}
		})
	}
}

func TestWithdrawDailyLimitFor(t *testing.T) {
	config := systemconfig.Config{DailyWithdrawLimit: 4, VIPDailyWithdrawLimit: 8}

	if got := withdrawDailyLimitFor(config, false); got != 4 {
		t.Fatalf("non-vip limit = %d, want 4", got)
	}
	if got := withdrawDailyLimitFor(config, true); got != 8 {
		t.Fatalf("vip limit = %d, want 8", got)
	}
}

func TestWithdrawFeePercentFor(t *testing.T) {
	config := systemconfig.Config{VIPWithdrawFeePercent: 50}

	if got := withdrawFeePercentFor(config, false); got != 100 {
		t.Fatalf("non-vip fee percent = %d, want 100", got)
	}
	if got := withdrawFeePercentFor(config, true); got != 50 {
		t.Fatalf("vip fee percent = %d, want 50", got)
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && go test ./internal/economy/ -run "TestNextChinaMidnight|TestWithdrawDaily|TestWithdrawFee" -v`
Expected: 编译失败，`undefined: nextChinaMidnightMillis` 等

- [ ] **Step 3: 写 `wallet_limit.go`**

```go
package economy

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"redemption/backend/internal/systemconfig"
	"redemption/backend/internal/vip"

	"github.com/jackc/pgx/v5"
)

// CodeWithdrawDailyLimit 标识「今日提现次数已用完」。
const CodeWithdrawDailyLimit = "WITHDRAW_DAILY_LIMIT"

// WithdrawDailyUsage 描述用户今日的提现次数配额，供钱包页展示。
type WithdrawDailyUsage struct {
	Used      int64 `json:"used"`
	Limit     int64 `json:"limit"`
	Remaining int64 `json:"remaining"`
	ResetAtMs int64 `json:"resetAtMs"` // 中国时区次日 0 点
}

func chinaZone() *time.Location {
	return time.FixedZone("CST", 8*60*60)
}

// nextChinaMidnightMillis 返回中国时区次日 0 点的毫秒时间戳，与 todayChina 的日期口径一致。
func nextChinaMidnightMillis(now time.Time) int64 {
	local := now.In(chinaZone())
	next := time.Date(local.Year(), local.Month(), local.Day()+1, 0, 0, 0, 0, chinaZone())
	return next.UnixMilli()
}

func withdrawDailyLimitFor(config systemconfig.Config, vipActive bool) int64 {
	if vipActive {
		return config.VIPDailyWithdrawLimit
	}
	return config.DailyWithdrawLimit
}

func withdrawFeePercentFor(config systemconfig.Config, vipActive bool) int64 {
	if vipActive {
		return config.VIPWithdrawFeePercent
	}
	return 100
}

type withdrawLimitQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// countWithdrawUsedToday 读取今日已用提现次数，无记录视为 0。
func countWithdrawUsedToday(ctx context.Context, querier withdrawLimitQuerier, userID int64, withdrawDate string) (int64, error) {
	var used int64
	err := querier.QueryRow(ctx,
		`SELECT used_count FROM wallet_daily_withdrawals
		  WHERE user_id = $1 AND withdraw_date = $2`,
		userID, withdrawDate,
	).Scan(&used)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return used, err
}

// bumpWithdrawUsedToday 把今日计数加一并返回加后的值。
func (service *Service) bumpWithdrawUsedToday(ctx context.Context, userID int64, withdrawDate string) (int64, error) {
	var used int64
	err := service.db.QueryRow(ctx,
		`INSERT INTO wallet_daily_withdrawals (user_id, withdraw_date, used_count, updated_at)
		 VALUES ($1, $2, 1, now())
		 ON CONFLICT (user_id, withdraw_date) DO UPDATE SET
		   used_count = wallet_daily_withdrawals.used_count + 1,
		   updated_at = now()
		 RETURNING used_count`,
		userID, withdrawDate,
	).Scan(&used)
	return used, err
}

// markWithdrawUsed 在提现产生副作用后计数。
//
// 写入失败只告警不回滚：资金操作已经完成，为一次计数失败而回滚会造成更严重的
// 不一致。代价是极端情况下用户当日可能多提现一次，可接受。
func (service *Service) markWithdrawUsed(ctx context.Context, userID int64, withdrawDate string, fallback int64) int64 {
	used, err := service.bumpWithdrawUsedToday(ctx, userID, withdrawDate)
	if err != nil {
		slog.Warn("提现每日次数计数写入失败", "userId", userID, "withdrawDate", withdrawDate, "error", err)
		return fallback + 1
	}
	return used
}

// GetWithdrawDailyUsage 只读查询今日提现配额，供 GET /api/wallet 展示。
func (service *Service) GetWithdrawDailyUsage(ctx context.Context, userID int64) (WithdrawDailyUsage, error) {
	config, err := systemconfig.Get(ctx, service.db)
	if err != nil {
		return WithdrawDailyUsage{}, err
	}
	status, err := vip.Get(ctx, service.db, userID)
	if err != nil {
		return WithdrawDailyUsage{}, err
	}
	used, err := countWithdrawUsedToday(ctx, service.db, userID, todayChina())
	if err != nil {
		return WithdrawDailyUsage{}, err
	}

	limit := withdrawDailyLimitFor(config, status.Active)
	return WithdrawDailyUsage{
		Used:      used,
		Limit:     limit,
		Remaining: maxInt64(0, limit-used),
		ResetAtMs: nextChinaMidnightMillis(time.Now()),
	}, nil
}
```

- [ ] **Step 4: 运行单元测试，确认通过**

Run: `cd backend && go test ./internal/economy/ -run "TestNextChinaMidnight|TestWithdrawDaily|TestWithdrawFee" -v`
Expected: 3 个测试 PASS

- [ ] **Step 5: 给 `WithdrawResult` 加字段**

替换 `backend/internal/economy/wallet.go:43-50` 的 `WithdrawResult`：

```go
type WithdrawResult struct {
	Success   bool    `json:"success"`
	Code      string  `json:"code,omitempty"`
	Message   string  `json:"message"`
	Balance   int64   `json:"balance,omitempty"`
	Dollars   float64 `json:"dollars,omitempty"`
	FeePoints int64   `json:"feePoints,omitempty"`
	Uncertain bool    `json:"uncertain,omitempty"`
	// 供前端就地刷新「今日剩余次数」，不必重新拉整页
	DailyWithdrawUsed  int64 `json:"dailyWithdrawUsed"`
	DailyWithdrawLimit int64 `json:"dailyWithdrawLimit"`
}
```

- [ ] **Step 6: 接入 `executeWithdrawInner`**

在 `backend/internal/economy/wallet_service.go` 的 `executeWithdrawInner` 中，把 `defer cancel()` 之后到 `preview := PreviewWithdraw(...)` 之间替换为：

```go
	// 限次与折扣都依赖 VIP 状态与后台配置，在锁内一次读齐。
	config, err := systemconfig.Get(ctx, service.db)
	if err != nil {
		return WithdrawResult{}, err
	}
	vipStatus, err := vip.Get(ctx, service.db, user.ID)
	if err != nil {
		return WithdrawResult{}, err
	}

	dailyLimit := withdrawDailyLimitFor(config, vipStatus.Active)
	feePercent := withdrawFeePercentFor(config, vipStatus.Active)
	withdrawDate := todayChina()
	usedCount, err := countWithdrawUsedToday(ctx, service.db, user.ID, withdrawDate)
	if err != nil {
		return WithdrawResult{}, err
	}
	// 管理员不豁免：抽奖的 IsAdmin bypass 是既有行为，但提现是资金操作，从严。
	if usedCount >= dailyLimit {
		return WithdrawResult{
			Success:            false,
			Code:               CodeWithdrawDailyLimit,
			Message:            fmt.Sprintf("今日提现次数已用完（%d/%d），请明天再试", usedCount, dailyLimit),
			DailyWithdrawUsed:  usedCount,
			DailyWithdrawLimit: dailyLimit,
		}, nil
	}

	preview := PreviewWithdraw(points, feePercent)
```

并在文件顶部 import 块补上 `"redemption/backend/internal/systemconfig"` 与 `"redemption/backend/internal/vip"`。

- [ ] **Step 7: 在三个终态返回点计数**

`executeWithdrawInner` 有三个会产生副作用的返回点，全部需要计数。**`failed` 分支不计数**（积分已全额退回）。

`uncertain` 也要计数的理由：它意味着积分已扣、new-api 额度可能已到账，只是回执未确认。若不计数，用户可以靠反复触发 `uncertain` 绕过每日上限。

改动 1 —— `creditResult.Success` 分支（成功）：

```go
	if creditResult.Success {
		if _, err := service.UpdateWalletTransaction(ctx, walletTransactionQuotaUpdate(
			transaction.ID,
			WalletStatusSuccess,
			fallbackWalletMessage(creditResult.Message, "提现成功到账"),
			creditResult,
		)); err != nil {
			return WithdrawResult{}, err
		}
		nextUsed := service.markWithdrawUsed(ctx, user.ID, withdrawDate, usedCount)
		return WithdrawResult{
			Success:            true,
			Message:            fmt.Sprintf("已成功提现 %d 积分至账户额度，到账 $%s", preview.Deducted, formatWalletDollars(preview.Dollars)),
			Balance:            deductResult.Balance,
			Dollars:            preview.Dollars,
			FeePoints:          preview.FeePoints,
			DailyWithdrawUsed:  nextUsed,
			DailyWithdrawLimit: dailyLimit,
		}, nil
	}
```

改动 2 —— `creditResult.Uncertain` 分支：在既有的 `return WithdrawResult{...}` 之前插入 `nextUsed := service.markWithdrawUsed(ctx, user.ID, withdrawDate, usedCount)`，并给返回值补 `DailyWithdrawUsed: nextUsed, DailyWithdrawLimit: dailyLimit`。

改动 3 —— 退款失败的 uncertain 分支（`if refundErr != nil || !refund.Success` 内部返回 `Uncertain: true` 的那个 `return`）：同样插入 `nextUsed := service.markWithdrawUsed(...)` 并补两个字段。

改动 4 —— 最后的 `failed` 分支（退款成功、额度入账失败）：**不计数**，只给返回值补 `DailyWithdrawUsed: usedCount, DailyWithdrawLimit: dailyLimit`（用检查时读到的值，不递增）。

改动 5 —— 前面三个早退分支（`!preview.OK`、余额不足、扣分失败）：同样补 `DailyWithdrawUsed: usedCount, DailyWithdrawLimit: dailyLimit`，均不递增。

- [ ] **Step 8: 写失败的集成测试**

创建 `backend/internal/economy/wallet_limit_integration_test.go`：

```go
//go:build integration

package economy

import (
	"context"
	"testing"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/platform/newapi"
)

func TestWithdrawRejectsAfterDailyLimitWithoutSideEffects(t *testing.T) {
	ctx := context.Background()
	quotaClient := &fakeWalletQuotaClient{}
	service, cleanup := newWalletIntegrationService(t, ctx, quotaClient)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 10000)

	// 默认上限 4 次
	for index := 0; index < 4; index++ {
		result, err := service.ExecuteWithdraw(ctx, user, 100)
		if err != nil {
			t.Fatalf("withdraw %d failed: %v", index, err)
		}
		if !result.Success {
			t.Fatalf("withdraw %d should succeed, got %+v", index, result)
		}
		if result.DailyWithdrawUsed != int64(index+1) || result.DailyWithdrawLimit != 4 {
			t.Fatalf("withdraw %d usage = %d/%d, want %d/4", index, result.DailyWithdrawUsed, result.DailyWithdrawLimit, index+1)
		}
	}

	balanceBefore, err := service.GetPointsSummary(ctx, user, 0)
	if err != nil {
		t.Fatalf("read balance failed: %v", err)
	}
	creditCallsBefore := len(quotaClient.creditCalls)

	result, err := service.ExecuteWithdraw(ctx, user, 100)
	if err != nil {
		t.Fatalf("fifth withdraw returned error: %v", err)
	}
	if result.Success || result.Code != CodeWithdrawDailyLimit {
		t.Fatalf("fifth withdraw should be rejected by daily limit, got %+v", result)
	}

	// 超限必须零副作用：既不扣分，也不调用 new-api
	balanceAfter, err := service.GetPointsSummary(ctx, user, 0)
	if err != nil {
		t.Fatalf("read balance failed: %v", err)
	}
	if balanceAfter.Balance != balanceBefore.Balance {
		t.Fatalf("balance changed on rejected withdraw: %d -> %d", balanceBefore.Balance, balanceAfter.Balance)
	}
	if len(quotaClient.creditCalls) != creditCallsBefore {
		t.Fatalf("rejected withdraw must not call new-api, calls %d -> %d", creditCallsBefore, len(quotaClient.creditCalls))
	}
}

func TestWithdrawCountsUncertainButNotFailed(t *testing.T) {
	ctx := context.Background()
	quotaClient := &fakeWalletQuotaClient{
		creditResults: []fakeQuotaResult{
			{result: newapi.QuotaResult{Success: false, Uncertain: true, Message: "入账结果不确定"}},
			{result: newapi.QuotaResult{Success: false, Message: "入账失败"}},
		},
	}
	service, cleanup := newWalletIntegrationService(t, ctx, quotaClient)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 10000)

	// uncertain 必须计数：否则用户能靠反复触发 uncertain 绕过上限
	uncertainResult, err := service.ExecuteWithdraw(ctx, user, 100)
	if err != nil {
		t.Fatalf("uncertain withdraw failed: %v", err)
	}
	if !uncertainResult.Uncertain || uncertainResult.DailyWithdrawUsed != 1 {
		t.Fatalf("uncertain withdraw should count once, got %+v", uncertainResult)
	}

	// failed 不计数：积分已全额退回
	failedResult, err := service.ExecuteWithdraw(ctx, user, 100)
	if err != nil {
		t.Fatalf("failed withdraw returned error: %v", err)
	}
	if failedResult.Success || failedResult.DailyWithdrawUsed != 1 {
		t.Fatalf("failed withdraw must not count, got %+v", failedResult)
	}

	used, err := countWithdrawUsedToday(ctx, service.db, user.ID, todayChina())
	if err != nil {
		t.Fatalf("count failed: %v", err)
	}
	if used != 1 {
		t.Fatalf("persisted used count = %d, want 1", used)
	}
}

func TestGetWithdrawDailyUsageReflectsVIPLimit(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newWalletIntegrationService(t, ctx, &fakeWalletQuotaClient{})
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 100)

	usage, err := service.GetWithdrawDailyUsage(ctx, user.ID)
	if err != nil {
		t.Fatalf("get usage failed: %v", err)
	}
	if usage.Limit != 4 || usage.Used != 0 || usage.Remaining != 4 {
		t.Fatalf("non-vip usage = %+v, want limit 4 remaining 4", usage)
	}
	if usage.ResetAtMs <= 0 {
		t.Fatalf("reset timestamp should be positive, got %d", usage.ResetAtMs)
	}

	grantVIPForTest(t, ctx, service, user, 30)

	vipUsage, err := service.GetWithdrawDailyUsage(ctx, user.ID)
	if err != nil {
		t.Fatalf("get vip usage failed: %v", err)
	}
	if vipUsage.Limit != 8 || vipUsage.Remaining != 8 {
		t.Fatalf("vip usage = %+v, want limit 8 remaining 8", vipUsage)
	}
}

// grantVIPForTest 直接写会籍表，绕开购买流程，供限次与折扣测试构造 VIP 用户。
func grantVIPForTest(t *testing.T, ctx context.Context, service *Service, user auth.User, days int64) {
	t.Helper()

	if _, err := service.db.Exec(ctx,
		`INSERT INTO vip_memberships (user_id, expires_at, created_at, updated_at)
		 VALUES ($1, now() + ($2::double precision * INTERVAL '1 day'), now(), now())
		 ON CONFLICT (user_id) DO UPDATE SET
		   expires_at = now() + ($2::double precision * INTERVAL '1 day'),
		   updated_at = now()`,
		user.ID, days,
	); err != nil {
		t.Fatalf("grant vip failed: %v", err)
	}
}
```

- [ ] **Step 9: 运行集成测试，确认通过**

Run: `cd backend && TEST_DATABASE_URL="<测试库>" go test -tags=integration ./internal/economy/ -run "TestWithdraw|TestGetWithdrawDailyUsage" -v`
Expected: 3 个测试 PASS

- [ ] **Step 10: 跑全量后端检查**

Run: `cd backend && go build ./... && go vet ./... && go test ./...`
Expected: 全绿（非集成测试）

- [ ] **Step 11: Commit**

```bash
git add backend/internal/economy/
git commit -m "feat: 提现新增每日次数限制与 VIP 手续费折扣"
```

---

### Task 6: 购买 VIP 月卡（含累计时长上限）

**Files:**
- Create: `backend/internal/economy/vip_purchase.go`
- Create: `backend/internal/economy/vip_purchase_test.go`
- Create: `backend/internal/economy/vip_purchase_integration_test.go`
- Modify: `backend/internal/economy/types.go:8-12`（新增来源常量）

**Interfaces:**
- Consumes: `vip.GetExpiry` / `vip.Extend`（Task 2）、`systemconfig.Get` 的 `VIPPricePoints` / `VIPDurationDays` / `VIPMaxTotalDays`（Task 3）、Task 1 的 `vip_memberships` 与 `vip_purchases` 表、既有 `beginIdempotency` / `completeIdempotency` / `ensureUser` / `getBalanceForUpdate` / `insertPointLog` / `randomID`
- Produces:
  - `economy.SourceVIPPurchase = "vip_purchase"`
  - `economy.CodeInsufficientPoints = "INSUFFICIENT_POINTS"`
  - `economy.CodeVIPMaxDurationReached = "VIP_MAX_DURATION_REACHED"`
  - `economy.PurchaseVIPResult{Success bool, Code string, Message string, Balance int64, ExpiresAt int64, DaysAdded int64, PointsSpent int64}`
  - `(*economy.Service).PurchaseVIP(ctx, user auth.User, idempotencyKey string) (PurchaseVIPResult, error)`
  - 包内纯函数 `vipPurchaseWindow(now, currentExpiry time.Time, hasMembership bool, durationDays, maxTotalDays int64) (newExpiresAt, ceiling time.Time)`

- [ ] **Step 1: 写失败的纯函数单元测试**

创建 `backend/internal/economy/vip_purchase_test.go`：

```go
package economy

import (
	"testing"
	"time"
)

func TestVIPPurchaseWindowStartsFromNowWithoutMembership(t *testing.T) {
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)

	newExpiresAt, ceiling := vipPurchaseWindow(now, time.Time{}, false, 30, 365)

	if want := now.Add(30 * 24 * time.Hour); !newExpiresAt.Equal(want) {
		t.Fatalf("newExpiresAt = %v, want %v", newExpiresAt, want)
	}
	if want := now.Add(365 * 24 * time.Hour); !ceiling.Equal(want) {
		t.Fatalf("ceiling = %v, want %v", ceiling, want)
	}
	if newExpiresAt.After(ceiling) {
		t.Fatal("first purchase should never exceed the ceiling under default config")
	}
}

func TestVIPPurchaseWindowAccumulatesFromUnexpiredMembership(t *testing.T) {
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	current := now.Add(10 * 24 * time.Hour)

	newExpiresAt, _ := vipPurchaseWindow(now, current, true, 30, 365)

	if want := current.Add(30 * 24 * time.Hour); !newExpiresAt.Equal(want) {
		t.Fatalf("newExpiresAt = %v, want %v", newExpiresAt, want)
	}
}

func TestVIPPurchaseWindowRestartsFromNowWhenExpired(t *testing.T) {
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	expired := now.Add(-10 * 24 * time.Hour)

	newExpiresAt, _ := vipPurchaseWindow(now, expired, true, 30, 365)

	if want := now.Add(30 * 24 * time.Hour); !newExpiresAt.Equal(want) {
		t.Fatalf("newExpiresAt = %v, want %v", newExpiresAt, want)
	}
}

func TestVIPPurchaseWindowAllowsExactCeiling(t *testing.T) {
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	// 剩余 335 天 + 月卡 30 天 = 365 天，恰好等于上限，应当允许
	current := now.Add(335 * 24 * time.Hour)

	newExpiresAt, ceiling := vipPurchaseWindow(now, current, true, 30, 365)

	if newExpiresAt.After(ceiling) {
		t.Fatalf("exact ceiling must be allowed: newExpiresAt=%v ceiling=%v", newExpiresAt, ceiling)
	}
}

func TestVIPPurchaseWindowRejectsOverCeiling(t *testing.T) {
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	// 剩余 336 天 + 30 天 = 366 天 > 365
	current := now.Add(336 * 24 * time.Hour)

	newExpiresAt, ceiling := vipPurchaseWindow(now, current, true, 30, 365)

	if !newExpiresAt.After(ceiling) {
		t.Fatalf("over-ceiling purchase must be rejected: newExpiresAt=%v ceiling=%v", newExpiresAt, ceiling)
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && go test ./internal/economy/ -run TestVIPPurchaseWindow -v`
Expected: 编译失败，`undefined: vipPurchaseWindow`

- [ ] **Step 3: 新增来源常量**

在 `backend/internal/economy/types.go` 的 `SourceRaffleWin` 之后加一行：

```go
	SourceVIPPurchase      = "vip_purchase"
```

（`point_ledger.source` 无 CHECK 约束，可自由扩展。）

- [ ] **Step 4: 写 `vip_purchase.go`**

```go
package economy

import (
	"context"
	"fmt"
	"time"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/systemconfig"
	"redemption/backend/internal/vip"

	"github.com/jackc/pgx/v5"
)

const (
	CodeInsufficientPoints    = "INSUFFICIENT_POINTS"
	CodeVIPMaxDurationReached = "VIP_MAX_DURATION_REACHED"
)

type PurchaseVIPResult struct {
	Success     bool   `json:"success"`
	Code        string `json:"code,omitempty"`
	Message     string `json:"message"`
	Balance     int64  `json:"balance"`
	ExpiresAt   int64  `json:"expiresAt"` // 毫秒
	DaysAdded   int64  `json:"daysAdded"`
	PointsSpent int64  `json:"pointsSpent"`
}

// vipPurchaseWindow 计算本次购买后的到期时间与允许的最晚到期时间。
// newExpiresAt 晚于 ceiling 即为超出累计时长上限；恰好相等是允许的。
//
// 加法统一用固定时长 24h × days，与 vip.Extend 的 SQL（days * INTERVAL '1 day'）
// 对齐。不要改用 AddDate —— 它按日历日推进，在带 DST 的时区会与 SQL 结果差一小时。
func vipPurchaseWindow(
	now time.Time,
	currentExpiry time.Time,
	hasMembership bool,
	durationDays int64,
	maxTotalDays int64,
) (time.Time, time.Time) {
	base := now
	if hasMembership && currentExpiry.After(base) {
		base = currentExpiry
	}
	newExpiresAt := base.Add(time.Duration(durationDays) * 24 * time.Hour)
	ceiling := now.Add(time.Duration(maxTotalDays) * 24 * time.Hour)
	return newExpiresAt, ceiling
}

// PurchaseVIP 用积分购买 VIP 月卡，重复购买时长累加。
//
// 幂等键是必要的：一次购买扣数千积分，网络重试造成的重复扣费代价高。
func (service *Service) PurchaseVIP(ctx context.Context, user auth.User, idempotencyKey string) (PurchaseVIPResult, error) {
	var output PurchaseVIPResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		scope := fmt.Sprintf("vip:purchase:%d", user.ID)
		if ok, err := beginIdempotency(ctx, tx, scope, idempotencyKey, &output); ok || err != nil {
			return err
		}
		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}

		config, err := systemconfig.Get(ctx, tx)
		if err != nil {
			return err
		}

		// 上限校验必须落在同一用户的串行化区间之内 —— 顺序不能颠倒。
		// vip.Extend 是累加语义：校验若落在全部 per-user 行锁之外，两个并发请求会
		// 各自读到同一个旧到期时间、各自算出「再加一个周期不超限」，执行后却累加了
		// 两个周期。
		//
		// 本事务有两道 per-user 行锁，校验排在它们之后：
		//  1. 上面的 ensureUser：INSERT INTO users ... ON CONFLICT (id) DO UPDATE
		//     （service.go:477）会以 FOR NO KEY UPDATE 强度锁住 users 行并持有到事务
		//     结束（DO UPDATE SET 的列与唯一索引列无交集，PostgreSQL 不升级到独占锁）；
		//     该锁与另一个 FOR NO KEY UPDATE 互斥，足以把并发购买串行化。
		//     这是先到的一道，实际把并发购买串起来的就是它。
		//  2. 下面的 getBalanceForUpdate：SELECT ... FOR UPDATE，扣分依赖的那一道。
		//
		// 改动其中任何一道之前，先确认另一道仍然覆盖本次校验。尤其当心 ensureUser：
		// 它名字上只是「确保用户存在」，实际承担着串行化职责。
		// 幂等键替代不了行锁：两个携带不同幂等键的请求是两笔各自合法的购买。
		balance, err := getBalanceForUpdate(ctx, tx, user.ID)
		if err != nil {
			return err
		}

		now := time.Now()
		currentExpiry, hasMembership, err := vip.GetExpiry(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		newExpiresAt, ceiling := vipPurchaseWindow(
			now, currentExpiry, hasMembership,
			config.VIPDurationDays, config.VIPMaxTotalDays,
		)
		if newExpiresAt.After(ceiling) {
			output = PurchaseVIPResult{
				Success: false,
				Code:    CodeVIPMaxDurationReached,
				Message: fmt.Sprintf("VIP 剩余时长已达上限 %d 天，请在临近到期时再购买", config.VIPMaxTotalDays),
				Balance: balance,
			}
			return completeIdempotency(ctx, tx, scope, idempotencyKey, output)
		}

		if balance < config.VIPPricePoints {
			output = PurchaseVIPResult{
				Success: false,
				Code:    CodeInsufficientPoints,
				Message: fmt.Sprintf("积分不足，还差 %d 积分", config.VIPPricePoints-balance),
				Balance: balance,
			}
			return completeIdempotency(ctx, tx, scope, idempotencyKey, output)
		}

		nextBalance := balance - config.VIPPricePoints
		if _, err := tx.Exec(ctx,
			`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
			nextBalance, user.ID,
		); err != nil {
			return err
		}
		description := fmt.Sprintf("购买站内 VIP %d 天", config.VIPDurationDays)
		if err := insertPointLog(ctx, tx, user.ID, -config.VIPPricePoints, SourceVIPPurchase, description, nextBalance); err != nil {
			return err
		}

		expiresAtAfter, err := vip.Extend(ctx, tx, user.ID, config.VIPDurationDays, now)
		if err != nil {
			return err
		}

		var expiresAtBefore *time.Time
		if hasMembership {
			expiresAtBefore = &currentExpiry
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO vip_purchases (id, user_id, points_cost, days, expires_at_before, expires_at_after, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, now())`,
			randomID(), user.ID, config.VIPPricePoints, config.VIPDurationDays,
			expiresAtBefore, expiresAtAfter,
		); err != nil {
			return err
		}

		output = PurchaseVIPResult{
			Success: true,
			Message: fmt.Sprintf("已开通 VIP %d 天，到期时间 %s",
				config.VIPDurationDays,
				expiresAtAfter.In(chinaZone()).Format("2006-01-02 15:04"),
			),
			Balance:     nextBalance,
			ExpiresAt:   expiresAtAfter.UnixMilli(),
			DaysAdded:   config.VIPDurationDays,
			PointsSpent: config.VIPPricePoints,
		}
		return completeIdempotency(ctx, tx, scope, idempotencyKey, output)
	})
	return output, err
}
```

- [ ] **Step 5: 运行单元测试，确认通过**

Run: `cd backend && go test ./internal/economy/ -run TestVIPPurchaseWindow -v && go build ./... && go vet ./...`
Expected: 5 个测试 PASS

- [ ] **Step 6: 写失败的集成测试**

创建 `backend/internal/economy/vip_purchase_integration_test.go`：

```go
//go:build integration

package economy

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"redemption/backend/internal/vip"
)

func TestPurchaseVIPRejectsInsufficientBalance(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 100)

	result, err := service.PurchaseVIP(ctx, user, randomID())
	if err != nil {
		t.Fatalf("purchase returned error: %v", err)
	}
	if result.Success || result.Code != CodeInsufficientPoints {
		t.Fatalf("expected insufficient points, got %+v", result)
	}

	if _, ok, err := vip.GetExpiry(ctx, service.db, user.ID); err != nil || ok {
		t.Fatalf("failed purchase must not create membership, ok=%v err=%v", ok, err)
	}
}

func TestPurchaseVIPAccumulatesDuration(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 10000)

	first, err := service.PurchaseVIP(ctx, user, randomID())
	if err != nil || !first.Success {
		t.Fatalf("first purchase failed: result=%+v err=%v", first, err)
	}
	if first.DaysAdded != 30 || first.PointsSpent != 3000 || first.Balance != 7000 {
		t.Fatalf("unexpected first purchase result: %+v", first)
	}

	second, err := service.PurchaseVIP(ctx, user, randomID())
	if err != nil || !second.Success {
		t.Fatalf("second purchase failed: result=%+v err=%v", second, err)
	}
	if second.Balance != 4000 {
		t.Fatalf("second purchase balance = %d, want 4000", second.Balance)
	}

	// 时长累加：第二次到期时间 = 第一次到期时间 + 30 天
	gap := second.ExpiresAt - first.ExpiresAt
	wantGap := (30 * 24 * time.Hour).Milliseconds()
	if gap != wantGap {
		t.Fatalf("expiry gap = %d ms, want %d ms", gap, wantGap)
	}

	var purchaseCount int64
	if err := service.db.QueryRow(ctx,
		`SELECT count(*) FROM vip_purchases WHERE user_id = $1`, user.ID,
	).Scan(&purchaseCount); err != nil {
		t.Fatalf("count purchases failed: %v", err)
	}
	if purchaseCount != 2 {
		t.Fatalf("vip_purchases rows = %d, want 2", purchaseCount)
	}
}

func TestPurchaseVIPRejectsOverMaxTotalDaysWithoutSideEffects(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 10000)

	// 直接把会籍推到距上限不足一个月卡的位置：剩余 350 天 + 30 天 > 365 天
	if _, err := service.db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())
		 ON CONFLICT (id) DO NOTHING`,
		user.ID, user.Username,
	); err != nil {
		t.Fatalf("ensure user failed: %v", err)
	}
	if _, err := service.db.Exec(ctx,
		`INSERT INTO vip_memberships (user_id, expires_at, created_at, updated_at)
		 VALUES ($1, now() + (350 * INTERVAL '1 day'), now(), now())
		 ON CONFLICT (user_id) DO UPDATE SET expires_at = excluded.expires_at`,
		user.ID,
	); err != nil {
		t.Fatalf("seed near-ceiling membership failed: %v", err)
	}

	balanceBefore, err := service.GetPointsSummary(ctx, user, 0)
	if err != nil {
		t.Fatalf("read balance failed: %v", err)
	}
	expiryBefore, _, err := vip.GetExpiry(ctx, service.db, user.ID)
	if err != nil {
		t.Fatalf("read expiry failed: %v", err)
	}

	result, err := service.PurchaseVIP(ctx, user, randomID())
	if err != nil {
		t.Fatalf("purchase returned error: %v", err)
	}
	if result.Success || result.Code != CodeVIPMaxDurationReached {
		t.Fatalf("expected max-duration rejection, got %+v", result)
	}

	// 校验先于扣分，必须零副作用
	balanceAfter, err := service.GetPointsSummary(ctx, user, 0)
	if err != nil {
		t.Fatalf("read balance failed: %v", err)
	}
	if balanceAfter.Balance != balanceBefore.Balance {
		t.Fatalf("balance changed on rejected purchase: %d -> %d", balanceBefore.Balance, balanceAfter.Balance)
	}
	expiryAfter, _, err := vip.GetExpiry(ctx, service.db, user.ID)
	if err != nil {
		t.Fatalf("read expiry failed: %v", err)
	}
	if !expiryAfter.Equal(expiryBefore) {
		t.Fatalf("expiry changed on rejected purchase: %v -> %v", expiryBefore, expiryAfter)
	}
}

func TestPurchaseVIPAllowsExactCeiling(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 10000)

	if _, err := service.db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())
		 ON CONFLICT (id) DO NOTHING`,
		user.ID, user.Username,
	); err != nil {
		t.Fatalf("ensure user failed: %v", err)
	}
	// 剩余略少于 335 天，+30 天后刚好不超过 365 天上限
	if _, err := service.db.Exec(ctx,
		`INSERT INTO vip_memberships (user_id, expires_at, created_at, updated_at)
		 VALUES ($1, now() + (334 * INTERVAL '1 day'), now(), now())
		 ON CONFLICT (user_id) DO UPDATE SET expires_at = excluded.expires_at`,
		user.ID,
	); err != nil {
		t.Fatalf("seed membership failed: %v", err)
	}

	result, err := service.PurchaseVIP(ctx, user, randomID())
	if err != nil || !result.Success {
		t.Fatalf("purchase at exact ceiling should succeed: result=%+v err=%v", result, err)
	}
}

func TestPurchaseVIPIdempotencyKeyDeductsOnce(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 10000)

	key := "same-key-" + randomID()
	var successes atomic.Int64
	runConcurrent(20, func(index int) {
		result, err := service.PurchaseVIP(ctx, user, key)
		if err != nil {
			t.Errorf("purchase %d returned error: %v", index, err)
			return
		}
		if result.Success {
			successes.Add(1)
		}
	})

	if successes.Load() != 20 {
		t.Fatalf("all duplicate-idempotency calls should replay success, got %d", successes.Load())
	}

	summary, err := service.GetPointsSummary(ctx, user, 0)
	if err != nil {
		t.Fatalf("read balance failed: %v", err)
	}
	if summary.Balance != 7000 {
		t.Fatalf("expected exactly one 3000-point deduction, got balance %d", summary.Balance)
	}

	var purchaseCount int64
	if err := service.db.QueryRow(ctx,
		`SELECT count(*) FROM vip_purchases WHERE user_id = $1`, user.ID,
	).Scan(&purchaseCount); err != nil {
		t.Fatalf("count purchases failed: %v", err)
	}
	if purchaseCount != 1 {
		t.Fatalf("vip_purchases rows = %d, want 1", purchaseCount)
	}
}

func TestPurchaseVIPConcurrentDistinctKeysRespectCeiling(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 100000)

	// 20 笔并发、各自幂等键不同的合法购买。行锁把它们串行化，
	// 每笔都基于前一笔的结果重新判定，累计剩余时长不得突破 365 天上限。
	runConcurrent(20, func(index int) {
		if _, err := service.PurchaseVIP(ctx, user, randomID()); err != nil {
			t.Errorf("purchase %d returned error: %v", index, err)
		}
	})

	expiry, ok, err := vip.GetExpiry(ctx, service.db, user.ID)
	if err != nil || !ok {
		t.Fatalf("read expiry failed: ok=%v err=%v", ok, err)
	}
	ceiling := time.Now().Add(365 * 24 * time.Hour)
	if expiry.After(ceiling) {
		t.Fatalf("concurrent purchases broke the ceiling: expiry=%v ceiling=%v", expiry, ceiling)
	}
}
```

- [ ] **Step 7: 运行集成测试，确认通过**

Run: `cd backend && TEST_DATABASE_URL="<测试库>" go test -tags=integration ./internal/economy/ -run TestPurchaseVIP -v`
Expected: 6 个测试全部 PASS

> 若 `TestPurchaseVIPConcurrentDistinctKeysRespectCeiling` 失败，说明上限校验被挪到了**所有 per-user 行锁之外**。注意锁有两道：先到的一道是 `ensureUser` 里的 `INSERT INTO users ... ON CONFLICT (id) DO UPDATE`（它以 `FOR NO KEY UPDATE` 强度锁住 `users` 行并持有到事务结束 —— `DO UPDATE SET` 的列与唯一索引列无交集，PostgreSQL 不升级到独占锁；该锁与另一个 `FOR NO KEY UPDATE` 互斥，足以把并发购买串行化，实际起串行化作用的就是它），第二道才是 `getBalanceForUpdate` 的 `SELECT ... FOR UPDATE`。只把校验挪到 `getBalanceForUpdate` 之前该测试仍会通过（`ensureUser` 兜住了）；挪到 `ensureUser` 之前才会变红。检查 Step 4 里校验相对这两者的先后顺序。

- [ ] **Step 8: Commit**

```bash
git add backend/internal/economy/vip_purchase.go backend/internal/economy/vip_purchase_test.go backend/internal/economy/vip_purchase_integration_test.go backend/internal/economy/types.go
git commit -m "feat: 新增 VIP 月卡购买，时长累加并受累计上限约束"
```

---

### Task 7: 交易流水列表与钱包聚合视图

**Files:**
- Modify: `backend/internal/economy/wallet_store.go`（追加 `ListWalletTransactions`）
- Create: `backend/internal/economy/wallet_overview.go`
- Create: `backend/internal/economy/wallet_overview_integration_test.go`

**Interfaces:**
- Consumes: 既有 `walletTransactionSelectColumns()` / `scanWalletTransaction()`、既有索引 `idx_wallet_transactions_user_created_at`、`GetWithdrawDailyUsage`（Task 5）、`vipPurchaseWindow`（Task 6）、`vip.Get` / `vip.GetExpiry`（Task 2）
- Produces:
  - `(*economy.Service).ListWalletTransactions(ctx, userID int64, limit int, offset int) ([]WalletTransaction, int64, error)`
  - `economy.WalletVIPBenefits{DailyWithdrawLimit, WithdrawFeePercent, DailyLotterySpins int64}`
  - `economy.WalletVIPView{Active bool, ExpiresAt *int64, PricePoints, DurationDays, MaxTotalDays int64, CanPurchase bool, PurchaseBlockedReason string, Benefits WalletVIPBenefits}`
  - `economy.WalletOverview{Balance, PointsPerDollar, MinWithdrawPoints, MinTopupDollars, FeePercent int64, DailyWithdraw WithdrawDailyUsage, VIP WalletVIPView}`
  - `(*economy.Service).GetWalletOverview(ctx, userID int64) (WalletOverview, error)`

> **`GetWalletOverview` 是纯本地查询，不碰 new-api。** 页面秒开且不会因外部服务不可用而白屏；账户额度由前端另行懒加载 `GET /api/store/topup`。

> **`CanPurchase` 复用 Task 6 的 `vipPurchaseWindow`**，不另写一套判定。前端直接用这个布尔值，不重算 —— 避免再造一处前后端双实现。它**不包含余额判断**：余额够不够前端用 `balance >= pricePoints` 自己比即可。

- [ ] **Step 1: 写失败的集成测试**

创建 `backend/internal/economy/wallet_overview_integration_test.go`：

```go
//go:build integration

package economy

import (
	"context"
	"testing"
)

func TestListWalletTransactionsPaginatesAndScopesToUser(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	other := integrationUser()
	other.ID = user.ID + 1

	if err := service.ensureWalletUser(ctx, user); err != nil {
		t.Fatalf("ensure user failed: %v", err)
	}
	if err := service.ensureWalletUser(ctx, other); err != nil {
		t.Fatalf("ensure other user failed: %v", err)
	}

	for index := 0; index < 5; index++ {
		if _, err := service.BeginWalletTransaction(ctx, BeginWalletTransactionInput{
			UserID:      user.ID,
			Operation:   WalletOperationWithdraw,
			PointsDelta: -100,
			Message:     "integration seed",
		}); err != nil {
			t.Fatalf("seed transaction %d failed: %v", index, err)
		}
	}
	if _, err := service.BeginWalletTransaction(ctx, BeginWalletTransactionInput{
		UserID:      other.ID,
		Operation:   WalletOperationTopup,
		PointsDelta: 100,
		Message:     "other user",
	}); err != nil {
		t.Fatalf("seed other transaction failed: %v", err)
	}

	transactions, total, err := service.ListWalletTransactions(ctx, user.ID, 2, 0)
	if err != nil {
		t.Fatalf("list failed: %v", err)
	}
	if total != 5 || len(transactions) != 2 {
		t.Fatalf("page 1: total=%d len=%d, want 5/2", total, len(transactions))
	}
	for _, transaction := range transactions {
		if transaction.UserID != user.ID {
			t.Fatalf("leaked other user's transaction: %+v", transaction)
		}
	}

	lastPage, total, err := service.ListWalletTransactions(ctx, user.ID, 2, 4)
	if err != nil {
		t.Fatalf("list last page failed: %v", err)
	}
	if total != 5 || len(lastPage) != 1 {
		t.Fatalf("last page: total=%d len=%d, want 5/1", total, len(lastPage))
	}
}

func TestGetWalletOverviewReflectsVIPState(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newWalletIntegrationService(t, ctx, &fakeWalletQuotaClient{})
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 5000)

	overview, err := service.GetWalletOverview(ctx, user.ID)
	if err != nil {
		t.Fatalf("overview failed: %v", err)
	}
	if overview.Balance != 5000 || overview.FeePercent != 100 {
		t.Fatalf("non-vip overview = %+v, want balance 5000 feePercent 100", overview)
	}
	if overview.VIP.Active || overview.VIP.ExpiresAt != nil {
		t.Fatalf("expected non-vip state, got %+v", overview.VIP)
	}
	if !overview.VIP.CanPurchase {
		t.Fatalf("non-vip user should be able to purchase, got %+v", overview.VIP)
	}
	// benefits 恒定下发，供非 VIP 用户看到「开通后能得到什么」
	if overview.VIP.Benefits.DailyWithdrawLimit != 8 ||
		overview.VIP.Benefits.WithdrawFeePercent != 50 ||
		overview.VIP.Benefits.DailyLotterySpins != 2 {
		t.Fatalf("unexpected benefits: %+v", overview.VIP.Benefits)
	}
	if overview.DailyWithdraw.Limit != 4 {
		t.Fatalf("non-vip withdraw limit = %d, want 4", overview.DailyWithdraw.Limit)
	}

	grantVIPForTest(t, ctx, service, user, 30)

	vipOverview, err := service.GetWalletOverview(ctx, user.ID)
	if err != nil {
		t.Fatalf("vip overview failed: %v", err)
	}
	if !vipOverview.VIP.Active || vipOverview.VIP.ExpiresAt == nil {
		t.Fatalf("expected active vip, got %+v", vipOverview.VIP)
	}
	if vipOverview.FeePercent != 50 || vipOverview.DailyWithdraw.Limit != 8 {
		t.Fatalf("vip overview = feePercent %d limit %d, want 50/8", vipOverview.FeePercent, vipOverview.DailyWithdraw.Limit)
	}
}

func TestGetWalletOverviewBlocksPurchaseAtCeiling(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newWalletIntegrationService(t, ctx, &fakeWalletQuotaClient{})
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 5000)
	grantVIPForTest(t, ctx, service, user, 350)

	overview, err := service.GetWalletOverview(ctx, user.ID)
	if err != nil {
		t.Fatalf("overview failed: %v", err)
	}
	if overview.VIP.CanPurchase {
		t.Fatalf("user at ceiling should not be able to purchase, got %+v", overview.VIP)
	}
	if overview.VIP.PurchaseBlockedReason == "" {
		t.Fatalf("blocked purchase must carry a reason, got %+v", overview.VIP)
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && TEST_DATABASE_URL="<测试库>" go test -tags=integration ./internal/economy/ -run "TestListWalletTransactions|TestGetWalletOverview" -v`
Expected: 编译失败，`undefined: ListWalletTransactions` / `undefined: GetWalletOverview`

- [ ] **Step 3: 追加 `ListWalletTransactions`**

在 `backend/internal/economy/wallet_store.go` 末尾追加：

```go
// ListWalletTransactions 按创建时间倒序分页返回用户的钱包流水，同时返回总条数。
//
// 刻意用 offset 分页而非游标分页：单用户的流水量受每日提现限次天然约束
// （每天至多 4-8 条提现 + 少量充值），offset 分页足够，游标分页是不必要的复杂度。
func (service *Service) ListWalletTransactions(ctx context.Context, userID int64, limit int, offset int) ([]WalletTransaction, int64, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	var total int64
	if err := service.db.QueryRow(ctx,
		`SELECT count(*) FROM wallet_transactions WHERE user_id = $1`,
		userID,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := service.db.Query(ctx,
		`SELECT `+walletTransactionSelectColumns()+`
		   FROM wallet_transactions
		  WHERE user_id = $1
		  ORDER BY created_at DESC, id DESC
		  LIMIT $2 OFFSET $3`,
		userID, limit, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	transactions := make([]WalletTransaction, 0, limit)
	for rows.Next() {
		transaction, err := scanWalletTransaction(rows)
		if err != nil {
			return nil, 0, err
		}
		transactions = append(transactions, transaction)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return transactions, total, nil
}
```

- [ ] **Step 4: 写 `wallet_overview.go`**

```go
package economy

import (
	"context"
	"fmt"
	"time"

	"redemption/backend/internal/systemconfig"
	"redemption/backend/internal/vip"
)

// WalletVIPBenefits 恒定下发（无论用户是否 VIP），用于非 VIP 用户看到「开通后能得到什么」。
type WalletVIPBenefits struct {
	DailyWithdrawLimit int64 `json:"dailyWithdrawLimit"`
	WithdrawFeePercent int64 `json:"withdrawFeePercent"`
	DailyLotterySpins  int64 `json:"dailyLotterySpins"`
}

type WalletVIPView struct {
	Active       bool   `json:"active"`
	ExpiresAt    *int64 `json:"expiresAt,omitempty"` // 毫秒；从未购买过时省略
	PricePoints  int64  `json:"pricePoints"`
	DurationDays int64  `json:"durationDays"`
	MaxTotalDays int64  `json:"maxTotalDays"`
	// CanPurchase 只反映累计时长上限，不含余额。余额够不够由前端自行比较。
	CanPurchase           bool              `json:"canPurchase"`
	PurchaseBlockedReason string            `json:"purchaseBlockedReason,omitempty"`
	Benefits              WalletVIPBenefits `json:"benefits"`
}

type WalletOverview struct {
	Balance           int64 `json:"balance"`
	PointsPerDollar   int64 `json:"pointsPerDollar"`
	MinWithdrawPoints int64 `json:"minWithdrawPoints"`
	MinTopupDollars   int64 `json:"minTopupDollars"`
	// FeePercent 是当前用户适用的手续费百分比，非 VIP 为 100。仅供前端预览展示，
	// 后端在实际提现时会重新计算，因此不构成安全面。
	FeePercent    int64              `json:"feePercent"`
	DailyWithdraw WithdrawDailyUsage `json:"dailyWithdraw"`
	VIP           WalletVIPView      `json:"vip"`
}

// GetWalletOverview 聚合钱包页首屏所需的全部本地数据。
// 刻意不查询 new-api：账户额度由前端懒加载 GET /api/store/topup，
// 避免把外部服务调用拖进首屏关键路径。
func (service *Service) GetWalletOverview(ctx context.Context, userID int64) (WalletOverview, error) {
	config, err := systemconfig.Get(ctx, service.db)
	if err != nil {
		return WalletOverview{}, err
	}

	var balance int64
	if err := service.db.QueryRow(ctx,
		`SELECT COALESCE((SELECT balance FROM point_accounts WHERE user_id = $1), 0)`,
		userID,
	).Scan(&balance); err != nil {
		return WalletOverview{}, err
	}

	currentExpiry, hasMembership, err := vip.GetExpiry(ctx, service.db, userID)
	if err != nil {
		return WalletOverview{}, err
	}
	usedCount, err := countWithdrawUsedToday(ctx, service.db, userID, todayChina())
	if err != nil {
		return WalletOverview{}, err
	}

	now := time.Now()
	active := hasMembership && currentExpiry.After(now)
	limit := withdrawDailyLimitFor(config, active)

	// 与 PurchaseVIP 步骤 5 完全同一套判定，避免前后端各算一遍。
	newExpiresAt, ceiling := vipPurchaseWindow(
		now, currentExpiry, hasMembership,
		config.VIPDurationDays, config.VIPMaxTotalDays,
	)
	canPurchase := !newExpiresAt.After(ceiling)
	blockedReason := ""
	if !canPurchase {
		blockedReason = fmt.Sprintf("VIP 剩余时长已达上限 %d 天，请在临近到期时再购买", config.VIPMaxTotalDays)
	}

	vipView := WalletVIPView{
		Active:                active,
		PricePoints:           config.VIPPricePoints,
		DurationDays:          config.VIPDurationDays,
		MaxTotalDays:          config.VIPMaxTotalDays,
		CanPurchase:           canPurchase,
		PurchaseBlockedReason: blockedReason,
		Benefits: WalletVIPBenefits{
			DailyWithdrawLimit: config.VIPDailyWithdrawLimit,
			WithdrawFeePercent: config.VIPWithdrawFeePercent,
			DailyLotterySpins:  config.VIPDailyLotterySpins,
		},
	}
	if hasMembership {
		milliseconds := currentExpiry.UnixMilli()
		vipView.ExpiresAt = &milliseconds
	}

	return WalletOverview{
		Balance:           balance,
		PointsPerDollar:   PointsPerDollar,
		MinWithdrawPoints: MinWithdrawPoints,
		MinTopupDollars:   MinTopupDollars,
		FeePercent:        withdrawFeePercentFor(config, active),
		DailyWithdraw: WithdrawDailyUsage{
			Used:      usedCount,
			Limit:     limit,
			Remaining: maxInt64(0, limit-usedCount),
			ResetAtMs: nextChinaMidnightMillis(now),
		},
		VIP: vipView,
	}, nil
}
```

- [ ] **Step 5: 运行集成测试，确认通过**

Run: `cd backend && TEST_DATABASE_URL="<测试库>" go test -tags=integration ./internal/economy/ -run "TestListWalletTransactions|TestGetWalletOverview" -v`
Expected: 3 个测试 PASS

- [ ] **Step 6: 跑全量后端检查**

Run: `cd backend && go build ./... && go vet ./... && go test ./...`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add backend/internal/economy/
git commit -m "feat: 新增钱包流水分页查询与钱包聚合视图"
```

---

### Task 8: 抽奖每日免费次数计数化

把每日免费次数从「固定 1 次」的布尔标记改为「1 + VIP 赠送数」的计数器。

**Files:**
- Modify: `backend/internal/lottery/service.go:173-231`（`spinPointsTimes` / `spinPointsOnceInTx`）
- Modify: `backend/internal/lottery/service.go:808-870`（`consumeSpinCount`）
- Modify: `backend/internal/lottery/service.go:589-602`（`dailySpinUsage`）
- Modify: `backend/internal/lottery/service.go:328-357`（`PagePayload` 的 `canSpin` 与返回值）
- Modify: `backend/internal/lottery/types.go:81-94`（`PagePayload` 两个新字段）
- Modify: `backend/internal/lottery/service_integration_test.go:61-90`
- Modify: `backend/internal/httpserver/lottery_handlers.go:44` 附近

**Interfaces:**
- Consumes: `vip.Get`（Task 2）、`systemconfig.Get` 的 `VIPDailyLotterySpins`（Task 3）、Task 1 的 `lottery_daily_spins.free_used_count` 列
- Produces:
  - `lottery.PagePayload` 新增 `FreeSpinLimit int64` / `FreeSpinRemaining int64`（JSON 名 `freeSpinLimit` / `freeSpinRemaining`）
  - 包内 `consumeSpinCount(ctx, tx, userID, dailySpinLimit, freeSpinQuota int64) error`
  - 包内 `spinPointsOnceInTx(ctx, tx, user, config, freeSpinQuota int64) (SpinResult, error)`
  - 包内 `dailySpinUsage(ctx, userID, date) (used int64, claimed bool, freeUsed int64, err error)`

> **`daily_free_claimed` 旧列保留并继续同步写入 `(free_used_count > 0)`。** 它被 `free_used_count` 取代后成了冗余列，但集成测试有多处断言、且它是既有对账口径。这是刻意的兼容层，不是遗留死代码 —— 代码里必须注释说明，不要在本任务里删除它。

> **`extra_spins` 优先消耗的既有语义不变。** 顺序仍是：先判每日总上限 → 有额外次数就消耗额外次数 → 否则消耗免费次数 → 都没有则 `ErrNoSpinChance`。

- [ ] **Step 1: 写失败的集成测试**

在 `backend/internal/lottery/service_integration_test.go` 末尾追加：

```go
func TestSpinPointsConsumesVIPFreeSpins(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过彩票集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()
	if _, err := pgmigration.NewRunner(db, "../../migrations").Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}
	resetLotteryIntegrationConfig(t, ctx, db)

	userID := int64(99801 + time.Now().UnixNano()%1_000_000_000)
	recordID := "lottery_vip_" + strconv.FormatInt(userID, 10)
	cleanupLotteryIntegrationUser(t, ctx, db, userID, recordID)
	defer cleanupLotteryIntegrationUser(t, ctx, db, userID, recordID)
	defer func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM vip_memberships WHERE user_id = $1`, userID)
	}()

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'lottery_vip', 'Lottery VIP', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance) VALUES ($1, 0)`, userID,
	); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_assets (user_id, extra_spins, card_draws, makeup_cards)
		 VALUES ($1, 0, 0, 0)`, userID,
	); err != nil {
		t.Fatalf("seed user assets failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO vip_memberships (user_id, expires_at, created_at, updated_at)
		 VALUES ($1, now() + (30 * INTERVAL '1 day'), now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed vip membership failed: %v", err)
	}

	service := NewService(db)
	user := auth.User{ID: userID, Username: "lottery_vip", DisplayName: "Lottery VIP"}

	// VIP 默认额度 = 1 + 2 = 3 次
	payload, err := service.PagePayload(ctx, user, 20)
	if err != nil {
		t.Fatalf("page payload failed: %v", err)
	}
	if payload.FreeSpinLimit != 3 || payload.FreeSpinRemaining != 3 {
		t.Fatalf("vip free spins = %d/%d, want 3/3", payload.FreeSpinRemaining, payload.FreeSpinLimit)
	}

	for index := 0; index < 3; index++ {
		if _, err := service.SpinPoints(ctx, user); err != nil {
			t.Fatalf("spin %d failed: %v", index, err)
		}
	}

	if _, err := service.SpinPoints(ctx, user); !errors.Is(err, ErrNoSpinChance) {
		t.Fatalf("fourth spin should exhaust free quota, got %v", err)
	}

	after, err := service.PagePayload(ctx, user, 20)
	if err != nil {
		t.Fatalf("page payload failed: %v", err)
	}
	if after.FreeSpinRemaining != 0 || after.FreeSpinLimit != 3 {
		t.Fatalf("after exhaustion = %d/%d, want 0/3", after.FreeSpinRemaining, after.FreeSpinLimit)
	}
	// HasSpunToday 语义保持为 free_used_count > 0
	if !after.HasSpunToday {
		t.Fatalf("hasSpunToday should stay true after using free spins: %+v", after)
	}

	// 旧列必须同步写入，既有对账口径不能断
	var freeUsed int64
	var claimed bool
	if err := db.QueryRow(ctx,
		`SELECT free_used_count, daily_free_claimed FROM lottery_daily_spins
		  WHERE user_id = $1 AND spin_date = $2`,
		userID, todayChina().Format("2006-01-02"),
	).Scan(&freeUsed, &claimed); err != nil {
		t.Fatalf("query daily spins failed: %v", err)
	}
	if freeUsed != 3 || !claimed {
		t.Fatalf("free_used_count=%d daily_free_claimed=%v, want 3/true", freeUsed, claimed)
	}
}

func TestSpinPointsNonVIPKeepsSingleFreeSpin(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过彩票集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()
	if _, err := pgmigration.NewRunner(db, "../../migrations").Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}
	resetLotteryIntegrationConfig(t, ctx, db)

	userID := int64(99901 + time.Now().UnixNano()%1_000_000_000)
	recordID := "lottery_free_" + strconv.FormatInt(userID, 10)
	cleanupLotteryIntegrationUser(t, ctx, db, userID, recordID)
	defer cleanupLotteryIntegrationUser(t, ctx, db, userID, recordID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'lottery_free', 'Lottery Free', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance) VALUES ($1, 0)`, userID,
	); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}
	// 2 次额外次数：必须先于免费次数被消耗
	if _, err := db.Exec(ctx,
		`INSERT INTO user_assets (user_id, extra_spins, card_draws, makeup_cards)
		 VALUES ($1, 2, 0, 0)`, userID,
	); err != nil {
		t.Fatalf("seed user assets failed: %v", err)
	}

	service := NewService(db)
	user := auth.User{ID: userID, Username: "lottery_free", DisplayName: "Lottery Free"}

	payload, err := service.PagePayload(ctx, user, 20)
	if err != nil {
		t.Fatalf("page payload failed: %v", err)
	}
	if payload.FreeSpinLimit != 1 || payload.FreeSpinRemaining != 1 {
		t.Fatalf("non-vip free spins = %d/%d, want 1/1", payload.FreeSpinRemaining, payload.FreeSpinLimit)
	}

	// 前两次消耗 extra_spins，免费次数不动
	for index := 0; index < 2; index++ {
		if _, err := service.SpinPoints(ctx, user); err != nil {
			t.Fatalf("spin %d failed: %v", index, err)
		}
	}
	mid, err := service.PagePayload(ctx, user, 20)
	if err != nil {
		t.Fatalf("page payload failed: %v", err)
	}
	if mid.ExtraSpins != 0 || mid.FreeSpinRemaining != 1 {
		t.Fatalf("extra spins must be consumed first: extra=%d freeRemaining=%d", mid.ExtraSpins, mid.FreeSpinRemaining)
	}

	// 第三次才消耗免费次数
	if _, err := service.SpinPoints(ctx, user); err != nil {
		t.Fatalf("third spin failed: %v", err)
	}
	if _, err := service.SpinPoints(ctx, user); !errors.Is(err, ErrNoSpinChance) {
		t.Fatalf("fourth spin should have no chance left, got %v", err)
	}
}

func TestSpinPointsBatchConsumesFreeQuotaWithinOneTx(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过彩票集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()
	if _, err := pgmigration.NewRunner(db, "../../migrations").Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}
	resetLotteryIntegrationConfig(t, ctx, db)

	userID := int64(99951 + time.Now().UnixNano()%1_000_000_000)
	recordID := "lottery_batch_" + strconv.FormatInt(userID, 10)
	cleanupLotteryIntegrationUser(t, ctx, db, userID, recordID)
	defer cleanupLotteryIntegrationUser(t, ctx, db, userID, recordID)
	defer func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM vip_memberships WHERE user_id = $1`, userID)
	}()

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'lottery_batch', 'Lottery Batch', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance) VALUES ($1, 0)`, userID,
	); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_assets (user_id, extra_spins, card_draws, makeup_cards)
		 VALUES ($1, 0, 0, 0)`, userID,
	); err != nil {
		t.Fatalf("seed user assets failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO vip_memberships (user_id, expires_at, created_at, updated_at)
		 VALUES ($1, now() + (30 * INTERVAL '1 day'), now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed vip membership failed: %v", err)
	}

	service := NewService(db)
	user := auth.User{ID: userID, Username: "lottery_batch", DisplayName: "Lottery Batch"}

	// 五连抽在同一事务内循环消耗：额度只有 3 次，应抽满 3 次并提交已完成的部分
	results, err := service.SpinPointsBatch(ctx, user, 5)
	if err != nil {
		t.Fatalf("batch spin failed: %v", err)
	}
	if len(results) != 3 {
		t.Fatalf("batch produced %d results, want 3", len(results))
	}

	var freeUsed int64
	if err := db.QueryRow(ctx,
		`SELECT free_used_count FROM lottery_daily_spins WHERE user_id = $1 AND spin_date = $2`,
		userID, todayChina().Format("2006-01-02"),
	).Scan(&freeUsed); err != nil {
		t.Fatalf("query daily spins failed: %v", err)
	}
	if freeUsed != 3 {
		t.Fatalf("free_used_count = %d, want 3", freeUsed)
	}
}
```

若测试文件顶部缺少 `errors` / `auth` 的 import，补上。

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && TEST_DATABASE_URL="<测试库>" go test -tags=integration ./internal/lottery/ -run "TestSpinPoints(ConsumesVIP|NonVIP|Batch)" -v`
Expected: 编译失败，`payload.FreeSpinLimit undefined`

- [ ] **Step 3: 给 `PagePayload` 加字段**

在 `backend/internal/lottery/types.go` 的 `PagePayload` 中，`ExtraSpins` 之后插入：

```go
	// FreeSpinLimit 是今日免费总额度 = 1 + VIP 赠送数
	FreeSpinLimit     int64 `json:"freeSpinLimit"`
	FreeSpinRemaining int64 `json:"freeSpinRemaining"`
```

- [ ] **Step 4: 改 `consumeSpinCount`**

替换 `backend/internal/lottery/service.go:808-870` 的整个函数：

```go
// consumeSpinCount 消耗一次抽奖机会。
//
// freeSpinQuota 是今日免费次数总额度（1 + VIP 赠送数）。
// 消耗顺序保持既有语义：先判每日总上限，再优先消耗 extra_spins，最后才用免费次数。
func consumeSpinCount(ctx context.Context, tx pgx.Tx, userID int64, dailySpinLimit int64, freeSpinQuota int64) error {
	if dailySpinLimit < 1 {
		dailySpinLimit = 1
	}
	if freeSpinQuota < 0 {
		freeSpinQuota = 0
	}
	spinDate := todayChina().Format("2006-01-02")
	if _, err := tx.Exec(ctx,
		`INSERT INTO lottery_daily_spins (user_id, spin_date, used_count, daily_free_claimed, free_used_count, updated_at)
		 VALUES ($1, $2, 0, false, 0, now())
		 ON CONFLICT (user_id, spin_date) DO NOTHING`,
		userID, spinDate,
	); err != nil {
		return err
	}

	var usedCount int64
	var dailyFreeClaimed bool
	var freeUsedCount int64
	if err := tx.QueryRow(ctx,
		`SELECT used_count, daily_free_claimed, free_used_count
		   FROM lottery_daily_spins
		  WHERE user_id = $1 AND spin_date = $2
		  FOR UPDATE`,
		userID, spinDate,
	).Scan(&usedCount, &dailyFreeClaimed, &freeUsedCount); err != nil {
		return err
	}
	if usedCount >= dailySpinLimit {
		return ErrDailyLimitReached
	}

	var extraSpins int64
	if err := tx.QueryRow(ctx,
		`SELECT extra_spins FROM user_assets WHERE user_id = $1 FOR UPDATE`,
		userID,
	).Scan(&extraSpins); err != nil {
		return err
	}

	if extraSpins > 0 {
		if _, err := tx.Exec(ctx,
			`UPDATE user_assets
			    SET extra_spins = extra_spins - 1,
			        updated_at = now()
			  WHERE user_id = $1`,
			userID,
		); err != nil {
			return err
		}
	} else if freeUsedCount < freeSpinQuota {
		freeUsedCount++
	} else {
		return ErrNoSpinChance
	}

	// daily_free_claimed 是被 free_used_count 取代的旧列，这里刻意继续同步写入：
	// 既有集成测试与对账口径仍在读它。这不是遗留死代码，删除前需先迁移那些读取方。
	_, err := tx.Exec(ctx,
		`UPDATE lottery_daily_spins
		    SET used_count = used_count + 1,
		        free_used_count = $3,
		        daily_free_claimed = ($3 > 0),
		        updated_at = now()
		  WHERE user_id = $1 AND spin_date = $2`,
		userID, spinDate, freeUsedCount,
	)
	return err
}
```

- [ ] **Step 5: 把 `freeSpinQuota` 传进抽奖链路**

`spinPointsOnceInTx` 是包级函数拿不到 `service`，所以额度由 `spinPointsTimes`（method）在**开事务后、循环前**算一次并传入。五连抽在同一事务内循环消耗，同事务的 `UPDATE` 后再 `SELECT ... FOR UPDATE` 能读到自己的修改，语义正确。

改 `spinPointsOnceInTx` 签名与调用：

```go
func spinPointsOnceInTx(ctx context.Context, tx pgx.Tx, user auth.User, config Config, freeSpinQuota int64) (SpinResult, error) {
	// ...activeTiers / selectedTier 不变...

	if !user.IsAdmin {
		if err := consumeSpinCount(ctx, tx, user.ID, config.DailySpinLimit, freeSpinQuota); err != nil {
			return SpinResult{}, err
		}
	}
	// ...其余不变...
```

在 `spinPointsTimes` 里，`config.Mode != ModePoints` 检查之后、`results := make(...)` 之前插入：

```go
	freeSpinQuota, err := freeSpinQuotaInTx(ctx, tx, user.ID)
	if err != nil {
		return nil, err
	}
```

并把循环体内的调用改为 `spinPointsOnceInTx(ctx, tx, user, config, freeSpinQuota)`。

在 `dailySpinUsage` 附近新增：

```go
// freeSpinQuotaInTx 返回今日免费次数总额度：基础 1 次 + VIP 赠送数。
func freeSpinQuotaInTx(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	sysConfig, err := systemconfig.Get(ctx, tx)
	if err != nil {
		return 0, err
	}
	status, err := vip.Get(ctx, tx, userID)
	if err != nil {
		return 0, err
	}
	if status.Active {
		return 1 + sysConfig.VIPDailyLotterySpins, nil
	}
	return 1, nil
}
```

在 `backend/internal/lottery/service.go` 的 import 块补上 `"redemption/backend/internal/systemconfig"` 与 `"redemption/backend/internal/vip"`。

- [ ] **Step 6: 改 `dailySpinUsage` 与 `PagePayload`**

替换 `dailySpinUsage`：

```go
func (service *Service) dailySpinUsage(ctx context.Context, userID int64, date time.Time) (int64, bool, int64, error) {
	var used int64
	var claimed bool
	var freeUsed int64
	err := service.db.QueryRow(ctx,
		`SELECT used_count, daily_free_claimed, free_used_count
		   FROM lottery_daily_spins
		  WHERE user_id = $1 AND spin_date = $2`,
		userID, date.Format("2006-01-02"),
	).Scan(&used, &claimed, &freeUsed)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, 0, nil
	}
	return used, claimed, freeUsed, err
}
```

在 `PagePayload` 中把 `dailySpinUsage` 的调用改为接收 4 个返回值（新增 `dailyFreeUsed`），并在 `bypassSpinLimit := user.IsAdmin` 之后插入额度计算、替换 `canSpin` 与返回值：

```go
	freeSpinQuota, err := service.freeSpinQuota(ctx, user.ID)
	if err != nil {
		return PagePayload{}, err
	}
	freeSpinRemaining := freeSpinQuota - dailyFreeUsed
	if freeSpinRemaining < 0 {
		freeSpinRemaining = 0
	}

	bypassSpinLimit := user.IsAdmin
	remaining := config.DailySpinLimit - dailySpinUsed
	if remaining < 0 {
		remaining = 0
	}
	hasQuota := remaining > 0 || bypassSpinLimit
	// HasSpunToday 语义保持为「今日已用过免费次数」，供既有前端与对账继续使用
	hasSpunToday := dailyFreeClaimed
	canSpin := config.Enabled && canSpinByMode && hasQuota &&
		(bypassSpinLimit || freeSpinRemaining > 0 || extraSpins > 0)
	if bypassSpinLimit {
		remaining = config.DailySpinLimit
	}
```

返回值中在 `ExtraSpins` 之后补：

```go
		FreeSpinLimit:      freeSpinQuota,
		FreeSpinRemaining:  freeSpinRemaining,
```

`PagePayload` 用的是连接池不是事务，再加一个包装：

```go
// freeSpinQuota 是 freeSpinQuotaInTx 的连接池版本，供只读的 PagePayload 使用。
func (service *Service) freeSpinQuota(ctx context.Context, userID int64) (int64, error) {
	sysConfig, err := systemconfig.Get(ctx, service.db)
	if err != nil {
		return 0, err
	}
	status, err := vip.Get(ctx, service.db, userID)
	if err != nil {
		return 0, err
	}
	if status.Active {
		return 1 + sysConfig.VIPDailyLotterySpins, nil
	}
	return 1, nil
}
```

- [ ] **Step 7: 更新既有集成测试的断言**

`backend/internal/lottery/service_integration_test.go:61-67` 的种子数据补上 `free_used_count`：

```go
	if _, err := db.Exec(ctx,
		`INSERT INTO lottery_daily_spins (user_id, spin_date, used_count, daily_free_claimed, free_used_count)
		 VALUES ($1, $2, 1, true, 1)`,
		userID, todayChina().Format("2006-01-02"),
	); err != nil {
		t.Fatalf("seed daily spin failed: %v", err)
	}
```

`:88` 的断言补上新字段（该用户非 VIP，额度 1、已用 1、剩余 0，但有 2 次 extra_spins 所以 `CanSpin` 仍为 true）：

```go
	if !payload.HasSpunToday || payload.ExtraSpins != 2 || payload.DailySpinUsed != 1 || payload.DailySpinRemaining != 9 || !payload.CanSpin {
		t.Fatalf("unexpected page spin state: %+v", payload)
	}
	if payload.FreeSpinLimit != 1 || payload.FreeSpinRemaining != 0 {
		t.Fatalf("unexpected free spin state: %+v", payload)
	}
```

- [ ] **Step 8: 下发新字段到抽奖接口**

在 `backend/internal/httpserver/lottery_handlers.go` 中，`response["hasSpunToday"] = payload.HasSpunToday` 之后追加：

```go
	response["freeSpinLimit"] = payload.FreeSpinLimit
	response["freeSpinRemaining"] = payload.FreeSpinRemaining
```

- [ ] **Step 9: 运行集成测试，确认通过**

Run: `cd backend && TEST_DATABASE_URL="<测试库>" go test -tags=integration ./internal/lottery/ -v`
Expected: 新增 3 个测试与既有全部用例 PASS

- [ ] **Step 10: 跑全量后端检查**

Run: `cd backend && go build ./... && go vet ./... && go test ./...`
Expected: 全绿

- [ ] **Step 11: Commit**

```bash
git add backend/internal/lottery/ backend/internal/httpserver/lottery_handlers.go
git commit -m "feat: 抽奖每日免费次数改为 1 + VIP 赠送数"
```

---

### Task 9: 钱包与 VIP 的三个 HTTP 接口

**Files:**
- Modify: `backend/internal/httpserver/economy_handlers.go`（追加 3 个 handler，文件从 348 行增至约 470 行；另改 `withdrawWallet` 的响应体）
- Modify: `backend/internal/httpserver/server.go:199-209` 附近（3 条路由）

**Interfaces:**
- Consumes: `GetWalletOverview` / `ListWalletTransactions`（Task 7）、`PurchaseVIP`（Task 6）
- Produces:
  - `GET /api/wallet` → `{success, data: WalletOverview}`
  - `GET /api/wallet/transactions?limit=20&offset=0` → `{success, data: {transactions, total, limit, offset, hasMore}}`
  - `POST /api/vip/purchase` → `{success, message, code?, data: {newBalance, expiresAt, daysAdded, pointsSpent}}`

- [ ] **Step 1: 写三个 handler**

在 `backend/internal/httpserver/economy_handlers.go` 的 `requireUser` 方法之前插入：

```go
func (handlers economyHandlers) getWallet(writer http.ResponseWriter, request *http.Request) {
	user, ok := handlers.requireUser(writer, request)
	if !ok {
		return
	}

	overview, err := handlers.service.GetWalletOverview(request.Context(), user.ID)
	if err != nil {
		handlers.deps.Logger.Error("查询钱包概览失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    overview,
	})
}

func (handlers economyHandlers) listWalletTransactions(writer http.ResponseWriter, request *http.Request) {
	user, ok := handlers.requireUser(writer, request)
	if !ok {
		return
	}

	limit := parsePositiveQueryInt(request, "limit", 20, 100)
	offset := parsePositiveQueryInt(request, "offset", 0, math.MaxInt32)

	transactions, total, err := handlers.service.ListWalletTransactions(request.Context(), user.ID, limit, offset)
	if err != nil {
		handlers.deps.Logger.Error("查询钱包流水失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"transactions": transactions,
			"total":        total,
			"limit":        limit,
			"offset":       offset,
			"hasMore":      int64(offset+len(transactions)) < total,
		},
	})
}

func (handlers economyHandlers) purchaseVIP(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := handlers.requireUser(writer, request)
	if !ok {
		return
	}
	if handlers.rejectRateLimited(writer, request, *user, storeExchangeRateLimit) {
		return
	}

	var payload struct {
		IdempotencyKey string `json:"idempotencyKey"`
	}
	// 空请求体也视为合法：幂等键可以只走请求头
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请求体格式无效",
		})
		return
	}

	// 三重取值顺序与 exchangeItem 保持一致
	idempotencyKey := strings.TrimSpace(request.Header.Get("Idempotency-Key"))
	if idempotencyKey == "" {
		idempotencyKey = strings.TrimSpace(request.Header.Get("X-Idempotency-Key"))
	}
	if idempotencyKey == "" {
		idempotencyKey = strings.TrimSpace(payload.IdempotencyKey)
	}

	result, err := handlers.service.PurchaseVIP(request.Context(), *user, idempotencyKey)
	if err != nil {
		handlers.deps.Logger.Error("购买 VIP 失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}

	status := http.StatusOK
	if !result.Success {
		status = http.StatusBadRequest
	}
	writeJSON(writer, status, map[string]any{
		"success": result.Success,
		"message": result.Message,
		"code":    result.Code,
		"data": map[string]any{
			"newBalance":  result.Balance,
			"expiresAt":   result.ExpiresAt,
			"daysAdded":   result.DaysAdded,
			"pointsSpent": result.PointsSpent,
		},
	})
}

// parsePositiveQueryInt 解析非负整数查询参数，缺失或非法时回落到 fallback，并夹到 max。
func parsePositiveQueryInt(request *http.Request, name string, fallback int, max int) int {
	raw := strings.TrimSpace(request.URL.Query().Get(name))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return fallback
	}
	if value > max {
		return max
	}
	return value
}
```

在文件顶部 import 块补上 `"io"` 与 `"strconv"`。

- [ ] **Step 2: 注册路由**

在 `backend/internal/httpserver/server.go` 的 `api.Post("/store/withdraw", economyHandlers.withdrawWallet)` 之后插入：

```go
		api.Get("/wallet", economyHandlers.getWallet)
		api.Get("/wallet/transactions", economyHandlers.listWalletTransactions)
		api.Post("/vip/purchase", economyHandlers.purchaseVIP)
```

- [ ] **Step 3: 把限次字段下发到提现响应**

Task 5 给 `economy.WithdrawResult` 加了 `Code` / `DailyWithdrawUsed` / `DailyWithdrawLimit`，但 `withdrawWallet` 是**手工构造 `data` map** 的，不补这一步前端拿不到这些值，Task 12 的「就地刷新今日剩余次数」会失效。

替换 `backend/internal/httpserver/economy_handlers.go` 中 `withdrawWallet` 末尾的 `writeJSON`：

```go
	writeJSON(writer, status, map[string]any{
		"success":   success,
		"message":   result.Message,
		"code":      result.Code,
		"uncertain": result.Uncertain,
		"data": map[string]any{
			"newBalance":         balance,
			"dollars":            result.Dollars,
			"feePoints":          result.FeePoints,
			"dailyWithdrawUsed":  result.DailyWithdrawUsed,
			"dailyWithdrawLimit": result.DailyWithdrawLimit,
		},
	})
```

- [ ] **Step 4: 编译与静态检查**

Run: `cd backend && go build ./... && go vet ./... && go test ./...`
Expected: 全绿

- [ ] **Step 5: 手工冒烟三个接口**

后端跑起来后，用自签会话 cookie 验证（签发方式见 spec §10.5：用 `auth.CreateSessionToken` 生成 HMAC token，本地 `SESSION_SECRET` 默认 `local-development-session-secret-at-least-32-chars`，再 `document.cookie = "app_session=<token>; path=/"`）。

Run:
```bash
curl -s -b "app_session=<token>" http://localhost:8080/api/wallet | head -c 800
curl -s -b "app_session=<token>" "http://localhost:8080/api/wallet/transactions?limit=2&offset=0" | head -c 400
curl -s -b "app_session=<token>" -X POST -H "Content-Type: application/json" -H "Idempotency-Key: smoke-1" -d '{}' http://localhost:8080/api/vip/purchase
```
Expected: 前两个返回 `success: true` 的完整结构；第三个视余额返回开通成功或 `INSUFFICIENT_POINTS`。**充值/提现的 new-api 调用在本地不可用**（`newWalletQuotaClient` 返回 nil，接口会返回 `503 NEW_API_NOT_CONFIGURED`），但这三个新接口不依赖它。

- [ ] **Step 6: Commit**

```bash
git add backend/internal/httpserver/economy_handlers.go backend/internal/httpserver/server.go
git commit -m "feat: 新增钱包概览、钱包流水与 VIP 购买接口"
```

---

### Task 10: 后台配置接口扩展到 7 个字段

**Files:**
- Modify: `backend/internal/httpserver/admin_config_handlers.go:49-90`

**Interfaces:**
- Consumes: `systemconfig.UpdateInput` 的 8 个字段与 8 个校验函数（Task 3）
- Produces: `PUT /api/admin/config` 接受并校验 8 个字段（1 个既有 + 7 个新增），逐项越界与跨字段不匹配都返回 `400` 与中文提示

> **`nil → 重置为默认值` 的语义不变**，所以前端必须全量提交。这里对每个字段都做「缺失即报错」处理，把静默重置转成显式失败，比默默把管理员没填的字段清成默认值更安全。

- [ ] **Step 1: 替换 `update` 的解析与校验**

替换 `backend/internal/httpserver/admin_config_handlers.go` 的 `update` 方法体中从 `var payload struct` 到 `config, err := handlers.service.Update(...)` 之间的部分：

```go
	var payload struct {
		DailyPointsLimit      json.RawMessage `json:"dailyPointsLimit"`
		DailyWithdrawLimit    json.RawMessage `json:"dailyWithdrawLimit"`
		VIPDailyWithdrawLimit json.RawMessage `json:"vipDailyWithdrawLimit"`
		VIPPricePoints        json.RawMessage `json:"vipPricePoints"`
		VIPDurationDays       json.RawMessage `json:"vipDurationDays"`
		VIPWithdrawFeePercent json.RawMessage `json:"vipWithdrawFeePercent"`
		VIPDailyLotterySpins  json.RawMessage `json:"vipDailyLotterySpins"`
		VIPMaxTotalDays       json.RawMessage `json:"vipMaxTotalDays"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}

	fields := []adminConfigField{
		{raw: payload.DailyPointsLimit, valid: systemconfig.ValidDailyPointsLimit, message: "每日积分上限必须在 100 - 100000 之间"},
		{raw: payload.DailyWithdrawLimit, valid: systemconfig.ValidDailyWithdrawLimit, message: "普通用户每日提现次数必须在 1 - 100 之间"},
		{raw: payload.VIPDailyWithdrawLimit, valid: systemconfig.ValidVIPDailyWithdrawLimit, message: "VIP 每日提现次数必须在 1 - 100 之间"},
		{raw: payload.VIPPricePoints, valid: systemconfig.ValidVIPPricePoints, message: "月卡价格必须在 1 - 1000000 积分之间"},
		{raw: payload.VIPDurationDays, valid: systemconfig.ValidVIPDurationDays, message: "月卡时长必须在 1 - 365 天之间"},
		{raw: payload.VIPWithdrawFeePercent, valid: systemconfig.ValidVIPWithdrawFeePercent, message: "VIP 手续费百分比必须在 0 - 100 之间"},
		{raw: payload.VIPDailyLotterySpins, valid: systemconfig.ValidVIPDailyLotterySpins, message: "VIP 每日赠送抽奖次数必须在 0 - 50 之间"},
		{raw: payload.VIPMaxTotalDays, valid: systemconfig.ValidVIPMaxTotalDays, message: "VIP 累计时长上限必须在 1 - 3650 天之间"},
	}
	values := make([]int64, len(fields))
	for index, field := range fields {
		value, ok := parseAdminConfigField(writer, field)
		if !ok {
			return
		}
		values[index] = value
	}

	// 跨字段：上限低于月卡时长时，用户第一次购买就会被拒，功能直接不可用
	if !systemconfig.ValidVIPDurationAgainstMaxTotal(values[4], values[7]) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "VIP 累计时长上限不能小于月卡时长",
		})
		return
	}

	config, err := handlers.service.Update(request.Context(), systemconfig.UpdateInput{
		DailyPointsLimit:      &values[0],
		DailyWithdrawLimit:    &values[1],
		VIPDailyWithdrawLimit: &values[2],
		VIPPricePoints:        &values[3],
		VIPDurationDays:       &values[4],
		VIPWithdrawFeePercent: &values[5],
		VIPDailyLotterySpins:  &values[6],
		VIPMaxTotalDays:       &values[7],
		UpdatedBy:             admin.Username,
	})
```

- [ ] **Step 2: 替换旧的解析辅助函数**

删除 `parseAdminConfigDailyLimit`，替换为：

```go
type adminConfigField struct {
	raw     json.RawMessage
	valid   func(int64) bool
	message string
}

// parseAdminConfigField 解析并校验单个配置字段。
// 缺失字段一律报错而不是回落默认值：systemconfig.Update 的 nil 语义是「重置为默认值」，
// 静默重置管理员没填的字段比直接报错危险得多。
func parseAdminConfigField(writer http.ResponseWriter, field adminConfigField) (int64, bool) {
	value, ok := parseJSONInt64Value(field.raw)
	if !ok || !field.valid(value) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": field.message,
		})
		return 0, false
	}
	return value, true
}
```

同时把 `ErrInvalid` 分支的提示改成通用文案：

```go
	if errors.Is(err, systemconfig.ErrInvalid) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "配置取值非法，请检查各项范围"})
		return
	}
```

- [ ] **Step 3: 编译与检查**

Run: `cd backend && go build ./... && go vet ./... && go test ./...`
Expected: 全绿

- [ ] **Step 4: 手工验证全量提交与部分提交**

Run:
```bash
# 全量提交：应成功
curl -s -X PUT -b "app_session=<管理员 token>" -H "Content-Type: application/json" \
  -d '{"dailyPointsLimit":5000,"dailyWithdrawLimit":4,"vipDailyWithdrawLimit":8,"vipPricePoints":3000,"vipDurationDays":30,"vipWithdrawFeePercent":50,"vipDailyLotterySpins":2,"vipMaxTotalDays":365}' \
  http://localhost:8080/api/admin/config

# 漏字段：应 400 而不是静默重置
curl -s -X PUT -b "app_session=<管理员 token>" -H "Content-Type: application/json" \
  -d '{"dailyPointsLimit":5000}' http://localhost:8080/api/admin/config

# 跨字段冲突：应 400
curl -s -X PUT -b "app_session=<管理员 token>" -H "Content-Type: application/json" \
  -d '{"dailyPointsLimit":5000,"dailyWithdrawLimit":4,"vipDailyWithdrawLimit":8,"vipPricePoints":3000,"vipDurationDays":30,"vipWithdrawFeePercent":50,"vipDailyLotterySpins":2,"vipMaxTotalDays":20}' \
  http://localhost:8080/api/admin/config
```
Expected: 第一条 `success: true`；第二条返回「普通用户每日提现次数必须在 1 - 100 之间」；第三条返回「VIP 累计时长上限不能小于月卡时长」。

- [ ] **Step 5: Commit**

```bash
git add backend/internal/httpserver/admin_config_handlers.go
git commit -m "feat: 后台配置接口支持钱包与 VIP 的 7 个新字段"
```

---

### Task 11: 网关路径与审计脚本

**Files:**
- Modify: `gateway/Caddyfile:368-371` 之后（`/api/store/withdraw` 段落后）
- Modify: `scripts/audit-gateway-allowed-cutovers.mjs:127` 之后

**Interfaces:**
- Consumes: Task 9 注册的 3 条路由
- Produces: 网关放行 `/api/wallet`、`/api/wallet/transactions`、`/api/vip/purchase`

- [ ] **Step 1: 加网关路径**

在 `gateway/Caddyfile` 的 `handle /api/store/withdraw { ... }` 块之后插入：

```
	# 钱包页与站内 VIP 已完成 Go 迁移，逐条精确切流，禁止通配。
	handle /api/wallet {
		reverse_proxy {$API_UPSTREAM:api:8080}
	}
	handle /api/wallet/transactions {
		reverse_proxy {$API_UPSTREAM:api:8080}
	}
	handle /api/vip/purchase {
		reverse_proxy {$API_UPSTREAM:api:8080}
	}
```

- [ ] **Step 2: 同步审计白名单**

在 `scripts/audit-gateway-allowed-cutovers.mjs` 的 `'/api/store/withdraw',` 之后插入：

```js
  '/api/wallet',
  '/api/wallet/transactions',
  '/api/vip/purchase',
```

- [ ] **Step 3: 跑审计脚本**

Run: `node scripts/audit-gateway-allowed-cutovers.mjs`
Expected: `ok: true`，且 `checkedApiCutovers` 从 **160** 变为 **163**。若数字对不上，说明 Caddyfile 与白名单没有一一对应。

- [ ] **Step 4: Commit**

```bash
git add gateway/Caddyfile scripts/audit-gateway-allowed-cutovers.mjs
git commit -m "chore: 网关放行钱包与 VIP 的三条路径"
```

---

### Task 12: 钱包页 `/wallet`

**Files:**
- Create: `src/app/wallet/page.tsx`

**Interfaces:**
- Consumes: `GET /api/wallet`、`GET /api/wallet/transactions`、`POST /api/vip/purchase`（Task 9）；既有的 `POST /api/store/withdraw`、`GET|POST /api/store/topup`；`previewWithdraw(points, feePercent)` / `previewTopup`（Task 4）
- Produces: 路由 `/wallet`；Task 13 的 `/store` 入口卡片会链接到它

> **样式来源**：`src/app/store/page.tsx` 的 `<style jsx global>`（L1812 起）中 `wallet-*`、`lwf-modal-wallet`、`wallet-result-*` 相关规则，整体搬到本页的 `<style jsx>`，并按「页面区块」而非「弹窗」调整布局容器（去掉 `position: fixed` / backdrop / z-index 一类的弹窗定位规则，保留卡片、输入、费率表、结果条的视觉规则）。Task 13 负责从 `/store` 删掉它们。

- [ ] **Step 1: 建页面骨架与类型**

创建 `src/app/wallet/page.tsx`，先写类型与数据层：

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import {
  MIN_TOPUP_DOLLARS,
  MIN_WITHDRAW_POINTS,
  POINTS_PER_DOLLAR,
  WITHDRAW_FEE_TIERS,
  previewTopup,
  previewWithdraw,
} from '@/lib/wallet-rules';

interface WalletVIPBenefits {
  dailyWithdrawLimit: number;
  withdrawFeePercent: number;
  dailyLotterySpins: number;
}

interface WalletVIPView {
  active: boolean;
  expiresAt?: number;
  pricePoints: number;
  durationDays: number;
  maxTotalDays: number;
  canPurchase: boolean;
  purchaseBlockedReason?: string;
  benefits: WalletVIPBenefits;
}

interface WalletDailyWithdraw {
  used: number;
  limit: number;
  remaining: number;
  resetAtMs: number;
}

interface WalletOverview {
  balance: number;
  pointsPerDollar: number;
  minWithdrawPoints: number;
  minTopupDollars: number;
  feePercent: number;
  dailyWithdraw: WalletDailyWithdraw;
  vip: WalletVIPView;
}

interface WalletTransaction {
  id: string;
  operation: 'withdraw' | 'topup';
  status: 'pending' | 'success' | 'failed' | 'uncertain';
  pointsDelta: number;
  dollarsDelta: number;
  feePoints?: number;
  netPoints?: number;
  message: string;
  createdAt: number;
}

interface NewApiBalance {
  balanceDollars: number;
  balanceWholeDollars: number;
}

type WalletResultKind = 'success' | 'error' | 'warning';

interface WalletResult {
  kind: WalletResultKind;
  title: string;
  detail: string;
}

const TRANSACTION_PAGE_SIZE = 20;

const STATUS_LABELS: Record<WalletTransaction['status'], { text: string; className: string }> = {
  success: { text: '成功', className: 'wallet-badge-success' },
  pending: { text: '处理中', className: 'wallet-badge-pending' },
  failed: { text: '失败', className: 'wallet-badge-failed' },
  uncertain: { text: '结果待确认', className: 'wallet-badge-uncertain' },
};
```

- [ ] **Step 2: 写数据加载与派生状态**

```tsx
export default function WalletPage() {
  const [overview, setOverview] = useState<WalletOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WalletResult | null>(null);

  const [withdrawInput, setWithdrawInput] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [topupInput, setTopupInput] = useState('');
  const [topping, setTopping] = useState(false);
  const [purchasing, setPurchasing] = useState(false);

  const [newApiBalance, setNewApiBalance] = useState<NewApiBalance | null>(null);
  const [newApiLoading, setNewApiLoading] = useState(false);
  const [newApiError, setNewApiError] = useState<string | null>(null);

  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [transactionTotal, setTransactionTotal] = useState(0);
  const [transactionOffset, setTransactionOffset] = useState(0);
  const [transactionsLoading, setTransactionsLoading] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/wallet');
      const data = await res.json();
      if (!data.success) {
        setError(data.message ?? '读取钱包信息失败');
        return;
      }
      setOverview(data.data as WalletOverview);
      setError(null);
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTransactions = useCallback(async (offset: number) => {
    setTransactionsLoading(true);
    try {
      const res = await fetch(`/api/wallet/transactions?limit=${TRANSACTION_PAGE_SIZE}&offset=${offset}`);
      const data = await res.json();
      if (data.success) {
        setTransactions(data.data.transactions ?? []);
        setTransactionTotal(data.data.total ?? 0);
        setTransactionOffset(offset);
      }
    } catch {
      // 流水加载失败不阻塞页面其余部分，静默保留上一页数据
    } finally {
      setTransactionsLoading(false);
    }
  }, []);

  // 账户额度懒加载：走外部 new-api，失败不能拖垮首屏
  const loadNewApiBalance = useCallback(async () => {
    setNewApiLoading(true);
    setNewApiError(null);
    try {
      const res = await fetch('/api/store/topup');
      const data = await res.json();
      if (!data.success) {
        setNewApiError(data?.message ?? '读取账户额度失败');
        return;
      }
      setNewApiBalance({
        balanceDollars: data.data.newApiBalanceDollars ?? 0,
        balanceWholeDollars: data.data.newApiBalanceWholeDollars ?? 0,
      });
    } catch {
      setNewApiError('读取账户额度失败');
    } finally {
      setNewApiLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    void loadTransactions(0);
    void loadNewApiBalance();
  }, [loadOverview, loadTransactions, loadNewApiBalance]);

  const withdrawPoints = Number(withdrawInput);
  const withdrawPreview = useMemo(
    () => previewWithdraw(withdrawPoints, overview?.feePercent ?? 100),
    [withdrawPoints, overview?.feePercent],
  );
  const topupPreview = useMemo(() => previewTopup(Number(topupInput)), [topupInput]);

  const canAffordVIP = (overview?.balance ?? 0) >= (overview?.vip.pricePoints ?? 0);
  // 两个原因都成立时优先显示上限原因，它更需要解释
  const vipBlockedReason = !overview
    ? null
    : !overview.vip.canPurchase
      ? (overview.vip.purchaseBlockedReason ?? '当前无法购买')
      : !canAffordVIP
        ? `积分不足，还差 ${overview.vip.pricePoints - overview.balance} 积分`
        : null;
```

- [ ] **Step 3: 写三个操作 handler**

```tsx
  const handleWithdraw = async () => {
    if (!withdrawPreview.ok || withdrawing) return;
    setWithdrawing(true);
    try {
      const res = await fetch('/api/store/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: withdrawPoints }),
      });
      const data = await res.json();

      // 用响应里的用量就地更新，不重新拉整页
      if (typeof data?.data?.dailyWithdrawLimit === 'number') {
        setOverview((current) =>
          current
            ? {
                ...current,
                balance: data.data.newBalance ?? current.balance,
                dailyWithdraw: {
                  ...current.dailyWithdraw,
                  used: data.data.dailyWithdrawUsed,
                  limit: data.data.dailyWithdrawLimit,
                  remaining: Math.max(0, data.data.dailyWithdrawLimit - data.data.dailyWithdrawUsed),
                },
              }
            : current,
        );
      }

      if (data.success) {
        setResult({
          kind: data.uncertain ? 'warning' : 'success',
          title: data.uncertain ? '提现结果待确认' : '提现成功',
          detail: data.message ?? '',
        });
        setWithdrawInput('');
      } else {
        setResult({ kind: 'error', title: '提现失败', detail: data.message ?? '未知错误' });
      }
      void loadTransactions(0);
    } catch {
      setResult({ kind: 'error', title: '提现失败', detail: '网络错误' });
    } finally {
      setWithdrawing(false);
    }
  };

  const handleTopup = async () => {
    if (!topupPreview.ok || topping) return;
    setTopping(true);
    try {
      const res = await fetch('/api/store/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dollars: topupPreview.spentDollars }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({
          kind: data.uncertain ? 'warning' : 'success',
          title: data.uncertain ? '充值结果待确认' : '充值成功',
          detail: data.message ?? '',
        });
        setTopupInput('');
        setOverview((current) =>
          current ? { ...current, balance: data.data.newBalance ?? current.balance } : current,
        );
        void loadNewApiBalance();
      } else {
        setResult({ kind: 'error', title: '充值失败', detail: data.message ?? '未知错误' });
      }
      void loadTransactions(0);
    } catch {
      setResult({ kind: 'error', title: '充值失败', detail: '网络错误' });
    } finally {
      setTopping(false);
    }
  };

  const handlePurchaseVIP = async () => {
    if (purchasing || !overview) return;
    setPurchasing(true);
    try {
      const res = await fetch('/api/vip/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `vip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ kind: 'success', title: 'VIP 已开通', detail: data.message ?? '' });
        // 就地更新到期时间与余额；maxTotalDays 已在本地缓存，无需回传
        void loadOverview();
        void loadTransactions(0);
      } else {
        setResult({ kind: 'error', title: '开通失败', detail: data.message ?? '未知错误' });
      }
    } catch {
      setResult({ kind: 'error', title: '开通失败', detail: '网络错误' });
    } finally {
      setPurchasing(false);
    }
  };
```

- [ ] **Step 4: 写页面结构**

自上而下按这个结构渲染，样式类名沿用从 `/store` 迁移过来的 `wallet-*` 规则：

```
页头（返回商店的 Link + 刷新按钮 → loadOverview + loadTransactions(0)）
双余额卡片
  ├─ 积分余额        ← overview.balance
  └─ 账户额度        ← newApiBalance；newApiLoading 显示骨架，newApiError 显示重试按钮，
                       失败不阻塞其余区块
VIP 状态条
  ├─ 非 VIP：三项特权说明（benefits 三个字段）+ 「{pricePoints} 积分开通 {durationDays} 天」按钮
  └─ VIP：到期时间（new Date(expiresAt).toLocaleString('zh-CN')）+ 剩余天数
          + 「续费」按钮 + 「时长累加，最多囤 {maxTotalDays} 天」说明
  按钮 disabled={purchasing || Boolean(vipBlockedReason)}，
  vipBlockedReason 非空时显示在按钮下方
操作区（桌面左右两栏 / 移动端上下堆叠）
  ├─ 积分提现：输入 + withdrawPreview（手续费、到账美元）
  │            + 「今日剩余 {dailyWithdraw.remaining}/{dailyWithdraw.limit} 次」
  │            + feePercent < 100 时展示「VIP {feePercent}% 手续费」标记
  │            + WITHDRAW_FEE_TIERS 阶梯表
  └─ 额度充值：输入 + topupPreview + 账户额度卡片
交易流水列表
  ├─ 每行：时间、操作类型、积分变动、状态徽章（STATUS_LABELS）、message
  ├─ uncertain 行附「结果待确认」提示文案
  └─ 分页：上一页/下一页按 transactionOffset ± TRANSACTION_PAGE_SIZE，
          共 transactionTotal 条
结果条（result 非空时渲染，复用 wallet-result-* 样式，可手动关闭）
```

`dailyWithdraw.remaining === 0` 时提现按钮置灰，并显示「次数将在 {new Date(resetAtMs).toLocaleString('zh-CN')} 重置」。

- [ ] **Step 5: 迁移样式**

把 `src/app/store/page.tsx` 的 `<style jsx global>` 中所有 `wallet-*` / `lwf-modal-wallet` / `wallet-result-*` 规则复制进本页的 `<style jsx>`，并做两处调整：
1. 删掉弹窗定位相关声明（`position: fixed`、`inset`、`z-index`、backdrop 遮罩），改为页面内的常规块级布局
2. 新增 `wallet-badge-success` / `wallet-badge-pending` / `wallet-badge-failed` / `wallet-badge-uncertain` 四个徽章类：绿 / 灰 / 红 / 橙

- [ ] **Step 6: 类型检查与 lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 无错误

- [ ] **Step 7: 手工验证页面**

启动前后端后访问 `http://localhost:3000/wallet`（需自签会话 cookie，方式见 spec §10.5）。

Expected:
- 首屏立即渲染积分余额、VIP 状态、今日提现次数（不等 new-api）
- 账户额度区块单独 loading；本地 `NEW_API_URL` 为空时该区块显示错误与重试按钮，**其余区块正常**
- 提现输入 100 时预览显示正确的手续费；VIP 用户显示折后费用
- 流水列表分页可用

> **本地只能验证到「限次检查」与「页面渲染」这一层。** 实际资金链路（提现/充值调用 new-api）在本地不可用，需要集成测试或联调环境。

- [ ] **Step 8: Commit**

```bash
git add src/app/wallet/page.tsx
git commit -m "feat: 新增独立钱包页，含流水列表与 VIP 开通入口"
```

---

### Task 13: 从 `/store` 摘除钱包弹窗

**Files:**
- Modify: `src/app/store/page.tsx`

**Interfaces:**
- Consumes: Task 12 的 `/wallet` 路由
- Produces: `/store` 只保留一个跳转钱包页的入口卡片

> **只清理本次改动造成的孤儿代码。** 删除因摘除而失去引用的 import、state、函数属于分内范围；`store/page.tsx` 中与钱包无关的既有代码一律不动，包括你可能觉得写得不好的部分。

下表行号以当前工作区为准，实施时**以内容匹配为准**（前面的删除会让后面的行号前移）。建议自下而上删除。

| 位置 | 处理 |
|---|---|
| L1765-1810 | 删除结果弹窗 JSX |
| L1492-1763 | 删除双 Tab 钱包弹窗 JSX（`{walletOpen && (` 到其闭合） |
| L1467-1473 | 规则第 04 条改为一句「提现充值已迁至钱包页」的指引 |
| L917-939 | stat-card 从 `<button onClick>` 改为 `<Link href="/wallet">`，文案改「我的钱包」 |
| L483-646 | 删除 `closeWallet` / `handleWithdraw` / `handleTopup` |
| L452-481 | 删除 `loadNewApiBalance` 与其 `useEffect` |
| L425-450 | 删除提现/充值的 `useMemo` 预览与派生变量 |
| L254-264 | 删除 10 个钱包 state（`walletOpen` / `walletTab` / `newApiBalance` / `newApiBalanceLoading` / `newApiBalanceError` / `walletResult` 等） |
| L129-153 | 删除 `NewApiBalance` / `WalletResultKind` / `WalletResultDetail` / `WalletResult` 四个类型 |
| L35-42 | 删除 `@/lib/wallet-rules` 的 5 个导入 |
| L5-34 | 逐个确认后删除**仅**钱包使用的图标导入（`ArrowLeftRight` / `ArrowUpRight` / `ArrowDownLeft` / `BadgeCheck` / `Info` / `Loader2` 等）；**被其他区块复用的不要动** |
| `<style jsx global>` | 删除 `wallet-*` / `lwf-modal-wallet` / `wallet-result-*` 规则（已在 Task 12 迁走） |

- [ ] **Step 1: 自下而上删除 JSX 与样式**

按上表从 L1765 开始向上删除到 L1492，再处理规则第 04 条与 stat-card，最后删 `<style jsx global>` 中的钱包规则。

stat-card 改造后形如：

```tsx
<Link href="/wallet" className="stat-card">
  {/* 保留既有的图标与数值结构，文案改为「我的钱包」 */}
</Link>
```

若文件顶部还没有 `import Link from 'next/link';`，补上。

- [ ] **Step 2: 删除逻辑层与类型**

按上表删除 handler、`useEffect`、`useMemo`、state 与类型定义。

- [ ] **Step 3: 清理孤儿导入**

删除 `@/lib/wallet-rules` 的整个 import 语句。图标导入逐个用编辑器搜索确认在文件其余部分无引用后再删。

- [ ] **Step 4: 类型检查与 lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 无错误、无 unused 警告。若报 unused，说明还有漏删的孤儿；若报 undefined，说明删多了。

- [ ] **Step 5: 手工验证**

访问 `http://localhost:3000/store`。

Expected: 页面正常渲染；钱包入口卡片点击跳转 `/wallet`；不再有钱包弹窗；商店其余功能（兑换、分类、规则）不受影响。

- [ ] **Step 6: Commit**

```bash
git add src/app/store/page.tsx
git commit -m "refactor: 商店移除钱包弹窗，改为跳转钱包页"
```

---

### Task 14: `/lottery` 前端免费次数展示

**Files:**
- Modify: `src/app/lottery/page.tsx:94-104`（载荷类型）
- Modify: `src/app/lottery/page.tsx:167-171` 附近（state）
- Modify: `src/app/lottery/page.tsx:239-243` 附近（赋值）
- Modify: `src/app/lottery/page.tsx:405-418` 附近（抽奖后的乐观更新）
- Modify: `src/app/lottery/page.tsx:758-770`（「今日免费」pill）

**Interfaces:**
- Consumes: `GET /api/lottery` 的 `freeSpinLimit` / `freeSpinRemaining`（Task 8）
- Produces: 无

> **L758-770 的 pill 目前硬编码 `hasSpunToday ? '0' : '1'`。** 不改这里的话，VIP 用户看到的永远是 0 或 1，这是本任务的核心。

- [ ] **Step 1: 扩展载荷类型与 state**

`LotteryApiPayload` 接口在 `extraSpins: number;` 之后加：

```ts
  freeSpinLimit: number;
  freeSpinRemaining: number;
```

组件内 `const [extraSpins, setExtraSpins] = useState(0);` 之后加：

```tsx
  const [freeSpinLimit, setFreeSpinLimit] = useState(1);
  const [freeSpinRemaining, setFreeSpinRemaining] = useState(0);
```

- [ ] **Step 2: 接收接口字段**

在 `setExtraSpins(...)` 之后加：

```tsx
      setFreeSpinLimit(typeof data.freeSpinLimit === 'number' ? data.freeSpinLimit : 1);
      setFreeSpinRemaining(typeof data.freeSpinRemaining === 'number' ? data.freeSpinRemaining : 0);
```

- [ ] **Step 3: 改抽奖后的乐观更新**

替换 `setShowResultModal(true);` 之后的整段分支：

```tsx
        if (user?.isAdmin) {
          setCanSpin(true);
        } else if (extraSpins > 0) {
          // 额外次数优先消耗，免费次数不动（与后端 consumeSpinCount 的顺序一致）
          setExtraSpins((prev) => Math.max(0, prev - 1));
          setDailySpinRemaining((prev) => Math.max(0, prev - 1));
          setCanSpin(dailySpinRemaining > 1 && (extraSpins - 1 > 0 || freeSpinRemaining > 0));
        } else {
          const nextFreeRemaining = Math.max(0, freeSpinRemaining - 1);
          setFreeSpinRemaining(nextFreeRemaining);
          setHasSpunToday(true);
          setDailySpinRemaining((prev) => Math.max(0, prev - 1));
          setCanSpin(dailySpinRemaining > 1 && nextFreeRemaining > 0);
        }
```

- [ ] **Step 4: 改「今日免费」pill**

替换 L758-770 的 daily pill：

```tsx
              <div className={`chance-pill daily ${freeSpinRemaining > 0 ? '' : 'is-empty'}`}>
                <span className="ico">
                  <Check />
                </span>
                <span className="label">每日:</span>
                <span className="num">{loading ? '—' : `${freeSpinRemaining}/${freeSpinLimit}`}</span>
              </div>
```

- [ ] **Step 5: 类型检查与 lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 无错误

- [ ] **Step 6: 手工验证**

访问 `http://localhost:3000/lottery`，分别用非 VIP 与 VIP 账号（VIP 可直接往 `vip_memberships` 插一行构造）。

Expected: 非 VIP 显示 `1/1`；VIP 显示 `3/3`；抽奖后数字递减；免费次数用尽但仍有额外次数时按钮保持可用。

- [ ] **Step 7: Commit**

```bash
git add src/app/lottery/page.tsx
git commit -m "feat: 抽奖页展示 VIP 加成后的每日免费次数"
```

---

### Task 15: `/admin/settings` 新增钱包与 VIP 配置区块

**Files:**
- Modify: `src/app/admin/settings/page.tsx`

**Interfaces:**
- Consumes: `GET|PUT /api/admin/config` 的 8 个字段（Task 10）
- Produces: 无

> **`handleSave` 必须一次性提交全部 8 个字段。** 后端的 nil 语义是「重置为默认值」，漏提交会被静默重置（Task 10 已把缺失字段改成显式 400，但前端仍应全量提交）。

- [ ] **Step 1: 扩展类型与表单 state**

`SystemConfig` 接口加 7 个字段：

```ts
interface SystemConfig {
  dailyPointsLimit: number;
  dailyWithdrawLimit: number;
  vipDailyWithdrawLimit: number;
  vipPricePoints: number;
  vipDurationDays: number;
  vipWithdrawFeePercent: number;
  vipDailyLotterySpins: number;
  vipMaxTotalDays: number;
  updatedAt?: number;
  updatedBy?: string;
}
```

`const [dailyPointsLimit, setDailyPointsLimit] = useState('');` 之后加 7 个同构 state：

```tsx
  const [dailyWithdrawLimit, setDailyWithdrawLimit] = useState('');
  const [vipDailyWithdrawLimit, setVipDailyWithdrawLimit] = useState('');
  const [vipPricePoints, setVipPricePoints] = useState('');
  const [vipDurationDays, setVipDurationDays] = useState('');
  const [vipWithdrawFeePercent, setVipWithdrawFeePercent] = useState('');
  const [vipDailyLotterySpins, setVipDailyLotterySpins] = useState('');
  const [vipMaxTotalDays, setVipMaxTotalDays] = useState('');
```

- [ ] **Step 2: 扩展 `fetchConfig`**

在 `setDailyPointsLimit(String(systemData.config.dailyPointsLimit));` 之后加 7 行同构赋值：

```tsx
        setDailyWithdrawLimit(String(systemData.config.dailyWithdrawLimit));
        setVipDailyWithdrawLimit(String(systemData.config.vipDailyWithdrawLimit));
        setVipPricePoints(String(systemData.config.vipPricePoints));
        setVipDurationDays(String(systemData.config.vipDurationDays));
        setVipWithdrawFeePercent(String(systemData.config.vipWithdrawFeePercent));
        setVipDailyLotterySpins(String(systemData.config.vipDailyLotterySpins));
        setVipMaxTotalDays(String(systemData.config.vipMaxTotalDays));
```

- [ ] **Step 3: 改 `handleSave` 为全量提交**

替换 `body: JSON.stringify({...})`：

```tsx
        // 后端的 nil 语义是「重置为默认值」，必须全量提交 8 个字段
        body: JSON.stringify({
          dailyPointsLimit: Number(dailyPointsLimit),
          dailyWithdrawLimit: Number(dailyWithdrawLimit),
          vipDailyWithdrawLimit: Number(vipDailyWithdrawLimit),
          vipPricePoints: Number(vipPricePoints),
          vipDurationDays: Number(vipDurationDays),
          vipWithdrawFeePercent: Number(vipWithdrawFeePercent),
          vipDailyLotterySpins: Number(vipDailyLotterySpins),
          vipMaxTotalDays: Number(vipMaxTotalDays),
        }),
```

- [ ] **Step 4: 新增「钱包与 VIP 配置」区块**

在既有「游戏配置」卡片之后、`{config?.updatedAt && (` 之前插入第二张同构卡片，复用既有的 `glass-card` / `label` / `input` 类名。7 个输入框：

| 标签 | state | min / max | 单位 | 说明文案 |
|---|---|---|---|---|
| 普通用户每日提现次数 | `dailyWithdrawLimit` | 1 / 100 | 次/天 | 每天 0 点（中国时区）重置。管理员同样受限。 |
| VIP 每日提现次数 | `vipDailyWithdrawLimit` | 1 / 100 | 次/天 | VIP 用户享受的提现次数上限。 |
| 月卡价格 | `vipPricePoints` | 1 / 1000000 | 积分 | 购买一次 VIP 所需积分。 |
| 月卡时长 | `vipDurationDays` | 1 / 365 | 天 | 每次购买增加的天数，重复购买时长累加。 |
| VIP 手续费百分比 | `vipWithdrawFeePercent` | 0 / 100 | % | 按原阶梯费率的百分比收取，50 即五折，0 为免手续费。 |
| VIP 每日赠送抽奖次数 | `vipDailyLotterySpins` | 0 / 50 | 次/天 | 在每日 1 次免费抽奖的基础上额外赠送。 |
| VIP 累计时长上限 | `vipMaxTotalDays` | 1 / 3650 | 天 | 用户剩余 VIP 时长的上限，**必须不小于月卡时长**，否则用户第一次购买就会被拒。 |

保存按钮沿用既有的那一个（放在第二张卡片内，或保留在第一张卡片内统一提交，二选一即可 —— 只要 `handleSave` 全量提交）。

- [ ] **Step 5: 类型检查与 lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 无错误

- [ ] **Step 6: 手工验证**

访问 `http://localhost:3000/admin/settings`（管理员账号）。

Expected:
- 7 个新输入框显示当前值（首次为默认值 4 / 8 / 3000 / 30 / 50 / 2 / 365）
- 改一项保存 → 成功，刷新后保持
- 把「累计时长上限」改成小于「月卡时长」的值 → 保存失败并显示「VIP 累计时长上限不能小于月卡时长」

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/settings/page.tsx
git commit -m "feat: 后台设置新增钱包与 VIP 配置区块"
```

---

## 最终验证

全部 15 个任务完成后，跑一次完整验证。

- [ ] **前端全量检查**

Run: `npx tsc --noEmit && npm run lint`
Expected: 无错误

- [ ] **后端全量检查**

Run: `cd backend && go build ./... && go vet ./... && go test ./...`
Expected: 全绿

- [ ] **后端集成测试**

Run: `cd backend && TEST_DATABASE_URL="<独立测试库>" go test -tags=integration ./... `
Expected: 全绿

- [ ] **网关审计**

Run: `node scripts/audit-gateway-allowed-cutovers.mjs`
Expected: `ok: true`，`checkedApiCutovers: 163`

- [ ] **前端单元测试**

Run: `npm test`
Expected: 除「改动前既已存在的失败」一节列出的 2 个 vitest 超时外全绿。**不要试图修那两个。**

- [ ] **端到端手工走查**

1. `/store` → 点钱包入口 → 落到 `/wallet`
2. `/wallet` 首屏在 new-api 不可用时仍能渲染积分、VIP、今日次数
3. 开通 VIP → `/wallet` 显示到期时间与「时长累加」说明 → 再次开通，到期时间增加一个周期
4. 反复开通至逼近上限 → 按钮置灰并显示上限原因
5. `/lottery` 的「每日」pill 对 VIP 显示 `3/3`
6. `/admin/settings` 调整数值 → 上述行为随之改变
