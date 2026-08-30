import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { numeriDellAndamento } from '@/lib/seller/andamento-negozio';

/**
 * 27/8/2026 (R071) — «ANDAMENTO» SCARICAVA VENTIMILA RIGHE PER MOSTRARE TRE
 * NUMERI.
 *
 * Le visite ai prodotti degli ultimi trenta giorni venivano portate tutte nel
 * browser — mille righe per volta, venti richieste una dietro l'altra, fino a
 * un tetto duro di ventimila — e poi contate in JavaScript. Un negozio con
 * ventimila visite in un mese, cioè un negozio che sta andando bene, apriva la
 * pagina e il telefono ci metteva decine di secondi. Oltre le ventimila il
 * conteggio si fermava e sbagliava per difetto, senza dirlo. Nella stessa
 * lettura le recensioni si fermavano a mille, in silenzio.
 *
 * Adesso conta il database e torna una riga sola. Che i numeri siano quelli
 * veri anche sopra le ventimila visite lo ESEGUE
 * tests/sql/rls/22-i-conti-del-venditore-non-si-fermano-a-mille.test.sql, con
 * 25.000 visite seminate. Qui si prova la lettura di quella riga.
 */

describe('la riga di andamento che arriva dal database', () => {
  it('i numeri arrivano interi anche quando il database li manda come testo', () => {
    // I `bigint` e i `numeric` di Postgres arrivano spesso come stringhe: senza
    // conversione «25040» + 0 fa «250400», e il tasso di conversione impazzisce.
    const numeri = numeriDellAndamento({
      viste_30: '25040',
      viste_7: '600',
      viste_oggi: '12',
      viste_per_prodotto: { 'prod-1': 25000, 'prod-2': '40' },
      voto_medio: '4.50',
      recensioni: '3',
    });
    expect(numeri.views30).toBe(25040);
    expect(numeri.views7).toBe(600);
    expect(numeri.viewsToday).toBe(12);
    expect(numeri.avgRating).toBe(4.5);
    expect(numeri.reviewCount).toBe(3);
    expect(numeri.viewsByProduct['prod-2'], 'le visite per prodotto restano testo e non si sommano').toBe(40);
  });

  it('un negozio senza visite legge zero, non «non lo so»', () => {
    const numeri = numeriDellAndamento({
      viste_30: 0, viste_7: 0, viste_oggi: 0, viste_per_prodotto: {}, voto_medio: null, recensioni: 0,
    });
    expect(numeri.views30).toBe(0);
    expect(numeri.avgRating, 'senza recensioni il voto medio deve essere zero, non «non un numero»').toBe(0);
    expect(numeri.viewsByProduct).toEqual({});
  });

  it('se la riga non arriva, i numeri restano a zero invece di rompere la pagina', () => {
    const numeri = numeriDellAndamento(null);
    expect(numeri.views30).toBe(0);
    expect(numeri.viewsByProduct).toEqual({});
    expect(numeri.reviewCount).toBe(0);
  });

  it('le visite per prodotto sommate fanno il totale di trenta giorni', () => {
    const numeri = numeriDellAndamento({
      viste_30: 140, viste_7: 20, viste_oggi: 2,
      viste_per_prodotto: { a: 100, b: 40 },
      voto_medio: 5, recensioni: 1,
    });
    const somma = Object.values(numeri.viewsByProduct).reduce((s, n) => s + n, 0);
    expect(somma, 'il grafico dei prodotti piu visti e il totale in alto raccontano cose diverse').toBe(
      numeri.views30,
    );
  });
});

/** Il freno strutturale: la pagina non torna a tirarsi giù le righe una a una. */
describe('la pagina Andamento non scarica piu le visite riga per riga', () => {
  const pagina = () => readFileSync('app/seller/analytics/page.tsx', 'utf8');

  it('non legge piu la tabella delle visite dal browser', () => {
    expect(
      pagina().includes("from('product_views')"),
      'la pagina si riporta ancora in casa tutte le visite del mese',
    ).toBe(false);
    expect(
      pagina().includes('leggiTutteLeRighe'),
      'la pagina chiede ancora finestre da mille righe una dietro l altra',
    ).toBe(false);
  });

  it('non legge piu le recensioni senza limite', () => {
    expect(
      pagina().includes("from('reviews')"),
      'le recensioni si leggono ancora tutte, e sopra le mille si fermano in silenzio',
    ).toBe(false);
  });

  it('chiede il conto al database', () => {
    expect(pagina().includes('andamento_del_negozio'), 'il conto lo fa ancora il browser').toBe(true);
    expect(pagina().includes('numeriDellAndamento('), 'la riga si legge a mano invece che dal posto condiviso').toBe(true);
  });
});
