package cards

import (
	"errors"
	"reflect"
	"testing"
	"time"
)

func openTestPool() LimitedPoolSettings {
	return LimitedPoolSettings{
		Enabled: true, AlbumID: hokModernAlbumID, DrawCost: 2,
		StartsAt: 1700000000000, EndsAt: 1702592000000,
	}
}

func TestLimitedPoolDrawsChargePerCardAndOnlySelectSpecifiedAlbum(t *testing.T) {
	for _, count := range []int{1, 5, 10} {
		state := DefaultUserState(1)
		state.DrawsAvailable = 100
		rules := DefaultRules()
		rules.LimitedPool = openTestPool()
		// 本例只验证按卡牌计数，避免稀有保底抽到高档卡后重置计数。
		rules.PityThresholds[RarityRare] = 100
		outcome, err := ApplyPoolDraws(state, rules, AllCards(), DrawPoolLimited, count,
			&fixedRandom{floats: []float64{0.99}}, time.UnixMilli(rules.LimitedPool.StartsAt))
		if err != nil {
			t.Fatalf("draw %d failed: %v", count, err)
		}
		if len(outcome.Results) != count || outcome.DrawsConsumed != int64(count)*2 || outcome.State.DrawsAvailable != 100-int64(count)*2 {
			t.Fatalf("incorrect limited pool cost: %+v", outcome)
		}
		for _, result := range outcome.Results {
			if result.Card.AlbumID != hokModernAlbumID {
				t.Fatalf("limited pool returned another album: %+v", result.Card)
			}
		}
		if outcome.State.PityEpic != int64(count) {
			t.Fatalf("pity must count cards, not consumed draws: %+v", outcome.State)
		}
		if state.DrawsAvailable != 100 || len(state.Inventory) != 0 {
			t.Fatal("draw should not mutate the input state")
		}
	}
}

func TestStandardPoolExcludesLimitedAlbumEvenWhenClosed(t *testing.T) {
	for _, enabled := range []bool{true, false} {
		for _, poolID := range []string{"", DrawPoolStandard} {
			state := DefaultUserState(1)
			rules := DefaultRules()
			rules.LimitedPool = openTestPool()
			rules.LimitedPool.Enabled = enabled
			outcome, err := ApplyPoolDraws(state, rules, AllCards(), poolID, 1,
				&fixedRandom{floats: []float64{0.99}, ints: []int{9999}}, time.UnixMilli(rules.LimitedPool.EndsAt))
			if err != nil || len(outcome.Results) != 1 || outcome.Results[0].Card.AlbumID == hokModernAlbumID || outcome.DrawsConsumed != 1 || outcome.State.DrawsAvailable != 0 {
				t.Fatalf("standard pool must charge 1 and exclude limited cards: %+v, error=%v", outcome, err)
			}
		}
	}
}

func TestLimitedPoolRejectsInsufficientBalanceBeforeDrawing(t *testing.T) {
	state := DefaultUserState(1)
	state.DrawsAvailable = 9
	state.Inventory = []string{"animal-s1-common-仓鼠"}
	state.CollectionRewards = []string{"album:animal-s1:common"}
	state.RecentDraws = []RecentDraw{{CardID: "animal-s1-common-仓鼠", Rarity: RarityCommon, Timestamp: 1}}
	rules := DefaultRules()
	rules.LimitedPool = openTestPool()
	rng := &fixedRandom{}
	before := cloneUserState(state)
	_, err := ApplyPoolDraws(state, rules, AllCards(), DrawPoolLimited, 5, rng, time.UnixMilli(rules.LimitedPool.StartsAt))
	if !errors.Is(err, ErrInsufficientDraws) || rng.floatAt != 0 || rng.intAt != 0 || !reflect.DeepEqual(state, before) {
		t.Fatalf("insufficient balance must not draw or mutate state: state=%+v, error=%v", state, err)
	}
}

