INSERT INTO "native_users" ("user_id","username","first_seen","updated_at") VALUES(92001,'fixture_alice',1000,2000);
INSERT INTO "native_user_points" ("user_id","balance","updated_at") VALUES(92001,456,2000);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:92002','{"id":92002,"username":"fixture_bob","firstSeen":3000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('points:92002','77',NULL);
