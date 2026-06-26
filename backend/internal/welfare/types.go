package welfare

import "encoding/json"

type Project struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	MaxClaims    int64  `json:"maxClaims"`
	ClaimedCount int64  `json:"claimedCount"`
	CodesCount   int64  `json:"codesCount"`
	Status       string `json:"status"`
	CreatedAt    int64  `json:"createdAt"`
	CreatedBy    string `json:"createdBy"`
	RewardType   string `json:"rewardType,omitempty"`
	DirectPoints *int64 `json:"directPoints,omitempty"`
	NewUserOnly  bool   `json:"newUserOnly,omitempty"`
	Pinned       bool   `json:"pinned,omitempty"`
	PinnedAt     *int64 `json:"pinnedAt,omitempty"`
	AutoPauseAt  *int64 `json:"autoPauseAt,omitempty"`
	AutoPausedAt *int64 `json:"autoPausedAt,omitempty"`
}

type AdminProjectRecord struct {
	ID             string `json:"id"`
	ProjectID      string `json:"projectId"`
	UserID         int64  `json:"userId"`
	Username       string `json:"username"`
	Code           string `json:"code"`
	ClaimedAt      int64  `json:"claimedAt"`
	DirectCredit   bool   `json:"directCredit,omitempty"`
	CreditedPoints *int64 `json:"creditedPoints,omitempty"`
	CreditStatus   string `json:"creditStatus,omitempty"`
	CreditMessage  string `json:"creditMessage,omitempty"`
	CreditedAt     *int64 `json:"creditedAt,omitempty"`
}

type AdminProjectDetail struct {
	Project Project              `json:"project"`
	Records []AdminProjectRecord `json:"records"`
}

type ProjectClaim struct {
	Code            string `json:"code"`
	ClaimedAt       int64  `json:"claimedAt"`
	DirectCredit    bool   `json:"directCredit,omitempty"`
	CreditedPoints  *int64 `json:"creditedPoints,omitempty"`
	CreditedDollars *int64 `json:"creditedDollars,omitempty"`
	CreditStatus    string `json:"creditStatus,omitempty"`
	CreditMessage   string `json:"creditMessage,omitempty"`
}

type PublicProjectDetail struct {
	Project Project       `json:"project"`
	Claimed *ProjectClaim `json:"claimed"`
}

type ClaimProjectResult struct {
	Success         bool   `json:"success"`
	Message         string `json:"message"`
	Code            string `json:"code,omitempty"`
	DirectCredit    bool   `json:"directCredit,omitempty"`
	CreditedPoints  *int64 `json:"creditedPoints,omitempty"`
	CreditedDollars *int64 `json:"creditedDollars,omitempty"`
	CreditStatus    string `json:"creditStatus,omitempty"`
}

type CreateAdminProjectInput struct {
	Name         string
	Description  string
	MaxClaims    int64
	DirectPoints int64
	NewUserOnly  bool
	CreatedBy    string
	AutoPauseAt  *int64
}

type UpdateAdminProjectInput struct {
	Status         *string `json:"status,omitempty"`
	Pinned         *bool   `json:"pinned,omitempty"`
	Name           *string `json:"name,omitempty"`
	Description    *string `json:"description,omitempty"`
	MaxClaims      *int64  `json:"maxClaims,omitempty"`
	MaxClaimsValid bool    `json:"-"`
}

type AutoPauseProjectsResult struct {
	Paused int64 `json:"paused"`
}

type RaffleListFilter struct {
	Status     string
	ActiveOnly bool
}

type RaffleListItem struct {
	ID                       string          `json:"id"`
	Mode                     string          `json:"mode,omitempty"`
	Title                    string          `json:"title"`
	Description              string          `json:"description"`
	CoverImage               string          `json:"coverImage,omitempty"`
	Prizes                   json.RawMessage `json:"prizes"`
	TriggerType              string          `json:"triggerType"`
	Threshold                int64           `json:"threshold"`
	Status                   string          `json:"status"`
	ParticipantsCount        int64           `json:"participantsCount"`
	WinnersCount             int64           `json:"winnersCount"`
	DrawnAt                  *int64          `json:"drawnAt,omitempty"`
	RedPacketTotalPoints     *int64          `json:"redPacketTotalPoints,omitempty"`
	RedPacketTotalSlots      *int64          `json:"redPacketTotalSlots,omitempty"`
	RedPacketRemainingPoints *int64          `json:"redPacketRemainingPoints,omitempty"`
	RedPacketRemainingSlots  *int64          `json:"redPacketRemainingSlots,omitempty"`
	CreatedAt                int64           `json:"createdAt"`
}

type RaffleDetail struct {
	RaffleListItem
	Winners json.RawMessage `json:"winners,omitempty"`
}

