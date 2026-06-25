package announcements

type Status string

const (
	StatusDraft     Status = "draft"
	StatusPublished Status = "published"
	StatusArchived  Status = "archived"
	StatusAll       Status = "all"
)

type Item struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Content     string `json:"content"`
	Status      Status `json:"status"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
	PublishedAt *int64 `json:"publishedAt,omitempty"`
	CreatedByID int64  `json:"createdById"`
	CreatedBy   string `json:"createdBy"`
	UpdatedByID int64  `json:"updatedById"`
	UpdatedBy   string `json:"updatedBy"`
}

type Pagination struct {
	Page       int   `json:"page"`
	Limit      int   `json:"limit"`
	Total      int64 `json:"total"`
	TotalPages int   `json:"totalPages"`
	HasMore    bool  `json:"hasMore"`
}

type ListOptions struct {
	Page   int
	Limit  int
	Status Status
}

type ListResult struct {
	Items      []Item     `json:"items"`
	Pagination Pagination `json:"pagination"`
}

type SaveInput struct {
	Title   string
	Content string
	Status  Status
}

type UpdateInput struct {
	Title      *string
	Content    *string
	Status     *Status
	HasTitle   bool
	HasContent bool
	HasStatus  bool
}

type SaveResult struct {
	Announcement  Item  `json:"announcement"`
	NotifiedUsers int64 `json:"notifiedUsers"`
}
