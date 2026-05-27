/**
 * Rate limiter sliding-window — adapter pattern.
 *
 * Esperti consultati:
 * - SRE: "In-memory funziona su single instance Render. Su scale-out o
 *   serverless multi-region usa Upstash Redis REST API (HTTP, no socket).
 *   Fallback automatico a in-memory se Upstash non configurato."
 * - Security Engineer: "Rate limit DEVE proteggere comunque, anche se Redis
 *   e' giu'. Fail-open su Redis error = fail su in-memory locale, mai aperto."
 *
 * Uso:
 *   const rl = await rateLimit({ key: `signin:${ip}`, max: 10, windowMs: 60_000 });
 *   if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);
 *
 * Backward-compat: la funzione e' rimasta sincrona (return RateLimitResult)
 * per non rompere i 25+ callsite. La versione async (Redis-backed) e'
 * disponibile come rateLimitAsync() per nuovi endpoint critical-path.
 */

type Bucket = { times: number[] };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 50_000;

function gcIfNeeded() {
  if (buckets.size <= MAX_KEYS) return;
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (b.times.length === 0 || now - b.times[b.times.length - 1] > 60 * 60_000) {
      buckets.delete(key);
    }
    if (buckets.size <= MAX_KEYS) break;
  }
}

export type RateLimitOptions = {
  key: string;
  max: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
};

// In-memory (sliding window) — back-compat sync API
export function rateLimit({ key, max, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const since = now - windowMs;

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { times: [] };
    buckets.set(key, bucket);
    gcIfNeeded();
  }
  bucket.times = bucket.times.filter((t) => t > since);

  if (bucket.times.length >= max) {
    const oldest = bucket.times[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec: retryAfter, limit: max };
  }

  bucket.times.push(now);
  return {
    allowed: true,
    remaining: max - bucket.times.length,
    retryAfterSec: 0,
    limit: max,
  };
}

// =============================================================================
// UPSTASH REDIS ADAPTER (production multi-instance)
// =============================================================================
//
// Pattern: fixed window con counter atomico. Piu' semplice di sliding window
// ma piu' veloce (1 INCR vs N filter). Acceptable trade-off per il marketplace.
//
// Se UPSTASH_REDIS_REST_URL non e' configurato, fallback automatico a
// in-memory. Zero changes per il caller.

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function upstashIncr(key: string, ttlSec: number): Promise<number | null> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    // Pipeline: INCR + EXPIRE atomici via Upstash batch endpoint
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', `rl:${key}`],
        ['EXPIRE', `rl:${key}`, String(ttlSec), 'NX'],
      ]),
      // Timeout breve: rate limit deve essere fast-path
      signal: AbortSignal.timeout(500),
    });
    if (!res.ok) return null;
    const data: Array<{ result: number | string }> = await res.json();
    const count = Number(data[0]?.result);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null; // network error → fallback in-memory
  }
}

/**
 * Async version con fallback automatico a in-memory.
 *
 * Usare per endpoint critical-path (signin, signup, checkout) dove il rate
 * limit deve sopravvivere al restart container e scale-out.
 */
export async function rateLimitAsync(opts: RateLimitOptions): Promise<RateLimitResult> {
  const ttlSec = Math.ceil(opts.windowMs / 1000);

  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const count = await upstashIncr(opts.key, ttlSec);
    if (count !== null) {
      const allowed = count <= opts.max;
      return {
        allowed,
        remaining: Math.max(0, opts.max - count),
        retryAfterSec: allowed ? 0 : ttlSec,
        limit: opts.max,
      };
    }
    // Fallback se Upstash unreachable: usa in-memory locale invece di
    // fail-open (mai lasciare il marketplace senza rate limit).
  }

  return rateLimit(opts);
}

/** Estrae IP "ragionevole" da NextRequest. Non perfetto contro spoofing. */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}
