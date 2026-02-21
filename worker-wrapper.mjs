/**
 * Cloudflare Worker 入口包装器
 * 1) 正常请求转发给 OpenNext 生成的 worker
 * 2) 处理 Cron 触发，自动调用发奖队列接口
 */

const DELIVERY_PATH = "/api/internal/raffle/delivery";
const DEFAULT_MAX_JOBS = 20;
const IMAGE_PREFIX = "/images/";
const IMAGE_MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function readSecret(env) {
  return String(env.RAFFLE_DELIVERY_CRON_SECRET || env.CRON_SECRET || "").trim();
}

function parseMaxJobs(env) {
  const raw = String(env.RAFFLE_DELIVERY_CRON_MAX_JOBS || "").trim();
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_JOBS;
  }
  return Math.max(1, Math.min(20, value));
}

let openNextWorkerPromise;
async function getOpenNextWorker() {
  if (!openNextWorkerPromise) {
    openNextWorkerPromise = import("./.open-next/worker.js");
  }
  const mod = await openNextWorkerPromise;
  const fetchHandler = mod?.default?.fetch;
  if (typeof fetchHandler !== "function") {
    throw new Error("OpenNext worker fetch handler not found");
  }
  return mod.default;
}

async function triggerDelivery(env) {
  const secret = readSecret(env);
  if (!secret) {
    console.warn("[cron] 缺少 RAFFLE_DELIVERY_CRON_SECRET/CRON_SECRET，跳过发奖任务");
    return;
  }

  if (!env.WORKER_SELF_REFERENCE?.fetch) {
    console.warn("[cron] 缺少 WORKER_SELF_REFERENCE 绑定，跳过发奖任务");
    return;
  }

  const maxJobs = parseMaxJobs(env);
  const response = await env.WORKER_SELF_REFERENCE.fetch(`https://internal${DELIVERY_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ maxJobs }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error(`[cron] 发奖任务调用失败: ${response.status} ${detail}`);
  }
}

async function maybeHandleCardImage(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(IMAGE_PREFIX)) {
    return null;
  }

  const encodedKey = url.pathname.slice(IMAGE_PREFIX.length);
  const decodedKey = decodeURIComponent(encodedKey);
  if (!decodedKey && !encodedKey) {
    return new Response(null, { status: 404 });
  }

  const bucket = env.CARD_IMAGES;
  if (!bucket?.get) {
    return new Response("CARD_IMAGES binding not available", { status: 503 });
  }

  const candidates = Array.from(new Set([decodedKey, encodedKey].filter(Boolean)));
  let object = null;
  let resolvedKey = "";
  for (const candidate of candidates) {
    const result = await bucket.get(candidate);
    if (result) {
      object = result;
      resolvedKey = candidate;
      if (result.body) {
        break;
      }
    }
  }

  if (!object) {
    return new Response(null, { status: 404 });
  }

  if (!object.body) {
    return new Response(null, { status: 404 });
  }

  const dotIndex = resolvedKey.lastIndexOf(".");
  const ext = dotIndex >= 0 ? resolvedKey.slice(dotIndex).toLowerCase() : "";
  const contentType =
    object.httpMetadata?.contentType ||
    IMAGE_MIME_TYPES[ext] ||
    "application/octet-stream";

  return new Response(object.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const imageResponse = await maybeHandleCardImage(request, env);
    if (imageResponse) {
      return imageResponse;
    }

    const worker = await getOpenNextWorker();
    return worker.fetch(request, env, ctx);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(triggerDelivery(env));
  },
};
