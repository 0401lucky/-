package profile

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrUnavailable = errors.New("profile database unavailable")
var ErrForcedAchievementActive = errors.New("当前有强制佩戴成就，暂时无法更换")
var ErrAchievementLocked = errors.New("只能佩戴已解锁的成就")

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (service *Service) GetSettings(ctx context.Context, userID int64, nowMs int64) (SettingsData, error) {
	if service.db == nil {
		return SettingsData{}, ErrUnavailable
	}
	var data SettingsData
	var displayName sql.NullString
	var avatarURL sql.NullString
	var qqEmail sql.NullString
	var updatedAt sql.NullInt64
	if err := service.db.QueryRow(ctx,
		`SELECT display_name, avatar_url, qq_email, updated_at_ms
		   FROM user_profiles
		  WHERE user_id = $1`,
		userID,
	).Scan(&displayName, &avatarURL, &qqEmail, &updatedAt); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) && !errors.Is(err, sql.ErrNoRows) {
			return SettingsData{}, err
		}
	} else {
		data.DisplayName = nullStringPtr(displayName)
		data.AvatarURL = nullStringPtr(avatarURL)
		data.QQEmail = nullStringPtr(qqEmail)
		if updatedAt.Valid {
			value := updatedAt.Int64
			data.UpdatedAt = &value
		}
	}

	achievement, err := service.GetEquippedAchievement(ctx, userID, nowMs)
	if err != nil {
		return SettingsData{}, err
	}
	data.EquippedAchievement = achievement
	return data, nil
}

