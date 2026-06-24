package cards

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

const RecentDrawsLimit = 10

var (
	ErrInvalidDrawCount  = errors.New("card draw count must be between 1 and 10")
	ErrInsufficientDraws = errors.New("card draws are insufficient")
	ErrEmptyCardCatalog  = errors.New("card catalog is empty")
)

type Card struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Rarity         Rarity  `json:"rarity"`
	Image          string  `json:"image"`
	ThumbnailImage string  `json:"thumbnailImage,omitempty"`
	OriginalImage  string  `json:"originalImage,omitempty"`
	BackImage      string  `json:"backImage"`
	Probability    float64 `json:"probability"`
	AlbumID        string  `json:"albumId"`
}

type RandomSource interface {
	Float64() float64
	Intn(n int) int
}

type DrawResult struct {
	Card           Card  `json:"card"`
	IsDuplicate    bool  `json:"isDuplicate"`
	FragmentsAdded int64 `json:"fragmentsAdded,omitempty"`
	Timestamp      int64 `json:"timestamp,omitempty"`
}

type DrawOutcome struct {
	State   UserState
	Results []DrawResult
}

type FragmentExchangeOutcome struct {
	Success       bool
	State         UserState
	Card          Card
	FragmentsCost int64
	Message       string
}

type RewardClaimInput struct {
	AlbumID       string
	RewardType    RewardType
	PointsAwarded int64
}

type RewardClaimOutcome struct {
	Success       bool
	State         UserState
	RewardKey     string
	PointsAwarded int64
	Message       string
}

var rarityDrawOrder = []Rarity{
	RarityLegendaryRare,
	RarityLegendary,
	RarityEpic,
	RarityRare,
	RarityCommon,
}

var rarityLevels = map[Rarity]int{
	RarityCommon:        0,
	RarityRare:          1,
	RarityEpic:          2,
	RarityLegendary:     3,
	RarityLegendaryRare: 4,
}

func ApplyDraws(state UserState, rules Rules, catalog []Card, count int, rng RandomSource, now time.Time) (DrawOutcome, error) {
	if count < 1 || count > 10 {
		return DrawOutcome{}, ErrInvalidDrawCount
	}
	if len(catalog) == 0 {
		return DrawOutcome{}, ErrEmptyCardCatalog
	}
	if rng == nil {
		return DrawOutcome{}, errors.New("random source is required")
	}

	next := cloneUserState(state)
	normalizeUserState(&next)
	if next.DrawsAvailable < int64(count) {
		return DrawOutcome{}, fmt.Errorf("%w: need %d, current %d", ErrInsufficientDraws, count, next.DrawsAvailable)
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}

	results := make([]DrawResult, 0, count)
	for index := 0; index < count; index += 1 {
		next.DrawsAvailable -= 1
		incrementPityCounters(&next)

		card := selectCardForDraw(next, rules, catalog, rng)
		result := applyDrawResult(&next, rules, card, now.Add(time.Duration(index)*time.Millisecond).UnixMilli())
		results = append(results, result)
	}

	return DrawOutcome{State: next, Results: results}, nil
}

func ApplyFragmentExchange(state UserState, rules Rules, catalog []Card, cardID string) (FragmentExchangeOutcome, error) {
	if len(catalog) == 0 {
		return FragmentExchangeOutcome{}, ErrEmptyCardCatalog
	}

	card, ok := findCard(catalog, cardID)
	if !ok {
		return FragmentExchangeOutcome{Success: false, Message: "无效的卡片 ID"}, nil
	}

	next := cloneUserState(state)
	normalizeUserState(&next)
	if containsString(next.Inventory, card.ID) {
		return FragmentExchangeOutcome{Success: false, State: next, Card: card, Message: "已拥有该卡片，无需兑换"}, nil
	}

	price := exchangePrice(rules, card.Rarity)
	if next.Fragments < price {
		return FragmentExchangeOutcome{Success: false, State: next, Card: card, FragmentsCost: price, Message: "碎片不足"}, nil
	}

	next.Fragments -= price
	next.Inventory = append(next.Inventory, card.ID)
	normalizeUserState(&next)
	return FragmentExchangeOutcome{
		Success:       true,
		State:         next,
		Card:          card,
		FragmentsCost: price,
	}, nil
}

