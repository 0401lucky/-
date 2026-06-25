package announcements

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"redemption/backend/internal/auth"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	maxTitleLength   = 200
	maxContentLength = 5000
	maxPageSize      = 50
)

var (
	ErrUnavailable  = errors.New("announcements database unavailable")
	ErrInvalidInput = errors.New("invalid announcement input")
	ErrNotFound     = errors.New("announcement not found")
)

type Service struct {
	db  *pgxpool.Pool
	now func() time.Time
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db, now: time.Now}
}

func NewServiceWithNow(db *pgxpool.Pool, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{db: db, now: now}
}

func (service *Service) ListPublished(ctx context.Context, options ListOptions) (ListResult, error) {
	return service.list(ctx, ListOptions{Page: options.Page, Limit: options.Limit, Status: StatusPublished}, true)
}

func (service *Service) ListAdmin(ctx context.Context, options ListOptions) (ListResult, error) {
	return service.list(ctx, options, false)
}

func (service *Service) Get(ctx context.Context, id string) (Item, error) {
	if service.db == nil {
		return Item{}, ErrUnavailable
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return Item{}, ErrNotFound
	}
	item, err := service.getByID(ctx, service.db, id)
	if err != nil {
		return Item{}, err
	}
	return item, nil
}

func (service *Service) Create(ctx context.Context, input SaveInput, operator auth.User) (SaveResult, error) {
	if service.db == nil {
		return SaveResult{}, ErrUnavailable
	}
	title, content, status, err := normalizeSaveInput(input)
	if err != nil {
		return SaveResult{}, err
	}
	nowMs := service.now().UnixMilli()
	item := Item{
		ID:          randomID(),
		Title:       title,
		Content:     content,
		Status:      status,
		CreatedAt:   nowMs,
		UpdatedAt:   nowMs,
		CreatedByID: operator.ID,
		CreatedBy:   operatorName(operator),
		UpdatedByID: operator.ID,
		UpdatedBy:   operatorName(operator),
	}
	if status == StatusPublished {
		item.PublishedAt = &nowMs
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return SaveResult{}, err
	}
	defer rollbackSilently(ctx, tx)

	if err := insertAnnouncement(ctx, tx, item); err != nil {
		return SaveResult{}, err
	}
	notifiedUsers := int64(0)
	if status == StatusPublished {
		notifiedUsers, err = fanoutAnnouncement(ctx, tx, item, nowMs)
		if err != nil {
			return SaveResult{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return SaveResult{}, err
	}
	return SaveResult{Announcement: item, NotifiedUsers: notifiedUsers}, nil
}

func (service *Service) Update(ctx context.Context, id string, input UpdateInput, operator auth.User) (SaveResult, error) {
	if service.db == nil {
		return SaveResult{}, ErrUnavailable
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return SaveResult{}, ErrNotFound
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return SaveResult{}, err
	}
	defer rollbackSilently(ctx, tx)

	current, err := getByIDForUpdate(ctx, tx, id)
	if err != nil {
		return SaveResult{}, err
	}
	next, err := service.applyUpdateInput(current, input, operator)
	if err != nil {
		return SaveResult{}, err
	}
	if err := updateAnnouncement(ctx, tx, next); err != nil {
		return SaveResult{}, err
	}

	notifiedUsers := int64(0)
	if current.Status != StatusPublished && next.Status == StatusPublished {
		notifiedUsers, err = fanoutAnnouncement(ctx, tx, next, next.UpdatedAt)
		if err != nil {
			return SaveResult{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return SaveResult{}, err
	}
	return SaveResult{Announcement: next, NotifiedUsers: notifiedUsers}, nil
}

func (service *Service) Archive(ctx context.Context, id string, operator auth.User) (Item, error) {
	status := StatusArchived
	result, err := service.Update(ctx, id, UpdateInput{Status: &status, HasStatus: true}, operator)
	if err != nil {
		return Item{}, err
	}
	return result.Announcement, nil
}

func (service *Service) list(ctx context.Context, options ListOptions, publishedOnly bool) (ListResult, error) {
	if service.db == nil {
		return ListResult{}, ErrUnavailable
	}
	page := normalizePage(options.Page)
	limit := normalizeLimit(options.Limit)
	status := normalizeListStatus(options.Status)

	where := []string{}
	args := []any{}
	if publishedOnly {
		where = append(where, "status = 'published'")
	} else if status != StatusAll {
		args = append(args, status)
		where = append(where, fmt.Sprintf("status = $%d", len(args)))
	}

	whereSQL := ""
	if len(where) > 0 {
		whereSQL = " WHERE " + strings.Join(where, " AND ")
	}
	var total int64
	if err := service.db.QueryRow(ctx, "SELECT COUNT(*) FROM announcements"+whereSQL, args...).Scan(&total); err != nil {
		return ListResult{}, err
	}
	totalPages := totalPages(total, limit)
	if page > totalPages {
		page = totalPages
	}
	offset := (page - 1) * limit

	orderBy := "updated_at_ms DESC, id DESC"
	if publishedOnly {
		orderBy = "published_at_ms DESC, id DESC"
	}
	queryArgs := append([]any{}, args...)
	queryArgs = append(queryArgs, limit, offset)
	rows, err := service.db.Query(ctx,
		`SELECT id, title, content, status, created_at_ms, updated_at_ms, published_at_ms,
		        created_by_id, created_by, updated_by_id, updated_by
		   FROM announcements`+whereSQL+`
		  ORDER BY `+orderBy+`
		  LIMIT $`+fmt.Sprintf("%d", len(queryArgs)-1)+` OFFSET $`+fmt.Sprintf("%d", len(queryArgs)),
		queryArgs...,
	)
	if err != nil {
		return ListResult{}, err
	}
	defer rows.Close()

	items := []Item{}
	for rows.Next() {
		item, err := scanItem(rows)
		if err != nil {
			return ListResult{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return ListResult{}, err
	}
	return ListResult{
		Items: items,
		Pagination: Pagination{
			Page:       page,
			Limit:      limit,
			Total:      total,
			TotalPages: totalPages,
			HasMore:    page < totalPages,
		},
	}, nil
}

func (service *Service) getByID(ctx context.Context, db *pgxpool.Pool, id string) (Item, error) {
	row := db.QueryRow(ctx,
		`SELECT id, title, content, status, created_at_ms, updated_at_ms, published_at_ms,
		        created_by_id, created_by, updated_by_id, updated_by
		   FROM announcements
		  WHERE id = $1`,
		id,
	)
	return scanItem(row)
}

func (service *Service) applyUpdateInput(current Item, input UpdateInput, operator auth.User) (Item, error) {
	next := current
	if input.HasTitle {
		if input.Title == nil {
			return Item{}, ErrInvalidInput
		}
		next.Title = sanitizeText(*input.Title, maxTitleLength)
	}
	if input.HasContent {
		if input.Content == nil {
			return Item{}, ErrInvalidInput
		}
		next.Content = sanitizeText(*input.Content, maxContentLength)
	}
	if input.HasStatus {
		if input.Status == nil || !IsStatus(*input.Status) {
			return Item{}, ErrInvalidInput
		}
		next.Status = *input.Status
	}
	if strings.TrimSpace(next.Title) == "" || strings.TrimSpace(next.Content) == "" {
		return Item{}, ErrInvalidInput
	}
	next.UpdatedAt = service.now().UnixMilli()
	next.UpdatedByID = operator.ID
	next.UpdatedBy = operatorName(operator)
	if next.Status == StatusPublished {
		if next.PublishedAt == nil {
			publishedAt := next.UpdatedAt
			next.PublishedAt = &publishedAt
		}
	} else {
		next.PublishedAt = nil
	}
	return next, nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanItem(row scanner) (Item, error) {
	var item Item
	var status string
	var publishedAt *int64
	err := row.Scan(
		&item.ID,
		&item.Title,
		&item.Content,
		&status,
		&item.CreatedAt,
		&item.UpdatedAt,
		&publishedAt,
		&item.CreatedByID,
		&item.CreatedBy,
		&item.UpdatedByID,
		&item.UpdatedBy,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	if err != nil {
		return Item{}, err
	}
	item.Status = Status(status)
	item.PublishedAt = publishedAt
	return item, nil
}

func getByIDForUpdate(ctx context.Context, tx pgx.Tx, id string) (Item, error) {
	row := tx.QueryRow(ctx,
		`SELECT id, title, content, status, created_at_ms, updated_at_ms, published_at_ms,
		        created_by_id, created_by, updated_by_id, updated_by
		   FROM announcements
		  WHERE id = $1
		  FOR UPDATE`,
		id,
	)
	return scanItem(row)
}

func insertAnnouncement(ctx context.Context, tx pgx.Tx, item Item) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO announcements (
		   id, title, content, status, created_at_ms, updated_at_ms, published_at_ms,
		   created_by_id, created_by, updated_by_id, updated_by, created_at, updated_at
		 )
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())`,
		item.ID,
		item.Title,
		item.Content,
		item.Status,
		item.CreatedAt,
		item.UpdatedAt,
		item.PublishedAt,
		item.CreatedByID,
		item.CreatedBy,
		item.UpdatedByID,
		item.UpdatedBy,
	)
	return err
}

func updateAnnouncement(ctx context.Context, tx pgx.Tx, item Item) error {
	commandTag, err := tx.Exec(ctx,
		`UPDATE announcements
		    SET title = $2,
		        content = $3,
		        status = $4,
		        updated_at_ms = $5,
		        published_at_ms = $6,
		        updated_by_id = $7,
		        updated_by = $8,
		        updated_at = now()
		  WHERE id = $1`,
		item.ID,
		item.Title,
		item.Content,
		item.Status,
		item.UpdatedAt,
		item.PublishedAt,
		item.UpdatedByID,
		item.UpdatedBy,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func fanoutAnnouncement(ctx context.Context, tx pgx.Tx, item Item, nowMs int64) (int64, error) {
	var count int64
	err := tx.QueryRow(ctx,
		`WITH inserted_dedupe AS (
		   INSERT INTO announcement_notifications (announcement_id, user_id, notification_id, notified_at_ms)
		   SELECT $1,
		          users.id,
		          'announcement:' || $1 || ':' || users.id::text,
		          $4
		     FROM users
		    WHERE users.id > 0
		   ON CONFLICT (announcement_id, user_id) DO NOTHING
		   RETURNING user_id, notification_id
		 ),
		 inserted_notifications AS (
		   INSERT INTO notifications (id, user_id, type, title, content, data, created_at_ms, created_at, updated_at)
		   SELECT notification_id,
		          user_id,
		          'announcement',
		          $2,
		          $3,
		          jsonb_build_object('announcementId', $1),
		          $4,
		          now(),
		          now()
		     FROM inserted_dedupe
		   ON CONFLICT (id) DO NOTHING
		   RETURNING id
		 )
		 SELECT COUNT(*)::bigint FROM inserted_notifications`,
		item.ID,
		"系统公告："+item.Title,
		item.Content,
		nowMs,
	).Scan(&count)
	return count, err
}

func normalizeSaveInput(input SaveInput) (string, string, Status, error) {
	title := sanitizeText(input.Title, maxTitleLength)
	content := sanitizeText(input.Content, maxContentLength)
	status := normalizeSaveStatus(input.Status)
	if title == "" || content == "" {
		return "", "", "", ErrInvalidInput
	}
	return title, content, status, nil
}

func normalizeSaveStatus(status Status) Status {
	if status == StatusDraft || status == StatusArchived {
		return status
	}
	return StatusPublished
}

func normalizeListStatus(status Status) Status {
	if status == StatusDraft || status == StatusPublished || status == StatusArchived {
		return status
	}
	return StatusAll
}

func IsStatus(status Status) bool {
	return status == StatusDraft || status == StatusPublished || status == StatusArchived
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
	if value > maxPageSize {
		return maxPageSize
	}
	return value
}

func totalPages(total int64, limit int) int {
	if total <= 0 || limit <= 0 {
		return 1
	}
	return int(math.Ceil(float64(total) / float64(limit)))
}

func sanitizeText(value string, maxLength int) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) <= maxLength {
		return value
	}
	runes := []rune(value)
	return string(runes[:maxLength])
}

func operatorName(user auth.User) string {
	name := strings.TrimSpace(user.Username)
	if name == "" {
		name = strings.TrimSpace(user.DisplayName)
	}
	if name == "" {
		return "admin"
	}
	return name
}

func rollbackSilently(ctx context.Context, tx pgx.Tx) {
	_ = tx.Rollback(ctx)
}

func randomID() string {
	var buffer [6]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		return fmt.Sprintf("ann_%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buffer[:])
}
