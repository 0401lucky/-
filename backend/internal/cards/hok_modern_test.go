package cards

import (
	"testing"
	"time"
)

func TestHokModernRewardsMatchAlbumConfiguration(t *testing.T) {
	expected := map[RewardType]int64{
		RewardType(RarityCommon):        800,
		RewardType(RarityRare):          1400,
		RewardType(RarityEpic):          2400,
		RewardType(RarityLegendary):     4000,
		RewardType(RarityLegendaryRare): 7000,
		RewardFullSet:                   22000,
	}
	if !AlbumExists(hokModernAlbumID) || AlbumName(hokModernAlbumID) != "王者荣耀现代图鉴" {
		t.Fatal("HOK modern album is missing")
	}
	for rewardType, expectedPoints := range expected {
		points, ok := RewardPoints(hokModernAlbumID, rewardType)
		if !ok || points != expectedPoints {
			t.Fatalf("unexpected %s reward: %d, available=%v", rewardType, points, ok)
		}
	}
}

func TestHokModernCardsCanBeDrawnFromGlobalPool(t *testing.T) {
	state := DefaultUserState(1)
	state.DrawsAvailable = 1
	outcome, err := ApplyDraws(state, DefaultRules(), AllCards(), 1, &fixedRandom{
		floats: []float64{0},
		ints:   []int{12}, // Twelve highest-rarity cards precede this album.
	}, time.UnixMilli(1))
	if err != nil {
		t.Fatalf("draw HOK card failed: %v", err)
	}
	if len(outcome.Results) != 1 || outcome.Results[0].Card.ID != "hok-modern-s1-legendary_rare-甄姬" {
		t.Fatalf("unexpected HOK draw: %+v", outcome.Results)
	}
	card := outcome.Results[0].Card
	if card.Image != "/images-optimized/large/王者现代/传说稀有/甄姬.webp" ||
		card.ThumbnailImage != "/images-optimized/thumb/王者现代/传说稀有/甄姬.webp" {
		t.Fatalf("unexpected HOK draw assets: %+v", card)
	}
}

func TestHokModernXiShiCanBeExchanged(t *testing.T) {
	state := DefaultUserState(1)
	state.Fragments = DefaultRules().ExchangePrices[RarityLegendaryRare]
	outcome, err := ApplyFragmentExchange(state, DefaultRules(), AllCards(), "hok-modern-s1-legendary_rare-西施")
	if err != nil || !outcome.Success || outcome.Card.Name != "西施" || outcome.State.Fragments != 0 {
		t.Fatalf("unexpected Xi Shi exchange: %+v, error=%v", outcome, err)
	}
	if len(outcome.State.Inventory) != 1 || outcome.State.Inventory[0] != "hok-modern-s1-legendary_rare-西施" {
		t.Fatalf("Xi Shi was not added to inventory: %+v", outcome.State)
	}
}

func TestHokModernFullSetRequiresEveryHeroAndCanOnlyBeClaimedOnce(t *testing.T) {
	state := DefaultUserState(1)
	for _, card := range CardsByAlbum(hokModernAlbumID) {
		state.Inventory = append(state.Inventory, card.ID)
	}
	if len(state.Inventory) != 128 {
		t.Fatalf("expected 128 HOK heroes, got %d", len(state.Inventory))
	}
	input := RewardClaimInput{AlbumID: hokModernAlbumID, RewardType: RewardFullSet, PointsAwarded: 22000}
	missing := DefaultUserState(1)
	missing.Inventory = append(append([]string{}, state.Inventory[:127]...), state.Inventory[0])
	incomplete, err := ApplyRewardClaim(missing, AllCards(), input)
	if err != nil || incomplete.Success {
		t.Fatalf("a repeated hero must not replace a missing hero: %+v, error=%v", incomplete, err)
	}
	complete, err := ApplyRewardClaim(state, AllCards(), input)
	if err != nil || !complete.Success || complete.PointsAwarded != 22000 ||
		complete.RewardKey != "album:hok-modern-s1:full_set" {
		t.Fatalf("unexpected HOK full-set claim: %+v, error=%v", complete, err)
	}
	duplicate, err := ApplyRewardClaim(complete.State, AllCards(), input)
	if err != nil || duplicate.Success {
		t.Fatalf("HOK full-set reward must only be claimed once: %+v, error=%v", duplicate, err)
	}
}
