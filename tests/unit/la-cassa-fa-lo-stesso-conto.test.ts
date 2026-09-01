import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { prezziDelCarrello } from '@/lib/ordini/prezzi';

/**
 * 22/8/2026 — LA CASSA ESISTEVA IN DUE COPIE.
 *
 * Il percorso in contanti e quello con carta rifacevano lo stesso conto, riga
 * per riga. La storia scritta nei commenti di quelle due rotte dice che almeno
 * tre volte una riparazione è stata fatta da una parte sola:
 *
 *  · lo sconto senza tetto, che produceva ordini a totale negativo;
 *  · gli arrotondamenti indipendenti, che non quadravano con l'addebito;
 *  · il compenso del fattorino, che una rotta scriveva e l'altra no.
 *
 * Ogni volta il cliente pagava un importo diverso a seconda di come sceglieva
 * di pagare, e nessuno se ne accorgeva finché non telefonava qualcuno.
 *
 * Adesso il conto è uno solo. Questo file lo tiene tale in due modi: prova la
 * funzione condivisa sui casi che erano andati storti, e legge le due rotte
 * per verificare che il conto non sia tornato a essere scritto in casa.
 */

const NEGOZIO = { lat: 45.05, lng: 9.69 };

function carrello(subtotali: number[], opts: Partial<Parameters<typeof prezziDelCarrello>[0]> = {}) {
  return prezziDelCarrello({
    gruppi: subtotali.map((s, i) => ({ sellerId: `negozio-${i}`, subtotalCents: s })),
    coordinateNegozio: () => NEGOZIO,
    consegnaLat: null,
    consegnaLng: null,
    pickupInStore: false,
    couponSpedizioneGratis: false,
    couponScontoCents: 0,
    ...opts,
  });
}

describe('il conto della cassa', () => {
  it('la somma delle quote di sconto torna al centesimo con lo sconto applicato', () => {
    // Il caso vero che non tornava: un buono da 10,01 € su tre negozi.
    const esito = carrello([3000, 2500, 1700], { couponScontoCents: 1001 });
    const somma = esito.gruppi.reduce((s, g) => s + g.couponPortionCents, 0);
    expect(somma).toBe(1001);
  });

  it('uno sconto piu grande del carrello non produce un ordine a totale negativo', () => {
    // «Un negozio che paga il cliente»: succedeva sul percorso in contanti.
    const esito = carrello([1000], { couponScontoCents: 99999 });
    expect(esito.gruppi[0].totalCents).toBeGreaterThanOrEqual(0);
    expect(esito.scontoApplicatoCents).toBeLessThanOrEqual(1000 + esito.grandShippingCents);
  });

  it('il compenso del fattorino c e su ogni consegna, e sparisce sul ritiro', () => {
    expect(carrello([2000]).gruppi[0].riderFeeCents).toBeGreaterThan(0);
    expect(carrello([2000], { pickupInStore: true }).gruppi[0].riderFeeCents).toBe(0);
  });

  it('sul ritiro in negozio non si paga ne spedizione ne consegna', () => {
    const esito = carrello([2000, 1500], { pickupInStore: true });
    for (const g of esito.gruppi) {
      expect(g.shippingCents).toBe(0);
      expect(g.deliveryFeeCents).toBe(0);
    }
  });

  it('la spedizione si paga PER NEGOZIO, non una per carrello', () => {
    // Sotto la soglia della spedizione gratuita, due negozi = due spedizioni.
    const uno = carrello([500]);
    const due = carrello([500, 500]);
    expect(due.grandShippingCents).toBe(uno.grandShippingCents * 2);
  });

  it('il totale del carrello e la somma dei totali per negozio', () => {
    const esito = carrello([3000, 2500, 1700], { couponScontoCents: 500 });
    const somma = esito.gruppi.reduce((s, g) => s + g.totalCents, 0);
    expect(esito.grandTotalCents).toBe(somma);
  });
});

/**
 * Il freno: se una delle due rotte torna a farsi il conto in casa, questo
 * diventa rosso. Non e' elegante leggere il codice, ma e' l'unico modo di
 * accorgersi della DIVERGENZA — che e' il difetto vero, non l'aritmetica.
 */
describe('nessuna delle due rotte si rifa il conto in casa', () => {
  const rotte = [
    'app/api/orders/cod/route.ts',
    'app/api/stripe/checkout/route.ts',
  ];

  it('tutte e due chiamano la stessa funzione', () => {
    for (const r of rotte) {
      expect(readFileSync(r, 'utf8'), `${r} non usa il conto condiviso`).toContain('prezziDelCarrello(');
    }
  });

  it('nessuna delle due ripartisce gli sconti per conto suo', () => {
    for (const r of rotte) {
      const testo = readFileSync(r, 'utf8');
      expect(testo, `${r} si ripartisce gli sconti da solo`).not.toContain('ripartisciCentesimi(');
      expect(testo, `${r} si calcola il tetto degli sconti da solo`).not.toContain('riduciAlTetto(');
    }
  });

  /**
   * 27/8/2026 (R008) — E IL COMPENSO DEL FATTORINO SI LEGGE, NON SI RIFA.
   *
   * Il conto condiviso lo calcolava (`riderFeeCents`) e non lo leggeva nessuno:
   * le due rotte se lo ricalcolavano per conto loro. Un campo calcolato e mai
   * usato fa credere che la regola stia in un posto solo mentre vive in tre.
   * Che il numero segua davvero `lib/constants` lo ESEGUE
   * `il-compenso-del-fattorino-ha-una-casa-sola.test.ts`.
   */
  it('il compenso del fattorino lo prendono dal conto condiviso', () => {
    for (const r of rotte) {
      const testo = readFileSync(r, 'utf8');
      expect(testo, `${r} non legge il compenso dal conto condiviso`).toContain('riderFeeCents');
      expect(testo, `${r} si ricalcola il compenso del fattorino da solo`).not.toContain('compensoRiderCents(');
    }
  });

  /**
   * 27/8/2026 (R001) — E NEMMENO LA PAGINA CHE IL CLIENTE GUARDA.
   *
   * Le due rotte erano allineate fra loro, ma la terza copia del conto stava
   * nel browser: `app/checkout/page.tsx` sommava a mano subtotale, spedizione,
   * fee e sconto, senza il tetto. Il cliente leggeva «0,00 €» e ne pagava 3,01.
   *
   * Questa e' la guardia strutturale; quella che ESEGUE il conto delle due
   * strade sta in `in-cassa-il-totale-mostrato-e-quello-addebitato.test.ts`.
   */
  it('nemmeno la pagina della cassa si rifa il totale in casa', () => {
    const pagina = readFileSync('app/checkout/page.tsx', 'utf8');
    expect(pagina, 'la cassa non passa piu dal conto condiviso').toContain('riepilogoDaMostrare(');
    expect(
      pagina,
      'la cassa si e rifatta il totale a mano: senza il tetto sugli sconti mostra meno di quello che addebita',
    ).not.toMatch(/grandSubtotal \+ grandShipping \+ platformDeliveryFee/);
  });
});
