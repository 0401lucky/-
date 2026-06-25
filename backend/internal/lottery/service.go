package lottery

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strconv"
	"strings"
	"time"

	"redemption/backend/internal/auth"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrUnavailable = errors.New("lottery database unavailable")
var ErrDisabled = errors.New("lottery disabled")
var ErrModeNotMigrated = errors.New("lottery mode not migrated")
var ErrInvalidConfig = errors.New("lottery invalid config")
var ErrDailyLimitReached = errors.New("lottery daily limit reached")
var ErrNoSpinChance = errors.New("lottery no spin chance")

const defaultConfigID = "default"
const pointLedgerSourceLotteryWin = "lottery_win"
const lotteryGameType = "lottery"

var defaultTiers = []Tier{
	{ID: "pts_200", Name: "橙子 200积分", Value: 200, Probability: 8, Color: "#fb923c", CodesCount: 0, UsedCount: 0, Enabled: true},
	{ID: "pts_150", Name: "钻石 150积分", Value: 150, Probability: 6, Color: "#8b5cf6", CodesCount: 0, UsedCount: 0, Enabled: true},
	{ID: "pts_100", Name: "金币 100积分", Value: 100, Probability: 12, Color: "#facc15", CodesCount: 0, UsedCount: 0, Enabled: true},
	{ID: "pts_50", Name: "星星 50积分", Value: 50, Probability: 18, Color: "#3b82f6", CodesCount: 0, UsedCount: 0, Enabled: true},
	{ID: "pts_30", Name: "小狗 30积分", Value: 30, Probability: 22, Color: "#10b981", CodesCount: 0, UsedCount: 0, Enabled: true},
	{ID: "pts_10", Name: "小猫 10积分", Value: 10, Probability: 24, Color: "#06b6d4", CodesCount: 0, UsedCount: 0, Enabled: true},
	{ID: "pts_0", Name: "谢谢惠顾", Value: 0, Probability: 10, Color: "#ec4899", CodesCount: 0, UsedCount: 0, Enabled: true},
}

type Service struct {
	db *pgxpool.Pool
}

type ValidationError struct {
	Message string
}

