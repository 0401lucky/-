package eco

import "testing"

func TestNewInitialStateSnapshot(t *testing.T) {
	snapshot := NewInitialStateSnapshot(99401, 1000)
	if snapshot.Exists {
		t.Fatalf("initial snapshot should not be marked as existing")
	}
	if snapshot.UserID != 99401 || snapshot.LastTickAtMs != 1000 || snapshot.CreatedAtMs != 1000 {
		t.Fatalf("unexpected initial timestamps: %+v", snapshot)
	}
	if len(snapshot.Upgrades) != len(UpgradeKeys) || len(snapshot.PrizeInventory) != len(PrizeKeys) {
		t.Fatalf("initial snapshot should include default maps: %+v", snapshot)
	}
}

func TestAdvanceStateSpawnsAndAutoCollects(t *testing.T) {
	snapshot := NewInitialStateSnapshot(99401, 1000)
	snapshot.Exists = true
	snapshot.Pending = 10
	snapshot.Upgrades["spawn"] = 2
	snapshot.Upgrades["auto"] = 1

	next, tick := AdvanceState(snapshot, 61000)
	if tick.ElapsedMs != 60000 || tick.Spawned != 16 || tick.AcceptedSpawned != 16 {
		t.Fatalf("unexpected tick: %+v", tick)
	}
	if tick.AutoCollected != 1 || tick.TrashSpawned != 16 {
		t.Fatalf("unexpected collection result: %+v", tick)
	}
	if next.Pending != 25 {
		t.Fatalf("expected pending 25, got %d", next.Pending)
	}
	if next.LastTickAtMs != 61000 {
		t.Fatalf("expected last tick to update, got %d", next.LastTickAtMs)
	}
}

func TestAdvanceStateWithPrizeRollUsesSpawnSlot(t *testing.T) {
	snapshot := NewInitialStateSnapshot(99401, 1000)
	snapshot.Exists = true

	next, tick := AdvanceStateWithPrizeRoll(snapshot, 61000, func() (string, bool) {
		return "diamond", true
	})
	if tick.Spawned != 10 || tick.AcceptedSpawned != 10 || len(tick.PrizeKeys) != 10 {
		t.Fatalf("unexpected prize tick: %+v", tick)
	}
	if tick.TrashSpawned != 0 || next.Pending != 0 {
		t.Fatalf("prize spawns should not become trash: next=%+v tick=%+v", next, tick)
	}
}
