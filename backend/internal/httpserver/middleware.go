package httpserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"
)

type contextKey string

const requestIDKey contextKey = "request_id"

func requestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestID := request.Header.Get("X-Request-Id")
		if requestID == "" {
			requestID = newRequestID()
		}
		writer.Header().Set("X-Request-Id", requestID)
		ctx := context.WithValue(request.Context(), requestIDKey, requestID)
		next.ServeHTTP(writer, request.WithContext(ctx))
	})
}

func loggingMiddleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			startedAt := time.Now()
			recorder := &statusRecorder{ResponseWriter: writer, status: http.StatusOK}
			next.ServeHTTP(recorder, request)
			logger.Info("HTTP 请求完成",
				"request_id", request.Context().Value(requestIDKey),
				"method", request.Method,
				"path", request.URL.Path,
				"status", recorder.status,
				"duration_ms", time.Since(startedAt).Milliseconds(),
			)
		})
	}
}

func recoverMiddleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			defer func() {
				if recovered := recover(); recovered != nil {
					logger.Error("HTTP panic",
						"request_id", request.Context().Value(requestIDKey),
						"panic", recovered,
						"stack", string(debug.Stack()),
					)
					writeJSON(writer, http.StatusInternalServerError, map[string]any{
						"success": false,
						"message": "服务器错误",
					})
				}
			}()
			next.ServeHTTP(writer, request)
		})
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (recorder *statusRecorder) WriteHeader(status int) {
	recorder.status = status
	recorder.ResponseWriter.WriteHeader(status)
}

func newRequestID() string {
	var buffer [16]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		return time.Now().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(buffer[:])
}
