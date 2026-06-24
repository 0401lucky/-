INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:notif-test-1','{"id":"notif-test-1","userId":99501,"type":"system","title":"导入通知","content":"内容","data":{"link":"/notifications"},"createdAt":1700000000000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:notif-test-2','{"id":"notif-test-2","userId":99501,"type":"wallet","title":"已读通知","content":"内容","createdAt":1700000000100,"readAt":1700000000200}',NULL);
INSERT INTO "kv_zsets" ("key","score","member") VALUES('notifications:user:99501:index',1700000000000,'notif-test-1');
INSERT INTO "kv_sets" ("key","member") VALUES('notifications:user:99501:unread','notif-test-1');
INSERT INTO "kv_sets" ("key","member") VALUES('notifications:announcement:notified:ann-test','99501');
