import { describe, it, expect } from 'vitest';
import { prezziDelCarrello, type IngressiPrezzo } from '@/lib/ordini/prezzi';
import { riepilogoDaMostrare } from '@/lib/ordini/riepilogo-cassa';

/**
 * 27/8/2026 (R001) — IL CLIENTE VEDEVA «0,00 €» E NE PAGAVA 3,01.
 *
 * Il totale scritto in cassa se lo faceva il browser, con una formula sua:
 *
 *   Math.max(0, subtotale + spedizione + fee − sconto − scontoRitiro)
 *
 * Al server quella formula manca un pezzo: il TETTO sullo sconto
 * (`lib/ordini/prezzi.ts`), che non lascia scendere il conto sotto un
 * centesimo sopra la merce piu' la spedizione. Un buono a importo fisso da 30 €
 * su una spesa da 10 € nel browser azzerava tutto; il server ne addebitava
 * comunque 3,01 — la fee di consegna, che il tetto non copre.
 *
 * Chi paga alla consegna se lo sente dire dal fattorino sulla porta, su un
 * ordine che la pagina dava per gratis: e' il reclamo piu' difficile da
 * spiegare che ci sia. Con la carta l'addebito non coincide con l'ultima cifra
 * vista prima di premere «Paga».
 *
 * Adesso il numero mostrato e quello addebitato nascono dalla stessa funzione.
 * Questo file lo tiene tale: esegue tutte e due le strade sugli stessi dati e
 * pretende lo stesso centesimo.
 */

const NEGOZIO = { lat: 45.05, lng: 9.69 };

function ingressi(subtotali: number[], opts: Partial<IngressiPrezzo> = {}): IngressiPrezzo {
  return {
    gruppi: subtotali.map((s, i) => ({ sellerId: `negozio-${i}`, subtotalCents: s })),
    coordinateNegozio: () => NEGOZIO,
    consegnaLat: null,
    consegnaLng: null,
    pickupInStore: false,
    couponSpedizioneGratis: false,
    couponScontoCents: 0,
    ...opts,
  };
}

/**
 * La formula che stava in `app/checkout/page.tsx` fino al 30/8/2026, copiata
 * qui parola per parola. Serve a dimostrare che il difetto era vero: se un
 * domani qualcuno la rimettesse nella pagina, il totale tornerebbe a divergere
 * esattamente di questi centesimi.
 */
function comeContavaIlBrowser(o: {
  subtotale: number;
  spedizione: number;
  feeConsegna: number;
  sconto: number;
  scontoRitiro: number;
}): number {
  return Math.max(0, o.subtotale + o.spedizione + o.feeConsegna - o.sconto - o.scontoRitiro);
}

describe('il totale che si legge in cassa', () => {
  it('col buono piu grande della spesa dice quello che il server addebita davvero', () => {
    // Il caso vero del referto: 10 € da un negozio, buono a importo fisso da 30 €.
    const ing = ingressi([1000], { couponScontoCents: 3000 });
    const addebitato = prezziDelCarrello(ing).grandTotalCents;

    const mostrato = riepilogoDaMostrare({ ...ing, usaCredito: false, creditoDisponibileCents: 0 });

    expect(addebitato, 'il server non addebita piu 3,01 € su questo carrello').toBe(301);
    expect(
      Math.round(mostrato.totale * 100),
      'la cassa mostra un totale diverso da quello che il cliente paghera',
    ).toBe(addebitato);

    // E la vecchia formula del browser diceva zero: e' il difetto, nero su bianco.
    expect(
      comeContavaIlBrowser({ subtotale: 10, spedizione: 4.9, feeConsegna: 3, sconto: 30, scontoRitiro: 0 }),
      'la formula vecchia non divergeva: allora questa prova non prova niente',
    ).toBe(0);
  });

  it('su ogni carrello il totale mostrato e la somma dei totali per negozio', () => {
    const casi: Array<[number[], number]> = [
      [[1000], 3000],      // buono piu grande di tutto
      [[3000, 2500], 1001],// buono che non si divide in due parti intere
      [[500], 0],          // nessuno sconto
      [[4000], 4390],      // buono che lascia esattamente un centesimo
      [[1200, 800, 700], 2500],
    ];
    for (const [subtotali, sconto] of casi) {
      const ing = ingressi(subtotali, { couponScontoCents: sconto });
      const mostrato = riepilogoDaMostrare({ ...ing, usaCredito: false, creditoDisponibileCents: 0 });
      expect(
        Math.round(mostrato.totale * 100),
        `carrello ${subtotali.join('+')} con buono ${sconto}: la cassa e il server non dicono la stessa cifra`,
      ).toBe(prezziDelCarrello(ing).grandTotalCents);
    }
  });

  it('le voci del riepilogo sono quelle DAVVERO applicate, non quelle richieste', () => {
    // Lo sconto richiesto e' 30 €, ma sul carrello da 10 € ne entrano 14,89
    // (merce + spedizione − 1 centesimo). Se il riepilogo scrivesse «−30,00 €»
    // le righe non tornerebbero col totale: il cliente fa la somma a mano.
    const ing = ingressi([1000], { couponScontoCents: 3000 });
    const r = riepilogoDaMostrare({ ...ing, usaCredito: false, creditoDisponibileCents: 0 });
    expect(Math.round(r.scontoCodice * 100)).toBe(1489);
    const somma = r.subtotale + r.spedizione + r.feeConsegna - r.scontoCodice - r.scontoRitiro - r.creditoUsato;
    expect(Math.round(somma * 100), 'le righe del riepilogo non fanno il totale').toBe(Math.round(r.totale * 100));
  });

  it('il credito MyCity non porta il totale sotto zero e si vede quanto ne entra', () => {
    const ing = ingressi([2000]);
    const totaleSenzaCredito = prezziDelCarrello(ing).grandTotalCents; // 2000 + 490 + 300
    const r = riepilogoDaMostrare({ ...ing, usaCredito: true, creditoDisponibileCents: 999_00 });
    expect(Math.round(r.creditoUsato * 100), 'il credito applicato supera il dovuto').toBe(totaleSenzaCredito);
    expect(r.totale).toBe(0);
  });

  it('senza credito acceso il credito disponibile non tocca il totale', () => {
    const ing = ingressi([2000]);
    const r = riepilogoDaMostrare({ ...ing, usaCredito: false, creditoDisponibileCents: 5000 });
    expect(r.creditoUsato).toBe(0);
    expect(Math.round(r.totale * 100)).toBe(prezziDelCarrello(ing).grandTotalCents);
  });
});
