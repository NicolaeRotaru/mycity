import { describe, it, expect } from 'vitest';
import { prezziDelCarrello, type IngressiPrezzo } from '@/lib/ordini/prezzi';
import { riepilogoDaMostrare } from '@/lib/ordini/riepilogo-cassa';
import { computeOrderSplit } from '@/lib/stripe/client';
import { COMPENSO_RIDER_CENTS, PLATFORM_DELIVERY_FEE_CENTS } from '@/lib/constants';

/**
 * 27/10/2026 — IL CODICE «SPEDIZIONE GRATUITA» VENIVA PRESO, CONSUMATO, E NON TOGLIEVA NIENTE.
 *
 * Al lancio il cliente paga solo la consegna: 3 € per negozio. La spedizione a distanza, l'unica
 * voce che il codice azzerava, è diventata zero per tutti. Il codice però restava in vendita
 * (l'amministrazione lo crea come «Spedizione gratuita»), la cassa lo accettava e lo segnava come
 * usato, e il conto non cambiava di un centesimo.
 *
 * Il caso vero: 20 € dal fornaio, il cliente scrive il suo codice, legge «applicato», paga 23 €
 * come chi il codice non ce l'ha — e su un codice a uso unico non può più riprovare.
 *
 * Adesso il codice toglie la consegna, su ogni negozio del carrello. Il fattorino resta pagato,
 * e il regalo lo paga la piattaforma: il netto del negozio è lo stesso, con o senza codice.
 */

function ingressi(subtotali: number[], opts: Partial<IngressiPrezzo> = {}): IngressiPrezzo {
  return {
    gruppi: subtotali.map((s, i) => ({ sellerId: `negozio-${i}`, subtotalCents: s })),
    coordinateNegozio: () => ({ lat: 45.0526, lng: 9.693 }),
    consegnaLat: 45.06,
    consegnaLng: 9.7,
    pickupInStore: false,
    couponSpedizioneGratis: false,
    couponScontoCents: 0,
    ...opts,
  };
}

const consegnaPagata = (g: { shippingCents: number; deliveryFeeCents: number }) => g.shippingCents + g.deliveryFeeCents;

describe('il codice «Spedizione gratuita»', () => {
  it('toglie la consegna: 20 € di spesa, 20 € da pagare invece di 23', () => {
    const senza = prezziDelCarrello(ingressi([2000]));
    const con = prezziDelCarrello(ingressi([2000], { couponSpedizioneGratis: true }));

    expect(senza.grandTotalCents).toBe(2000 + PLATFORM_DELIVERY_FEE_CENTS);
    expect(con.grandTotalCents, 'il codice è stato accettato e consumato: deve togliere qualcosa').toBeLessThan(
      senza.grandTotalCents,
    );
    expect(consegnaPagata(con.gruppi[0])).toBe(0);
    expect(con.grandTotalCents).toBe(2000);
  });

  it('vale per ogni negozio del carrello, non solo per il primo', () => {
    const con = prezziDelCarrello(ingressi([800, 1800], { couponSpedizioneGratis: true }));
    expect(con.gruppi.map(consegnaPagata)).toEqual([0, 0]);
    expect(con.grandTotalCents).toBe(800 + 1800);
  });

  it('il fattorino resta pagato: il suo compenso non dipende dal codice del cliente', () => {
    const con = prezziDelCarrello(ingressi([2000, 1500], { couponSpedizioneGratis: true }));
    expect(con.gruppi.map((g) => g.riderFeeCents)).toEqual([COMPENSO_RIDER_CENTS, COMPENSO_RIDER_CENTS]);
  });

  it('il negozio incassa lo stesso netto: il regalo lo paga la piattaforma, non lui', () => {
    for (const cents of [500, 2000, 2999, 3000, 7500]) {
      const netto = (couponSpedizioneGratis: boolean) => {
        const g = prezziDelCarrello(ingressi([cents], { couponSpedizioneGratis })).gruppi[0];
        return computeOrderSplit({
          totalCents: g.totalCents,
          deliveryFeeCents: g.deliveryFeeCents,
          shippingCents: g.shippingCents,
        }).sellerPayoutCents;
      };
      expect(netto(true), `con ${cents / 100} € di spesa`).toBe(netto(false));
    }
  });

  it('col ritiro in negozio non cambia niente: non c era nessuna consegna da togliere', () => {
    const senza = prezziDelCarrello(ingressi([2000], { pickupInStore: true }));
    const con = prezziDelCarrello(ingressi([2000], { pickupInStore: true, couponSpedizioneGratis: true }));
    expect(con.grandTotalCents).toBe(senza.grandTotalCents);
    expect(con.gruppi[0].riderFeeCents).toBe(0);
  });

  it('la cassa mostra quello che addebita: consegna a zero e totale di 20 €', () => {
    const r = riepilogoDaMostrare({
      ...ingressi([2000], { couponSpedizioneGratis: true }),
      usaCredito: false,
      creditoDisponibileCents: 0,
    });
    expect(r.spedizione + r.feeConsegna).toBe(0);
    expect(r.totale).toBe(20);
  });
});
