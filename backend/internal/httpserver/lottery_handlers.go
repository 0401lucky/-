package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"

	"redemption/backend/internal/lottery"
)

type lotteryHandlers struct {
	deps    Dependencies
	service *lottery.Service
}

func newLotteryHandlers(deps Dependencies) lotteryHandlers {
	return lotteryHandlers{
		deps:    deps,
		service: lottery.NewService(deps.DB),
	}
}

func (handlers lotteryHandlers) page(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "抽奖数据库未配置"})
		return
	}
	payload, err := handlers.service.PagePayload(request.Context(), *user, 20)
	if err != nil {
		handlers.writeServiceError(writer, "查询抽奖页面失败", err, "获取抽奖配置失败")
		return
	}
	response := map[string]any{"success": true}
	response["enabled"] = payload.Enabled
	response["mode"] = payload.Mode
	response["tiers"] = payload.Tiers
	response["canSpin"] = payload.CanSpin
	response["hasSpunToday"] = payload.HasSpunToday
	response["extraSpins"] = payload.ExtraSpins
	response["dailySpinLimit"] = payload.DailySpinLimit
	response["dailySpinUsed"] = payload.DailySpinUsed
	response["dailySpinRemaining"] = payload.DailySpinRemaining
	response["allTiersHaveCodes"] = payload.AllTiersHaveCodes
	response["user"] = payload.User
	response["records"] = payload.Records
	writeJSON(writer, http.StatusOK, response)
}

func (handlers lotteryHandlers) spin(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, lotterySpinRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "抽奖数据库未配置"})
		return
	}
	result, err := handlers.service.SpinPoints(request.Context(), *user)
	if err != nil {
		if message, ok := lotteryUserErrorMessage(err); ok {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": message})
			return
		}
		handlers.writeServiceError(writer, "执行转盘抽奖失败", err, "抽奖失败，请重试")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": result.Message,
		"record":  result.Record,
	})
}

func (handlers lotteryHandlers) records(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "抽奖记录服务暂时不可用，请稍后重试"})
		return
	}
	records, err := handlers.service.UserRecords(request.Context(), user.ID, 20)
	if err != nil {
		handlers.writeServiceError(writer, "查询用户抽奖记录失败", err, "获取记录失败")
		return
	}
	type recordView struct {
		ID           string `json:"id"`
		TierName     string `json:"tierName"`
		TierValue    int64  `json:"tierValue"`
		Code         string `json:"code"`
		DirectCredit bool   `json:"directCredit"`
		CreatedAt    int64  `json:"createdAt"`
	}
	views := make([]recordView, 0, len(records))
	for _, record := range records {
		directCredit := false
		if record.DirectCredit != nil {
			directCredit = *record.DirectCredit
		}
		views = append(views, recordView{
			ID:           record.ID,
			TierName:     record.TierName,
			TierValue:    record.TierValue,
			Code:         record.Code,
			DirectCredit: directCredit,
			CreatedAt:    record.CreatedAt,
		})
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "records": views})
}

func (handlers lotteryHandlers) dailyRanking(writer http.ResponseWriter, request *http.Request) {
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "排行榜服务暂时不可用，请稍后重试"})
		return
	}
	query := request.URL.Query()
	data, err := handlers.service.LotteryDailyRanking(
		request.Context(),
		query.Get("date"),
		parsePositiveIntQuery(query.Get("limit"), 10),
	)
	if err != nil {
		var validation lottery.ValidationError
		if errors.As(err, &validation) {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": validation.Message})
			return
		}
		handlers.writeServiceError(writer, "查询彩票日榜失败", err, "获取排行榜失败")
		return
	}
	writer.Header().Set("Cache-Control", "public, max-age=15, stale-while-revalidate=45")
	writeJSON(writer, http.StatusOK, map[string]any{
		"success":           true,
		"date":              data.Date,
		"totalParticipants": data.TotalParticipants,
		"ranking":           data.Ranking,
	})
}

