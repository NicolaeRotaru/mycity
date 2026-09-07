/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 6/9/2026 — STESSA DOMANDA, STESSA RIGA DI CACHE, DUE FUNZIONI DIVERSE.
 *
 * «Nuovo prodotto» e «Modifica prodotto» chiedono al profilo la stessa cosa: il
 * negozio offre la consegna veloce? La chiedevano sotto la stessa riga di cache
 * — `['seller','profile','offers-express']` — ma con due funzioni scritte a
 * mano, una per pagina. Una delle due, davanti alla sessione non ancora pronta,
 * rispondeva «no» senza segnalare niente. Siccome la riga di cache è una sola,
 * quel «no» arrivava all'altra pagina già confezionato come buono: al
 * negoziante che la consegna veloce ce l'ha da mesi ricompariva il consiglio di
 * andare ad attivarla, e il riquadro che avvisa del guasto non compariva.
 * Il difetto dichiarato chiuso era vivo, a un clic di distanza.
 *
 * Questa prova non cerca parole nei file: monta le due pagine per davvero e
 * confronta la funzione che ognuna passa alla lettura. Diventa rossa il giorno
 * in cui qualcuno riscrive la seconda copia.
 */

const ID_PRODOTTO = '11111111-1111-1111-1111-111111111111';
const INDIRIZZO_MODIFICA = { params: { id: ID_PRODOTTO } };

const PRODOTTO_CHE_EREDITA = {
  id: ID_PRODOTTO,
  seller_id: 'seller-1',
  name: 'Torta di compleanno',
  description: 'Pan di spagna, crema e fragole fresche di stagione.',
  price: 24,
  compare_at_price: null,
  unit: 'pezzo',
  condition: null,
  stock: 3,
  category_id: 'cat-1',
  images: ['https://mycity.test/torta.jpg'],
  attributes: {},
  tags: [],
  express_enabled: null,
  status: 'available',
};

const globali = globalThis as Record<string, unknown>;

type OpzioniQuery = { queryKey?: readonly unknown[]; queryFn?: unknown };

function eLaLetturaDellaConsegna(o: OpzioniQuery): boolean {
  return (o?.queryKey ?? []).some((p) => p === 'offers-express');
}

/** Come ogni pagina ha chiesto «il negozio offre la consegna veloce?». */
type Domanda = { chiave: readonly unknown[]; funzione: unknown };

/**
 * Monta una pagina e registra la domanda che fa sulla consegna del negozio.
 * `letturaCaduta` mette la rete a terra su quella sola lettura.
 */
async function domandaDellaPagina(
  file: string,
  proprieta: Record<string, unknown>,
  letturaCaduta: boolean,
): Promise<{ domanda: Domanda | null; testo: string; smonta: () => void }> {
  let domanda: Domanda | null = null;
  globali.__DATI_QUERY__ = (o: OpzioniQuery) => {
    if (eLaLetturaDellaConsegna(o)) {
      domanda = { chiave: o.queryKey ?? [], funzione: o.queryFn };
      return true; // il negozio la consegna veloce ce l'ha
    }
    const chiave = (o?.queryKey ?? []) as unknown[];
    if (chiave.includes('variants')) return [];
    if (chiave.some((p) => p === 'form')) return [{ id: 'cat-1', name: 'Dolci', slug: 'dolci', parent_id: null }];
    return PRODOTTO_CHE_EREDITA;
  };
  globali.__ESITO_QUERY__ = letturaCaduta
    ? (o: OpzioniQuery) =>
        eLaLetturaDellaConsegna(o)
          ? { data: undefined, isError: true, isSuccess: false, error: new Error('rete giu') }
          : undefined
    : undefined;

  const mod = await monta(file);
  const s = accendi(mod.default, proprieta);
  const testo = (s.radice.textContent ?? '').replace(/\s+/g, ' ');
  return { domanda, testo, smonta: s.smonta };
}

const NUOVO = 'app/seller/products/new/page.tsx';
const MODIFICA = 'app/seller/products/[id]/edit/page.tsx';

describe('le due pagine del prodotto e la consegna veloce del negozio', () => {
  beforeEach(() => {
    globali.__QUERY_FINTA__ = '';
  });

  afterEach(() => {
    delete globali.__DATI_QUERY__;
    delete globali.__ESITO_QUERY__;
    delete globali.__QUERY_FINTA__;
  });

  it('IL CASO CHE ROMPEVA — stessa riga di cache: allora deve essere la stessa funzione', async () => {
    const nuovo = await domandaDellaPagina(NUOVO, {}, false);
    const modifica = await domandaDellaPagina(MODIFICA, INDIRIZZO_MODIFICA, false);

    expect(nuovo.domanda, 'la pagina «Nuovo prodotto» non ha chiesto niente sulla consegna del negozio').not.toBeNull();
    expect(modifica.domanda, 'la pagina «Modifica prodotto» non ha chiesto niente sulla consegna del negozio').not.toBeNull();

    expect(
      nuovo.domanda!.chiave,
      'le due pagine non condividono più la riga di cache: se cambia una, cambiale entrambe',
    ).toEqual(modifica.domanda!.chiave);

    expect(
      String(nuovo.domanda!.funzione),
      'le due pagine chiedono la stessa cosa sotto la stessa riga di cache, ma con due funzioni diverse: la risposta di una arriva all altra, e una delle due è sbagliata',
    ).toBe(String(modifica.domanda!.funzione));

    nuovo.smonta();
    modifica.smonta();
  });

  it('IL CASO CHE ROMPEVA — lettura caduta: tutte e due lo dicono, nessuna delle due dà la colpa al negoziante', async () => {
    const nuovo = await domandaDellaPagina(NUOVO, {}, true);
    const modifica = await domandaDellaPagina(MODIFICA, INDIRIZZO_MODIFICA, true);

    for (const [dove, pagina] of [['Nuovo prodotto', nuovo], ['Modifica prodotto', modifica]] as const) {
      expect(pagina.testo, `il modulo prodotto non è a video in «${dove}»: la prova girerebbe a vuoto`).toContain(
        'Tempo di consegna',
      );
      expect(
        pagina.testo,
        `«${dove}» non dice che la lettura è caduta: chi salva ora crede a un valore indovinato`,
      ).toContain('Non riesco a leggere le impostazioni di consegna');
      expect(
        pagina.testo,
        `«${dove}» dice al negoziante di attivare una cosa che ha già attiva: la lettura era caduta, non era un no`,
      ).not.toContain('attivalo dal');
    }

    nuovo.smonta();
    modifica.smonta();
  });
});
