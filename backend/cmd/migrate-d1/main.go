package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	d1migration "redemption/backend/internal/migration/d1"
	"redemption/backend/internal/platform/postgres"
)

func main() {
	inputPath := flag.String("input", "", "Cloudflare D1 SQL 导出文件路径")
	apply := flag.Bool("apply", false, "执行真实导入；当前阶段支持 public-lists、users-points、points-history、store-data、user-assets、user-profiles、user-achievements、notifications、reward-claims、raffle-entries、eco-state、eco-global、farm-v2、cards、feedback")
	scope := flag.String("scope", "public-lists", "导入范围；当前支持 public-lists、users-points、points-history、store-data、user-assets、user-profiles、user-achievements、notifications、reward-claims、raffle-entries、eco-state、eco-global、farm-v2、cards、feedback")
	flag.Parse()

	if *inputPath == "" {
		fmt.Fprintln(os.Stderr, "缺少 -input。示例：go run ./cmd/migrate-d1 -input ./d1-export.sql")
		os.Exit(2)
	}

	raw, err := os.ReadFile(*inputPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "读取 D1 导出文件失败：%v\n", err)
		os.Exit(1)
	}

	report, err := d1migration.AnalyzeSQL(bytes.NewReader(raw))
	if err != nil {
		fmt.Fprintf(os.Stderr, "分析 D1 导出文件失败：%v\n", err)
		os.Exit(1)
	}

	fmt.Println("D1 导出 dry-run 报告")
	fmt.Printf("总行数：%d\n", report.TotalLines)
	fmt.Printf("INSERT 语句数：%d\n", report.InsertStatements)

	fmt.Println("\n表写入计数：")
	for _, table := range d1migration.SortedCountKeys(report.Tables) {
		fmt.Printf("- %s: %d\n", table, report.Tables[table])
	}

	if len(report.KVPrefixes) > 0 {
		fmt.Println("\nKV key 前缀计数：")
		for _, prefix := range d1migration.SortedCountKeys(report.KVPrefixes) {
			fmt.Printf("- %s: %d\n", prefix, report.KVPrefixes[prefix])
		}
	}

	if len(report.TargetTables) > 0 {
		fmt.Println("\nPostgreSQL 目标映射估算：")
		for _, target := range d1migration.SortedCountKeys(report.TargetTables) {
			fmt.Printf("- %s: %d\n", target, report.TargetTables[target])
		}
	}

	if len(report.MappingCounts) > 0 {
		fmt.Println("\n源数据到目标字段映射：")
		for _, mapping := range d1migration.SortedMappingKeys(report.MappingCounts) {
			fmt.Printf("- %s: %d\n", mapping, report.MappingCounts[mapping])
		}
	}

	if len(report.UnmappedSources) > 0 {
		fmt.Println("\n未映射或待后续 schema 的数据源：")
		for _, source := range d1migration.SortedCountKeys(report.UnmappedSources) {
			fmt.Printf("- %s: %d\n", source, report.UnmappedSources[source])
		}
	}

	if len(report.Warnings) > 0 {
		fmt.Println("\n警告：")
		for _, warning := range report.Warnings {
			fmt.Printf("- %s\n", warning)
		}
	}

	if !*apply {
		return
	}

	if *scope != "public-lists" && *scope != "users-points" && *scope != "points-history" && *scope != "store-data" && *scope != "user-assets" && *scope != "user-profiles" && *scope != "user-achievements" && *scope != "notifications" && *scope != "reward-claims" && *scope != "raffle-entries" && *scope != "eco-state" && *scope != "eco-global" && *scope != "farm-v2" && *scope != "cards" && *scope != "feedback" {
		fmt.Fprintf(os.Stderr, "不支持的导入范围：%s。当前只支持 public-lists、users-points、points-history、store-data、user-assets、user-profiles、user-achievements、notifications、reward-claims、raffle-entries、eco-state、eco-global、farm-v2、cards、feedback。\n", *scope)
		os.Exit(2)
	}

	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		fmt.Fprintln(os.Stderr, "执行 -apply 需要设置 DATABASE_URL")
		os.Exit(2)
	}

	ctx := context.Background()
	db, err := postgres.Open(ctx, databaseURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "连接 PostgreSQL 失败：%v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	switch *scope {
	case "public-lists":
		plan, err := d1migration.PlanPublicListImport(io.NopCloser(bytes.NewReader(raw)))
		if err != nil {
			fmt.Fprintf(os.Stderr, "生成 public-lists 导入计划失败：%v\n", err)
			os.Exit(1)
		}
		result, err := d1migration.ApplyPublicListImport(ctx, db, plan)
		if err != nil {
			fmt.Fprintf(os.Stderr, "执行 public-lists 导入失败：%v\n", err)
			os.Exit(1)
		}
		fmt.Println("\npublic-lists 导入结果：")
		fmt.Printf("- projects upserted: %d\n", result.ProjectsUpserted)
		fmt.Printf("- raffles upserted: %d\n", result.RafflesUpserted)
		printImportWarnings(result.Warnings)
	case "users-points":
		plan, err := d1migration.PlanUsersPointsImport(io.NopCloser(bytes.NewReader(raw)))
		if err != nil {
			fmt.Fprintf(os.Stderr, "生成 users-points 导入计划失败：%v\n", err)
			os.Exit(1)
		}
		result, err := d1migration.ApplyUsersPointsImport(ctx, db, plan)
		if err != nil {
			fmt.Fprintf(os.Stderr, "执行 users-points 导入失败：%v\n", err)
			os.Exit(1)
		}
		fmt.Println("\nusers-points 导入结果：")
		fmt.Printf("- users upserted: %d\n", result.UsersUpserted)
		fmt.Printf("- point accounts upserted: %d\n", result.PointAccountsUpserted)
		printImportWarnings(result.Warnings)
	case "points-history":
		plan, err := d1migration.PlanPointsHistoryImport(io.NopCloser(bytes.NewReader(raw)))
		if err != nil {
			fmt.Fprintf(os.Stderr, "生成 points-history 导入计划失败：%v\n", err)
			os.Exit(1)
		}
		result, err := d1migration.ApplyPointsHistoryImport(ctx, db, plan)
		if err != nil {
			fmt.Fprintf(os.Stderr, "执行 points-history 导入失败：%v\n", err)
			os.Exit(1)
		}
		fmt.Println("\npoints-history 导入结果：")
		fmt.Printf("- users upserted: %d\n", result.UsersUpserted)
		fmt.Printf("- point logs upserted: %d\n", result.PointLogsUpserted)
		fmt.Printf("- daily game points upserted: %d\n", result.DailyGamePointsUpserted)
		printImportWarnings(result.Warnings)
	case "store-data":
		plan, err := d1migration.PlanStoreDataImport(io.NopCloser(bytes.NewReader(raw)))
		if err != nil {
			fmt.Fprintf(os.Stderr, "生成 store-data 导入计划失败：%v\n", err)
			os.Exit(1)
		}
		result, err := d1migration.ApplyStoreDataImport(ctx, db, plan)
		if err != nil {
			fmt.Fprintf(os.Stderr, "执行 store-data 导入失败：%v\n", err)
			os.Exit(1)
		}
		fmt.Println("\nstore-data 导入结果：")
		fmt.Printf("- users upserted: %d\n", result.UsersUpserted)
		fmt.Printf("- store categories upserted: %d\n", result.CategoriesUpserted)
		fmt.Printf("- store items upserted: %d\n", result.ItemsUpserted)
		fmt.Printf("- exchange logs upserted: %d\n", result.ExchangeLogsUpserted)
		fmt.Printf("- store daily purchases upserted: %d\n", result.DailyPurchasesUpserted)
		printImportWarnings(result.Warnings)
	case "user-assets":
		plan, err := d1migration.PlanUserAssetsImport(io.NopCloser(bytes.NewReader(raw)))
		if err != nil {
			fmt.Fprintf(os.Stderr, "生成 user-assets 导入计划失败：%v\n", err)
			os.Exit(1)
		}
		result, err := d1migration.ApplyUserAssetsImport(ctx, db, plan)
		if err != nil {
			fmt.Fprintf(os.Stderr, "执行 user-assets 导入失败：%v\n", err)
			os.Exit(1)
		}
		fmt.Println("\nuser-assets 导入结果：")
		fmt.Printf("- users upserted: %d\n", result.UsersUpserted)
		fmt.Printf("- user assets upserted: %d\n", result.AssetsUpserted)
		printImportWarnings(result.Warnings)
	case "user-profiles":
		plan, err := d1migration.PlanUserProfilesImport(io.NopCloser(bytes.NewReader(raw)))
		if err != nil {
			fmt.Fprintf(os.Stderr, "生成 user-profiles 导入计划失败：%v\n", err)
			os.Exit(1)
		}
		result, err := d1migration.ApplyUserProfilesImport(ctx, db, plan)
		if err != nil {
			fmt.Fprintf(os.Stderr, "执行 user-profiles 导入失败：%v\n", err)
			os.Exit(1)
		}
		fmt.Println("\nuser-profiles 导入结果：")
		fmt.Printf("- users upserted: %d\n", result.UsersUpserted)
		fmt.Printf("- user profiles upserted: %d\n", result.ProfilesUpserted)
		printImportWarnings(result.Warnings)
	case "user-achievements":
		plan, err := d1migration.PlanUserAchievementsImport(io.NopCloser(bytes.NewReader(raw)))
		if err != nil {
			fmt.Fprintf(os.Stderr, "生成 user-achievements 导入计划失败：%v\n", err)
			os.Exit(1)
		}
		result, err := d1migration.ApplyUserAchievementsImport(ctx, db, plan)
		if err != nil {
			fmt.Fprintf(os.Stderr, "执行 user-achievements 导入失败：%v\n", err)
			os.Exit(1)
		}
		fmt.Println("\nuser-achievements 导入结果：")
		fmt.Printf("- users upserted: %d\n", result.UsersUpserted)
		fmt.Printf("- achievement grants upserted: %d\n", result.GrantsUpserted)
		fmt.Printf("- equipped achievements upserted: %d\n", result.EquippedUpserted)
		fmt.Printf("- forced achievements upserted: %d\n", result.ForcedUpserted)
		printImportWarnings(result.Warnings)
	case "notifications":
		plan, err := d1migration.PlanNotificationsImport(io.NopCloser(bytes.NewReader(raw)))
		if err != nil {
			fmt.Fprintf(os.Stderr, "生成 notifications 导入计划失败：%v\n", err)
			os.Exit(1)
		}
		result, err := d1migration.ApplyNotificationsImport(ctx, db, plan)
		if err != nil {
			fmt.Fprintf(os.Stderr, "执行 notifications 导入失败：%v\n", err)
			os.Exit(1)
		}
		fmt.Println("\nnotifications 导入结果：")
		fmt.Printf("- users upserted: %d\n", result.UsersUpserted)
		fmt.Printf("- notifications upserted: %d\n", result.NotificationsUpserted)
		printImportWarnings(result.Warnings)
	case "reward-claims":
		plan, err := d1migration.PlanRewardClaimsImport(io.NopCloser(bytes.NewReader(raw)))
		if err != nil {
			fmt.Fprintf(os.Stderr, "生成 reward-claims 导入计划失败：%v\n", err)
			os.Exit(1)
		}
		result, err := d1migration.ApplyRewardClaimsImport(ctx, db, plan)
		if err != nil {
			fmt.Fprintf(os.Stderr, "执行 reward-claims 导入失败：%v\n", err)
			os.Exit(1)
		}
		fmt.Println("\nreward-claims 导入结果：")
		fmt.Printf("- users upserted: %d\n", result.UsersUpserted)
		fmt.Printf("- reward batches upserted: %d\n", result.BatchesUpserted)
		fmt.Printf("- reward claims upserted: %d\n", result.ClaimsUpserted)
		printImportWarnings(result.Warnings)
	case "raffle-entries":
		plan, err := d1migration.PlanRaffleEntriesImport(io.NopCloser(bytes.NewReader(raw)))
		if err != nil {
			fmt.Fprintf(os.Stderr, "生成 raffle-entries 导入计划失败：%v\n", err)
			os.Exit(1)
		}
		result, err := d1migration.ApplyRaffleEntriesImport(ctx, db, plan)
		if err != nil {
			fmt.Fprintf(os.Stderr, "执行 raffle-entries 导入失败：%v\n", err)
			os.Exit(1)
		}
		fmt.Println("\nraffle-entries 导入结果：")
		fmt.Printf("- raffle entries upserted: %d\n", result.EntriesUpserted)
		printImportWarnings(result.Warnings)
	case "eco-state":
		plan, err := d1migration.PlanEcoStateImport(io.NopCloser(bytes.NewReader(raw)))
		if err != nil {
			fmt.Fprintf(os.Stderr, "生成 eco-state 导入计划失败：%v\n", err)
			os.Exit(1)
		}
		result, err := d1migration.ApplyEcoStateImport(ctx, db, plan)
		if err != nil {
			fmt.Fprintf(os.Stderr, "执行 eco-state 导入失败：%v\n", err)
			os.Exit(1)
		}
		fmt.Println("\neco-state 导入结果：")
		fmt.Printf("- users upserted: %d\n", result.UsersUpserted)
		fmt.Printf("- eco states upserted: %d\n", result.StatesUpserted)
		fmt.Printf("- eco upgrades upserted: %d\n", result.UpgradesUpserted)
		fmt.Printf("- eco prize inventories upserted: %d\n", result.PrizeInventoriesUpserted)
		fmt.Printf("- eco prize lots upserted: %d\n", result.PrizeLotsUpserted)
		fmt.Printf("- eco visible prizes upserted: %d\n", result.VisiblePrizesUpserted)
		fmt.Printf("- eco item purchases upserted: %d\n", result.ItemPurchasesUpserted)
		printImportWarnings(result.Warnings)
	case "eco-global":
		plan, err := d1migration.PlanEcoGlobalImport(io.NopCloser(bytes.NewReader(raw)))
		if err != nil {
			fmt.Fprintf(os.Stderr, "生成 eco-global 导入计划失败：%v\n", err)
			os.Exit(1)
		}
		result, err := d1migration.ApplyEcoGlobalImport(ctx, db, plan)
		if err != nil {
			fmt.Fprintf(os.Stderr, "执行 eco-global 导入失败：%v\n", err)
			os.Exit(1)
		}
		fmt.Println("\neco-global 导入结果：")
		fmt.Printf("- users upserted: %d\n", result.UsersUpserted)
		fmt.Printf("- eco global prize stock upserted: %d\n", result.GlobalPrizeStockUpserted)
		fmt.Printf("- eco public prizes upserted: %d\n", result.PublicPrizesUpserted)
		fmt.Printf("- eco thefts upserted: %d\n", result.TheftsUpserted)
		fmt.Printf("- eco prize claim stats upserted: %d\n", result.PrizeClaimStatsUpserted)
		fmt.Printf("- eco trash rankings upserted: %d\n", result.TrashRankingsUpserted)
		printImportWarnings(result.Warnings)
	case "farm-v2":
		plan, err := d1migration.PlanFarmV2Import(io.NopCloser(bytes.NewReader(raw)))
		if err != nil {
			fmt.Fprintf(os.Stderr, "生成 farm-v2 导入计划失败：%v\n", err)
			os.Exit(1)
		}
		result, err := d1migration.ApplyFarmV2Import(ctx, db, plan)
		if err != nil {
			fmt.Fprintf(os.Stderr, "执行 farm-v2 导入失败：%v\n", err)
			os.Exit(1)
		}
		fmt.Println("\nfarm-v2 导入结果：")
		fmt.Printf("- users upserted: %d\n", result.UsersUpserted)
		fmt.Printf("- farm states upserted: %d\n", result.StatesUpserted)
		fmt.Printf("- farm daily purchases upserted: %d\n", result.DailyPurchasesUpserted)
		fmt.Printf("- farm maturity email dedupes upserted: %d\n", result.MaturityEmailsUpserted)
		fmt.Printf("- farm water email dedupes upserted: %d\n", result.WaterEmailsUpserted)
		printImportWarnings(result.Warnings)
	case "cards":
		plan, err := d1migration.PlanCardsImport(io.NopCloser(bytes.NewReader(raw)))
		if err != nil {
			fmt.Fprintf(os.Stderr, "生成 cards 导入计划失败：%v\n", err)
			os.Exit(1)
		}
		result, err := d1migration.ApplyCardsImport(ctx, db, plan)
		if err != nil {
			fmt.Fprintf(os.Stderr, "执行 cards 导入失败：%v\n", err)
			os.Exit(1)
		}
		fmt.Println("\ncards 导入结果：")
		fmt.Printf("- users upserted: %d\n", result.UsersUpserted)
		fmt.Printf("- card user states upserted: %d\n", result.StatesUpserted)
		fmt.Printf("- card rules upserted: %d\n", result.RulesUpserted)
		fmt.Printf("- card album rewards upserted: %d\n", result.AlbumRewardsUpserted)
		fmt.Printf("- card tier rewards upserted: %d\n", result.TierRewardsUpserted)
		printImportWarnings(result.Warnings)
	case "feedback":
		plan, err := d1migration.PlanFeedbackImport(io.NopCloser(bytes.NewReader(raw)))
		if err != nil {
			fmt.Fprintf(os.Stderr, "生成 feedback 导入计划失败：%v\n", err)
			os.Exit(1)
		}
		result, err := d1migration.ApplyFeedbackImport(ctx, db, plan)
		if err != nil {
			fmt.Fprintf(os.Stderr, "执行 feedback 导入失败：%v\n", err)
			os.Exit(1)
		}
		fmt.Println("\nfeedback 导入结果：")
		fmt.Printf("- users upserted: %d\n", result.UsersUpserted)
		fmt.Printf("- feedback items upserted: %d\n", result.ItemsUpserted)
		fmt.Printf("- feedback messages upserted: %d\n", result.MessagesUpserted)
		fmt.Printf("- feedback likes upserted: %d\n", result.LikesUpserted)
		printImportWarnings(result.Warnings)
	}
}

func printImportWarnings(warnings []string) {
	if len(warnings) == 0 {
		return
	}
	fmt.Println("- warnings:")
	for _, warning := range warnings {
		fmt.Printf("  - %s\n", warning)
	}
}
