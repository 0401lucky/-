package feedback

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnavailable = errors.New("feedback database unavailable")
	ErrNotFound    = errors.New("feedback not found")
	ErrForbidden   = errors.New("feedback forbidden")
	ErrArchived    = errors.New("feedback archived")
	ErrClosed      = errors.New("feedback closed")
)

const maxFeedbackMessageLength = 1000
const maxFeedbackTitleLength = 80
const maxFeedbackContactLength = 100

var statusLabels = map[Status]string{
	StatusOpen:       "待处理",
	StatusProcessing: "处理中",
	StatusResolved:   "已解决",
	StatusClosed:     "已关闭",
}

type Status string

const (
	StatusOpen       Status = "open"
	StatusProcessing Status = "processing"
	StatusResolved   Status = "resolved"
	StatusClosed     Status = "closed"
)

type Role string

const (
	RoleUser  Role = "user"
	RoleAdmin Role = "admin"
)

type ListOptions struct {
	Page            int
	Limit           int
	Status          Status
	Wall            bool
	IncludeArchived bool
	UserID          int64
}

type Pagination struct {
	Page       int   `json:"page"`
	Limit      int   `json:"limit"`
	Total      int64 `json:"total"`
	TotalPages int   `json:"totalPages"`
	HasMore    bool  `json:"hasMore"`
}

type Image json.RawMessage

type Message struct {
	ID         string          `json:"id"`
	FeedbackID string          `json:"feedbackId"`
	Role       Role            `json:"role"`
	Content    string          `json:"content"`
	Images     json.RawMessage `json:"images,omitempty"`
	CreatedAt  int64           `json:"createdAt"`
	CreatedBy  string          `json:"createdBy"`
}

type Item struct {
	ID                  string          `json:"id"`
	UserID              int64           `json:"userId"`
	Username            string          `json:"username"`
	Title               *string         `json:"title,omitempty"`
	Contact             *string         `json:"contact,omitempty"`
	Anonymous           bool            `json:"anonymous,omitempty"`
	Status              Status          `json:"status"`
	CreatedAt           int64           `json:"createdAt"`
	UpdatedAt           int64           `json:"updatedAt"`
	ArchivedAt          *int64          `json:"archivedAt,omitempty"`
	DisplayName         *string         `json:"displayName,omitempty"`
	AvatarURL           *string         `json:"avatarUrl,omitempty"`
	EquippedAchievement json.RawMessage `json:"equippedAchievement,omitempty"`
	FirstMessage        *Message        `json:"firstMessage,omitempty"`
	LatestAdminReply    *Message        `json:"latestAdminReply,omitempty"`
	LatestMessageRole   *Role           `json:"latestMessageRole,omitempty"`
	LatestMessageAt     *int64          `json:"latestMessageAt,omitempty"`
	ReplyCount          *int64          `json:"replyCount,omitempty"`
	LikeCount           *int64          `json:"likeCount,omitempty"`
	LikedByMe           *bool           `json:"likedByMe,omitempty"`
}

type ListResult struct {
	Items      []Item     `json:"items"`
	Pagination Pagination `json:"pagination"`
}

type DetailResult struct {
	Feedback Item      `json:"feedback"`
	Messages []Message `json:"messages"`
}

type MessageInput struct {
	FeedbackID  string
	Role        Role
	Content     string
	CreatedBy   string
	ActorUserID int64
	Admin       bool
	Images      json.RawMessage
}

type CreateInput struct {
	UserID    int64
	Username  string
	Title     string
	Content   string
	Contact   string
	Anonymous bool
	Images    json.RawMessage
}

type CreateResult struct {
	Feedback Item    `json:"feedback"`
	Message  Message `json:"message"`
}

type MessageResult struct {
	Feedback Item    `json:"feedback"`
	Message  Message `json:"message"`
}

