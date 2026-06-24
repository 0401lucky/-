package d1

import (
	"strings"
	"testing"
)

func TestAnalyzeSQLCountsNativeTablesAndKVPrefixes(t *testing.T) {
	report, err := AnalyzeSQL(strings.NewReader(`
INSERT INTO native_users VALUES(1,'alice',1,1);
INSERT INTO native_user_points VALUES(1,120,1);
INSERT INTO kv_data VALUES('eco:state:1','{}',NULL);
INSERT INTO kv_hashes VALUES('store:item:card','stock','10');
INSERT INTO kv_lists VALUES(1,'exchange_log:1','{}');
`))
	if err != nil {
		t.Fatalf("AnalyzeSQL returned error: %v", err)
	}

	if report.InsertStatements != 5 {
		t.Fatalf("expected 5 insert statements, got %d", report.InsertStatements)
	}
	if report.Tables["native_user_points"] != 1 {
		t.Fatalf("expected native_user_points count to be 1")
	}
	if report.KVPrefixes["eco"] != 1 {
		t.Fatalf("expected eco prefix count to be 1")
	}
	if report.KVPrefixes["store"] != 1 {
		t.Fatalf("expected store prefix count to be 1")
	}
	if report.TargetTables["point_accounts"] != 1 {
		t.Fatalf("expected point_accounts mapping count to be 1")
	}
	if report.TargetTables["exchange_logs"] != 1 {
		t.Fatalf("expected exchange_logs mapping count to be 1")
	}
}

func TestAnalyzeSQLEmitsWarningForEmptyInput(t *testing.T) {
	report, err := AnalyzeSQL(strings.NewReader("-- empty export"))
	if err != nil {
		t.Fatalf("AnalyzeSQL returned error: %v", err)
	}
	if len(report.Warnings) == 0 {
		t.Fatalf("expected warning for empty input")
	}
}

func TestAnalyzeSQLBuildsStageOneMappings(t *testing.T) {
	report, err := AnalyzeSQL(strings.NewReader(`
INSERT INTO "kv_hashes" ("key","field","value") VALUES('store:items','item-1','{"name":"抽奖机会"}');
INSERT INTO "kv_hashes" ("key","field","value") VALUES('store:categories','lottery','{}');
INSERT INTO "kv_hashes" ("key","field","value") VALUES('store:item:purchase_counts','item-1','3');
INSERT INTO "kv_lists" ("id","key","value") VALUES(1,'points_log:100','{"amount":10}');
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('points:100','120',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('game:daily_earned:100:2026-06-22','20',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('exchange:daily:100:2026-06-22:item-1','1',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:extra_spins:100','2',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:makeup_cards:100','1',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:profile:custom:100','{"displayName":"Alice"}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:achievements:100','{"beginner":{"id":"beginner","source":"auto","grantedAt":1700000000000}}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:achievement:equipped:100','"beginner"',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:achievement:forced:100','{"id":"thief","until":1700003600000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:n1','{"id":"n1","userId":100,"type":"system","title":"通知","content":"内容","createdAt":1700000000000}',NULL);
INSERT INTO "kv_zsets" ("key","score","member") VALUES('notifications:user:100:index',1700000000000,'n1');
INSERT INTO "kv_sets" ("key","member") VALUES('notifications:user:100:unread','n1');
INSERT INTO "kv_sets" ("key","member") VALUES('notifications:announcement:notified:a1','100');
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:user:100','{"drawsAvailable":5}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:album_rewards','{"animal-s1":123}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:tier_rewards','{"common":5}',NULL);
INSERT INTO "kv_lists" ("id","key","value") VALUES(2,'exchange_log:100','{}');
`))
	if err != nil {
		t.Fatalf("AnalyzeSQL returned error: %v", err)
	}

	expectedTargets := map[string]int{
		"store_items":                       1,
		"store_categories":                  1,
		"store_items.purchase_count":        1,
		"point_ledger":                      1,
		"point_accounts":                    1,
		"daily_game_points":                 1,
		"store_daily_purchases":             1,
		"user_assets.extra_spins":           1,
		"user_assets.makeup_cards":          1,
		"user_assets.card_draws":            1,
		"user_profiles":                     1,
		"user_achievement_grants":           1,
		"user_equipped_achievements":        1,
		"user_forced_achievements":          1,
		"notifications":                     1,
		"notifications.import_index":        1,
		"notifications.unread_index":        1,
		"notifications.announcement_dedupe": 1,
		"exchange_logs":                     1,
		"card_album_rewards":                1,
		"card_tier_rewards":                 1,
	}

	for target, expected := range expectedTargets {
		if report.TargetTables[target] != expected {
			t.Fatalf("expected target %s count %d, got %d", target, expected, report.TargetTables[target])
		}
	}
}

