/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 6/9/2026 — QUANDO NON RIESCE A LEGGERE LE IMPOSTAZIONI DEL NEGOZIO, IL MODULO
 * PRODOTTO DECIDEVA DA SOLO CHE LA CONSEGNA VELOCE NON C'ERA.
 *
 * La pagina di modifica prodotto legge dal profilo se il negozio offre la
 * consegna veloce. Il valore di ripiego era `false` e nessuno guardava se la
 * lettura fosse riuscita: con la rete lenta, o la sessione non ancora pronta,
 * il negoziante che la consegna veloce ce l'ha si vedeva scritto «attivala dal
 * profilo negozio» — una cosa che aveva già fatto.
 *
 * Il guaio vero però è al salvataggio. Un prodotto che eredita la consegna
 * veloce dal negozio (`express_enabled` a NULL) usciva da quel modulo con un
 * «no» scritto sopra, e restava fuori dalla consegna veloce anche dopo che la
 * rete era tornata. Il negoziante entrava per cambiare il prezzo e perdeva un
 * vantaggio commerciale, senza vedere niente.
 */

const ID_PRODOTTO = '11111111-1111-1111-1111-111111111111';

/**
 * I pezzi dell'indirizzo arrivano già risolti: `use()` su una promessa sospende
 * il primo giro di disegno, e qui non c'è nessun `Suspense` che lo raccolga.
 * Il finto di React lascia passare intatto quello che promessa non è.
 */
const INDIRIZZO = { params: { id: ID_PRODOTTO } };

/** Il prodotto che EREDITA la consegna dal negozio: `express_enabled` a NULL. */
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

/** La query del profilo negozio, riconosciuta dalla sua chiave. */
function eLaLetturaDellaConsegna(opzioni: { queryKey?: readonly unknown[] }): boolean {
  return (opzioni?.queryKey ?? []).some((p) => p === 'offers-express');
}

function testoAVideo(radice: HTMLElement): string {
  return (radice.textContent ?? '').replace(/\s+/g, ' ');
}

/**
 * La prova non vale niente se il modulo non è a video: senza questo, un errore
 * di caricamento farebbe passare gli assert scritti al negativo.
 */
function ilModuloEDavveroAVideo(testo: string): void {
  expect(testo, 'il modulo prodotto non e a video: la prova sotto passerebbe a vuoto').toContain(
    'Consegna veloce',
  );
  expect(testo).toContain('Modifica prodotto');
}

describe('la pagina di modifica prodotto e le impostazioni di consegna del negozio', () => {
  beforeEach(() => {
    globali.__DATI_QUERY__ = (opzioni: { queryKey?: readonly unknown[] }) => {
      if (eLaLetturaDellaConsegna(opzioni)) return true; // il negozio l'ha attiva
      const chiave = (opzioni?.queryKey ?? []) as unknown[];
      if (chiave.includes('variants')) return [];
      if (chiave.some((p) => p === 'form')) return [{ id: 'cat-1', name: 'Dolci', slug: 'dolci', parent_id: null }];
      return PRODOTTO_CHE_EREDITA;
    };
    globali.__ESITO_QUERY__ = undefined;
  });

  afterEach(() => {
    delete globali.__DATI_QUERY__;
    delete globali.__ESITO_QUERY__;
  });

  it('IL CASO CHE ROMPEVA — lettura fallita: lo dice, invece di dare la colpa al negoziante', async () => {
    globali.__ESITO_QUERY__ = (opzioni: { queryKey?: readonly unknown[] }) =>
      eLaLetturaDellaConsegna(opzioni)
        ? { data: undefined, isError: true, isSuccess: false, error: new Error('rete giu') }
        : undefined;

    const mod = await monta('app/seller/products/[id]/edit/page.tsx');
    const s = accendi(mod.default, INDIRIZZO);
    const testo = testoAVideo(s.radice);
    ilModuloEDavveroAVideo(testo);

    expect(
      testo,
      'a un negoziante che la consegna veloce ce l ha, il modulo diceva di andare ad attivarla: la lettura era fallita e nessuno lo diceva',
    ).not.toContain('attivalo dal');
    expect(
      testo,
      'la lettura e fallita e il modulo non lo dice: chi salva ora scrive un no definitivo sul prodotto',
    ).toContain('Non riesco a leggere le impostazioni di consegna');

    s.smonta();
  });


  it("IL CASO CHE ROMPEVA — il prodotto ha la consegna veloce: il modulo diceva al negoziante di andare ad attivarla", async () => {
    // Questo prodotto la consegna veloce ce l'ha scritta sopra (`express_enabled` true).
    globali.__DATI_QUERY__ = (opzioni: { queryKey?: readonly unknown[] }) => {
      if (eLaLetturaDellaConsegna(opzioni)) return true;
      const chiave = (opzioni?.queryKey ?? []) as unknown[];
      if (chiave.includes('variants')) return [];
      if (chiave.some((p) => p === 'form')) return [{ id: 'cat-1', name: 'Dolci', slug: 'dolci', parent_id: null }];
      return { ...PRODOTTO_CHE_EREDITA, express_enabled: true };
    };
    globali.__ESITO_QUERY__ = (opzioni: { queryKey?: readonly unknown[] }) =>
      eLaLetturaDellaConsegna(opzioni)
        ? { data: undefined, isError: true, isSuccess: false, error: new Error('rete giu') }
        : undefined;

    const mod = await monta('app/seller/products/[id]/edit/page.tsx');
    const s = accendi(mod.default, INDIRIZZO);
    const testo = testoAVideo(s.radice);
    ilModuloEDavveroAVideo(testo);

    expect(
      testo,
      'la lettura del profilo e fallita, e il modulo dice al negoziante di attivare una cosa che ha gia attiva',
    ).not.toContain('attivalo dal');
    expect(testo).toContain('Non riesco a leggere le impostazioni di consegna');

    s.smonta();
  });

  it('lettura riuscita: nessun avviso fuori posto, il negozio ha la consegna veloce', async () => {
    const mod = await monta('app/seller/products/[id]/edit/page.tsx');
    const s = accendi(mod.default, INDIRIZZO);
    const testo = testoAVideo(s.radice);
    ilModuloEDavveroAVideo(testo);

    expect(testo).not.toContain('Non riesco a leggere le impostazioni di consegna');
    expect(testo).not.toContain('attivalo dal');

    s.smonta();
  });
});
