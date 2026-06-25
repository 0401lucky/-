//go:build integration

package lottery

import (
	"context"
	"errors"
	"os"
	"strconv"
	"testing"
	"time"

	"redemption/backend/internal/auth"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestServiceBuildsPageAndAdminSnapshot(t *testing.T) {
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

	userID := int64(99701 + time.Now().UnixNano()%1_000_000_000)
	recordID := "lottery_it_" + strconv.FormatInt(userID, 10)
	cleanupLotteryIntegrationUser(t, ctx, db, userID, recordID)
	defer cleanupLotteryIntegrationUser(t, ctx, db, userID, recordID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $3, now(), now())`,
		userID, "lottery_user", "Lottery User",
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance) VALUES ($1, 0)`,
		userID,
	); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_assets (user_id, extra_spins, card_draws, makeup_cards)
		 VALUES ($1, 2, 0, 0)`,
		userID,
	); err != nil {
		t.Fatalf("seed user assets failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO lottery_daily_spins (user_id, spin_date, used_count, daily_free_claimed)
		 VALUES ($1, $2, 1, true)`,
		userID, todayChina().Format("2006-01-02"),
	); err != nil {
		t.Fatalf("seed daily spin failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO lottery_records (id, user_id, username, tier_id, tier_name, tier_value, code, points_awarded, created_at_ms)
		 VALUES ($1, $2, $3, 'pts_100', '金币 100积分', 100, '', 100, $4)`,
		recordID, userID, "lottery_user", time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed lottery record failed: %v", err)
	}

	service := NewService(db)
	payload, err := service.PagePayload(ctx, auth.User{
		ID:          userID,
		Username:    "lottery_user",
		DisplayName: "Lottery User",
	}, 20)
	if err != nil {
		t.Fatalf("page payload failed: %v", err)
	}
	if !payload.Enabled || payload.Mode != ModePoints || payload.DailySpinLimit != 10 {
		t.Fatalf("unexpected default page config: %+v", payload)
	}
	if !payload.HasSpunToday || payload.ExtraSpins != 2 || payload.DailySpinUsed != 1 || payload.DailySpinRemaining != 9 || !payload.CanSpin {
		t.Fatalf("unexpected page spin state: %+v", payload)
	}
	if len(payload.Tiers) != 7 || payload.Tiers[0].ID != "pts_200" {
		t.Fatalf("unexpected default tiers: %+v", payload.Tiers)
	}
	if len(payload.Records) != 1 || payload.Records[0].ID != recordID || payload.Records[0].PointsAwarded == nil || *payload.Records[0].PointsAwarded != 100 {
		t.Fatalf("unexpected user records: %+v", payload.Records)
	}

	snapshot, err := service.AdminSnapshot(ctx, 1, 50)
	if err != nil {
		t.Fatalf("admin snapshot failed: %v", err)
	}
	if snapshot.Config.Mode != ModePoints || snapshot.Config.DailySpinLimit != 10 || len(snapshot.Tiers) != 7 {
		t.Fatalf("unexpected admin config: %+v", snapshot)
	}
	if snapshot.ProbabilityMap["pts_200"] != 8 || snapshot.ProbabilityMap["橙子 200积分"] != 8 {
		t.Fatalf("unexpected probability map: %+v", snapshot.ProbabilityMap)
	}
	if len(snapshot.Records) == 0 || snapshot.Records[0].ID != recordID {
		t.Fatalf("expected seeded record in admin snapshot, got %+v", snapshot.Records)
	}
}

func TestServiceSpinPointsWritesTransactionalFacts(t *testing.T) {
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
	defer resetLotteryIntegrationConfig(t, ctx, db)
	seedLotteryIntegrationConfig(t, ctx, db, "pts_30", "小狗 30积分", 30, 2)

	userID := int64(99751 + time.Now().UnixNano()%1_000_000_000)
	cleanupLotteryIntegrationUser(t, ctx, db, userID, "")
	defer cleanupLotteryIntegrationUser(t, ctx, db, userID, "")
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $3, now(), now())`,
		userID, "lottery_spin_user", "Lottery Spin User",
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO point_accounts (user_id, balance) VALUES ($1, 0)`, userID); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_assets (user_id, extra_spins, card_draws, makeup_cards)
		 VALUES ($1, 1, 0, 0)`,
		userID,
	); err != nil {
		t.Fatalf("seed user assets failed: %v", err)
	}

	service := NewService(db)
	user := auth.User{ID: userID, Username: "lottery_spin_user", DisplayName: "Lottery Spin User"}
	first, err := service.SpinPoints(ctx, user)
	if err != nil {
		t.Fatalf("first spin failed: %v", err)
	}
	second, err := service.SpinPoints(ctx, user)
	if err != nil {
		t.Fatalf("second spin failed: %v", err)
	}
	if first.Record.TierValue != 30 || second.Record.TierValue != 30 || first.Record.ID == second.Record.ID {
		t.Fatalf("unexpected spin records: first=%+v second=%+v", first.Record, second.Record)
	}
	if _, err := service.SpinPoints(ctx, user); !errors.Is(err, ErrDailyLimitReached) {
		t.Fatalf("expected daily limit on third spin, got %v", err)
	}

	var balance, extraSpins, usedCount, recordCount, ledgerCount, gameCount, notificationCount int64
	var dailyFreeClaimed bool
	if err := db.QueryRow(ctx,
		`SELECT p.balance, a.extra_spins, d.used_count, d.daily_free_claimed,
		        (SELECT COUNT(*) FROM lottery_records WHERE user_id = $1),
		        (SELECT COUNT(*) FROM point_ledger WHERE user_id = $1 AND source = 'lottery_win'),
		        (SELECT COUNT(*) FROM game_records WHERE user_id = $1 AND game_type = 'lottery'),
		        (SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND type = 'lottery_win')
		   FROM point_accounts p
		   JOIN user_assets a ON a.user_id = p.user_id
		   JOIN lottery_daily_spins d ON d.user_id = p.user_id
		  WHERE p.user_id = $1`,
		userID,
	).Scan(&balance, &extraSpins, &usedCount, &dailyFreeClaimed, &recordCount, &ledgerCount, &gameCount, &notificationCount); err != nil {
		t.Fatalf("query spin facts failed: %v", err)
	}
	if balance != 60 || extraSpins != 0 || usedCount != 2 || !dailyFreeClaimed || recordCount != 2 || ledgerCount != 2 || gameCount != 2 || notificationCount != 2 {
		t.Fatalf("unexpected spin facts balance=%d extra=%d used=%d claimed=%v records=%d ledgers=%d games=%d notifications=%d",
			balance, extraSpins, usedCount, dailyFreeClaimed, recordCount, ledgerCount, gameCount, notificationCount)
	}
}

