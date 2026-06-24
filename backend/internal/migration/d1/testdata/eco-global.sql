INSERT INTO "kv_hashes" ("key","field","value") VALUES('eco:global-prize-stock','diamond','2');
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:public-prizes','[{"id":"pub-99321-1","key":"diamond","ownerUserId":99321,"ownerName":"Alice","ownerLotId":"lot-99321-1","publicAt":1000,"merchantAvailableAt":2000,"status":"stolen","thiefUserId":99322,"thiefName":"Bob","theftMessage":"test","stolenAt":3000}]',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:thefts','[{"id":"theft-99321-1","key":"coin","originalUserId":99321,"thiefUserId":99322,"publicEntryId":"pub-99321-1","originalLotId":"lot-99321-1","thiefLotId":"lot-99322-1","stolenAt":3000,"nextCheckAt":4000,"blackMarketAvailableAt":5000,"message":"test","resolvedAt":6000,"outcome":"caught"}]',NULL);
INSERT INTO "kv_hashes" ("key","field","value") VALUES('eco:prize-claims:2026-06-23','diamond','4');
INSERT INTO "kv_hashes" ("key","field","value") VALUES('eco:prize-claims:2026-06-23','total','5');
INSERT INTO "kv_zsets" ("key","member","score") VALUES('eco:trash-rank:daily:2026-06-23','u:99321',12);
