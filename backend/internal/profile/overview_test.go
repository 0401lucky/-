package profile

import (
	"testing"

	"redemption/backend/internal/cards"
)

func TestAutomaticAchievementsRequireTheirThresholds(t *testing.T) {
	tests := []struct {
		id        string
		threshold int64
		set       func(*OverviewData, int64)
	}{
		{"first_checkin", 1, func(d *OverviewData, n int64) { d.Gameplay.TotalCheckinDays = n }},
		{"checkin_3", 3, func(d *OverviewData, n int64) { d.AchievementStats.CheckinMaxStreak = n }},
		{"checkin_7", 7, func(d *OverviewData, n int64) { d.AchievementStats.CheckinMaxStreak = n }},
		{"checkin_30", 30, func(d *OverviewData, n int64) { d.AchievementStats.CheckinMaxStreak = n }},
		{"first_pot", 1000, func(d *OverviewData, n int64) { d.AchievementStats.PeakPointsBalance = n }},
		{"small_success", 5000, func(d *OverviewData, n int64) { d.Points.Balance = n }},
		{"tycoon", 10000, func(d *OverviewData, n int64) { d.AchievementStats.PeakPointsBalance = n }},
		{"card_beginner", 10, func(d *OverviewData, n int64) { d.Cards.Owned = n }},
		{"card_collector", 50, func(d *OverviewData, n int64) { d.Cards.Owned = n }},
		{"collection_master", 100, func(d *OverviewData, n int64) { d.Cards.CompletionRate = float64(n) }},
		{"lottery_player", 1, func(d *OverviewData, n int64) { d.AchievementStats.LotteryPlays = n }},
		{"game_king", 75, func(d *OverviewData, n int64) {
			d.AchievementStats.GameWinPlays = 100
			d.AchievementStats.GameWinRate = float64(n) / 100
		}},
		{"farm_owner", 8, func(d *OverviewData, n int64) { d.AchievementStats.FarmUnlockedLands = n }},
		{"lucky_star", 100, func(d *OverviewData, n int64) { d.AchievementStats.LotteryOrangeCount = n }},
		{"unlucky_star", 100, func(d *OverviewData, n int64) { d.AchievementStats.LotteryHeartCount = n }},
		{"eco_ambassador", 10000, func(d *OverviewData, n int64) { d.AchievementStats.EcoLifetimeCleared = n }},
		{"gold_digger", 10, func(d *OverviewData, n int64) { d.AchievementStats.EcoLifetimePrizeClaims = n }},
		{"xiaoc_fan", 5, func(d *OverviewData, n int64) { d.AchievementStats.EcoLifetimePhotoClaims = n }},
	}
	for _, tt := range tests {
		t.Run(tt.id, func(t *testing.T) {
			var overview OverviewData
			tt.set(&overview, tt.threshold-1)
			if automaticAchievementIDs(overview)[tt.id] {
				t.Fatal("achievement unlocked below its threshold")
			}
			tt.set(&overview, tt.threshold)
			if !automaticAchievementIDs(overview)[tt.id] {
				t.Fatal("achievement not unlocked at its threshold")
			}
			for _, special := range []string{"contributor", "peak_first", "thief"} {
				if automaticAchievementIDs(overview)[special] {
					t.Fatalf("special achievement %s must require an explicit grant", special)
				}
			}
		})
	}
	if ids := automaticAchievementIDs(OverviewData{}); len(ids) != 1 || !ids["beginner"] {
		t.Fatalf("new accounts should only unlock beginner: %v", ids)
	}
	if automaticAchievementIDs(OverviewData{AchievementStats: OverviewAchievementStats{GameWinRate: 1}})["game_king"] {
		t.Fatal("zero games cannot unlock game_king")
	}
}

func TestCardAchievementsCountDistinctCatalogCardsAndRequireFullCompletion(t *testing.T) {
	catalog := cards.AllCards()
	state := cards.UserState{Fragments: 17, DrawsAvailable: 3}
	for _, card := range catalog[:len(catalog)-1] {
		state.Inventory = append(state.Inventory, card.ID)
	}
	state.Inventory = append(state.Inventory, catalog[0].ID, "removed-card", "")
	summary := summarizeCards(state, catalog)
	if summary.Owned != int64(len(catalog)-1) || summary.Total != int64(len(catalog)) || summary.CompletionRate >= 100 {
		t.Fatalf("duplicate/unknown cards must not complete the collection: %+v", summary)
	}
	if automaticAchievementIDs(OverviewData{Cards: summary})["collection_master"] {
		t.Fatal("one missing card must keep collection_master locked")
	}
	if len(summary.Albums) != 4 || summary.Fragments != 17 || summary.DrawsAvailable != 3 {
		t.Fatalf("unexpected card summary: %+v", summary)
	}
	state.Inventory = append(state.Inventory, catalog[len(catalog)-1].ID)
	summary = summarizeCards(state, catalog)
	if summary.CompletionRate != 100 || !automaticAchievementIDs(OverviewData{Cards: summary})["collection_master"] {
		t.Fatalf("full collection should unlock collection_master: %+v", summary)
	}
	for _, album := range summary.Albums {
		if album.CompletionRate != 100 || album.Owned != album.Total {
			t.Fatalf("unexpected completed album: %+v", album)
		}
	}
	if empty := summarizeCards(cards.UserState{}, nil); empty.CompletionRate != 0 {
		t.Fatalf("empty catalog must not count as complete: %+v", empty)
	}
}
