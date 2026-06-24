package feedback

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	MaxFeedbackMediaFiles = 4
	MaxFeedbackImageBytes = 2 * 1024 * 1024
	MaxFeedbackVideoBytes = 20 * 1024 * 1024
)

var (
	ErrMediaUnavailable = errors.New("feedback media storage unavailable")
	ErrInvalidMedia     = errors.New("invalid feedback media")
	dataURLPattern      = regexp.MustCompile(`^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$`)
)

var mediaExtensions = map[string]string{
	"image/png":       "png",
	"image/jpeg":      "jpg",
	"image/webp":      "webp",
	"image/gif":       "gif",
	"video/mp4":       "mp4",
	"video/webm":      "webm",
	"video/quicktime": "mov",
}

type MediaStore struct {
	dir       string
	publicURL string
}

type MediaItem struct {
	DataURL  string `json:"dataUrl"`
	MimeType string `json:"mimeType"`
	Size     int64  `json:"size"`
	Name     string `json:"name,omitempty"`
	Kind     string `json:"kind,omitempty"`
}

func NewMediaStore(dir string, publicURL string) *MediaStore {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return nil
	}
	return &MediaStore{
		dir:       dir,
		publicURL: strings.TrimRight(strings.TrimSpace(publicURL), "/"),
	}
}

func (store *MediaStore) StoreImages(ctx context.Context, raw json.RawMessage, role Role) (json.RawMessage, bool, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, false, nil
	}

	var input []MediaItem
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, false, fmt.Errorf("%w: 附件参数格式错误", ErrInvalidMedia)
	}
	if len(input) == 0 {
		return nil, false, nil
	}
	if len(input) > MaxFeedbackMediaFiles {
		return nil, true, fmt.Errorf("%w: 最多上传 %d 个附件", ErrInvalidMedia, MaxFeedbackMediaFiles)
	}
	if store == nil || store.dir == "" {
		return nil, true, ErrMediaUnavailable
	}

	output := make([]MediaItem, 0, len(input))
	for _, item := range input {
		stored, err := store.storeOne(ctx, role, item)
		if err != nil {
			return nil, true, err
		}
		output = append(output, stored)
	}
	encoded, err := json.Marshal(output)
	if err != nil {
		return nil, true, err
	}
	return json.RawMessage(encoded), true, nil
}

func (store *MediaStore) storeOne(ctx context.Context, role Role, item MediaItem) (MediaItem, error) {
	dataURL := strings.TrimSpace(item.DataURL)
	matched := dataURLPattern.FindStringSubmatch(dataURL)
	if matched == nil {
		return MediaItem{}, fmt.Errorf("%w: 附件数据格式无效，请重新上传", ErrInvalidMedia)
	}

	mimeType := strings.ToLower(strings.TrimSpace(matched[1]))
	ext, ok := mediaExtensions[mimeType]
	if !ok {
		return MediaItem{}, fmt.Errorf("%w: 仅支持 PNG/JPG/WEBP/GIF 图片和 MP4/WEBM/MOV 视频", ErrInvalidMedia)
	}
	bytes, err := base64.StdEncoding.DecodeString(matched[2])
	if err != nil || len(bytes) == 0 {
		return MediaItem{}, fmt.Errorf("%w: 附件数据无效，请重新上传", ErrInvalidMedia)
	}
	kind := feedbackMediaKind(mimeType)
	if kind == "image" && len(bytes) > MaxFeedbackImageBytes {
		return MediaItem{}, fmt.Errorf("%w: 单张图片不能超过 2MB", ErrInvalidMedia)
	}
	if kind == "video" && len(bytes) > MaxFeedbackVideoBytes {
		return MediaItem{}, fmt.Errorf("%w: 单个视频不能超过 20MB", ErrInvalidMedia)
	}

	select {
	case <-ctx.Done():
		return MediaItem{}, ctx.Err()
	default:
	}

	relativePath := buildMediaPath(role, ext)
	fullPath := filepath.Join(store.dir, filepath.FromSlash(relativePath))
	relative, err := filepath.Rel(filepath.Clean(store.dir), filepath.Clean(fullPath))
	if err != nil || strings.HasPrefix(relative, "..") || filepath.IsAbs(relative) {
		return MediaItem{}, fmt.Errorf("%w: 附件路径无效", ErrInvalidMedia)
	}
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		return MediaItem{}, err
	}
	if err := os.WriteFile(fullPath, bytes, 0o644); err != nil {
		return MediaItem{}, err
	}

	return MediaItem{
		DataURL:  store.publicMediaURL(relativePath),
		MimeType: mimeType,
		Size:     int64(len(bytes)),
		Name:     sanitizeMediaName(item.Name),
		Kind:     kind,
	}, nil
}

func buildMediaPath(role Role, ext string) string {
	dateBucket := time.Now().UTC().Format("20060102")
	rolePath := "user"
	if role == RoleAdmin {
		rolePath = "admin"
	}
	return "feedback/" + dateBucket + "/" + rolePath + "/" + randomMediaName() + "." + ext
}

func (store *MediaStore) publicMediaURL(relativePath string) string {
	encoded := encodeMediaPath(relativePath)
	if store.publicURL != "" {
		return store.publicURL + "/" + encoded
	}
	return "/api/feedback/images/" + encoded
}

func encodeMediaPath(relativePath string) string {
	parts := strings.Split(relativePath, "/")
	for index, part := range parts {
		parts[index] = strings.ReplaceAll(part, " ", "%20")
	}
	return strings.Join(parts, "/")
}

func randomMediaName() string {
	var bytes [12]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(bytes[:])
}

func feedbackMediaKind(mimeType string) string {
	if strings.HasPrefix(mimeType, "video/") {
		return "video"
	}
	return "image"
}

func sanitizeMediaName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	replacer := strings.NewReplacer("\\", "-", "/", "-", ":", "-", "*", "-", "?", "-", "\"", "-", "<", "-", ">", "-", "|", "-")
	name = replacer.Replace(name)
	name = strings.Join(strings.Fields(name), "-")
	runes := []rune(name)
	if len(runes) > 80 {
		return string(runes[:80])
	}
	return name
}
