import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  letturaDellAndamento,
  tassoDiConversione,
  numeroOTrattino,
} from '@/app/seller/analytics/letture-dell-andamento';

/**
 * 3/9/2026 — LA PAGINA «ANALISI» SPEGNEVA ANCHE I SOLDI PER UNA FUNZIONE MANCANTE.
 *
 * In produzione `andamento_del_negozio` — la funzione del database che conta le
 * visite e il voto medio, migrazione 141 — non c'è. PostgREST risponde
 * «Could not find the function», e la pagina buttava insieme i due errori
 * (`andamentoRes.error ?? ordersRes.error`): una sola schermata di guasto, con
 * dentro anche il fatturato, che era stato letto benissimo.
 *
 * Il negoziante apre i suoi numeri, non vede niente, e quella è la pagina con
 * cui decide se fidarsi di noi.
 *
 * Le due letture pesano diverso. Senza ORDINI non c'è pagina. Senza VISITE c'è
 * ancora quasi tutto, e quello che manca si scrive «—»: mai zero, perché uno
 * zero qui si legge «nessuno guarda i tuoi prodotti» — sulla stessa schermata
 * che poi consiglia di scontarli.
 */

/** L'errore vero che torna oggi dalla produzione, parola per parola. */
const FUNZIONE_ASSENTE = {
  code: 'PGRST202',
  message: 'Could not find the function public.andamento_del_negozio without parameters in the schema cache',
};

describe('quando una sola delle due letture non riesce', () => {
  it('manca il conto delle visite: la pagina resta in piedi e dichiara il buco', () => {
    const esito = letturaDellAndamento(null, FUNZIONE_ASSENTE);

    expect(
      esito.fermati,
      'per una funzione mancante il negoziante perde di vista anche il suo fatturato',
    ).toBe(false);
    expect(esito.visiteIgnote, 'le visite mancanti passano per zero: una bugia').toBe(true);
  });

  it('mancano gli ordini: qui non si finge niente, la pagina si ferma', () => {
    const rete = new Error('rete');
    const esito = letturaDellAndamento(rete, null);

    expect(esito.fermati).toBe(true);
    expect(esito.errore, 'l\'errore vero si perde per strada').toBe(rete);
  });

  it('quando cade tutto si ferma, e comanda l errore degli ordini', () => {
    const rete = new Error('rete');
    const esito = letturaDellAndamento(rete, FUNZIONE_ASSENTE);
    expect(esito.fermati).toBe(true);
    expect(esito.errore).toBe(rete);
  });

  it('letture riuscite: niente da dichiarare', () => {
    const esito = letturaDellAndamento(null, null);
    expect(esito).toEqual({ fermati: false, errore: null, visiteIgnote: false });
  });
});

describe('il tasso di conversione non si inventa', () => {
  it('senza il conto delle visite non c e tasso: trattino, non «0,0%»', () => {
    expect(tassoDiConversione(12, null), 'dodici ordini diventano «0,0% di conversione»').toBeNull();
    expect(numeroOTrattino(null)).toBe('—');
  });

  it('zero visite MISURATE e ordini veri: nemmeno li si divide', () => {
    // Le visite si contano solo su chi accetta i cookie: zero visite misurate
    // con tre ordini in cassa non vuol dire che nessuno converte.
    expect(tassoDiConversione(3, 0)).toBeNull();
  });

  it('con i due numeri veri, il conto è quello', () => {
    expect(tassoDiConversione(4, 200)).toBe(2);
    expect(numeroOTrattino(200)).toBe('200');
  });
});

describe('la pagina Analisi tiene separate le due letture', () => {
  const pagina = readFileSync(join(process.cwd(), 'app/seller/analytics/page.tsx'), 'utf8');

  it('gli ordini fermano la pagina, le visite no: l ordine dei due non si inverte', () => {
    expect(
      /letturaDellAndamento\(\s*ordersRes\.error\s*,\s*andamentoRes\.error\s*\)/.test(pagina),
      'i due errori sono tornati invertiti o rimessi insieme: una funzione mancante spegne di nuovo il fatturato',
    ).toBe(true);
    expect(
      pagina.includes('andamentoRes.error ?? ordersRes.error'),
      'i due errori sono di nuovo buttati insieme',
    ).toBe(false);
  });

  it('senza le visite i numeri che ne dipendono valgono «non lo so», non zero', () => {
    for (const campo of ['views30', 'views7', 'viewsToday', 'avgRating', 'reviewCount']) {
      expect(
        new RegExp(`const ${campo} = visiteIgnote \\? null :`).test(pagina),
        `«${campo}» torna a valere zero quando non lo sappiamo`,
      ).toBe(true);
    }
    expect(
      /const slowProducts = visiteIgnote \? \[\] :/.test(pagina),
      'senza visite la pagina torna a dire al negoziante quali prodotti «vendono poco», contandoli tutti a zero',
    ).toBe(true);
  });
});