func TestServiceSpinPointsZeroTierDoesNotWritePointLedger(t *testing.T) {
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
	defer resetLotteryIntegrationConfig(t, ctx, db)
	seedLotteryIntegrationConfig(t, ctx, db, "pts_0", "谢谢惠顾", 0, 1)

	userID := int64(99781 + time.Now().UnixNano()%1_000_000_000)
	cleanupLotteryIntegrationUser(t, ctx, db, userID, "")
	defer cleanupLotteryIntegrationUser(t, ctx, db, userID, "")

	result, err := NewService(db).SpinPoints(ctx, auth.User{
		ID:          userID,
		Username:    "lottery_zero_user",
		DisplayName: "Lottery Zero User",
	})
	if err != nil {
		t.Fatalf("zero tier spin failed: %v", err)
	}
	if result.Record.TierValue != 0 || result.Record.PointsAwarded == nil || *result.Record.PointsAwarded != 0 {
		t.Fatalf("unexpected zero tier record: %+v", result.Record)
	}

	var balance, ledgerCount, recordCount int64
	if err := db.QueryRow(ctx,
		`SELECT p.balance,
		        (SELECT COUNT(*) FROM point_ledger WHERE user_id = $1 AND source = 'lottery_win'),
		        (SELECT COUNT(*) FROM lottery_records WHERE user_id = $1 AND points_awarded = 0)
		   FROM point_accounts p
		  WHERE p.user_id = $1`,
		userID,
	).Scan(&balance, &ledgerCount, &recordCount); err != nil {
		t.Fatalf("query zero tier facts failed: %v", err)
	}
	if balance != 0 || ledgerCount != 0 || recordCount != 1 {
		t.Fatalf("unexpected zero tier facts balance=%d ledger=%d record=%d", balance, ledgerCount, recordCount)
	}
}

