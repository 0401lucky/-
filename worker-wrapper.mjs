/**
 * Cloudflare Worker 入口包装器
 * 1) 正常请求转发给 OpenNext 生成的 worker
 * 2) 处理 Cron 触发，自动调用发奖队列接口
 */

const DELIVERY_PATH = "/api/internal/raffle/delivery";
const DEFAULT_MAX_JOBS = 20;

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

export default {
  async fetch(request, env, ctx) {
    const worker = await getOpenNextWorker();
    return worker.fetch(request, env, ctx);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(triggerDelivery(env));
  },
};
