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

	"redemption/backend/internal/auth"

	"github.com/jackc/pgx/v5"
)

var ErrProjectNotFound = errors.New("project not found")

func (service *Service) ListAdminProjects(ctx context.Context) ([]Project, error) {
	rows, err := service.db.Query(ctx,
		`SELECT id, name, description, max_claims, claimed_count, codes_count,
		        status, created_at_ms, created_by, reward_type, direct_points,
		        new_user_only, pinned, pinned_at_ms, auto_pause_at_ms, auto_paused_at_ms
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
		AutoPauseAt:  input.AutoPauseAt,
	}

	if _, err := service.db.Exec(ctx,
		`INSERT INTO projects (
		   id, name, description, max_claims, claimed_count, codes_count,
		   status, created_at_ms, created_by, reward_type, direct_points,
		   new_user_only, pinned, pinned_at_ms, auto_pause_at_ms, auto_paused_at_ms
		 ) VALUES ($1, $2, $3, $4, 0, $4, 'active', $5, $6, 'direct', $7, $8, false, NULL, $9, NULL)`,
		project.ID,
		project.Name,
		project.Description,
		project.MaxClaims,
		project.CreatedAt,
		project.CreatedBy,
		input.DirectPoints,
		input.NewUserOnly,
		input.AutoPauseAt,
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

func (service *Service) GetPublicProjectDetail(ctx context.Context, id string, userID *int64) (PublicProjectDetail, error) {
	project, err := service.getProject(ctx, strings.TrimSpace(id))
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicProjectDetail{}, ErrProjectNotFound
	}
	if err != nil {
		return PublicProjectDetail{}, err
	}

	var claimed *ProjectClaim
	if userID != nil && *userID > 0 {
		record, err := service.getProjectClaim(ctx, project.ID, *userID)
		if err == nil {
			claimed = &record
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return PublicProjectDetail{}, err
		}
	}

	return PublicProjectDetail{Project: project, Claimed: claimed}, nil
}

func (service *Service) ListUserProjectClaimIDs(ctx context.Context, userID int64) ([]string, error) {
	rows, err := service.db.Query(ctx,
		`SELECT DISTINCT e.item_id
		   FROM exchange_logs e
		   JOIN projects p ON p.id = e.item_id
		  WHERE e.user_id = $1
		    AND e.type = 'project_direct'
		  ORDER BY e.item_id ASC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	projectIDs := make([]string, 0)
	for rows.Next() {
		var projectID string
		if err := rows.Scan(&projectID); err != nil {
			return nil, err
		}
		projectIDs = append(projectIDs, projectID)
	}
	return projectIDs, rows.Err()
}

func (service *Service) ClaimPublicProject(ctx context.Context, id string, user auth.User) (ClaimProjectResult, error) {
	id = strings.TrimSpace(id)
	if id == "" || user.ID <= 0 {
		return ClaimProjectResult{Success: false, Message: "参数错误"}, nil
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return ClaimProjectResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := ensureProjectClaimUser(ctx, tx, user); err != nil {
		return ClaimProjectResult{}, err
	}
	lockKey := fmt.Sprintf("%s:%d", id, user.ID)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, lockKey); err != nil {
		return ClaimProjectResult{}, err
	}

	row := tx.QueryRow(ctx,
		`SELECT id, name, description, max_claims, claimed_count, codes_count,
		        status, created_at_ms, created_by, reward_type, direct_points,
		        new_user_only, pinned, pinned_at_ms, auto_pause_at_ms, auto_paused_at_ms
		   FROM projects
		  WHERE id = $1
		  FOR UPDATE`,
		id,
	)
	project, err := scanProject(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return ClaimProjectResult{}, ErrProjectNotFound
	}
	if err != nil {
		return ClaimProjectResult{}, err
	}

	existing, err := service.getProjectClaimTx(ctx, tx, project.ID, user.ID)
	if err == nil {
		return projectClaimResult("您已经领取过了", existing), tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return ClaimProjectResult{}, err
	}

	if project.Status != "active" {
		return ClaimProjectResult{Success: false, Message: "项目当前不可领取"}, tx.Commit(ctx)
	}
	if project.RewardType != "direct" || project.DirectPoints == nil || *project.DirectPoints <= 0 {
		return ClaimProjectResult{Success: false, Message: "历史兑换码项目暂不支持在 Zeabur 新后端领取"}, tx.Commit(ctx)
	}
	if project.ClaimedCount >= project.MaxClaims {
		if _, err := tx.Exec(ctx, `UPDATE projects SET status = 'exhausted', updated_at = now() WHERE id = $1 AND status = 'active'`, project.ID); err != nil {
			return ClaimProjectResult{}, err
		}
		return ClaimProjectResult{Success: false, Message: "名额已领完"}, tx.Commit(ctx)
	}
	if project.NewUserOnly {
		eligible, err := service.isNewUserForProjectClaims(ctx, tx, user.ID)
		if err != nil {
			return ClaimProjectResult{}, err
		}
		if !eligible {
			return ClaimProjectResult{Success: false, Message: "该福利仅限新人领取"}, tx.Commit(ctx)
		}
	}

	balance, err := lockProjectClaimBalance(ctx, tx, user.ID)
	if err != nil {
		return ClaimProjectResult{}, err
	}
	points := *project.DirectPoints
	nextBalance := balance + points
	if nextBalance < balance {
		return ClaimProjectResult{Success: false, Message: "积分发放失败，请稍后重试"}, tx.Commit(ctx)
	}

	now := time.Now()
	if _, err := tx.Exec(ctx,
		`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
		nextBalance,
		user.ID,
	); err != nil {
		return ClaimProjectResult{}, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
		 VALUES ($1, $2, $3, 'project_claim', $4, $5, $6)`,
		newProjectClaimID("ledger", now),
		user.ID,
		points,
		"福利项目领取: "+project.Name,
		nextBalance,
		now,
	); err != nil {
		return ClaimProjectResult{}, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO exchange_logs
		   (id, user_id, item_id, item_name, points_cost, value, type, quantity, created_at)
		 VALUES ($1, $2, $3, $4, 0, $5, 'project_direct', 1, $6)`,
		newProjectClaimID("project_claim", now),
		user.ID,
		project.ID,
		project.Name,
		points,
		now,
	); err != nil {
		return ClaimProjectResult{}, err
	}

	nextClaimedCount := project.ClaimedCount + 1
	nextStatus := project.Status
	if nextClaimedCount >= project.MaxClaims {
		nextStatus = "exhausted"
	}
	if _, err := tx.Exec(ctx,
		`UPDATE projects
		    SET claimed_count = $2,
		        status = $3,
		        updated_at = now()
		  WHERE id = $1`,
		project.ID,
		nextClaimedCount,
		nextStatus,
	); err != nil {
		return ClaimProjectResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return ClaimProjectResult{}, err
	}

	return ClaimProjectResult{
		Success:         true,
		Message:         "领取成功，积分已到账",
		DirectCredit:    true,
		CreditedPoints:  &points,
		CreditedDollars: &points,
		CreditStatus:    "success",
	}, nil
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
		        new_user_only, pinned, pinned_at_ms, auto_pause_at_ms, auto_paused_at_ms
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
		        new_user_only, pinned, pinned_at_ms, auto_pause_at_ms, auto_paused_at_ms
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

func (service *Service) ProcessAutoPauseProjects(ctx context.Context, nowMs int64, limit int64) (AutoPauseProjectsResult, error) {
	if nowMs <= 0 {
		nowMs = millis(time.Now())
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	tag, err := service.db.Exec(ctx,
		`WITH due AS (
		   SELECT id
		     FROM projects
		    WHERE status = 'active'
		      AND auto_pause_at_ms IS NOT NULL
		      AND auto_pause_at_ms <= $1
		      AND auto_paused_at_ms IS NULL
		    ORDER BY auto_pause_at_ms ASC, created_at_ms ASC, id ASC
		    LIMIT $2
		    FOR UPDATE SKIP LOCKED
		 )
		 UPDATE projects p
		    SET status = 'paused',
		        auto_paused_at_ms = $1,
		        updated_at = now()
		   FROM due
		  WHERE p.id = due.id`,
		nowMs,
		limit,
	)
	if err != nil {
		return AutoPauseProjectsResult{}, err
	}
	return AutoPauseProjectsResult{Paused: tag.RowsAffected()}, nil
}

func (service *Service) getProject(ctx context.Context, id string) (Project, error) {
	row := service.db.QueryRow(ctx,
		`SELECT id, name, description, max_claims, claimed_count, codes_count,
		        status, created_at_ms, created_by, reward_type, direct_points,
		        new_user_only, pinned, pinned_at_ms, auto_pause_at_ms, auto_paused_at_ms
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

func (service *Service) getProjectClaim(ctx context.Context, projectID string, userID int64) (ProjectClaim, error) {
	return service.getProjectClaimTx(ctx, service.db, projectID, userID)
}

func (service *Service) getProjectClaimTx(ctx context.Context, querier pgxQuerier, projectID string, userID int64) (ProjectClaim, error) {
	var claim ProjectClaim
	var value int64
	var createdAt time.Time
	err := querier.QueryRow(ctx,
		`SELECT value, created_at
		   FROM exchange_logs
		  WHERE item_id = $1
		    AND user_id = $2
		    AND type = 'project_direct'
		  ORDER BY created_at ASC, id ASC
		  LIMIT 1`,
		projectID,
		userID,
	).Scan(&value, &createdAt)
	if err != nil {
		return ProjectClaim{}, err
	}
	claim.Code = ""
	claim.ClaimedAt = millis(createdAt)
	claim.DirectCredit = true
	claim.CreditedPoints = &value
	claim.CreditedDollars = &value
	claim.CreditStatus = "success"
	claim.CreditMessage = "积分已到账"
	return claim, nil
}

func (service *Service) isNewUserForProjectClaims(ctx context.Context, querier pgxQuerier, userID int64) (bool, error) {
	var claimedNewUserProject bool
	err := querier.QueryRow(ctx,
		`SELECT EXISTS (
		   SELECT 1
		     FROM exchange_logs e
		     JOIN projects p ON p.id = e.item_id
		    WHERE e.user_id = $1
		      AND e.type = 'project_direct'
		      AND p.new_user_only = true
		 )`,
		userID,
	).Scan(&claimedNewUserProject)
	if err != nil {
		return false, err
	}
	return !claimedNewUserProject, nil
}

func projectClaimResult(message string, claim ProjectClaim) ClaimProjectResult {
	return ClaimProjectResult{
		Success:         true,
		Message:         message,
		Code:            claim.Code,
		DirectCredit:    claim.DirectCredit,
		CreditedPoints:  claim.CreditedPoints,
		CreditedDollars: claim.CreditedDollars,
		CreditStatus:    claim.CreditStatus,
	}
}

func ensureProjectClaimUser(ctx context.Context, tx pgx.Tx, user auth.User) error {
	username := strings.TrimSpace(user.Username)
	if username == "" {
		username = fmt.Sprintf("user-%d", user.ID)
	}
	displayName := strings.TrimSpace(user.DisplayName)
	if displayName == "" {
		displayName = username
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $3, now(), now())
		 ON CONFLICT (id) DO UPDATE SET
		   username = excluded.username,
		   display_name = CASE
		     WHEN excluded.display_name <> '' THEN excluded.display_name
		     ELSE users.display_name
		   END,
		   updated_at = now()`,
		user.ID,
		username,
		displayName,
	); err != nil {
		return err
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())
		 ON CONFLICT (user_id) DO NOTHING`,
		user.ID,
	)
	return err
}

func lockProjectClaimBalance(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	var balance int64
	err := tx.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1 FOR UPDATE`, userID).Scan(&balance)
	return balance, err
}

func scanProject(row pgxScanner) (Project, error) {
	var project Project
	var rewardType sql.NullString
	var directPoints sql.NullInt64
	var pinnedAt sql.NullInt64
	var autoPauseAt sql.NullInt64
	var autoPausedAt sql.NullInt64
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
		&autoPauseAt,
		&autoPausedAt,
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
	if autoPauseAt.Valid {
		project.AutoPauseAt = &autoPauseAt.Int64
	}
	if autoPausedAt.Valid {
		project.AutoPausedAt = &autoPausedAt.Int64
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
		        auto_pause_at_ms = $9,
		        auto_paused_at_ms = $10,
		        updated_at = now()
		  WHERE id = $1
		  RETURNING id, name, description, max_claims, claimed_count, codes_count,
		            status, created_at_ms, created_by, reward_type, direct_points,
		            new_user_only, pinned, pinned_at_ms, auto_pause_at_ms, auto_paused_at_ms`,
		project.ID,
		project.Name,
		project.Description,
		project.MaxClaims,
		project.CodesCount,
		project.Status,
		project.Pinned,
		project.PinnedAt,
		project.AutoPauseAt,
		project.AutoPausedAt,
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

func newProjectClaimID(prefix string, now time.Time) string {
	var buffer [8]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		return fmt.Sprintf("%s_%d", prefix, now.UnixNano())
	}
	return fmt.Sprintf("%s_%d_%s", prefix, millis(now), hex.EncodeToString(buffer[:]))
}