func TestServiceUpdateConfigValidatesAndPersistsTiers(t *testing.T) {
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
	defer resetLotteryIntegrationConfig(t, ctx, db)

	enabled := false
	dailyLimit := int64(7)
	tiers := configUpdateTiers(60, 40)
	config, err := NewService(db).UpdateConfig(ctx, ConfigUpdateInput{
		Enabled:        &enabled,
		Mode:           "points",
		DailySpinLimit: &dailyLimit,
		Tiers:          &tiers,
	})
	if err != nil {
		t.Fatalf("update config failed: %v", err)
	}
	if config.Enabled || config.Mode != ModePoints || config.DailySpinLimit != 7 || len(config.Tiers) != len(defaultConfig().Tiers) {
		t.Fatalf("unexpected updated config: %+v", config)
	}
	if config.Tiers[0].Probability != 60 || config.Tiers[1].Probability != 40 || config.Tiers[2].Enabled {
		t.Fatalf("unexpected updated tiers: %+v", config.Tiers[:3])
	}

	var storedLimit int64
	var storedMode string
	var enabledTierCount int64
	if err := db.QueryRow(ctx,
		`SELECT c.daily_spin_limit, c.mode,
		        (SELECT COUNT(*) FROM lottery_tiers WHERE enabled = true)
		   FROM lottery_configs c
		  WHERE c.id = 'default'`,
	).Scan(&storedLimit, &storedMode, &enabledTierCount); err != nil {
		t.Fatalf("query stored config failed: %v", err)
	}
	if storedLimit != 7 || storedMode != "points" || enabledTierCount != 2 {
		t.Fatalf("unexpected stored config limit=%d mode=%s enabledTiers=%d", storedLimit, storedMode, enabledTierCount)
	}

	badTiers := configUpdateTiers(50, 40)
	if _, err := NewService(db).UpdateConfig(ctx, ConfigUpdateInput{Tiers: &badTiers}); err == nil {
		t.Fatalf("expected invalid probability total to fail")
	}
}

