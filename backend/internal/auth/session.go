package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

const SessionTTL = 7 * 24 * time.Hour

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
	Iat         int64
	Exp         int64
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
		Iat:         data.Iat,
		Exp:         data.Exp,
	}, true
}

func CreateSessionToken(data SessionData, secret string) (string, error) {
	if data.Iat == 0 {
		data.Iat = time.Now().UnixMilli()
	}
	if data.Exp == 0 {
		data.Exp = time.Now().Add(SessionTTL).UnixMilli()
	}
	if data.JTI == "" {
		jti, err := randomHex(16)
		if err != nil {
			return "", err
		}
		data.JTI = jti
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return "", err
	}
	payload := base64.StdEncoding.EncodeToString(raw)
	return payload + "." + signPayload(payload, secret), nil
}

func SessionTokenFromRequest(request *http.Request) string {
	if cookie, err := request.Cookie("app_session"); err == nil && cookie.Value != "" {
		return cookie.Value
	}
	if cookie, err := request.Cookie("session"); err == nil && cookie.Value != "" {
		return cookie.Value
	}
	return ""
}

func UserFromRequest(request *http.Request, secret string, admins map[string]struct{}) (*User, bool) {
	token := SessionTokenFromRequest(request)
	if token == "" {
		return nil, false
	}
	return ParseSessionToken(token, secret, admins)
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
	expected := signPayload(payload, secret)

	maxLen := max(len(expected), len(signature))
	expectedBytes := make([]byte, maxLen)
	actualBytes := make([]byte, maxLen)
	copy(expectedBytes, expected)
	copy(actualBytes, signature)

	return subtle.ConstantTimeCompare(expectedBytes, actualBytes) == 1 && len(expected) == len(signature)
}

func signPayload(payload string, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func randomHex(size int) (string, error) {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}
