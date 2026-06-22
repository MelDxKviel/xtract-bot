export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the next request would be allowed (0 when allowed). */
  retryAfterMs: number;
}

export interface RateLimiter {
  /** Try to consume one token for `key`. Returns whether the action is allowed. */
  check(key: number, now?: number): RateLimitResult;
}

export interface RateLimiterOptions {
  /** Maximum number of requests allowed within the window (bucket capacity). */
  maxRequests: number;
  /** Window length in milliseconds over which the bucket fully refills. */
  windowMs: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

// Drop fully-refilled buckets once the map grows past this, so a flood of
// distinct user ids can't leak memory.
const PRUNE_THRESHOLD = 10_000;

/**
 * In-memory token-bucket rate limiter keyed by user id. Each key gets
 * `maxRequests` tokens that refill linearly over `windowMs`. State lives in the
 * limiter instance (not per-request), so create one and share it across updates.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const capacity = Math.max(1, options.maxRequests);
  const windowMs = Math.max(1, options.windowMs);
  const refillPerMs = capacity / windowMs;
  const buckets = new Map<number, Bucket>();

  const refill = (bucket: Bucket, now: number): void => {
    const elapsed = now - bucket.updatedAt;
    if (elapsed > 0) {
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
      bucket.updatedAt = now;
    }
  };

  return {
    check(key, now = Date.now()): RateLimitResult {
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: capacity, updatedAt: now };
        buckets.set(key, bucket);
      } else {
        refill(bucket, now);
      }

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        if (buckets.size > PRUNE_THRESHOLD) prune(buckets, capacity);
        return { allowed: true, retryAfterMs: 0 };
      }

      const retryAfterMs = Math.ceil((1 - bucket.tokens) / refillPerMs);
      return { allowed: false, retryAfterMs };
    },
  };
}

function prune(buckets: Map<number, Bucket>, capacity: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.tokens >= capacity) buckets.delete(key);
  }
}
