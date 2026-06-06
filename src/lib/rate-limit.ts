/**
 * Lightweight in-memory rate limiter.
 *
 * Fixed-window counter, keyed by client IP, kept in module memory. This is a
 * pragmatic guard for a single-instance POC: it stops one visitor from spamming
 * the public chat endpoint and burning Anthropic credits. It does NOT persist
 * across restarts and is not shared across multiple server instances — for
 * production use a shared store (e.g. Upstash Redis).
 */

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_PER_MIN ?? 15);

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string): RateLimitResult {
  const now = Date.now();

  // Opportunistic cleanup so the map doesn't grow unbounded over time.
  if (buckets.size > 5_000) {
    for (const [k, b] of buckets) {
      if (now >= b.resetAt) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: MAX_REQUESTS - bucket.count,
    retryAfterSeconds: 0,
  };
}

/** Best-effort client IP from common proxy headers (Vercel sets these). */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
