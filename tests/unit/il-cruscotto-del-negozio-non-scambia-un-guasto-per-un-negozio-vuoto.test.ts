/** @vitest-environment jsdom */
/**
 * «NESSUNA RECENSIONE» E «0 ARTICOLI VENDUTI» ERANO ANCHE LA FACCIA DEL GUASTO.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────
 * Il cruscotto del venditore fa sei letture in parallelo e ne controllava UNA.
 * `if (ordiniRes.error) throw ordiniRes.error` era l'unico controllo del file:
 * le righe d'ordine, le recensioni e i due conteggi dei prodotti finivano in un
 * `?? 0` o in un `?? []`. Peggio: i conteggi erano destrutturati
 * (`const [{ count: productCount }, …]`), e la destrutturazione buttava via il
 * campo `error` prima ancora che qualcuno potesse guardarlo.
 *
 * Il risultato, con la funzione `store_review_stats` non raggiungibile — un
 * permesso tolto, una migrazione non applicata, il database lento: la targhetta
 * «Valutazione media» mostrava «—» e sotto «Nessuna recensione», e quella degli
 * articoli «0 · Ultimi 30 giorni». Cioè esattamente quello che vede un negozio
 * aperto ieri. È la prima schermata che il negoziante apre la mattina, e gli
 * diceva che nessuno l'ha recensito e che non ha venduto niente — quando la
 * verità era solo che nessuno era andato a guardare.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────
 * Esegue la decisione, non la cerca. La regola «una lettura fallita non è uno
 * zero» adesso vive in funzioni pure (`lib/letture-cruscotto.ts`) che scelgono
 * ANCHE la riga da scrivere a schermo, e qui vengono chiamate con le due
 * risposte che il difetto confondeva: il negozio davvero vuoto e la lettura
 * andata male. Se le due tornano a somigliarsi, la prova diventa rossa.
 *
 * Dentro il componente questa decisione non sarebbe eseguibile da nessuna
 * prova: è il motivo per cui non bastava aggiungere tre `if` alla pagina.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import {
  NON_LETTO,
  avvisoLettureFallite,
  elenco,
  letturaRiuscita,
  lettureFallite,
  targhettaArticoli,
  targhettaNetto,
  targhettaProdotti,
  targhettaValutazione,
} from '@/lib/letture-cruscotto';
import {
  apriIlCruscotto, chiudiIlCruscotto, statisticheDelCruscotto,
  type ScostamentiDelCruscotto,
} from './aiuti/cruscotto-del-negozio';

/** Com'è fatta davvero una risposta di Supabase andata male. */
const ROTTA = { error: { message: 'function public.store_review_stats does not exist', code: '42883' } };
/** E una andata bene: `error` c'è ed è `null`. */
const OK = { data: [{ avg: '4.5', count: '12' }], error: null };

describe('quando una lettura è riuscita, e quando no', () => {
  it('è riuscita solo se ha risposto e non porta un errore', () => {
    expect(letturaRiuscita(OK)).toBe(true);
    expect(letturaRiuscita({ count: 0, error: null })).toBe(true);
    expect(letturaRiuscita({})).toBe(true);
    expect(letturaRiuscita(ROTTA)).toBe(false);
  });

  it('una risposta che non c\'è non è una risposta vuota', () => {
    // `Promise.all` restituisce quello che le hanno dato: una riga tolta
    // dall'elenco lascia un buco, e un buco non è un dato.
    expect(letturaRiuscita(null)).toBe(false);
    expect(letturaRiuscita(undefined)).toBe(false);
  });

  it('elenca per nome le letture fallite, e solo quelle', () => {
    expect(
      lettureFallite({ prodotti: OK, disponibili: OK, righe: ROTTA, recensioni: ROTTA }),
    ).toEqual(['righe', 'recensioni']);
    expect(lettureFallite({ prodotti: OK, righe: OK })).toEqual([]);
  });
});

describe('la targhetta della valutazione media', () => {
  const negozioNuovo = targhettaValutazione({ letta: true, media: 0, quante: 0 });
  const negozioConRecensioni = targhettaValutazione({ letta: true, media: 4.5, quante: 12 });
  const letturaFallita = targhettaValutazione({ letta: false, media: 0, quante: 0 });

  it('col negozio nuovo dice che recensioni non ce ne sono', () => {
    expect(negozioNuovo).toEqual({ valore: NON_LETTO, nota: 'Nessuna recensione', guasto: false });
  });

  it('col negozio recensito mostra il voto e quante sono', () => {
    expect(negozioConRecensioni).toEqual({ valore: '4,5 ★', nota: '12 recensioni', guasto: false });
  });

  it('con la lettura fallita AMMETTE, e non somiglia al negozio nuovo', () => {
    // È il cuore del difetto: erano la stessa schermata.
    expect(letturaFallita.guasto).toBe(true);
    expect(letturaFallita.nota).toBe('Non sono riuscito a leggerlo');
    expect(
      letturaFallita.nota,
      'Il guasto e il negozio senza recensioni tornano a dire la stessa cosa: è il difetto di partenza.',
    ).not.toBe(negozioNuovo.nota);
  });
});

