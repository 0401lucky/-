interface CloudflareEnv {
  ASSETS: Fetcher;
  WORKER_SELF_REFERENCE: Fetcher;
  NEXT_INC_CACHE_R2_BUCKET: R2Bucket;
  FEEDBACK_IMAGES: R2Bucket;
  IMAGES: unknown;
  KV_DB: D1Database;
}
