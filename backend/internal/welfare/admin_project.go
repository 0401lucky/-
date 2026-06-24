package welfare

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrProjectNotFound = errors.New("project not found")

func (service *Service) ListAdminProjects(ctx context.Context) ([]Project, error) {
	rows, err := service.db.Query(ctx,
		`SELECT id, name, description, max_claims, claimed_count, codes_count,
		        status, created_at_ms, created_by, reward_type, direct_points,
		        new_user_only, pinned, pinned_at_ms
		   FROM projects
		  ORDER BY pinned DESC, pinned_at_ms DESC NULLS LAST, created_at_ms DESC, id DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	projects := make([]Project, 0)
	for rows.Next() {
		project, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}
	return projects, rows.Err()
}

func (service *Service) CreateAdminProject(ctx context.Context, input CreateAdminProjectInput) (Project, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return Project{}, errors.New("项目名称不能为空")
	}
	maxClaims := input.MaxClaims
	if maxClaims <= 0 {
		return Project{}, errors.New("限领人数必须是正整数（≥1）")
	}
	if input.DirectPoints <= 0 {
		return Project{}, errors.New("直充积分必须是正整数")
	}

	now := time.Now()
	project := Project{
		ID:           newProjectID(now),
		Name:         name,
		Description:  input.Description,
		MaxClaims:    maxClaims,
		ClaimedCount: 0,
		CodesCount:   maxClaims,
		Status:       "active",
		CreatedAt:    millis(now),
		CreatedBy:    strings.TrimSpace(input.CreatedBy),
		RewardType:   "direct",
		DirectPoints: &input.DirectPoints,
		NewUserOnly:  input.NewUserOnly,
	}

	if _, err := service.db.Exec(ctx,
		`INSERT INTO projects (
		   id, name, description, max_claims, claimed_count, codes_count,
		   status, created_at_ms, created_by, reward_type, direct_points,
		   new_user_only, pinned, pinned_at_ms
		 ) VALUES ($1, $2, $3, $4, 0, $4, 'active', $5, $6, 'direct', $7, $8, false, NULL)`,
		project.ID,
		project.Name,
		project.Description,
		project.MaxClaims,
		project.CreatedAt,
		project.CreatedBy,
		input.DirectPoints,
		input.NewUserOnly,
	); err != nil {
		return Project{}, err
	}

	return project, nil
}

func (service *Service) GetAdminProjectDetail(ctx context.Context, id string) (AdminProjectDetail, error) {
	project, err := service.getProject(ctx, strings.TrimSpace(id))
	if errors.Is(err, pgx.ErrNoRows) {
		return AdminProjectDetail{}, ErrProjectNotFound
	}
	if err != nil {
		return AdminProjectDetail{}, err
	}

	records, err := service.listProjectRecords(ctx, project.ID, 50)
	if err != nil {
		return AdminProjectDetail{}, err
	}
	return AdminProjectDetail{Project: project, Records: records}, nil
}

func (service *Service) UpdateAdminProject(ctx context.Context, id string, input UpdateAdminProjectInput) (Project, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return Project{}, ErrProjectNotFound
	}

	if input.Status != nil && *input.Status != "active" && *input.Status != "paused" {
		return Project{}, errors.New("项目状态无效")
	}
	if input.MaxClaims != nil && (!input.MaxClaimsValid || *input.MaxClaims <= 0) {
		return Project{}, errors.New("限领人数必须是正整数（≥1）")
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return Project{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	row := tx.QueryRow(ctx,
		`SELECT id, name, description, max_claims, claimed_count, codes_count,
		        status, created_at_ms, created_by, reward_type, direct_points,
		        new_user_only, pinned, pinned_at_ms
		   FROM projects
		  WHERE id = $1
		  FOR UPDATE`,
		id,
	)
	project, err := scanProject(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Project{}, ErrProjectNotFound
	}
	if err != nil {
		return Project{}, err
	}

	if input.Status != nil {
		project.Status = *input.Status
	}
	if input.Pinned != nil {
		project.Pinned = *input.Pinned
		if *input.Pinned {
			pinnedAt := millis(time.Now())
			project.PinnedAt = &pinnedAt
		} else {
			zero := int64(0)
			project.PinnedAt = &zero
		}
	}
	if input.Name != nil && strings.TrimSpace(*input.Name) != "" {
		project.Name = *input.Name
	}
	if input.Description != nil {
		project.Description = *input.Description
	}
	if input.MaxClaims != nil {
		project.MaxClaims = *input.MaxClaims
		if project.RewardType == "direct" {
			project.CodesCount = *input.MaxClaims
			if project.Status == "exhausted" && project.ClaimedCount < *input.MaxClaims {
				project.Status = "active"
			}
		}
	}

	updated, err := updateProjectRow(ctx, tx, project)
	if err != nil {
		return Project{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Project{}, err
	}
	return updated, nil
}

func (service *Service) DeleteAdminProject(ctx context.Context, id string) error {
	_, err := service.db.Exec(ctx, `DELETE FROM projects WHERE id = $1`, strings.TrimSpace(id))
	return err
}

func (service *Service) AppendAdminProjectClaims(ctx context.Context, id string, appendClaims int64) (Project, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return Project{}, ErrProjectNotFound
	}
	if appendClaims <= 0 {
		return Project{}, errors.New("追加名额必须是正整数（≥1）")
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return Project{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	row := tx.QueryRow(ctx,
		`SELECT id, name, description, max_claims, claimed_count, codes_count,
		        status, created_at_ms, created_by, reward_type, direct_points,
		        new_user_only, pinned, pinned_at_ms
		   FROM projects
		  WHERE id = $1
		  FOR UPDATE`,
		id,
	)
	project, err := scanProject(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Project{}, ErrProjectNotFound
	}
	if err != nil {
		return Project{}, err
	}
	if project.RewardType != "direct" {
		return Project{}, errors.New("历史兑换码项目已设为只读，不能继续追加兑换码")
	}

	project.MaxClaims += appendClaims
	project.CodesCount = project.MaxClaims
	if project.Status == "exhausted" && project.ClaimedCount < project.MaxClaims {
		project.Status = "active"
	}

	updated, err := updateProjectRow(ctx, tx, project)
	if err != nil {
		return Project{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Project{}, err
	}
	return updated, nil
}

func (service *Service) getProject(ctx context.Context, id string) (Project, error) {
	row := service.db.QueryRow(ctx,
		`SELECT id, name, description, max_claims, claimed_count, codes_count,
		        status, created_at_ms, created_by, reward_type, direct_points,
		        new_user_only, pinned, pinned_at_ms
		   FROM projects
		  WHERE id = $1`,
		id,
	)
	return scanProject(row)
}

func (service *Service) listProjectRecords(ctx context.Context, projectID string, limit int) ([]AdminProjectRecord, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := service.db.Query(ctx,
		`SELECT e.id, e.item_id, e.user_id, COALESCE(u.username, 'user-' || e.user_id::text),
		        e.value, e.type, floor(extract(epoch FROM e.created_at) * 1000)::bigint
		   FROM exchange_logs e
		   LEFT JOIN users u ON u.id = e.user_id
		  WHERE e.item_id = $1
		  ORDER BY e.created_at DESC, e.id DESC
		  LIMIT $2`,
		projectID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := make([]AdminProjectRecord, 0)
	for rows.Next() {
		var record AdminProjectRecord
		var points int64
		var logType string
		if err := rows.Scan(
			&record.ID,
			&record.ProjectID,
			&record.UserID,
			&record.Username,
			&points,
			&logType,
			&record.ClaimedAt,
		); err != nil {
			return nil, err
		}
		record.Code = ""
		record.DirectCredit = true
		record.CreditedPoints = &points
		record.CreditStatus = "success"
		record.CreditMessage = logType
		record.CreditedAt = &record.ClaimedAt
		records = append(records, record)
	}
	return records, rows.Err()
}

func scanProject(row pgxScanner) (Project, error) {
	var project Project
	var rewardType sql.NullString
	var directPoints sql.NullInt64
	var pinnedAt sql.NullInt64
	err := row.Scan(
		&project.ID,
		&project.Name,
		&project.Description,
		&project.MaxClaims,
		&project.ClaimedCount,
		&project.CodesCount,
		&project.Status,
		&project.CreatedAt,
		&project.CreatedBy,
		&rewardType,
		&directPoints,
		&project.NewUserOnly,
		&project.Pinned,
		&pinnedAt,
	)
	if err != nil {
		return Project{}, err
	}
	if rewardType.Valid {
		project.RewardType = rewardType.String
	}
	if directPoints.Valid {
		project.DirectPoints = &directPoints.Int64
	}
	if pinnedAt.Valid {
		project.PinnedAt = &pinnedAt.Int64
	}
	return project, nil
}

func updateProjectRow(ctx context.Context, tx pgx.Tx, project Project) (Project, error) {
	row := tx.QueryRow(ctx,
		`UPDATE projects
		    SET name = $2,
		        description = $3,
		        max_claims = $4,
		        codes_count = $5,
		        status = $6,
		        pinned = $7,
		        pinned_at_ms = $8,
		        updated_at = now()
		  WHERE id = $1
		  RETURNING id, name, description, max_claims, claimed_count, codes_count,
		            status, created_at_ms, created_by, reward_type, direct_points,
		            new_user_only, pinned, pinned_at_ms`,
		project.ID,
		project.Name,
		project.Description,
		project.MaxClaims,
		project.CodesCount,
		project.Status,
		project.Pinned,
		project.PinnedAt,
	)
	return scanProject(row)
}

func newProjectID(now time.Time) string {
	var buffer [8]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		return fmt.Sprintf("project_%d", now.UnixNano())
	}
	return fmt.Sprintf("project_%d_%s", millis(now), hex.EncodeToString(buffer[:]))
}
