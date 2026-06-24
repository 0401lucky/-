package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrUnavailable = errors.New("notifications database unavailable")

type Type string

const (
	TypeSystem         Type = "system"
	TypeAnnouncement   Type = "announcement"
	TypeFeedbackReply  Type = "feedback_reply"
	TypeFeedbackStatus Type = "feedback_status"
	TypeLotteryWin     Type = "lottery_win"
	TypeRaffleWin      Type = "raffle_win"
	TypeWallet         Type = "wallet"
	TypeReward         Type = "reward"
)

type Filter string

const (
	FilterAll    Filter = "all"
	FilterUnread Filter = "unread"
	FilterPrize  Filter = "prize"
	FilterReply  Filter = "reply"
	FilterSystem Filter = "system"
	FilterRedeem Filter = "redeem"
)

type ListOptions struct {
	Page   int
	Limit  int
	Type   Type
	Filter Filter
}

type ListItem struct {
	ID        string          `json:"id"`
	UserID    int64           `json:"userId"`
	Type      Type            `json:"type"`
	Title     string          `json:"title"`
	Content   string          `json:"content"`
	Data      json.RawMessage `json:"data,omitempty"`
	CreatedAt int64           `json:"createdAt"`
	ReadAt    *int64          `json:"readAt,omitempty"`
	IsRead    bool            `json:"isRead"`
}

type Pagination struct {
	Page       int   `json:"page"`
	Limit      int   `json:"limit"`
	Total      int64 `json:"total"`
	TotalPages int   `json:"totalPages"`
	HasMore    bool  `json:"hasMore"`
}

type FilterCounts struct {
	All    int64 `json:"all"`
	Unread int64 `json:"unread"`
	Prize  int64 `json:"prize"`
	Reply  int64 `json:"reply"`
	System int64 `json:"system"`
	Redeem int64 `json:"redeem"`
}

type ListResult struct {
	Items       []ListItem   `json:"items"`
	UnreadCount int64        `json:"unreadCount"`
	Pagination  Pagination   `json:"pagination"`
	Counts      FilterCounts `json:"counts"`
}

type MarkReadOptions struct {
	IDs     []string
	MarkAll bool
	NowMs   int64
}

type MarkReadResult struct {
	Updated     int64 `json:"updated"`
	UnreadCount int64 `json:"unreadCount"`
}

type DeleteResult struct {
	Deleted     int64 `json:"deleted"`
	UnreadCount int64 `json:"unreadCount"`
}

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (service *Service) CountUnread(ctx context.Context, userID int64) (int64, error) {
	if service.db == nil {
		return 0, ErrUnavailable
	}
	if userID <= 0 {
		return 0, nil
	}

	var count int64
	if err := service.db.QueryRow(ctx,
		`SELECT COUNT(*)
		   FROM notifications
		  WHERE user_id = $1
		    AND read_at_ms IS NULL`,
		userID,
	).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (service *Service) List(ctx context.Context, userID int64, options ListOptions) (ListResult, error) {
	if service.db == nil {
		return ListResult{}, ErrUnavailable
	}
	page := normalizePage(options.Page)
	limit := normalizeLimit(options.Limit)
	filter := normalizeFilter(options.Filter)

	counts, err := service.counts(ctx, userID)
	if err != nil {
		return ListResult{}, err
	}

	where := []string{"user_id = $1"}
	args := []any{userID}
	if IsType(options.Type) {
		args = append(args, options.Type)
		where = append(where, "type = $"+strconv.Itoa(len(args)))
	}
	switch filter {
	case FilterUnread:
		where = append(where, "read_at_ms IS NULL")
	case FilterPrize:
		where = append(where, "type IN ('lottery_win', 'raffle_win')")
	case FilterReply:
		where = append(where, "type IN ('feedback_reply', 'feedback_status')")
	case FilterSystem:
		where = append(where, "type IN ('system', 'announcement')")
	case FilterRedeem:
		where = append(where, "type IN ('reward', 'wallet')")
	}

	countSQL := "SELECT COUNT(*) FROM notifications WHERE " + strings.Join(where, " AND ")
	var total int64
	if err := service.db.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return ListResult{}, err
	}

	totalPages := 1
	if total > 0 {
		totalPages = int(math.Ceil(float64(total) / float64(limit)))
	}
	if page > totalPages {
		page = totalPages
	}
	offset := (page - 1) * limit

	queryArgs := append([]any{}, args...)
	queryArgs = append(queryArgs, limit, offset)
	querySQL := `SELECT id, user_id, type, title, content, data, created_at_ms, read_at_ms
	   FROM notifications
	  WHERE ` + strings.Join(where, " AND ") + `
	  ORDER BY created_at_ms DESC, id DESC
	  LIMIT $` + strconv.Itoa(len(queryArgs)-1) + ` OFFSET $` + strconv.Itoa(len(queryArgs))
	rows, err := service.db.Query(ctx, querySQL, queryArgs...)
	if err != nil {
		return ListResult{}, err
	}
	defer rows.Close()

	items := []ListItem{}
	for rows.Next() {
		var item ListItem
		var notificationType string
		var data []byte
		if err := rows.Scan(&item.ID, &item.UserID, &notificationType, &item.Title, &item.Content, &data, &item.CreatedAt, &item.ReadAt); err != nil {
			return ListResult{}, err
		}
		item.Type = Type(notificationType)
		if len(data) > 0 && string(data) != "null" {
			item.Data = json.RawMessage(data)
		}
		item.IsRead = item.ReadAt != nil
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return ListResult{}, err
	}

	return ListResult{
		Items:       items,
		UnreadCount: counts.Unread,
		Pagination: Pagination{
			Page:       page,
			Limit:      limit,
			Total:      total,
			TotalPages: totalPages,
			HasMore:    page < totalPages,
		},
		Counts: counts,
	}, nil
}

