package oidcconfig

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnavailable = errors.New("OIDC configuration database unavailable")
	ErrInvalid     = errors.New("invalid OIDC configuration")
)

const CallbackPath = "/api/auth/oidc/callback"

type Settings struct {
	Enabled                bool   `json:"enabled"`
	DisplayName            string `json:"displayName"`
	IssuerURL              string `json:"issuerUrl"`
	DiscoveryURL           string `json:"discoveryUrl"`
	ClientID               string `json:"clientId"`
	RedirectURL            string `json:"redirectUrl"`
	Scopes                 string `json:"scopes"`
	TokenAuthMethod        string `json:"tokenAuthMethod"`
	NewAPIProvider         string `json:"newApiProvider"`
	NewAPIProviderID       int64  `json:"newApiProviderId"`
	SubjectClaim           string `json:"subjectClaim"`
	UsernameClaim          string `json:"usernameClaim"`
	ClientSecretConfigured bool   `json:"clientSecretConfigured"`
	UpdatedAt              int64  `json:"updatedAt,omitempty"`
	UpdatedBy              string `json:"updatedBy,omitempty"`
	ClientSecret           string `json:"-"`
	Revision               string `json:"-"`
}

type Service struct {
	db   *pgxpool.Pool
	aead cipher.AEAD
}

func NewService(db *pgxpool.Pool, sessionSecret string) *Service {
	mac := hmac.New(sha256.New, []byte(sessionSecret))
	_, _ = mac.Write([]byte("welfare:oidc-client-secret:v1"))
	block, _ := aes.NewCipher(mac.Sum(nil))
	aead, _ := cipher.NewGCM(block)
	return &Service{db: db, aead: aead}
}

func Defaults() Settings {
	return Settings{
		DisplayName: "Casdoor", Scopes: "openid profile email",
		TokenAuthMethod: "client_secret_post", NewAPIProvider: "oidc",
		SubjectClaim: "sub", UsernameClaim: "preferred_username",
	}
}

// Get reads on every request so settings are immediately shared by all API replicas.
func (service *Service) Get(ctx context.Context) (Settings, error) {
	if service.db == nil {
		return Settings{}, ErrUnavailable
	}
	settings := Defaults()
	var raw []byte
	var encrypted string
	err := service.db.QueryRow(ctx,
		`SELECT settings, encrypted_client_secret, revision, updated_at_ms, updated_by
		 FROM oidc_config WHERE id = 'default'`,
	).Scan(&raw, &encrypted, &settings.Revision, &settings.UpdatedAt, &settings.UpdatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return settings, nil
	}
	if err != nil {
		return Settings{}, err
	}
	if err := json.Unmarshal(raw, &settings); err != nil {
		return Settings{}, err
	}
	settings.ClientSecretConfigured = encrypted != ""
	return settings, nil
}

// WithSecret is only used by server-side OAuth operations, never by response encoding.
func (service *Service) WithSecret(ctx context.Context, settings Settings) (Settings, error) {
	if service.db == nil {
		return Settings{}, ErrUnavailable
	}
	var encrypted string
	err := service.db.QueryRow(ctx,
		`SELECT encrypted_client_secret FROM oidc_config WHERE id = 'default' AND revision = $1`,
		settings.Revision,
	).Scan(&encrypted)
	if err != nil {
		return Settings{}, err
	}
	settings.ClientSecret, err = service.decrypt(encrypted)
	return settings, err
}

