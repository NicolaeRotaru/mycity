import { describe, it, expect } from 'vitest';
import {
  prezziDelCarrello,
  spesaPerConsegnaGratisColCodiceCents,
  type IngressiPrezzo,
  type PrezzoDiGruppo,
} from '@/lib/ordini/prezzi';
import { computeOrderSplit } from '@/lib/stripe/client';
import { rigaDelCodiceSpedizione } from '@/lib/promesse-pubbliche';
import { formatPrice } from '@/lib/format';

/**
 * 27/10/2026 — COL CODICE «SPEDIZIONE GRATUITA» I BONIFICI SUPERAVANO L'ADDEBITO DELLA CARTA.
 *
 * Con la carta, il netto del negozio e il compenso del fattorino escono dallo STESSO addebito del
 * cliente (`source_transaction` in lib/stripe/payout.ts), e da un addebito Stripe non versa più di
 * quanto ha incassato. Senza codice il conto torna sempre: la consegna (3 €) paga il fattorino
 * (3 €). Il codice toglieva tutta la consegna, e sotto i 30 € di spesa per negozio la commissione
 * (10%) non basta a pagare il fattorino da sola.
 *
 * Il caso vero: 20 € dal fornaio col codice. La carta incassa 20 €, al negozio vanno 18 €, al
 * fattorino 3 €: 21 € di bonifici su 20 € incassati. Il secondo bonifico fallisce e il giro lo
 * ritenta all'infinito: resta senza soldi il fattorino, o il negozio, a seconda di chi parte prima.
 *
 * Adesso il codice regala la consegna fin dove la paga quello che di quell'ordine resta alla
 * piattaforma: da 30 € di spesa per negozio tutta, sotto una parte. E la cassa lo dice.
 */

function ingressi(subtotali: number[], opts: Partial<IngressiPrezzo> = {}): IngressiPrezzo {
  return {
    gruppi: subtotali.map((s, i) => ({ sellerId: `negozio-${i}`, subtotalCents: s })),
    coordinateNegozio: () => ({ lat: 45.0526, lng: 9.693 }),
    consegnaLat: 45.06,
    consegnaLng: 9.7,
    pickupInStore: false,
    couponSpedizioneGratis: true,
    couponScontoCents: 0,
    consegnaVeloce: false,
    ...opts,
  };
}

/** Quanto esce in bonifici da un ordine pagato con la carta: il netto del negozio più il fattorino. */
function bonifici(g: PrezzoDiGruppo): number {
  const { sellerPayoutCents } = computeOrderSplit({
    totalCents: g.totalCents,
    deliveryFeeCents: g.deliveryFeeCents,
    shippingCents: g.shippingCents,
  });
  return sellerPayoutCents + g.riderFeeCents;
}

const consegna = (cents: number, codice: boolean) => {
  const [g] = prezziDelCarrello(ingressi([cents], { couponSpedizioneGratis: codice })).gruppi;
  return g.deliveryFeeCents + g.shippingCents;
};

describe('col codice «Spedizione gratuita» i bonifici stanno dentro l addebito della carta', () => {
  it('IL CASO: 20 € dal fornaio, negozio più fattorino non superano i soldi incassati', () => {
    const [g] = prezziDelCarrello(ingressi([2000])).gruppi;
    expect(bonifici(g), `bonifici ${bonifici(g)} su un addebito di ${g.totalCents}`).toBeLessThanOrEqual(
      g.totalCents,
    );
  });

  it('vale per ogni spesa, centesimo per centesimo, con un negozio solo (il compenso con più negozi lo decide Nicola)', () => {
    const sforati: string[] = [];
    for (let cents = 1; cents <= 6000; cents++) {
      for (const g of prezziDelCarrello(ingressi([cents])).gruppi) {
        if (bonifici(g) > g.totalCents) sforati.push(`${g.subtotalCents}: ${bonifici(g)} > ${g.totalCents}`);
      }
    }
    expect(sforati.slice(0, 5)).toEqual([]);
  });

  it('il codice toglie sempre qualcosa: tutta la consegna da 30 € per negozio, una parte sotto', () => {
    expect(consegna(3000, true)).toBe(0);
    expect(consegna(4500, true)).toBe(0);
    expect(consegna(spesaPerConsegnaGratisColCodiceCents(), true)).toBe(0);
    // 20 €: la commissione (2 €) copre due dei tre euro, il cliente ne paga uno.
    expect(consegna(2000, true)).toBe(100);
    for (const cents of [500, 1000, 2000, 2990]) {
      expect(consegna(cents, true), `con ${cents / 100} € di spesa`).toBeLessThan(consegna(cents, false));
    }
  });

  it('la cassa lo dice: quanto copre il codice e da quale spesa la copre tutta', () => {
    const riga = rigaDelCodiceSpedizione(consegna(2000, true), 1);
    expect(riga).toContain(formatPrice(2));
    expect(riga).toContain(formatPrice(spesaPerConsegnaGratisColCodiceCents() / 100));
    expect(rigaDelCodiceSpedizione(0, 1), 'consegna già gratis: niente da spiegare').toBeNull();
  });
});
