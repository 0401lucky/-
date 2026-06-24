interface CloudflareEnv {
  ASSETS: Fetcher;
  WORKER_SELF_REFERENCE: Fetcher;
  NEXT_INC_CACHE_R2_BUCKET: R2Bucket;
  FEEDBACK_IMAGES: R2Bucket;
  CARD_IMAGES: R2Bucket;
  IMAGES: unknown;
  KV_DB: D1Database;
  MINESWEEPER_SESSION_DO: DurableObjectNamespace;
  NEW_API_URL?: string;
  SESSION_SECRET?: string;
  ADMIN_USERNAMES?: string;
  NEXT_PUBLIC_BASE_URL?: string;
  NEW_API_ADMIN_ACCESS_TOKEN?: string;
  NEW_API_ADMIN_USER_ID?: string;
  RAFFLE_DELIVERY_CRON_SECRET?: string;
  SCHEDULED_MAINTENANCE_SECRET?: string;
  CRON_SECRET?: string;
  RAFFLE_DELIVERY_CRON_MAX_JOBS?: string;
}