func (service *Service) Save(ctx context.Context, settings Settings, secret *string, updatedBy string) (Settings, error) {
	if service.db == nil {
		return Settings{}, ErrUnavailable
	}
	tx, err := service.db.Begin(ctx)
	if err != nil {
		return Settings{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// Serialize saves, including the first insertion, to preserve a retained secret.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(73380241)`); err != nil {
		return Settings{}, err
	}
	var previousRaw []byte
	var encrypted string
	err = tx.QueryRow(ctx, `SELECT settings, encrypted_client_secret FROM oidc_config WHERE id = 'default'`).Scan(&previousRaw, &encrypted)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Settings{}, err
	}
	previous := Defaults()
	if len(previousRaw) > 0 {
		if err := json.Unmarshal(previousRaw, &previous); err != nil {
			return Settings{}, err
		}
	}
	if secret != nil && *secret != "" {
		if len(*secret) > 4096 {
			return Settings{}, fmt.Errorf("%w: 客户端密钥过长", ErrInvalid)
		}
		encrypted, err = service.encrypt(*secret)
		if err != nil {
			return Settings{}, err
		}
	} else if encrypted != "" && (settings.IssuerURL != previous.IssuerURL || settings.DiscoveryURL != previous.DiscoveryURL || settings.ClientID != previous.ClientID) {
		return Settings{}, fmt.Errorf("%w: 修改身份服务或客户端 ID 时，请重新填写客户端密钥", ErrInvalid)
	}
	settings, err = Validate(settings, encrypted != "")
	if err != nil {
		return Settings{}, err
	}
	settings.UpdatedAt = time.Now().UnixMilli()
	settings.UpdatedBy = updatedBy
	settings.ClientSecretConfigured = encrypted != ""
	revision := make([]byte, 24)
	if _, err := rand.Read(revision); err != nil {
		return Settings{}, err
	}
	settings.Revision = base64.RawURLEncoding.EncodeToString(revision)
	raw, err := json.Marshal(settings)
	if err != nil {
		return Settings{}, err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO oidc_config (id, settings, encrypted_client_secret, revision, updated_at_ms, updated_by)
		 VALUES ('default', $1, $2, $3, $4, $5)
		 ON CONFLICT (id) DO UPDATE SET settings = excluded.settings,
		 encrypted_client_secret = excluded.encrypted_client_secret, revision = excluded.revision,
		 updated_at_ms = excluded.updated_at_ms, updated_by = excluded.updated_by`,
		raw, encrypted, settings.Revision, settings.UpdatedAt, settings.UpdatedBy,
	)
	if err != nil {
		return Settings{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Settings{}, err
	}
	return settings, nil
}

var claimPath = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*$`)

func Validate(settings Settings, hasSecret bool) (Settings, error) {
	settings.DisplayName = strings.TrimSpace(settings.DisplayName)
	settings.IssuerURL = strings.TrimSpace(settings.IssuerURL)
	settings.DiscoveryURL = strings.TrimSpace(settings.DiscoveryURL)
	settings.ClientID = strings.TrimSpace(settings.ClientID)
	settings.RedirectURL = strings.TrimSpace(settings.RedirectURL)
	settings.Scopes = strings.Join(strings.Fields(settings.Scopes), " ")
	settings.SubjectClaim = strings.TrimSpace(settings.SubjectClaim)
	settings.UsernameClaim = strings.TrimSpace(settings.UsernameClaim)
	if settings.DisplayName == "" || len([]rune(settings.DisplayName)) > 60 {
		return Settings{}, fmt.Errorf("%w: 登录按钮名称须为 1–60 个字符", ErrInvalid)
	}
	if settings.NewAPIProvider != "oidc" && settings.NewAPIProvider != "custom" {
		return Settings{}, fmt.Errorf("%w: 请选择 new-api 的内置 OIDC 或自定义 OAuth", ErrInvalid)
	}
	if settings.NewAPIProvider == "custom" && (settings.NewAPIProviderID <= 0 || settings.NewAPIProviderID > 9007199254740991) {
		return Settings{}, fmt.Errorf("%w: 自定义 OAuth 的提供商 ID 必须为正整数", ErrInvalid)
	}
	if settings.NewAPIProvider == "oidc" {
		settings.NewAPIProviderID = 0
	}
	if settings.TokenAuthMethod != "client_secret_post" && settings.TokenAuthMethod != "client_secret_basic" {
		return Settings{}, fmt.Errorf("%w: 不支持的客户端认证方式", ErrInvalid)
	}
	if len(settings.SubjectClaim) > 128 || !claimPath.MatchString(settings.SubjectClaim) || len(settings.UsernameClaim) > 128 || !claimPath.MatchString(settings.UsernameClaim) {
		return Settings{}, fmt.Errorf("%w: 身份和用户名字段须为有效的字段路径", ErrInvalid)
	}
	if settings.NewAPIProvider == "oidc" && settings.SubjectClaim != "sub" {
		return Settings{}, fmt.Errorf("%w: new-api 内置 OIDC 的绑定身份字段必须为 sub", ErrInvalid)
	}
	if len(settings.ClientID) > 512 || len(settings.Scopes) > 512 {
		return Settings{}, fmt.Errorf("%w: 客户端 ID 或授权范围过长", ErrInvalid)
	}
	for _, entry := range []struct{ label, value string }{
		{"Issuer 地址", settings.IssuerURL}, {"发现文档地址", settings.DiscoveryURL}, {"回调地址", settings.RedirectURL},
	} {
		if entry.value != "" && ValidateURL(entry.value) != nil {
			return Settings{}, fmt.Errorf("%w: %s须使用 HTTPS，本机开发可使用 HTTP", ErrInvalid, entry.label)
		}
	}
	if settings.IssuerURL != "" {
		parsed, _ := url.Parse(settings.IssuerURL)
		if parsed.RawQuery != "" {
			return Settings{}, fmt.Errorf("%w: Issuer 地址不能包含查询参数", ErrInvalid)
		}
	}
	if settings.RedirectURL != "" {
		parsed, _ := url.Parse(settings.RedirectURL)
		if parsed.Path != CallbackPath || parsed.RawQuery != "" || parsed.RawPath != "" {
			return Settings{}, fmt.Errorf("%w: 回调地址路径必须为 %s", ErrInvalid, CallbackPath)
		}
	}
	if settings.Enabled && (settings.IssuerURL == "" || settings.ClientID == "" || settings.RedirectURL == "" || !hasSecret) {
		return Settings{}, fmt.Errorf("%w: 启用前请填写 Issuer、客户端 ID、客户端密钥和回调地址", ErrInvalid)
	}
	if !contains(strings.Fields(settings.Scopes), "openid") {
		return Settings{}, fmt.Errorf("%w: 授权范围必须包含 openid", ErrInvalid)
	}
	return settings, nil
}

func ValidateURL(value string) error {
	parsed, err := url.Parse(value)
	if err != nil || len(value) > 2048 || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" || strings.ContainsAny(value, "\\\r\n\t") {
		return ErrInvalid
	}
	if parsed.Scheme == "https" {
		return nil
	}
	if parsed.Scheme == "http" {
		host := parsed.Hostname()
		ip := net.ParseIP(host)
		if strings.EqualFold(host, "localhost") || (ip != nil && ip.IsLoopback()) {
			return nil
		}
	}
	return ErrInvalid
}

func contains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

func (service *Service) encrypt(secret string) (string, error) {
	nonce := make([]byte, service.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	raw := service.aead.Seal(nonce, nonce, []byte(secret), []byte("oidc_config:default:v1"))
	return "v1:" + base64.RawURLEncoding.EncodeToString(raw), nil
}

func (service *Service) decrypt(encrypted string) (string, error) {
	if encrypted == "" {
		return "", nil
	}
	if !strings.HasPrefix(encrypted, "v1:") {
		return "", errors.New("unsupported OIDC secret format")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(encrypted, "v1:"))
	if err != nil || len(raw) < service.aead.NonceSize() {
		return "", errors.New("invalid encrypted OIDC secret")
	}
	nonce := raw[:service.aead.NonceSize()]
	plaintext, err := service.aead.Open(nil, nonce, raw[service.aead.NonceSize():], []byte("oidc_config:default:v1"))
	if err != nil {
		return "", errors.New("OIDC secret could not be decrypted")
	}
	return string(plaintext), nil
}
