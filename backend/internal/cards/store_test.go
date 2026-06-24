package cards

import (
	"context"
	"errors"
	"testing"
)

func TestStoreReturnsUnavailableWithoutDatabase(t *testing.T) {
	store := NewStore(nil)
	if _, err := store.GetUserState(context.Background(), 1); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable from GetUserState, got %v", err)
	}
	if err := store.SaveUserState(context.Background(), DefaultUserState(1)); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable from SaveUserState, got %v", err)
	}
	if _, err := store.GetRules(context.Background()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable from GetRules, got %v", err)
	}
}

func TestDefaultRulesMatchLegacyCardRules(t *testing.T) {
	rules := DefaultRules()
	if rules.CardDrawPrice != 900 {
		t.Fatalf("unexpected card draw price: %d", rules.CardDrawPrice)
	}
	if rules.RarityProbabilities[RarityCommon] != 65.5 || rules.PityThresholds[RarityLegendaryRare] != 200 {
		t.Fatalf("unexpected default rules: %+v", rules)
	}
	if rules.FragmentValues[RarityLegendaryRare] != 100 || rules.ExchangePrices[RarityLegendaryRare] != 1000 {
		t.Fatalf("unexpected default fragment/exchange rules: %+v", rules)
	}
}

func TestDefaultUserStateMatchesLegacyDefaults(t *testing.T) {
	state := DefaultUserState(1001)
	if state.UserID != 1001 || state.DrawsAvailable != 1 || state.Fragments != 0 {
		t.Fatalf("unexpected default state: %+v", state)
	}
	if len(state.Inventory) != 0 || len(state.CollectionRewards) != 0 || len(state.RecentDraws) != 0 {
		t.Fatalf("default arrays should be empty: %+v", state)
	}
}
