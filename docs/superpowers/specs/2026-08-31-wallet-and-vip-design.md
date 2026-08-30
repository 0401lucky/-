# 福利站「钱包」与「站内 VIP」设计文档

- 日期：2026-08-31
- 状态：待评审
- 影响面：新增前端页面 `/wallet`、新增后端包 `vip`、4 条数据库迁移、3 条网关路径、`/store` 与 `/lottery` 与 `/admin/settings` 三个既有页面改造

---

## 1. 背景与目标

站内积分与 new-api 额度之间的提现/充值能力目前寄生在福利商店 `/store` 的一个双 Tab 弹窗里（`src/app/store/page.tsx` 约 3926 行）。后端能力已完整落在 Go 侧，但用户侧缺少一个承载资金视图的独立入口：看不到交易流水，也没有任何风控展示。

本轮做两件事：

1. **钱包**：把提现与充值整体迁到独立页面 `/wallet`，补齐交易流水列表，并新增「每日提现次数限制」这一风控机制。
2. **站内 VIP**：新建时长制月卡（积分购买，重复购买时长累加），提供三项特权：更多每日提现次数、提现手续费折扣、每日赠送抽奖次数。

所有数值全部落到后台可改。

---

## 2. 范围

### 2.1 本轮要做

| 模块 | 内容 |
|---|---|
| 钱包页 | 新建 `/wallet`；积分与额度双余额卡片；提现；充值；交易流水列表；今日剩余提现次数实时展示；VIP 状态与特权入口 |
| 提现限次 | 新增每日提现次数上限，按中国时区 0 点重置，后台可配 |
| VIP | 时长制月卡，积分购买，重复购买时长累加；三项特权；后台可配 |
| 商店改造 | 摘除双 Tab 弹窗与结果弹窗，保留一个跳转钱包的入口卡片 |
| 抽奖改造 | 每日免费次数从「固定 1 次」改为「1 + VIP 赠送数」，含前端剩余次数展示 |
| 后台 | `/admin/settings` 新增 6 个配置项 |

### 2.2 本轮明确不做

- **不做「更高积分上限」VIP 特权**。留作二期专项。因此 12+ 个游戏服务读取 `systemconfig.DailyPointsLimit` 的代码本轮**零改动**。
- **不改提现/充值的接口路径**。`POST /api/store/withdraw`、`GET|POST /api/store/topup` 保持原样（详见 3.3）。
- **不改现有阶梯费率表本身**（`≥10000→1%` / `≥1000→2%` / `≥100→3%` / `≥10→5%`），只在其上叠加 VIP 折扣。
- **不做 VIP 到期提醒/通知**。
- **不消除 `wallet-rules.ts` 与 `wallet.go` 的双实现**。这是既有事实，本轮只做参数化对齐（详见 3.4）。
- **不重构 `store/page.tsx` 中与钱包无关的代码**。

---

## 3. 已确认的架构决策

### 3.1 VIP 子系统的包归属与依赖方向

新建 `backend/internal/vip` 包，**只提供「查状态 + 续期」两个无状态包级函数**，照抄 `systemconfig` 的现成范式：

```go
package vip

// Get 查询 VIP 状态。querier 可以是 *pgxpool.Pool，也可以是调用方的 pgx.Tx。
func Get(ctx context.Context, querier QueryRower, userID int64) (Status, error)

// Extend 在调用方的事务内续期，返回新的到期时间。
func Extend(ctx context.Context, tx pgx.Tx, userID int64, days int64, now time.Time) (time.Time, error)
```

依赖方向：

```
economy ──▶ vip ──▶ pgx
lottery ──▶ vip
economy ──▶ systemconfig   （既有）
lottery ──▶ systemconfig   （新增，systemconfig 已被 12+ 包依赖）
```

**关键约束：「购买月卡」这个用例放在 `economy` 包，不放 `vip` 包。** 扣积分能力在 `economy.ApplyPointsDelta`；若 `vip` 包提供 `Purchase` 就会形成 `vip → economy` 与 `economy → vip` 的循环依赖。所以由 `economy.PurchaseVIP()` 在自己的事务里扣分后调用 `vip.Extend()`，保持单向。

被否决的备选：把 VIP 全塞进 `economy/vip.go`。这会迫使 `lottery` 依赖整个 `economy` 包，而 `lottery.Service` 目前只持有一个 `*pgxpool.Pool`，引入 economy 是重量级耦合。

