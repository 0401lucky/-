package economy

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrWalletTransactionNotFound = errors.New("wallet transaction not found")

func (service *Service) BeginWalletTransaction(ctx context.Context, input BeginWalletTransactionInput) (*WalletTransaction, error) {
	input.Operation = strings.TrimSpace(input.Operation)
	input.Message = strings.TrimSpace(input.Message)
	if input.Message == "" {
		input.Message = "钱包交易处理中"
	}

	transaction, err := queryWalletTransaction(ctx, service.db,
		`INSERT INTO wallet_transactions (
		   id, user_id, operation, status, points_delta, dollars_delta,
		   requested_points, requested_dollars, fee_points, net_points,
		   message, created_at, updated_at
		 ) VALUES (
		   $1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, now(), now()
		 )
		 RETURNING `+walletTransactionSelectColumns(),
		randomID(),
		input.UserID,
		input.Operation,
		input.PointsDelta,
		input.DollarsDelta,
		optionalInt64(input.RequestedPoints),
		optionalFloat64(input.RequestedDollars),
		optionalInt64(input.FeePoints),
		optionalInt64(input.NetPoints),
		input.Message,
	)
	if err != nil {
		return nil, err
	}
	return &transaction, nil
}

func (service *Service) UpdateWalletTransaction(ctx context.Context, input UpdateWalletTransactionInput) (*WalletTransaction, error) {
	input.ID = strings.TrimSpace(input.ID)
	input.Status = strings.TrimSpace(input.Status)
	input.Message = strings.TrimSpace(input.Message)
	if input.Message == "" {
		input.Message = input.Status
	}

	transaction, err := queryWalletTransaction(ctx, service.db,
		`UPDATE wallet_transactions
		 SET status = $2,
		     message = $3,
		     new_api_quota = $4,
		     new_api_used_quota = $5,
		     new_api_balance_dollars = $6,
		     new_api_balance_whole_dollars = $7,
		     updated_at = now()
		 WHERE id = $1
		 RETURNING `+walletTransactionSelectColumns(),
		input.ID,
		input.Status,
		input.Message,
		optionalInt64(input.NewAPIQuota),
		optionalInt64(input.NewAPIUsedQuota),
		optionalFloat64(input.NewAPIBalanceDollars),
		optionalInt64(input.NewAPIBalanceWholeDollars),
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrWalletTransactionNotFound
	}
	if err != nil {
		return nil, err
	}
	return &transaction, nil
}

func queryWalletTransaction(ctx context.Context, querier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, sql string, args ...any) (WalletTransaction, error) {
	return scanWalletTransaction(querier.QueryRow(ctx, sql, args...))
}

type walletTransactionScanner interface {
	Scan(dest ...any) error
}

func scanWalletTransaction(scanner walletTransactionScanner) (WalletTransaction, error) {
	var transaction WalletTransaction
	var requestedPoints *int64
	var requestedDollars *float64
	var feePoints *int64
	var netPoints *int64
	var newAPIQuota *int64
	var newAPIUsedQuota *int64
	var newAPIBalanceDollars *float64
	var newAPIBalanceWholeDollars *int64
	var createdAt time.Time
	var updatedAt time.Time

	if err := scanner.Scan(
		&transaction.ID,
		&transaction.UserID,
		&transaction.Operation,
		&transaction.Status,
		&transaction.PointsDelta,
		&transaction.DollarsDelta,
		&requestedPoints,
		&requestedDollars,
		&feePoints,
		&netPoints,
		&transaction.Message,
		&newAPIQuota,
		&newAPIUsedQuota,
		&newAPIBalanceDollars,
		&newAPIBalanceWholeDollars,
		&createdAt,
		&updatedAt,
	); err != nil {
		return WalletTransaction{}, err
	}

	transaction.RequestedPoints = requestedPoints
	transaction.RequestedDollars = requestedDollars
	transaction.FeePoints = feePoints
	transaction.NetPoints = netPoints
	transaction.NewAPIQuota = newAPIQuota
	transaction.NewAPIUsedQuota = newAPIUsedQuota
	transaction.NewAPIBalanceDollars = newAPIBalanceDollars
	transaction.NewAPIBalanceWholeDollars = newAPIBalanceWholeDollars
	transaction.CreatedAt = millis(createdAt)
	transaction.UpdatedAt = millis(updatedAt)
	return transaction, nil
}

func walletTransactionSelectColumns() string {
	return `id, user_id, operation, status, points_delta,
	        CAST(dollars_delta AS double precision),
	        requested_points,
	        CAST(requested_dollars AS double precision),
	        fee_points, net_points, message,
	        new_api_quota, new_api_used_quota,
	        CAST(new_api_balance_dollars AS double precision),
	        new_api_balance_whole_dollars,
	        created_at, updated_at`
}

func optionalFloat64(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}
