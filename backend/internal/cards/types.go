package cards

import "time"

type Rarity string

const (
	RarityCommon        Rarity = "common"
	RarityRare          Rarity = "rare"
	RarityEpic          Rarity = "epic"
	RarityLegendary     Rarity = "legendary"
	RarityLegendaryRare Rarity = "legendary_rare"
)

type RecentDraw struct {
	CardID         string `json:"cardId"`
	Rarity         Rarity `json:"rarity"`
	IsDuplicate    bool   `json:"isDuplicate"`
	FragmentsAdded int64  `json:"fragmentsAdded"`
	Timestamp      int64  `json:"timestamp"`
}

type RewardType string

const (
	RewardFullSet RewardType = "full_set"
)

type UserState struct {
	UserID            int64
	Exists            bool
	Inventory         []string
	Fragments         int64
	PityRare          int64
	PityEpic          int64
	PityLegendary     int64
	PityLegendaryRare int64
	DrawsAvailable    int64
	CollectionRewards []string
	RecentDraws       []RecentDraw
	RawState          map[string]any
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type Rules struct {
	ID                  string
	RarityProbabilities map[Rarity]float64
	PityThresholds      map[Rarity]int64
	CardDrawPrice       int64
	FragmentValues      map[Rarity]int64
	ExchangePrices      map[Rarity]int64
	UpdatedAtMs         int64
}

func DefaultUserState(userID int64) UserState {
	return UserState{
		UserID:            userID,
		Inventory:         []string{},
		Fragments:         0,
		PityRare:          0,
		PityEpic:          0,
		PityLegendary:     0,
		PityLegendaryRare: 0,
		DrawsAvailable:    1,
		CollectionRewards: []string{},
		RecentDraws:       []RecentDraw{},
		RawState:          map[string]any{},
	}
}

func DefaultRules() Rules {
	return Rules{
		ID: "default",
		RarityProbabilities: map[Rarity]float64{
			RarityLegendaryRare: 0.5,
			RarityLegendary:     2,
			RarityEpic:          7,
			RarityRare:          25,
			RarityCommon:        65.5,
		},
		PityThresholds: map[Rarity]int64{
			RarityRare:          10,
			RarityEpic:          50,
			RarityLegendary:     100,
			RarityLegendaryRare: 200,
		},
		CardDrawPrice: 900,
		FragmentValues: map[Rarity]int64{
			RarityCommon:        9,
			RarityRare:          14,
			RarityEpic:          26,
			RarityLegendary:     50,
			RarityLegendaryRare: 100,
		},
		ExchangePrices: map[Rarity]int64{
			RarityCommon:        30,
			RarityRare:          80,
			RarityEpic:          200,
			RarityLegendary:     500,
			RarityLegendaryRare: 1000,
		},
		UpdatedAtMs: 0,
	}
}
