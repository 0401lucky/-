package eco

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

type AdminPrizeRateView struct {
	Key         string  `json:"key"`
	Name        string  `json:"name"`
	Emoji       string  `json:"emoji"`
	ImageSrc    string  `json:"imageSrc"`
	DefaultRate float64 `json:"defaultRate"`
	CurrentRate float64 `json:"currentRate"`
	GlobalLimit int64   `json:"globalLimit"`
}

type AdminPrizeLotView struct {
	ID               string `json:"id"`
	AcquiredAt       int64  `json:"acquiredAt"`
	Source           string `json:"source"`
	StolenFromUserID *int64 `json:"stolenFromUserId"`
	StolenAt         *int64 `json:"stolenAt"`
}

type AdminPrizeHolderView struct {
	UserID        int64               `json:"userId"`
	Username      string              `json:"username"`
	DisplayName   *string             `json:"displayName"`
	AvatarURL     *string             `json:"avatarUrl"`
	LifetimeCount int64               `json:"lifetimeCount"`
	CurrentCount  int64               `json:"currentCount"`
	StolenCount   int64               `json:"stolenCount"`
	Lots          []AdminPrizeLotView `json:"lots"`
}

type AdminPrizeSummary struct {
	AdminPrizeRateView
	TotalLifetimeClaims   int64                  `json:"totalLifetimeClaims"`
	TotalCurrentInventory int64                  `json:"totalCurrentInventory"`
	HolderCount           int64                  `json:"holderCount"`
	Holders               []AdminPrizeHolderView `json:"holders"`
}

type AdminTheftView struct {
	ID                  string  `json:"id"`
	Key                 string  `json:"key"`
	PrizeName           string  `json:"prizeName"`
	PrizeEmoji          string  `json:"prizeEmoji"`
	OriginalUserID      int64   `json:"originalUserId"`
	OriginalUsername    string  `json:"originalUsername"`
	OriginalDisplayName *string `json:"originalDisplayName"`
	ThiefUserID         int64   `json:"thiefUserId"`
	ThiefUsername       string  `json:"thiefUsername"`
	ThiefDisplayName    *string `json:"thiefDisplayName"`
	Message             string  `json:"message"`
	StolenAt            int64   `json:"stolenAt"`
	ResolvedAt          *int64  `json:"resolvedAt"`
	Outcome             *string `json:"outcome"`
}

type AdminManualTrashRow struct {
	UserID      int64            `json:"userId"`
	Username    string           `json:"username"`
	DisplayName *string          `json:"displayName"`
	AvatarURL   *string          `json:"avatarUrl"`
	Total       int64            `json:"total"`
	Days        map[string]int64 `json:"days"`
}

type AdminPagination struct {
	Page       int64 `json:"page"`
	Limit      int64 `json:"limit"`
	Total      int64 `json:"total"`
	TotalPages int64 `json:"totalPages"`
	HasMore    bool  `json:"hasMore"`
}

type AdminManualTrashResult struct {
	Days       []string              `json:"days"`
	Rows       []AdminManualTrashRow `json:"rows"`
	Pagination AdminPagination       `json:"pagination"`
}

type AdminOverview struct {
	GeneratedAt int64                  `json:"generatedAt"`
	Prizes      []AdminPrizeSummary    `json:"prizes"`
	Thefts      []AdminTheftView       `json:"thefts"`
	ManualTrash AdminManualTrashResult `json:"manualTrash"`
}

type AdminOverviewInput struct {
	TrashPage  int64
	TrashLimit int64
	NowMs      int64
}

var ErrInvalidPrizeRateSettings = errors.New("invalid eco prize rate settings")

type PrizeRateInputError struct {
	Message string
}

func (err PrizeRateInputError) Error() string {
	return err.Message
}

func (err PrizeRateInputError) Is(target error) bool {
	return target == ErrInvalidPrizeRateSettings
}

type userAdminProfile struct {
	UserID      int64
	Username    string
	DisplayName *string
	AvatarURL   *string
}

type txQueryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func (service *Service) GetAdminOverview(ctx context.Context, input AdminOverviewInput) (AdminOverview, error) {
	if input.NowMs <= 0 {
		input.NowMs = nowMillis()
	}
	users, err := service.loadAdminUserProfiles(ctx)
	if err != nil {
		return AdminOverview{}, err
	}
	prizes, err := service.buildAdminPrizeSummaries(ctx, users)
	if err != nil {
		return AdminOverview{}, err
	}
	thefts, err := service.buildAdminTheftViews(ctx)
	if err != nil {
		return AdminOverview{}, err
	}
	manualTrash, err := service.buildAdminManualTrash(ctx, users, input)
	if err != nil {
		return AdminOverview{}, err
	}
	return AdminOverview{
		GeneratedAt: input.NowMs,
		Prizes:      prizes,
		Thefts:      thefts,
		ManualTrash: manualTrash,
	}, nil
}

func (service *Service) GetPrizeRateSettings(ctx context.Context) ([]AdminPrizeRateView, error) {
	rates, err := service.loadPrizeRateSettings(ctx)
	if err != nil {
		return nil, err
	}
	return buildPrizeRateViews(rates), nil
}

func (service *Service) UpdatePrizeRateSettings(ctx context.Context, patch map[string]float64) ([]AdminPrizeRateView, error) {
	if len(patch) == 0 {
		return nil, wrapPrizeRateInputError("请提交奖品概率配置")
	}
	current, err := service.loadPrizeRateSettings(ctx)
	if err != nil {
		return nil, err
	}
	next := clonePrizeRates(current)
	for _, key := range PrizeKeys {
		value, ok := patch[key]
		if !ok {
			continue
		}
		if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1 {
			return nil, wrapPrizeRateInputError(ecoPrizeDefinitions[key].Name + "概率必须在 0% 到 100% 之间")
		}
		next[key] = value
	}
	total := float64(0)
	for _, key := range PrizeKeys {
		total += next[key]
	}
	if total > 1 {
		return nil, wrapPrizeRateInputError("5 个奖品概率合计不能超过 100%")
	}

	tx, err := service.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for _, key := range PrizeKeys {
		if _, ok := patch[key]; !ok {
			continue
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO eco_prize_rate_settings (prize_key, spawn_rate, updated_at)
			 VALUES ($1, $2, now())
			 ON CONFLICT (prize_key) DO UPDATE SET
			   spawn_rate = excluded.spawn_rate,
			   updated_at = now()`,
			key,
			next[key],
		); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return buildPrizeRateViews(next), nil
}

func wrapPrizeRateInputError(message string) error {
	return PrizeRateInputError{Message: message}
}

func (service *Service) loadPrizeRateSettings(ctx context.Context) (map[string]float64, error) {
	rates := defaultPrizeRates()
	rows, err := service.db.Query(ctx, `SELECT prize_key, spawn_rate FROM eco_prize_rate_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var rate float64
		if err := rows.Scan(&key, &rate); err != nil {
			return nil, err
		}
		if isPrizeKey(key) && !math.IsNaN(rate) && !math.IsInf(rate, 0) {
			rates[key] = clamp01(rate)
		}
	}
	return rates, rows.Err()
}

func loadPrizeRateSettingsTx(ctx context.Context, tx txQueryer) (map[string]float64, error) {
	rates := defaultPrizeRates()
	rows, err := tx.Query(ctx, `SELECT prize_key, spawn_rate FROM eco_prize_rate_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var rate float64
		if err := rows.Scan(&key, &rate); err != nil {
			return nil, err
		}
		if isPrizeKey(key) && !math.IsNaN(rate) && !math.IsInf(rate, 0) {
			rates[key] = clamp01(rate)
		}
	}
	return rates, rows.Err()
}

func defaultPrizeRates() map[string]float64 {
	rates := make(map[string]float64, len(PrizeKeys))
	for _, key := range PrizeKeys {
		rates[key] = ecoPrizeDefinitions[key].SpawnRate
	}
	return rates
}

func clonePrizeRates(source map[string]float64) map[string]float64 {
	next := make(map[string]float64, len(PrizeKeys))
	for _, key := range PrizeKeys {
		next[key] = source[key]
	}
	return next
}

func buildPrizeRateViews(rates map[string]float64) []AdminPrizeRateView {
	views := make([]AdminPrizeRateView, 0, len(PrizeKeys))
	for _, key := range PrizeKeys {
		def := ecoPrizeDefinitions[key]
		views = append(views, AdminPrizeRateView{
			Key:         key,
			Name:        def.Name,
			Emoji:       def.Emoji,
			ImageSrc:    def.ImageSrc,
			DefaultRate: def.SpawnRate,
			CurrentRate: rates[key],
			GlobalLimit: def.GlobalLimit,
		})
	}
	return views
}

func (service *Service) loadAdminUserProfiles(ctx context.Context) (map[int64]userAdminProfile, error) {
	rows, err := service.db.Query(ctx,
		`SELECT u.id, u.username, NULLIF(COALESCE(p.display_name, u.display_name), ''), p.avatar_url
		   FROM users u
		   LEFT JOIN user_profiles p ON p.user_id = u.id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := map[int64]userAdminProfile{}
	for rows.Next() {
		var profile userAdminProfile
		var displayName sql.NullString
		var avatarURL sql.NullString
		if err := rows.Scan(&profile.UserID, &profile.Username, &displayName, &avatarURL); err != nil {
			return nil, err
		}
		if displayName.Valid {
			profile.DisplayName = ptrString(displayName.String)
		}
		if avatarURL.Valid {
			profile.AvatarURL = ptrString(avatarURL.String)
		}
		users[profile.UserID] = profile
	}
	return users, rows.Err()
}

func (service *Service) buildAdminPrizeSummaries(ctx context.Context, users map[int64]userAdminProfile) ([]AdminPrizeSummary, error) {
	rates, err := service.loadPrizeRateSettings(ctx)
	if err != nil {
		return nil, err
	}
	holders := map[string]*AdminPrizeHolderView{}
	rows, err := service.db.Query(ctx,
		`SELECT user_id, prize_key, inventory_count, lifetime_claim_count
		   FROM eco_prize_inventory
		  WHERE inventory_count > 0 OR lifetime_claim_count > 0`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var userID int64
		var prizeKey string
		var current int64
		var lifetime int64
		if err := rows.Scan(&userID, &prizeKey, &current, &lifetime); err != nil {
			return nil, err
		}
		if !isPrizeKey(prizeKey) {
			continue
		}
		holder := ensureAdminPrizeHolder(holders, users, userID, prizeKey)
		holder.CurrentCount = maxInt64(holder.CurrentCount, current)
		holder.LifetimeCount = maxInt64(holder.LifetimeCount, maxInt64(lifetime, current))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	lotRows, err := service.db.Query(ctx,
		`SELECT user_id, prize_key, id, acquired_at_ms, source, stolen_from_user_id, stolen_at_ms
		   FROM eco_prize_lots
		  ORDER BY acquired_at_ms DESC, id DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer lotRows.Close()
	for lotRows.Next() {
		var userID int64
		var prizeKey string
		var lot AdminPrizeLotView
		var stolenFrom sql.NullInt64
		var stolenAt sql.NullInt64
		if err := lotRows.Scan(&userID, &prizeKey, &lot.ID, &lot.AcquiredAt, &lot.Source, &stolenFrom, &stolenAt); err != nil {
			return nil, err
		}
		if !isPrizeKey(prizeKey) {
			continue
		}
		if stolenFrom.Valid {
			lot.StolenFromUserID = ptrInt64(stolenFrom.Int64)
		}
		if stolenAt.Valid {
			lot.StolenAt = ptrInt64(stolenAt.Int64)
		}
		holder := ensureAdminPrizeHolder(holders, users, userID, prizeKey)
		holder.Lots = append(holder.Lots, lot)
		holder.CurrentCount = maxInt64(holder.CurrentCount, int64(len(holder.Lots)))
		if lot.Source == "stolen" {
			holder.StolenCount++
		}
		holder.LifetimeCount = maxInt64(holder.LifetimeCount, holder.CurrentCount)
	}
	if err := lotRows.Err(); err != nil {
		return nil, err
	}

	rateViews := buildPrizeRateViews(rates)
	summaries := make([]AdminPrizeSummary, 0, len(PrizeKeys))
	for _, rateView := range rateViews {
		prizeHolders := make([]AdminPrizeHolderView, 0)
		for key, holder := range holders {
			if holderKeyPrize(key) == rateView.Key {
				prizeHolders = append(prizeHolders, *holder)
			}
		}
		sort.Slice(prizeHolders, func(left, right int) bool {
			if prizeHolders[left].LifetimeCount != prizeHolders[right].LifetimeCount {
				return prizeHolders[left].LifetimeCount > prizeHolders[right].LifetimeCount
			}
			return prizeHolders[left].UserID < prizeHolders[right].UserID
		})
		summary := AdminPrizeSummary{
			AdminPrizeRateView: rateView,
			HolderCount:        int64(len(prizeHolders)),
			Holders:            prizeHolders,
		}
		for _, holder := range prizeHolders {
			summary.TotalLifetimeClaims += holder.LifetimeCount
			summary.TotalCurrentInventory += holder.CurrentCount
		}
		summaries = append(summaries, summary)
	}
	return summaries, nil
}

func ensureAdminPrizeHolder(holders map[string]*AdminPrizeHolderView, users map[int64]userAdminProfile, userID int64, prizeKey string) *AdminPrizeHolderView {
	key := adminHolderKey(userID, prizeKey)
	if holder, ok := holders[key]; ok {
		return holder
	}
	profile := users[userID]
	username := profile.Username
	if username == "" {
		username = "#" + strconv.FormatInt(userID, 10)
	}
	holder := &AdminPrizeHolderView{
		UserID:      userID,
		Username:    username,
		DisplayName: profile.DisplayName,
		AvatarURL:   profile.AvatarURL,
		Lots:        []AdminPrizeLotView{},
	}
	holders[key] = holder
	return holder
}

func adminHolderKey(userID int64, prizeKey string) string {
	return strconv.FormatInt(userID, 10) + ":" + prizeKey
}

func holderKeyPrize(key string) string {
	for index := len(key) - 1; index >= 0; index-- {
		if key[index] == ':' {
			return key[index+1:]
		}
	}
	return key
}

func (service *Service) buildAdminTheftViews(ctx context.Context) ([]AdminTheftView, error) {
	rows, err := service.db.Query(ctx,
		`SELECT t.id, t.prize_key, t.original_user_id, t.thief_user_id, t.message,
		        t.stolen_at_ms, t.resolved_at_ms, t.outcome,
		        owner.username, NULLIF(COALESCE(owner_profile.display_name, owner.display_name), ''),
		        thief.username, NULLIF(COALESCE(thief_profile.display_name, thief.display_name), '')
		   FROM eco_thefts t
		   LEFT JOIN users owner ON owner.id = t.original_user_id
		   LEFT JOIN user_profiles owner_profile ON owner_profile.user_id = owner.id
		   LEFT JOIN users thief ON thief.id = t.thief_user_id
		   LEFT JOIN user_profiles thief_profile ON thief_profile.user_id = thief.id
		  ORDER BY t.stolen_at_ms DESC, t.id DESC
		  LIMIT 100`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	thefts := []AdminTheftView{}
	for rows.Next() {
		var view AdminTheftView
		var resolvedAt sql.NullInt64
		var outcome sql.NullString
		var ownerUsername sql.NullString
		var ownerDisplayName sql.NullString
		var thiefUsername sql.NullString
		var thiefDisplayName sql.NullString
		if err := rows.Scan(
			&view.ID,
			&view.Key,
			&view.OriginalUserID,
			&view.ThiefUserID,
			&view.Message,
			&view.StolenAt,
			&resolvedAt,
			&outcome,
			&ownerUsername,
			&ownerDisplayName,
			&thiefUsername,
			&thiefDisplayName,
		); err != nil {
			return nil, err
		}
		def := ecoPrizeDefinitions[view.Key]
		view.PrizeName = def.Name
		view.PrizeEmoji = def.Emoji
		view.OriginalUsername = fallbackUsernameFromNull(ownerUsername, view.OriginalUserID)
		view.ThiefUsername = fallbackUsernameFromNull(thiefUsername, view.ThiefUserID)
		if ownerDisplayName.Valid {
			view.OriginalDisplayName = ptrString(ownerDisplayName.String)
		}
		if thiefDisplayName.Valid {
			view.ThiefDisplayName = ptrString(thiefDisplayName.String)
		}
		if resolvedAt.Valid {
			view.ResolvedAt = ptrInt64(resolvedAt.Int64)
		}
		if outcome.Valid {
			view.Outcome = ptrString(outcome.String)
		}
		thefts = append(thefts, view)
	}
	return thefts, rows.Err()
}

func (service *Service) buildAdminManualTrash(ctx context.Context, users map[int64]userAdminProfile, input AdminOverviewInput) (AdminManualTrashResult, error) {
	page := input.TrashPage
	if page <= 0 {
		page = 1
	}
	limit := input.TrashLimit
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	days := recentChinaDateKeys(input.NowMs, 7)
	rows, err := service.db.Query(ctx,
		`SELECT user_id, period_key, trash_cleared
		   FROM eco_trash_rankings
		  WHERE period = 'daily'
		    AND period_key = ANY($1)
		    AND trash_cleared > 0`,
		days,
	)
	if err != nil {
		return AdminManualTrashResult{}, err
	}
	defer rows.Close()

	byUser := map[int64]*AdminManualTrashRow{}
	for rows.Next() {
		var userID int64
		var day string
		var cleared int64
		if err := rows.Scan(&userID, &day, &cleared); err != nil {
			return AdminManualTrashResult{}, err
		}
		row := ensureManualTrashRow(byUser, users, days, userID)
		row.Days[day] = maxInt64(0, cleared)
		row.Total += maxInt64(0, cleared)
	}
	if err := rows.Err(); err != nil {
		return AdminManualTrashResult{}, err
	}
	allRows := make([]AdminManualTrashRow, 0, len(byUser))
	for _, row := range byUser {
		allRows = append(allRows, *row)
	}
	sort.Slice(allRows, func(left, right int) bool {
		if allRows[left].Total != allRows[right].Total {
			return allRows[left].Total > allRows[right].Total
		}
		return allRows[left].UserID < allRows[right].UserID
	})

	total := int64(len(allRows))
	totalPages := int64(0)
	if total > 0 {
		totalPages = (total + limit - 1) / limit
	}
	start := (page - 1) * limit
	end := start + limit
	paged := []AdminManualTrashRow{}
	if start < total {
		if end > total {
			end = total
		}
		paged = allRows[start:end]
	}
	return AdminManualTrashResult{
		Days: days,
		Rows: paged,
		Pagination: AdminPagination{
			Page:       page,
			Limit:      limit,
			Total:      total,
			TotalPages: totalPages,
			HasMore:    page < totalPages,
		},
	}, nil
}

func ensureManualTrashRow(rows map[int64]*AdminManualTrashRow, users map[int64]userAdminProfile, days []string, userID int64) *AdminManualTrashRow {
	if row, ok := rows[userID]; ok {
		return row
	}
	profile := users[userID]
	username := profile.Username
	if username == "" {
		username = "#" + strconv.FormatInt(userID, 10)
	}
	dayValues := make(map[string]int64, len(days))
	for _, day := range days {
		dayValues[day] = 0
	}
	row := &AdminManualTrashRow{
		UserID:      userID,
		Username:    username,
		DisplayName: profile.DisplayName,
		AvatarURL:   profile.AvatarURL,
		Days:        dayValues,
	}
	rows[userID] = row
	return row
}

func fallbackUsernameFromNull(value sql.NullString, userID int64) string {
	if value.Valid && value.String != "" {
		return value.String
	}
	return "#" + strconv.FormatInt(userID, 10)
}

func recentChinaDateKeys(nowMs int64, days int) []string {
	if days <= 0 {
		return []string{}
	}
	location := time.FixedZone("Asia/Shanghai", 8*60*60)
	now := time.UnixMilli(nowMs).In(location)
	keys := make([]string, 0, days)
	for index := days - 1; index >= 0; index-- {
		keys = append(keys, now.AddDate(0, 0, -index).Format("2006-01-02"))
	}
	return keys
}
