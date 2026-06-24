package d1

import (
	"bufio"
	"io"
	"regexp"
	"sort"
	"strings"
)

var (
	insertPattern = regexp.MustCompile(`(?is)^\s*INSERT(?:\s+OR\s+\w+)?\s+INTO\s+["` + "`" + `]?([a-zA-Z0-9_]+)["` + "`" + `]?\s*(?:\(([^)]*)\))?\s+VALUES\s*\((.*)\)\s*;?\s*$`)
)

type Report struct {
	TotalLines       int
	InsertStatements int
	Tables           map[string]int
	KVPrefixes       map[string]int
	MappingCounts    map[string]int
	TargetTables     map[string]int
	UnmappedSources  map[string]int
	Warnings         []string
}

type insertStatement struct {
	Table   string
	Columns []string
	Values  []string
}

func AnalyzeSQL(reader io.Reader) (Report, error) {
	report := Report{
		Tables:          map[string]int{},
		KVPrefixes:      map[string]int{},
		MappingCounts:   map[string]int{},
		TargetTables:    map[string]int{},
		UnmappedSources: map[string]int{},
	}

	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 1024), 1024*1024)

	for scanner.Scan() {
		report.TotalLines++
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "--") {
			continue
		}

		statement, ok := parseInsertStatement(line)
		if !ok {
			continue
		}

		report.InsertStatements++
		report.Tables[statement.Table]++

		if isKVTable(statement.Table) {
			if key, ok := kvKey(statement); ok {
				report.KVPrefixes[prefixOf(key)]++
			}
		}
		analyzeStatement(&report, statement)
	}

	if err := scanner.Err(); err != nil {
		return report, err
	}

	if len(report.Tables) == 0 {
		report.Warnings = append(report.Warnings, "未检测到 INSERT 语句，请确认输入是 D1 SQL 导出文件")
	}
	if report.TargetTables["point_accounts"] == 0 {
		report.Warnings = append(report.Warnings, "未检测到积分数据，后续导入前需要确认数据源是否完整")
	}
	if report.Tables["native_user_points"] > 0 && report.KVPrefixes["points"] > 0 {
		report.Warnings = append(report.Warnings, "同时检测到 native_user_points 和 legacy points:*，真实导入前必须确认优先级，避免余额重复")
	}
	if report.UnmappedSources["kv_lists:exchange_uncertain:*"] > 0 {
		report.Warnings = append(report.Warnings, "检测到 exchange_uncertain:*，需要人工核对 pending/uncertain 兑换记录")
	}
	if len(report.UnmappedSources) > 0 {
		report.Warnings = append(report.Warnings, "存在未映射数据源，请在真实导入前确认是否需要补 schema 或归档")
	}

	return report, nil
}

func SortedCountKeys(values map[string]int) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func SortedMappingKeys(values map[string]int) []string {
	return SortedCountKeys(values)
}

func isKVTable(tableName string) bool {
	switch tableName {
	case "kv_data", "kv_lists", "kv_sets", "kv_zsets", "kv_hashes", "kv_key_expirations":
		return true
	default:
		return false
	}
}

func parseInsertStatement(line string) (insertStatement, bool) {
	matches := insertPattern.FindStringSubmatch(line)
	if len(matches) < 4 {
		return insertStatement{}, false
	}

	values, ok := splitSQLValues(matches[3])
	if !ok {
		return insertStatement{}, false
	}

	return insertStatement{
		Table:   strings.ToLower(matches[1]),
		Columns: normalizeColumns(matches[2]),
		Values:  values,
	}, true
}

func normalizeColumns(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}

	parts := strings.Split(raw, ",")
	columns := make([]string, 0, len(parts))
	for _, part := range parts {
		column := strings.TrimSpace(part)
		column = strings.Trim(column, `"'`+"`")
		columns = append(columns, strings.ToLower(column))
	}
	return columns
}

func splitSQLValues(raw string) ([]string, bool) {
	values := make([]string, 0)
	var builder strings.Builder
	inQuote := false

	for index := 0; index < len(raw); index++ {
		ch := raw[index]
		if ch == '\'' {
			if inQuote && index+1 < len(raw) && raw[index+1] == '\'' {
				builder.WriteByte('\'')
				index++
				continue
			}
			inQuote = !inQuote
			continue
		}

		if ch == ',' && !inQuote {
			values = append(values, normalizeSQLValue(builder.String()))
			builder.Reset()
			continue
		}
		builder.WriteByte(ch)
	}

	if inQuote {
		return nil, false
	}
	values = append(values, normalizeSQLValue(builder.String()))
	return values, true
}

