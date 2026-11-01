// 1/11/2026 — Col codice «Spedizione gratuita», al secondo rifiuto la consegna si ricalcola CON il
// codice. Dopo il primo rifiuto la consegna scritta può stare sotto la regola (il tetto): così lo
// stesso conto scritto sta sotto sia la regola col codice sia quella senza, e il giro sceglieva
// «senza codice» (la prima provata). Latteria 9,99 €, frutta 12 €, forno 10 € col codice: rifiutano
// il forno poi la frutta, la latteria saliva a 3,80 € invece di 3 € e al cliente tornavano 80
// centesimi in meno. Prima si cerca il conto esatto; solo se manca, quello col codice.

import { describe, it, expect } from 'vitest';
import { prezziDelCarrello, consegnaDopoLAnnullo, type IngressiPrezzo, type OrdineDelGiro } from '@/lib/ordini/prezzi';

const ing = (merci: number[], codice: boolean): IngressiPrezzo =>
  ({
    gruppi: merci.map((s, i) => ({ sellerId: `s${i}`, subtotalCents: s })),
    coordinateNegozio: () => ({ lat: null, lng: null }),
    consegnaLat: null,
    consegnaLng: null,
    pickupInStore: false,
    couponSpedizioneGratis: codice,
    couponScontoCents: 0,
    consegnaVeloce: false,
  }) as unknown as IngressiPrezzo;

function giro(merci: number[], codice: boolean, rifiuti: number[]) {
  const e = prezziDelCarrello(ing(merci, codice));
  let o: OrdineDelGiro[] = e.gruppi.map((g, i) => ({
    id: `o${i}`,
    spesaCents: g.subtotalCents,
    merceCents: g.subtotalCents - g.couponPortionCents - g.pickupPortionCents,
    shippingCents: g.shippingCents,
    deliveryFeeCents: g.deliveryFeeCents,
    riderFeeCents: g.riderFeeCents,
    giaAnnullato: false,
  }));
  const differenze: number[] = [];
  for (const k of rifiuti) {
    const r = consegnaDopoLAnnullo({ ordini: o, annullaId: `o${k}`, consegnaVeloce: false, pickupInStore: false });
    expect(r).not.toBeNull();
    differenze.push(r!.differenzaCents);
    o = o.map((x) => {
      const y = r!.rimasti.find((z) => z.id === x.id);
      if (y) return { ...x, deliveryFeeCents: y.deliveryFeeCents, riderFeeCents: y.riderFeeCents };
      if (x.id === `o${k}`) return { ...x, giaAnnullato: true, deliveryFeeCents: r!.annullato.deliveryFeeCents };
      return x;
    });
  }
  return { vivi: o.filter((x) => !x.giaAnnullato), differenze };
}

describe('col codice, il secondo rifiuto rifà il conto col codice', () => {
  it('latteria 9,99 / frutta 12 / forno 10: rifiutano forno poi frutta, la latteria paga 3 € e non 3,80', () => {
    const { vivi } = giro([999, 1200, 1000], true, [2, 1]);
    expect(vivi.map((x) => ({ consegna: x.deliveryFeeCents, rider: x.riderFeeCents }))).toEqual([
      { consegna: 300, rider: 300 },
    ]);
  });

  it('15 / 20 / 40 €: rifiutano il 40 poi il 20, la latteria paga 1,50 e al cliente tornano 50 cent in meno, non 100', () => {
    const { vivi, differenze } = giro([1500, 2000, 4000], true, [2, 1]);
    expect(vivi[0].deliveryFeeCents).toBe(150);
    expect(differenze[1]).toBe(50);
  });

  it('senza codice il conto resta quello senza codice (stesso carrello)', () => {
    const { vivi } = giro([999, 1200, 1000], false, [2, 1]);
    const solo = prezziDelCarrello(ing([999], false)).gruppi[0];
    expect(vivi[0].riderFeeCents).toBe(solo.riderFeeCents);
  });
});
