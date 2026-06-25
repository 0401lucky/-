package config

import (
	"errors"
	"os"
	"strings"
)

type Config struct {
	AppMode                string
	Port                   string
	DatabaseURL            string
	RedisURL               string
	SessionSecret          string
	AdminUsernames         map[string]struct{}
	InternalAPISecret      string
	NewAPIURL              string
	NewAPIAdminAccessToken string
	NewAPIAdminUserID      string

	R2PublicURL          string
	S3Endpoint           string
	S3AccessKeyID        string
	S3SecretAccessKey    string
	S3FeedbackImagesName string
	S3CardImagesName     string
	FeedbackMediaDir     string
	FeedbackMediaURL     string
	ResendAPIKey         string
	ResendAPIURL         string
	FarmMailFrom         string
}

func Load() (Config, error) {
	cfg := Config{
		AppMode:                valueOrDefault("APP_MODE", "api"),
		Port:                   valueOrDefault("PORT", "8080"),
		DatabaseURL:            strings.TrimSpace(os.Getenv("DATABASE_URL")),
		RedisURL:               strings.TrimSpace(os.Getenv("REDIS_URL")),
		SessionSecret:          strings.TrimSpace(os.Getenv("SESSION_SECRET")),
		InternalAPISecret:      strings.TrimSpace(os.Getenv("INTERNAL_API_SECRET")),
		NewAPIURL:              strings.TrimSpace(os.Getenv("NEW_API_URL")),
		NewAPIAdminAccessToken: strings.TrimSpace(os.Getenv("NEW_API_ADMIN_ACCESS_TOKEN")),
		NewAPIAdminUserID:      strings.TrimSpace(os.Getenv("NEW_API_ADMIN_USER_ID")),
		R2PublicURL:            strings.TrimRight(strings.TrimSpace(os.Getenv("R2_PUBLIC_URL")), "/"),
		S3Endpoint:             strings.TrimSpace(os.Getenv("S3_ENDPOINT")),
		S3AccessKeyID:          strings.TrimSpace(os.Getenv("S3_ACCESS_KEY_ID")),
		S3SecretAccessKey:      strings.TrimSpace(os.Getenv("S3_SECRET_ACCESS_KEY")),
		S3FeedbackImagesName:   valueOrDefault("S3_BUCKET_FEEDBACK_IMAGES", "feedback-images"),
		S3CardImagesName:       valueOrDefault("S3_BUCKET_CARD_IMAGES", "card-images"),
		FeedbackMediaDir:       valueOrDefault("FEEDBACK_MEDIA_DIR", "/data/feedback-media"),
		FeedbackMediaURL:       strings.TrimRight(strings.TrimSpace(os.Getenv("FEEDBACK_MEDIA_PUBLIC_URL")), "/"),
		ResendAPIKey:           strings.TrimSpace(os.Getenv("RESEND_API_KEY")),
		ResendAPIURL:           valueOrDefault("RESEND_API_URL", "https://api.resend.com/emails"),
		FarmMailFrom:           strings.TrimSpace(os.Getenv("FARM_MAIL_FROM")),
		AdminUsernames:         parseAdminUsernames(os.Getenv("ADMIN_USERNAMES")),
	}

	if cfg.DatabaseURL == "" {
		return cfg, errors.New("DATABASE_URL is required")
	}
	if cfg.RedisURL == "" {
		return cfg, errors.New("REDIS_URL is required")
	}
	if len(cfg.SessionSecret) < 32 {
		return cfg, errors.New("SESSION_SECRET must be at least 32 characters")
	}

	return cfg, nil
}

func valueOrDefault(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func parseAdminUsernames(raw string) map[string]struct{} {
	result := make(map[string]struct{})
	for _, item := range strings.Split(raw, ",") {
		username := strings.TrimSpace(item)
		if username == "" {
			continue
		}
		result[username] = struct{}{}
	}
	return result
}
