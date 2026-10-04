// Small fixed-window rate limiter for unauthenticated endpoints.
//
// IN-MEMORY AND PER SERVER INSTANCE. On a serverless host each warm instance
// keeps its own counters, so this slows a single attacker hammering one instance
// and stops accidental loops, but it is not a global guarantee - put a real
// edge/WAF limit in front for that. It is deliberately dependency-free so the
// protection exists today; swapping the store for a shared one only means
// replacing `buckets`.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (only meaningful when not allowed). */
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) pruneExpired(now);
    // Still full of live windows (a flood of distinct keys): drop the oldest
    // entry rather than grow without bound.
    if (buckets.size >= MAX_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  existing.count += 1;
  if (existing.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function pruneExpired(now: number): void {
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

/** The caller's address as the host reports it (first hop of x-forwarded-for). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test helper. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Same limiter with the shape other routes here use: `{ ok, retryAfterSeconds }`. */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterSeconds: number } {
  const r = checkRateLimit(key, limit, windowMs, now);
  return { ok: r.allowed, retryAfterSeconds: r.retryAfterSeconds };
}
