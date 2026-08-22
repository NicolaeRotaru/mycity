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

/**
 * #237 — La pulizia che non puliva.
 *
 * Prima si cancellavano solo le chiavi ferme da piu' di un'ora. Sotto attacco
 * — cinquantamila indirizzi diversi in pochi minuti — nessuna chiave e' vecchia
 * di un'ora: il ciclo scorreva tutte e cinquantamila senza cancellarne una, e
 * lo faceva a OGNI nuova chiave. Il freno anti-abuso diventava il modo piu'
 * comodo per consumare memoria e tempo di calcolo: esattamente il danno che
 * doveva impedire.
 *
 * Ora si cancella per anzianita' — le chiavi col colpo piu' vecchio per prime —
 * fino a rientrare sotto il tetto, sempre. E si scende sotto la soglia di un
 * buon margine, cosi' la pulizia non riparte a ogni inserimento.
 */
const QUOTA_DA_LIBERARE = 0.1; // si libera il 10% quando si tocca il tetto

function gcIfNeeded() {
  if (buckets.size <= MAX_KEYS) return;
  const daTogliere = Math.max(1, Math.ceil(MAX_KEYS * QUOTA_DA_LIBERARE));
  const perAnzianita = Array.from(buckets.entries())
    .map(([key, b]) => ({ key, ultimo: b.times.length > 0 ? b.times[b.times.length - 1] : 0 }))
    .sort((a, b) => a.ultimo - b.ultimo);
  for (let i = 0; i < daTogliere && i < perAnzianita.length; i++) {
    buckets.delete(perAnzianita[i].key);
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

/**
 * Reset dei bucket in-memory. SOLO per test isolation (vitest beforeEach).
 * In produzione non va mai chiamato: il GC interno (MAX_KEYS) gestisce
 * la cleanup automatica.
 */
export function __resetRateLimitBuckets(): void {
  buckets.clear();
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

/**
 * Quanti proxy fidati stanno davanti all'applicazione. In produzione ce n'è uno
 * (l'ingresso della piattaforma). Se un giorno se ne aggiunge un altro — per
 * esempio un CDN davanti — si alza questo numero via variabile d'ambiente,
 * senza toccare il codice.
 */
const PROXY_FIDATI = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? '1') || 1);

/**
 * L'indirizzo di chi sta chiamando davvero.
 *
 * Perché non si legge il primo pezzo dell'intestazione: `x-forwarded-for` è una
 * catena, e ogni proxy AGGIUNGE IN CODA l'indirizzo da cui ha ricevuto. Il primo
 * pezzo è quindi quello che ha scritto il chiamante, che può inventarselo: con
 * `X-Forwarded-For: <numero casuale>` a ogni richiesta si otteneva un contatore
 * nuovo ogni volta, e il limite sui tentativi di accesso non contava più nulla.
 *
 * Si legge invece da destra, scartando i proxy fidati: quello è l'indirizzo
 * scritto dalla nostra infrastruttura, che il chiamante non può falsificare.
 */
export function getClientIp(req: Request): string {
  /**
   * 22/8/2026 — DIETRO CLOUDFLARE SI LEGGEVA L'INDIRIZZO SBAGLIATO.
   *
   * Con un CDN davanti, la catena `x-forwarded-for` ha due salti invece di uno,
   * e questo conto — che ne scarta uno solo — restituiva l'indirizzo del CDN.
   * Tutti i visitatori diventavano lo stesso indirizzo: il freno anti-abuso
   * scattava su tutti insieme dopo poche richieste, e le visite venivano
   * buttate come se fossero un attacco.
   *
   * Cloudflare scrive l'indirizzo vero in un'intestazione sua,
   * `cf-connecting-ip`, che aggiunge lui e che il chiamante non puo'
   * falsificare: quando c'e', e' la risposta piu' affidabile che abbiamo. Se
   * non c'e', resta il conto di prima, che e' quello giusto senza CDN.
   */
  const cloudflare = req.headers.get('cf-connecting-ip');
  if (cloudflare) return cloudflare.trim();

  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const catena = xff.split(',').map((p) => p.trim()).filter(Boolean);
    if (catena.length > 0) {
      const i = Math.max(0, catena.length - PROXY_FIDATI);
      return catena[i] ?? catena[catena.length - 1];
    }
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}