type LikeResult struct {
	LikeCount int64 `json:"likeCount"`
	LikedByMe bool  `json:"likedByMe"`
}

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (service *Service) ListWall(ctx context.Context, userID int64, options ListOptions) (ListResult, error) {
	options.Wall = true
	return service.list(ctx, userID, options)
}

func (service *Service) ListUser(ctx context.Context, userID int64, options ListOptions) (ListResult, error) {
	options.UserID = userID
	return service.list(ctx, userID, options)
}

func (service *Service) ListAdmin(ctx context.Context, options ListOptions) (ListResult, error) {
	return service.list(ctx, 0, options)
}

func (service *Service) GetDetail(ctx context.Context, feedbackID string, viewerUserID int64, admin bool) (DetailResult, error) {
	if service.db == nil {
		return DetailResult{}, ErrUnavailable
	}
	feedbackID = strings.TrimSpace(feedbackID)
	if feedbackID == "" {
		return DetailResult{}, ErrNotFound
	}

	item, err := service.getItemByID(ctx, feedbackID, viewerUserID)
	if err != nil {
		return DetailResult{}, err
	}
	if item.Anonymous && !admin && item.UserID != viewerUserID {
		return DetailResult{}, ErrForbidden
	}
	if !admin && item.UserID != viewerUserID {
		item.Contact = nil
	}

	messages, err := service.getMessages(ctx, feedbackID)
	if err != nil {
		return DetailResult{}, err
	}
	return DetailResult{Feedback: item, Messages: messages}, nil
}

