import { describe, it, expect } from 'vitest';
import {
  raccogliOrdiniDaEsportare,
  contenutoCsvOrdini,
  righeCsvOrdini,
  nomeFileOrdini,
  INTESTAZIONI_CSV_ORDINI,
  type OrdineDaEsportare,
} from '@/lib/ordini/esporta-ordini';

/**
 * IL FILE PER IL COMMERCIALISTA NON CONTIENE PIU' SOLO GLI ULTIMI CINQUANTA
 * ORDINI (radiografia 6/9/2026).
 *
 * La pagina /admin/orders ne carica cinquanta per volta. «Esporta CSV» scriveva
 * nel file quello che era gia' a schermo: senza premere «Carica altri 50», il
 * file aveva cinquanta righe e non lo diceva da nessuna parte. Le somme del
 * commercialista uscivano sbagliate per difetto, senza un segnale.
 *
 * Qui il database e' finto ma la lettura e' vera: la funzione viene ESEGUITA
 * con 137 ordini e si conta cosa esce nel file. E si prova anche il caso in cui
 * NON si arriva in fondo: allora il file deve dichiararsi parziale, in prima
 * riga e nel nome. Un file monco che sembra intero e' il difetto, non la
 * lunghezza.
 */

function ordineFinto(n: number): OrdineDaEsportare {
  return {
    id: `ordine-${String(n).padStart(4, '0')}`,
    created_at: `2026-09-08T10:00:${String(n % 60).padStart(2, '0')}Z`,
    delivery_full_name: `Cliente ${n}`,
    delivery_city: 'Piacenza',
    delivery_status: 'DELIVERED',
    total_price: 10 + n,
    seller: { store_name: 'Pane Quotidiano' },
    rider: { full_name: 'Rider Uno' },
  };
}

/**
 * Un database finto con `quanti` ordini e una finestra `.range(da, a)` vera.
 * `tettoDelServer` imita `max-rows` di PostgREST: il server puo' restituire
 * meno righe di quante gliene sono state chieste.
 */
function databaseCon(quanti: number, tettoDelServer = Infinity) {
  const tutti = Array.from({ length: quanti }, (_, i) => ordineFinto(i));
  const finestre: Array<[number, number]> = [];
  return {
    tutti,
    finestre,
    leggi: async (da: number, a: number) => {
      finestre.push([da, a]);
      return tutti.slice(da, a + 1).slice(0, tettoDelServer);
    },
  };
}

/** Le righe del file, dal testo vero, senza BOM e senza righe vuote in coda. */
function righeDelFile(testo: string): string[] {
  return testo.replace(/^\uFEFF/, '').split('\n');
}

describe('l esportazione legge tutti gli ordini, non la pagina a schermo', () => {
  it('con 137 ordini e finestre da 50 nel file ce ne sono 137, non 50', async () => {
    const db = databaseCon(137);
    const raccolta = await raccogliOrdiniDaEsportare(db.leggi, { perLettura: 50 });

    expect(raccolta.righe).toHaveLength(137);
    expect(raccolta.completo).toBe(true);
    expect(db.finestre.slice(0, 3)).toEqual([[0, 49], [50, 99], [100, 149]]);

    const righe = righeDelFile(contenutoCsvOrdini(raccolta));
    expect(righe).toHaveLength(1 + 137); // intestazioni + ordini
    expect(righe[0]).toContain('Negozio');
    expect(righe).not.toHaveLength(1 + 50);
  });

  it('quando gli ordini sono un multiplo esatto della finestra non ne perde e non si ferma prima', async () => {
    const db = databaseCon(100);
    const raccolta = await raccogliOrdiniDaEsportare(db.leggi, { perLettura: 50 });

    expect(raccolta.righe).toHaveLength(100);
    expect(raccolta.completo).toBe(true);
    expect(raccolta.letture).toBe(3); // la terza torna vuota: e' cosi' che si sa che sono finiti
  });

  it('se il server ne restituisce meno di quanti gliene chiediamo, non crede che siano finiti', async () => {
    // PostgREST ha un tetto di righe per richiesta (`max-rows`). Se e' piu'
    // basso della finestra, la prima lettura torna corta: fermarsi li' vuol
    // dire rifare il file monco che sembra intero, con un altro nome.
    const db = databaseCon(70, 30);
    const raccolta = await raccogliOrdiniDaEsportare(db.leggi, { perLettura: 50 });

    expect(raccolta.righe).toHaveLength(70);
    expect(raccolta.completo).toBe(true);
    expect(db.finestre).toEqual([[0, 49], [30, 79], [60, 109], [70, 119]]);
  });

  it('non conta due volte l ordine che scivola fra una finestra e l altra', async () => {
    // Mentre si sfoglia entra un ordine nuovo in cima: la seconda finestra
    // ripesca l'ultima riga della prima. Nel file sarebbe una somma gonfiata.
    let letture = 0;
    const leggi = async (da: number, _a: number) => {
      letture++;
      if (da === 0) return [ordineFinto(1), ordineFinto(2)];
      if (letture === 2) return [ordineFinto(2), ordineFinto(3)]; // il 2 torna
      return [];
    };
    const raccolta = await raccogliOrdiniDaEsportare(leggi, { perLettura: 2 });

    const identificativi = raccolta.righe.map((o) => o.id);
    expect(new Set(identificativi).size).toBe(identificativi.length);
    expect(identificativi).toEqual(['ordine-0001', 'ordine-0002', 'ordine-0003']);
  });

  it('l elenco vuoto resta vuoto e completo', async () => {
    const raccolta = await raccogliOrdiniDaEsportare(databaseCon(0).leggi, { perLettura: 50 });
    expect(raccolta.righe).toHaveLength(0);
    expect(raccolta.completo).toBe(true);
  });
});