### 3.2 钱包页数据获取

本地数据聚合 + 外部额度懒加载 + 流水独立分页：

| 接口 | 内容 | 说明 |
|---|---|---|
| `GET /api/wallet`（新） | 积分余额、今日提现已用/上限/重置时间、VIP 状态与特权、当前适用手续费百分比、月卡价格与天数 | **纯本地查询，不碰 new-api**，页面秒开且不会因外部服务不可用而白屏 |
| `GET /api/store/topup`（复用） | new-api 额度 | 保持懒加载语义，仅在充值区块可见时请求 |
| `GET /api/wallet/transactions`（新） | 交易流水，分页 | 复用既有索引 `idx_wallet_transactions_user_created_at` |

被否决的备选：单一大聚合接口。会把外部 new-api 调用拖进首屏关键路径。

### 3.3 提现/充值接口路径保持不动

`POST /api/store/withdraw`、`GET|POST /api/store/topup` 不改名。改名需要同步网关精确路径、审计脚本白名单、前端引用，并处理旧路径兼容，属于纯搬家成本、零功能收益。页面搬到 `/wallet` 不要求接口跟着搬。

### 3.4 VIP 手续费折扣如何贯穿前后端双实现

两边纯函数都加一个 `feePercent` 参数：

```go
// backend/internal/economy/wallet.go
// feePercent：手续费按原阶梯费率的百分比收取。100 = 原价，50 = 五折。
func PreviewWithdraw(points int64, feePercent int64) WithdrawPreview
```

```ts
// src/lib/wallet-rules.ts
// feePercent：手续费按原阶梯费率的百分比收取。100 = 原价，50 = 五折。
export function previewWithdraw(points: number, feePercent = 100): WithdrawPreview
```

`GET /api/wallet` 下发当前用户适用的 `feePercent`，前端预览使用它。**后端在实际提现时重新计算，前端值仅用于预览展示**，因此不构成安全面。

被否决的备选：删掉前端纯函数、预览走接口 debounce 请求 —— 输入体验变差、请求量上升。

---

## 4. 数据模型变更

四条新迁移，落在 `backend/migrations/`（当前最大编号 `0031_game_realtime_records.sql`）。

> ⚠️ **迁移编写约束**：`backend/internal/migration/postgres/runner.go` 的 `splitStatements` 按 `;` 朴素切分 SQL。因此迁移文件里**不得出现 `DO $$ ... $$` 块或任何含分号的函数体**，只能写简单语句。`ADD CONSTRAINT` 没有 `IF NOT EXISTS`，靠 `schema_migrations` 表保证只执行一次。

### 4.1 `0032_wallet_daily_withdrawals.sql` — 每日提现次数

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

### 4.2 `0033_vip.sql` — VIP 会籍与购买流水

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

**会籍模型**：单行记录当前到期时间，不存历史。`expires_at > now()` 即为有效 VIP。到期不删行（保留续费时的历史锚点），只是判定为非 VIP。`vip_purchases` 记录每次购买的前后到期时间，用于对账与客服排查。

### 4.3 `0034_system_config_wallet_vip.sql` — 后台配置扩展

沿用 `system_config` 单行列式表的既有范式，新增 6 列。

```sql
-- +goose Up
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS daily_withdraw_limit BIGINT NOT NULL DEFAULT 4;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_daily_withdraw_limit BIGINT NOT NULL DEFAULT 8;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_price_points BIGINT NOT NULL DEFAULT 3000;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_duration_days BIGINT NOT NULL DEFAULT 30;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_withdraw_fee_percent BIGINT NOT NULL DEFAULT 50;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_daily_lottery_spins BIGINT NOT NULL DEFAULT 2;

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

-- +goose Down
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_daily_lottery_spins_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_withdraw_fee_percent_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_duration_days_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_price_points_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_daily_withdraw_limit_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_daily_withdraw_limit_check;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_daily_lottery_spins;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_withdraw_fee_percent;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_duration_days;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_price_points;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_daily_withdraw_limit;
ALTER TABLE system_config DROP COLUMN IF EXISTS daily_withdraw_limit;
```

**`vip_withdraw_fee_percent` 语义**：VIP 实际手续费 = 原阶梯费率 × `vip_withdraw_fee_percent / 100`。默认 50 即五折。0 表示 VIP 免手续费。