func normalizeSQLValue(raw string) string {
	value := strings.TrimSpace(raw)
	if strings.EqualFold(value, "NULL") {
		return ""
	}
	return value
}

func valueFor(statement insertStatement, defaults []string, column string, fallbackIndex int) (string, bool) {
	column = strings.ToLower(column)
	columns := statement.Columns
	if len(columns) == 0 {
		columns = defaults
	}

	for index, candidate := range columns {
		if strings.EqualFold(candidate, column) {
			if index >= 0 && index < len(statement.Values) {
				return statement.Values[index], true
			}
			return "", false
		}
	}

	if fallbackIndex >= 0 && fallbackIndex < len(statement.Values) {
		return statement.Values[fallbackIndex], true
	}
	return "", false
}

func kvKey(statement insertStatement) (string, bool) {
	switch statement.Table {
	case "kv_data":
		return valueFor(statement, []string{"key", "value", "expires_at"}, "key", 0)
	case "kv_lists":
		return valueFor(statement, []string{"id", "key", "value"}, "key", 1)
	case "kv_sets":
		return valueFor(statement, []string{"key", "member"}, "key", 0)
	case "kv_zsets":
		return valueFor(statement, []string{"key", "member", "score"}, "key", 0)
	case "kv_hashes":
		return valueFor(statement, []string{"key", "field", "value"}, "key", 0)
	case "kv_key_expirations":
		return valueFor(statement, []string{"key", "expires_at"}, "key", 0)
	default:
		return "", false
	}
}

func analyzeStatement(report *Report, statement insertStatement) {
	if statement.Table == "native_user_cards" {
		addMapping(report, statement.Table, "user_assets.card_draws")
		addMapping(report, statement.Table, "card_user_states")
		return
	}

	if target, ok := nativeTarget(statement.Table); ok {
		addMapping(report, statement.Table, target)
		return
	}

	if strings.HasPrefix(statement.Table, "native_") {
		addUnmapped(report, statement.Table)
		return
	}

	if !isKVTable(statement.Table) {
		return
	}

	if statement.Table == "kv_key_expirations" {
		return
	}

	key, ok := kvKey(statement)
	if !ok {
		addUnmapped(report, statement.Table+":unknown-key")
		return
	}
	analyzeKVKey(report, statement.Table, key)
}

func nativeTarget(table string) (string, bool) {
	switch table {
	case "native_users":
		return "users", true
	case "native_user_points":
		return "point_accounts", true
	case "native_user_point_logs":
		return "point_ledger", true
	case "native_user_daily_game_points":
		return "daily_game_points", true
	case "native_user_assets":
		return "user_assets.extra_spins", true
	case "native_user_cards":
		return "user_assets.card_draws", true
	case "native_game_sessions":
		return "game_sessions", true
	case "native_game_active_sessions":
		return "active_game_sessions", true
	case "native_game_records":
		return "game_records", true
	default:
		return "", false
	}
}

