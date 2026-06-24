INSERT INTO "native_user_point_logs" ("id","user_id","amount","source","description","balance","created_at") VALUES('fixture-log-1',95001,15,'game_play','Fixture 游戏奖励',115,1000);
INSERT INTO "native_user_daily_game_points" ("user_id","stat_date","earned_points","updated_at") VALUES(95001,'2026-06-22',25,2000);
INSERT INTO "kv_lists" ("id","key","value") VALUES(1,'points_log:95002','{"id":"fixture-log-2","amount":-7,"source":"exchange","description":"Fixture 兑换","balance":93,"createdAt":3000}');
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('game:daily_earned:95002:2026-06-22','35',NULL);
