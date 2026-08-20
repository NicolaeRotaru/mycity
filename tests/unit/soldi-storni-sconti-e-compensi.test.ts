import { describe, it, expect } from 'vitest';
import { ripartisciCentesimi, riduciAlTetto } from '@/lib/stripe/ripartizione';
import { residuoRecuperabile } from '@/lib/stripe/payout';
import { compensoRiderCents, shippingCentsFor } from '@/lib/shipping';
import { COMPENSO_RIDER_CENTS, FREE_SHIPPING_THRESHOLD, PLATFORM_DELIVERY_FEE_CENTS } from '@/lib/constants';

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
  // STORIA IN DUE ATTI.
  //
  // ① Il compenso si leggeva dal prezzo di spedizione pagato dal cliente, che
  //    sopra la soglia della spedizione gratuita e' zero: su ogni ordine grosso
  //    il fattorino consegnava e non veniva pagato.
  // ② Poi e' stato staccato dal prezzo del cliente ma e' rimasto legato alla
  //    distanza (2,50 + 1,20 al km). Il conto continuava a non tornare: con la
  //    spedizione gratis l'unica cosa disponibile per pagarlo erano i 3 euro di
  //    fee di consegna, che bastano solo fino a 420 metri. Oltre, il versamento
  //    al fattorino chiedeva piu' soldi di quanti ne fossero rimasti
  //    sull'incasso, quindi falliva e il cron lo ritentava all'infinito.
  //
  // Adesso il compenso e' FISSO (Nicola, 20/8/2026). Questi controlli tengono
  // ferme le due cose che contano: che non sia mai zero, e che i soldi per
  // pagarlo ci siano SEMPRE.

  it('e sempre la stessa cifra, comunque sia lontana la consegna', () => {
    expect(compensoRiderCents({ pickupInStore: false })).toBe(COMPENSO_RIDER_CENTS);
    expect(COMPENSO_RIDER_CENTS).toBeGreaterThan(0);
  });

  it('col ritiro in negozio non c e consegna, quindi non c e compenso', () => {
    expect(compensoRiderCents({ pickupInStore: true })).toBe(0);
  });

  // LA PROVA CHE CONTA, ed e' quella che il compenso a distanza faceva fallire.
  //
  // Su ogni ordine la piattaforma trattiene la fee di consegna, e il cliente
  // paga la spedizione (zero sopra la soglia). Da li' esce il compenso del
  // fattorino. Se quella somma e' minore del compenso, il versamento non ha
  // abbastanza soldi: e' esattamente il caso «spesa da 30 euro a 5 km», dove
  // servivano 8,50 euro e ce n'erano 3.
  it('i soldi per pagarlo ci sono sempre, a qualunque distanza e a qualunque importo', () => {
    const distanze = [
      { deliveryLat: 45.05,  deliveryLng: 9.690 },  // stesso isolato
      { deliveryLat: 45.06,  deliveryLng: 9.700 },  // ~1,3 km
      { deliveryLat: 45.20,  deliveryLng: 9.900 },  // ~24 km
    ];
    const subtotali = [5, 15, 29.99, FREE_SHIPPING_THRESHOLD, 60, 250];
    const casiScoperti: string[] = [];

    for (const subtotal of subtotali) {
      for (const dove of distanze) {
        const spedizione = shippingCentsFor({
          subtotal,
          storeLat: 45.05, storeLng: 9.69,
          ...dove,
          pickupInStore: false,
        });
        const disponibile = spedizione + PLATFORM_DELIVERY_FEE_CENTS;
        const dovuto = compensoRiderCents({ pickupInStore: false });
        if (disponibile < dovuto) {
          casiScoperti.push(
            `subtotale ${subtotal} euro a ${dove.deliveryLat}: disponibili ${disponibile}, dovuti ${dovuto}`,
          );
        }
      }
    }

    expect(casiScoperti).toEqual([]);
  });

  it('sopra la soglia la spedizione e zero, e la fee di consegna copre da sola il compenso', () => {
    const spedizione = shippingCentsFor({
      subtotal: FREE_SHIPPING_THRESHOLD + 10,
      storeLat: 45.05, storeLng: 9.69,
      deliveryLat: 45.20, deliveryLng: 9.90,   // lontano: col vecchio calcolo erano 8,50 euro
      pickupInStore: false,
    });
    expect(spedizione).toBe(0);
    expect(PLATFORM_DELIVERY_FEE_CENTS).toBeGreaterThanOrEqual(
      compensoRiderCents({ pickupInStore: false }),
    );
  });
});