func TestServiceNumberBombBetModifyCancelAndState(t *testing.T) {
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

	userID := int64(99791 + time.Now().UnixNano()%1_000_000_000)
	cleanupLotteryIntegrationUser(t, ctx, db, userID, "")
	defer cleanupLotteryIntegrationUser(t, ctx, db, userID, "")
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $3, now(), now())`,
		userID, "number_bomb_user", "Number Bomb User",
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO point_accounts (user_id, balance) VALUES ($1, 100)`, userID); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO user_assets (user_id, extra_spins, card_draws, makeup_cards) VALUES ($1, 0, 0, 0)`, userID); err != nil {
		t.Fatalf("seed user assets failed: %v", err)
	}

	service := NewService(db)
	user := auth.User{ID: userID, Username: "number_bomb_user", DisplayName: "Number Bomb User"}
	first, err := service.PlaceNumberBombBet(ctx, user, NumberBombBetInput{SelectedNumber: 3, Multiplier: 2})
	if err != nil {
		t.Fatalf("place number bomb bet failed: %v", err)
	}
	if first.Balance != 80 || first.Bet.TicketCost != 20 || first.Bet.SelectedNumber != 3 || first.Bet.Multiplier != NumberBombMultiplier2 {
		t.Fatalf("unexpected first bet: %+v", first)
	}
	modified, err := service.PlaceNumberBombBet(ctx, user, NumberBombBetInput{SelectedNumber: 7, Multiplier: 1})
	if err != nil {
		t.Fatalf("modify number bomb bet failed: %v", err)
	}
	if modified.Balance != 90 || modified.Bet.ID != first.Bet.ID || modified.Bet.TicketCost != 10 || modified.Bet.SelectedNumber != 7 {
		t.Fatalf("unexpected modified bet: %+v first=%+v", modified, first)
	}
	state, err := service.NumberBombState(ctx, user)
	if err != nil {
		t.Fatalf("number bomb state failed: %v", err)
	}
	if state.Balance != 90 || state.TodayBet == nil || state.TodayBet.SystemNumber != nil || state.YesterdaySystemNumber == nil {
		t.Fatalf("unexpected state: %+v", state)
	}
	cancelled, err := service.CancelNumberBombBet(ctx, user)
	if err != nil {
		t.Fatalf("cancel number bomb bet failed: %v", err)
	}
	if cancelled.Balance != 100 || cancelled.Bet.Status != NumberBombStatusCancelled {
		t.Fatalf("unexpected cancelled bet: %+v", cancelled)
	}
	if _, err := service.PlaceNumberBombBet(ctx, user, NumberBombBetInput{SelectedNumber: 1, Multiplier: 1}); err == nil {
		t.Fatalf("expected cancelled day to reject new bet")
	}

	var balance, betCount, ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT p.balance,
		        (SELECT COUNT(*) FROM number_bomb_bets WHERE user_id = $1),
		        (SELECT COUNT(*) FROM point_ledger WHERE user_id = $1 AND source IN ('number_bomb_bet', 'number_bomb_refund'))
		   FROM point_accounts p
		  WHERE p.user_id = $1`,
		userID,
	).Scan(&balance, &betCount, &ledgerCount); err != nil {
		t.Fatalf("query number bomb facts failed: %v", err)
	}
	if balance != 100 || betCount != 1 || ledgerCount != 3 {
		t.Fatalf("unexpected number bomb facts balance=%d betCount=%d ledgerCount=%d", balance, betCount, ledgerCount)
	}
}

