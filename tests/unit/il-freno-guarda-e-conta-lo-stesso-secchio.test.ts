import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * IL FRENO DEVE GUARDARE E CONTARE LO STESSO SECCHIO.
 *
 * 31/8/2026 (R003/R020, ricaduta) — Da oggi il freno per rete fa due cose
 * separate: GUARDA il conto prima di autenticare (senza toccarlo) e lo fa
 * salire solo quando il tentativo va a vuoto. Sono due strade diverse dentro
 * Redis: una lettura e un incremento.
 *
 * Se quelle due strade non finissero sullo stesso contatore, il freno
 * risulterebbe sempre vuoto e non scatterebbe mai. Sarebbe il guasto peggiore
 * di tutti: nessuna prova rossa, nessun errore nei registri, e in produzione
 * — l'unico posto dove Redis c'e' davvero — la porta spalancata.
 *
 * Le chiavi contengono il percorso della rotta, quindi due punti e barre
 * (`rete:/api/orders/:id:93.40.10.5`). Bastava una differenza di codifica fra
 * la lettura e la scrittura per leggere un contatore che non esiste.
 *
 * Qui Redis viene finto, ma finto per come si comporta: una scatola che tiene
 * i conti per chiave, esattamente come fa Upstash. Le chiavi le decide il
 * codice vero.
 */

const salvato = { ...process.env };
const fetchVero = globalThis.fetch;

/** I conti che il finto Redis tiene, per chiave gia' decodificata. */
const conti = new Map<string, number>();
const visti = { letture: 0, incrementi: 0 };

/**
 * Il finto Redis e' SEVERO come quello vero: la chiave sta in UN solo pezzo
 * dell'indirizzo. Se chi legge non la codifica, le barre del percorso della
 * rotta spezzano l'indirizzo in piu' pezzi e la richiesta e' malformata — che
 * e' esattamente quello che succederebbe in produzione. Un finto Redis
 * indulgente qui direbbe verde su un codice che in produzione non trova mai
 * niente.
 */
function fintoUpstash(url: string): Response {
  const pezzi = new URL(url).pathname.split('/').filter(Boolean);
  if (pezzi[0] !== 'get' || pezzi.length !== 2) {
    return new Response(JSON.stringify({ error: 'chiave non codificata' }), { status: 400 });
  }
  visti.letture++;
  const conto = conti.get(decodeURIComponent(pezzi[1]));
  return new Response(JSON.stringify({ result: conto === undefined ? null : String(conto) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  conti.clear();
  visti.letture = 0;
  visti.incrementi = 0;
  vi.resetModules();
  process.env.UPSTASH_REDIS_REST_URL = 'https://finto-redis.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'gettone';

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/pipeline')) {
      const comandi = JSON.parse(String(init?.body)) as string[][];
      const chiave = comandi[0][1];
      visti.incrementi++;
      const nuovo = (conti.get(chiave) ?? 0) + 1;
      conti.set(chiave, nuovo);
      return new Response(JSON.stringify([{ result: nuovo }, { result: 1 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return fintoUpstash(url);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = fetchVero;
  process.env = { ...salvato };
});

/** La chiave vera del freno: dentro ci sono due punti e barre. */
const CHIAVE = 'rete:/api/orders/:id:93.40.10.5';

describe('con Redis collegato, come in produzione', () => {
  it('IL CASO CHE ROMPEREBBE — dopo trecento tentativi a vuoto il freno scatta davvero', async () => {
    const { rateLimitAsync, contatoreGiaAlTetto } = await import('@/lib/rate-limit');
    const secchio = { key: CHIAVE, max: 300, windowMs: 60_000 };

    for (let i = 0; i < 300; i++) await rateLimitAsync(secchio);

    const stato = await contatoreGiaAlTetto(secchio);
    expect(
      stato.allowed,
      'chi guarda il conto legge un secchio diverso da quello che si riempie: il freno non scattera mai',
    ).toBe(false);
    expect(stato.retryAfterSec).toBeGreaterThan(0);
  });

  it('e prima del tetto lascia passare, senza far salire il conto', async () => {
    const { rateLimitAsync, contatoreGiaAlTetto } = await import('@/lib/rate-limit');
    const secchio = { key: CHIAVE, max: 300, windowMs: 60_000 };

    for (let i = 0; i < 299; i++) await rateLimitAsync(secchio);
    const incrementiPrima = visti.incrementi;

    expect((await contatoreGiaAlTetto(secchio)).allowed).toBe(true);
    expect((await contatoreGiaAlTetto(secchio)).allowed).toBe(true);

    expect(
      visti.incrementi,
      'guardare il conto lo fa salire: allora il freno conta anche chi entra regolarmente',
    ).toBe(incrementiPrima);
  });

  it('la lettura passa davvero per Redis, non per il contatore locale', async () => {
    const { contatoreGiaAlTetto } = await import('@/lib/rate-limit');
    await contatoreGiaAlTetto({ key: CHIAVE, max: 300, windowMs: 60_000 });
    expect(
      visti.letture,
      'con Redis collegato la lettura non lo interroga: in produzione ogni copia conterebbe per conto suo',
    ).toBeGreaterThan(0);
  });

  it('due secchi diversi restano due secchi diversi', async () => {
    const { rateLimitAsync, contatoreGiaAlTetto } = await import('@/lib/rate-limit');
    for (let i = 0; i < 300; i++) {
      await rateLimitAsync({ key: CHIAVE, max: 300, windowMs: 60_000 });
    }
    const altro = await contatoreGiaAlTetto({
      key: 'rete:/api/orders/:id:203.0.113.9',
      max: 300,
      windowMs: 60_000,
    });
    expect(altro.allowed, 'un visitatore innocente paga per la raffica di un altro').toBe(true);
  });

  it('se Redis non risponde si ripiega sul contatore locale invece di lasciare aperto', async () => {
    const { rateLimitAsync, contatoreGiaAlTetto, __resetRateLimitBuckets } = await import('@/lib/rate-limit');
    __resetRateLimitBuckets();
    globalThis.fetch = (async () => { throw new Error('rete giu'); }) as typeof fetch;

    const secchio = { key: CHIAVE, max: 5, windowMs: 60_000 };
    for (let i = 0; i < 5; i++) await rateLimitAsync(secchio);

    expect(
      (await contatoreGiaAlTetto(secchio)).allowed,
      'con Redis giu il freno si spegne del tutto invece di stringersi sul contatore locale',
    ).toBe(false);
  });
});
