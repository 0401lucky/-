package httpserver

import (
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

const feedbackMediaCacheControl = "public, max-age=31536000, immutable"

func (handlers feedbackHandlers) getImage(writer http.ResponseWriter, request *http.Request) {
	handlers.serveImage(writer, request, true)
}

func (handlers feedbackHandlers) headImage(writer http.ResponseWriter, request *http.Request) {
	handlers.serveImage(writer, request, false)
}

func (handlers feedbackHandlers) serveImage(writer http.ResponseWriter, request *http.Request, includeBody bool) {
	root := filepath.Clean(strings.TrimSpace(handlers.deps.Config.FeedbackMediaDir))
	if root == "" {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "反馈附件服务暂时不可用"})
		return
	}
	key := strings.TrimPrefix(chi.URLParam(request, "*"), "/")
	if key == "" || strings.Contains(key, "..") || !strings.HasPrefix(key, "feedback/") {
		http.NotFound(writer, request)
		return
	}

	fullPath := filepath.Clean(filepath.Join(root, filepath.FromSlash(key)))
	relative, err := filepath.Rel(root, fullPath)
	if err != nil || strings.HasPrefix(relative, "..") || filepath.IsAbs(relative) {
		http.NotFound(writer, request)
		return
	}

	file, err := os.Open(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			http.NotFound(writer, request)
			return
		}
		handlers.deps.Logger.Error("打开反馈附件失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "读取反馈附件失败"})
		return
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil || stat.IsDir() {
		http.NotFound(writer, request)
		return
	}

	contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(fullPath)))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	writer.Header().Set("Content-Type", contentType)
	writer.Header().Set("Cache-Control", feedbackMediaCacheControl)
	writer.Header().Set("Accept-Ranges", "bytes")

	if !includeBody {
		writer.Header().Set("Content-Length", strconvFormatInt(stat.Size()))
		writer.WriteHeader(http.StatusOK)
		return
	}
	http.ServeContent(writer, request, stat.Name(), stat.ModTime(), file)
}

func strconvFormatInt(value int64) string {
	return strconv.FormatInt(value, 10)
}
