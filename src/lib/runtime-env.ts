import { getCloudflareContext } from "@opennextjs/cloudflare";

type RuntimeEnvRecord = Record<string, unknown>;

function getCloudflareEnv(): RuntimeEnvRecord | null {
  try {
    const context = getCloudflareContext() as { env?: RuntimeEnvRecord } | undefined;
    return context?.env ?? null;
  } catch {
    return null;
  }
}

export function getRuntimeEnvValue(key: string): string | undefined {
  const processValue = process.env[key];
  if (typeof processValue === "string" && processValue.length > 0) {
    return processValue;
  }

  const cloudflareValue = getCloudflareEnv()?.[key];
  if (typeof cloudflareValue === "string" && cloudflareValue.length > 0) {
    return cloudflareValue;
  }

  return undefined;
}

export function sanitizeRuntimeEnvValue(value: string | undefined): string {
  if (!value) return "";

  return value
    .replace(/\\r\\n|\\n|\\r/g, "")
    .replace(/[\r\n]/g, "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
}