### 4.4 `0035_lottery_free_spins.sql` — 抽奖每日免费次数计数化

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

**旧列 `daily_free_claimed` 保留并继续同步写入** `(free_used_count > 0)`。理由：`backend/internal/lottery/service_integration_test.go` 有多处断言该列，且它是既有对账口径。这不是死代码遗留，是刻意的兼容层，需在代码里注释说明。

---

## 5. 后端设计

### 5.1 新增包 `backend/internal/vip`

```go
package vip

type Status struct {
    Active    bool   `json:"active"`
    ExpiresAt *int64 `json:"expiresAt,omitempty"` // 毫秒时间戳，无会籍时为 nil
}

type QueryRower interface {
    QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func Get(ctx context.Context, querier QueryRower, userID int64) (Status, error)
func Extend(ctx context.Context, tx pgx.Tx, userID int64, days int64, now time.Time) (time.Time, error)
```

`Get`：查 `vip_memberships`，`pgx.ErrNoRows` 视为非 VIP（返回零值，不报错）。`Active = expires_at > now()`。

`Extend`（**时长累加的核心，用一条 UPSERT 表达**）：

```sql
INSERT INTO vip_memberships (user_id, expires_at, created_at, updated_at)
VALUES ($1, $2 + ($3::int * INTERVAL '1 day'), now(), now())
ON CONFLICT (user_id) DO UPDATE SET
  expires_at = GREATEST(vip_memberships.expires_at, $2) + ($3::int * INTERVAL '1 day'),
  updated_at = now()
RETURNING expires_at
```

`$2` 传入 `now`。`GREATEST(existing, now)` 同时覆盖两种情形：会籍未过期则从原到期时间累加，已过期则从当前时间重新起算。

### 5.2 提现每日限次

**检查与计数必须放在 `executeWithdrawInner` 内部，不能放在 HTTP handler 层。** 理由：`ExecuteWithdraw` 外层已有 `RunWithWalletOperationLock`（Redis 操作锁）保证同一用户的提现串行；handler 层没有这层保护，两个并发请求可能同时通过检查。

时序（全部在 Redis 操作锁内）：

```
1. 读 systemconfig（普通/VIP 上限）+ vip.Get → 得到 limit
2. 读 wallet_daily_withdrawals 今日 used_count（无行视为 0）
3. used >= limit → 直接返回失败，不产生任何副作用
4. ……原有提现流程（预览 → 建交易 → 扣分 → 调 new-api → 收尾）……
5. 终态 ∈ {success, uncertain} → UPSERT used_count += 1
   终态 = failed → 不计数（积分已全额退回）
```

日期口径复用 `economy` 包已有的 `todayChina() string`（`service.go:694`）。

**`uncertain` 计数的理由**：`uncertain` 意味着积分已扣、new-api 额度可能已到账，只是回执未确认。若不计数，用户可以靠反复触发 `uncertain` 绕过每日上限。

**计数写入失败的取舍**：第 5 步的 UPSERT 若失败，只记 `Warn` 日志，**不回滚已完成的提现**。资金操作已产生副作用，因为一次计数失败而回滚会造成更严重的不一致。代价是极端情况下用户当日可能多提现一次，可接受。

**管理员不豁免**：抽奖的 `user.IsAdmin` 绕过次数限制是既有行为，保持不变；但提现是资金操作，管理员**同样受每日限次约束**，不做 bypass。

新增服务方法：

```go
// 供 GET /api/wallet 展示用，只读不写
func (service *Service) GetWithdrawDailyUsage(ctx context.Context, userID int64) (WithdrawDailyUsage, error)

type WithdrawDailyUsage struct {
    Used      int64 `json:"used"`
    Limit     int64 `json:"limit"`
    Remaining int64 `json:"remaining"`
    ResetAtMs int64 `json:"resetAtMs"` // 中国时区次日 0 点
}
```

### 5.3 手续费折扣

`PreviewWithdraw` 签名加一个参数，费用计算改为：

```go
feeRate := GetWithdrawFeeRate(points)
feePoints := int64(math.Ceil(float64(points) * feeRate * float64(feePercent) / 100))
```

`executeWithdrawInner` 在调用前先解析用户适用的 `feePercent`：VIP 用 `system_config.vip_withdraw_fee_percent`，非 VIP 用 `100`。

