package cards

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultAdminCardUserListLimit = 50
	maxAdminCardUserListLimit     = 100
)

type AdminService struct {
	db *pgxpool.Pool
}

type AdminUserListInput struct {
	Page   int
	Limit  int
	Search string
}

type AdminCardUser struct {
	ID             int64
	Username       string
	FirstSeen      int64
	CardCount      int64
	Fragments      int64
	DrawsAvailable int64
	PityCounter    int64
}

type AdminPagination struct {
	Page       int
	Limit      int
	Total      int64
	TotalPages int
	HasMore    bool
}

type AdminUserListResult struct {
	Users      []AdminCardUser
	Pagination AdminPagination
}

type AdminUserCardDetail struct {
	Inventory         []string
	Fragments         int64
	PityCounter       int64
	PityRare          int64
	PityEpic          int64
	PityLegendary     int64
	PityLegendaryRare int64
	DrawsAvailable    int64
	CollectionRewards []string
	RecentDraws       []RecentDraw
}

type AdminAlbumReward struct {
	ID            string
	Name          string
	Description   string
	Season        string
	DefaultReward int64
	CurrentReward int64
}

type AdminTierReward struct {
	ID            RewardType
	Name          string
	DefaultReward int64
	CurrentReward int64
}

type AdminRewardConfig struct {
	Albums []AdminAlbumReward
	Tiers  []AdminTierReward
}

type adminAlbumDefinition struct {
	ID          string
	Name        string
	Description string
	Season      string
	Reward      int64
}

func NewAdminService(db *pgxpool.Pool) *AdminService {
	return &AdminService{db: db}
}

func (service *AdminService) ListUsers(ctx context.Context, input AdminUserListInput) (AdminUserListResult, error) {
	if service.db == nil {
		return AdminUserListResult{}, ErrUnavailable
	}

	page, limit := normalizeAdminListPagination(input.Page, input.Limit)
	search := strings.TrimSpace(input.Search)
	offset := (page - 1) * limit

	whereClause := ""
	args := []any{}
	if search != "" {
		whereClause = `WHERE lower(users.username) LIKE '%' || lower($1) || '%' OR users.id::text LIKE '%' || $1 || '%'`
		args = append(args, search)
	}

	countQuery := `SELECT count(*) FROM users ` + whereClause
	var total int64
	if err := service.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return AdminUserListResult{}, err
	}

	listArgs := append([]any{}, args...)
	listArgs = append(listArgs, limit, offset)
	limitParam := len(listArgs) - 1
	offsetParam := len(listArgs)
	query := `SELECT users.id,
	                 users.username,
	                 floor(extract(epoch from users.first_seen_at) * 1000)::bigint AS first_seen_ms,
	                 COALESCE(jsonb_array_length(card_user_states.inventory), 0)::bigint AS card_count,
	                 COALESCE(card_user_states.fragments, 0)::bigint AS fragments,
	                 COALESCE(card_user_states.draws_available, 1)::bigint AS draws_available,
	                 COALESCE(card_user_states.pity_legendary_rare, 0)::bigint AS pity_counter
	            FROM users
	            LEFT JOIN card_user_states ON card_user_states.user_id = users.id ` + whereClause + `
	           ORDER BY users.first_seen_at DESC, users.id DESC
	           LIMIT $` + intToString(limitParam) + ` OFFSET $` + intToString(offsetParam)

	rows, err := service.db.Query(ctx, query, listArgs...)
	if err != nil {
		return AdminUserListResult{}, err
	}
	defer rows.Close()

	users := []AdminCardUser{}
	for rows.Next() {
		var user AdminCardUser
		if err := rows.Scan(
			&user.ID,
			&user.Username,
			&user.FirstSeen,
			&user.CardCount,
			&user.Fragments,
			&user.DrawsAvailable,
			&user.PityCounter,
		); err != nil {
			return AdminUserListResult{}, err
		}
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return AdminUserListResult{}, err
	}

	return AdminUserListResult{
		Users: users,
		Pagination: AdminPagination{
			Page:       page,
			Limit:      limit,
			Total:      total,
			TotalPages: totalPages(total, limit),
			HasMore:    int64(offset+len(users)) < total,
		},
	}, nil
}

