package cards

import (
	"errors"
	"testing"
	"time"
)

type fixedRandom struct {
	floats  []float64
	ints    []int
	floatAt int
	intAt   int
}

func (rng *fixedRandom) Float64() float64 {
	if len(rng.floats) == 0 {
		return 0
	}
	index := rng.floatAt
	if index >= len(rng.floats) {
		index = len(rng.floats) - 1
	}
	rng.floatAt += 1
	return rng.floats[index]
}

func (rng *fixedRandom) Intn(n int) int {
	if len(rng.ints) == 0 {
		return 0
	}
	index := rng.intAt
	if index >= len(rng.ints) {
		index = len(rng.ints) - 1
	}
	rng.intAt += 1
	return rng.ints[index]
}

func TestGetGuaranteedRarityUsesHighestTierFirst(t *testing.T) {
	rules := DefaultRules()
	state := DefaultUserState(1)
	state.PityRare = 10
	state.PityEpic = 50
	state.PityLegendary = 100
	state.PityLegendaryRare = 199

	rarity, ok := GetGuaranteedRarity(state, rules)
	if !ok || rarity != RarityLegendary {
		t.Fatalf("expected legendary guarantee, got %q %v", rarity, ok)
	}

	state.PityLegendaryRare = 200
	rarity, ok = GetGuaranteedRarity(state, rules)
	if !ok || rarity != RarityLegendaryRare {
		t.Fatalf("expected legendary_rare guarantee, got %q %v", rarity, ok)
	}
}

func TestApplyDrawsSelectsByProbabilityAndUpdatesState(t *testing.T) {
	state := DefaultUserState(1)
	state.DrawsAvailable = 2
	now := time.UnixMilli(1700000000000).UTC()

	outcome, err := ApplyDraws(state, DefaultRules(), testCatalog(), 1, &fixedRandom{
		floats: []float64{0.99},
		ints:   []int{0},
	}, now)
	if err != nil {
		t.Fatalf("apply draws failed: %v", err)
	}

	if len(outcome.Results) != 1 || outcome.Results[0].Card.ID != "common-1" {
		t.Fatalf("unexpected draw results: %+v", outcome.Results)
	}
	if outcome.State.DrawsAvailable != 1 || outcome.State.PityRare != 1 || outcome.State.PityEpic != 1 ||
		outcome.State.PityLegendary != 1 || outcome.State.PityLegendaryRare != 1 {
		t.Fatalf("unexpected state after common draw: %+v", outcome.State)
	}
	if len(outcome.State.RecentDraws) != 1 || outcome.State.RecentDraws[0].Timestamp != now.UnixMilli() {
		t.Fatalf("unexpected recent draws: %#v", outcome.State.RecentDraws)
	}
}

func TestApplyDrawsTriggersRarePityAndResetsRareCounter(t *testing.T) {
	state := DefaultUserState(1)
	state.PityRare = 9

	outcome, err := ApplyDraws(state, DefaultRules(), testCatalog(), 1, &fixedRandom{ints: []int{0}}, time.UnixMilli(1))
	if err != nil {
		t.Fatalf("apply draws failed: %v", err)
	}

	if outcome.Results[0].Card.Rarity != RarityRare {
		t.Fatalf("expected rare pity card, got %+v", outcome.Results[0].Card)
	}
	if outcome.State.PityRare != 0 || outcome.State.PityEpic != 1 || outcome.State.PityLegendary != 1 ||
		outcome.State.PityLegendaryRare != 1 {
		t.Fatalf("unexpected pity counters after rare draw: %+v", outcome.State)
	}
}

func TestApplyDrawsTriggersLegendaryRarePityAndResetsAllCounters(t *testing.T) {
	state := DefaultUserState(1)
	state.PityRare = 99
	state.PityEpic = 99
	state.PityLegendary = 99
	state.PityLegendaryRare = 199

	outcome, err := ApplyDraws(state, DefaultRules(), testCatalog(), 1, &fixedRandom{ints: []int{0}}, time.UnixMilli(1))
	if err != nil {
		t.Fatalf("apply draws failed: %v", err)
	}

	if outcome.Results[0].Card.Rarity != RarityLegendaryRare {
		t.Fatalf("expected legendary_rare pity card, got %+v", outcome.Results[0].Card)
	}
	if outcome.State.PityRare != 0 || outcome.State.PityEpic != 0 || outcome.State.PityLegendary != 0 ||
		outcome.State.PityLegendaryRare != 0 {
		t.Fatalf("unexpected pity counters after legendary_rare draw: %+v", outcome.State)
	}
}