func (service *Service) Create(ctx context.Context, input CreateInput) (CreateResult, error) {
	if service.db == nil {
		return CreateResult{}, ErrUnavailable
	}
	input.Username = strings.TrimSpace(input.Username)
	input.Title = strings.TrimSpace(input.Title)
	input.Content = strings.TrimSpace(input.Content)
	input.Contact = strings.TrimSpace(input.Contact)
	if input.UserID <= 0 || input.Username == "" {
		return CreateResult{}, ErrForbidden
	}
	if input.Content == "" && len(input.Images) == 0 {
		return CreateResult{}, ErrForbidden
	}
	if len([]rune(input.Content)) > maxFeedbackMessageLength ||
		len([]rune(input.Title)) > maxFeedbackTitleLength ||
		len([]rune(input.Contact)) > maxFeedbackContactLength {
		return CreateResult{}, ErrForbidden
	}

	images := normalizeImages(input.Images)
	nowMs := time.Now().UnixMilli()
	feedbackID := generateID("feedback")
	messageID := generateID("feedback-message")

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return CreateResult{}, err
	}
	defer rollbackFeedbackTx(ctx, tx)

	if _, err := tx.Exec(ctx,
		`INSERT INTO feedback_items (id, user_id, username, title, contact, anonymous, status, created_at_ms, updated_at_ms)
		 VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $7)`,
		feedbackID,
		input.UserID,
		input.Username,
		nullableString(input.Title),
		nullableString(input.Contact),
		input.Anonymous,
		nowMs,
	); err != nil {
		return CreateResult{}, err
	}
	message := Message{
		ID:         messageID,
		FeedbackID: feedbackID,
		Role:       RoleUser,
		Content:    input.Content,
		Images:     images,
		CreatedAt:  nowMs,
		CreatedBy:  input.Username,
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO feedback_messages (id, feedback_id, role, content, images, created_at_ms, created_by)
		 VALUES ($1, $2, 'user', $3, $4, $5, $6)`,
		message.ID,
		message.FeedbackID,
		message.Content,
		images,
		message.CreatedAt,
		message.CreatedBy,
	); err != nil {
		return CreateResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return CreateResult{}, err
	}

	item, err := service.getItemByID(ctx, feedbackID, input.UserID)
	if err != nil {
		return CreateResult{}, err
	}
	return CreateResult{Feedback: item, Message: message}, nil
}

func (service *Service) AddMessage(ctx context.Context, input MessageInput) (MessageResult, error) {
	if service.db == nil {
		return MessageResult{}, ErrUnavailable
	}
	input.FeedbackID = strings.TrimSpace(input.FeedbackID)
	input.Content = strings.TrimSpace(input.Content)
	input.CreatedBy = strings.TrimSpace(input.CreatedBy)
	if input.FeedbackID == "" {
		return MessageResult{}, ErrNotFound
	}
	if input.Role != RoleUser && input.Role != RoleAdmin {
		return MessageResult{}, ErrForbidden
	}
	if input.Content == "" && len(input.Images) == 0 {
		return MessageResult{}, ErrForbidden
	}
	if len([]rune(input.Content)) > maxFeedbackMessageLength {
		return MessageResult{}, ErrForbidden
	}
	images := normalizeImages(input.Images)
	nowMs := time.Now().UnixMilli()
	messageID := generateID("feedback-message")

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return MessageResult{}, err
	}
	defer rollbackFeedbackTx(ctx, tx)

	feedbackItem, err := service.getItemByIDForUpdate(ctx, tx, input.FeedbackID)
	if err != nil {
		return MessageResult{}, err
	}
	if feedbackItem.ArchivedAt != nil {
		return MessageResult{}, ErrArchived
	}
	if feedbackItem.Status == StatusClosed {
		return MessageResult{}, ErrClosed
	}
	if feedbackItem.Anonymous && !input.Admin && feedbackItem.UserID != input.ActorUserID {
		return MessageResult{}, ErrForbidden
	}

	nextStatus := feedbackItem.Status
	if input.Role == RoleUser && feedbackItem.Status == StatusResolved {
		nextStatus = StatusOpen
	}
	if input.Role == RoleAdmin && feedbackItem.Status == StatusOpen {
		nextStatus = StatusProcessing
	}

	message := Message{
		ID:         messageID,
		FeedbackID: input.FeedbackID,
		Role:       input.Role,
		Content:    input.Content,
		Images:     images,
		CreatedAt:  nowMs,
		CreatedBy:  input.CreatedBy,
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO feedback_messages (id, feedback_id, role, content, images, created_at_ms, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		message.ID,
		message.FeedbackID,
		message.Role,
		message.Content,
		images,
		message.CreatedAt,
		message.CreatedBy,
	); err != nil {
		return MessageResult{}, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE feedback_items
		    SET status = $2,
		        updated_at_ms = $3,
		        updated_at = now()
		  WHERE id = $1`,
		input.FeedbackID,
		nextStatus,
		nowMs,
	); err != nil {
		return MessageResult{}, err
	}
	updatedFeedback := feedbackItem
	updatedFeedback.Status = nextStatus
	updatedFeedback.UpdatedAt = nowMs
	if err := service.insertMessageNotification(ctx, tx, feedbackItem, message, nowMs); err != nil {
		return MessageResult{}, err
	}
	if err := service.insertStatusNotification(ctx, tx, updatedFeedback, feedbackItem.Status, nowMs); err != nil {
		return MessageResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return MessageResult{}, err
	}

	item, err := service.getItemByID(ctx, input.FeedbackID, input.ActorUserID)
	if err != nil {
		return MessageResult{}, err
	}
	if !input.Admin && item.UserID != input.ActorUserID {
		item.Contact = nil
	}
	return MessageResult{Feedback: item, Message: message}, nil
}