type AdminRaffle struct {
	RaffleListItem
	Winners          json.RawMessage `json:"winners"`
	RedPacketPackets json.RawMessage `json:"redPacketPackets,omitempty"`
	CreatedBy        int64           `json:"createdBy"`
	UpdatedAt        int64           `json:"updatedAt"`
}

type AdminRafflePrizeInput struct {
	Name     string          `json:"name"`
	Points   json.RawMessage `json:"points,omitempty"`
	Dollars  json.RawMessage `json:"dollars,omitempty"`
	Quantity int64           `json:"quantity"`
}

type CreateAdminRaffleInput struct {
	Mode                 string                  `json:"mode"`
	Title                string                  `json:"title"`
	Description          string                  `json:"description"`
	CoverImage           string                  `json:"coverImage,omitempty"`
	Prizes               []AdminRafflePrizeInput `json:"prizes,omitempty"`
	TriggerType          string                  `json:"triggerType,omitempty"`
	Threshold            int64                   `json:"threshold,omitempty"`
	RedPacketTotalPoints *int64                  `json:"redPacketTotalPoints,omitempty"`
	RedPacketTotalSlots  *int64                  `json:"redPacketTotalSlots,omitempty"`
	CreatedBy            int64                   `json:"createdBy"`
}

type UpdateAdminRaffleInput struct {
	Mode                 *string                  `json:"mode,omitempty"`
	Title                *string                  `json:"title,omitempty"`
	Description          *string                  `json:"description,omitempty"`
	CoverImage           *string                  `json:"coverImage,omitempty"`
	Prizes               *[]AdminRafflePrizeInput `json:"prizes,omitempty"`
	TriggerType          *string                  `json:"triggerType,omitempty"`
	Threshold            *int64                   `json:"threshold,omitempty"`
	RedPacketTotalPoints *int64                   `json:"redPacketTotalPoints,omitempty"`
	RedPacketTotalSlots  *int64                   `json:"redPacketTotalSlots,omitempty"`
}

type RaffleEntry struct {
	ID          string `json:"id"`
	RaffleID    string `json:"raffleId"`
	UserID      int64  `json:"userId"`
	Username    string `json:"username"`
	EntryNumber int64  `json:"entryNumber"`
	CreatedAt   int64  `json:"createdAt"`
}

type RaffleWinner struct {
	EntryID           string `json:"entryId"`
	UserID            int64  `json:"userId"`
	Username          string `json:"username"`
	PrizeID           string `json:"prizeId"`
	PrizeName         string `json:"prizeName"`
	Points            int64  `json:"points"`
	RewardStatus      string `json:"rewardStatus"`
	RewardMessage     string `json:"rewardMessage,omitempty"`
	RewardAttemptedAt int64  `json:"rewardAttemptedAt,omitempty"`
	RewardAttempts    int64  `json:"rewardAttempts,omitempty"`
	DeliveredAt       int64  `json:"deliveredAt,omitempty"`
}

type UserRaffleStatus struct {
	HasJoined bool            `json:"hasJoined"`
	Entry     *RaffleEntry    `json:"entry,omitempty"`
	IsWinner  bool            `json:"isWinner"`
	Prize     json.RawMessage `json:"prize,omitempty"`
}

type JoinRaffleResult struct {
	Success    bool          `json:"success"`
	Message    string        `json:"message"`
	Entry      *RaffleEntry  `json:"entry,omitempty"`
	Reward     *RaffleWinner `json:"reward,omitempty"`
	ShouldDraw bool          `json:"shouldDraw,omitempty"`
}

type DrawRaffleResult struct {
	Success bool           `json:"success"`
	Message string         `json:"message"`
	Winners []RaffleWinner `json:"winners,omitempty"`
}

type RaffleRewardDeliveryItem struct {
	UserID    int64  `json:"userId"`
	Username  string `json:"username"`
	PrizeName string `json:"prizeName"`
	Success   bool   `json:"success"`
	Message   string `json:"message"`
}

type DeliverRaffleRewardsResult struct {
	Success bool                       `json:"success"`
	Message string                     `json:"message"`
	Results []RaffleRewardDeliveryItem `json:"results,omitempty"`
}

type RaffleDeliveryQueueResult struct {
	Success       bool   `json:"success"`
	Message       string `json:"message"`
	ProcessedJobs int64  `json:"processedJobs"`
	Delivered     int64  `json:"delivered"`
	Failed        int64  `json:"failed"`
	Pending       int64  `json:"pending"`
	SkippedJobs   int64  `json:"skippedJobs"`
	RecoveredJobs int64  `json:"recoveredJobs"`
}

type RaffleDetailResult struct {
	Raffle     RaffleDetail      `json:"raffle"`
	Entries    []RaffleEntry     `json:"entries"`
	UserStatus *UserRaffleStatus `json:"userStatus"`
}
