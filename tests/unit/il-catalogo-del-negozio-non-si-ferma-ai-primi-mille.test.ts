import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  finestraDellaPagina,
  cEUnAltraPagina,
  pagineSuccessiva,
  unisciPagine,
  RIGHE_PER_PAGINA,
} from '@/lib/paginazione';

/**
 * 27/8/2026 (R070, R080) — DUE ELENCHI CHE SI FERMAVANO A MILLE SENZA DIRLO, E
 * UN «CARICA ALTRI» CHE RISCARICAVA ANCHE QUELLO CHE AVEVI GIÀ.
 *
 * L'elenco dei prodotti del venditore non aveva nessun limite. PostgREST ne
 * manda al massimo mille quando nessuno chiede niente: un alimentari o una
 * ferramenta — proprio i negozi che a MyCity servono — vedevano i primi mille
 * articoli e non lo sapevano.
 *
 * E dove il «carica altri» c'era, allargava la finestra invece di spostarla:
 * cento righe, poi duecento (di cui cento già in memoria), poi trecento. Alla
 * quarta pressione si erano scaricate mille righe per mostrarne quattrocento,
 * e ogni pressione era più lenta della precedente.
 *
 * Adesso la finestra si sposta: ogni pagina chiede le sue righe e basta.
 */

describe('la finestra di una pagina', () => {
  it('la prima pagina chiede le prime cento righe', () => {
    expect(finestraDellaPagina(0)).toEqual([0, 99]);
  });

  it('la seconda pagina comincia dove finisce la prima, senza sovrapporsi', () => {
    const [, fine1] = finestraDellaPagina(0);
    const [inizio2] = finestraDellaPagina(1);
    expect(inizio2, 'la seconda pressione riscarica righe che il browser ha gia').toBe(fine1 + 1);
  });

  it('ogni pagina pesa uguale: la quarta non scarica quattrocento righe', () => {
    // È il difetto vero: la finestra cresceva col numero di pressioni.
    for (const pagina of [0, 1, 2, 3, 10]) {
      const [da, a] = finestraDellaPagina(pagina);
      expect(a - da + 1, `la pagina ${pagina} chiede piu righe delle altre`).toBe(RIGHE_PER_PAGINA);
    }
  });

  it('quattro pressioni scaricano quattrocento righe, non mille', () => {
    let totale = 0;
    for (const pagina of [0, 1, 2, 3]) {
      const [da, a] = finestraDellaPagina(pagina);
      totale += a - da + 1;
    }
    expect(totale, 'il traffico cresce col quadrato delle pressioni: lo paga chi guarda').toBe(400);
  });

  it('una dimensione diversa cambia la finestra, non la regola', () => {
    expect(finestraDellaPagina(2, 50)).toEqual([100, 149]);
  });

  it('una pagina negativa non chiede righe negative', () => {
    expect(finestraDellaPagina(-3)).toEqual([0, 99]);
  });
});

describe('mettere insieme le pagine gia lette', () => {
  it('un ordine arrivato mentre si sfoglia non fa comparire due volte la stessa riga', () => {
    // La finestra si sposta per posizione: se una riga nuova entra in cima, la
    // pagina dopo ripesca l'ultima di quella prima.
    const pagina1 = [{ id: 'a' }, { id: 'b' }];
    const pagina2 = [{ id: 'b' }, { id: 'c' }];
    expect(unisciPagine([pagina1, pagina2]).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('senza doppioni tiene tutto, nell ordine in cui e arrivato', () => {
    expect(unisciPagine([[{ id: 'a' }], [{ id: 'b' }], [{ id: 'c' }]]).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('nessuna pagina letta vuol dire nessuna riga', () => {
    expect(unisciPagine([])).toEqual([]);
  });
});

describe('quando smettere di chiedere', () => {
  it('se la pagina torna piena ce ne sono altre', () => {
    expect(cEUnAltraPagina(100)).toBe(true);
    expect(pagineSuccessiva(100, 1)).toBe(1);
  });

  it('se ne tornano meno di quante chieste, quella era l ultima', () => {
    expect(cEUnAltraPagina(37)).toBe(false);
    expect(pagineSuccessiva(37, 1), 'il pulsante «carica altri» resta li a chiedere il vuoto').toBeUndefined();
  });

  it('un catalogo vuoto non chiede una seconda pagina', () => {
    expect(pagineSuccessiva(0, 1)).toBeUndefined();
  });
});

/**
 * Il freno strutturale sulle due pagine che avevano il difetto. Le letture
 * paginate devono usare `.range()` e un ordinamento deterministico: con il solo
 * `created_at DESC`, su una tabella che riceve inserimenti, fra una pagina e
 * l'altra si saltano o si ripetono righe.
 */
describe('le pagine dell area venditore chiedono una finestra per volta', () => {
  const pagine = ['app/seller/products/page.tsx', 'app/seller/orders/page.tsx'];

  it('tutte e due usano una finestra che si sposta', () => {
    for (const p of pagine) {
      const testo = readFileSync(p, 'utf8');
      expect(testo.includes('.range('), `${p} non chiede una finestra: legge tutto o allarga il tetto`).toBe(true);
      expect(testo.includes('finestraDellaPagina('), `${p} si calcola la finestra per conto suo`).toBe(true);
    }
  });

  it('nessuna delle due alza un tetto crescente', () => {
    for (const p of pagine) {
      const testo = readFileSync(p, 'utf8');
      expect(
        /\.limit\(\s*limite\s*\)/.test(testo),
        `${p} allarga ancora il tetto a ogni pressione, e riscarica quello che hai gia`,
      ).toBe(false);
    }
  });

  it('l ordinamento della pagina prodotti e deterministico', () => {
    const testo = readFileSync('app/seller/products/page.tsx', 'utf8').replace(/\s+/g, ' ');
    expect(
      testo.includes(".order('id'"),
      'senza un secondo criterio d ordine, fra una pagina e l altra si saltano o si ripetono prodotti',
    ).toBe(true);
  });
});

/**
 * E il conto dei «venduti» non si fa più scaricando le righe d'ordine: lo fa il
 * database. Che il numero sia quello vero anche sopra le mille righe lo ESEGUE
 * tests/sql/rls/22-i-conti-del-venditore-non-si-fermano-a-mille.test.sql.
 */
describe('il conto dei venduti non passa piu dal browser', () => {
  it('la pagina prodotti non scarica piu le righe d ordine', () => {
    const testo = readFileSync('app/seller/products/page.tsx', 'utf8');
    expect(
      testo.includes("from('order_items')"),
      'la colonna «Venduti» somma ancora nel browser ogni riga d ordine consegnata del negozio',
    ).toBe(false);
    expect(testo.includes('venduti_per_prodotto'), 'il conto non lo fa il database').toBe(true);
  });
});
