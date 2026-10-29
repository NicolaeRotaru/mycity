import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { prezziDelCarrello, type IngressiPrezzo } from '@/lib/ordini/prezzi';
import { calcolaTotali } from '@/components/checkout/useTotaliCarrello';
import { riepilogoDaMostrare } from '@/lib/ordini/riepilogo-cassa';
import { computeOrderSplit } from '@/lib/stripe/client';
import { COMPENSO_RIDER_CENTS } from '@/lib/constants';
import { eConsegnaVeloce, prezzoDellaVeloce } from '@/lib/ordini/consegna-veloce';
import { ETICHETTA_ADESSO, FASCE_AMMESSE } from '@/lib/quando-arriva';

/**
 * 29/10/2026 16:13 — LA REGOLA FIRMATA DA NICOLA (registro dei fatti, consegna.promessa).
 *
 * 3 € per negozio con la fascia; 4 € sotto i 10 € di merce di quel negozio (dopo gli sconti) o con
 * la consegna veloce («Adesso»); mai più di 4 €. Il fattorino resta a 3 €, l'euro in più resta a
 * MyCity dentro delivery_fee_cents. Il codice «Spedizione gratuita» toglie solo la parte dei 3 €.
 * Prima la consegna era 3 € fissi: 8 € di pane uscivano a 300 centesimi di consegna, non 400.
 */

function ing(merci: number[], o: Partial<IngressiPrezzo> = {}): IngressiPrezzo {
  return {
    gruppi: merci.map((c, i) => ({ sellerId: `negozio-${i}`, subtotalCents: c })),
    coordinateNegozio: () => ({ lat: null, lng: null }),
    consegnaLat: null,
    consegnaLng: null,
    pickupInStore: false,
    couponSpedizioneGratis: false,
    couponScontoCents: 0,
    consegnaVeloce: false,
    ...o,
  };
}
const consegne = (i: IngressiPrezzo) => prezziDelCarrello(i).gruppi.map((g) => g.deliveryFeeCents);

