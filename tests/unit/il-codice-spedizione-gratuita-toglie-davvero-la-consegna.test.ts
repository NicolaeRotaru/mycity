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
 *
 * Secondo giro, stesso giorno: la consegna si toglie TUTTA da 30 € di spesa per negozio, sotto ne
 * resta da pagare la parte che la commissione non copre. Tutta anche a 20 € voleva dire 21 € di
 * bonifici su 20 € incassati con la carta: la prova è
 * tests/unit/col-codice-spedizione-gratuita-i-bonifici-stanno-nell-addebito.test.ts.
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
    consegnaVeloce: false,
    ...opts,
  };
}

const consegnaPagata = (g: { shippingCents: number; deliveryFeeCents: number }) => g.shippingCents + g.deliveryFeeCents;

describe('il codice «Spedizione gratuita»', () => {
  it('toglie la consegna: 30 € di spesa, 30 € da pagare invece di 33', () => {
    const senza = prezziDelCarrello(ingressi([3000]));
    const con = prezziDelCarrello(ingressi([3000], { couponSpedizioneGratis: true }));

    expect(senza.grandTotalCents).toBe(3000 + PLATFORM_DELIVERY_FEE_CENTS);
    expect(con.grandTotalCents, 'il codice è stato accettato e consumato: deve togliere qualcosa').toBeLessThan(
      senza.grandTotalCents,
    );
    expect(consegnaPagata(con.gruppi[0])).toBe(0);
    expect(con.grandTotalCents).toBe(3000);
  });

  it('toglie la base una volta sola: l’euro del negozio in più resta da pagare', () => {
    const con = prezziDelCarrello(ingressi([3000, 4500], { couponSpedizioneGratis: true }));
    // 29/10/2026 22:21 — Una consegna sola: il negozio da 45 € porta la base, che il codice toglie;
    // quello da 30 € porta l'euro del negozio in più, che il codice non toglie mai.
    expect(con.gruppi.map(consegnaPagata)).toEqual([100, 0]);
    expect(con.grandTotalCents).toBe(3000 + 4500 + 100);
  });

  it('il fattorino resta pagato: il suo compenso non dipende dal codice del cliente', () => {
    const con = prezziDelCarrello(ingressi([2000, 1500], { couponSpedizioneGratis: true }));
    const senza = prezziDelCarrello(ingressi([2000, 1500], { couponSpedizioneGratis: false }));
    expect(con.gruppi.map((g) => g.riderFeeCents)).toEqual(senza.gruppi.map((g) => g.riderFeeCents));
    // 29/10/2026 23:04 — 3 € per il giro sul negozio che porta la base, 1 € sul negozio in più.
    expect(con.gruppi.map((g) => g.riderFeeCents)).toEqual([COMPENSO_RIDER_CENTS, 100]);
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

  it('la cassa mostra quello che addebita: consegna a zero e totale di 30 €', () => {
    const r = riepilogoDaMostrare({
      ...ingressi([3000], { couponSpedizioneGratis: true }),
      usaCredito: false,
      creditoDisponibileCents: 0,
    });
    expect(r.spedizione + r.feeConsegna).toBe(0);
    expect(r.totale).toBe(30);
  });
});