func (service *Service) ToggleLike(ctx context.Context, feedbackID string, userID int64) (LikeResult, error) {
	if service.db == nil {
		return LikeResult{}, ErrUnavailable
	}
	feedbackID = strings.TrimSpace(feedbackID)
	if feedbackID == "" {
		return LikeResult{}, ErrNotFound
	}
	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return LikeResult{}, err
	}
	defer rollbackFeedbackTx(ctx, tx)

	item, err := service.getItemByIDForUpdate(ctx, tx, feedbackID)
	if err != nil {
		return LikeResult{}, err
	}
	if item.Anonymous {
		return LikeResult{}, ErrNotFound
	}
	if item.ArchivedAt != nil {
		return LikeResult{}, ErrArchived
	}

	var liked bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM feedback_likes WHERE feedback_id = $1 AND user_id = $2)`,
		feedbackID,
		userID,
	).Scan(&liked); err != nil {
		return LikeResult{}, err
	}
	if liked {
		if _, err := tx.Exec(ctx, `DELETE FROM feedback_likes WHERE feedback_id = $1 AND user_id = $2`, feedbackID, userID); err != nil {
			return LikeResult{}, err
		}
	} else {
		if _, err := tx.Exec(ctx,
			`INSERT INTO feedback_likes (feedback_id, user_id, liked_at_ms)
			 VALUES ($1, $2, $3)
			 ON CONFLICT DO NOTHING`,
			feedbackID,
			userID,
			time.Now().UnixMilli(),
		); err != nil {
			return LikeResult{}, err
		}
	}
	var count int64
	var likedByMe bool
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM feedback_likes WHERE feedback_id = $1`, feedbackID).Scan(&count); err != nil {
		return LikeResult{}, err
	}
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM feedback_likes WHERE feedback_id = $1 AND user_id = $2)`,
		feedbackID,
		userID,
	).Scan(&likedByMe); err != nil {
		return LikeResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return LikeResult{}, err
	}
	return LikeResult{LikeCount: count, LikedByMe: likedByMe}, nil
}

func (service *Service) UpdateStatus(ctx context.Context, feedbackID string, status Status) (Item, error) {
	if service.db == nil {
		return Item{}, ErrUnavailable
	}
	feedbackID = strings.TrimSpace(feedbackID)
	if feedbackID == "" {
		return Item{}, ErrNotFound
	}
	if !IsStatus(status) {
		return Item{}, ErrForbidden
	}
	nowMs := time.Now().UnixMilli()
	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Item{}, err
	}
	defer rollbackFeedbackTx(ctx, tx)

	item, err := service.getItemByIDForUpdate(ctx, tx, feedbackID)
	if err != nil {
		return Item{}, err
	}
	previousStatus := item.Status
	if item.ArchivedAt == nil {
		if _, err := tx.Exec(ctx,
			`UPDATE feedback_items
			    SET status = $2,
			        updated_at_ms = $3,
			        updated_at = now()
			  WHERE id = $1`,
			feedbackID,
			status,
			nowMs,
		); err != nil {
			return Item{}, err
		}
		item.Status = status
		item.UpdatedAt = nowMs
	}
	if err := service.insertStatusNotification(ctx, tx, item, previousStatus, nowMs); err != nil {
		return Item{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Item{}, err
	}
	return service.getItemByID(ctx, feedbackID, 0)
}

func (service *Service) Delete(ctx context.Context, feedbackID string) error {
	if service.db == nil {
		return ErrUnavailable
	}
	feedbackID = strings.TrimSpace(feedbackID)
	if feedbackID == "" {
		return ErrNotFound
	}
	commandTag, err := service.db.Exec(ctx, `DELETE FROM feedback_items WHERE id = $1`, feedbackID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (service *Service) list(ctx context.Context, viewerUserID int64, options ListOptions) (ListResult, error) {
	if service.db == nil {
		return ListResult{}, ErrUnavailable
	}
	page := normalizePage(options.Page)
	limit := normalizeLimit(options.Limit)
	where := []string{}
	args := []any{}

	if options.IncludeArchived {
		where = append(where, "archived_at_ms IS NOT NULL")
	} else {
		where = append(where, "archived_at_ms IS NULL")
		if IsStatus(options.Status) {
			args = append(args, options.Status)
			where = append(where, "status = $"+strconv.Itoa(len(args)))
		}
	}
	if options.Wall {
		where = append(where, "anonymous = false")
	}
	if options.UserID > 0 {
		args = append(args, options.UserID)
		where = append(where, "user_id = $"+strconv.Itoa(len(args)))
	}

	whereSQL := strings.Join(where, " AND ")
	var total int64
	if err := service.db.QueryRow(ctx, "SELECT COUNT(*) FROM feedback_items WHERE "+whereSQL, args...).Scan(&total); err != nil {
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

	orderBy := "updated_at_ms DESC, id DESC"
	if options.IncludeArchived {
		orderBy = "archived_at_ms DESC, updated_at_ms DESC, id DESC"
	}

	queryArgs := append([]any{}, args...)
	queryArgs = append(queryArgs, limit, offset)
	rows, err := service.db.Query(ctx,
		`SELECT id, user_id, username, title, contact, anonymous, status, created_at_ms, updated_at_ms, archived_at_ms
		   FROM feedback_items
		  WHERE `+whereSQL+`
		  ORDER BY `+orderBy+`
		  LIMIT $`+strconv.Itoa(len(queryArgs)-1)+` OFFSET $`+strconv.Itoa(len(queryArgs)),
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
		service.applyAuthorFallback(ctx, &item)
		if options.Wall {
			if err := service.attachWallSummary(ctx, &item, viewerUserID); err != nil {
				return ListResult{}, err
			}
			item.Contact = nil
		} else if options.UserID > 0 {
			if err := service.attachLatestMessageSummary(ctx, &item); err != nil {
				return ListResult{}, err
			}
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

type rowScanner interface {
	Scan(dest ...any) error
}

func scanItem(row rowScanner) (Item, error) {
	var item Item
	var title sql.NullString
	var contact sql.NullString
	var status string
	var archivedAt sql.NullInt64
	if err := row.Scan(
		&item.ID,
		&item.UserID,
		&item.Username,
		&title,
		&contact,
		&item.Anonymous,
		&status,
		&item.CreatedAt,
		&item.UpdatedAt,
		&archivedAt,
	); err != nil {
		return Item{}, err
	}
	item.Status = Status(status)
	if title.Valid {
		item.Title = &title.String
	}
	if contact.Valid {
		item.Contact = &contact.String
	}
	if archivedAt.Valid {
		item.ArchivedAt = &archivedAt.Int64
	}
	return item, nil
}

func (service *Service) getItemByID(ctx context.Context, feedbackID string, viewerUserID int64) (Item, error) {
	row := service.db.QueryRow(ctx,
		`SELECT id, user_id, username, title, contact, anonymous, status, created_at_ms, updated_at_ms, archived_at_ms
		   FROM feedback_items
		  WHERE id = $1`,
		feedbackID,
	)
	item, err := scanItem(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Item{}, ErrNotFound
		}
		return Item{}, err
	}
	service.applyAuthorFallback(ctx, &item)
	if err := service.attachWallSummary(ctx, &item, viewerUserID); err != nil {
		return Item{}, err
	}
	return item, nil
}

func (service *Service) getItemByIDForUpdate(ctx context.Context, tx pgx.Tx, feedbackID string) (Item, error) {
	row := tx.QueryRow(ctx,
		`SELECT id, user_id, username, title, contact, anonymous, status, created_at_ms, updated_at_ms, archived_at_ms
		   FROM feedback_items
		  WHERE id = $1
		  FOR UPDATE`,
		feedbackID,
	)
	item, err := scanItem(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Item{}, ErrNotFound
		}
		return Item{}, err
	}
	return item, nil
}

func (service *Service) attachWallSummary(ctx context.Context, item *Item, viewerUserID int64) error {
	firstMessage, err := service.getFirstMessage(ctx, item.ID)
	if err != nil {
		return err
	}
	item.FirstMessage = firstMessage

	latestAdminReply, err := service.getLatestAdminReply(ctx, item.ID)
	if err != nil {
		return err
	}
	item.LatestAdminReply = latestAdminReply

	messageCount, err := service.messageCount(ctx, item.ID)
	if err != nil {
		return err
	}
	replyCount := maxInt64Feedback(0, messageCount-1)
	item.ReplyCount = &replyCount

	likeCount, likedByMe, err := service.likeState(ctx, item.ID, viewerUserID)
	if err != nil {
		return err
	}
	item.LikeCount = &likeCount
	item.LikedByMe = &likedByMe
	return nil
}

func (service *Service) attachLatestMessageSummary(ctx context.Context, item *Item) error {
	var role sql.NullString
	var createdAt sql.NullInt64
	err := service.db.QueryRow(ctx,
		`SELECT role, created_at_ms
		   FROM feedback_messages
		  WHERE feedback_id = $1
		  ORDER BY created_at_ms DESC, id DESC
		  LIMIT 1`,
		item.ID,
	).Scan(&role, &createdAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	if role.Valid {
		nextRole := Role(role.String)
		item.LatestMessageRole = &nextRole
	}
	if createdAt.Valid {
		item.LatestMessageAt = &createdAt.Int64
	}
	return nil
}

func (service *Service) getMessages(ctx context.Context, feedbackID string) ([]Message, error) {
	rows, err := service.db.Query(ctx,
		`SELECT id, feedback_id, role, content, images, created_at_ms, created_by
		   FROM feedback_messages
		  WHERE feedback_id = $1
		  ORDER BY created_at_ms ASC, id ASC`,
		feedbackID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := []Message{}
	for rows.Next() {
		message, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return messages, nil
}

func (service *Service) getFirstMessage(ctx context.Context, feedbackID string) (*Message, error) {
	return service.getSingleMessage(ctx, feedbackID, "", "created_at_ms ASC, id ASC")
}

func (service *Service) getLatestAdminReply(ctx context.Context, feedbackID string) (*Message, error) {
	return service.getSingleMessage(ctx, feedbackID, "admin", "created_at_ms DESC, id DESC")
}

func (service *Service) getSingleMessage(ctx context.Context, feedbackID string, role string, orderBy string) (*Message, error) {
	where := "feedback_id = $1"
	args := []any{feedbackID}
	if role != "" {
		args = append(args, role)
		where += " AND role = $2"
	}
	row := service.db.QueryRow(ctx,
		`SELECT id, feedback_id, role, content, images, created_at_ms, created_by
		   FROM feedback_messages
		  WHERE `+where+`
		  ORDER BY `+orderBy+`
		  LIMIT 1`,
		args...,
	)
	message, err := scanMessage(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &message, nil
}

func scanMessage(row rowScanner) (Message, error) {
	var message Message
	var role string
	var images []byte
	if err := row.Scan(
		&message.ID,
		&message.FeedbackID,
		&role,
		&message.Content,
		&images,
		&message.CreatedAt,
		&message.CreatedBy,
	); err != nil {
		return Message{}, err
	}
	message.Role = Role(role)
	if len(images) > 0 && string(images) != "[]" && string(images) != "null" {
		message.Images = json.RawMessage(images)
	}
	return message, nil
}

func (service *Service) messageCount(ctx context.Context, feedbackID string) (int64, error) {
	var count int64
	if err := service.db.QueryRow(ctx, `SELECT COUNT(*) FROM feedback_messages WHERE feedback_id = $1`, feedbackID).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (service *Service) likeState(ctx context.Context, feedbackID string, viewerUserID int64) (int64, bool, error) {
	var count int64
	var liked bool
	if err := service.db.QueryRow(ctx, `SELECT COUNT(*) FROM feedback_likes WHERE feedback_id = $1`, feedbackID).Scan(&count); err != nil {
		return 0, false, err
	}
	if viewerUserID > 0 {
		if err := service.db.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM feedback_likes WHERE feedback_id = $1 AND user_id = $2)`,
			feedbackID,
			viewerUserID,
		).Scan(&liked); err != nil {
			return 0, false, err
		}
	}
	return count, liked, nil
}