describe('la consegna costa 3 € con la fascia, 4 € sotto i 10 € o con la veloce', () => {
  it('gli esempi firmati: 8 € fascia → 4, 8 € veloce → 4, 15 € fascia → 3, 15 € veloce → 4', () => {
    expect(consegne(ing([800]))).toEqual([400]);
    expect(consegne(ing([800], { consegnaVeloce: true }))).toEqual([400]);
    expect(consegne(ing([1500]))).toEqual([300]);
    expect(consegne(ing([1500], { consegnaVeloce: true }))).toEqual([400]);
  });

  it('la soglia è per negozio, sulla merce dopo gli sconti', () => {
    expect(consegne(ing([999]))).toEqual([400]);
    expect(consegne(ing([1000]))).toEqual([300]);
    expect(consegne(ing([800, 1500]))).toEqual([400, 300]);
    // 12 € con 3 € di sconto: 9 € di merce, sotto la soglia.
    expect(consegne(ing([1200], { couponScontoCents: 300 }))).toEqual([400]);
  });

  it('il ritiro in negozio resta a zero', () => {
    expect(consegne(ing([800], { pickupInStore: true, consegnaVeloce: true }))).toEqual([0]);
  });

  it('il codice «Spedizione gratuita» toglie solo la parte dei 3 €: l’euro in più resta da pagare', () => {
    expect(consegne(ing([5000], { couponSpedizioneGratis: true }))).toEqual([0]);
    expect(consegne(ing([5000], { couponSpedizioneGratis: true, consegnaVeloce: true }))).toEqual([100]);
    const piccolo = consegne(ing([800], { couponSpedizioneGratis: true }))[0];
    expect(piccolo).toBeGreaterThanOrEqual(100);
  });

  it('PROVA UNICA: da 0,01 a 60 € per negozio, fascia o veloce, con o senza codice, uno o due negozi', () => {
    const errori: string[] = [];
    const secondoNegozio = [null, 1, 999, 1000, 2999, 6000];
    let casi = 0;
    for (let c = 1; c <= 6000; c++) {
      for (const veloce of [false, true]) {
        for (const codice of [false, true]) {
          for (const b of secondoNegozio) {
            const merci = b === null ? [c] : [c, b];
            const i = ing(merci, { consegnaVeloce: veloce, couponSpedizioneGratis: codice });
            const server = prezziDelCarrello(i);
            const schermo = calcolaTotali({
              gruppi: merci.map((m, k) => ({ sellerId: `negozio-${k}`, subtotalEuro: m / 100, storeLat: null, storeLng: null })),
              consegnaLat: null,
              consegnaLng: null,
              pickupInStore: false,
              couponSpedizioneGratis: codice,
              couponScontoEuro: 0,
              consegnaVeloce: veloce,
              creditoDisponibileEuro: 0,
            }).centesimi;
            const cassa = riepilogoDaMostrare({ ...i, usaCredito: false, creditoDisponibileCents: 0 });
            casi++;
            server.gruppi.forEach((g, k) => {
              const split = computeOrderSplit({
                totalCents: g.totalCents,
                deliveryFeeCents: g.deliveryFeeCents,
                shippingCents: g.shippingCents,
              });
              const caso = `${merci.join('+')}c veloce=${veloce} codice=${codice} negozio ${k}`;
              if (g.deliveryFeeCents + split.applicationFeeCents < COMPENSO_RIDER_CENTS) errori.push(`fattorino scoperto: ${caso}`);
              if (split.sellerPayoutCents + g.riderFeeCents > g.totalCents) errori.push(`bonifici oltre l'incasso: ${caso}`);
              if (g.deliveryFeeCents > 400) errori.push(`consegna oltre 4 €: ${caso}`);
              const attesa = veloce || merci[k] < 1000 ? 400 : 300;
              if (!codice && g.deliveryFeeCents !== attesa) errori.push(`consegna ${g.deliveryFeeCents} invece di ${attesa}: ${caso}`);
              const s = schermo.gruppi[k];
              if (s.deliveryFeeCents !== g.deliveryFeeCents || s.totalCents !== g.totalCents) errori.push(`schermo diverso: ${caso}`);
            });
            if (Math.round(cassa.totale * 100) !== server.grandTotalCents) errori.push(`riepilogo diverso: ${merci.join('+')}`);
          }
        }
      }
    }
    expect(casi).toBe(6000 * 2 * 2 * secondoNegozio.length);
    expect(errori.slice(0, 5), `${errori.length} casi sbagliati`).toEqual([]);
  });

  it('le due rotte ricavano la veloce dalla fascia salvata, e la passano al conto', () => {
    expect(eConsegnaVeloce({ fascia: ETICHETTA_ADESSO, ritiroInNegozio: false })).toBe(true);
    expect(eConsegnaVeloce({ fascia: ETICHETTA_ADESSO, ritiroInNegozio: true })).toBe(false);
    for (const f of FASCE_AMMESSE.filter((x) => x !== ETICHETTA_ADESSO)) {
      expect(eConsegnaVeloce({ fascia: f, ritiroInNegozio: false }), f).toBe(false);
    }
    for (const rotta of ['app/api/orders/cod/route.ts', 'app/api/stripe/checkout/route.ts']) {
      const src = readFileSync(rotta, 'utf8');
      expect(src, rotta).toContain('eConsegnaVeloce({ fascia: body.deliverySlot, ritiroInNegozio: body.pickupInStore })');
      expect(src.match(/prezziDelCarrello\(\{[\s\S]*?\}\);/)?.[0], rotta).toContain('consegnaVeloce');
    }
  });

  it('la cassa e il carrello passano dal conto vero, non da «negozi × 300»', () => {
    const cassa = readFileSync('app/checkout/page.tsx', 'utf8');
    expect(cassa).toContain('consegnaVeloce: eConsegnaVeloce({ fascia: deliverySlot, ritiroInNegozio: pickupInStore })');
    const carrello = readFileSync('app/cart/page.tsx', 'utf8');
    expect(carrello).not.toMatch(/groups\.length \* \(PLATFORM_DELIVERY_FEE_CENTS/);
    expect(carrello).toContain('prezziDelCarrello(');
  });

  it('la mattonella «Adesso» dice «+1 €» da 10 € in su e «compresa» sotto i 10 €', () => {
    const r = (m: number) =>
      riepilogoDaMostrare({ ...ing([m]), usaCredito: false, creditoDisponibileCents: 0 }).supplementoVeloce;
    expect(prezzoDellaVeloce(Math.round(r(1500) * 100))).toBe('+1 €');
    expect(prezzoDellaVeloce(Math.round(r(800) * 100))).toBe('compresa');
  });
});