func TestServiceNumberBombAdminSnapshotBuildsRecentStats(t *testing.T) {
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

	userID := int64(99811 + time.Now().UnixNano()%1_000_000_000)
	cleanupLotteryIntegrationUser(t, ctx, db, userID, "")
	defer cleanupLotteryIntegrationUser(t, ctx, db, userID, "")
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $3, now(), now())`,
		userID, "number_bomb_admin_user", "Number Bomb Admin User",
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO point_accounts (user_id, balance) VALUES ($1, 100)`, userID); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO user_assets (user_id, extra_spins, card_draws, makeup_cards) VALUES ($1, 0, 0, 0)`, userID); err != nil {
		t.Fatalf("seed user assets failed: %v", err)
	}
	if _, err := NewService(db).PlaceNumberBombBet(ctx, auth.User{ID: userID, Username: "number_bomb_admin_user", DisplayName: "Number Bomb Admin User"}, NumberBombBetInput{SelectedNumber: 5, Multiplier: 1}); err != nil {
		t.Fatalf("place number bomb bet failed: %v", err)
	}

	snapshot, err := NewService(db).NumberBombAdminSnapshot(ctx, 7)
	if err != nil {
		t.Fatalf("number bomb admin snapshot failed: %v", err)
	}
	if snapshot.Date == "" || snapshot.SystemNumber < 0 || snapshot.SystemNumber > 9 || len(snapshot.RecentStats) != 7 {
		t.Fatalf("unexpected admin snapshot: %+v", snapshot)
	}
	todayStats := snapshot.RecentStats[0]
	if todayStats.ParticipantCount < 1 || todayStats.PendingCount < 1 || todayStats.SelectedCounts["5"] < 1 || len(todayStats.Participants) < 1 {
		t.Fatalf("unexpected today stats: %+v", todayStats)
	}
}

func TestServiceSettleNumberBombDateIsIdempotent(t *testing.T) {
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

	baseUserID := int64(99831 + time.Now().UnixNano()%1_000_000_000)
	winUserID := baseUserID
	lostUserID := baseUserID + 1
	cancelledUserID := baseUserID + 2
	settleDate := todayChina().AddDate(0, 0, -1).Format("2006-01-02")
	for _, userID := range []int64{winUserID, lostUserID, cancelledUserID} {
		cleanupLotteryIntegrationUser(t, ctx, db, userID, "")
		defer cleanupLotteryIntegrationUser(t, ctx, db, userID, "")
	}
	_, _ = db.Exec(ctx, `DELETE FROM number_bomb_draws WHERE draw_date = $1`, settleDate)
	defer func() {
		_, _ = db.Exec(ctx, `DELETE FROM number_bomb_bets WHERE user_id IN ($1, $2, $3)`, winUserID, lostUserID, cancelledUserID)
		_, _ = db.Exec(ctx, `DELETE FROM number_bomb_draws WHERE draw_date = $1`, settleDate)
	}()

	seedNumberBombSettlementUser(t, ctx, db, winUserID, "nb_win_user", 80)
	seedNumberBombSettlementUser(t, ctx, db, lostUserID, "nb_lost_user", 90)
	seedNumberBombSettlementUser(t, ctx, db, cancelledUserID, "nb_cancelled_user", 100)
	if _, err := db.Exec(ctx,
		`INSERT INTO number_bomb_draws (draw_date, system_number)
		 VALUES ($1, 5)`,
		settleDate,
	); err != nil {
		t.Fatalf("seed draw failed: %v", err)
	}
	nowMs := time.Now().UnixMilli()
	if _, err := db.Exec(ctx,
		`INSERT INTO number_bomb_bets
		   (id, user_id, username, bet_date, selected_number, multiplier, ticket_cost, status, created_at_ms, updated_at_ms)
		 VALUES
		   ($1, $2, 'nb_win_user', $7, 4, 2, 20, 'pending', $8, $8),
		   ($3, $4, 'nb_lost_user', $7, 5, 1, 10, 'pending', $8, $8),
		   ($5, $6, 'nb_cancelled_user', $7, 1, 1, 10, 'cancelled', $8, $8)`,
		"nb_win_"+strconv.FormatInt(winUserID, 10),
		winUserID,
		"nb_lost_"+strconv.FormatInt(lostUserID, 10),
		lostUserID,
		"nb_cancelled_"+strconv.FormatInt(cancelledUserID, 10),
		cancelledUserID,
		settleDate,
		nowMs,
	); err != nil {
		t.Fatalf("seed bets failed: %v", err)
	}

	service := NewService(db)
	first, err := service.SettleNumberBombDate(ctx, settleDate)
	if err != nil {
		t.Fatalf("settle number bomb failed: %v", err)
	}
	if first.Date != settleDate || first.SystemNumber != 5 || first.Processed != 2 || first.Won != 1 || first.Lost != 1 || first.Skipped != 1 {
		t.Fatalf("unexpected first settlement: %+v", first)
	}
	second, err := service.SettleNumberBombDate(ctx, settleDate)
	if err != nil {
		t.Fatalf("repeat settle number bomb failed: %v", err)
	}
	if second != first {
		t.Fatalf("repeat settlement should be identical: first=%+v second=%+v", first, second)
	}

	var winBalance, lostBalance, cancelledBalance int64
	var rewardLedgerCount, rewardLedgerAmount, notificationCount, wonBetCount, lostBetCount, cancelledBetCount int64
	if err := db.QueryRow(ctx,
		`SELECT
		   (SELECT balance FROM point_accounts WHERE user_id = $1),
		   (SELECT balance FROM point_accounts WHERE user_id = $2),
		   (SELECT balance FROM point_accounts WHERE user_id = $3),
		   (SELECT COUNT(*) FROM point_ledger WHERE user_id = $1 AND source = 'number_bomb_reward'),
		   COALESCE((SELECT SUM(amount) FROM point_ledger WHERE user_id = $1 AND source = 'number_bomb_reward'), 0)::bigint,
		   (SELECT COUNT(*) FROM notifications WHERE user_id IN ($1, $2, $3) AND data->>'game' = 'number_bomb'),
		   (SELECT COUNT(*) FROM number_bomb_bets WHERE user_id = $1 AND status = 'won' AND system_number = 5 AND reward_points = 40),
		   (SELECT COUNT(*) FROM number_bomb_bets WHERE user_id = $2 AND status = 'lost' AND system_number = 5 AND reward_points = 0),
		   (SELECT COUNT(*) FROM number_bomb_bets WHERE user_id = $3 AND status = 'cancelled' AND system_number IS NULL)`,
		winUserID,
		lostUserID,
		cancelledUserID,
	).Scan(
		&winBalance,
		&lostBalance,
		&cancelledBalance,
		&rewardLedgerCount,
		&rewardLedgerAmount,
		&notificationCount,
		&wonBetCount,
		&lostBetCount,
		&cancelledBetCount,
	); err != nil {
		t.Fatalf("query settlement facts failed: %v", err)
	}
	if winBalance != 120 || lostBalance != 90 || cancelledBalance != 100 ||
		rewardLedgerCount != 1 || rewardLedgerAmount != 40 || notificationCount != 2 ||
		wonBetCount != 1 || lostBetCount != 1 || cancelledBetCount != 1 {
		t.Fatalf("unexpected settlement facts winBalance=%d lostBalance=%d cancelledBalance=%d ledgerCount=%d ledgerAmount=%d notifications=%d won=%d lost=%d cancelled=%d",
			winBalance, lostBalance, cancelledBalance, rewardLedgerCount, rewardLedgerAmount, notificationCount, wonBetCount, lostBetCount, cancelledBetCount)
	}
}

func TestServiceLotteryRankingAggregatesRecords(t *testing.T) {
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

	firstUserID := int64(99861 + time.Now().UnixNano()%1_000_000_000)
	secondUserID := firstUserID + 1
	for _, userID := range []int64{firstUserID, secondUserID} {
		cleanupLotteryIntegrationUser(t, ctx, db, userID, "")
		defer cleanupLotteryIntegrationUser(t, ctx, db, userID, "")
	}
	seedNumberBombSettlementUser(t, ctx, db, firstUserID, "lottery_rank_first", 0)
	seedNumberBombSettlementUser(t, ctx, db, secondUserID, "lottery_rank_second", 0)

	nowMs := time.Now().UnixMilli()
	if _, err := db.Exec(ctx,
		`INSERT INTO lottery_records (id, user_id, username, tier_id, tier_name, tier_value, code, points_awarded, created_at_ms)
		 VALUES
		   ($1, $2, 'lottery_rank_first', 'pts_30', '小狗 30积分', 30, '', 30, $6),
		   ($3, $2, 'lottery_rank_first', 'pts_100', '金币 100积分', 100, '', 100, $6 + 1),
		   ($4, $5, 'lottery_rank_second', 'pts_50', '星星 50积分', 50, '', 50, $6 + 2)`,
		"rank_first_a_"+strconv.FormatInt(firstUserID, 10),
		firstUserID,
		"rank_first_b_"+strconv.FormatInt(firstUserID, 10),
		"rank_second_"+strconv.FormatInt(secondUserID, 10),
		secondUserID,
		nowMs,
	); err != nil {
		t.Fatalf("seed lottery ranking records failed: %v", err)
	}

	result, err := NewService(db).LotteryRanking(ctx, "daily", 10)
	if err != nil {
		t.Fatalf("lottery ranking failed: %v", err)
	}
	if result.Period != LotteryRankingDaily || result.PeriodKey == "" || result.TotalParticipants < 2 || len(result.Ranking) < 2 {
		t.Fatalf("unexpected ranking result: %+v", result)
	}
	if result.Ranking[0].UserID != strconv.FormatInt(firstUserID, 10) || result.Ranking[0].TotalValue != 130 || result.Ranking[0].BestPrize != "金币 100积分" || result.Ranking[0].Count != 2 {
		t.Fatalf("unexpected first ranking entry: %+v", result.Ranking[0])
	}

	daily, err := NewService(db).LotteryDailyRanking(ctx, todayChina().Format("2006-01-02"), 1)
	if err != nil {
		t.Fatalf("lottery daily ranking failed: %v", err)
	}
	if daily.TotalParticipants < 2 || len(daily.Ranking) != 1 || daily.Ranking[0].UserID != strconv.FormatInt(firstUserID, 10) {
		t.Fatalf("unexpected daily ranking: %+v", daily)
	}
}

func resetLotteryIntegrationConfig(t *testing.T, ctx context.Context, db *pgxpool.Pool) {
	t.Helper()
	if _, err := db.Exec(ctx, `DELETE FROM lottery_tiers`); err != nil {
		t.Fatalf("reset lottery tiers failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM lottery_configs`); err != nil {
		t.Fatalf("reset lottery config failed: %v", err)
	}
}