func analyzeKVKey(report *Report, table string, key string) {
	source := table + ":" + keyPattern(key)

	switch {
	case table == "kv_data" && matchKeyPattern(key, "points:*"):
		addMapping(report, source, "point_accounts")
	case table == "kv_lists" && matchKeyPattern(key, "points_log:*"):
		addMapping(report, source, "point_ledger")
	case table == "kv_data" && matchKeyPattern(key, "game:daily_earned:*"):
		addMapping(report, source, "daily_game_points")
	case table == "kv_data" && matchKeyPattern(key, "user:extra_spins:*"):
		addMapping(report, source, "user_assets.extra_spins")
	case table == "kv_data" && matchKeyPattern(key, "user:makeup_cards:*"):
		addMapping(report, source, "user_assets.makeup_cards")
	case table == "kv_data" && matchKeyPattern(key, "user:profile:custom:*"):
		addMapping(report, source, "user_profiles")
	case table == "kv_data" && matchKeyPattern(key, "user:achievements:*"):
		addMapping(report, source, "user_achievement_grants")
	case table == "kv_data" && matchKeyPattern(key, "user:achievement:equipped:*"):
		addMapping(report, source, "user_equipped_achievements")
	case table == "kv_data" && matchKeyPattern(key, "user:achievement:forced:*"):
		addMapping(report, source, "user_forced_achievements")
	case table == "kv_data" && matchKeyPattern(key, "notifications:item:*"):
		addMapping(report, source, "notifications")
	case table == "kv_zsets" && strings.HasPrefix(key, "notifications:user:") && strings.HasSuffix(key, ":index"):
		addMapping(report, source, "notifications.import_index")
	case table == "kv_sets" && strings.HasPrefix(key, "notifications:user:") && strings.HasSuffix(key, ":unread"):
		addMapping(report, source, "notifications.unread_index")
	case table == "kv_sets" && matchKeyPattern(key, "notifications:announcement:notified:*"):
		addMapping(report, source, "notifications.announcement_dedupe")
	case table == "kv_data" && matchKeyPattern(key, "rewards:batch:*"):
		addMapping(report, source, "reward_batches")
	case table == "kv_data" && matchKeyPattern(key, "rewards:claim:lock:*"):
		addUnmapped(report, source)
	case table == "kv_data" && matchKeyPattern(key, "rewards:claim:*"):
		addMapping(report, source, "reward_claims")
	case table == "kv_lists" && key == "rewards:batch:list":
		addMapping(report, source, "reward_batches.import_index")
	case table == "kv_sets" && matchKeyPattern(key, "rewards:batch:notified:*"):
		addMapping(report, source, "reward_batches.notification_dedupe")
	case table == "kv_data" && matchKeyPattern(key, "user:*"):
		addMapping(report, source, "users")
	case table == "kv_sets" && key == "users:all":
		addMapping(report, source, "users.import_index")
	case table == "kv_data" && matchKeyPattern(key, "projects:*"):
		addMapping(report, source, "projects")
	case table == "kv_lists" && key == "project:list":
		addMapping(report, source, "projects.import_index")
	case table == "kv_data" && isRaffleDetailKey(key):
		addMapping(report, source, "raffles")
	case table == "kv_lists" && key == "raffle:list":
		addMapping(report, source, "raffles.import_index")
	case table == "kv_sets" && key == "raffle:active":
		addMapping(report, source, "raffles.status")
	case table == "kv_lists" && matchKeyPattern(key, "raffle:entries:*"):
		addMapping(report, source, "raffle_entries")
	case table == "kv_hashes" && key == "store:categories":
		addMapping(report, source, "store_categories")
	case table == "kv_hashes" && key == "store:items":
		addMapping(report, source, "store_items")
	case table == "kv_hashes" && key == "store:item:purchase_counts":
		addMapping(report, source, "store_items.purchase_count")
	case table == "kv_lists" && matchKeyPattern(key, "exchange_log:*"):
		addMapping(report, source, "exchange_logs")
	case table == "kv_data" && matchKeyPattern(key, "exchange:daily:*"):
		addMapping(report, source, "store_daily_purchases")
	case table == "kv_data" && matchKeyPattern(key, "cards:user:*"):
		addMapping(report, source, "user_assets.card_draws")
		addMapping(report, source, "card_user_states")
	case table == "kv_data" && key == "cards:rules:config":
		addMapping(report, source, "card_rules")
	case table == "kv_data" && key == "cards:album_rewards":
		addMapping(report, source, "card_album_rewards")
	case table == "kv_data" && key == "cards:tier_rewards":
		addMapping(report, source, "card_tier_rewards")
	case table == "kv_data" && matchKeyPattern(key, "eco:state:*"):
		addMapping(report, source, "eco_states")
		addMapping(report, source, "eco_user_upgrades")
		addMapping(report, source, "eco_prize_inventory")
		addMapping(report, source, "eco_prize_lots")
		addMapping(report, source, "eco_visible_prizes")
		addMapping(report, source, "eco_item_purchases")
	case table == "kv_data" && matchKeyPattern(key, "farmv2:state:*"):
		addMapping(report, source, "farm_states")
	case table == "kv_data" && matchKeyPattern(key, "farmv2:shop:daily:*"):
		addMapping(report, source, "farm_daily_shop_purchases")
	case table == "kv_data" && matchKeyPattern(key, "farmv2:mature-mail:sent:*"):
		addMapping(report, source, "farm_maturity_email_dedupes")
	case table == "kv_data" && matchKeyPattern(key, "farmv2:water-mail:sent:*"):
		addMapping(report, source, "farm_water_email_dedupes")
	case table == "kv_data" && matchKeyPattern(key, "feedback:item:*"):
		addMapping(report, source, "feedback_items")
	case table == "kv_lists" && matchKeyPattern(key, "feedback:messages:*"):
		addMapping(report, source, "feedback_messages")
	case table == "kv_sets" && matchKeyPattern(key, "feedback:likes:*"):
		addMapping(report, source, "feedback_likes")
	case table == "kv_hashes" && key == "eco:global-prize-stock":
		addMapping(report, source, "eco_global_prize_stock")
	case table == "kv_data" && key == "eco:public-prizes":
		addMapping(report, source, "eco_public_prizes")
	case table == "kv_data" && key == "eco:thefts":
		addMapping(report, source, "eco_thefts")
	case table == "kv_hashes" && matchKeyPattern(key, "eco:prize-claims:*"):
		addMapping(report, source, "eco_prize_claim_stats")
	case table == "kv_zsets" && matchKeyPattern(key, "eco:trash-rank:*"):
		addMapping(report, source, "eco_trash_rankings")
	case table == "kv_data" && key == "system:config":
		addUnmapped(report, source)
	case table == "kv_lists" && matchKeyPattern(key, "exchange_uncertain:*"):
		addUnmapped(report, source)
	case strings.HasPrefix(key, "raffle:"):
		addUnmapped(report, source)
	case strings.HasPrefix(key, "user:raffles:"):
		addUnmapped(report, source)
	case strings.HasPrefix(key, "user:raffle_wins:"):
		addUnmapped(report, source)
	case strings.HasPrefix(key, "eco:"):
		addUnmapped(report, source)
	case strings.HasPrefix(key, "wallet:"):
		addUnmapped(report, source)
	default:
		addUnmapped(report, source)
	}
}

