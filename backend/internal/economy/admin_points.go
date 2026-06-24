package economy

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"redemption/backend/internal/auth"

	"github.com/jackc/pgx/v5"
)

func (service *Service) GetAdminUserPoints(ctx context.Context, userID int64, page int64, limit int64) (AdminUserPointsPage, error) {
	if userID <= 0 {
		return AdminUserPointsPage{}, errors.New("userID must be positive")
	}
	page = normalizeAdminPositiveInt(page, 1, 100000)
	limit = normalizeAdminPositiveInt(limit, 10, 50)
	offset := (page - 1) * limit

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return AdminUserPointsPage{}, err
	}
	defer rollbackSilently(ctx, tx)

	balance, err := getBalance(ctx, tx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		balance = 0
	} else if err != nil {
		return AdminUserPointsPage{}, err
	}

	total, err := countPointLogs(ctx, tx, userID)
	if err != nil {
		return AdminUserPointsPage{}, err
	}
	logs, err := listPointLogsPage(ctx, tx, userID, limit, offset)
	if err != nil {
		return AdminUserPointsPage{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AdminUserPointsPage{}, err
	}

	totalPages := int64(1)
	if total > 0 {
		totalPages = (total + limit - 1) / limit
	}
	return AdminUserPointsPage{
		UserID:  userID,
		Balance: balance,
		Logs:    logs,
		Pagination: PointsPagination{
			Page:       page,
			Limit:      limit,
			Total:      total,
			TotalPages: totalPages,
			HasMore:    page < totalPages,
		},
	}, nil
}

func (service *Service) AdjustAdminUserPoints(ctx context.Context, admin auth.User, input AdminPointsAdjustmentInput) (AdminPointsAdjustmentResult, PointMutationResult, error) {
	input.Description = strings.TrimSpace(input.Description)
	if input.UserID <= 0 {
		return AdminPointsAdjustmentResult{}, PointMutationResult{}, errors.New("userID must be positive")
	}
	if input.Amount == 0 {
		return AdminPointsAdjustmentResult{}, PointMutationResult{}, errors.New("amount must be non-zero")
	}
	if input.Description == "" {
		return AdminPointsAdjustmentResult{}, PointMutationResult{}, errors.New("description is required")
	}

	target, err := service.adminTargetUser(ctx, input.UserID)
	if err != nil {
		return AdminPointsAdjustmentResult{}, PointMutationResult{}, err
	}
	adminName := strings.TrimSpace(admin.Username)
	if adminName == "" {
		adminName = "#" + strconv.FormatInt(admin.ID, 10)
	}
	mutation, err := service.ApplyPointsDelta(ctx, target, PointMutationInput{
		Delta:       input.Amount,
		Source:      "admin_adjust",
		Description: "[管理员:" + adminName + "] " + input.Description,
	})
	if err != nil {
		return AdminPointsAdjustmentResult{}, mutation, err
	}
	if !mutation.Success {
		return AdminPointsAdjustmentResult{}, mutation, nil
	}
	return AdminPointsAdjustmentResult{
		UserID:     input.UserID,
		Adjustment: input.Amount,
		NewBalance: mutation.Balance,
	}, mutation, nil
}

func (service *Service) adminTargetUser(ctx context.Context, userID int64) (auth.User, error) {
	var username string
	var displayName string
	err := service.db.QueryRow(ctx,
		`SELECT username, display_name FROM users WHERE id = $1`,
		userID,
	).Scan(&username, &displayName)
	if errors.Is(err, pgx.ErrNoRows) {
		placeholder := "#" + strconv.FormatInt(userID, 10)
		return auth.User{ID: userID, Username: placeholder, DisplayName: placeholder}, nil
	}
	if err != nil {
		return auth.User{}, err
	}
	if strings.TrimSpace(username) == "" {
		username = "#" + strconv.FormatInt(userID, 10)
	}
	if strings.TrimSpace(displayName) == "" {
		displayName = username
	}
	return auth.User{ID: userID, Username: username, DisplayName: displayName}, nil
}

func normalizeAdminPositiveInt(value int64, fallback int64, max int64) int64 {
	if value <= 0 {
		return fallback
	}
	if value > max {
		return max
	}
	return value
}

func countPointLogs(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	var total int64
	err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM point_ledger WHERE user_id = $1`, userID).Scan(&total)
	return total, err
}

func listPointLogsPage(ctx context.Context, tx pgx.Tx, userID int64, limit int64, offset int64) ([]PointsLog, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, amount, source, description, balance_after, created_at
		 FROM point_ledger
		 WHERE user_id = $1
		 ORDER BY created_at DESC, id DESC
		 LIMIT $2 OFFSET $3`,
		userID,
		limit,
		offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	logs := []PointsLog{}
	for rows.Next() {
		var log PointsLog
		var createdAt time.Time
		if err := rows.Scan(&log.ID, &log.Amount, &log.Source, &log.Description, &log.Balance, &createdAt); err != nil {
			return nil, err
		}
		log.CreatedAt = millis(createdAt)
		logs = append(logs, log)
	}
	return logs, rows.Err()
}
