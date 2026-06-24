package feedback

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestMediaStoreStoresDataURLAsPublicFeedbackImage(t *testing.T) {
	store := NewMediaStore(t.TempDir(), "")
	raw := json.RawMessage(`[{"dataUrl":"data:image/png;base64,AAAA","mimeType":"image/png","size":3,"name":"a test.png"}]`)

	images, hasImages, err := store.StoreImages(context.Background(), raw, RoleUser)
	if err != nil {
		t.Fatalf("store images failed: %v", err)
	}
	if !hasImages {
		t.Fatalf("expected hasImages")
	}

	var items []MediaItem
	if err := json.Unmarshal(images, &items); err != nil {
		t.Fatalf("decode stored images failed: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one image, got %d", len(items))
	}
	if !strings.HasPrefix(items[0].DataURL, "/api/feedback/images/feedback/") ||
		items[0].MimeType != "image/png" ||
		items[0].Size != 3 ||
		items[0].Kind != "image" ||
		items[0].Name != "a-test.png" {
		t.Fatalf("unexpected stored item: %+v", items[0])
	}

	relativePath := strings.TrimPrefix(items[0].DataURL, "/api/feedback/images/")
	if _, err := os.Stat(storePathForTest(store, relativePath)); err != nil {
		t.Fatalf("expected stored file to exist: %v", err)
	}
}

func TestMediaStoreRejectsUnsupportedMedia(t *testing.T) {
	store := NewMediaStore(t.TempDir(), "")
	raw := json.RawMessage(`[{"dataUrl":"data:text/plain;base64,AAAA","mimeType":"text/plain","size":3}]`)

	_, _, err := store.StoreImages(context.Background(), raw, RoleUser)
	if err == nil || !strings.Contains(err.Error(), "仅支持") {
		t.Fatalf("expected unsupported media error, got %v", err)
	}
}

func storePathForTest(store *MediaStore, relativePath string) string {
	return store.dir + string(os.PathSeparator) + strings.ReplaceAll(relativePath, "/", string(os.PathSeparator))
}
