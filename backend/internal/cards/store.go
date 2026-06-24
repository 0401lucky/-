package cards

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrUnavailable = errors.New("cards database unavailable")

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (store *Store) GetUserState(ctx context.Context, userID int64) (UserState, error) {
	if store.db == nil {
		return UserState{}, ErrUnavailable
	}
	if userID <= 0 {
		return UserState{}, errors.New("userID must be positive")
	}

	state := DefaultUserState(userID)
	var inventoryRaw []byte
	var collectionRewardsRaw []byte
	var recentDrawsRaw []byte
	var rawState []byte
	err := store.db.QueryRow(ctx,
		`SELECT inventory, fragments, pity_rare, pity_epic, pity_legendary,
		        pity_legendary_rare, draws_available, collection_rewards,
		        recent_draws, raw_state, created_at, updated_at
		   FROM card_user_states
		  WHERE user_id = $1`,
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
	if errors.Is(err, pgx.ErrNoRows) {
		return state, nil
	}
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

func (store *Store) SaveUserState(ctx context.Context, state UserState) error {
	if store.db == nil {
		return ErrUnavailable
	}
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

	commandTag, err := store.db.Exec(ctx,
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

func (store *Store) GetRules(ctx context.Context) (Rules, error) {
	if store.db == nil {
		return Rules{}, ErrUnavailable
	}

	rules := DefaultRules()
	var probabilitiesRaw []byte
	var pityRaw []byte
	var fragmentsRaw []byte
	var exchangeRaw []byte
	err := store.db.QueryRow(ctx,
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

func normalizeUserState(state *UserState) {
	state.Inventory = uniqueStrings(state.Inventory)
	state.CollectionRewards = uniqueStrings(state.CollectionRewards)
	if state.Fragments < 0 {
		state.Fragments = 0
	}
	if state.PityRare < 0 {
		state.PityRare = 0
	}
	if state.PityEpic < 0 {
		state.PityEpic = 0
	}
	if state.PityLegendary < 0 {
		state.PityLegendary = 0
	}
	if state.PityLegendaryRare < 0 {
		state.PityLegendaryRare = 0
	}
	if state.DrawsAvailable < 0 {
		state.DrawsAvailable = 0
	}
	state.RecentDraws = normalizeRecentDraws(state.RecentDraws)
	if state.RawState == nil {
		state.RawState = map[string]any{}
	}
}

func uniqueStrings(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func normalizeRecentDraws(draws []RecentDraw) []RecentDraw {
	result := make([]RecentDraw, 0, len(draws))
	for _, draw := range draws {
		draw.CardID = strings.TrimSpace(draw.CardID)
		if draw.CardID == "" || !isRarity(draw.Rarity) || draw.Timestamp <= 0 {
			continue
		}
		if draw.FragmentsAdded < 0 {
			draw.FragmentsAdded = 0
		}
		result = append(result, draw)
		if len(result) == 10 {
			break
		}
	}
	return result
}

func decodeStringArray(raw []byte) []string {
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return []string{}
	}
	return uniqueStrings(values)
}

func decodeRecentDraws(raw []byte) []RecentDraw {
	var values []RecentDraw
	if err := json.Unmarshal(raw, &values); err != nil {
		return []RecentDraw{}
	}
	return normalizeRecentDraws(values)
}

func decodeObject(raw []byte) map[string]any {
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil || value == nil {
		return map[string]any{}
	}
	return value
}

func decodeRarityFloatMap(raw []byte, fallback map[Rarity]float64) map[Rarity]float64 {
	var values map[string]float64
	if err := json.Unmarshal(raw, &values); err != nil {
		return cloneRarityFloatMap(fallback)
	}
	result := cloneRarityFloatMap(fallback)
	for key, value := range values {
		rarity := Rarity(key)
		if isRarity(rarity) && value >= 0 {
			result[rarity] = value
		}
	}
	return result
}

func decodeRarityIntMap(raw []byte, fallback map[Rarity]int64) map[Rarity]int64 {
	var values map[string]int64
	if err := json.Unmarshal(raw, &values); err != nil {
		return cloneRarityIntMap(fallback)
	}
	result := cloneRarityIntMap(fallback)
	for key, value := range values {
		rarity := Rarity(key)
		if isRarity(rarity) && value > 0 {
			result[rarity] = value
		}
	}
	return result
}

func cloneRarityFloatMap(source map[Rarity]float64) map[Rarity]float64 {
	result := map[Rarity]float64{}
	for key, value := range source {
		result[key] = value
	}
	return result
}

func cloneRarityIntMap(source map[Rarity]int64) map[Rarity]int64 {
	result := map[Rarity]int64{}
	for key, value := range source {
		result[key] = value
	}
	return result
}

func isRarity(value Rarity) bool {
	switch value {
	case RarityCommon, RarityRare, RarityEpic, RarityLegendary, RarityLegendaryRare:
		return true
	default:
		return false
	}
}