func (handlers lotteryHandlers) periodRanking(writer http.ResponseWriter, request *http.Request) {
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "排行榜服务暂时不可用，请稍后重试"})
		return
	}
	query := request.URL.Query()
	data, err := handlers.service.LotteryRanking(
		request.Context(),
		query.Get("period"),
		parsePositiveIntQuery(query.Get("limit"), 10),
	)
	if err != nil {
		handlers.writeServiceError(writer, "查询彩票周期榜失败", err, "获取幸运抽奖榜失败")
		return
	}
	writer.Header().Set("Cache-Control", "public, max-age=15, stale-while-revalidate=45")
	writeJSON(writer, http.StatusOK, map[string]any{
		"success":           true,
		"data":              data,
		"period":            data.Period,
		"periodKey":         data.PeriodKey,
		"totalParticipants": data.TotalParticipants,
		"ranking":           data.Ranking,
	})
}

func (handlers lotteryHandlers) admin(writer http.ResponseWriter, request *http.Request) {
	if _, ok := (economyHandlers{deps: handlers.deps}).requireAdmin(writer, request); !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "抽奖数据库未配置"})
		return
	}
	query := request.URL.Query()
	result, err := handlers.service.AdminSnapshot(
		request.Context(),
		parsePositiveIntQuery(query.Get("page"), 1),
		parsePositiveIntQuery(query.Get("limit"), 50),
	)
	if err != nil {
		handlers.writeServiceError(writer, "查询后台抽奖失败", err, "获取数据失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success":          true,
		"config":           result.Config,
		"todayDirectTotal": result.TodayDirectTotal,
		"tiers":            result.Tiers,
		"probabilityMap":   result.ProbabilityMap,
		"stats":            result.Stats,
		"records":          result.Records,
		"pagination":       result.Pagination,
	})
}

func (handlers lotteryHandlers) updateAdminConfig(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	admin, ok := shared.requireAdmin(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *admin, lotteryAdminRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "抽奖数据库未配置"})
		return
	}
	input, err := decodeLotteryConfigUpdate(request)
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": err.Error()})
		return
	}
	config, err := handlers.service.UpdateConfig(request.Context(), input)
	if err != nil {
		var validation lottery.ValidationError
		if errors.As(err, &validation) {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": validation.Message})
			return
		}
		handlers.writeServiceError(writer, "更新后台抽奖配置失败", err, "更新配置失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "配置更新成功",
		"config":  config,
	})
}

func (handlers lotteryHandlers) numberBombState(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, numberBombReadRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "抽奖数据库未配置"})
		return
	}
	state, err := handlers.service.NumberBombState(request.Context(), *user)
	if err != nil {
		handlers.writeServiceError(writer, "查询数字炸弹状态失败", err, "获取数字炸弹状态失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": state})
}

func (handlers lotteryHandlers) numberBombBet(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, numberBombWriteRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "抽奖数据库未配置"})
		return
	}
	input, err := decodeNumberBombBetInput(request)
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": err.Error()})
		return
	}
	result, err := handlers.service.PlaceNumberBombBet(request.Context(), *user, input)
	if err != nil {
		handlers.writeNumberBombError(writer, err, "下注失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": result.Message,
		"bet":     result.Bet,
		"balance": result.Balance,
	})
}

func (handlers lotteryHandlers) numberBombCancel(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, numberBombWriteRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "抽奖数据库未配置"})
		return
	}
	result, err := handlers.service.CancelNumberBombBet(request.Context(), *user)
	if err != nil {
		handlers.writeNumberBombError(writer, err, "取消失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": result.Message,
		"bet":     result.Bet,
		"balance": result.Balance,
	})
}

func (handlers lotteryHandlers) adminNumberBomb(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	admin, ok := shared.requireAdmin(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *admin, lotteryAdminRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "抽奖数据库未配置"})
		return
	}
	snapshot, err := handlers.service.NumberBombAdminSnapshot(request.Context(), 7)
	if err != nil {
		handlers.writeServiceError(writer, "查询后台数字炸弹失败", err, "获取数字炸弹今天数字失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": snapshot})
}

