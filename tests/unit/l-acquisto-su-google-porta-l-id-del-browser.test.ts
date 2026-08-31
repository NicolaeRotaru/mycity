import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clientIdGaDalCookie, clientIdGaValido } from '@/lib/analytics/ga-client-id';

/**
 * 30/8/2026 (R166) — VERSO GOOGLE MANDAVAMO L'ID DELLA PERSONA AL POSTO DI
 * QUELLO DEL BROWSER.
 *
 * `contaAcquistoSuGoogle` spediva `client_id: a.buyerId`, cioe' l'UUID di
 * Supabase. Il Measurement Protocol di GA4 attacca l'evento alla sessione web
 * solo se `client_id` e' il valore del cookie `_ga` — due numeri col punto in
 * mezzo. Con un UUID, Google non riconosce nessuna sessione: nasce un utente
 * nuovo senza sorgente, e la vendita finisce sotto «(direct)/(none)». La
 * campagna che l'ha portata non se la vede attribuita, e su quel numero si
 * decide quanto spendere.
 *
 * Il difetto oggi e' DORMIENTE — la strada del server resta spenta finche'
 * `GA_API_SECRET` non c'e' — ma morde il giorno in cui si accende la chiave, ed
 * e' esattamente il giorno in cui si comincia a spendere in pubblicita'.
 *
 * Qui si accende la chiave per finta e si guarda cosa parte davvero.
 */

describe('il client id di Google letto dal cookie del browser', () => {
  it('prende le due parti che contano dal cookie _ga', () => {
    expect(clientIdGaDalCookie('_ga=GA1.1.1234567890.1699999999')).toBe('1234567890.1699999999');
  });

  it('lo trova anche in mezzo agli altri cookie', () => {
    expect(
      clientIdGaDalCookie('mc_vid=abc; _ga=GA1.2.55.66; _ga_ABC123=GS1.1.x'),
    ).toBe('55.66');
  });

  it('senza cookie dice «non ce l\'ho», invece di inventarne uno', () => {
    for (const niente of [null, undefined, '', 'mc_vid=abc', '_ga=', '_ga=GA1.1', '_ga=GA1.1.non.numeri']) {
      expect(clientIdGaDalCookie(niente), `«${String(niente)}» non e un client id`).toBeNull();
    }
  });

  it('un valore che arriva da fuori passa dallo stesso metro', () => {
    expect(clientIdGaValido('123.456')).toBe('123.456');
    expect(clientIdGaValido('550e8400-e29b-41d4-a716-446655440000')).toBeNull();
    expect(clientIdGaValido(undefined)).toBeNull();
  });
});

describe("l'acquisto che parte dal server verso Google", () => {
  const salvate = { misura: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID, segreto: process.env.GA_API_SECRET };
  const chiamate: Array<{ url: string; corpo: Record<string, unknown> }> = [];

  beforeEach(() => {
    vi.resetModules();
    chiamate.length = 0;
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST';
    process.env.GA_API_SECRET = 'segreto';
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      chiamate.push({ url: String(url), corpo: JSON.parse(init.body) });
      return { ok: true, status: 200 } as Response;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = salvate.misura;
    if (salvate.segreto === undefined) delete process.env.GA_API_SECRET;
    else process.env.GA_API_SECRET = salvate.segreto;
  });

  const acquisto = {
    orderId: 'ord-1',
    buyerId: '550e8400-e29b-41d4-a716-446655440000',
    totalCents: 2500,
    paymentMethod: 'card' as const,
    sellerId: 's1',
    consensoAnalytics: true,
    varianti: {},
  };

  it('manda il client id del browser, non l\'identificativo della persona', async () => {
    const { contaAcquisto } = await import('@/lib/analytics/server');
    await contaAcquisto({ ...acquisto, gaClientId: '1234567890.1699999999' });

    const google = chiamate.find((c) => c.url.includes('google-analytics.com'));
    expect(google, 'verso Google non e partito niente').toBeTruthy();
    expect(
      google!.corpo.client_id,
      "Con l'UUID della persona Google apre un utente nuovo a ogni acquisto e lo mette sotto «diretto»: la campagna che ha portato la vendita non se la vede attribuita",
    ).toBe('1234567890.1699999999');
    expect(google!.corpo.user_id, 'l\'identificativo della persona resta, ed e al suo posto').toBe(acquisto.buyerId);
  });

  it('senza il cookie del browser NON inventa un identificativo', async () => {
    const { contaAcquisto } = await import('@/lib/analytics/server');
    await contaAcquisto({ ...acquisto, gaClientId: null });

    const google = chiamate.find((c) => c.url.includes('google-analytics.com'));
    expect(
      google,
      'Senza il cookie non esiste nessun browser da nominare: mandarlo comunque crea un utente fantasma e un acquisto sotto «diretto», che e peggio di non contarlo',
    ).toBeUndefined();
  });

  it("l'evento porta il tempo di interazione, che GA4 pretende per contare la sessione", async () => {
    const { contaAcquisto } = await import('@/lib/analytics/server');
    await contaAcquisto({ ...acquisto, gaClientId: '1.2' });

    const google = chiamate.find((c) => c.url.includes('google-analytics.com'))!;
    const evento = (google.corpo.events as Array<{ params: Record<string, unknown> }>)[0];
    expect(evento.params.engagement_time_msec, 'senza questo GA4 non apre nessuna sessione').toBeTruthy();
    expect(evento.params.transaction_id).toBe('ord-1');
  });
});