func TestApplyDrawsConvertsDuplicateToFragmentsAndKeepsRecentLimit(t *testing.T) {
	state := DefaultUserState(1)
	state.Inventory = []string{"common-1"}
	state.RecentDraws = make([]RecentDraw, 0, RecentDrawsLimit)
	for index := 0; index < RecentDrawsLimit; index += 1 {
		state.RecentDraws = append(state.RecentDraws, RecentDraw{
			CardID:    "old",
			Rarity:    RarityCommon,
			Timestamp: int64(100 - index),
		})
	}

	outcome, err := ApplyDraws(state, DefaultRules(), testCatalog(), 1, &fixedRandom{
		floats: []float64{0.99},
		ints:   []int{0},
	}, time.UnixMilli(200))
	if err != nil {
		t.Fatalf("apply draws failed: %v", err)
	}

	result := outcome.Results[0]
	if !result.IsDuplicate || result.FragmentsAdded != DefaultRules().FragmentValues[RarityCommon] {
		t.Fatalf("unexpected duplicate result: %+v", result)
	}
	if outcome.State.Fragments != DefaultRules().FragmentValues[RarityCommon] || len(outcome.State.Inventory) != 1 {
		t.Fatalf("unexpected duplicate state: %+v", outcome.State)
	}
	if len(outcome.State.RecentDraws) != RecentDrawsLimit || outcome.State.RecentDraws[0].Timestamp != 200 {
		t.Fatalf("unexpected recent draw limit/order: %#v", outcome.State.RecentDraws)
	}
}

func TestApplyDrawsRejectsInvalidOrInsufficientInput(t *testing.T) {
	_, err := ApplyDraws(DefaultUserState(1), DefaultRules(), testCatalog(), 0, &fixedRandom{}, time.Now())
	if !errors.Is(err, ErrInvalidDrawCount) {
		t.Fatalf("expected invalid count, got %v", err)
	}

	state := DefaultUserState(1)
	state.DrawsAvailable = 1
	_, err = ApplyDraws(state, DefaultRules(), testCatalog(), 2, &fixedRandom{}, time.Now())
	if !errors.Is(err, ErrInsufficientDraws) {
		t.Fatalf("expected insufficient draws, got %v", err)
	}

	_, err = ApplyDraws(state, DefaultRules(), nil, 1, &fixedRandom{}, time.Now())
	if !errors.Is(err, ErrEmptyCardCatalog) {
		t.Fatalf("expected empty catalog, got %v", err)
	}
}

func TestApplyFragmentExchangeUpdatesInventoryAndFragments(t *testing.T) {
	state := DefaultUserState(1)
	state.Fragments = 100

	outcome, err := ApplyFragmentExchange(state, DefaultRules(), testCatalog(), "rare-1")
	if err != nil {
		t.Fatalf("exchange failed: %v", err)
	}
	if !outcome.Success || outcome.FragmentsCost != DefaultRules().ExchangePrices[RarityRare] {
		t.Fatalf("unexpected exchange outcome: %+v", outcome)
	}
	if outcome.State.Fragments != 20 || len(outcome.State.Inventory) != 1 || outcome.State.Inventory[0] != "rare-1" {
		t.Fatalf("unexpected state after exchange: %+v", outcome.State)
	}
}

