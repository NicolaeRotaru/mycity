/** @vitest-environment jsdom */
/**
 * «IL TUO NETTO» POTEVA VALERE SEMPRE O TRENTA GIORNI, E NON LO DICEVA.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────
 * Sul cruscotto del venditore ci sono quattro targhette in fila. Quella degli
 * articoli venduti dichiara il suo periodo — «Ultimi 30 giorni» — perché il 6/9
 * gliel'hanno fatto dichiarare. Quella di fianco, «Il tuo netto», scriveva solo
 * «su €1.234,00 incassati».
 *
 * Non era una dimenticanza di stile. Quel numero lo somma il database con
 * `numeri_del_negozio`, e sono i totali DALL'INIZIO; ma se quella funzione non
 * risponde, o risponde senza dire niente dei rimborsi, il cruscotto ripiega sul
 * conto che il browser sa fare — e il browser legge solo gli ULTIMI TRENTA
 * GIORNI. Stessa targhetta, stessa scritta, due grandezze diverse. Il
 * negoziante confronta il numero di lunedì con quello di martedì senza sapere
 * che nel frattempo è cambiato il metro.
 *
 * E oggi il ripiego non è il caso raro: è il caso normale. La funzione nel
 * database `rimborsi_totali_cents` non lo espone (migrazione 126), quindi il
 * cancello resta chiuso sempre. Il riquadro diceva un totale di trenta giorni
 * con l'aria di dire il totale di sempre.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────
 * Che la finestra esce insieme al numero, dalla stessa funzione che sceglie il
 * numero — così non c'è modo di mostrarne uno senza l'altra — e che le due
 * finestre a schermo NON si somigliano. Il conto e la scelta si eseguono qui;
 * l'ultima prova apre la migrazione vera e verifica che la finestra dichiarata
 * corrisponda a quello che il database sa fare oggi.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import {
  etichettaFinestra,
  finestraDeiTotali,
  totaliDiSempre,
  type FinestraTotali,
  type NumeriDalDatabase,
} from '@/lib/metriche-venditore';
import { targhettaArticoli, targhettaNetto } from '@/lib/letture-cruscotto';
import {
  apriIlCruscotto, chiudiIlCruscotto, statisticheDelCruscotto,
} from './aiuti/cruscotto-del-negozio';

/** Il conto che il browser sa fare da solo: trenta giorni, e li sa tutti. */
const RIPIEGO = { incassatoCents: 6_000, tuoNettoCents: 4_350 };

/** Il database che risponde e sa dei rimborsi: allora i suoi totali valgono. */
const DATABASE_COMPLETO: NumeriDalDatabase = {
  incasso_totale_cents: 92_000,
  commissione_totale_cents: 8_500,
  non_del_negozio_cents: 8_000,
  rimborsi_totali_cents: 8_000,
};

/** Il database di oggi: risponde, ma dei rimborsi non dice niente. */
const DATABASE_CIECO: NumeriDalDatabase = {
  incasso_totale_cents: 100_000,
  commissione_totale_cents: 8_500,
  non_del_negozio_cents: 8_000,
};

describe('la finestra la decide chi decide il numero', () => {
  it('senza risposta dal database si copre solo quello che ha letto il browser', () => {
    expect(finestraDeiTotali(null)).toBe('ultimi-30-giorni');
    expect(finestraDeiTotali(undefined)).toBe('ultimi-30-giorni');
  });

  it('con una risposta cieca sui rimborsi, idem', () => {
    expect(finestraDeiTotali(DATABASE_CIECO)).toBe('ultimi-30-giorni');
  });

  it('solo quando il database sa dei rimborsi si parla di «dall\'inizio»', () => {
    expect(finestraDeiTotali(DATABASE_COMPLETO)).toBe('dall-inizio');
  });

  it('e i totali escono con la loro finestra attaccata, non separata', () => {
    // È il punto: chi ha in mano il numero ha in mano anche il suo periodo.
    // Prima erano due cose distinte, e la seconda non esisteva proprio.
    expect(totaliDiSempre(DATABASE_CIECO, RIPIEGO)).toEqual({ ...RIPIEGO, finestra: 'ultimi-30-giorni' });
    expect(totaliDiSempre(DATABASE_COMPLETO, RIPIEGO)).toEqual({
      incassatoCents: 92_000,
      tuoNettoCents: 75_500,
      finestra: 'dall-inizio',
    });
  });
});

