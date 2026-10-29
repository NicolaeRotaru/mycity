/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * 28/10/2026 — LA PAGINA DI MODIFICA, FINO AL DATABASE.
 *
 * Il collaudo ha lasciato la pagina «Modifica prodotto» passare le scorte viste
 * al salvataggio e poi le ha buttate un passo dopo, dentro il salvataggio stesso
 * (`saveProductVariantsServer(supabase, id, nextVariants, undefined)`): ogni
 * variante tornava riscritta col numero letto all'apertura, e nessuna prova è
 * diventata rossa. Le prove guardavano cosa la pagina CHIEDEVA di salvare, non
 * cosa arrivava al database: il finto di react-query non esegue `mutationFn`.
 *
 * Qui il salvataggio gira davvero, fino alla tabella delle varianti. Il fornaio
 * apre la focaccia con due taglie: S con 2 pezzi, M con 3. Mentre la scheda è
 * aperta un cliente compra una S, e nel database ne resta 1. Lui cambia solo il
 * prezzo e salva. Dopo il salvataggio la S deve restare a 1: se torna a 2, in
 * vetrina c'è una focaccia che non esiste.
 */

type Opzioni = { mutationFn?: (variabili: unknown) => Promise<unknown> };

vi.mock('@tanstack/react-query', async () => {
  const finto = await import('./aiuti/finti/react-query.mjs');
  return {
    ...finto,
    // Come il finto di sempre, ma il salvataggio parte davvero: la prova aspetta
    // la sua corsa in `__CORSE__` e ne legge l'errore, se c'è.
    useMutation: (opzioni: Opzioni) => {
      const esegui = (variabili: unknown) => {
        const corsa = Promise.resolve()
          .then(() => opzioni.mutationFn?.(variabili))
          .then(
            () => null,
            (errore: unknown) => errore,
          );
        const corse = (globalThis as Record<string, unknown>).__CORSE__;
        if (Array.isArray(corse)) corse.push(corsa);
        return corsa;
      };
      return {
        mutate: (variabili: unknown) => {
          void esegui(variabili);
        },
        mutateAsync: esegui,
        isPending: false,
        isError: false,
        error: null,
      };
    },
  };
});

const globali = globalThis as Record<string, unknown>;
const ID = 'prod-focaccia';
const CATEGORIE = [{ id: 'cat-1', name: 'Panetteria', slug: 'panetteria', parent_id: null }];
/** Le varianti come le ha lette il modulo all'apertura. */
const VARIANTI_VISTE = [
  { id: 'v-s', options: { Taglia: 'S' }, label: 'S', stock: 2 },
  { id: 'v-m', options: { Taglia: 'M' }, label: 'M', stock: 3 },
];
const PRODOTTO = {
  id: ID,
  seller_id: 'seller-1',
  name: 'Focaccia genovese',
  description: 'Focaccia con olio extravergine, cotta nel forno a legna.',
  price: 4,
  compare_at_price: null,
  unit: 'pezzo',
  condition: null,
  stock: 5,
  category_id: 'cat-1',
  images: ['https://mycity.test/focaccia.jpg'],
  attributes: {},
  tags: [],
  express_enabled: true,
  status: 'available',
};

/** La tabella delle varianti com'è ADESSO: una S è stata venduta dopo l'apertura. */
function tabellaDelleVarianti() {
  const righe = new Map<string, Record<string, unknown>>([
    ['v-s', { id: 'v-s', product_id: ID, label: 'S', stock: 1 }],
    ['v-m', { id: 'v-m', product_id: ID, label: 'M', stock: 3 }],
  ]);
  const aggiornamenti: Array<{ id: string; riga: Record<string, unknown> }> = [];
  const client = {
    from: (tavola: string) => {
      expect(tavola, 'il salvataggio scrive su una tavola che la prova non conosce').toBe('product_variants');
      return {
        select: () => ({
          eq: async (_colonna: string, prodotto: string) => ({
            data: [...righe.values()].filter((r) => r.product_id === prodotto).map((r) => ({ id: r.id })),
            error: null,
          }),
        }),
        update: (riga: Record<string, unknown>) => ({
          eq: async (_colonna: string, id: string) => {
            aggiornamenti.push({ id, riga });
            righe.set(id, { ...righe.get(id), ...riga });
            return { error: null };
          },
        }),
        delete: () => ({
          in: async (_colonna: string, ids: string[]) => {
            ids.forEach((id) => righe.delete(id));
            return { error: null };
          },
        }),
        insert: async () => ({ error: null }),
      };
    },
  };
  return { client, righe, aggiornamenti };
}

