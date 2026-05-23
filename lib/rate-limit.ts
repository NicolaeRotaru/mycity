/**
 * Rate limiter sliding-window in-memory.
 *
 * Limiti:
 *  - In ambienti serverless (Vercel, Lambda) lo stato non è condiviso tra
 *    istanze. Per protezione robusta in produzione passare a Upstash Redis
 *    o KV (sostituire la Map con il client KV).
 *  - Su Render (single instance) o self-hosted con istanza singola funziona
 *    perfettamente per fermare bot/scripting.
 *
 * Uso:
 *   const rl = rateLimit({ key: `signin:${ip}`, max: 10, windowMs: 60_000 });
 *   if (!rl.allowed) return jsonError(429, 'Troppe richieste');
 */

type Bucket = { times: number[] };

const buckets = new Map<string, Bucket>();

const MAX_KEYS = 50_000; // protezione memoria
function gcIfNeeded() {
  if (buckets.size <= MAX_KEYS) return;
  // Rimuovi chiavi più vecchie (best-effort, no LRU vero)
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
  /** Numero massimo di richieste nella finestra. */
  max: number;
  /** Lunghezza della finestra in ms. */
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
};

export function rateLimit({ key, max, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const since = now - windowMs;

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { times: [] };
    buckets.set(key, bucket);
    gcIfNeeded();
  }
  // Mantieni solo le richieste dentro la finestra
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

/** Estrae IP "ragionevole" da NextRequest. Non perfetto contro spoofing. */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}