func (handlers lotteryHandlers) adminLegacyToolDisabled(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if request.Method != http.MethodGet && shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := shared.requireAdmin(writer, request); !ok {
		return
	}
	writeJSON(writer, http.StatusGone, map[string]any{
		"success": false,
		"message": "旧彩票兑换码工具已停用；当前 Zeabur/Go 版本只保留积分抽奖和数字炸弹。",
	})
}

func (handlers lotteryHandlers) writeServiceError(writer http.ResponseWriter, logMessage string, err error, responseMessage string) {
	if errors.Is(err, lottery.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "抽奖数据库未配置"})
		return
	}
	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": responseMessage})
}

func (handlers lotteryHandlers) writeNumberBombError(writer http.ResponseWriter, err error, fallback string) {
	var validation lottery.ValidationError
	if errors.As(err, &validation) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": validation.Message})
		return
	}
	if errors.Is(err, lottery.ErrNumberBombNotFound) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "今日还没有投注"})
		return
	}
	handlers.writeServiceError(writer, "数字炸弹写入失败", err, fallback)
}

type lotteryConfigUpdateRequest struct {
	Enabled          *bool                       `json:"enabled"`
	Mode             string                      `json:"mode"`
	DailyDirectLimit *int64                      `json:"dailyDirectLimit"`
	DailySpinLimit   *int64                      `json:"dailySpinLimit"`
	Tiers            *[]lotteryTierUpdateRequest `json:"tiers"`
}

type lotteryTierUpdateRequest struct {
	ID          string   `json:"id"`
	Name        *string  `json:"name"`
	Value       *int64   `json:"value"`
	Color       *string  `json:"color"`
	Probability *float64 `json:"probability"`
	Enabled     *bool    `json:"enabled"`
}

func decodeLotteryConfigUpdate(request *http.Request) (lottery.ConfigUpdateInput, error) {
	var payload lotteryConfigUpdateRequest
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		return lottery.ConfigUpdateInput{}, errors.New("请求体格式无效")
	}
	input := lottery.ConfigUpdateInput{
		Enabled:          payload.Enabled,
		Mode:             payload.Mode,
		DailyDirectLimit: payload.DailyDirectLimit,
		DailySpinLimit:   payload.DailySpinLimit,
	}
	if payload.Tiers != nil {
		tiers := make([]lottery.TierUpdateInput, 0, len(*payload.Tiers))
		for _, tier := range *payload.Tiers {
			tiers = append(tiers, lottery.TierUpdateInput{
				ID:          tier.ID,
				Name:        tier.Name,
				Value:       tier.Value,
				Color:       tier.Color,
				Probability: tier.Probability,
				Enabled:     tier.Enabled,
			})
		}
		input.Tiers = &tiers
	}
	return input, nil
}

type numberBombBetRequest struct {
	SelectedNumber *int `json:"selectedNumber"`
	Multiplier     *int `json:"multiplier"`
}

func decodeNumberBombBetInput(request *http.Request) (lottery.NumberBombBetInput, error) {
	var payload numberBombBetRequest
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		return lottery.NumberBombBetInput{}, errors.New("请求体格式无效")
	}
	if payload.SelectedNumber == nil {
		return lottery.NumberBombBetInput{}, errors.New("请选择 0 到 9 之间的数字")
	}
	if payload.Multiplier == nil {
		return lottery.NumberBombBetInput{}, errors.New("倍率不合法")
	}
	return lottery.NumberBombBetInput{
		SelectedNumber: *payload.SelectedNumber,
		Multiplier:     *payload.Multiplier,
	}, nil
}

func lotteryUserErrorMessage(err error) (string, bool) {
	switch {
	case errors.Is(err, lottery.ErrDisabled):
		return "抽奖活动暂未开放", true
	case errors.Is(err, lottery.ErrModeNotMigrated):
		return "当前抽奖模式尚未迁移到 Go，请暂勿切流", true
	case errors.Is(err, lottery.ErrInvalidConfig):
		return "抽奖配置异常，请联系管理员", true
	case errors.Is(err, lottery.ErrDailyLimitReached):
		return "今日抽奖次数已达上限，明天再来吧", true
	case errors.Is(err, lottery.ErrNoSpinChance):
		return "今日免费次数已用完，请签到获取更多机会", true
	default:
		return "", false
	}
}