describe('la targhetta degli articoli venduti', () => {
  const nessunaVendita = targhettaArticoli({ letta: true, quanti: 0, troncato: false });
  const letturaFallita = targhettaArticoli({ letta: false, quanti: 0, troncato: false });

  it('con zero vendite dice zero, e da quando', () => {
    expect(nessunaVendita).toEqual({ valore: '0', nota: 'Ultimi 30 giorni', guasto: false });
  });

  it('col tetto delle righe toccato il numero è un «almeno»', () => {
    expect(targhettaArticoli({ letta: true, quanti: 1000, troncato: true })).toEqual({
      valore: '1000+',
      nota: 'Ultimi 30 giorni · almeno',
      guasto: false,
    });
  });

  it('con la lettura fallita non scrive zero', () => {
    expect(letturaFallita.valore).toBe(NON_LETTO);
    expect(letturaFallita.guasto).toBe(true);
    expect(
      letturaFallita.valore,
      'Uno zero su una lettura mai riuscita è un\'affermazione su una domanda mai fatta.',
    ).not.toBe(nessunaVendita.valore);
  });
});

describe('la targhetta dei prodotti in vendita', () => {
  it('mostra quanti sono in vendita su quanti in tutto', () => {
    expect(targhettaProdotti({ letta: true, disponibili: 7, totali: 12 })).toEqual({
      valore: '7',
      nota: 'su 12 totali',
      guasto: false,
    });
  });

  it('con la lettura fallita non scrive «0 su 0»', () => {
    const rotta = targhettaProdotti({ letta: false, disponibili: 0, totali: 0 });
    expect(rotta.valore).toBe(NON_LETTO);
    expect(rotta.guasto).toBe(true);
    expect(rotta.nota).not.toBe('su 0 totali');
  });
});

