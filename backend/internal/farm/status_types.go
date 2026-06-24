package farm

import "encoding/json"

type Season string

const (
	SeasonSpring Season = "spring"
	SeasonSummer Season = "summer"
	SeasonAutumn Season = "autumn"
	SeasonWinter Season = "winter"
)

type Weather string

const (
	WeatherSunny     Weather = "sunny"
	WeatherCloudy    Weather = "cloudy"
	WeatherLightRain Weather = "light_rain"
	WeatherStorm     Weather = "storm"
	WeatherHot       Weather = "hot"
	WeatherWind      Weather = "wind"
	WeatherSnow      Weather = "snow"
	WeatherFog       Weather = "fog"
)

type CropID string

const (
	CropWheat      CropID = "wheat"
	CropCarrot     CropID = "carrot"
	CropLettuce    CropID = "lettuce"
	CropTomato     CropID = "tomato"
	CropPotato     CropID = "potato"
	CropStrawberry CropID = "strawberry"
	CropCorn       CropID = "corn"
	CropPumpkin    CropID = "pumpkin"
)

type LandStatus string

const (
	LandStatusLocked   LandStatus = "locked"
	LandStatusEmpty    LandStatus = "empty"
	LandStatusGrowing  LandStatus = "growing"
	LandStatusThirsty  LandStatus = "thirsty"
	LandStatusMature   LandStatus = "mature"
	LandStatusWithered LandStatus = "withered"
	LandStatusEaten    LandStatus = "eaten"
)

type CropStage string

const (
	CropStageSeed    CropStage = "seed"
	CropStageSprout  CropStage = "sprout"
	CropStageGrowing CropStage = "growing"
	CropStageMature  CropStage = "mature"
)

type Quality string

const (
	QualityNormal Quality = "normal"
	QualitySilver Quality = "silver"
	QualityGold   Quality = "gold"
)

type FarmState struct {
	UserID                int64                      `json:"userId"`
	Points                int64                      `json:"points"`
	Lands                 []LandPlot                 `json:"lands"`
	ScarecrowUntil        *int64                     `json:"scarecrowUntil"`
	BellUntil             *int64                     `json:"bellUntil"`
	Pet                   json.RawMessage            `json:"pet"`
	StolenTodayCount      int64                      `json:"stolenTodayCount"`
	StolenByMap           map[string]int64           `json:"stolenByMap"`
	MyStealMap            map[string]int64           `json:"myStealMap"`
	Inventory             json.RawMessage            `json:"inventory"`
	PurchasedSkillBooks   json.RawMessage            `json:"purchasedSkillBooks,omitempty"`
	SeedInventory         json.RawMessage            `json:"seedInventory"`
	Events                json.RawMessage            `json:"events"`
	LastDailyResetAt      int64                      `json:"lastDailyResetAt"`
	LastSeasonProcessedAt int64                      `json:"lastSeasonProcessedAt"`
	LastTickAt            int64                      `json:"lastTickAt"`
	LastFridayEventDate   string                     `json:"lastFridayEventDate,omitempty"`
	Bonuses               json.RawMessage            `json:"bonuses"`
	CreatedAt             int64                      `json:"createdAt"`
	UpdatedAt             int64                      `json:"updatedAt"`
	Extra                 map[string]json.RawMessage `json:"-"`
}

type LandPlot struct {
	Index  int                        `json:"index"`
	Status LandStatus                 `json:"status"`
	Crop   *CropInstance              `json:"crop"`
	Extra  map[string]json.RawMessage `json:"-"`
}

type CropInstance struct {
	CropID              CropID                     `json:"cropId"`
	PlantedAt           int64                      `json:"plantedAt"`
	MatureAt            int64                      `json:"matureAt"`
	LastWaterAt         int64                      `json:"lastWaterAt"`
	NextWaterDueAt      int64                      `json:"nextWaterDueAt"`
	WaterMissCount      int64                      `json:"waterMissCount"`
	Fertilizer          *string                    `json:"fertilizer"`
	PlantedSeason       Season                     `json:"plantedSeason"`
	WeatherAtPlant      Weather                    `json:"weatherAtPlant"`
	BirdNetUntil        *int64                     `json:"birdNetUntil"`
	StolenAmount        int64                      `json:"stolenAmount"`
	StolenCount         int64                      `json:"stolenCount"`
	SpeedUsed           int64                      `json:"speedUsed"`
	SpeedReducedMinutes int64                      `json:"speedReducedMinutes"`
	Extra               map[string]json.RawMessage `json:"-"`
}

type ComputedLand struct {
	Index                int           `json:"index"`
	Status               LandStatus    `json:"status"`
	Crop                 *CropInstance `json:"crop"`
	Stage                *CropStage    `json:"stage"`
	GrowthProgress       float64       `json:"growthProgress"`
	RemainingMs          int64         `json:"remainingMs"`
	NextWaterRemainingMs int64         `json:"nextWaterRemainingMs"`
	OverripeFactor       float64       `json:"overripeFactor"`
	ExpectedQualityHint  *Quality      `json:"expectedQualityHint"`
	ScarecrowActive      bool          `json:"scarecrowActive"`
	BellActive           bool          `json:"bellActive"`
	NetActive            bool          `json:"netActive"`
}

type WorldState struct {
	Date        string  `json:"date"`
	Weather     Weather `json:"weather"`
	Season      Season  `json:"season"`
	GeneratedAt int64   `json:"generatedAt"`
}

type WeatherForecast struct {
	Tomorrow WorldState `json:"tomorrow"`
}

type StatusResponse struct {
	State              FarmState        `json:"state"`
	ComputedLands      []ComputedLand   `json:"computedLands"`
	World              WorldState       `json:"world"`
	WeatherForecast    WeatherForecast  `json:"weatherForecast"`
	ShopDailyPurchases map[string]int64 `json:"shopDailyPurchases"`
	ServerNow          int64            `json:"serverNow"`
	PlantableCrops     []CropID         `json:"plantableCrops"`
	NextSeasonInMs     int64            `json:"nextSeasonInMs"`
	NextDailyInMs      int64            `json:"nextDailyInMs"`
}

type StealCandidate struct {
	UserID    int64   `json:"userId"`
	Nickname  string  `json:"nickname"`
	AvatarURL *string `json:"avatarUrl"`
}
