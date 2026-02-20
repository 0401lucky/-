// default open-next.config.ts file created by @opennextjs/cloudflare
import { defineCloudflareConfig } from "@opennextjs/cloudflare/config";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

const config = defineCloudflareConfig({
	incrementalCache: r2IncrementalCache,
});

// 显式声明 edge runtime，确保生成 open-next.config.edge.mjs
if (config.middleware) {
	(config.middleware as { runtime?: "edge" }).runtime = "edge";
}

export default config;