describe('l\'avviso che la pagina mette in cima', () => {
  it('quando è andato tutto bene non c\'è', () => {
    expect(avvisoLettureFallite([])).toBeNull();
  });

  it('nomina in italiano quello che non ha potuto leggere', () => {
    expect(avvisoLettureFallite(['recensioni'])!.titolo).toBe('Non sono riuscito a leggere le recensioni.');
    expect(avvisoLettureFallite(['righe', 'recensioni'])!.titolo).toBe(
      'Non sono riuscito a leggere gli articoli venduti e le recensioni.',
    );
  });

  it('e dice che il dato non manca: manca lo sguardo', () => {
    expect(avvisoLettureFallite(['righe'])!.dettaglio).toMatch(/non l'ho potuto guardare/);
  });

  it('l\'elenco si legge come lo direbbe una persona', () => {
    expect(elenco([])).toBe('');
    expect(elenco(['uno'])).toBe('uno');
    expect(elenco(['uno', 'due'])).toBe('uno e due');
    expect(elenco(['uno', 'due', 'tre'])).toBe('uno, due e tre');
  });
});

/**
 * Rete di sicurezza, non la prova: le prove vere sono quelle sopra, che la
 * decisione la ESEGUONO. Qui si controlla solo che la pagina continui a
 * chiamarla, invece di essersi rifatta i suoi rami per conto suo.
 */
describe('e la pagina continua a delegare la decisione', () => {
  const pagina = readFileSync(join(process.cwd(), 'app/seller/dashboard/page.tsx'), 'utf8');

  it('chiama le funzioni pure invece di decidere da sé', () => {
    for (const nome of ['letturaRiuscita', 'lettureFallite', 'targhettaValutazione', 'targhettaArticoli', 'targhettaProdotti', 'avvisoLettureFallite']) {
      expect(pagina, `la pagina non chiama più ${nome}`).toContain(nome);
    }
  });

  it('non torna a buttare via l\'errore dei conteggi destrutturandoli', () => {
    expect(
      pagina,
      'La destrutturazione `{ count: … }` perde il campo `error`: è così che il difetto era nato.',
    ).not.toMatch(/\[\s*\{\s*count:/);
  });

  it('e non si riscrive «Nessuna recensione» dentro il disegno', () => {
    // Quella frase deve nascere in un posto solo, dove una prova la esegue.
    expect(pagina).not.toContain('Nessuna recensione');
  });
});

/**
 * E ADESSO SULLO SCHERMO VERO.
 *
 * Le prove qui sopra eseguono la decisione; questa monta la pagina del
 * cruscotto per davvero, con React e il DOM, e legge quello che ci finisce
 * dentro. È l'unico modo di dimostrare che la pagina la decisione la USA,
 * invece di essersi rifatta i suoi rami per conto suo.
 *
 * Quello che questa prova NON copre, e va detto: il dato arriva già pronto
 * (`__DATI_QUERY__`), quindi non passa dalla lettura vera del database. Che i
 * `letta:` siano calcolati dalle risposte di Supabase lo tiene la rete di
 * sicurezza sul sorgente, non questa.
 */
/** Un negozio che va bene e di cui abbiamo letto tutto: il punto di partenza. */
const cruscottoCon = (scostamenti: ScostamentiDelCruscotto = {}) =>
  apriIlCruscotto(statisticheDelCruscotto({
    netto: { netto: '\u20ac435,00', incassato: '\u20ac600,00' },
    prodotti: { disponibili: 9, totali: 12 },
    valutazione: { media: 4.6, quante: 8 },
    articoli: { quanti: 34 },
    revenueToday: 43.5, revenue7: 187.2, revenue30: 435,
    ordiniOggi: 3, ordini7: 11, ordini30: 34,
    ...scostamenti,
  }));

describe('e sullo schermo vero le due risposte non si somigliano', () => {
  afterEach(chiudiIlCruscotto);

  it('col negozio nuovo la pagina dice che recensioni non ce ne sono', async () => {
    cruscottoCon({
      valutazione: { media: 0, quante: 0 },
      articoli: { quanti: 0 },
    });
    const mod = await monta('app/seller/dashboard/page.tsx');
    const s = accendi(mod.default as ComponentType);
    const testo = s.radice.textContent ?? '';

    expect(testo).toContain('Nessuna recensione');
    expect(testo, 'un negozio nuovo non è un guasto').not.toContain('Non sono riuscito');
    s.smonta();
  }, 120000);

  it('con le recensioni non lette la pagina lo AMMETTE, e offre di riprovare', async () => {
    cruscottoCon({
      valutazione: { letta: false, media: 0, quante: 0 },
      avviso: avvisoLettureFallite(['recensioni']),
    });
    const mod = await monta('app/seller/dashboard/page.tsx');
    const s = accendi(mod.default as ComponentType);
    const testo = s.radice.textContent ?? '';

    expect(
      testo,
      'La targhetta deve ammettere il guasto: prima scriveva la stessa cosa di un negozio senza recensioni.',
    ).toContain('Non sono riuscito a leggerlo');
    expect(testo, 'Con la lettura fallita questa frase è una bugia').not.toContain('Nessuna recensione');
    expect(testo).toContain('Non sono riuscito a leggere le recensioni');

    // E un modo di riprovare, che prima non c'era da nessuna parte: senza,
    // al negoziante resta solo ricaricare la pagina a mano.
    const riprova = [...s.radice.querySelectorAll('button')].find((b) => /riprova/i.test(b.textContent ?? ''));
    expect(riprova, 'nessun pulsante per riprovare la lettura').toBeTruthy();

    // Il trattino non lo deve leggere ad alta voce nessuno: non dice niente.
    const trattini = [...s.radice.querySelectorAll('p')].filter((el) => el.textContent?.trim() === NON_LETTO);
    expect(trattini.length, 'la targhetta col trattino non c\'è più').toBeGreaterThan(0);
    for (const t of trattini) expect(t.getAttribute('aria-hidden')).toBe('true');
    s.smonta();
  }, 120000);

  it('e l\'avviso è annunciato a chi non guarda lo schermo', async () => {
    cruscottoCon({ avviso: avvisoLettureFallite(['righe', 'recensioni']) });
    const mod = await monta('app/seller/dashboard/page.tsx');
    const s = accendi(mod.default as ComponentType);
    const avviso = s.radice.querySelector('[role="status"]');
    expect(avviso, 'l\'avviso non è annunciato: chi usa un lettore di schermo non lo sente arrivare').toBeTruthy();
    expect(avviso!.textContent).toContain('gli articoli venduti e le recensioni');
    s.smonta();
  }, 120000);
});
