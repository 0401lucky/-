INSERT INTO "native_user_assets" ("user_id","extra_spins","updated_at") VALUES(99201,9,2000);
INSERT INTO "native_user_cards" ("user_id","value_json","updated_at") VALUES(99201,'{"drawsAvailable":4}',3000);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:extra_spins:99201','2',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:user:99201','{"drawsAvailable":1}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:makeup_cards:99201','3',NULL);
