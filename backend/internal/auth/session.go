package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

type SessionData struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Exp         int64  `json:"exp"`
	Iat         int64  `json:"iat"`
	JTI         string `json:"jti"`
}

type User struct {
	ID          int64
	Username    string
	DisplayName string
	IsAdmin     bool
	JTI         string
}

func ParseSessionToken(token string, secret string, admins map[string]struct{}) (*User, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, false
	}

	payload := parts[0]
	signature := parts[1]
	if !verifySignature(payload, signature, secret) {
		return nil, false
	}

	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return nil, false
	}

	var data SessionData
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, false
	}
	if !data.valid() {
		return nil, false
	}
	if data.Exp < time.Now().UnixMilli() {
		return nil, false
	}

	_, isAdmin := admins[data.Username]
	return &User{
		ID:          data.ID,
		Username:    data.Username,
		DisplayName: data.DisplayName,
		IsAdmin:     isAdmin,
		JTI:         data.JTI,
	}, true
}

func UserFromRequest(request *http.Request, secret string, admins map[string]struct{}) (*User, bool) {
	if cookie, err := request.Cookie("app_session"); err == nil && cookie.Value != "" {
		return ParseSessionToken(cookie.Value, secret, admins)
	}
	if cookie, err := request.Cookie("session"); err == nil && cookie.Value != "" {
		return ParseSessionToken(cookie.Value, secret, admins)
	}
	return nil, false
}

func (data SessionData) valid() bool {
	return data.ID > 0 &&
		data.Username != "" &&
		data.DisplayName != "" &&
		data.Exp > 0 &&
		data.Iat > 0 &&
		data.JTI != ""
}

func verifySignature(payload string, signature string, secret string) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	expected := hex.EncodeToString(mac.Sum(nil))

	maxLen := max(len(expected), len(signature))
	expectedBytes := make([]byte, maxLen)
	actualBytes := make([]byte, maxLen)
	copy(expectedBytes, expected)
	copy(actualBytes, signature)

	return subtle.ConstantTimeCompare(expectedBytes, actualBytes) == 1 && len(expected) == len(signature)
}
