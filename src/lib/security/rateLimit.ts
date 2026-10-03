// A small fixed-window limiter, kept in memory. On serverless each instance counts on its own,
// so this is a speed bump against a single noisy client, not a global quota; a shared edge or
// WAF limit is still the right control for determined abuse. It never throws and never touches
// the database, so it cannot take a route down.

const buckets = new Map<string, { resetAt: number; count: number }>();
const MAX_BUCKETS = 5000;

export interface RateLimitResult { ok: boolean; retryAfterSeconds: number }

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    if (buckets.size > MAX_BUCKETS) buckets.clear();
  }
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { resetAt: now + windowMs, count: 1 });
    return { ok: true, retryAfterSeconds: 0 };
  }
  b.count += 1;
  return b.count <= limit ? { ok: true, retryAfterSeconds: 0 } : { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
}

export function resetRateLimits(): void {
  buckets.clear();
}

/** Best-effort client address from the proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