func configUpdateTiers(firstProbability float64, secondProbability float64) []TierUpdateInput {
	defaults := defaultConfig().Tiers
	updates := make([]TierUpdateInput, 0, len(defaults))
	for index, tier := range defaults {
		name := tier.Name
		value := tier.Value
		color := tier.Color
		probability := float64(0)
		enabled := false
		if index == 0 {
			probability = firstProbability
			enabled = true
		}
		if index == 1 {
			probability = secondProbability
			enabled = true
		}
		updates = append(updates, TierUpdateInput{
			ID:          tier.ID,
			Name:        &name,
			Value:       &value,
			Color:       &color,
			Probability: &probability,
			Enabled:     &enabled,
		})
	}
	return updates
}

func seedLotteryIntegrationConfig(t *testing.T, ctx context.Context, db *pgxpool.Pool, tierID string, tierName string, tierValue int64, dailyLimit int64) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`INSERT INTO lottery_configs (id, enabled, mode, daily_spin_limit, daily_direct_limit)
		 VALUES ($1, true, 'points', $2, 2000)`,
		defaultConfigID, dailyLimit,
	); err != nil {
		t.Fatalf("seed lottery config failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO lottery_tiers (id, name, value, probability, color, codes_count, used_count, enabled, sort_order)
		 VALUES ($1, $2, $3, 100, '#06b6d4', 0, 0, true, 1)`,
		tierID, tierName, tierValue,
	); err != nil {
		t.Fatalf("seed lottery tier failed: %v", err)
	}
}

func seedNumberBombSettlementUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, username string, balance int64) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())`,
		userID, username,
	); err != nil {
		t.Fatalf("seed user %d failed: %v", userID, err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO point_accounts (user_id, balance) VALUES ($1, $2)`, userID, balance); err != nil {
		t.Fatalf("seed point account %d failed: %v", userID, err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_assets (user_id, extra_spins, card_draws, makeup_cards)
		 VALUES ($1, 0, 0, 0)`,
		userID,
	); err != nil {
		t.Fatalf("seed user assets %d failed: %v", userID, err)
	}
}
