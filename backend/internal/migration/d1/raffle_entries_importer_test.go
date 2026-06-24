package d1

import (
	"strings"
	"testing"
)

func TestPlanRaffleEntriesImportParsesValidEntries(t *testing.T) {
	plan, err := PlanRaffleEntriesImport(strings.NewReader(`
INSERT INTO "kv_lists" ("id","key","value") VALUES('source-entry-1','raffle:entries:raffle-1','{"id":"entry-1","userId":"1001","username":"alice","entryNumber":"7","createdAt":"1234"}');
INSERT INTO "kv_lists" ("id","key","value") VALUES('source-entry-2','raffle:entries:raffle-1','{"raffleId":"raffle-1","userId":1002,"entryNumber":8,"createdAt":1235}');
INSERT INTO "kv_lists" ("id","key","value") VALUES('source-project-1','project:list','project-1');
`))
	if err != nil {
		t.Fatalf("PlanRaffleEntriesImport returned error: %v", err)
	}
	if len(plan.Entries) != 2 {
		t.Fatalf("expected 2 raffle entries, got %d: %+v", len(plan.Entries), plan.Entries)
	}

	entries := map[string]RaffleEntryImportRecord{}
	for _, entry := range plan.Entries {
		entries[entry.ID] = entry
	}

	first := entries["entry-1"]
	if first.RaffleID != "raffle-1" || first.UserID != 1001 || first.Username != "alice" || first.EntryNumber != 7 || first.CreatedAt != 1234 {
		t.Fatalf("unexpected first entry: %+v", first)
	}

	second := entries["source-entry-2"]
	if second.RaffleID != "raffle-1" || second.UserID != 1002 || second.Username != "user-1002" || second.EntryNumber != 8 || second.CreatedAt != 1235 {
		t.Fatalf("unexpected fallback entry: %+v", second)
	}
}

func TestPlanRaffleEntriesImportSkipsInvalidEntries(t *testing.T) {
	plan, err := PlanRaffleEntriesImport(strings.NewReader(`
INSERT INTO "kv_lists" ("id","key","value") VALUES('bad-user','raffle:entries:raffle-1','{"id":"bad-user","userId":0,"entryNumber":1}');
INSERT INTO "kv_lists" ("id","key","value") VALUES('bad-entry-number','raffle:entries:raffle-1','{"id":"bad-entry-number","userId":1001,"entryNumber":0}');
INSERT INTO "kv_lists" ("id","key","value") VALUES('bad-raffle-id','raffle:entries:raffle-1','{"id":"bad-raffle-id","raffleId":" ","userId":1002,"entryNumber":2}');
`))
	if err != nil {
		t.Fatalf("PlanRaffleEntriesImport returned error: %v", err)
	}
	if len(plan.Entries) != 0 {
		t.Fatalf("invalid entries should be skipped: %+v", plan.Entries)
	}
	if len(plan.Warnings) != 3 {
		t.Fatalf("expected 3 warnings, got %d: %#v", len(plan.Warnings), plan.Warnings)
	}
}