func ApplyRewardClaim(state UserState, catalog []Card, input RewardClaimInput) (RewardClaimOutcome, error) {
	if len(catalog) == 0 {
		return RewardClaimOutcome{}, ErrEmptyCardCatalog
	}

	albumID := strings.TrimSpace(input.AlbumID)
	if albumID == "" {
		return RewardClaimOutcome{Success: false, Message: "无效的卡册ID"}, nil
	}
	if !isRewardType(input.RewardType) {
		return RewardClaimOutcome{Success: false, Message: "无效的奖励类型"}, nil
	}
	if input.PointsAwarded <= 0 {
		return RewardClaimOutcome{Success: false, Message: "奖励积分配置异常"}, nil
	}

	requiredCardIDs := requiredCardsForReward(catalog, albumID, input.RewardType)
	if len(requiredCardIDs) == 0 {
		return RewardClaimOutcome{Success: false, Message: "该卡册没有此稀有度的卡牌"}, nil
	}

	next := cloneUserState(state)
	normalizeUserState(&next)
	rewardKey := RewardKey(input.RewardType, albumID)
	if containsString(next.CollectionRewards, rewardKey) {
		return RewardClaimOutcome{Success: false, State: next, RewardKey: rewardKey, Message: "该奖励已领取"}, nil
	}

	for _, requiredID := range requiredCardIDs {
		if !containsString(next.Inventory, requiredID) {
			return RewardClaimOutcome{Success: false, State: next, RewardKey: rewardKey, Message: "尚未集齐该系列卡牌"}, nil
		}
	}

	next.CollectionRewards = append(next.CollectionRewards, rewardKey)
	normalizeUserState(&next)
	return RewardClaimOutcome{
		Success:       true,
		State:         next,
		RewardKey:     rewardKey,
		PointsAwarded: input.PointsAwarded,
	}, nil
}

func RewardKey(rewardType RewardType, albumID string) string {
	return fmt.Sprintf("album:%s:%s", strings.TrimSpace(albumID), rewardType)
}

func GetGuaranteedRarity(state UserState, rules Rules) (Rarity, bool) {
	thresholds := rules.PityThresholds
	if len(thresholds) == 0 {
		thresholds = DefaultRules().PityThresholds
	}
	if threshold := thresholds[RarityLegendaryRare]; threshold > 0 && state.PityLegendaryRare >= threshold {
		return RarityLegendaryRare, true
	}
	if threshold := thresholds[RarityLegendary]; threshold > 0 && state.PityLegendary >= threshold {
		return RarityLegendary, true
	}
	if threshold := thresholds[RarityEpic]; threshold > 0 && state.PityEpic >= threshold {
		return RarityEpic, true
	}
	if threshold := thresholds[RarityRare]; threshold > 0 && state.PityRare >= threshold {
		return RarityRare, true
	}
	return "", false
}

func incrementPityCounters(state *UserState) {
	state.PityRare += 1
	state.PityEpic += 1
	state.PityLegendary += 1
	state.PityLegendaryRare += 1
}

func resetPityCountersAfterDraw(state *UserState, rarity Rarity) {
	switch rarity {
	case RarityLegendaryRare:
		state.PityRare = 0
		state.PityEpic = 0
		state.PityLegendary = 0
		state.PityLegendaryRare = 0
	case RarityLegendary:
		state.PityRare = 0
		state.PityEpic = 0
		state.PityLegendary = 0
	case RarityEpic:
		state.PityRare = 0
		state.PityEpic = 0
	case RarityRare:
		state.PityRare = 0
	}
}

func selectCardForDraw(state UserState, rules Rules, catalog []Card, rng RandomSource) Card {
	if guaranteed, ok := GetGuaranteedRarity(state, rules); ok {
		return selectCardAtLeastRarity(catalog, guaranteed, rng)
	}
	return selectCardByProbability(catalog, rules, rng)
}

