import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimitAsync, getClientIp, __resetRateLimitBuckets } from '@/lib/rate-limit';

/**
 * 22/8/2026 — `rateLimit` non è più esportata: da fuori si passa solo da
 * `rateLimitAsync`, che senza Redis configurato usa esattamente lo stesso
 * contatore in memoria. Le prove qui sotto misurano quel contatore attraverso
 * la porta buona, così coprono la strada che il sito percorre davvero.
 */
const rateLimit = rateLimitAsync;

/**
 * Unit test per lib/rate-limit (in-memory sliding window).
 *
 * Esperti: SRE: "Rate limit = primo strato difesa contro bot. Bug qui =
 * marketplace down per spam. Test ogni edge: race, gc, key isolation."
 */

describe('rateLimit - basic allow/deny', () => {
  beforeEach(() => {
    // Test isolation: pulisce i bucket in-memory tra ogni test per evitare
    // pollution indipendente dall'ordine vitest (incluso --watch mode).
    __resetRateLimitBuckets();
  });

  it('allows requests under limit', async () => {
    const key = `test-allow-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      const result = await rateLimit({ key, max: 10, windowMs: 60_000 });
      expect(result.allowed).toBe(true);
    }
  });

  it('denies when limit hit', async () => {
    const key = `test-deny-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      await rateLimit({ key, max: 3, windowMs: 60_000 });
    }
    const result = await rateLimit({ key, max: 3, windowMs: 60_000 });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  it('returns correct remaining count', async () => {
    const key = `test-remaining-${Math.random()}`;
    await rateLimit({ key, max: 5, windowMs: 60_000 });
    await rateLimit({ key, max: 5, windowMs: 60_000 });
    const result = await rateLimit({ key, max: 5, windowMs: 60_000 });
    expect(result.remaining).toBe(2); // 5 - 3 = 2
  });

  it('isolates buckets by key', async () => {
    const key1 = `test-iso-1-${Math.random()}`;
    const key2 = `test-iso-2-${Math.random()}`;

    // Esaurisci key1
    for (let i = 0; i < 3; i++) {
      await rateLimit({ key: key1, max: 3, windowMs: 60_000 });
    }
    expect((await rateLimit({ key: key1, max: 3, windowMs: 60_000 })).allowed).toBe(false);

    // key2 deve essere indipendente
    expect((await rateLimit({ key: key2, max: 3, windowMs: 60_000 })).allowed).toBe(true);
  });

  it('retryAfterSec is reasonable', async () => {
    const key = `test-retry-${Math.random()}`;
    const window = 60_000;
    for (let i = 0; i < 5; i++) {
      await rateLimit({ key, max: 5, windowMs: window });
    }
    const denied = await rateLimit({ key, max: 5, windowMs: window });
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeLessThanOrEqual(60);
    expect(denied.retryAfterSec).toBeGreaterThan(0);
  });

  it('limit field reflects max param', async () => {
    const result = await rateLimit({ key: `test-limit-${Math.random()}`, max: 42, windowMs: 1000 });
    expect(result.limit).toBe(42);
  });
});

describe('rateLimitAsync - distribuito con fallback in-memory', () => {
  beforeEach(() => {
    __resetRateLimitBuckets();
  });

  // In CI/test UPSTASH non e' configurato → rateLimitAsync ricade su in-memory.
  // Garantisce che il path async NON sia mai fail-open: applica comunque il limite.
  it('applica il limite anche senza Redis (mai fail-open)', async () => {
    const key = `test-async-deny-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      expect((await rateLimitAsync({ key, max: 3, windowMs: 60_000 })).allowed).toBe(true);
    }
    const denied = await rateLimitAsync({ key, max: 3, windowMs: 60_000 });
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThan(0);
  });

  it('condivide lo stato con il bucket in-memory sulla stessa chiave (fallback)', async () => {
    const key = `test-async-shared-${Math.random()}`;
    await rateLimit({ key, max: 2, windowMs: 60_000 });
    await rateLimit({ key, max: 2, windowMs: 60_000 });
    expect((await rateLimitAsync({ key, max: 2, windowMs: 60_000 })).allowed).toBe(false);
  });
});

describe('getClientIp', () => {
  const mkReq = (headers: Record<string, string>) =>
    new Request('http://localhost', { headers });

  // Questo test chiedeva il PRIMO pezzo della catena, cioè il valore scritto dal
  // chiamante — che può inventarselo. Così com'era, fissava la falla come
  // regola: bastava mandare un x-forwarded-for diverso a ogni richiesta per
  // avere un contatore nuovo ogni volta e non incontrare mai il limite.
  // Ora si legge l'ultimo pezzo, quello scritto dal nostro proxy.
  it('prende l\'indirizzo scritto dal proxy, non quello dichiarato dal chiamante', () => {
    const req = mkReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(getClientIp(req)).toBe('5.6.7.8');
  });

  it('extracts single x-forwarded-for', async () => {
    const req = mkReq({ 'x-forwarded-for': '1.2.3.4' });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip', async () => {
    const req = mkReq({ 'x-real-ip': '9.9.9.9' });
    expect(getClientIp(req)).toBe('9.9.9.9');
  });

  it('returns "unknown" when no header', async () => {
    const req = mkReq({});
    expect(getClientIp(req)).toBe('unknown');
  });

  it('trims whitespace', async () => {
    const req = mkReq({ 'x-forwarded-for': '   1.2.3.4  , 5.6.7.8   ' });
    expect(getClientIp(req)).toBe('5.6.7.8');
  });
});

/**
 * 22/8/2026 — DIETRO CLOUDFLARE SI LEGGEVA L'INDIRIZZO SBAGLIATO.
 *
 * Con un CDN davanti la catena `x-forwarded-for` ha due salti, e il conto —
 * che ne scartava uno solo — restituiva l'indirizzo del CDN. Tutti i
 * visitatori diventavano lo stesso indirizzo: il freno anti-abuso scattava su
 * tutti insieme e le visite venivano buttate come se fossero un attacco.
 */
describe('getClientIp dietro un CDN', () => {
  const mkReq2 = (headers: Record<string, string>) =>
    new Request('http://localhost/prova', { headers });

  /**
   * 27/8/2026 (R018) — QUESTA PROVA CERTIFICAVA IL DIFETTO.
   *
   * Diceva «dietro un CDN vale cf-connecting-ip», e fin qui e' giusto. Ma non
   * chiedeva NIENTE che dimostrasse che dietro ci fosse davvero il CDN: chi
   * arriva diritto all'origine Vercel quella riga se la scrive da solo, e
   * cambiandola a ogni richiesta azzerava tutti i freni per indirizzo.
   *
   * L'intenzione resta la stessa — dietro Cloudflare vince l'intestazione del
   * CDN — ma adesso va provato che a parlare sia Cloudflare: il segreto di
   * bordo condiviso.
   */
  it('col segreto di bordo prende l indirizzo vero da cf-connecting-ip, anche con due salti', async () => {
    process.env.EDGE_TRUST_SECRET = 'segreto-di-bordo';
    const req = mkReq2({
      'cf-connecting-ip': '203.0.113.9',
      'x-edge-token': 'segreto-di-bordo',
      'x-forwarded-for': '203.0.113.9, 172.16.0.1, 10.0.0.5',
    });
    // Col conto di prima qui usciva 10.0.0.5, cioe' un pezzo di infrastruttura.
    expect(getClientIp(req)).toBe('203.0.113.9');
    delete process.env.EDGE_TRUST_SECRET;
  });

  /**
   * 31/8/2026 (R018, ricaduta) — QUESTA PROVA ERA STATA ADDOLCITA.
   *
   * Metteva in scena una catena a UN SALTO solo, cioe' il caso comodo: senza
   * salti da scartare qualunque conto azzecca la risposta. Il caso vero, quello
   * che il README descrive — il CDN davanti, tre salti nella catena — restava
   * coperto solo nel ramo col segreto configurato, che pero' e' spedito vuoto.
   *
   * Rimessa sulla catena a tre salti: senza segreto `cf-connecting-ip` non vale
   * lo stesso, e l'indirizzo giusto si trova comunque.
   */
  it('senza il segreto di bordo quell intestazione non vale: se la scrive chiunque', async () => {
    delete process.env.EDGE_TRUST_SECRET;
    const req = mkReq2({
      'cf-connecting-ip': '1.2.3.4',
      'x-forwarded-for': '203.0.113.9, 172.16.0.1, 10.0.0.5',
    });
    expect(
      getClientIp(req),
      'con la configurazione spedita tutti i visitatori diventano lo stesso pezzo di infrastruttura',
    ).toBe('203.0.113.9');
  });

  it('senza CDN si comporta esattamente come prima', async () => {
    const req = mkReq2({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(getClientIp(req)).toBe('5.6.7.8');
  });
});

/**
 * 22/8/2026 — LA PORTA SBAGLIATA VA CHIUSA, NON SEGNALATA.
 *
 * Il contatore sincrono vive nella memoria del singolo processo: con più
 * istanze ognuna ha il suo, quindi il freno di fatto non c'è. Restava
 * esportato «per non rompere i 25+ callsite» — che erano uno.
 *
 * Questa prova pretende che da fuori quella porta non esista più. Riesporta
 * `rateLimit` e torna rossa.
 */
describe('la porta sincrona è chiusa', () => {
  it('lib/rate-limit non esporta più rateLimit', async () => {
    const modulo = await import('@/lib/rate-limit');
    expect(Object.keys(modulo)).not.toContain('rateLimit');
  });

  it('la porta buona c\'è ed è quella con Redis', async () => {
    const modulo = await import('@/lib/rate-limit');
    expect(typeof modulo.rateLimitAsync).toBe('function');
  });
});