describe('e a schermo le due finestre non si somigliano', () => {
  const dallInizio = targhettaNetto({ netto: '€750,00', incassato: '€920,00', finestra: 'dall-inizio' });
  const trentaGiorni = targhettaNetto({ netto: '€43,50', incassato: '€60,00', finestra: 'ultimi-30-giorni' });

  it('la riga sotto il numero dice sempre che periodo copre', () => {
    expect(dallInizio.nota).toBe('su €920,00 incassati · dall’inizio');
    expect(trentaGiorni.nota).toBe('su €60,00 incassati · ultimi 30 giorni');
  });

  it('due periodi diversi non possono più avere la stessa scritta', () => {
    expect(
      dallInizio.nota,
      'Se le due note tornano a coincidere, il negoziante confronta due grandezze diverse credendole la stessa.',
    ).not.toBe(trentaGiorni.nota);
  });

  it('e usa le stesse parole della targhetta accanto', () => {
    // «Articoli venduti» dice «Ultimi 30 giorni». Due modi di dire lo stesso
    // periodo, uno accanto all'altro, sarebbero due periodi per chi legge.
    const accanto = targhettaArticoli({ letta: true, quanti: 12, troncato: false }).nota;
    expect(trentaGiorni.nota.toLowerCase()).toContain(accanto.toLowerCase());
  });

  it('l\'etichetta è italiano, non una sigla', () => {
    expect(etichettaFinestra('dall-inizio')).toBe('dall’inizio');
    expect(etichettaFinestra('ultimi-30-giorni')).toBe('ultimi 30 giorni');
  });
});

describe('e la finestra dichiarata è quella vera, oggi', () => {
  /** L'ultima definizione della funzione, cercata nelle migrazioni vere. */
  const corpoDellaFunzione = (() => {
    const cartella = join(process.cwd(), 'migrations');
    const file = readdirSync(cartella)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .reverse()
      .find((f) => readFileSync(join(cartella, f), 'utf8').includes('FUNCTION public.numeri_del_negozio'));
    expect(file, 'non trovo più la funzione numeri_del_negozio: questa prova va riscritta').toBeTruthy();
    return readFileSync(join(cartella, file!), 'utf8');
  })();

  it('la funzione del database non espone ancora i rimborsi', () => {
    expect(corpoDellaFunzione).not.toContain('rimborsi_totali_cents');
  });

  it('quindi oggi la targhetta dice «ultimi 30 giorni», e lo dice davvero', () => {
    // Il cerchio si chiude qui: stato vero del database → finestra scelta dal
    // codice → parole scritte a schermo. Il giorno in cui la migrazione insegna
    // i rimborsi alla funzione, la prima prova diventa rossa e questa va
    // aggiornata: è il promemoria, non un fastidio.
    const rispostaDiOggi: NumeriDalDatabase = corpoDellaFunzione.includes('rimborsi_totali_cents')
      ? DATABASE_COMPLETO
      : DATABASE_CIECO;
    const totali = totaliDiSempre(rispostaDiOggi, RIPIEGO);
    expect(totali.finestra).toBe('ultimi-30-giorni');
    expect(targhettaNetto({ netto: '€43,50', incassato: '€60,00', finestra: totali.finestra }).nota).toContain(
      'ultimi 30 giorni',
    );
  });
});

/**
 * E ADESSO SULLO SCHERMO VERO: la finestra deve arrivare fino agli occhi del
 * negoziante, non fermarsi dentro una funzione.
 */
describe('sul cruscotto montato la finestra si legge davvero', () => {
  afterEach(chiudiIlCruscotto);

  async function schermoCon(finestra: FinestraTotali) {
    apriIlCruscotto(statisticheDelCruscotto({
      netto: { netto: '\u20ac435,00', incassato: '\u20ac600,00', finestra },
      prodotti: { disponibili: 9, totali: 12 },
      valutazione: { media: 4.6, quante: 8 },
      articoli: { quanti: 34 },
      revenueToday: 43.5, revenue7: 187.2, revenue30: 435,
      ordiniOggi: 3, ordini7: 11, ordini30: 34,
    }));
    const mod = await monta('app/seller/dashboard/page.tsx');
    return accendi(mod.default as ComponentType);
  }

  it('col ripiego a trenta giorni la pagina lo scrive, accanto al numero', async () => {
    const s = await schermoCon('ultimi-30-giorni');
    const testo = s.radice.textContent ?? '';
    expect(testo).toContain('Il tuo netto');
    expect(
      testo,
      'Il numero è di trenta giorni e la pagina non lo dice: è il difetto di partenza.',
    ).toContain('su €600,00 incassati · ultimi 30 giorni');
    s.smonta();
  }, 120000);

  it('e coi totali del database scrive «dall\u2019inizio», che è un\'altra cosa', async () => {
    const s = await schermoCon('dall-inizio');
    const testo = s.radice.textContent ?? '';
    expect(testo).toContain('su €600,00 incassati · dall\u2019inizio');
    expect(testo).not.toContain('incassati · ultimi 30 giorni');
    s.smonta();
  }, 120000);
});