调用点全部需要更新签名：`wallet_service.go` 的 `executeWithdrawInner`、`wallet_test.go` 既有用例（补 `100` 参数保持原断言）。

> **一致性要求**：前端 `src/lib/wallet-rules.ts` 的对应表达式必须与上式**逐字对齐**（同样的乘法顺序、同样的 `/ 100` 位置、同样的 `Math.ceil`），否则浮点结合律差异会在边界值上造成 ±1 积分的预览偏差。

### 5.4 购买 VIP 月卡

```go
func (service *Service) PurchaseVIP(ctx context.Context, user auth.User, idempotencyKey string) (PurchaseVIPResult, error)

type PurchaseVIPResult struct {
    Success     bool   `json:"success"`
    Message     string `json:"message"`
    Balance     int64  `json:"balance"`
    ExpiresAt   int64  `json:"expiresAt"`   // 毫秒
    DaysAdded   int64  `json:"daysAdded"`
    PointsSpent int64  `json:"pointsSpent"`
}
```

在 `service.withRetryableTx` 内，照抄 `ExchangeItem` 的既有事务范式：

```
1. beginIdempotency(scope = "vip:purchase:{userID}")  ← 命中则直接返回缓存结果
2. ensureUser
3. systemconfig.Get(tx) → 价格、天数
4. SELECT balance FROM point_accounts WHERE user_id = $1 FOR UPDATE
5. 余额不足 → 返回失败（不报错）
6. 扣分 + insertPointLog(source = SourceVIPPurchase)
7. vip.Extend(ctx, tx, userID, days, now)
8. INSERT INTO vip_purchases
9. completeIdempotency
```

新增来源常量 `SourceVIPPurchase = "vip_purchase"`（`economy/types.go`）。`point_ledger.source` 无 CHECK 约束，可自由扩展。

**幂等键是必要的**：一次购买扣 3000 积分，网络重试造成的重复扣费代价高。`ExchangeItem` 已有同样的机制，直接照抄，成本很低。

### 5.5 交易流水列表

```go
func (service *Service) ListWalletTransactions(ctx context.Context, userID int64, limit int, offset int) ([]WalletTransaction, int64, error)
```

复用 `wallet_store.go` 已有的 `walletTransactionSelectColumns()` 与 `scanWalletTransaction()`，只补一个 `SELECT ... WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3` 和一个 `COUNT(*)`。

**刻意用 offset 分页而非游标分页**：单用户的流水量受每日提现限次天然约束（每天至多 4-8 条提现 + 少量充值），offset 分页足够，游标分页是不必要的复杂度。`limit` 默认 20、上限 100。

### 5.6 抽奖每日免费次数改造

`consumeSpinCount` 新增一个 `freeSpinQuota` 参数：

```go
func consumeSpinCount(ctx context.Context, tx pgx.Tx, userID int64, dailySpinLimit int64, freeSpinQuota int64) error
```

改动后的次数消耗顺序（**保持既有的「优先消耗 extra_spins」语义不变**）：

```
usedCount >= dailySpinLimit          → ErrDailyLimitReached
extra_spins > 0                      → extra_spins -= 1
free_used_count < freeSpinQuota      → free_used_count += 1
否则                                  → ErrNoSpinChance

UPDATE lottery_daily_spins
   SET used_count = used_count + 1,
       free_used_count = $3,
       daily_free_claimed = ($3 > 0),   -- 旧列同步，兼容既有断言
       updated_at = now()
```

`freeSpinQuota` 的计算：`1 + (VIP ? system_config.vip_daily_lottery_spins : 0)`。

**调用链**：`spinPointsOnceInTx` 是包级函数拿不到 `service`，所以 `freeSpinQuota` 由 `SpinPoints` / `SpinPointsBatch`（method）在**开事务后、循环前**算一次并传入。五连抽在同一事务内循环消耗，同事务的 `UPDATE` 后再 `SELECT ... FOR UPDATE` 能读到自己的修改，语义正确。

`PagePayload` 新增两个字段：

```go
FreeSpinLimit     int64 `json:"freeSpinLimit"`     // 今日免费总额度 = 1 + VIP 赠送
FreeSpinRemaining int64 `json:"freeSpinRemaining"` // 今日剩余免费次数
```