function scrivi(campo: HTMLInputElement | HTMLTextAreaElement, valore: string): void {
  const proto = campo instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(campo, valore);
  campo.dispatchEvent(new window.Event('input', { bubbles: true }));
}

describe('la pagina di modifica salva le varianti senza rimettere in magazzino il venduto', () => {
  let fetchVera: typeof globalThis.fetch;
  const chiamate: Array<{ indirizzo: string; corpo: Record<string, unknown> }> = [];

  beforeEach(() => {
    chiamate.length = 0;
    globali.__CORSE__ = [];
    globali.__UTENTE__ = { id: 'seller-1' };
    globali.__GETTONE__ = 'gettone-della-prova';
    globali.__DATI_QUERY__ = (opzioni: { queryKey?: readonly unknown[] }) => {
      const chiave = (opzioni?.queryKey ?? []) as unknown[];
      if (chiave.some((p) => p === 'offers-express')) return true;
      if (chiave.includes('variants')) return VARIANTI_VISTE;
      if (chiave.some((p) => p === 'form')) return CATEGORIE;
      return PRODOTTO;
    };
    fetchVera = globalThis.fetch;
    // La porta del prodotto (`PATCH /api/seller/products/:id`) risponde «fatto».
    globalThis.fetch = (async (indirizzo: string, init?: { body?: string }) => {
      chiamate.push({ indirizzo: String(indirizzo), corpo: JSON.parse(init?.body ?? '{}') });
      return { ok: true, json: async () => ({ ok: true, data: { campi: ['price'] } }) };
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetchVera;
    for (const k of ['__CORSE__', '__UTENTE__', '__GETTONE__', '__DATI_QUERY__', '__CLIENT_SUPABASE__']) delete globali[k];
  });

  it('IL CASO CHE ROMPEVA — tocca solo il prezzo: la S venduta nel frattempo resta a 1, non torna a 2', async () => {
    const { client, righe, aggiornamenti } = tabellaDelleVarianti();
    globali.__CLIENT_SUPABASE__ = client;

    const mod = await monta('app/seller/products/[id]/edit/page.tsx', { veri: ['@tanstack/react-query'] });
    const s = accendi(mod.default, { params: { id: ID } });
    expect((s.radice.textContent ?? '').replace(/\s+/g, ' '), 'la pagina non è a video').toContain('Salva modifiche');

    const prezzo = s.radice.querySelector('[name="price"]') as HTMLInputElement | null;
    expect(prezzo, 'il campo del prezzo non è a video: la prova girerebbe a vuoto').not.toBeNull();
    s.agisci(() => scrivi(prezzo as HTMLInputElement, '5'));
    const pulsante = Array.from(s.radice.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Salva modifiche'),
    );
    expect(pulsante, 'il pulsante «Salva modifiche» non è a video').toBeTruthy();
    s.agisci(() => clicca(pulsante as HTMLButtonElement));
    await attendi();
    await attendi();

    const corse = globali.__CORSE__ as Array<Promise<unknown>>;
    expect(corse, 'il salvataggio non è partito: la prova girerebbe a vuoto').toHaveLength(1);
    const esiti = await Promise.all(corse);
    expect(esiti[0], 'il salvataggio è caduto prima di arrivare alle varianti').toBeNull();

    // Il prezzo è passato dalla porta del prodotto, senza la scorta vista all'apertura.
    expect(chiamate).toHaveLength(1);
    expect(chiamate[0].indirizzo).toBe(`/api/seller/products/${ID}`);
    const payload = chiamate[0].corpo.payload as Record<string, unknown>;
    expect(Number(payload.price)).toBe(5);
    expect('stock' in payload, 'la pagina rimanda la scorta del prodotto vista all\'apertura').toBe(false);

    // Le varianti sono state davvero salvate (etichette e posizioni)...
    expect(aggiornamenti.map((a) => a.id).sort(), 'le varianti non sono arrivate al database').toEqual(['v-m', 'v-s']);
    // ...ma la scorta che il negoziante non ha toccato resta quella vera.
    expect(
      righe.get('v-s')?.stock,
      'la S venduta mentre la scheda era aperta torna in magazzino: in vetrina c\'è una focaccia che non esiste',
    ).toBe(1);
    expect(righe.get('v-m')?.stock).toBe(3);
    expect(aggiornamenti.some((a) => 'stock' in a.riga), 'una scorta non toccata viene riscritta').toBe(false);
    s.smonta();
  });
});
