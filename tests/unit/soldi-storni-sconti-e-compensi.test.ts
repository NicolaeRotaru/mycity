import { describe, it, expect } from 'vitest';
import { ripartisciCentesimi, riduciAlTetto } from '@/lib/stripe/ripartizione';
import { residuoRecuperabile } from '@/lib/stripe/payout';
import { compensoRiderCents } from '@/lib/shipping';
import { FREE_SHIPPING_THRESHOLD } from '@/lib/constants';

/**
 * Quattro punti in cui i conti non tornavano.
 */

describe('quanto si puo ancora recuperare dal venditore', () => {
  // Prima il residuo si teneva DENTRO seller_payout_cents, decrementandolo a
  // ogni storno. Ma quel campo e' il netto dell'ordine e lo leggono i guadagni
  // del negoziante, i rendiconti e — peggio — il calcolo della quota da
  // recuperare al rimborso successivo.
  it('il netto resta fermo e lo stornato si accumula', () => {
    const ordine = {
      id: 'o1', payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_1',
      seller_payout_cents: 9000, seller_payout_reversed_cents: 0,
    };
    expect(residuoRecuperabile(ordine)).toBe(9000);

    const dopoUnParziale = { ...ordine, seller_payout_reversed_cents: 3000 };
    expect(residuoRecuperabile(dopoUnParziale)).toBe(6000);
    // Il netto non e' cambiato: i guadagni mostrati al negoziante restano veri.
    expect(dopoUnParziale.seller_payout_cents).toBe(9000);
  });

  it('non va sotto zero se lo stornato supera il netto', () => {
    expect(residuoRecuperabile({
      id: 'o1', payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_1',
      seller_payout_cents: 1000, seller_payout_reversed_cents: 1500,
    })).toBe(0);
  });

  it('tratta i campi assenti come zero', () => {
    expect(residuoRecuperabile({
      id: 'o1', payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_1',
      seller_payout_cents: null,
    })).toBe(0);
  });
});

describe('lo sconto diviso fra i negozi', () => {
  // Le quote per negozio si calcolavano sui valori NON limitati e arrotondate
  // una per una: la loro somma non tornava con l'importo addebitato al cliente.
  it('la somma delle quote e esattamente lo sconto da dividere', () => {
    const quote = ripartisciCentesimi(1000, [3333, 3333, 3334]);
    expect(quote.reduce((s, q) => s + q, 0)).toBe(1000);
  });

  it('divide in proporzione ai subtotali', () => {
    const quote = ripartisciCentesimi(300, [1000, 2000]);
    expect(quote).toEqual([100, 200]);
  });

  it('i centesimi che restano vanno a chi ha il resto piu grande', () => {
    // 100 diviso fra tre pesi uguali: 33,33 a testa. Uno prende 34.
    const quote = ripartisciCentesimi(100, [1, 1, 1]);
    expect(quote.reduce((s, q) => s + q, 0)).toBe(100);
    expect(quote.filter((q) => q === 34).length).toBe(1);
  });

  it('con tutti i pesi a zero divide in parti uguali senza perdere centesimi', () => {
    const quote = ripartisciCentesimi(10, [0, 0, 0]);
    expect(quote.reduce((s, q) => s + q, 0)).toBe(10);
  });

  it('senza niente da dividere non da niente', () => {
    expect(ripartisciCentesimi(0, [100, 200])).toEqual([0, 0]);
    expect(ripartisciCentesimi(-5, [100])).toEqual([0]);
    expect(ripartisciCentesimi(100, [])).toEqual([]);
  });
});

describe('lo sconto ridotto al massimo consentito', () => {
  it('sotto il tetto lascia tutto com e', () => {
    expect(riduciAlTetto(500, 200, 1000)).toEqual({ codice: 500, ritiro: 200 });
  });

  it('sopra il tetto riduce i due mantenendo il rapporto, e la somma torna', () => {
    // Il caso che divergeva: sconto richiesto 3000, addebitabile 1000.
    const r = riduciAlTetto(2000, 1000, 1000);
    expect(r.codice + r.ritiro).toBe(1000);
    expect(r.codice).toBeGreaterThan(r.ritiro);
  });

  it('con tetto zero non sconta niente', () => {
    expect(riduciAlTetto(2000, 1000, 0)).toEqual({ codice: 0, ritiro: 0 });
  });
});

describe('il compenso del fattorino', () => {
  // Il compenso si leggeva dal prezzo di spedizione pagato dal cliente, che
  // sopra la soglia della spedizione gratuita e' zero: su ogni ordine grosso il
  // fattorino consegnava e non veniva pagato.
  it('non e zero su un ordine con spedizione gratuita', () => {
    const compenso = compensoRiderCents({
      storeLat: 45.05, storeLng: 9.69,      // Piacenza centro
      deliveryLat: 45.06, deliveryLng: 9.70,
      pickupInStore: false,
    });
    expect(compenso).toBeGreaterThan(0);
    // A conferma che il caso è proprio quello dell'ordine sopra soglia.
    expect(FREE_SHIPPING_THRESHOLD).toBeGreaterThan(0);
  });

  it('cresce con la distanza', () => {
    const vicino = compensoRiderCents({
      storeLat: 45.05, storeLng: 9.69, deliveryLat: 45.06, deliveryLng: 9.70, pickupInStore: false,
    });
    const lontano = compensoRiderCents({
      storeLat: 45.05, storeLng: 9.69, deliveryLat: 45.20, deliveryLng: 9.90, pickupInStore: false,
    });
    expect(lontano).toBeGreaterThan(vicino);
  });

  it('senza coordinate usa la tariffa fissa, non zero', () => {
    expect(compensoRiderCents({
      storeLat: null, storeLng: null, deliveryLat: null, deliveryLng: null, pickupInStore: false,
    })).toBeGreaterThan(0);
  });

  it('col ritiro in negozio non c e consegna, quindi non c e compenso', () => {
    expect(compensoRiderCents({
      storeLat: 45.05, storeLng: 9.69, deliveryLat: 45.06, deliveryLng: 9.70, pickupInStore: true,
    })).toBe(0);
  });
});
