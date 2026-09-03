import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  metricheVenditore,
  incassatoDellOrdineCents,
  totaliDiSempre,
} from '@/lib/metriche-venditore';
import { riepilogoNegozio } from '@/lib/guadagni/negozio';

/**
 * 3/9/2026 — IL RIMBORSO AL CLIENTE NON TOGLIEVA UN EURO DAI GUADAGNI CHE IL
 * NEGOZIO VEDE.
 *
 * Anna rimborsa 40 € su un ordine da 100 € perché nel sacchetto mancava un
 * pezzo. In cassa le restano 60 €, meno la commissione. Il suo cruscotto le
 * mostrava 100 €, e la pagina Guadagni — che il rimborso lo sottraeva davvero —
 * gliene mostrava 60. Stesso mese, stesso negozio, due cifre diverse in due
 * pagine dello stesso pannello: quella grossa era quella falsa, ed è il tipo di
 * scoperta che fa perdere fiducia a un negozio appena entrato.
 *
 * La causa non era una dimenticanza in un punto: erano DUE conti scritti in due
 * file, e solo uno dei due sapeva dei rimborsi. Adesso il conto è uno solo
 * (`incassatoDellOrdineCents`) e lo chiamano entrambe le pagine. Questa prova
 * lo esegue su un rimborso parziale e su un rimborso totale, e verifica che le
 * due pagine diano lo stesso numero sullo stesso ordine.
 */

/** L'ordine di Anna: il cliente paga 100 €, dentro ci sono 5 € di spedizione e 3 € di consegna. */
const ordineDaCento = {
  total_price: 100,
  delivery_status: 'DELIVERED',
  payment_status: 'PAID',
  application_fee_cents: 850,
  shipping_cost: 5,
  delivery_fee_cents: 300,
  refunded_amount_cents: 0,
  created_at: '2026-08-10T10:00:00Z',
};

describe('quanto è entrato davvero su un ordine', () => {
  it('senza rimborsi è il totale pagato dal cliente', () => {
    expect(incassatoDellOrdineCents(ordineDaCento)).toBe(10_000);
  });

  it('con un rimborso parziale scende di quello che è tornato indietro', () => {
    expect(
      incassatoDellOrdineCents({ ...ordineDaCento, refunded_amount_cents: 4_000 }),
      'Rimborsati 40 € su 100: ne sono entrati 60, non 100',
    ).toBe(6_000);
  });

  it('con un rimborso totale non è entrato niente', () => {
    expect(
      incassatoDellOrdineCents({ ...ordineDaCento, refunded_amount_cents: 10_000 }),
      'Rimborsato tutto: l ordine non ha portato un euro al negozio',
    ).toBe(0);
  });

  it('un rimborso più grande del totale non diventa un debito del negozio', () => {
    expect(incassatoDellOrdineCents({ ...ordineDaCento, refunded_amount_cents: 12_000 })).toBe(0);
  });
});

describe('il cruscotto del negozio, con un rimborso parziale', () => {
  it('mostra 60 € entrati, non 100', () => {
    const m = metricheVenditore([
      { ...ordineDaCento, payment_status: 'PARTIALLY_REFUNDED', refunded_amount_cents: 4_000 },
    ]);
    expect(m.ordini, 'l ordine rimborsato a metà resta un ordine').toBe(1);
    expect(
      m.incassatoCents,
      'Il cruscotto sommava `total_price` intero: 40 € che il negozio non ha mai avuto',
    ).toBe(6_000);
    // 6000 entrati − 850 commissione − 500 spedizione − 300 consegna = 4350
    expect(m.tuoNettoCents, 'e il netto scende di conseguenza').toBe(4_350);
  });
});

describe('il cruscotto del negozio, con un rimborso totale', () => {
  it('non conta un euro di quell ordine', () => {
    const m = metricheVenditore([
      { ...ordineDaCento, payment_status: 'PARTIALLY_REFUNDED', refunded_amount_cents: 10_000 },
    ]);
    expect(
      m.incassatoCents,
      'Rimborsato per intero e ancora contato per 100 €: il numero più falso del pannello',
    ).toBe(0);
    expect(m.tuoNettoCents, 'niente entrato, niente netto').toBe(0);
  });

  it('gli altri ordini della stessa settimana restano interi', () => {
    const m = metricheVenditore([
      ordineDaCento,
      { ...ordineDaCento, payment_status: 'PARTIALLY_REFUNDED', refunded_amount_cents: 10_000 },
    ]);
    expect(m.ordini).toBe(2);
    expect(m.incassatoCents, 'uno pieno, uno rimborsato del tutto').toBe(10_000);
  });
});

