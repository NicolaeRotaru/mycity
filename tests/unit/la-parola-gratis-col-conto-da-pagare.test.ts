import { describe, it, expect } from 'vitest';
import { dettoDellaSpedizione, shippingForEuro } from '@/lib/shipping';
import { FREE_SHIPPING_THRESHOLD } from '@/lib/constants';

/**
 * IL CARRELLO DICEVA «GRATIS» E NEL TOTALE C'ERANO 9,80 €.
 *
 * La parola e il numero avevano due basi diverse. `freeShipping` guardava il totale di TUTTO il
 * carrello (`total >= 30`); il numero addebitato sommava `shippingForEuro` per ogni gruppo-negozio,
 * e quella azzera solo se il subtotale DEL SINGOLO negozio supera la soglia.
 *
 * Il caso vero: 20 € dal fornaio + 15 € dal macellaio = 35 €, quindi «Gratis*» a schermo, e dentro
 * il totale 4,90 + 4,90 = 9,80 € senza una riga che li spiegasse. Il cliente legge «gratis» e paga
 * dieci euro. Nel carrello la fiducia è l'unica leva che abbiamo.
 *
 * ── Cosa prova questo file ───────────────────────────────────────────────────────────────────
 * Il caso che morde è ricostruito coi numeri veri: due negozi, ciascuno sotto soglia, somma sopra
 * soglia. Poi la proprietà che non deve mai rompersi, su una griglia di casi: **non si può dire
 * «Gratis» avendo un costo in mano**. Non è una frase da controllare a occhio, è un invariante che
 * gira.
 */

const formatta = (euro: number) => `${euro.toFixed(2).replace('.', ',')} €`;

/** Il costo che il carrello calcola davvero: `shippingForEuro` per ogni negozio, poi sommato. */
function costoDelCarrello(subtotaliPerNegozio: number[]): number {
  return subtotaliPerNegozio.reduce(
    (somma, subtotal) =>
      somma +
      shippingForEuro({
        subtotal,
        storeLat: null,
        storeLng: null,
        deliveryLat: null,
        deliveryLng: null,
        pickupInStore: false,
      }),
    0,
  );
}

describe('il caso che morde: due negozi sotto soglia, somma sopra soglia', () => {
  const subtotali = [20, 15]; // 35 € in tutto, nessuno dei due arriva a 30

  it('il costo NON è zero: il vecchio conto sul totale globale diceva il contrario', () => {
    expect(costoDelCarrello(subtotali)).toBeGreaterThan(0);
    expect(subtotali.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(FREE_SHIPPING_THRESHOLD);
  });

  it('la parola non dice «Gratis»', () => {
    const detto = dettoDellaSpedizione({ costo: costoDelCarrello(subtotali), negozi: 2, formatta });
    expect(detto.gratis, 'con 9,80 € da pagare la riga diceva «Gratis*»').toBe(false);
    expect(detto.etichetta).not.toMatch(/gratis/i);
    expect(detto.etichetta).toContain('€');
  });

  it('e la nota spiega la regola, invece di un asterisco che non rimanda a niente', () => {
    const detto = dettoDellaSpedizione({ costo: costoDelCarrello(subtotali), negozi: 2, formatta });
    expect(detto.nota).toContain(String(FREE_SHIPPING_THRESHOLD));
    expect(detto.nota).toMatch(/ciascuno|stesso negozio/);
  });
});

describe("l'invariante: «Gratis» solo con zero da pagare", () => {
  const casi: number[][] = [
    [20, 15], // il caso rotto
    [10],
    [29.99],
    [30],
    [35],
    [30, 30],
    [30, 5],
    [5, 5, 5],
    [100, 1],
  ];

  for (const subtotali of casi) {
    it(`carrello ${JSON.stringify(subtotali)}: parola e numero d'accordo`, () => {
      const costo = costoDelCarrello(subtotali);
      const detto = dettoDellaSpedizione({ costo, negozi: subtotali.length, formatta });
      expect(detto.gratis).toBe(costo === 0);
      if (costo > 0) expect(detto.etichetta).not.toMatch(/gratis/i);
      if (costo === 0) expect(detto.etichetta).toBe('Gratis');
      expect(detto.costo).toBe(costo);
    });
  }

  it('un negozio solo sopra soglia resta gratis davvero', () => {
    const costo = costoDelCarrello([35]);
    expect(costo).toBe(0);
    expect(dettoDellaSpedizione({ costo, negozi: 1, formatta }).etichetta).toBe('Gratis');
  });

  it('un costo storto non diventa «Gratis» per sbaglio', () => {
    expect(dettoDellaSpedizione({ costo: Number.NaN, negozi: 1, formatta }).gratis).toBe(true);
    expect(dettoDellaSpedizione({ costo: -5, negozi: 1, formatta }).gratis).toBe(true);
    // Un numero non leggibile diventa zero, non un importo inventato: se un giorno arriva un NaN
    // meglio dire «Gratis» su un carrello che non ha spedizione che stampare «NaN €» al cliente.
    expect(dettoDellaSpedizione({ costo: Number.NaN, negozi: 1, formatta }).etichetta).toBe('Gratis');
  });
});

describe('il carrello usa questa funzione, non una copia', () => {
  it('nel carrello non è rimasto il vecchio ternario che stampava «Gratis*»', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../app/cart/page.tsx', import.meta.url), 'utf8');
    expect(src, "il carrello deve chiamare la funzione, non ricalcolare la parola").toContain('dettoDellaSpedizione(');
    expect(src, "«Gratis*» era la stringa del difetto").not.toContain("'Gratis*'");
  });
});
