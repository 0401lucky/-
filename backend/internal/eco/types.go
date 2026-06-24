package eco

const (
	BaseSpawnPerMin      = int64(10)
	BaseStorageCap       = int64(80)
	BasePointMultiplier  = int64(1)
	BaseGrabSize         = int64(1)
	OfflineAutoCapMinute = int64(60)
	PointDivisor         = int64(10)
	MaxDragsPerRequest   = int64(200)
	SourceGamePlay       = "game_play"
)

var (
	PrizeKeys       = []string{"diamond", "coin", "necklace", "trophy", "photo"}
	UpgradeKeys     = []string{"spawn", "storage", "value", "auto"}
	ItemKeys        = []string{"clear_truck", "lucky_flashlight", "recycle_glove"}
	AutoRateByLevel = []int64{0, 1, 3, 5, 7, 10, 14}
)

type StateSnapshot struct {
	Exists                    bool
	UserID                    int64
	Pending                   int64
	SpawnLeftoverMs           int64
	AutoLeftoverMs            int64
	PointBuffer               int64
	LuckyGenerationsRemaining int64
	GloveUsesRemaining        int64
	DailyTrashDate            string
	DailyTrashPoints          int64
	Exp                       int64
	LifetimeCleared           int64
	LifetimePoints            int64
	PointsSnapshot            int64
	LastTickAtMs              int64
	CreatedAtMs               int64
	UpdatedAtMs               int64
	Upgrades                  map[string]int64
	PrizeInventory            map[string]PrizeInventory
	PrizeLots                 []PrizeLot
	VisiblePrizes             []VisiblePrize
	ItemPurchases             []ItemPurchase
}

type PrizeInventory struct {
	InventoryCount     int64
	LimitedCount       int64
	LifetimeClaimCount int64
}

type PrizeLot struct {
	ID                       string
	PrizeKey                 string
	AcquiredAtMs             int64
	AvailableAtMs            int64
	Limited                  bool
	Source                   string
	PublicEntryID            *string
	PubliclyListedAtMs       *int64
	MerchantAvailableAtMs    *int64
	StolenFromUserID         *int64
	StolenAtMs               *int64
	TheftID                  *string
	BlackMarketAvailableAtMs *int64
}

type VisiblePrize struct {
	ID          string
	PrizeKey    string
	CreatedAtMs int64
	Limited     bool
}

type ItemPurchase struct {
	ItemKey       string
	PurchaseDate  string
	PurchaseCount int64
}

type TickResult struct {
	Spawned         int64
	AcceptedSpawned int64
	TrashSpawned    int64
	PrizeKeys       []string
	AutoCollected   int64
	ElapsedMs       int64
}

type CollectInput struct {
	UserID int64
	Drags  int64
	NowMs  int64
}

type CollectResult struct {
	Cleared       int64
	PointsEarned  int64
	Balance       int64
	Pending       int64
	PointBuffer   int64
	GloveUsesLeft int64
	AutoCollected int64
}