describe('le due pagine del venditore danno lo stesso numero', () => {
  /**
   * È la prova che chiude la malattia, non il sintomo: il cruscotto e la pagina
   * Guadagni devono partire dallo stesso conto. Finché erano due formule in due
   * file, bastava ripararne una.
   */
  const conCarta = {
    ...ordineDaCento,
    payment_status: 'PARTIALLY_REFUNDED',
    refunded_amount_cents: 4_000,
    payment_method: 'card',
    payout_status: 'TRANSFERRED',
    seller_payout_cents: 4_350,
    seller_payout_reversed_cents: 0,
  };

  it('sullo stesso ordine rimborsato a metà', () => {
    const cruscotto = metricheVenditore([conCarta]).incassatoCents;
    const guadagni = riepilogoNegozio([conCarta]).lordoCents;
    expect(
      cruscotto,
      `Il cruscotto diceva ${cruscotto / 100} € e la pagina Guadagni ${guadagni / 100} €: due cifre per lo stesso mese`,
    ).toBe(guadagni);
    expect(cruscotto).toBe(6_000);
  });

  it('e sullo stesso ordine rimborsato per intero', () => {
    const tutto = { ...conCarta, refunded_amount_cents: 10_000 };
    expect(metricheVenditore([tutto]).incassatoCents).toBe(riepilogoNegozio([tutto]).lordoCents);
    expect(riepilogoNegozio([tutto]).lordoCents).toBe(0);
  });
});

describe('i totali «dall inizio», che li somma il database', () => {
  /**
   * Il browser legge solo trenta giorni: i totali di sempre li somma
   * `numeri_del_negozio`, che è stata scritta prima di questo difetto e
   * `refunded_amount_cents` non l'ha mai guardato. Un numero che per
   * costruzione non può aver tolto i rimborsi non deve arrivare a schermo.
   */
  const ripiego = { incassatoCents: 6_000, tuoNettoCents: 4_350 };

  it('se il database non dice niente dei rimborsi, i suoi totali non si mostrano', () => {
    const totali = totaliDiSempre(
      { incasso_totale_cents: 100_000, commissione_totale_cents: 8_500, non_del_negozio_cents: 8_000 },
      ripiego,
    );
    expect(
      totali,
      'Un totale cieco sui rimborsi è più alto del vero: meglio trenta giorni veri che «sempre» gonfiato',
    ).toEqual(ripiego);
  });

  it('se non risponde affatto, si ripiega su quello che il browser sa calcolare', () => {
    expect(totaliDiSempre(null, ripiego)).toEqual(ripiego);
  });

  it('quando invece i rimborsi li sa, i suoi totali valgono', () => {
    const totali = totaliDiSempre(
      {
        incasso_totale_cents: 92_000,
        commissione_totale_cents: 8_500,
        non_del_negozio_cents: 8_000,
        rimborsi_totali_cents: 8_000,
      },
      ripiego,
    );
    expect(totali.incassatoCents).toBe(92_000);
    expect(totali.tuoNettoCents).toBe(75_500);
  });

  it('zero rimborsi è una risposta, non un silenzio', () => {
    const totali = totaliDiSempre(
      {
        incasso_totale_cents: 100_000,
        commissione_totale_cents: 8_500,
        non_del_negozio_cents: 8_000,
        rimborsi_totali_cents: 0,
      },
      ripiego,
    );
    expect(totali.incassatoCents, 'un negozio senza resi ha davvero incassato tutto').toBe(100_000);
  });
});

/**
 * La funzione può anche essere giusta: se la pagina non le passa il rimborso,
 * il negoziante legge lo stesso il numero sbagliato. Qui si guarda che ogni
 * pagina che usa la definizione unica CHIEDA al database anche i rimborsi —
 * compresa quella che qualcuno scriverà domani.
 */
describe('le pagine chiedono al database anche i rimborsi', () => {
  const RADICE = path.resolve(__dirname, '../..');

  function fileDentro(cartella: string): string[] {
    const esiti: string[] = [];
    for (const nome of readdirSync(cartella)) {
      const pieno = path.join(cartella, nome);
      if (nome === 'node_modules' || nome.startsWith('.')) continue;
      if (statSync(pieno).isDirectory()) esiti.push(...fileDentro(pieno));
      else if (/\.tsx?$/.test(nome)) esiti.push(pieno);
    }
    return esiti;
  }

  it('ogni pagina che somma il fatturato legge refunded_amount_cents', () => {
    const pagine = fileDentro(path.join(RADICE, 'app'))
      .map((f) => ({ f, testo: readFileSync(f, 'utf8') }))
      .filter(({ testo }) => /\bmetricheVenditore\b/.test(testo));

    expect(
      pagine.length,
      'Nessuna pagina usa più la definizione unica del fatturato: questa prova non guarda niente',
    ).toBeGreaterThan(0);

    const cieche = pagine
      .filter(({ testo }) => {
        // Le letture della tabella ordini che portano il denaro dentro la metrica.
        const letture = testo.match(/\.select\(\s*'[^']*total_price[^']*'/g) ?? [];
        return letture.some((l) => !l.includes('refunded_amount_cents'));
      })
      .map(({ f }) => path.relative(RADICE, f));

    expect(
      cieche,
      'Queste pagine sommano il fatturato senza mai chiedere quanto è stato rimborsato: il conto giusto riceve dati ciechi',
    ).toEqual([]);
  });
});