func (err ValidationError) Error() string {
	return err.Message
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (service *Service) UpdateConfig(ctx context.Context, input ConfigUpdateInput) (Config, error) {
	if service.db == nil {
		return Config{}, ErrUnavailable
	}
	tx, err := service.db.Begin(ctx)
	if err != nil {
		return Config{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	current, err := configInTx(ctx, tx)
	if err != nil {
		return Config{}, err
	}
	next := current
	if input.Enabled != nil {
		next.Enabled = *input.Enabled
	}
	if strings.TrimSpace(input.Mode) != "" && strings.TrimSpace(input.Mode) != string(ModePoints) {
		return Config{}, ValidationError{Message: "当前仅支持积分抽奖模式"}
	}
	next.Mode = ModePoints
	if input.DailyDirectLimit != nil {
		if *input.DailyDirectLimit < 0 {
			return Config{}, ValidationError{Message: "每日直充上限必须是非负整数"}
		}
		next.DailyDirectLimit = *input.DailyDirectLimit
	}
	if input.DailySpinLimit != nil {
		if *input.DailySpinLimit < 1 || *input.DailySpinLimit > 100 {
			return Config{}, ValidationError{Message: "每日抽奖次数上限必须是 1-100 的整数"}
		}
		next.DailySpinLimit = *input.DailySpinLimit
	}
	if input.Tiers != nil {
		updated, err := mergeTierUpdates(current.Tiers, *input.Tiers)
		if err != nil {
			return Config{}, err
		}
		next.Tiers = updated
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO lottery_configs (id, enabled, mode, daily_direct_limit, daily_spin_limit, updated_at)
		 VALUES ($1, $2, $3, $4, $5, now())
		 ON CONFLICT (id) DO UPDATE SET
		   enabled = excluded.enabled,
		   mode = excluded.mode,
		   daily_direct_limit = excluded.daily_direct_limit,
		   daily_spin_limit = excluded.daily_spin_limit,
		   updated_at = now()`,
		defaultConfigID,
		next.Enabled,
		string(next.Mode),
		next.DailyDirectLimit,
		next.DailySpinLimit,
	); err != nil {
		return Config{}, err
	}
	if input.Tiers != nil {
		for index, tier := range next.Tiers {
			if _, err := tx.Exec(ctx,
				`INSERT INTO lottery_tiers (id, name, value, probability, color, enabled, sort_order, updated_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, now())
				 ON CONFLICT (id) DO UPDATE SET
				   name = excluded.name,
				   value = excluded.value,
				   probability = excluded.probability,
				   color = excluded.color,
				   enabled = excluded.enabled,
				   sort_order = excluded.sort_order,
				   updated_at = now()`,
				tier.ID,
				tier.Name,
				tier.Value,
				tier.Probability,
				tier.Color,
				tier.Enabled,
				index+1,
			); err != nil {
				return Config{}, err
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Config{}, err
	}
	return next, nil
}

func (service *Service) SpinPoints(ctx context.Context, user auth.User) (SpinResult, error) {
	if service.db == nil {
		return SpinResult{}, ErrUnavailable
	}
	tx, err := service.db.Begin(ctx)
	if err != nil {
		return SpinResult{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if err := ensureUser(ctx, tx, user); err != nil {
		return SpinResult{}, err
	}
	config, err := configInTx(ctx, tx)
	if err != nil {
		return SpinResult{}, err
	}
	if !config.Enabled {
		return SpinResult{}, ErrDisabled
	}
	if config.Mode != ModePoints {
		return SpinResult{}, ErrModeNotMigrated
	}
	activeTiers := activePointTiers(config.Tiers)
	selectedTier, err := weightedRandomTier(activeTiers)
	if err != nil {
		return SpinResult{}, err
	}

	if !user.IsAdmin {
		if err := consumeSpinCount(ctx, tx, user.ID, config.DailySpinLimit); err != nil {
			return SpinResult{}, err
		}
	}

	nowMs := time.Now().UnixMilli()
	record := Record{
		ID:            "lottery_" + randomID(),
		OderID:        strconv.FormatInt(user.ID, 10),
		Username:      user.Username,
		TierName:      selectedTier.Name,
		TierValue:     selectedTier.Value,
		Code:          "",
		PointsAwarded: &selectedTier.Value,
		CreatedAt:     nowMs,
	}

	var balanceAfter int64
	if selectedTier.Value > 0 {
		balanceAfter, err = addPoints(ctx, tx, user.ID, selectedTier.Value, "幸运抽奖："+selectedTier.Name)
		if err != nil {
			return SpinResult{}, err
		}
	}

	if err := insertLotteryRecord(ctx, tx, record, selectedTier.ID, user.ID); err != nil {
		return SpinResult{}, err
	}
	if err := insertLotteryGameRecord(ctx, tx, record, selectedTier.ID, user.ID, balanceAfter); err != nil {
		return SpinResult{}, err
	}
	if err := insertLotteryNotification(ctx, tx, record, user.ID); err != nil {
		return SpinResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return SpinResult{}, err
	}
	message := "谢谢惠顾，下次再来试试手气"
	if selectedTier.Value > 0 {
		message = "恭喜获得 " + selectedTier.Name + "！"
	}
	return SpinResult{Record: record, Message: message}, nil
}

func (service *Service) PagePayload(ctx context.Context, user auth.User, recordsLimit int) (PagePayload, error) {
	if service.db == nil {
		return PagePayload{}, ErrUnavailable
	}
	config, err := service.Config(ctx)
	if err != nil {
		return PagePayload{}, err
	}
	extraSpins, err := service.extraSpins(ctx, user.ID)
	if err != nil {
		return PagePayload{}, err
	}
	dailySpinUsed, dailyFreeClaimed, err := service.dailySpinUsage(ctx, user.ID, todayChina())
	if err != nil {
		return PagePayload{}, err
	}
	records, err := service.UserRecords(ctx, user.ID, normalizeLimit(recordsLimit, 20, 100))
	if err != nil {
		return PagePayload{}, err
	}

	activeCount := 0
	allTiersHaveCodes := true
	pageTiers := make([]PageTier, 0, len(config.Tiers))
	for _, tier := range config.Tiers {
		enabled := tier.Enabled
		hasStock := tier.CodesCount-tier.UsedCount > 0
		if tier.Probability > 0 && enabled {
			activeCount++
			if !hasStock {
				allTiersHaveCodes = false
			}
		}
		pageTiers = append(pageTiers, PageTier{
			ID:       tier.ID,
			Name:     tier.Name,
			Value:    tier.Value,
			Color:    tier.Color,
			HasStock: hasStock,
			Enabled:  enabled,
		})
	}
	if activeCount == 0 {
		allTiersHaveCodes = false
	}

	canSpinByMode := false
	switch config.Mode {
	case ModePoints:
		canSpinByMode = activeCount > 0
	case ModeCode:
		canSpinByMode = allTiersHaveCodes
	case ModeDirect, ModeHybrid:
		canSpinByMode = activeCount > 0
	default:
		canSpinByMode = activeCount > 0
	}

	bypassSpinLimit := user.IsAdmin
	remaining := config.DailySpinLimit - dailySpinUsed
	if remaining < 0 {
		remaining = 0
	}
	hasQuota := remaining > 0 || bypassSpinLimit
	hasSpunToday := dailyFreeClaimed
	canSpin := config.Enabled && canSpinByMode && hasQuota && (bypassSpinLimit || !hasSpunToday || extraSpins > 0)
	if bypassSpinLimit {
		remaining = config.DailySpinLimit
	}

	return PagePayload{
		Enabled:            config.Enabled,
		Mode:               config.Mode,
		Tiers:              pageTiers,
		CanSpin:            canSpin,
		HasSpunToday:       hasSpunToday,
		ExtraSpins:         extraSpins,
		DailySpinLimit:     config.DailySpinLimit,
		DailySpinUsed:      dailySpinUsed,
		DailySpinRemaining: remaining,
		AllTiersHaveCodes:  allTiersHaveCodes,
		User: UserView{
			ID:          user.ID,
			Username:    user.Username,
			DisplayName: user.DisplayName,
		},
		Records: records,
	}, nil
}

func (service *Service) AdminSnapshot(ctx context.Context, page int, limit int) (AdminSnapshot, error) {
	if service.db == nil {
		return AdminSnapshot{}, ErrUnavailable
	}
	page = normalizePage(page)
	limit = normalizeLimit(limit, 50, 200)
	config, err := service.Config(ctx)
	if err != nil {
		return AdminSnapshot{}, err
	}
	records, err := service.Records(ctx, limit, (page-1)*limit)
	if err != nil {
		return AdminSnapshot{}, err
	}
	todayDirectTotal, err := service.TodayDirectTotal(ctx)
	if err != nil {
		return AdminSnapshot{}, err
	}

	probabilityMap := map[string]float64{}
	tiers := make([]AdminTier, 0, len(config.Tiers))
	stats := AdminStats{}
	for _, tier := range config.Tiers {
		available := tier.CodesCount - tier.UsedCount
		if available < 0 {
			available = 0
		}
		probabilityMap[tier.ID] = tier.Probability
		probabilityMap[tier.Name] = tier.Probability
		tiers = append(tiers, AdminTier{Tier: tier, Available: available})
		stats.TotalCodes += tier.CodesCount
		stats.TotalUsed += tier.UsedCount
		stats.TotalAvailable += available
	}

	adminConfig := config
	adminConfig.Tiers = nil
	return AdminSnapshot{
		Config:           adminConfig,
		TodayDirectTotal: todayDirectTotal,
		Tiers:            tiers,
		ProbabilityMap:   probabilityMap,
		Stats:            stats,
		Records:          records,
		Pagination: Pagination{
			Page:    page,
			Limit:   limit,
			HasMore: len(records) == limit,
		},
	}, nil
}

func (service *Service) Config(ctx context.Context) (Config, error) {
	if service.db == nil {
		return Config{}, ErrUnavailable
	}
	config, err := configInTx(ctx, service.db)
	if err != nil {
		return Config{}, err
	}
	return config, nil
}

type queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func configInTx(ctx context.Context, query queryer) (Config, error) {
	config := defaultConfig()
	row := query.QueryRow(ctx,
		`SELECT enabled, mode, daily_direct_limit, daily_spin_limit
		   FROM lottery_configs
		  WHERE id = $1`,
		defaultConfigID,
	)
	var mode string
	err := row.Scan(&config.Enabled, &mode, &config.DailyDirectLimit, &config.DailySpinLimit)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Config{}, err
	}
	if err == nil {
		config.Mode = normalizeMode(mode)
		if config.DailyDirectLimit < 0 {
			config.DailyDirectLimit = 2000
		}
		if config.DailySpinLimit < 1 {
			config.DailySpinLimit = 10
		}
	}
	tiers, err := tiersInTx(ctx, query)
	if err != nil {
		return Config{}, err
	}
	if len(tiers) > 0 {
		config.Tiers = tiers
	}
	return config, nil
}

func (service *Service) tiers(ctx context.Context) ([]Tier, error) {
	return tiersInTx(ctx, service.db)
}

func tiersInTx(ctx context.Context, query queryer) ([]Tier, error) {
	rows, err := query.Query(ctx,
		`SELECT id, name, value, probability, color, codes_count, used_count, enabled
		   FROM lottery_tiers
		  ORDER BY sort_order ASC, id ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tiers := []Tier{}
	for rows.Next() {
		var tier Tier
		if err := rows.Scan(&tier.ID, &tier.Name, &tier.Value, &tier.Probability, &tier.Color, &tier.CodesCount, &tier.UsedCount, &tier.Enabled); err != nil {
			return nil, err
		}
		tiers = append(tiers, tier)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return tiers, nil
}

func (service *Service) Records(ctx context.Context, limit int, offset int) ([]Record, error) {
	if service.db == nil {
		return nil, ErrUnavailable
	}
	rows, err := service.db.Query(ctx,
		`SELECT id, user_id, username, tier_name, tier_value, code, direct_credit, credited_quota, points_awarded, created_at_ms
		   FROM lottery_records
		  ORDER BY created_at_ms DESC, id DESC
		  LIMIT $1 OFFSET $2`,
		normalizeLimit(limit, 50, 200), normalizeOffset(offset),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRecords(rows)
}

func (service *Service) UserRecords(ctx context.Context, userID int64, limit int) ([]Record, error) {
	if service.db == nil {
		return nil, ErrUnavailable
	}
	rows, err := service.db.Query(ctx,
		`SELECT id, user_id, username, tier_name, tier_value, code, direct_credit, credited_quota, points_awarded, created_at_ms
		   FROM lottery_records
		  WHERE user_id = $1
		  ORDER BY created_at_ms DESC, id DESC
		  LIMIT $2`,
		userID, normalizeLimit(limit, 20, 100),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRecords(rows)
}

func scanRecords(rows pgx.Rows) ([]Record, error) {
	records := []Record{}
	for rows.Next() {
		var record Record
		var userID int64
		var directCredit bool
		if err := rows.Scan(
			&record.ID,
			&userID,
			&record.Username,
			&record.TierName,
			&record.TierValue,
			&record.Code,
			&directCredit,
			&record.CreditedQuota,
			&record.PointsAwarded,
			&record.CreatedAt,
		); err != nil {
			return nil, err
		}
		record.OderID = strconv.FormatInt(userID, 10)
		if directCredit {
			value := true
			record.DirectCredit = &value
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return records, nil
}

func (service *Service) TodayDirectTotal(ctx context.Context) (int64, error) {
	if service.db == nil {
		return 0, ErrUnavailable
	}
	var total int64
	err := service.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(credited_quota), 0)::bigint
		   FROM lottery_records
		  WHERE direct_credit = true
		    AND created_at_ms >= $1
		    AND created_at_ms < $2`,
		chinaDateStartMillis(todayChina()), chinaDateStartMillis(todayChina().AddDate(0, 0, 1)),
	).Scan(&total)
	return total, err
}

func (service *Service) extraSpins(ctx context.Context, userID int64) (int64, error) {
	var count int64
	err := service.db.QueryRow(ctx,
		`SELECT COALESCE(extra_spins, 0)::bigint
		   FROM user_assets
		  WHERE user_id = $1`,
		userID,
	).Scan(&count)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return count, err
}

func (service *Service) dailySpinUsage(ctx context.Context, userID int64, date time.Time) (int64, bool, error) {
	var used int64
	var claimed bool
	err := service.db.QueryRow(ctx,
		`SELECT used_count, daily_free_claimed
		   FROM lottery_daily_spins
		  WHERE user_id = $1 AND spin_date = $2`,
		userID, date.Format("2006-01-02"),
	).Scan(&used, &claimed)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	return used, claimed, err
}

func defaultConfig() Config {
	tiers := make([]Tier, len(defaultTiers))
	copy(tiers, defaultTiers)
	return Config{
		Enabled:          true,
		Mode:             ModePoints,
		DailyDirectLimit: 2000,
		DailySpinLimit:   10,
		Tiers:            tiers,
	}
}

func normalizeMode(value string) Mode {
	switch Mode(strings.TrimSpace(value)) {
	case ModeCode:
		return ModeCode
	case ModeDirect:
		return ModeDirect
	case ModeHybrid:
		return ModeHybrid
	default:
		return ModePoints
	}
}

func normalizePage(value int) int {
	if value < 1 {
		return 1
	}
	return value
}

func normalizeLimit(value int, fallback int, max int) int {
	if value < 1 {
		return fallback
	}
	if value > max {
		return max
	}
	return value
}

func normalizeOffset(value int) int {
	if value < 0 {
		return 0
	}
	return value
}

func todayChina() time.Time {
	now := time.Now().UTC().Add(8 * time.Hour)
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
}

func chinaDateStartMillis(date time.Time) int64 {
	chinaLocalStart := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	return chinaLocalStart.UTC().UnixMilli()
}

func ensureUser(ctx context.Context, tx pgx.Tx, user auth.User) error {
	displayName := strings.TrimSpace(user.DisplayName)
	if displayName == "" {
		displayName = user.Username
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $3, now(), now())
		 ON CONFLICT (id) DO UPDATE SET
		   username = excluded.username,
		   display_name = excluded.display_name,
		   updated_at = now()`,
		user.ID, user.Username, displayName,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())
		 ON CONFLICT (user_id) DO NOTHING`,
		user.ID,
	); err != nil {
		return err
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO user_assets (user_id, extra_spins, card_draws, makeup_cards, updated_at)
		 VALUES ($1, 0, 0, 0, now())
		 ON CONFLICT (user_id) DO NOTHING`,
		user.ID,
	)
	return err
}

func activePointTiers(tiers []Tier) []Tier {
	active := make([]Tier, 0, len(tiers))
	for _, tier := range tiers {
		if tier.Enabled && tier.Probability > 0 {
			active = append(active, tier)
		}
	}
	return active
}

func mergeTierUpdates(current []Tier, updates []TierUpdateInput) ([]Tier, error) {
	if len(current) == 0 {
		current = defaultConfig().Tiers
	}
	updateByID := make(map[string]TierUpdateInput, len(updates))
	for _, update := range updates {
		id := strings.TrimSpace(update.ID)
		if id == "" {
			return nil, ValidationError{Message: "奖项配置格式错误"}
		}
		if update.Probability == nil || *update.Probability < 0 || *update.Probability > 100 || math.IsNaN(*update.Probability) || math.IsInf(*update.Probability, 0) {
			return nil, ValidationError{Message: "概率值必须在0-100之间"}
		}
		if update.Name != nil && strings.TrimSpace(*update.Name) == "" {
			return nil, ValidationError{Message: "奖项名称不能为空"}
		}
		if update.Value != nil && *update.Value < 0 {
			return nil, ValidationError{Message: "奖项积分必须是非负整数"}
		}
		if update.Color != nil && strings.TrimSpace(*update.Color) == "" {
			return nil, ValidationError{Message: "奖项颜色不能为空"}
		}
		update.ID = id
		updateByID[id] = update
	}

	next := make([]Tier, 0, len(current))
	missing := []string{}
	for _, tier := range current {
		update, ok := updateByID[tier.ID]
		if !ok {
			missing = append(missing, tier.ID)
			continue
		}
		if update.Name != nil {
			tier.Name = strings.TrimSpace(*update.Name)
		}
		if update.Value != nil {
			tier.Value = *update.Value
		}
		if update.Color != nil {
			tier.Color = strings.TrimSpace(*update.Color)
		}
		tier.Probability = *update.Probability
		if update.Enabled != nil {
			tier.Enabled = *update.Enabled
		} else {
			tier.Enabled = true
		}
		next = append(next, tier)
	}
	if len(missing) > 0 {
		return nil, ValidationError{Message: fmt.Sprintf("缺少档位配置: %s", strings.Join(missing, ", "))}
	}

	enabledCount := 0
	var totalProbability float64
	for _, tier := range next {
		if tier.Enabled {
			enabledCount++
			totalProbability += tier.Probability
		}
	}
	if enabledCount == 0 {
		return nil, ValidationError{Message: "至少需要启用一个奖项"}
	}
	if math.Abs(totalProbability-100) > 0.01 {
		return nil, ValidationError{Message: fmt.Sprintf("概率总和必须为100%%，当前为%.2f%%", totalProbability)}
	}
	return next, nil
}

func weightedRandomTier(tiers []Tier) (Tier, error) {
	if len(tiers) == 0 {
		return Tier{}, ErrInvalidConfig
	}
	var total float64
	for _, tier := range tiers {
		total += tier.Probability
	}
	if total <= 0 {
		return Tier{}, ErrInvalidConfig
	}
	const scale = 1_000_000
	max := int64(total * scale)
	if max <= 0 {
		return Tier{}, ErrInvalidConfig
	}
	pick, err := cryptorand.Int(cryptorand.Reader, big.NewInt(max))
	if err != nil {
		return Tier{}, err
	}
	random := float64(pick.Int64()) / scale
	for _, tier := range tiers {
		random -= tier.Probability
		if random <= 0 {
			return tier, nil
		}
	}
	return tiers[len(tiers)-1], nil
}

func consumeSpinCount(ctx context.Context, tx pgx.Tx, userID int64, dailySpinLimit int64) error {
	if dailySpinLimit < 1 {
		dailySpinLimit = 1
	}
	spinDate := todayChina().Format("2006-01-02")
	if _, err := tx.Exec(ctx,
		`INSERT INTO lottery_daily_spins (user_id, spin_date, used_count, daily_free_claimed, updated_at)
		 VALUES ($1, $2, 0, false, now())
		 ON CONFLICT (user_id, spin_date) DO NOTHING`,
		userID, spinDate,
	); err != nil {
		return err
	}

	var usedCount int64
	var dailyFreeClaimed bool
	if err := tx.QueryRow(ctx,
		`SELECT used_count, daily_free_claimed
		   FROM lottery_daily_spins
		  WHERE user_id = $1 AND spin_date = $2
		  FOR UPDATE`,
		userID, spinDate,
	).Scan(&usedCount, &dailyFreeClaimed); err != nil {
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
	} else if !dailyFreeClaimed {
		dailyFreeClaimed = true
	} else {
		return ErrNoSpinChance
	}

	_, err := tx.Exec(ctx,
		`UPDATE lottery_daily_spins
		    SET used_count = used_count + 1,
		        daily_free_claimed = $3,
		        updated_at = now()
		  WHERE user_id = $1 AND spin_date = $2`,
		userID, spinDate, dailyFreeClaimed,
	)
	return err
}

func addPoints(ctx context.Context, tx pgx.Tx, userID int64, amount int64, description string) (int64, error) {
	var balance int64
	if err := tx.QueryRow(ctx,
		`SELECT balance FROM point_accounts WHERE user_id = $1 FOR UPDATE`,
		userID,
	).Scan(&balance); err != nil {
		return 0, err
	}
	nextBalance := balance + amount
	if _, err := tx.Exec(ctx,
		`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
		nextBalance, userID,
	); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, now())`,
		randomID(), userID, amount, pointLedgerSourceLotteryWin, description, nextBalance,
	); err != nil {
		return 0, err
	}
	return nextBalance, nil
}

func insertLotteryRecord(ctx context.Context, tx pgx.Tx, record Record, tierID string, userID int64) error {
	var pointsAwarded any
	if record.PointsAwarded != nil {
		pointsAwarded = *record.PointsAwarded
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO lottery_records
		   (id, user_id, username, tier_id, tier_name, tier_value, code, direct_credit, credited_quota, points_awarded, created_at_ms, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, '', false, NULL, $7, $8, now())`,
		record.ID,
		userID,
		record.Username,
		tierID,
		record.TierName,
		record.TierValue,
		pointsAwarded,
		record.CreatedAt,
	)
	return err
}

func insertLotteryGameRecord(ctx context.Context, tx pgx.Tx, record Record, tierID string, userID int64, balanceAfter int64) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO game_records (id, user_id, session_id, game_type, difficulty, score, points_earned, payload, created_at)
		 VALUES ($1::text, $2::bigint, $3::text, $4::text, $5::text, $6::bigint, $6::bigint,
		         jsonb_build_object(
		           'lotteryRecordId', $3::text,
		           'tierId', $5::text,
		           'tierName', $7::text,
		           'tierValue', $6::bigint,
		           'balanceAfter', $8::bigint
		         ),
		         now())`,
		"game_"+record.ID,
		userID,
		record.ID,
		lotteryGameType,
		tierID,
		record.TierValue,
		record.TierName,
		balanceAfter,
	)
	return err
}

func insertLotteryNotification(ctx context.Context, tx pgx.Tx, record Record, userID int64) error {
	var pointsAwarded any
	content := "本次未中奖：" + record.TierName
	if record.PointsAwarded != nil && *record.PointsAwarded > 0 {
		pointsAwarded = *record.PointsAwarded
		content = "获得 " + record.TierName + "（+" + strconv.FormatInt(*record.PointsAwarded, 10) + " 积分已到账）"
	} else if record.PointsAwarded != nil {
		pointsAwarded = *record.PointsAwarded
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO notifications (id, user_id, type, title, content, data, created_at_ms, created_at, updated_at)
		 VALUES ($1::text, $2::bigint, 'lottery_win', '抽奖中奖通知', $3::text,
		         jsonb_build_object(
		           'lotteryRecordId', $4::text,
		           'tierName', $5::text,
		           'tierValue', $6::bigint,
		           'directCredit', false,
		           'pointsAwarded', $7::bigint
		         ),
		         $8::bigint, now(), now())`,
		"lottery_win_"+record.ID,
		userID,
		content,
		record.ID,
		record.TierName,
		record.TierValue,
		pointsAwarded,
		record.CreatedAt,
	)
	return err
}

func randomID() string {
	var buffer [8]byte
	if _, err := cryptorand.Read(buffer[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return strconv.FormatInt(time.Now().UnixMilli(), 36) + "_" + hex.EncodeToString(buffer[:])
}
