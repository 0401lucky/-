package profile

import (
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf16"
)

const (
	customDisplayNameMinLength = 1
	customDisplayNameMaxLength = 30
	customAvatarMaxLength      = 80 * 1024
	qqEmailMaxLength           = 254
)

var (
	avatarDataURLPattern = regexp.MustCompile(`(?i)^data:image/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$`)
	qqEmailPattern       = regexp.MustCompile(`^[1-9][0-9]{4,11}@qq\.com$`)
)

type NullableStringPatch struct {
	Set   bool
	Value *string
}

type SettingsPatch struct {
	DisplayName NullableStringPatch
	AvatarURL   NullableStringPatch
	QQEmail     NullableStringPatch
}

func (patch SettingsPatch) Empty() bool {
	return !patch.DisplayName.Set && !patch.AvatarURL.Set && !patch.QQEmail.Set
}

func ValidateDisplayName(raw json.RawMessage) (NullableStringPatch, string) {
	value, warning := stringPatchFromRaw(raw, "昵称格式无效")
	if warning != "" || value.Value == nil {
		return value, warning
	}
	length := utf16CodeUnitLength(*value.Value)
	if length < customDisplayNameMinLength {
		return NullableStringPatch{Set: true}, "昵称长度不能少于 1 个字符"
	}
	if length > customDisplayNameMaxLength {
		return NullableStringPatch{Set: true}, "昵称长度不能超过 30 个字符"
	}
	if hasASCIIControlChar(*value.Value) {
		return NullableStringPatch{Set: true}, "昵称包含非法字符"
	}
	return value, ""
}

func ValidateAvatarValue(raw json.RawMessage) (NullableStringPatch, string) {
	value, warning := stringPatchFromRaw(raw, "头像格式无效")
	if warning != "" || value.Value == nil {
		return value, warning
	}
	if len(*value.Value) > customAvatarMaxLength {
		return NullableStringPatch{Set: true}, "头像数据过大，请使用更小的图片"
	}
	if strings.HasPrefix(*value.Value, "data:") {
		if !avatarDataURLPattern.MatchString(*value.Value) {
			return NullableStringPatch{Set: true}, "本地图片格式不被支持"
		}
		return value, ""
	}

	parsed, err := url.Parse(*value.Value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return NullableStringPatch{Set: true}, "头像链接格式无效"
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return NullableStringPatch{Set: true}, "图床链接必须是 http 或 https"
	}
	return value, ""
}

func ValidateQQEmail(raw json.RawMessage) (NullableStringPatch, string) {
	value, warning := stringPatchFromRaw(raw, "QQ 邮箱格式无效")
	if warning != "" || value.Value == nil {
		return value, warning
	}
	normalized := strings.ToLower(*value.Value)
	if len(normalized) > qqEmailMaxLength {
		return NullableStringPatch{Set: true}, "QQ 邮箱长度过长"
	}
	if hasASCIIControlChar(normalized) {
		return NullableStringPatch{Set: true}, "QQ 邮箱包含非法字符"
	}
	if !qqEmailPattern.MatchString(normalized) {
		return NullableStringPatch{Set: true}, "请输入有效的 QQ 邮箱，例如 123456@qq.com"
	}
	return NullableStringPatch{Set: true, Value: &normalized}, ""
}

func stringPatchFromRaw(raw json.RawMessage, typeMessage string) (NullableStringPatch, string) {
	if len(raw) == 0 || string(raw) == "null" || string(raw) == `""` {
		return NullableStringPatch{Set: true}, ""
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return NullableStringPatch{Set: true}, typeMessage
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return NullableStringPatch{Set: true}, ""
	}
	return NullableStringPatch{Set: true, Value: &value}, ""
}

func hasASCIIControlChar(value string) bool {
	for _, char := range value {
		if char <= 0x1f || char == 0x7f {
			return true
		}
	}
	return false
}

func utf16CodeUnitLength(value string) int {
	return len(utf16.Encode([]rune(value)))
}
