package d1

import (
	"strings"
	"testing"
)

func TestPlanPointsHistoryImportParsesNativeAndLegacySources(t *testing.T) {
	plan, err := PlanPointsHistoryImport(strings.NewReader(`
INSERT INTO "native_user_point_logs" ("id","user_id","amount","source","description","balance","created_at") VALUES('n-log-1',93001,10,'game_play','游戏奖励',110,1000);
INSERT INTO "native_user_daily_game_points" ("user_id","stat_date","earned_points","updated_at") VALUES(93001,'2026-06-22',20,2000);
INSERT INTO "kv_lists" ("id","key","value") VALUES(1,'points_log:93002','{"id":"l-log-1","amount":-5,"source":"exchange","description":"兑换","balance":95,"createdAt":3000}');
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('game:daily_earned:93002:2026-06-22','30',NULL);
`))
	if err != nil {
		t.Fatalf("PlanPointsHistoryImport returned error: %v", err)
	}
	if len(plan.Users) != 2 {
		t.Fatalf("expected 2 placeholder users, got %d", len(plan.Users))
	}
	if len(plan.PointLogs) != 2 {
		t.Fatalf("expected 2 point logs, got %d", len(plan.PointLogs))
	}
	if len(plan.DailyGamePoints) != 2 {
		t.Fatalf("expected 2 daily game point entries, got %d", len(plan.DailyGamePoints))
	}

	logs := map[string]PointLogImportRecord{}
	for _, log := range plan.PointLogs {
		logs[log.ID] = log
	}
	if logs["n-log-1"].Amount != 10 || logs["l-log-1"].Amount != -5 {
		t.Fatalf("unexpected logs: %+v", logs)
	}

	daily := map[string]int64{}
	for _, entry := range plan.DailyGamePoints {
		daily[dailyPointKey(entry.UserID, entry.StatDate)] = entry.EarnedPoints
	}
	if daily["93001:2026-06-22"] != 20 || daily["93002:2026-06-22"] != 30 {
		t.Fatalf("unexpected daily entries: %+v", daily)
	}
}

func TestPlanPointsHistoryImportSkipsInvalidRows(t *testing.T) {
	plan, err := PlanPointsHistoryImport(strings.NewReader(`
INSERT INTO "native_user_point_logs" ("id","user_id","amount","source","description","balance","created_at") VALUES('',0,10,'game_play','坏记录',110,1000);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('game:daily_earned:bad:2026-06-22','30',NULL);
`))
	if err != nil {
		t.Fatalf("PlanPointsHistoryImport returned error: %v", err)
	}
	if len(plan.PointLogs) != 0 || len(plan.DailyGamePoints) != 0 {
		t.Fatalf("invalid rows should be skipped: %+v", plan)
	}
	if len(plan.Warnings) != 2 {
		t.Fatalf("expected 2 warnings, got %d: %#v", len(plan.Warnings), plan.Warnings)
	}
}
