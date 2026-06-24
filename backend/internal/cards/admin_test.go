package cards

import (
	"context"
	"errors"
	"testing"
)

func TestAdminServiceReturnsUnavailableWithoutDatabase(t *testing.T) {
	service := NewAdminService(nil)
	if _, err := service.ListUsers(context.Background(), AdminUserListInput{}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable from ListUsers, got %v", err)
	}
	if _, err := service.GetUserDetail(context.Background(), 1); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable from GetUserDetail, got %v", err)
	}
	if _, err := service.GetRules(context.Background()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable from GetRules, got %v", err)
	}
	if _, err := service.GetRewardConfig(context.Background()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable from GetRewardConfig, got %v", err)
	}
	if err := service.ResetUserProgress(context.Background(), 1); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable from ResetUserProgress, got %v", err)
	}
	if _, err := service.UpdateRules(context.Background(), AdminRulesUpdateInput{}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable from UpdateRules, got %v", err)
	}
	if _, err := service.UpdateReward(context.Background(), AdminRewardUpdateInput{AlbumID: "animal-s1"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable from UpdateReward, got %v", err)
	}
}

func TestNormalizeAdminListPagination(t *testing.T) {
	page, limit := normalizeAdminListPagination(-1, 0)
	if page != 1 || limit != defaultAdminCardUserListLimit {
		t.Fatalf("unexpected default pagination: page=%d limit=%d", page, limit)
	}

	page, limit = normalizeAdminListPagination(3, maxAdminCardUserListLimit+20)
	if page != 3 || limit != maxAdminCardUserListLimit {
		t.Fatalf("unexpected capped pagination: page=%d limit=%d", page, limit)
	}
}

func TestBuildAdminRewardConfigUsesDefaultsAndOverrides(t *testing.T) {
	config := buildAdminRewardConfig(
		map[string]int64{"animal-s1": 123, "unknown": 999},
		map[RewardType]int64{
			RewardType(RarityCommon): 5,
			RewardFullSet:            777,
		},
	)

	if len(config.Albums) != 3 || config.Albums[0].ID != "animal-s1" {
		t.Fatalf("unexpected albums: %#v", config.Albums)
	}
	if config.Albums[0].DefaultReward != 100 || config.Albums[0].CurrentReward != 123 {
		t.Fatalf("unexpected animal-s1 rewards: %+v", config.Albums[0])
	}
	if config.Albums[1].CurrentReward != config.Albums[1].DefaultReward {
		t.Fatalf("animal-s2 should use default reward: %+v", config.Albums[1])
	}

	if len(config.Tiers) != 5 {
		t.Fatalf("admin page only expects five visible tiers, got %#v", config.Tiers)
	}
	if config.Tiers[0].ID != RewardType(RarityCommon) || config.Tiers[0].DefaultReward != 400 || config.Tiers[0].CurrentReward != 5 {
		t.Fatalf("unexpected common tier reward: %+v", config.Tiers[0])
	}
}

func TestValidateAdminRulesRejectsInvalidProbabilityTotal(t *testing.T) {
	rules := DefaultRules()
	rules.RarityProbabilities[RarityCommon] = 1
	if err := validateAdminRules(rules); !errors.Is(err, ErrInvalidAdminCardInput) {
		t.Fatalf("expected invalid admin card input, got %v", err)
	}
}
