package cards

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	db  *pgxpool.Pool
	rng RandomSource
}

type DrawCardsInput struct {
	UserID      int64
	Count       int
	Catalog     []Card
	DrawGroupID string
	NowMs       int64
}

type DrawCardsResult struct {
	Success        bool
	Results        []DrawResult
	DrawsAvailable int64
	Message        string
}

type FragmentExchangeInput struct {
	UserID  int64
	CardID  string
	Catalog []Card
}

type FragmentExchangeResult struct {
	Success       bool
	Card          Card
	Fragments     int64
	FragmentsCost int64
	Message       string
}

type RewardClaimServiceInput struct {
	UserID        int64
	AlbumID       string
	RewardType    RewardType
	PointsAwarded int64
	Catalog       []Card
	NowMs         int64
}

type RewardClaimResult struct {
	Success       bool
	RewardKey     string
	PointsAwarded int64
	NewBalance    int64
	Message       string
}

func NewService(db *pgxpool.Pool) *Service {
	return NewServiceWithRandom(db, cryptoRandomSource{})
}

func NewServiceWithRandom(db *pgxpool.Pool, rng RandomSource) *Service {
	return &Service{db: db, rng: rng}
}

func (service *Service) ExecuteDraws(ctx context.Context, input DrawCardsInput) (DrawCardsResult, error) {
	if service.db == nil {
		return DrawCardsResult{}, ErrUnavailable
	}
	if input.UserID <= 0 {
		return DrawCardsResult{}, errors.New("userID must be positive")
	}
	if input.Count < 1 || input.Count > 10 {
		return DrawCardsResult{Success: false, Message: "抽卡次数参数无效"}, nil
	}
	if len(input.Catalog) == 0 {
		return DrawCardsResult{}, ErrEmptyCardCatalog
	}
	rng := service.rng
	if rng == nil {
		rng = cryptoRandomSource{}
	}
	nowMs := input.NowMs
	if nowMs <= 0 {
		nowMs = time.Now().UnixMilli()
	}
	drawGroupID := strings.TrimSpace(input.DrawGroupID)
	if drawGroupID == "" {
		drawGroupID = randomDrawGroupID()
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return DrawCardsResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := getOrCreateUserStateForUpdateTx(ctx, tx, input.UserID)
	if err != nil {
		return DrawCardsResult{}, err
	}
	if state.DrawsAvailable < int64(input.Count) {
		return DrawCardsResult{
			Success:        false,
			DrawsAvailable: state.DrawsAvailable,
			Message:        fmt.Sprintf("抽卡次数不足，需要%d次，当前%d次", input.Count, state.DrawsAvailable),
		}, tx.Commit(ctx)
	}

	rules, err := getRulesTx(ctx, tx)
	if err != nil {
		return DrawCardsResult{}, err
	}
	outcome, err := ApplyDraws(state, rules, input.Catalog, input.Count, rng, time.UnixMilli(nowMs).UTC())
	if err != nil {
		return DrawCardsResult{}, err
	}
	if err := saveUserStateTx(ctx, tx, outcome.State); err != nil {
		return DrawCardsResult{}, err
	}
	for _, result := range outcome.Results {
		if err := insertDrawLogTx(ctx, tx, input.UserID, drawGroupID, result); err != nil {
			return DrawCardsResult{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return DrawCardsResult{}, err
	}
	return DrawCardsResult{
		Success:        true,
		Results:        outcome.Results,
		DrawsAvailable: outcome.State.DrawsAvailable,
	}, nil
}

func (service *Service) ExecuteFragmentExchange(ctx context.Context, input FragmentExchangeInput) (FragmentExchangeResult, error) {
	if service.db == nil {
		return FragmentExchangeResult{}, ErrUnavailable
	}
	if input.UserID <= 0 {
		return FragmentExchangeResult{}, errors.New("userID must be positive")
	}
	if len(input.Catalog) == 0 {
		return FragmentExchangeResult{}, ErrEmptyCardCatalog
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return FragmentExchangeResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := getOrCreateUserStateForUpdateTx(ctx, tx, input.UserID)
	if err != nil {
		return FragmentExchangeResult{}, err
	}
	rules, err := getRulesTx(ctx, tx)
	if err != nil {
		return FragmentExchangeResult{}, err
	}
	outcome, err := ApplyFragmentExchange(state, rules, input.Catalog, input.CardID)
	if err != nil {
		return FragmentExchangeResult{}, err
	}
	if outcome.Success {
		if err := saveUserStateTx(ctx, tx, outcome.State); err != nil {
			return FragmentExchangeResult{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return FragmentExchangeResult{}, err
	}
	return FragmentExchangeResult{
		Success:       outcome.Success,
		Card:          outcome.Card,
		Fragments:     outcome.State.Fragments,
		FragmentsCost: outcome.FragmentsCost,
		Message:       outcome.Message,
	}, nil
}

func (service *Service) ExecuteRewardClaim(ctx context.Context, input RewardClaimServiceInput) (RewardClaimResult, error) {
	if service.db == nil {
		return RewardClaimResult{}, ErrUnavailable
	}
	if input.UserID <= 0 {
		return RewardClaimResult{}, errors.New("userID must be positive")
	}
	if len(input.Catalog) == 0 {
		return RewardClaimResult{}, ErrEmptyCardCatalog
	}
	nowMs := input.NowMs
	if nowMs <= 0 {
		nowMs = time.Now().UnixMilli()
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return RewardClaimResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := getOrCreateUserStateForUpdateTx(ctx, tx, input.UserID)
	if err != nil {
		return RewardClaimResult{}, err
	}
	outcome, err := ApplyRewardClaim(state, input.Catalog, RewardClaimInput{
		AlbumID:       input.AlbumID,
		RewardType:    input.RewardType,
		PointsAwarded: input.PointsAwarded,
	})
	if err != nil {
		return RewardClaimResult{}, err
	}
	if !outcome.Success {
		if err := tx.Commit(ctx); err != nil {
			return RewardClaimResult{}, err
		}
		return RewardClaimResult{
			Success:   false,
			RewardKey: outcome.RewardKey,
			Message:   outcome.Message,
		}, nil
	}

	claimInserted, err := insertRewardClaimTx(ctx, tx, input.UserID, input.AlbumID, input.RewardType, outcome.PointsAwarded, nowMs)
	if err != nil {
		return RewardClaimResult{}, err
	}
	if !claimInserted {
		if err := tx.Commit(ctx); err != nil {
			return RewardClaimResult{}, err
		}
		return RewardClaimResult{
			Success:   false,
			RewardKey: outcome.RewardKey,
			Message:   "该奖励已领取",
		}, nil
	}

	newBalance, err := addRewardPointsTx(ctx, tx, input.UserID, outcome.PointsAwarded, rewardDescription(input.RewardType))
	if err != nil {
		return RewardClaimResult{}, err
	}
	if err := saveUserStateTx(ctx, tx, outcome.State); err != nil {
		return RewardClaimResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RewardClaimResult{}, err
	}
	return RewardClaimResult{
		Success:       true,
		RewardKey:     outcome.RewardKey,
		PointsAwarded: outcome.PointsAwarded,
		NewBalance:    newBalance,
	}, nil
}

func getOrCreateUserStateForUpdateTx(ctx context.Context, tx pgx.Tx, userID int64) (UserState, error) {
	if _, err := tx.Exec(ctx,
		`INSERT INTO card_user_states (
		   user_id, inventory, fragments, pity_rare, pity_epic, pity_legendary,
		   pity_legendary_rare, draws_available, collection_rewards, recent_draws,
		   raw_state, created_at, updated_at
		 ) VALUES (
		   $1, '[]'::jsonb, 0, 0, 0, 0, 0, 1, '[]'::jsonb, '[]'::jsonb,
		   '{}'::jsonb, now(), now()
		 )
		 ON CONFLICT (user_id) DO NOTHING`,
		userID,
	); err != nil {
		return UserState{}, err
	}

	state := DefaultUserState(userID)
	var inventoryRaw []byte
	var collectionRewardsRaw []byte
	var recentDrawsRaw []byte
	var rawState []byte
	err := tx.QueryRow(ctx,
		`SELECT inventory, fragments, pity_rare, pity_epic, pity_legendary,
		        pity_legendary_rare, draws_available, collection_rewards,
		        recent_draws, raw_state, created_at, updated_at
		   FROM card_user_states
		  WHERE user_id = $1
		  FOR UPDATE`,
		userID,
	).Scan(
		&inventoryRaw,
		&state.Fragments,
		&state.PityRare,
		&state.PityEpic,
		&state.PityLegendary,
		&state.PityLegendaryRare,
		&state.DrawsAvailable,
		&collectionRewardsRaw,
		&recentDrawsRaw,
		&rawState,
		&state.CreatedAt,
		&state.UpdatedAt,
	)
	if err != nil {
		return UserState{}, err
	}
	state.Exists = true
	state.Inventory = decodeStringArray(inventoryRaw)
	state.CollectionRewards = decodeStringArray(collectionRewardsRaw)
	state.RecentDraws = decodeRecentDraws(recentDrawsRaw)
	state.RawState = decodeObject(rawState)
	normalizeUserState(&state)
	return state, nil
}

func insertRewardClaimTx(ctx context.Context, tx pgx.Tx, userID int64, albumID string, rewardType RewardType, pointsAwarded int64, nowMs int64) (bool, error) {
	commandTag, err := tx.Exec(ctx,
		`INSERT INTO card_reward_claims (
		   user_id, album_id, reward_type, points_awarded, claimed_at_ms
		 ) VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (user_id, album_id, reward_type) DO NOTHING`,
		userID,
		strings.TrimSpace(albumID),
		string(rewardType),
		pointsAwarded,
		nowMs,
	)
	if err != nil {
		return false, err
	}
	return commandTag.RowsAffected() == 1, nil
}

func addRewardPointsTx(ctx context.Context, tx pgx.Tx, userID int64, points int64, description string) (int64, error) {
	if _, err := tx.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())
		 ON CONFLICT (user_id) DO NOTHING`,
		userID,
	); err != nil {
		return 0, err
	}

	var balance int64
	if err := tx.QueryRow(ctx,
		`SELECT balance FROM point_accounts WHERE user_id = $1 FOR UPDATE`,
		userID,
	).Scan(&balance); err != nil {
		return 0, err
	}
	nextBalance := balance + points
	if _, err := tx.Exec(ctx,
		`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
		nextBalance,
		userID,
	); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
		 VALUES ($1, $2, $3, 'card_collection', $4, $5, now())`,
		randomDrawGroupID(),
		userID,
		points,
		description,
		nextBalance,
	); err != nil {
		return 0, err
	}
	return nextBalance, nil
}

func rewardDescription(rewardType RewardType) string {
	names := map[RewardType]string{
		RewardType(RarityCommon):        "普通",
		RewardType(RarityRare):          "稀有",
		RewardType(RarityEpic):          "史诗",
		RewardType(RarityLegendary):     "传说",
		RewardType(RarityLegendaryRare): "传说稀有",
		RewardFullSet:                   "全套",
	}
	name := names[rewardType]
	if name == "" {
		name = string(rewardType)
	}
	return "集齐" + name + "卡牌奖励"
}

func saveUserStateTx(ctx context.Context, tx pgx.Tx, state UserState) error {
	if state.UserID <= 0 {
		return errors.New("userID must be positive")
	}
	normalizeUserState(&state)
	inventoryJSON, err := json.Marshal(state.Inventory)
	if err != nil {
		return err
	}
	collectionRewardsJSON, err := json.Marshal(state.CollectionRewards)
	if err != nil {
		return err
	}
	recentDrawsJSON, err := json.Marshal(state.RecentDraws)
	if err != nil {
		return err
	}
	rawState := state.RawState
	if rawState == nil {
		rawState = map[string]any{}
	}
	rawStateJSON, err := json.Marshal(rawState)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	createdAt := state.CreatedAt
	if createdAt.IsZero() {
		createdAt = now
	}
	updatedAt := state.UpdatedAt
	if updatedAt.IsZero() {
		updatedAt = now
	}

	commandTag, err := tx.Exec(ctx,
		`INSERT INTO card_user_states (
		   user_id, inventory, fragments, pity_rare, pity_epic, pity_legendary,
		   pity_legendary_rare, draws_available, collection_rewards, recent_draws,
		   raw_state, created_at, updated_at
		 ) VALUES (
		   $1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
		   $11::jsonb, $12, $13
		 )
		 ON CONFLICT (user_id) DO UPDATE SET
		   inventory = excluded.inventory,
		   fragments = excluded.fragments,
		   pity_rare = excluded.pity_rare,
		   pity_epic = excluded.pity_epic,
		   pity_legendary = excluded.pity_legendary,
		   pity_legendary_rare = excluded.pity_legendary_rare,
		   draws_available = excluded.draws_available,
		   collection_rewards = excluded.collection_rewards,
		   recent_draws = excluded.recent_draws,
		   raw_state = excluded.raw_state,
		   updated_at = excluded.updated_at`,
		state.UserID,
		string(inventoryJSON),
		state.Fragments,
		state.PityRare,
		state.PityEpic,
		state.PityLegendary,
		state.PityLegendaryRare,
		state.DrawsAvailable,
		string(collectionRewardsJSON),
		string(recentDrawsJSON),
		string(rawStateJSON),
		createdAt,
		updatedAt,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return fmt.Errorf("card user state %d was not saved", state.UserID)
	}
	return nil
}

func getRulesTx(ctx context.Context, tx pgx.Tx) (Rules, error) {
	rules := DefaultRules()
	var probabilitiesRaw []byte
	var pityRaw []byte
	var fragmentsRaw []byte
	var exchangeRaw []byte
	err := tx.QueryRow(ctx,
		`SELECT id, rarity_probabilities, pity_thresholds, card_draw_price,
		        fragment_values, exchange_prices, updated_at_ms
		   FROM card_rules
		  WHERE id = 'default'`,
	).Scan(
		&rules.ID,
		&probabilitiesRaw,
		&pityRaw,
		&rules.CardDrawPrice,
		&fragmentsRaw,
		&exchangeRaw,
		&rules.UpdatedAtMs,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return rules, nil
	}
	if err != nil {
		return Rules{}, err
	}
	if rules.CardDrawPrice <= 0 {
		rules.CardDrawPrice = DefaultRules().CardDrawPrice
	}
	rules.RarityProbabilities = decodeRarityFloatMap(probabilitiesRaw, DefaultRules().RarityProbabilities)
	rules.PityThresholds = decodeRarityIntMap(pityRaw, DefaultRules().PityThresholds)
	rules.FragmentValues = decodeRarityIntMap(fragmentsRaw, DefaultRules().FragmentValues)
	rules.ExchangePrices = decodeRarityIntMap(exchangeRaw, DefaultRules().ExchangePrices)
	return rules, nil
}

func insertDrawLogTx(ctx context.Context, tx pgx.Tx, userID int64, drawGroupID string, result DrawResult) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO card_draw_logs (
		   user_id, draw_group_id, card_id, rarity, is_duplicate, fragments_added, created_at_ms
		 ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		userID,
		drawGroupID,
		result.Card.ID,
		string(result.Card.Rarity),
		result.IsDuplicate,
		result.FragmentsAdded,
		result.Timestamp,
	)
	return err
}

type cryptoRandomSource struct{}

func (cryptoRandomSource) Float64() float64 {
	max := new(big.Int).Lsh(big.NewInt(1), 53)
	value, err := rand.Int(rand.Reader, max)
	if err != nil {
		return float64(time.Now().UnixNano()%1_000_000) / 1_000_000
	}
	return float64(value.Int64()) / math.Pow(2, 53)
}

func (cryptoRandomSource) Intn(n int) int {
	if n <= 1 {
		return 0
	}
	value, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		return int(time.Now().UnixNano() % int64(n))
	}
	return int(value.Int64())
}

func randomDrawGroupID() string {
	var buffer [16]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		return fmt.Sprintf("draw-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buffer[:])
}
