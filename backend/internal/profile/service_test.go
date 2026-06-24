package profile

import (
	"database/sql"
	"encoding/json"
	"testing"
)

func TestPublicAchievementByID(t *testing.T) {
	expiresAt := sql.NullInt64{Int64: 1234, Valid: true}
	achievement := PublicAchievementByID("thief", expiresAt)
	if achievement == nil || achievement.ID != "thief" || achievement.ExpiresAt == nil || *achievement.ExpiresAt != 1234 {
		t.Fatalf("unexpected achievement: %#v", achievement)
	}
	if unknown := PublicAchievementByID("unknown", sql.NullInt64{}); unknown != nil {
		t.Fatalf("unknown achievement should be nil: %#v", unknown)
	}
}

func TestIsAchievementID(t *testing.T) {
	if !IsAchievementID("beginner") {
		t.Fatalf("beginner should be a known achievement")
	}
	if IsAchievementID("unknown") {
		t.Fatalf("unknown achievement should not be known")
	}
}

func TestNullStringPtr(t *testing.T) {
	if value := nullStringPtr(sql.NullString{String: "  Tester  ", Valid: true}); value == nil || *value != "Tester" {
		t.Fatalf("unexpected trimmed value: %#v", value)
	}
	if value := nullStringPtr(sql.NullString{String: "  ", Valid: true}); value != nil {
		t.Fatalf("blank value should be nil: %#v", value)
	}
	if value := nullStringPtr(sql.NullString{}); value != nil {
		t.Fatalf("invalid value should be nil: %#v", value)
	}
}

func TestProfileValidationMatchesLegacyRules(t *testing.T) {
	displayName, message := ValidateDisplayName(json.RawMessage(`"  小明  "`))
	if message != "" || displayName.Value == nil || *displayName.Value != "小明" {
		t.Fatalf("unexpected display name validation: value=%+v message=%s", displayName, message)
	}
	if _, message := ValidateDisplayName(json.RawMessage(`123`)); message != "昵称格式无效" {
		t.Fatalf("unexpected non-string display name message: %s", message)
	}
	if _, message := ValidateDisplayName(json.RawMessage(`"hi\u0000there"`)); message != "昵称包含非法字符" {
		t.Fatalf("unexpected control display name message: %s", message)
	}
	if _, message := ValidateDisplayName(json.RawMessage(`"🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂"`)); message != "昵称长度不能超过 30 个字符" {
		t.Fatalf("unexpected utf16 length message: %s", message)
	}

	avatar, message := ValidateAvatarValue(json.RawMessage(`"data:image/png;base64,AAAA"`))
	if message != "" || avatar.Value == nil || *avatar.Value != "data:image/png;base64,AAAA" {
		t.Fatalf("unexpected avatar validation: value=%+v message=%s", avatar, message)
	}
	if _, message := ValidateAvatarValue(json.RawMessage(`"ftp://example.com/a.png"`)); message != "图床链接必须是 http 或 https" {
		t.Fatalf("unexpected ftp avatar message: %s", message)
	}

	email, message := ValidateQQEmail(json.RawMessage(`"  123456@QQ.COM  "`))
	if message != "" || email.Value == nil || *email.Value != "123456@qq.com" {
		t.Fatalf("unexpected qq email validation: value=%+v message=%s", email, message)
	}
	if _, message := ValidateQQEmail(json.RawMessage(`"123456@example.com"`)); message != "请输入有效的 QQ 邮箱，例如 123456@qq.com" {
		t.Fatalf("unexpected qq email message: %s", message)
	}
}