func addMapping(report *Report, source string, target string) {
	key := source + " -> " + target
	report.MappingCounts[key]++
	report.TargetTables[target]++
}

func addUnmapped(report *Report, source string) {
	report.UnmappedSources[source]++
}

func keyPattern(key string) string {
	if matchKeyPattern(key, "points:*") {
		return "points:*"
	}
	if matchKeyPattern(key, "points_log:*") {
		return "points_log:*"
	}
	if matchKeyPattern(key, "game:daily_earned:*") {
		return "game:daily_earned:*"
	}
	if key == "users:all" {
		return "users:all"
	}
	if matchKeyPattern(key, "user:extra_spins:*") {
		return "user:extra_spins:*"
	}
	if matchKeyPattern(key, "user:makeup_cards:*") {
		return "user:makeup_cards:*"
	}
	if matchKeyPattern(key, "user:profile:custom:*") {
		return "user:profile:custom:*"
	}
	if matchKeyPattern(key, "user:achievements:*") {
		return "user:achievements:*"
	}
	if matchKeyPattern(key, "user:achievement:equipped:*") {
		return "user:achievement:equipped:*"
	}
	if matchKeyPattern(key, "user:achievement:forced:*") {
		return "user:achievement:forced:*"
	}
	if matchKeyPattern(key, "notifications:item:*") {
		return "notifications:item:*"
	}
	if strings.HasPrefix(key, "notifications:user:") && strings.HasSuffix(key, ":index") {
		return "notifications:user:*:index"
	}
	if strings.HasPrefix(key, "notifications:user:") && strings.HasSuffix(key, ":unread") {
		return "notifications:user:*:unread"
	}
	if matchKeyPattern(key, "notifications:announcement:notified:*") {
		return "notifications:announcement:notified:*"
	}
	if matchKeyPattern(key, "rewards:batch:notified:*") {
		return "rewards:batch:notified:*"
	}
	if key == "rewards:batch:list" {
		return "rewards:batch:list"
	}
	if matchKeyPattern(key, "rewards:claim:lock:*") {
		return "rewards:claim:lock:*"
	}
	if matchKeyPattern(key, "rewards:claim:*") {
		return "rewards:claim:*"
	}
	if matchKeyPattern(key, "rewards:batch:*") {
		return "rewards:batch:*"
	}
	if strings.HasPrefix(key, "user:raffles:") {
		return "user:raffles:*"
	}
	if strings.HasPrefix(key, "user:raffle_wins:") {
		return "user:raffle_wins:*"
	}
	if matchKeyPattern(key, "user:*") {
		return "user:*"
	}
	if matchKeyPattern(key, "projects:*") {
		return "projects:*"
	}
	if key == "project:list" {
		return "project:list"
	}
	if key == "raffle:list" {
		return "raffle:list"
	}
	if key == "raffle:active" {
		return "raffle:active"
	}
	if strings.HasPrefix(key, "raffle:entries:") {
		return "raffle:entries:*"
	}
	if strings.HasPrefix(key, "raffle:participants:") {
		return "raffle:participants:*"
	}
	if strings.HasPrefix(key, "raffle:entry_count:") {
		return "raffle:entry_count:*"
	}
	if strings.HasPrefix(key, "raffle:delivery:") {
		return "raffle:delivery:*"
	}
	if strings.HasPrefix(key, "raffle:draw_lock:") {
		return "raffle:draw_lock:*"
	}
	if strings.HasPrefix(key, "raffle:join_lock:") {
		return "raffle:join_lock:*"
	}
	if isRaffleDetailKey(key) {
		return "raffle:*"
	}
	if matchKeyPattern(key, "exchange_log:*") {
		return "exchange_log:*"
	}
	if matchKeyPattern(key, "exchange_uncertain:*") {
		return "exchange_uncertain:*"
	}
	if matchKeyPattern(key, "exchange:daily:*") {
		return "exchange:daily:*"
	}
	if matchKeyPattern(key, "cards:user:*") {
		return "cards:user:*"
	}
	if key == "cards:rules:config" {
		return "cards:rules:config"
	}
	if matchKeyPattern(key, "eco:state:*") {
		return "eco:state:*"
	}
	if key == "eco:global-prize-stock" {
		return "eco:global-prize-stock"
	}
	if key == "eco:public-prizes" {
		return "eco:public-prizes"
	}
	if key == "eco:thefts" {
		return "eco:thefts"
	}
	if matchKeyPattern(key, "eco:prize-claims:*") {
		return "eco:prize-claims:*"
	}
	if matchKeyPattern(key, "eco:trash-rank:*") {
		return "eco:trash-rank:*"
	}
	if strings.HasPrefix(key, "eco:lock:") {
		return "eco:lock:*"
	}
	if key == "eco:global-prize-stock:lock" || key == "eco:theft-investigation:lock" {
		return key
	}
	if strings.HasPrefix(key, "eco:") {
		return "eco:*"
	}
	if matchKeyPattern(key, "farmv2:state:*") {
		return "farmv2:state:*"
	}
	if matchKeyPattern(key, "farmv2:shop:daily:*") {
		return "farmv2:shop:daily:*"
	}
	if matchKeyPattern(key, "farmv2:mature-mail:sent:*") {
		return "farmv2:mature-mail:sent:*"
	}
	if matchKeyPattern(key, "farmv2:water-mail:sent:*") {
		return "farmv2:water-mail:sent:*"
	}
	if strings.HasPrefix(key, "farmv2:") {
		return "farmv2:*"
	}
	if matchKeyPattern(key, "feedback:item:*") {
		return "feedback:item:*"
	}
	if matchKeyPattern(key, "feedback:messages:*") {
		return "feedback:messages:*"
	}
	if matchKeyPattern(key, "feedback:likes:*") {
		return "feedback:likes:*"
	}
	if strings.HasPrefix(key, "feedback:") {
		return "feedback:*"
	}
	if strings.HasPrefix(key, "wallet:") {
		return "wallet:*"
	}
	return key
}

func matchKeyPattern(key string, pattern string) bool {
	prefix := strings.TrimSuffix(pattern, "*")
	if prefix == pattern {
		return key == pattern
	}
	return strings.HasPrefix(key, prefix)
}

func isRaffleDetailKey(key string) bool {
	if !strings.HasPrefix(key, "raffle:") {
		return false
	}
	if key == "raffle:list" || key == "raffle:active" {
		return false
	}
	for _, prefix := range []string{
		"raffle:entries:",
		"raffle:participants:",
		"raffle:entry_count:",
		"raffle:delivery:",
		"raffle:draw_lock:",
		"raffle:join_lock:",
	} {
		if strings.HasPrefix(key, prefix) {
			return false
		}
	}
	return true
}

func prefixOf(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return "(empty)"
	}

	separator := strings.IndexAny(key, ":/")
	if separator <= 0 {
		return key
	}
	return key[:separator]
}