`HasSpunToday` 语义保持为 `free_used_count > 0`（兼容）。`canSpin` 的判定条件改为：

```go
canSpin := config.Enabled && canSpinByMode && hasQuota &&
    (bypassSpinLimit || freeSpinRemaining > 0 || extraSpins > 0)
```

### 5.7 `systemconfig` 扩展

`Config` 结构与 `UpdateInput` 各加 6 个字段，`Get` / `Update` 的 SQL 相应扩列，并为每项加 `ValidXxx()` 校验函数（对齐既有的 `ValidDailyPointsLimit`）。

> ⚠️ **`Update` 的「nil → 重置为默认值」语义保持不变**（`service.go:66-69` 的既有行为）。这意味着**后台页面必须一次性提交全部 7 个字段**，任何漏提交的字段都会被静默重置为默认值。本轮不修改这个语义（属于「不重构没坏的东西」），但必须在 `UpdateInput` 的字段上加注释显式标注该陷阱，并保证 `/admin/settings` 的 `handleSave` 全量提交。

---

## 6. 接口设计

### 6.1 新增接口

#### `GET /api/wallet`

```jsonc
{
  "success": true,
  "data": {
    "balance": 12345,
    "pointsPerDollar": 10,
    "minWithdrawPoints": 10,
    "minTopupDollars": 1,
    "feePercent": 50,                    // 当前用户适用的手续费百分比，非 VIP 为 100
    "dailyWithdraw": {
      "used": 1,
      "limit": 8,
      "remaining": 7,
      "resetAtMs": 1756569600000         // 中国时区次日 0 点
    },
    "vip": {
      "active": true,
      "expiresAt": 1759161600000,        // 非 VIP 时省略
      "pricePoints": 3000,
      "durationDays": 30,
      "benefits": {
        "dailyWithdrawLimit": 8,
        "withdrawFeePercent": 50,
        "dailyLotterySpins": 2
      }
    }
  }
}
```

`benefits` 恒定下发（无论是否 VIP），用于非 VIP 用户看到「开通后能得到什么」。

#### `GET /api/wallet/transactions?limit=20&offset=0`

```jsonc
{
  "success": true,
  "data": {
    "transactions": [ /* WalletTransaction，复用既有 JSON 结构 */ ],
    "total": 42,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

#### `POST /api/vip/purchase`

请求：`{ "idempotencyKey": "..." }`，同时支持 `Idempotency-Key` / `X-Idempotency-Key` 请求头（照抄 `exchangeItem` 的三重取值顺序）。

响应：`{ success, message, data: { newBalance, expiresAt, daysAdded, pointsSpent } }`。余额不足返回 `400`。

### 6.2 变更接口

| 接口 | 变更 |
|---|---|
| `POST /api/store/withdraw` | 新增每日限次校验；超限返回 `400` + `code: "WITHDRAW_DAILY_LIMIT"`；成功响应 `data` 补 `dailyWithdrawUsed` / `dailyWithdrawLimit` 供前端即时刷新 |
| `GET /api/admin/config` | `config` 对象新增 6 个字段 |
| `PUT /api/admin/config` | 请求体新增 6 个字段，逐项校验，任一越界返回 `400` 与对应中文提示 |
| `GET /api/lottery` | `PagePayload` 新增 `freeSpinLimit` / `freeSpinRemaining` |

### 6.3 路由注册

`backend/internal/httpserver/server.go`：

```go
api.Get("/wallet", economyHandlers.getWallet)
api.Get("/wallet/transactions", economyHandlers.listWalletTransactions)
api.Post("/vip/purchase", economyHandlers.purchaseVIP)
```

三个 handler 都放在既有的 `economy_handlers.go`（该文件当前 348 行，加完约 470 行，仍在合理体积内）。`purchaseVIP` 需要走 `rejectUntrustedUnsafeRequest` + `rejectRateLimited(storeExchangeRateLimit)`，与 `exchangeItem` 一致。

---

## 7. 前端设计

### 7.1 新页面 `/wallet`

`src/app/wallet/page.tsx`，结构自上而下：

```
页头（返回 + 刷新）
双余额卡片
  ├─ 积分余额      ← GET /api/wallet
  └─ 账户额度      ← GET /api/store/topup（懒加载，失败可重试，不阻塞其余区块）