func TestLimitedPoolOpeningWindowIncludesStartAndExcludesEnd(t *testing.T) {
	rules := DefaultRules()
	rules.LimitedPool = openTestPool()
	for _, test := range []struct {
		name string
		now  int64
		open bool
	}{
		{"before start", rules.LimitedPool.StartsAt - 1, false},
		{"at start", rules.LimitedPool.StartsAt, true},
		{"before end", rules.LimitedPool.EndsAt - 1, true},
		{"at end", rules.LimitedPool.EndsAt, false},
		{"after end", rules.LimitedPool.EndsAt + 1, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			state := DefaultUserState(1)
			state.DrawsAvailable = 2
			_, err := ApplyPoolDraws(state, rules, AllCards(), DrawPoolLimited, 1, &fixedRandom{}, time.UnixMilli(test.now))
			if test.open && err != nil || !test.open && !errors.Is(err, ErrDrawPoolUnavailable) {
				t.Fatalf("unexpected opening boundary: %v", err)
			}
		})
	}
}

func TestLimitedPoolUsesConfiguredAlbumAndCost(t *testing.T) {
	rules := DefaultRules()
	rules.LimitedPool = openTestPool()
	rules.LimitedPool.AlbumID = "tarot"
	rules.LimitedPool.DrawCost = 3
	state := DefaultUserState(1)
	state.DrawsAvailable = 15
	outcome, err := ApplyPoolDraws(state, rules, AllCards(), DrawPoolLimited, 5,
		&fixedRandom{floats: []float64{0.99}}, time.UnixMilli(rules.LimitedPool.StartsAt))
	if err != nil || outcome.DrawsConsumed != 15 || outcome.State.DrawsAvailable != 0 {
		t.Fatalf("configured draw cost was not used: %+v, error=%v", outcome, err)
	}
	for _, result := range outcome.Results {
		if result.Card.AlbumID != "tarot" {
			t.Fatalf("configured album was not used: %+v", result.Card)
		}
	}
	state.DrawsAvailable = 1
	standard, err := ApplyPoolDraws(state, rules, AllCards(), DrawPoolStandard, 1,
		&fixedRandom{floats: []float64{0.99}, ints: []int{9999}}, time.UnixMilli(rules.LimitedPool.StartsAt))
	if err != nil || standard.Results[0].Card.AlbumID != hokModernAlbumID {
		t.Fatalf("previous limited album should return to standard pool when another is selected: %+v, error=%v", standard, err)
	}
}

func TestLimitedPoolRejectsDisabledInvalidAndUnknownPools(t *testing.T) {
	state := DefaultUserState(1)
	state.DrawsAvailable = 100
	rules := DefaultRules()
	rules.LimitedPool = openTestPool()
	_, err := ApplyPoolDraws(state, rules, AllCards(), "unknown", 1, &fixedRandom{}, time.UnixMilli(rules.LimitedPool.StartsAt))
	if !errors.Is(err, ErrInvalidDrawPool) {
		t.Fatalf("unknown pool must be rejected: %v", err)
	}
	for _, patch := range []func(*LimitedPoolSettings){
		func(pool *LimitedPoolSettings) { pool.Enabled = false },
		func(pool *LimitedPoolSettings) { pool.DrawCost = 0 },
		func(pool *LimitedPoolSettings) { pool.DrawCost = -1 },
		func(pool *LimitedPoolSettings) { pool.DrawCost = 101 },
		func(pool *LimitedPoolSettings) { pool.AlbumID = "unknown" },
		func(pool *LimitedPoolSettings) { pool.EndsAt = pool.StartsAt },
	} {
		rules.LimitedPool = openTestPool()
		patch(&rules.LimitedPool)
		_, err := ApplyPoolDraws(state, rules, AllCards(), DrawPoolLimited, 1, &fixedRandom{}, time.UnixMilli(1700000000000))
		if !errors.Is(err, ErrDrawPoolUnavailable) {
			t.Fatalf("invalid or closed pool must not draw: %+v, error=%v", rules.LimitedPool, err)
		}
	}
}

func TestDecodeLimitedPoolDoesNotOpenMissingOrCorruptConfiguration(t *testing.T) {
	for _, raw := range []string{"", "null", "{}", `{"enabled":true}`, `{"enabled":true,"drawCost":0}`} {
		pool := decodeLimitedPool([]byte(raw))
		if pool.Enabled || pool.AlbumID != hokModernAlbumID || pool.DrawCost != 2 {
			t.Fatalf("bad configuration should keep default pool closed: %+v", pool)
		}
	}
}