func selectCardByProbability(catalog []Card, rules Rules, rng RandomSource) Card {
	probabilities := rules.RarityProbabilities
	if len(probabilities) == 0 {
		probabilities = DefaultRules().RarityProbabilities
	}

	totalWeight := 0.0
	for _, rarity := range rarityDrawOrder {
		totalWeight += probabilities[rarity]
	}
	if totalWeight <= 0 {
		return selectCardByRarity(catalog, RarityCommon, rng)
	}

	random := rng.Float64() * totalWeight
	selectedRarity := RarityCommon
	for _, rarity := range rarityDrawOrder {
		random -= probabilities[rarity]
		if random <= 0 {
			selectedRarity = rarity
			break
		}
	}
	return selectCardByRarity(catalog, selectedRarity, rng)
}

func selectCardByRarity(catalog []Card, rarity Rarity, rng RandomSource) Card {
	candidates := make([]Card, 0)
	for _, card := range catalog {
		if card.Rarity == rarity {
			candidates = append(candidates, card)
		}
	}
	if len(candidates) == 0 {
		return catalog[len(catalog)-1]
	}
	return candidates[safeRandomIndex(rng, len(candidates))]
}

func selectCardAtLeastRarity(catalog []Card, rarity Rarity, rng RandomSource) Card {
	minLevel := rarityLevels[rarity]
	candidates := make([]Card, 0)
	for _, card := range catalog {
		if rarityLevels[card.Rarity] >= minLevel {
			candidates = append(candidates, card)
		}
	}
	if len(candidates) == 0 {
		return catalog[len(catalog)-1]
	}
	return candidates[safeRandomIndex(rng, len(candidates))]
}

func safeRandomIndex(rng RandomSource, n int) int {
	index := rng.Intn(n)
	if index < 0 {
		return 0
	}
	if index >= n {
		return n - 1
	}
	return index
}

func applyDrawResult(state *UserState, rules Rules, card Card, timestamp int64) DrawResult {
	isDuplicate := containsString(state.Inventory, card.ID)
	fragmentsAdded := int64(0)
	if isDuplicate {
		fragmentsAdded = fragmentValue(rules, card.Rarity)
		state.Fragments += fragmentsAdded
	} else {
		state.Inventory = append(state.Inventory, card.ID)
	}

	resetPityCountersAfterDraw(state, card.Rarity)
	state.RecentDraws = append([]RecentDraw{{
		CardID:         card.ID,
		Rarity:         card.Rarity,
		IsDuplicate:    isDuplicate,
		FragmentsAdded: fragmentsAdded,
		Timestamp:      timestamp,
	}}, state.RecentDraws...)
	state.RecentDraws = normalizeRecentDraws(state.RecentDraws)

	return DrawResult{
		Card:           card,
		IsDuplicate:    isDuplicate,
		FragmentsAdded: fragmentsAdded,
		Timestamp:      timestamp,
	}
}

func fragmentValue(rules Rules, rarity Rarity) int64 {
	if value := rules.FragmentValues[rarity]; value > 0 {
		return value
	}
	return DefaultRules().FragmentValues[rarity]
}

func exchangePrice(rules Rules, rarity Rarity) int64 {
	if value := rules.ExchangePrices[rarity]; value > 0 {
		return value
	}
	return DefaultRules().ExchangePrices[rarity]
}

func requiredCardsForReward(catalog []Card, albumID string, rewardType RewardType) []string {
	result := make([]string, 0)
	for _, card := range catalog {
		if card.AlbumID != albumID {
			continue
		}
		if rewardType == RewardFullSet || RewardType(card.Rarity) == rewardType {
			result = append(result, card.ID)
		}
	}
	return result
}

func isRewardType(rewardType RewardType) bool {
	if rewardType == RewardFullSet {
		return true
	}
	return isRarity(Rarity(rewardType))
}

func findCard(catalog []Card, cardID string) (Card, bool) {
	cardID = strings.TrimSpace(cardID)
	for _, card := range catalog {
		if card.ID == cardID {
			return card, true
		}
	}
	return Card{}, false
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func cloneUserState(state UserState) UserState {
	next := state
	next.Inventory = append([]string(nil), state.Inventory...)
	next.CollectionRewards = append([]string(nil), state.CollectionRewards...)
	next.RecentDraws = append([]RecentDraw(nil), state.RecentDraws...)
	next.RawState = map[string]any{}
	for key, value := range state.RawState {
		next.RawState[key] = value
	}
	return next
}