VIP 状态条
  ├─ 非 VIP：三项特权说明 + 「N 积分开通 M 天」按钮
  └─ VIP：到期时间 + 「续费」按钮（附「时长累加」说明）
操作区（桌面左右两栏 / 移动端上下堆叠）
  ├─ 积分提现：输入 + 预览（含 VIP 折扣）+ 今日剩余次数 + 阶梯表
  └─ 额度充值：输入 + 预览 + new-api 额度卡片
交易流水列表（分页 + 状态徽章）
```

**今日剩余提现次数的实时性**：初始值来自 `GET /api/wallet`；每次提现返回后用响应里的 `dailyWithdrawUsed` / `dailyWithdrawLimit` 就地更新，不重新拉整页。

**结果反馈**：保留既有的结果弹窗形态（复用 `wallet-result-*` 样式），信息量足够且改动最小。

**样式迁移**：`store/page.tsx` 的 `<style jsx global>`（L1812 起）中 `wallet-*`、`lwf-modal-wallet`、`wallet-result-*` 相关规则搬到新页面的 `<style jsx>`，并按「页面区块」而非「弹窗」调整布局容器。

**流水状态徽章**：`success` 绿 / `pending` 灰 / `failed` 红 / `uncertain` 橙，`uncertain` 附「结果待确认」提示文案。

### 7.2 `/store` 摘除清单

按 `src/app/store/page.tsx` 当前行号（实施时以实际内容匹配为准）：

| 位置 | 处理 |
|---|---|
| L129-153 | 删除 `NewApiBalance` / `WalletResultKind` / `WalletResultDetail` / `WalletResult` 四个类型 |
| L254-264 | 删除 10 个钱包 state |
| L425-450 | 删除提现/充值的 `useMemo` 预览与派生变量 |
| L452-481 | 删除 `loadNewApiBalance` 与其 `useEffect` |
| L483-646 | 删除 `closeWallet` / `handleWithdraw` / `handleTopup` |
| L917-939 | stat-card 从 `<button onClick>` 改为 `<Link href="/wallet">`，文案改「我的钱包」 |
| L1467-1473 | 规则第 04 条改为一句「提现充值已迁至钱包页」的指引 |
| L1492-1763 | 删除双 Tab 弹窗 JSX |
| L1765-1810 | 删除结果弹窗 JSX |
| `<style jsx global>` | 删除 `wallet-*` / `lwf-modal-wallet` / `wallet-result-*` 规则 |
| L35-42 | 删除 `@/lib/wallet-rules` 的 5 个导入 |
| L5-34 | 逐个确认后删除仅钱包使用的图标导入（`ArrowLeftRight` / `ArrowUpRight` / `ArrowDownLeft` / `BadgeCheck` / `Info` / `Loader2` 等），**被其他区块复用的不动** |

删除孤儿导入与变量是本次改动造成的清理，属于分内范围；`store/page.tsx` 中与钱包无关的既有代码一律不动。

### 7.3 `/lottery` 改造

`src/app/lottery/page.tsx`：

- L98-103 载荷类型、L167-171 state、L239-243 赋值：新增 `freeSpinLimit` / `freeSpinRemaining`
- **L758-770 的「今日免费」pill 目前硬编码 `hasSpunToday ? '0' : '1'`**，必须改为显示 `freeSpinRemaining`，否则 VIP 用户看到的永远是 0/1
- L409-412 抽奖后的乐观更新逻辑需同步递减 `freeSpinRemaining`，并据此重算 `canSpin`

### 7.4 `/admin/settings` 扩展

`src/app/admin/settings/page.tsx`（172 行）：

- `SystemConfig` 接口加 6 个字段，新增 6 个受控输入框
- 分成两个区块：既有「游戏配置」（每日积分上限）+ 新增「钱包与 VIP 配置」（6 项），每项带取值范围与中文说明
- `handleSave` **必须全量提交 7 个字段**（见 5.7 的 nil 语义陷阱）

### 7.5 `src/lib/wallet-rules.ts` 参数化

`previewWithdraw(points, feePercent = 100)`，表达式与 Go 逐字对齐。默认值 `100` 保证任何未传参的既有调用点行为不变。

---

## 8. 网关与审计脚本

`gateway/Caddyfile` 新增 **3 条**精确路径（放在商城段之后，禁止通配）：

```
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

`scripts/audit-gateway-allowed-cutovers.mjs` 的白名单同步新增同样 3 条。