func (service *Service) MarkRead(ctx context.Context, userID int64, options MarkReadOptions) (MarkReadResult, error) {
	if service.db == nil {
		return MarkReadResult{}, ErrUnavailable
	}
	nowMs := options.NowMs
	if nowMs <= 0 {
		nowMs = time.Now().UnixMilli()
	}

	updated := int64(0)
	if options.MarkAll {
		commandTag, err := service.db.Exec(ctx,
			`UPDATE notifications
			    SET read_at_ms = $2,
			        updated_at = now()
			  WHERE user_id = $1
			    AND read_at_ms IS NULL`,
			userID,
			nowMs,
		)
		if err != nil {
			return MarkReadResult{}, err
		}
		updated = commandTag.RowsAffected()
	} else {
		ids := normalizeNotificationIDs(options.IDs)
		if len(ids) > 0 {
			commandTag, err := service.db.Exec(ctx,
				`UPDATE notifications
				    SET read_at_ms = COALESCE(read_at_ms, $3),
				        updated_at = now()
				  WHERE user_id = $1
				    AND id = ANY($2)`,
				userID,
				ids,
				nowMs,
			)
			if err != nil {
				return MarkReadResult{}, err
			}
			updated = commandTag.RowsAffected()
		}
	}

	unreadCount, err := service.CountUnread(ctx, userID)
	if err != nil {
		return MarkReadResult{}, err
	}
	return MarkReadResult{Updated: updated, UnreadCount: unreadCount}, nil
}

func (service *Service) Delete(ctx context.Context, userID int64, ids []string) (DeleteResult, error) {
	if service.db == nil {
		return DeleteResult{}, ErrUnavailable
	}
	normalizedIDs := normalizeNotificationIDs(ids)
	deleted := int64(0)
	if len(normalizedIDs) > 0 {
		commandTag, err := service.db.Exec(ctx,
			`DELETE FROM notifications
			  WHERE user_id = $1
			    AND id = ANY($2)
			    AND read_at_ms IS NOT NULL`,
			userID,
			normalizedIDs,
		)
		if err != nil {
			return DeleteResult{}, err
		}
		deleted = commandTag.RowsAffected()
	}

	unreadCount, err := service.CountUnread(ctx, userID)
	if err != nil {
		return DeleteResult{}, err
	}
	return DeleteResult{Deleted: deleted, UnreadCount: unreadCount}, nil
}

func (service *Service) counts(ctx context.Context, userID int64) (FilterCounts, error) {
	var counts FilterCounts
	if err := service.db.QueryRow(ctx,
		`SELECT
		    COUNT(*),
		    COUNT(*) FILTER (WHERE read_at_ms IS NULL),
		    COUNT(*) FILTER (WHERE type IN ('lottery_win', 'raffle_win')),
		    COUNT(*) FILTER (WHERE type IN ('feedback_reply', 'feedback_status')),
		    COUNT(*) FILTER (WHERE type IN ('system', 'announcement')),
		    COUNT(*) FILTER (WHERE type IN ('reward', 'wallet'))
		   FROM notifications
		  WHERE user_id = $1`,
		userID,
	).Scan(&counts.All, &counts.Unread, &counts.Prize, &counts.Reply, &counts.System, &counts.Redeem); err != nil {
		return FilterCounts{}, err
	}
	return counts, nil
}

func IsType(value Type) bool {
	switch value {
	case TypeSystem, TypeAnnouncement, TypeFeedbackReply, TypeFeedbackStatus, TypeLotteryWin, TypeRaffleWin, TypeWallet, TypeReward:
		return true
	default:
		return false
	}
}

func IsFilter(value Filter) bool {
	switch value {
	case FilterAll, FilterUnread, FilterPrize, FilterReply, FilterSystem, FilterRedeem:
		return true
	default:
		return false
	}
}

func normalizePage(value int) int {
	if value < 1 {
		return 1
	}
	return value
}

func normalizeLimit(value int) int {
	if value < 1 {
		return 20
	}
	if value > 50 {
		return 50
	}
	return value
}

func normalizeFilter(value Filter) Filter {
	if IsFilter(value) {
		return value
	}
	return FilterAll
}

func normalizeNotificationIDs(ids []string) []string {
	seen := map[string]struct{}{}
	normalized := []string{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		normalized = append(normalized, id)
	}
	return normalized
}