func (service *Service) applyAuthorFallback(ctx context.Context, item *Item) {
	displayName := item.Username
	var profileDisplay sql.NullString
	var avatarURL sql.NullString
	if err := service.db.QueryRow(ctx,
		`SELECT display_name, avatar_url FROM user_profiles WHERE user_id = $1`,
		item.UserID,
	).Scan(&profileDisplay, &avatarURL); err == nil {
		if profileDisplay.Valid && strings.TrimSpace(profileDisplay.String) != "" {
			displayName = profileDisplay.String
		}
		if avatarURL.Valid && strings.TrimSpace(avatarURL.String) != "" {
			item.AvatarURL = &avatarURL.String
		}
	}
	item.DisplayName = &displayName
	item.EquippedAchievement = json.RawMessage("null")
}

func IsStatus(value Status) bool {
	switch value {
	case StatusOpen, StatusProcessing, StatusResolved, StatusClosed:
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
	if value > 100 {
		return 100
	}
	return value
}

func maxInt64Feedback(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

func rollbackFeedbackTx(ctx context.Context, tx pgx.Tx) {
	if tx != nil {
		_ = tx.Rollback(ctx)
	}
}

func normalizeImages(images json.RawMessage) json.RawMessage {
	if len(images) == 0 || string(images) == "null" {
		return json.RawMessage("[]")
	}
	return images
}

func generateID(prefix string) string {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return prefix + "-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return prefix + "-" + strconv.FormatInt(time.Now().UnixMilli(), 36) + "-" + hex.EncodeToString(bytes[:])
}

func (service *Service) insertMessageNotification(ctx context.Context, tx pgx.Tx, item Item, message Message, nowMs int64) error {
	if message.Role == RoleUser && message.CreatedBy == item.Username {
		return nil
	}
	preview := feedbackMessagePreview(message.Content)
	isAdminReply := message.Role == RoleAdmin
	title := "反馈收到新评论"
	contentPrefix := message.CreatedBy + " 评论"
	kind := "user_comment"
	if isAdminReply {
		title = "反馈收到管理员回复"
		contentPrefix = "管理员回复"
		kind = "admin_reply"
	}
	content := contentPrefix + "了你的反馈，点击查看详情"
	if preview != "" {
		content = contentPrefix + "：" + preview
	}
	data, err := json.Marshal(map[string]any{
		"feedbackId": item.ID,
		"messageId":  message.ID,
		"kind":       kind,
	})
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO notifications (id, user_id, type, title, content, data, created_at_ms)
		 VALUES ($1, $2, 'feedback_reply', $3, $4, $5, $6)`,
		generateID("notification"),
		item.UserID,
		title,
		content,
		data,
		nowMs,
	)
	return err
}

func (service *Service) insertStatusNotification(ctx context.Context, tx pgx.Tx, item Item, previousStatus Status, nowMs int64) error {
	if previousStatus == item.Status {
		return nil
	}
	previousLabel := statusLabels[previousStatus]
	nextLabel := statusLabels[item.Status]
	if previousLabel == "" {
		previousLabel = string(previousStatus)
	}
	if nextLabel == "" {
		nextLabel = string(item.Status)
	}
	data, err := json.Marshal(map[string]any{
		"feedbackId":     item.ID,
		"previousStatus": previousStatus,
		"status":         item.Status,
	})
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO notifications (id, user_id, type, title, content, data, created_at_ms)
		 VALUES ($1, $2, 'feedback_status', '反馈状态已更新', $3, $4, $5)`,
		generateID("notification"),
		item.UserID,
		"你的反馈状态已从「"+previousLabel+"」更新为「"+nextLabel+"」。",
		data,
		nowMs,
	)
	return err
}

func feedbackMessagePreview(content string) string {
	preview := strings.Join(strings.Fields(strings.TrimSpace(content)), " ")
	runes := []rune(preview)
	if len(runes) > 80 {
		return string(runes[:80])
	}
	return preview
}

func nullableString(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}
