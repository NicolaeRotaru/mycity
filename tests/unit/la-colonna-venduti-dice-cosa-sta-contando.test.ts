/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 6/9/2026 — DUE PAROLE «VENDUTI», TRE SIGNIFICATI, A UN CLIC DI DISTANZA.
 *
 * Il cruscotto ha imparato a dire la sua finestra: «Articoli venduti — Ultimi
 * 30 giorni». L'elenco prodotti, un clic più in là, ha una colonna che si
 * chiama «Venduti» e conta tutt'altro: da sempre invece che trenta giorni,
 * pezzi consegnati invece di ordini ricevuti. Il negoziante somma la colonna,
 * confronta col cruscotto, e trova due numeri che non tornano — senza che
 * nessuna delle due schermate gliene dica il motivo.
 *
 * Il numero non si tocca (farlo coincidere è una migrazione, cioè una firma).
 * Quello che questa prova pretende è che la schermata dica cosa sta contando.
 */

const globali = globalThis as Record<string, unknown>;

const PRODOTTO = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Torta di compleanno',
  price: 24,
  stock: 3,
  status: 'available',
  images: ['https://mycity.test/torta.jpg'],
  created_at: '2026-08-01T09:00:00.000Z',
  category_id: 'cat-1',
  has_variants: false,
};

/**
 * L'elenco prodotti arriva a finestre: ogni pagina è `{ righe, totale }`. Il
 * finto di react-query serve il dato come pagina unica e lo avvolge in un
 * elenco, quindi la pagina che gli si consegna deve essere un elenco che porta
 * addosso quei due campi.
 */
function unaPaginaSola(righe: Record<string, unknown>[]): unknown {
  return Object.assign([...righe], { righe, totale: righe.length });
}

function testoAVideo(radice: HTMLElement): string {
  return (radice.textContent ?? '').replace(/\s+/g, ' ');
}

describe('l elenco prodotti del venditore e la colonna «Venduti»', () => {
  beforeEach(() => {
    globali.__DATI_QUERY__ = (o: { queryKey?: readonly unknown[] }) => {
      const chiave = (o?.queryKey ?? []) as unknown[];
      // I venduti per prodotto: la mappa che riempie la colonna.
      if (chiave.some((p) => p === 'venduti')) return { [PRODOTTO.id]: 12 };
      return unaPaginaSola([PRODOTTO]);
    };
  });

  afterEach(() => {
    delete globali.__DATI_QUERY__;
  });

  it('IL CASO CHE ROMPEVA — la colonna dice la finestra che conta, e in cosa è diversa dal cruscotto', async () => {
    const mod = await monta('app/seller/products/page.tsx');
    const s = accendi(mod.default, {});
    const testo = testoAVideo(s.radice);

    expect(testo, 'l elenco prodotti non è a video: la prova girerebbe a vuoto').toContain(
      PRODOTTO.name,
    );
    expect(testo, 'il numero dei venduti non è a video: la prova girerebbe a vuoto').toContain('12');

    expect(
      testo,
      'la colonna «Venduti» non dice la finestra che sta contando: il negoziante la somma e la confronta con i trenta giorni del cruscotto',
    ).toMatch(/Venduti da sempre/);

    expect(
      testo,
      'la schermata non nomina la finestra del cruscotto: il negoziante confronta due numeri senza sapere che guardano periodi diversi',
    ).toMatch(/ultimi 30 giorni/i);
    expect(
      testo,
      'la schermata non dice che i due numeri non tornano uguali: due parole «venduti» su due grandezze diverse, e nessuna spiegazione',
    ).toContain('non coincidono');

    s.smonta();
  });
});