func TestAnalyzeSQLMapsPublicWelfareLists(t *testing.T) {
	report, err := AnalyzeSQL(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('projects:project-1','{"name":"福利项目"}',NULL);
INSERT INTO "kv_lists" ("id","key","value") VALUES(1,'project:list','project-1');
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('raffle:raffle-1','{"title":"抽奖"}',NULL);
INSERT INTO "kv_lists" ("id","key","value") VALUES(2,'raffle:list','raffle-1');
INSERT INTO "kv_sets" ("key","member") VALUES('raffle:active','raffle-1');
INSERT INTO "kv_lists" ("id","key","value") VALUES(3,'raffle:entries:raffle-1','{}');
`))
	if err != nil {
		t.Fatalf("AnalyzeSQL returned error: %v", err)
	}

	expectedTargets := map[string]int{
		"projects":              1,
		"projects.import_index": 1,
		"raffles":               1,
		"raffles.import_index":  1,
		"raffles.status":        1,
		"raffle_entries":        1,
	}
	for target, expected := range expectedTargets {
		if report.TargetTables[target] != expected {
			t.Fatalf("expected target %s count %d, got %d", target, expected, report.TargetTables[target])
		}
	}
	if report.UnmappedSources["kv_lists:raffle:entries:*"] != 0 {
		t.Fatalf("raffle entries should map to raffle_entries")
	}
}

func TestAnalyzeSQLMapsLegacyUsersAndPoints(t *testing.T) {
	report, err := AnalyzeSQL(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:100','{"id":100,"username":"alice"}',NULL);
INSERT INTO "kv_sets" ("key","member") VALUES('users:all','100');
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('points:100','120',NULL);
`))
	if err != nil {
		t.Fatalf("AnalyzeSQL returned error: %v", err)
	}

	expectedTargets := map[string]int{
		"users":              1,
		"users.import_index": 1,
		"point_accounts":     1,
	}
	for target, expected := range expectedTargets {
		if report.TargetTables[target] != expected {
			t.Fatalf("expected target %s count %d, got %d", target, expected, report.TargetTables[target])
		}
	}
}

func TestAnalyzeSQLMapsRewardClaimSources(t *testing.T) {
	report, err := AnalyzeSQL(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('rewards:batch:batch-1','{}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('rewards:claim:batch-1:100','{}',NULL);
INSERT INTO "kv_lists" ("id","key","value") VALUES(1,'rewards:batch:list','batch-1');
INSERT INTO "kv_sets" ("key","member") VALUES('rewards:batch:notified:batch-1','100');
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('rewards:claim:lock:batch-1:100','1',NULL);
`))
	if err != nil {
		t.Fatalf("AnalyzeSQL returned error: %v", err)
	}

	expectedTargets := map[string]int{
		"reward_batches":                     1,
		"reward_claims":                      1,
		"reward_batches.import_index":        1,
		"reward_batches.notification_dedupe": 1,
	}
	for target, expected := range expectedTargets {
		if report.TargetTables[target] != expected {
			t.Fatalf("expected target %s count %d, got %d", target, expected, report.TargetTables[target])
		}
	}
	if report.UnmappedSources["kv_data:rewards:claim:lock:*"] != 1 {
		t.Fatalf("runtime reward claim lock should stay unmapped")
	}
}

func TestAnalyzeSQLMapsEcoSources(t *testing.T) {
	report, err := AnalyzeSQL(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:state:100','{"pending":3}',NULL);
INSERT INTO "kv_hashes" ("key","field","value") VALUES('eco:global-prize-stock','diamond','2');
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:public-prizes','[]',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:thefts','[]',NULL);
INSERT INTO "kv_hashes" ("key","field","value") VALUES('eco:prize-claims:2026-06-23','total','4');
INSERT INTO "kv_zsets" ("key","member","score") VALUES('eco:trash-rank:daily:2026-06-23','u:100',12);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:lock:100','token',NULL);
`))
	if err != nil {
		t.Fatalf("AnalyzeSQL returned error: %v", err)
	}

	expectedTargets := map[string]int{
		"eco_states":             1,
		"eco_user_upgrades":      1,
		"eco_prize_inventory":    1,
		"eco_prize_lots":         1,
		"eco_visible_prizes":     1,
		"eco_item_purchases":     1,
		"eco_global_prize_stock": 1,
		"eco_public_prizes":      1,
		"eco_thefts":             1,
		"eco_prize_claim_stats":  1,
		"eco_trash_rankings":     1,
	}
	for target, expected := range expectedTargets {
		if report.TargetTables[target] != expected {
			t.Fatalf("expected target %s count %d, got %d", target, expected, report.TargetTables[target])
		}
	}
	if report.UnmappedSources["kv_data:eco:state:*"] != 0 {
		t.Fatalf("eco state should map to eco_states")
	}
	if report.UnmappedSources["kv_data:eco:lock:*"] != 1 {
		t.Fatalf("runtime eco lock should stay unmapped")
	}
}