验证：`node scripts/audit-gateway-allowed-cutovers.mjs` 必须 `ok: true`，且 `checkedApiCutovers` 从当前的 **160** 变为 **163**。

---

## 9. 默认值汇总

| 配置项 | 数据库列 | 默认值 | 取值范围 |
|---|---|---|---|
| 普通用户每日提现次数 | `daily_withdraw_limit` | 4 | 1 - 100 |
| VIP 每日提现次数 | `vip_daily_withdraw_limit` | 8 | 1 - 100 |
| 月卡价格 | `vip_price_points` | 3000 积分 | 1 - 1000000 |
| 月卡时长 | `vip_duration_days` | 30 天 | 1 - 365 |
| VIP 手续费百分比 | `vip_withdraw_fee_percent` | 50（五折） | 0 - 100 |
| VIP 每日赠送抽奖次数 | `vip_daily_lottery_spins` | 2 | 0 - 50 |

---

## 10. 测试策略

### 10.1 单元测试（不需要数据库）

- `backend/internal/economy/wallet_test.go`：`PreviewWithdraw` 在 `feePercent` 为 100 / 50 / 0 时的费用计算；边界 `points = 10`（验证低额时向上取整导致折扣不显效的既定行为）；既有用例补 `100` 参数保持原断言
- `backend/internal/systemconfig`：6 个新校验函数的边界值
- 前端：`previewWithdraw` 与 Go 版本使用**同一组输入输出向量**，确保双实现对齐

### 10.2 集成测试（需要数据库）

> ⚠️ **`TEST_DATABASE_URL` 必须指向独立测试库，绝对不能指向开发库 `app`。** `docs/local-development.md` 已明确要求。本轮新增的 wallet/vip 集成测试同样会对相关表做清理性写入，**动手前先建独立测试库**。

- **提现限次**：连续提现至上限 → 第 N+1 次返回 `WITHDRAW_DAILY_LIMIT` 且无任何副作用；`uncertain` 计数；`failed` 不计数；跨日重置；VIP 与非 VIP 的上限差异
- **VIP 购买**：余额不足；首次购买；未过期时重复购买（时长累加）；已过期后购买（从当前时间重新起算）；幂等键重放返回同一结果且只扣一次分
- **抽奖免费次数**：普通用户 1 次；VIP 用户 1+2 次；`extra_spins` 优先消耗的既有顺序不变；五连抽在单事务内的连续消耗；跨日重置；`daily_free_claimed` 旧列同步正确
- **流水列表**：分页正确；只返回本人记录

### 10.3 验证命令

```
npx tsc --noEmit
npm run lint
cd backend && go build ./... && go vet ./... && go test ./...
node scripts/audit-gateway-allowed-cutovers.mjs   # 必须 ok: true
```

### 10.4 改动前既已存在的失败（不在本轮修复范围）

- `npm test` 有 2 个 vitest 超时（`lucky-td` / `piano-tiles` golden vector）
- `TestAdminCardReadHandlersReturnLegacyShapes`（开发库脏数据导致）
- `scripts/audit-lottery-cutover.mjs` 自 commit `d8505c8` 起损坏（依赖已删除的 `src/lib/lottery.ts`）

### 10.5 本地手工验证

登录走外部 new-api，本地跑不通（`NEW_API_URL` 为空必然 502）。验证页面需自行签会话 cookie：用 `auth.CreateSessionToken`（`backend/internal/auth/session.go`）生成 HMAC token，本地 `SESSION_SECRET` 默认 `local-development-session-secret-at-least-32-chars`，然后 `document.cookie = "app_session=<token>; path=/"`。

同理，**充值与提现的 new-api 调用在本地不可用**，`newWalletQuotaClient` 会返回 `nil` 并使接口返回 `503 NEW_API_NOT_CONFIGURED`。本地只能验证到「限次检查」与「页面渲染」这一层，实际资金链路的验证需要集成测试或联调环境。

---

## 11. 风险与已知限制