func (service *Service) UpdateSettings(ctx context.Context, userID int64, patch SettingsPatch, nowMs int64) (SettingsData, error) {
	if service.db == nil {
		return SettingsData{}, ErrUnavailable
	}
	if userID <= 0 {
		return SettingsData{}, fmt.Errorf("invalid user id")
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return SettingsData{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	now := millisToTime(nowMs)
	username := fmt.Sprintf("user_%d", userID)
	if _, err := tx.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, $3, $3)
		 ON CONFLICT (id) DO NOTHING`,
		userID,
		username,
		now,
	); err != nil {
		return SettingsData{}, err
	}

	var currentDisplayName sql.NullString
	var currentAvatarURL sql.NullString
	var currentQQEmail sql.NullString
	err = tx.QueryRow(ctx,
		`SELECT display_name, avatar_url, qq_email
		   FROM user_profiles
		  WHERE user_id = $1
		  FOR UPDATE`,
		userID,
	).Scan(&currentDisplayName, &currentAvatarURL, &currentQQEmail)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) && !errors.Is(err, sql.ErrNoRows) {
		return SettingsData{}, err
	}

	nextDisplayName := nullStringPtr(currentDisplayName)
	nextAvatarURL := nullStringPtr(currentAvatarURL)
	nextQQEmail := nullStringPtr(currentQQEmail)
	if patch.DisplayName.Set {
		nextDisplayName = patch.DisplayName.Value
	}
	if patch.AvatarURL.Set {
		nextAvatarURL = patch.AvatarURL.Value
	}
	if patch.QQEmail.Set {
		nextQQEmail = patch.QQEmail.Value
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO user_profiles (user_id, display_name, avatar_url, qq_email, updated_at_ms, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (user_id) DO UPDATE SET
		   display_name = excluded.display_name,
		   avatar_url = excluded.avatar_url,
		   qq_email = excluded.qq_email,
		   updated_at_ms = excluded.updated_at_ms,
		   updated_at = excluded.updated_at`,
		userID,
		nullableString(nextDisplayName),
		nullableString(nextAvatarURL),
		nullableString(nextQQEmail),
		nowMs,
		now,
	); err != nil {
		return SettingsData{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return SettingsData{}, err
	}

	updatedAt := nowMs
	return SettingsData{
		DisplayName: nextDisplayName,
		AvatarURL:   nextAvatarURL,
		QQEmail:     nextQQEmail,
		UpdatedAt:   &updatedAt,
	}, nil
}

func (service *Service) GetEquippedAchievement(ctx context.Context, userID int64, nowMs int64) (*PublicAchievement, error) {
	if service.db == nil {
		return nil, ErrUnavailable
	}
	var achievementID sql.NullString
	var expiresAt sql.NullInt64
	err := service.db.QueryRow(ctx,
		`SELECT candidate.achievement_id, grant_row.expires_at_ms
		   FROM (
		         SELECT f.achievement_id, 0 AS priority
		           FROM user_forced_achievements f
		          WHERE f.user_id = $1
		            AND f.until_ms > $2
		         UNION ALL
		         SELECT e.achievement_id, 1 AS priority
		           FROM user_equipped_achievements e
		          WHERE e.user_id = $1
		   ) candidate
		   JOIN user_achievement_grants grant_row
		     ON grant_row.user_id = $1
		    AND grant_row.achievement_id = candidate.achievement_id
		    AND (grant_row.expires_at_ms IS NULL OR grant_row.expires_at_ms > $2)
		  ORDER BY candidate.priority
		  LIMIT 1`,
		userID,
		nowMs,
	).Scan(&achievementID, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !achievementID.Valid {
		return nil, nil
	}
	return PublicAchievementByID(achievementID.String, expiresAt), nil
}

func (service *Service) EquipAchievement(ctx context.Context, userID int64, achievementID *string, nowMs int64) (EquipAchievementResult, error) {
	if service.db == nil {
		return EquipAchievementResult{}, ErrUnavailable
	}
	if userID <= 0 {
		return EquipAchievementResult{}, fmt.Errorf("invalid user id")
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return EquipAchievementResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var forcedID sql.NullString
	var forcedUntil sql.NullInt64
	err = tx.QueryRow(ctx,
		`SELECT achievement_id, until_ms
		   FROM user_forced_achievements
		  WHERE user_id = $1
		    AND until_ms > $2
		  FOR UPDATE`,
		userID,
		nowMs,
	).Scan(&forcedID, &forcedUntil)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) && !errors.Is(err, sql.ErrNoRows) {
		return EquipAchievementResult{}, err
	}
	if err == nil && forcedID.Valid && forcedUntil.Valid {
		return EquipAchievementResult{}, ErrForcedAchievementActive
	}

	if achievementID == nil {
		if _, err := tx.Exec(ctx, `DELETE FROM user_equipped_achievements WHERE user_id = $1`, userID); err != nil {
			return EquipAchievementResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return EquipAchievementResult{}, err
		}
		return EquipAchievementResult{}, nil
	}

	var expiresAt sql.NullInt64
	err = tx.QueryRow(ctx,
		`SELECT expires_at_ms
		   FROM user_achievement_grants
		  WHERE user_id = $1
		    AND achievement_id = $2
		    AND (expires_at_ms IS NULL OR expires_at_ms > $3)
		  FOR UPDATE`,
		userID,
		*achievementID,
		nowMs,
	).Scan(&expiresAt)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		return EquipAchievementResult{}, ErrAchievementLocked
	}
	if err != nil {
		return EquipAchievementResult{}, err
	}

	now := millisToTime(nowMs)
	if _, err := tx.Exec(ctx,
		`INSERT INTO user_equipped_achievements (user_id, achievement_id, updated_at_ms, updated_at)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id) DO UPDATE SET
		   achievement_id = excluded.achievement_id,
		   updated_at_ms = excluded.updated_at_ms,
		   updated_at = excluded.updated_at`,
		userID,
		*achievementID,
		nowMs,
		now,
	); err != nil {
		return EquipAchievementResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return EquipAchievementResult{}, err
	}

	equipped := PublicAchievementByID(*achievementID, expiresAt)
	equippedID := *achievementID
	return EquipAchievementResult{EquippedID: &equippedID, Equipped: equipped}, nil
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	text := strings.TrimSpace(value.String)
	if text == "" {
		return nil
	}
	return &text
}

func nullableString(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return *value
}

func millisToTime(millis int64) time.Time {
	if millis <= 0 {
		return time.Now().UTC()
	}
	return time.UnixMilli(millis).UTC()
}
