import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 6/9/2026 — LA VETRINA COMPRATA DOPO MEZZANOTTE PARTIVA DAL GIORNO PRIMA.
 *
 * Un negozio compra sette giorni di «In primo piano». Le date di inizio e fine
 * si scrivevano con `toISOString()`, che è l'ora di Greenwich. In Italia siamo
 * avanti di due ore d'estate: chi compra alle 00:30 del 4 settembre, per
 * Greenwich sta ancora comprando il 3. La vetrina risultava iniziata il giorno
 * prima e finita un giorno prima del dovuto: sette giorni pagati, sei e mezzo
 * visti.
 *
 * NOTA SULL'ORA. La scheda parlava delle 23:30: a quell'ora il giorno di
 * Greenwich è ancora lo stesso e lo scarto non si vede. La finestra vera è
 * fra mezzanotte e le due di notte (l'una d'inverno). Il difetto è quello,
 * l'esempio era sbagliato.
 *
 * La seconda cosa che si prova qui: la spesa registrata è quella davvero
 * incassata da Stripe (`amount_total`), non quella scritta nei metadati della
 * sessione, che chiunque apra la cassa può far divergere.
 */

const scritte: Array<Record<string, unknown>> = [];

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => ({
      insert: async (riga: Record<string, unknown>) => {
        scritte.push({ tabella, ...riga });
        return { error: null };
      },
    }),
  }),
}));

import { handleSponsoredPurchase } from '@/lib/stripe/webhook/sponsorizzati';

function cassaChiusa(metadati: Record<string, string>, amountTotal: number | null) {
  return {
    id: 'cs_notturna',
    amount_total: amountTotal,
    metadata: { kind: 'sponsored', ...metadati },
  } as unknown as Parameters<typeof handleSponsoredPurchase>[0];
}

const RIGA = () => scritte.find((s) => s.tabella === 'sponsored_listings');

beforeEach(() => {
  scritte.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('una vetrina in primo piano comprata a notte fonda', () => {
  it('parte dal giorno che il negoziante legge sul telefono, non da quello di Greenwich', async () => {
    // 4 settembre, 00:30 a Piacenza. A Greenwich sono ancora le 22:30 del 3.
    vi.setSystemTime(new Date('2026-09-03T22:30:00.000Z'));

    await handleSponsoredPurchase(
      cassaChiusa({ seller_id: 'negozio-1', product_id: 'prod-1', days: '7', amount_cents: '700' }, 700),
    );

    expect(
      RIGA()?.start_date,
      'la vetrina risulta iniziata il giorno prima di quando è stata comprata',
    ).toBe('2026-09-04');
    expect(RIGA()?.end_date, 'la vetrina finisce un giorno prima del dovuto').toBe('2026-09-11');
  });

  it('registra la spesa che Stripe ha davvero incassato, non quella dei metadati', async () => {
    vi.setSystemTime(new Date('2026-09-03T22:30:00.000Z'));

    // I metadati dicono 7,00 €; alla cassa ne sono entrati 14,00.
    await handleSponsoredPurchase(
      cassaChiusa({ seller_id: 'negozio-1', product_id: 'prod-1', days: '7', amount_cents: '700' }, 1400),
    );

    expect(RIGA()?.spent_cents, 'il rendiconto racconta una cifra diversa da quella addebitata').toBe(1400);
    expect(RIGA()?.daily_budget_cents).toBe(200);
  });

  it('senza importo dalla cassa resta il valore dei metadati: meglio quello che niente', async () => {
    vi.setSystemTime(new Date('2026-09-03T22:30:00.000Z'));

    await handleSponsoredPurchase(
      cassaChiusa({ seller_id: 'negozio-1', product_id: 'prod-1', days: '7', amount_cents: '700' }, null),
    );

    expect(RIGA()?.spent_cents).toBe(700);
  });
});