1. **前后端双实现的浮点一致性**：`previewWithdraw` 两份实现的表达式必须逐字对齐，否则边界值会有 ±1 积分的预览偏差。这是本轮最容易埋 bug 的地方。
2. **低额提现折扣不显效**：10 积分 × 5% × 50% = 0.25，向上取整仍是 1 积分，与不打折相同。这是向上取整规则的固有结果，非缺陷。
3. **限次计数写入失败不回滚**：见 5.2。极端情况下用户当日可能多提现一次。
4. **`system_config` 全量提交要求**：nil→默认值语义未改，后台漏提交字段会静默重置。已在 5.7 标注并要求代码注释。
5. **VIP 到期无任何通知**：用户需自行查看钱包页。
6. **管理员提现不豁免限次**：与抽奖的 `IsAdmin` bypass 行为不一致，这是刻意的选择（资金操作从严）。
7. **`daily_free_claimed` 成为冗余列**：被 `free_used_count` 取代但仍同步写入。这是刻意的兼容层，不是遗留死代码，需在代码里注释清楚。
8. **`/lottery` 被卷入改动范围**：原始需求只提到钱包与 VIP，但「VIP 每日赠送抽奖次数」特权必然要改抽奖的次数模型与前端展示。

---

## 12. 文件清单

### 新增

| 文件 | 内容 |
|---|---|
| `backend/migrations/0032_wallet_daily_withdrawals.sql` | 每日提现次数表 |
| `backend/migrations/0033_vip.sql` | VIP 会籍与购买流水表 |
| `backend/migrations/0034_system_config_wallet_vip.sql` | 后台配置 6 列 |
| `backend/migrations/0035_lottery_free_spins.sql` | 抽奖免费次数计数化 |
| `backend/internal/vip/vip.go` | `Status` / `Get` / `Extend` |
| `backend/internal/vip/vip_integration_test.go` | 续期与累加的集成测试 |
| `backend/internal/economy/wallet_limit.go` | 提现限次的读取、校验与计数 |
| `backend/internal/economy/vip_purchase.go` | `PurchaseVIP` |
| `src/app/wallet/page.tsx` | 钱包页 |

### 修改

| 文件 | 改动 |
|---|---|
| `backend/internal/economy/wallet.go` | `PreviewWithdraw` 加 `feePercent` 参数 |
| `backend/internal/economy/wallet_service.go` | `executeWithdrawInner` 接入限次与折扣 |
| `backend/internal/economy/wallet_store.go` | 新增 `ListWalletTransactions` |
| `backend/internal/economy/types.go` | `SourceVIPPurchase`、`WithdrawDailyUsage`、`PurchaseVIPResult` |
| `backend/internal/systemconfig/service.go` | 6 个字段与校验函数 |
| `backend/internal/lottery/service.go` | `consumeSpinCount` 加 `freeSpinQuota`；`PagePayload` 两个新字段 |
| `backend/internal/lottery/types.go` | `PagePayload` 字段 |
| `backend/internal/httpserver/economy_handlers.go` | 3 个新 handler |
| `backend/internal/httpserver/admin_config_handlers.go` | 6 个字段的解析与校验 |
| `backend/internal/httpserver/server.go` | 3 条路由 |
| `gateway/Caddyfile` | 3 条精确路径 |
| `scripts/audit-gateway-allowed-cutovers.mjs` | 白名单 3 条 |
| `src/lib/wallet-rules.ts` | `previewWithdraw` 加 `feePercent` |
| `src/app/store/page.tsx` | 按 7.2 摘除 |
| `src/app/lottery/page.tsx` | 免费次数 pill 与乐观更新 |
| `src/app/admin/settings/page.tsx` | 新增配置区块 |

---

## 13. 实施顺序

1. 迁移 `0032` - `0035`（4 个文件）
2. `vip` 包（`Get` / `Extend` + 单元测试）
3. `systemconfig` 扩展 6 字段 + 校验函数
4. `economy`：提现限次 → 手续费折扣 → `PurchaseVIP` → `ListWalletTransactions`
5. 后端 handler + 路由 + `gateway/Caddyfile` + 审计脚本（并跑审计验证）
6. 前端 `src/lib/wallet-rules.ts` 参数化
7. 前端新页面 `/wallet`
8. 前端 `/store` 摘除
9. `lottery` 后端改造 + `/lottery` 前端 pill
10. `/admin/settings` 扩展
11. 集成测试（**先建独立测试库**）
12. 全量验证（10.3 的四条命令）

前 6 步是纯后端与共享库，可独立验证；7-10 是前端；11-12 收尾。步骤 4 与 9 是本轮风险最高的两处（分别触碰资金流程与抽奖并发逻辑）。
