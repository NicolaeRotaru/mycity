import { describe, it, expect } from 'vitest';
import { pianoDelRimborsoRespinto, type OrdineDelRimborsoRespinto } from '@/lib/stripe/rimborso-respinto';

/**
 * R31-014 — Se la banca respinge un rimborso parziale su un ordine col bonifico già partito, al negozio
 * resta tolta la sua quota.
 *
 * Il rimborso parziale, col bonifico già uscito ('TRANSFERRED'), aveva ripreso al negozio la sua quota
 * con uno storno. La banca lo respinge: il cliente non ha avuto niente, il negozio resta stornato. Il
 * riaccredito automatico non regge (carrello di più negozi), quindi il piano dice agli amministratori la
 * cifra esatta da ridare a mano a ciascun negozio, in euro, con l'ordine. Lo storno sull'ordine non si tocca.
 *
 * Solo il conto, senza database né Stripe.
 */

function ordine(extra: Partial<OrdineDelRimborsoRespinto> & { id: string }): OrdineDelRimborsoRespinto {
  return {
    payment_status: 'PARTIALLY_REFUNDED',
    payout_status: 'TRANSFERRED',
    gross_total_cents: 2000,
    seller_payout_cents: 1620,
    refunded_amount_cents: 500,
    seller_payout_reversed_cents: 405,
    payout_tentativo: 0,
    stripe_refund_id: 're_1',
    internal_dispute_status: null,
    ...extra,
  };
}

const euro = (s: string) => s.replace(/ /g, ' ');

describe('R31-014 — il rimborso parziale respinto col bonifico già partito', () => {
  it('IL CASO DELLA VOCE — 5 € respinti su 20 €, netto del negozio 16,20 €: vanno ridati a mano 4,05 € al negozio dell’ordine', () => {
    const piano = pianoDelRimborsoRespinto([ordine({ id: 'o1' })], 're_1', 500);
    expect(piano.scritture).toHaveLength(1);
    expect(piano.scritture[0].daRidareAlNegozioCents).toBe(405);
    const frase = euro(piano.fraseDaRidareAMano ?? '');
    expect(frase).toContain('ordine o1: 4,05 €');
    expect(frase).toMatch(/a mano/);
    // Il riaccredito non è automatico: lo storno registrato resta com'è, e il bonifico non si rifà.
    expect(piano.scritture[0].valori).not.toHaveProperty('seller_payout_reversed_cents');
    expect(piano.scritture[0].valori).not.toHaveProperty('payout_status');
    expect(piano.scritture[0].valori).toMatchObject({ refunded_amount_cents: 0, payment_status: 'PAID' });
  });

  it('carrello di due negozi sullo stesso pagamento: a ciascuno la sua cifra, con il suo ordine', () => {
    const piano = pianoDelRimborsoRespinto(
      [
        ordine({ id: 'pane', gross_total_cents: 2000, seller_payout_cents: 1600, refunded_amount_cents: 400, seller_payout_reversed_cents: 320, stripe_refund_id: null }),
        ordine({ id: 'fiori', gross_total_cents: 3000, seller_payout_cents: 2400, refunded_amount_cents: 600, seller_payout_reversed_cents: 480, stripe_refund_id: null }),
      ],
      're_cruscotto',
      1000,
    );
    expect(piano.scritture.map((s) => [s.ordineId, s.daRidareAlNegozioCents])).toEqual([
      ['pane', 320],
      ['fiori', 480],
    ]);
    const frase = euro(piano.fraseDaRidareAMano ?? '');
    expect(frase).toContain('ordine pane: 3,20 €');
    expect(frase).toContain('ordine fiori: 4,80 €');
  });

  it('mai più di quanto risulta stornato al negozio', () => {
    const piano = pianoDelRimborsoRespinto([ordine({ id: 'o1', seller_payout_reversed_cents: 100 })], 're_1', 500);
    expect(piano.scritture[0].daRidareAlNegozioCents).toBe(100);
    expect(euro(piano.fraseDaRidareAMano ?? '')).toContain('ordine o1: 1,00 €');
  });

  it('bonifico già partito ma niente stornato (per esempio l’euro della veloce): niente da ridare, nessuna frase', () => {
    const piano = pianoDelRimborsoRespinto([ordine({ id: 'o1', seller_payout_reversed_cents: 0 })], 're_1', 500);
    expect(piano.scritture[0].daRidareAlNegozioCents).toBe(0);
    expect(piano.fraseDaRidareAMano).toBeUndefined();
  });

  it('bonifico ancora da fare: la quota torna nel bonifico come prima, niente da ridare a mano', () => {
    const piano = pianoDelRimborsoRespinto([ordine({ id: 'o1', payout_status: 'HELD' })], 're_1', 500);
    expect(piano.scritture[0].daRidareAlNegozioCents).toBe(0);
    expect(piano.scritture[0].valori).toMatchObject({ seller_payout_reversed_cents: 0 });
    expect(piano.fraseDaRidareAMano).toBeUndefined();
  });
});