func TestAnalyzeSQLMapsFarmV2Sources(t *testing.T) {
	report, err := AnalyzeSQL(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:state:100','{"userId":100}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:shop:daily:100:2026-06-23:pet_food_normal','2',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:mature-mail:sent:100:event-1','{"claimedAt":1700000000000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:water-mail:sent:100:1:1700000000000:1700000300000:0','{"claimedAt":1700000400000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:lock:100','token',NULL);
`))
	if err != nil {
		t.Fatalf("AnalyzeSQL returned error: %v", err)
	}

	expectedTargets := map[string]int{
		"farm_states":                 1,
		"farm_daily_shop_purchases":   1,
		"farm_maturity_email_dedupes": 1,
		"farm_water_email_dedupes":    1,
	}
	for target, expected := range expectedTargets {
		if report.TargetTables[target] != expected {
			t.Fatalf("expected target %s count %d, got %d", target, expected, report.TargetTables[target])
		}
	}
	if report.UnmappedSources["kv_data:farmv2:*"] != 1 {
		t.Fatalf("runtime farm lock should stay unmapped")
	}
}

func TestAnalyzeSQLTracksUnmappedSources(t *testing.T) {
	report, err := AnalyzeSQL(strings.NewReader(`
INSERT INTO kv_data VALUES('wallet:transaction:1','{}',NULL);
INSERT INTO kv_lists VALUES(1,'exchange_uncertain:100','{}');
INSERT INTO native_system_config VALUES('system:config','{}',1);
`))
	if err != nil {
		t.Fatalf("AnalyzeSQL returned error: %v", err)
	}

	if report.UnmappedSources["kv_data:wallet:*"] != 1 {
		t.Fatalf("expected wallet source to be unmapped")
	}
	if report.UnmappedSources["kv_lists:exchange_uncertain:*"] != 1 {
		t.Fatalf("expected exchange_uncertain source to be unmapped")
	}
	if report.UnmappedSources["native_system_config"] != 1 {
		t.Fatalf("expected native_system_config to be unmapped")
	}
}

func TestParseInsertStatementHandlesEscapedQuotesAndCommas(t *testing.T) {
	statement, ok := parseInsertStatement(`INSERT INTO kv_hashes VALUES('store:items','it''em','{"name":"A,B"}');`)
	if !ok {
		t.Fatalf("expected insert to parse")
	}
	if statement.Table != "kv_hashes" {
		t.Fatalf("unexpected table: %s", statement.Table)
	}
	if len(statement.Values) != 3 {
		t.Fatalf("expected 3 values, got %d: %#v", len(statement.Values), statement.Values)
	}
	if statement.Values[1] != "it'em" {
		t.Fatalf("expected escaped quote to be unescaped, got %q", statement.Values[1])
	}
	if statement.Values[2] != `{"name":"A,B"}` {
		t.Fatalf("expected JSON comma to stay in value, got %q", statement.Values[2])
	}
}