describe('un file parziale non puo sembrare completo', () => {
  it('se il tetto di letture arriva prima della fine, l elenco si dichiara incompleto', async () => {
    const db = databaseCon(137);
    const raccolta = await raccogliOrdiniDaEsportare(db.leggi, { perLettura: 50, tettoLetture: 2 });

    expect(raccolta.completo).toBe(false);
    expect(raccolta.motivo).toBe('tetto');
    expect(raccolta.righe).toHaveLength(100);
  });

  it('l avviso sta in PRIMA riga del file, prima delle intestazioni', async () => {
    const db = databaseCon(137);
    const raccolta = await raccogliOrdiniDaEsportare(db.leggi, { perLettura: 50, tettoLetture: 2 });
    const righe = righeDelFile(contenutoCsvOrdini(raccolta));

    expect(righe[0]).toContain('ATTENZIONE');
    expect(righe[0]).toContain('INCOMPLETO');
    expect(righe[0]).toContain('100');
    expect(righe[0]).not.toContain('Negozio');            // non e' l'intestazione
    expect(righe[2]).toContain(INTESTAZIONI_CSV_ORDINI[4]); // le intestazioni vengono dopo
    expect(righe).toHaveLength(2 + 1 + 100);
  });

  it('il file completo NON porta l avviso: l allarme non diventa rumore di fondo', async () => {
    const raccolta = await raccogliOrdiniDaEsportare(databaseCon(7).leggi, { perLettura: 50 });
    const righe = righeCsvOrdini(raccolta);
    expect(righe[0]).toEqual([...INTESTAZIONI_CSV_ORDINI]);
    expect(contenutoCsvOrdini(raccolta)).not.toContain('ATTENZIONE');
  });

  it('anche il nome del file lo dice, e dice pure che filtro era attivo', () => {
    expect(nomeFileOrdini({ oggi: '2026-09-08', completo: true }))
      .toBe('mycity-ordini-2026-09-08.csv');
    expect(nomeFileOrdini({ oggi: '2026-09-08', completo: false }))
      .toBe('mycity-ordini-2026-09-08-PARZIALE.csv');
    expect(nomeFileOrdini({ oggi: '2026-09-08', completo: true, filtro: 'all' }))
      .toBe('mycity-ordini-2026-09-08.csv');
    expect(nomeFileOrdini({ oggi: '2026-09-08', completo: true, filtro: 'OUT_FOR_DELIVERY' }))
      .toBe('mycity-ordini-2026-09-08-out-for-delivery.csv');
    expect(nomeFileOrdini({ oggi: '2026-09-08', completo: false, filtro: 'CANCELED' }))
      .toBe('mycity-ordini-2026-09-08-canceled-PARZIALE.csv');
  });
});
