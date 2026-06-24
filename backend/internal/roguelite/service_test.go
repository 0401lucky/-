package roguelite

import (
	"testing"

	"redemption/backend/internal/auth"
)

func zeroUser() auth.User {
	return auth.User{ID: 1001, Username: "roguelite-test", DisplayName: "Roguelite Test"}
}

func TestActionCountersAndCompaction(t *testing.T) {
	session := Session{Actions: []Action{}}
	for i := 0; i < MaxActions; i++ {
		appendCompactAction(&session, Action{Type: "move", To: StartPosition})
	}
	if getActionCount(session) != MaxActions || getMoveCount(session) != MaxActions {
		t.Fatalf("unexpected counters: action=%d move=%d", getActionCount(session), getMoveCount(session))
	}
	if len(session.Actions) != retainedActionLogLimit {
		t.Fatalf("unexpected retained actions: %d", len(session.Actions))
	}
	appendCompactAction(&session, Action{Type: "escape"})
	if getActionCount(session) != MaxActions+1 || getMoveCount(session) != MaxActions {
		t.Fatalf("escape should increment only action count: action=%d move=%d", getActionCount(session), getMoveCount(session))
	}
}

func TestBuildSessionViewUsesAuthoritativeState(t *testing.T) {
	session := Session{
		ID:          "session-1",
		StartedAt:   100,
		ExpiresAt:   200,
		State:       CreateInitialState("view-seed"),
		Actions:     []Action{{Type: "move", To: StartPosition}},
		ActionCount: 5,
		MoveCount:   5,
	}
	view := BuildSessionView(session)
	if view.SessionID != session.ID || view.ActionsCount != 5 {
		t.Fatalf("view mismatch: %#v", view)
	}
	if view.State.Player.Position != StartPosition || len(view.State.Board) != ViewSize*ViewSize {
		t.Fatalf("state view mismatch: %#v", view.State)
	}
}

func TestServiceNilDatabase(t *testing.T) {
	service := NewService(nil)
	if _, err := service.Start(nil, zeroUser()); err != ErrUnavailable {
		t.Fatalf("expected unavailable on start, got %v", err)
	}
	if _, err := service.Status(nil, zeroUser()); err != ErrUnavailable {
		t.Fatalf("expected unavailable on status, got %v", err)
	}
	if _, err := service.Step(nil, zeroUser(), StepInput{}); err != ErrUnavailable {
		t.Fatalf("expected unavailable on step, got %v", err)
	}
	if _, err := service.Submit(nil, zeroUser(), SubmitInput{}); err != ErrUnavailable {
		t.Fatalf("expected unavailable on submit, got %v", err)
	}
	if _, err := service.Cancel(nil, zeroUser()); err != ErrUnavailable {
		t.Fatalf("expected unavailable on cancel, got %v", err)
	}
}