func (service *AdminService) GetUserDetail(ctx context.Context, userID int64) (AdminUserCardDetail, error) {
	store := NewStore(service.db)
	state, err := store.GetUserState(ctx, userID)
	if err != nil {
		return AdminUserCardDetail{}, err
	}
	return adminUserCardDetailFromState(state), nil
}

func (service *AdminService) GetRules(ctx context.Context) (Rules, error) {
	return NewStore(service.db).GetRules(ctx)
}

func (service *AdminService) GetRewardConfig(ctx context.Context) (AdminRewardConfig, error) {
	if service.db == nil {
		return AdminRewardConfig{}, ErrUnavailable
	}

	albumOverrides, err := service.readAlbumRewardOverrides(ctx)
	if err != nil {
		return AdminRewardConfig{}, err
	}
	tierOverrides, err := service.readTierRewardOverrides(ctx)
	if err != nil {
		return AdminRewardConfig{}, err
	}
	return buildAdminRewardConfig(albumOverrides, tierOverrides), nil
}

func (service *AdminService) readAlbumRewardOverrides(ctx context.Context) (map[string]int64, error) {
	rows, err := service.db.Query(ctx, `SELECT album_id, reward_points FROM card_album_rewards`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	rewards := map[string]int64{}
	for rows.Next() {
		var albumID string
		var points int64
		if err := rows.Scan(&albumID, &points); err != nil {
			return nil, err
		}
		albumID = strings.TrimSpace(albumID)
		if albumID != "" && points >= 0 {
			rewards[albumID] = points
		}
	}
	return rewards, rows.Err()
}

func (service *AdminService) readTierRewardOverrides(ctx context.Context) (map[RewardType]int64, error) {
	rows, err := service.db.Query(ctx, `SELECT reward_type, reward_points FROM card_tier_rewards`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	rewards := map[RewardType]int64{}
	for rows.Next() {
		var rewardType string
		var points int64
		if err := rows.Scan(&rewardType, &points); err != nil {
			return nil, err
		}
		tier := RewardType(strings.TrimSpace(rewardType))
		if isAdminVisibleTier(tier) && points >= 0 {
			rewards[tier] = points
		}
	}
	return rewards, rows.Err()
}

func adminUserCardDetailFromState(state UserState) AdminUserCardDetail {
	return AdminUserCardDetail{
		Inventory:         state.Inventory,
		Fragments:         state.Fragments,
		PityCounter:       state.PityLegendaryRare,
		PityRare:          state.PityRare,
		PityEpic:          state.PityEpic,
		PityLegendary:     state.PityLegendary,
		PityLegendaryRare: state.PityLegendaryRare,
		DrawsAvailable:    state.DrawsAvailable,
		CollectionRewards: state.CollectionRewards,
		RecentDraws:       state.RecentDraws,
	}
}

func buildAdminRewardConfig(albumOverrides map[string]int64, tierOverrides map[RewardType]int64) AdminRewardConfig {
	albums := make([]AdminAlbumReward, 0, len(adminAlbumDefinitions))
	for _, album := range adminAlbumDefinitions {
		current := album.Reward
		if value, ok := albumOverrides[album.ID]; ok && value >= 0 {
			current = value
		}
		albums = append(albums, AdminAlbumReward{
			ID:            album.ID,
			Name:          album.Name,
			Description:   album.Description,
			Season:        album.Season,
			DefaultReward: album.Reward,
			CurrentReward: current,
		})
	}

	tiers := make([]AdminTierReward, 0, len(adminVisibleRewardTiers))
	for _, tier := range adminVisibleRewardTiers {
		defaultReward := adminDefaultTierRewards[tier.ID]
		current := defaultReward
		if value, ok := tierOverrides[tier.ID]; ok && value >= 0 {
			current = value
		}
		tiers = append(tiers, AdminTierReward{
			ID:            tier.ID,
			Name:          tier.Name,
			DefaultReward: defaultReward,
			CurrentReward: current,
		})
	}
	return AdminRewardConfig{Albums: albums, Tiers: tiers}
}

func normalizeAdminListPagination(page int, limit int) (int, int) {
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = defaultAdminCardUserListLimit
	}
	if limit > maxAdminCardUserListLimit {
		limit = maxAdminCardUserListLimit
	}
	return page, limit
}

func totalPages(total int64, limit int) int {
	if total <= 0 {
		return 0
	}
	return int(math.Ceil(float64(total) / float64(limit)))
}

func intToString(value int) string {
	const digits = "0123456789"
	if value == 0 {
		return "0"
	}
	result := ""
	for value > 0 {
		result = string(digits[value%10]) + result
		value /= 10
	}
	return result
}

func isAdminVisibleTier(value RewardType) bool {
	for _, tier := range adminVisibleRewardTiers {
		if tier.ID == value {
			return true
		}
	}
	return false
}

var adminAlbumDefinitions = []adminAlbumDefinition{
	{
		ID:          "animal-s1",
		Name:        "动物伙伴图鉴",
		Description: "收集可爱的动物卡牌，解锁专属奖励",
		Season:      "第一季",
		Reward:      100,
	},
	{
		ID:          "animal-s2",
		Name:        "动物伙伴图鉴 II",
		Description: "更多可爱动物等你收集，全新冒险开启",
		Season:      "第二季",
		Reward:      200,
	},
	{
		ID:          "tarot",
		Name:        "神秘塔罗牌",
		Description: "收集78张经典塔罗牌，揭示命运的奥秘",
		Season:      "特别篇",
		Reward:      500,
	},
}

var adminVisibleRewardTiers = []struct {
	ID   RewardType
	Name string
}{
	{ID: RewardType(RarityCommon), Name: "普通"},
	{ID: RewardType(RarityRare), Name: "稀有"},
	{ID: RewardType(RarityEpic), Name: "史诗"},
	{ID: RewardType(RarityLegendary), Name: "传说"},
	{ID: RewardType(RarityLegendaryRare), Name: "传说稀有"},
}

var adminDefaultTierRewards = map[RewardType]int64{
	RewardType(RarityCommon):        400,
	RewardType(RarityRare):          650,
	RewardType(RarityEpic):          1200,
	RewardType(RarityLegendary):     1800,
	RewardType(RarityLegendaryRare): 3500,
	RewardFullSet:                   10000,
}

var ErrInvalidAdminCardInput = errors.New("invalid admin card input")

type AdminRulesUpdateInput struct {
	RarityProbabilities map[Rarity]float64
	PityThresholds      map[Rarity]int64
	CardDrawPrice       *int64
	FragmentValues      map[Rarity]int64
	ExchangePrices      map[Rarity]int64
	NowMs               int64
}

type AdminRewardUpdateInput struct {
	AlbumID string
	TierID  RewardType
	Reward  int64
	NowMs   int64
}

func (service *AdminService) ResetUserProgress(ctx context.Context, userID int64) error {
	if service.db == nil {
		return ErrUnavailable
	}
	if userID <= 0 {
		return fmt.Errorf("%w: userID must be positive", ErrInvalidAdminCardInput)
	}

	tx, err := service.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `DELETE FROM card_reward_claims WHERE user_id = $1`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM card_user_states WHERE user_id = $1`, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (service *AdminService) UpdateRules(ctx context.Context, input AdminRulesUpdateInput) (Rules, error) {
	if service.db == nil {
		return Rules{}, ErrUnavailable
	}

	current, err := service.GetRules(ctx)
	if err != nil {
		return Rules{}, err
	}
	next := current
	next.RarityProbabilities = cloneRarityFloatMap(current.RarityProbabilities)
	next.PityThresholds = cloneRarityIntMap(current.PityThresholds)
	next.FragmentValues = cloneRarityIntMap(current.FragmentValues)
	next.ExchangePrices = cloneRarityIntMap(current.ExchangePrices)

	for rarity, value := range input.RarityProbabilities {
		if isRarity(rarity) && value >= 0 {
			next.RarityProbabilities[rarity] = value
		}
	}
	for rarity, value := range input.PityThresholds {
		if isPityRarity(rarity) && value > 0 {
			next.PityThresholds[rarity] = value
		}
	}
	if input.CardDrawPrice != nil && *input.CardDrawPrice > 0 {
		next.CardDrawPrice = *input.CardDrawPrice
	}
	for rarity, value := range input.FragmentValues {
		if isRarity(rarity) && value > 0 {
			next.FragmentValues[rarity] = value
		}
	}
	for rarity, value := range input.ExchangePrices {
		if isRarity(rarity) && value > 0 {
			next.ExchangePrices[rarity] = value
		}
	}
	if err := validateAdminRules(next); err != nil {
		return Rules{}, err
	}
	next.UpdatedAtMs = input.NowMs
	if next.UpdatedAtMs <= 0 {
		next.UpdatedAtMs = time.Now().UnixMilli()
	}

	probabilitiesJSON, err := json.Marshal(rarityFloatMapToStringMap(next.RarityProbabilities))
	if err != nil {
		return Rules{}, err
	}
	pityJSON, err := json.Marshal(rarityIntMapToStringMap(next.PityThresholds))
	if err != nil {
		return Rules{}, err
	}
	fragmentsJSON, err := json.Marshal(rarityIntMapToStringMap(next.FragmentValues))
	if err != nil {
		return Rules{}, err
	}
	exchangeJSON, err := json.Marshal(rarityIntMapToStringMap(next.ExchangePrices))
	if err != nil {
		return Rules{}, err
	}
	configJSON, err := json.Marshal(map[string]any{
		"rarityProbabilities": rarityFloatMapToStringMap(next.RarityProbabilities),
		"pityThresholds":      rarityIntMapToStringMap(next.PityThresholds),
		"cardDrawPrice":       next.CardDrawPrice,
		"fragmentValues":      rarityIntMapToStringMap(next.FragmentValues),
		"exchangePrices":      rarityIntMapToStringMap(next.ExchangePrices),
		"updatedAt":           next.UpdatedAtMs,
	})
	if err != nil {
		return Rules{}, err
	}

	_, err = service.db.Exec(ctx,
		`INSERT INTO card_rules (
		   id, rarity_probabilities, pity_thresholds, card_draw_price,
		   fragment_values, exchange_prices, config_json, updated_at_ms, updated_at
		 ) VALUES (
		   'default', $1::jsonb, $2::jsonb, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, now()
		 )
		 ON CONFLICT (id) DO UPDATE SET
		   rarity_probabilities = excluded.rarity_probabilities,
		   pity_thresholds = excluded.pity_thresholds,
		   card_draw_price = excluded.card_draw_price,
		   fragment_values = excluded.fragment_values,
		   exchange_prices = excluded.exchange_prices,
		   config_json = excluded.config_json,
		   updated_at_ms = excluded.updated_at_ms,
		   updated_at = now()`,
		string(probabilitiesJSON),
		string(pityJSON),
		next.CardDrawPrice,
		string(fragmentsJSON),
		string(exchangeJSON),
		string(configJSON),
		next.UpdatedAtMs,
	)
	if err != nil {
		return Rules{}, err
	}
	return next, nil
}

func (service *AdminService) UpdateReward(ctx context.Context, input AdminRewardUpdateInput) (AdminRewardConfig, error) {
	if service.db == nil {
		return AdminRewardConfig{}, ErrUnavailable
	}
	if input.Reward < 0 {
		return AdminRewardConfig{}, fmt.Errorf("%w: reward must be non-negative", ErrInvalidAdminCardInput)
	}
	nowMs := input.NowMs
	if nowMs <= 0 {
		nowMs = time.Now().UnixMilli()
	}

	albumID := strings.TrimSpace(input.AlbumID)
	if albumID != "" {
		if !isAdminAlbumID(albumID) {
			return AdminRewardConfig{}, fmt.Errorf("%w: unknown album", ErrInvalidAdminCardInput)
		}
		if _, err := service.db.Exec(ctx,
			`INSERT INTO card_album_rewards (album_id, reward_points, raw_reward, updated_at_ms, updated_at)
			 VALUES ($1, $2, '{}'::jsonb, $3, now())
			 ON CONFLICT (album_id) DO UPDATE SET
			   reward_points = excluded.reward_points,
			   raw_reward = excluded.raw_reward,
			   updated_at_ms = excluded.updated_at_ms,
			   updated_at = now()`,
			albumID,
			input.Reward,
			nowMs,
		); err != nil {
			return AdminRewardConfig{}, err
		}
		return service.GetRewardConfig(ctx)
	}

	if input.TierID != "" {
		if !isAdminVisibleTier(input.TierID) {
			return AdminRewardConfig{}, fmt.Errorf("%w: unknown tier", ErrInvalidAdminCardInput)
		}
		if _, err := service.db.Exec(ctx,
			`INSERT INTO card_tier_rewards (reward_type, reward_points, raw_reward, updated_at_ms, updated_at)
			 VALUES ($1, $2, '{}'::jsonb, $3, now())
			 ON CONFLICT (reward_type) DO UPDATE SET
			   reward_points = excluded.reward_points,
			   raw_reward = excluded.raw_reward,
			   updated_at_ms = excluded.updated_at_ms,
			   updated_at = now()`,
			string(input.TierID),
			input.Reward,
			nowMs,
		); err != nil {
			return AdminRewardConfig{}, err
		}
		return service.GetRewardConfig(ctx)
	}

	return AdminRewardConfig{}, fmt.Errorf("%w: albumID or tierID required", ErrInvalidAdminCardInput)
}

func validateAdminRules(rules Rules) error {
	total := 0.0
	for _, rarity := range []Rarity{RarityLegendaryRare, RarityLegendary, RarityEpic, RarityRare, RarityCommon} {
		value, ok := rules.RarityProbabilities[rarity]
		if !ok || value < 0 {
			return fmt.Errorf("%w: invalid rarity probability", ErrInvalidAdminCardInput)
		}
		total += value
	}
	if math.Abs(total-100) > 0.01 {
		return fmt.Errorf("%w: rarity probabilities must sum to 100", ErrInvalidAdminCardInput)
	}
	if rules.CardDrawPrice <= 0 {
		return fmt.Errorf("%w: card draw price must be positive", ErrInvalidAdminCardInput)
	}
	for _, rarity := range []Rarity{RarityRare, RarityEpic, RarityLegendary, RarityLegendaryRare} {
		if rules.PityThresholds[rarity] <= 0 {
			return fmt.Errorf("%w: pity threshold must be positive", ErrInvalidAdminCardInput)
		}
	}
	for _, rarity := range []Rarity{RarityLegendaryRare, RarityLegendary, RarityEpic, RarityRare, RarityCommon} {
		if rules.FragmentValues[rarity] <= 0 || rules.ExchangePrices[rarity] <= 0 {
			return fmt.Errorf("%w: fragment and exchange values must be positive", ErrInvalidAdminCardInput)
		}
	}
	return nil
}

func rarityFloatMapToStringMap(values map[Rarity]float64) map[string]float64 {
	result := map[string]float64{}
	for key, value := range values {
		result[string(key)] = value
	}
	return result
}

func rarityIntMapToStringMap(values map[Rarity]int64) map[string]int64 {
	result := map[string]int64{}
	for key, value := range values {
		result[string(key)] = value
	}
	return result
}

func isPityRarity(value Rarity) bool {
	switch value {
	case RarityRare, RarityEpic, RarityLegendary, RarityLegendaryRare:
		return true
	default:
		return false
	}
}

func isAdminAlbumID(value string) bool {
	value = strings.TrimSpace(value)
	for _, album := range adminAlbumDefinitions {
		if album.ID == value {
			return true
		}
	}
	return false
}
