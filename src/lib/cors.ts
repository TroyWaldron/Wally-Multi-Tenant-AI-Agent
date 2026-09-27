// The widget runs on each client's own website, so its two endpoints allow
// any origin. They only accept a tenant's public key, never a secret.
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Small per-instance limiter so one visitor can't run up a tenant's AI bill.
const hits = new Map<string, number[]>();
export function rateLimited(key: string, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}
