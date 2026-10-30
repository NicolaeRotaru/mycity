import { describe, it, expect } from 'vitest';
import { prezziDelCarrello, type IngressiPrezzo, type PrezzoDiGruppo } from '@/lib/ordini/prezzi';
import { computeOrderSplit } from '@/lib/stripe/client';
import { compensoTrattenutoCents } from '@/lib/shipping';

/**
 * Con la carta il netto del negozio e il compenso del fattorino escono dalla STESSA charge
 * (`source_transaction`, lib/stripe/payout.ts): Stripe non versa più di quanto ha incassato.
 * Il collaudo dell'ondata 14 trovava 3 negozi da 10 € con addebito 35,00 € e bonifici 36,00 €:
 * il fattorino prendeva 3 € per OGNI ordine. La regola (logistica.compenso-fattorino, 29/10 23:04):
 * 3 € per il giro e 1 € per ogni negozio in più. La prova era stata ristretta a un negozio: qui
 * torna larga — ogni importo da 0,01 a 60 € per negozio, con uno, due e tre negozi, con la fascia
 * o la veloce, con o senza il codice «Spedizione gratuita».
 */
const ingressi = (merci: number[], o: Partial<IngressiPrezzo>): IngressiPrezzo => ({
  gruppi: merci.map((s, i) => ({ sellerId: `n${i}`, subtotalCents: s })),
  coordinateNegozio: () => ({ lat: 45.0526, lng: 9.693 }),
  consegnaLat: 45.06,
  consegnaLng: 9.7,
  pickupInStore: false,
  couponSpedizioneGratis: false,
  couponScontoCents: 0,
  consegnaVeloce: false,
  ...o,
});
const bonifici = (g: PrezzoDiGruppo) =>
  computeOrderSplit({ totalCents: g.totalCents, deliveryFeeCents: g.deliveryFeeCents, shippingCents: g.shippingCents })
    .sellerPayoutCents + g.riderFeeCents;

const VARIANTI = [false, true].flatMap((couponSpedizioneGratis) =>
  [false, true].map((consegnaVeloce) => ({ couponSpedizioneGratis, consegnaVeloce })));
const ALTRI = [1, 999, 1000, 1500, 3000, 6000];

function sforati(merci: number[], v: Partial<IngressiPrezzo>, out: string[]) {
  const e = prezziDelCarrello(ingressi(merci, v));
  const versati = e.gruppi.reduce((s, g) => s + bonifici(g), 0);
  if (versati > e.grandTotalCents) out.push(`${merci.join('+')} ${JSON.stringify(v)}: ${versati} > ${e.grandTotalCents}`);
  // Il fattorino del giro: 3 € sul primo negozio, 1 € su ogni altro, mai di più.
  const rider = e.gruppi.reduce((s, g) => s + g.riderFeeCents, 0);
  if (rider !== 300 + 100 * (merci.length - 1)) out.push(`${merci.join('+')}: fattorino ${rider}`);
}

describe('con la carta e più negozi i bonifici non superano mai l addebito', () => {
  it('il caso del collaudo: tre negozi da 10 € → bonifici dentro i 35 € e fattorino a 5 €', () => {
    const e = prezziDelCarrello(ingressi([1000, 1000, 1000], {}));
    expect(e.grandTotalCents).toBe(3500);
    expect(e.gruppi.map((g) => g.riderFeeCents)).toEqual([300, 100, 100]);
    expect(e.gruppi.reduce((s, g) => s + bonifici(g), 0)).toBeLessThanOrEqual(3500);
  });

  it('ogni importo da 0,01 a 60 € per negozio, con uno, due e tre negozi, fascia o veloce, codice o no', () => {
    const out: string[] = [];
    for (const v of VARIANTI) {
      for (let c = 1; c <= 6000; c++) {
        sforati([c], v, out);
        for (const a of ALTRI) {
          sforati([c, a], v, out);
          sforati([a, c], v, out);
          for (const b of [1, 1000, 6000]) sforati([c, a, b], v, out);
        }
      }
    }
    expect(out.slice(0, 5)).toEqual([]);
  }, 120_000);

  it('in contanti il fattorino si tiene il compenso di quell ordine: la somma del giro è 3 € + 1 € a negozio in più', () => {
    const e = prezziDelCarrello(ingressi([1500, 1200, 2000], {}));
    const tenuti = e.gruppi.map((g) => compensoTrattenutoCents({ rider_fee_cents: g.riderFeeCents, pickup_in_store: false }));
    expect(tenuti.reduce((s, x) => s + x, 0)).toBe(500);
    e.gruppi.forEach((g, i) => expect(tenuti[i]).toBeLessThanOrEqual(g.deliveryFeeCents + g.shippingCents));
  });
});