func TestApplyFragmentExchangeRejectsInvalidOwnedAndInsufficient(t *testing.T) {
	invalid, err := ApplyFragmentExchange(DefaultUserState(1), DefaultRules(), testCatalog(), "invalid-card")
	if err != nil {
		t.Fatalf("invalid exchange should be business failure, got error: %v", err)
	}
	if invalid.Success || invalid.Message != "无效的卡片 ID" {
		t.Fatalf("unexpected invalid card result: %+v", invalid)
	}

	ownedState := DefaultUserState(1)
	ownedState.Inventory = []string{"rare-1"}
	ownedState.Fragments = 100
	owned, err := ApplyFragmentExchange(ownedState, DefaultRules(), testCatalog(), "rare-1")
	if err != nil {
		t.Fatalf("owned exchange should be business failure, got error: %v", err)
	}
	if owned.Success || owned.Message != "已拥有该卡片，无需兑换" || owned.State.Fragments != 100 {
		t.Fatalf("unexpected owned card result: %+v", owned)
	}

	insufficientState := DefaultUserState(1)
	insufficientState.Fragments = 79
	insufficient, err := ApplyFragmentExchange(insufficientState, DefaultRules(), testCatalog(), "rare-1")
	if err != nil {
		t.Fatalf("insufficient exchange should be business failure, got error: %v", err)
	}
	if insufficient.Success || insufficient.Message != "碎片不足" || insufficient.State.Fragments != 79 {
		t.Fatalf("unexpected insufficient result: %+v", insufficient)
	}
}

func TestApplyRewardClaimUpdatesCollectionRewards(t *testing.T) {
	state := DefaultUserState(1)
	state.Inventory = []string{"common-1"}

	outcome, err := ApplyRewardClaim(state, testCatalog(), RewardClaimInput{
		AlbumID:       "album-1",
		RewardType:    RewardType(RarityCommon),
		PointsAwarded: 400,
	})
	if err != nil {
		t.Fatalf("claim reward failed: %v", err)
	}
	if !outcome.Success || outcome.RewardKey != "album:album-1:common" || outcome.PointsAwarded != 400 {
		t.Fatalf("unexpected reward outcome: %+v", outcome)
	}
	if len(outcome.State.CollectionRewards) != 1 || outcome.State.CollectionRewards[0] != "album:album-1:common" {
		t.Fatalf("unexpected collection rewards: %#v", outcome.State.CollectionRewards)
	}
}

func TestApplyRewardClaimRejectsDuplicateMissingAndInvalidConfig(t *testing.T) {
	claimedState := DefaultUserState(1)
	claimedState.Inventory = []string{"common-1"}
	claimedState.CollectionRewards = []string{"album:album-1:common"}
	duplicate, err := ApplyRewardClaim(claimedState, testCatalog(), RewardClaimInput{
		AlbumID:       "album-1",
		RewardType:    RewardType(RarityCommon),
		PointsAwarded: 400,
	})
	if err != nil {
		t.Fatalf("duplicate claim should be business failure, got error: %v", err)
	}
	if duplicate.Success || duplicate.Message != "该奖励已领取" {
		t.Fatalf("unexpected duplicate claim: %+v", duplicate)
	}

	missing, err := ApplyRewardClaim(DefaultUserState(1), testCatalog(), RewardClaimInput{
		AlbumID:       "album-1",
		RewardType:    RewardType(RarityRare),
		PointsAwarded: 650,
	})
	if err != nil {
		t.Fatalf("missing claim should be business failure, got error: %v", err)
	}
	if missing.Success || missing.Message != "尚未集齐该系列卡牌" {
		t.Fatalf("unexpected missing claim: %+v", missing)
	}

	invalidPoints, err := ApplyRewardClaim(claimedState, testCatalog(), RewardClaimInput{
		AlbumID:       "album-1",
		RewardType:    RewardType(RarityCommon),
		PointsAwarded: 0,
	})
	if err != nil {
		t.Fatalf("invalid points should be business failure, got error: %v", err)
	}
	if invalidPoints.Success || invalidPoints.Message != "奖励积分配置异常" {
		t.Fatalf("unexpected invalid points claim: %+v", invalidPoints)
	}
}

func testCatalog() []Card {
	return []Card{
		{ID: "common-1", Rarity: RarityCommon, AlbumID: "album-1"},
		{ID: "rare-1", Rarity: RarityRare, AlbumID: "album-1"},
		{ID: "epic-1", Rarity: RarityEpic, AlbumID: "album-1"},
		{ID: "legendary-1", Rarity: RarityLegendary, AlbumID: "album-1"},
		{ID: "legendary-rare-1", Rarity: RarityLegendaryRare, AlbumID: "album-1"},
	}
}
