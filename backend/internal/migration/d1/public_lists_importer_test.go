package d1

import (
	"strings"
	"testing"
)

func TestPlanPublicListImportParsesProjectsAndRaffles(t *testing.T) {
	plan, err := PlanPublicListImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('projects:p1','{"id":"p1","name":"项目一","description":"说明","maxClaims":10,"claimedCount":2,"codesCount":8,"status":"active","createdAt":1000,"createdBy":100,"rewardType":"direct","directDollars":12.6,"newUserOnly":true,"pinned":true,"pinnedAt":2000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('raffle:r1','{"id":"r1","mode":"draw","title":"抽奖一","description":"抽奖说明","prizes":[{"id":"prize-1","name":"10积分","points":10,"quantity":1}],"triggerType":"threshold","threshold":3,"status":"ended","participantsCount":1,"winnersCount":1,"winners":[{"entryId":"e1","userId":1001,"username":"alice","prizeId":"prize-1","prizeName":"10积分","points":10,"rewardStatus":"delivered"}],"createdBy":100,"createdAt":1000,"updatedAt":1200}',NULL);
`))
	if err != nil {
		t.Fatalf("PlanPublicListImport returned error: %v", err)
	}
	if len(plan.Projects) != 1 {
		t.Fatalf("expected 1 project, got %d", len(plan.Projects))
	}
	if len(plan.Raffles) != 1 {
		t.Fatalf("expected 1 raffle, got %d", len(plan.Raffles))
	}

	project := plan.Projects[0]
	if project.ID != "p1" || project.Name != "项目一" || project.Status != "active" {
		t.Fatalf("unexpected project: %+v", project)
	}
	if project.DirectPoints == nil || *project.DirectPoints != 13 {
		t.Fatalf("expected directDollars to round to 13 points, got %+v", project.DirectPoints)
	}
	if !project.NewUserOnly || !project.Pinned || project.PinnedAt == nil || *project.PinnedAt != 2000 {
		t.Fatalf("expected project flags to be parsed: %+v", project)
	}

	raffle := plan.Raffles[0]
	if raffle.ID != "r1" || raffle.Title != "抽奖一" || raffle.Status != "ended" {
		t.Fatalf("unexpected raffle: %+v", raffle)
	}
	if string(raffle.Prizes) == "[]" {
		t.Fatalf("expected raffle prizes to be preserved")
	}
	if string(raffle.Winners) == "[]" {
		t.Fatalf("expected raffle winners to be preserved")
	}
}

func TestPlanPublicListImportSkipsInvalidPublicItems(t *testing.T) {
	plan, err := PlanPublicListImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('projects:p1','{"id":"p1","name":"坏项目","status":"deleted"}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('raffle:r1','{"id":"r1","title":"坏抽奖","status":"unknown"}',NULL);
`))
	if err != nil {
		t.Fatalf("PlanPublicListImport returned error: %v", err)
	}
	if len(plan.Projects) != 0 || len(plan.Raffles) != 0 {
		t.Fatalf("invalid items should be skipped: %+v", plan)
	}
	if len(plan.Warnings) != 2 {
		t.Fatalf("expected 2 warnings, got %d: %#v", len(plan.Warnings), plan.Warnings)
	}
}
