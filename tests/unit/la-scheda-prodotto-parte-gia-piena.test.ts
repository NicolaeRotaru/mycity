import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, hydrate } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';
import { domandaProdotto, domandaCategorie } from '@/lib/queries/catalogo';

/**
 * 30/8/2026 (R068) — LA HOME E LA SCHEDA PRODOTTO ARRIVAVANO VUOTE NELL'HTML.
 *
 * Le due pagine che fanno vendere non contenevano niente: il documento che il
 * telefono riceveva era un guscio, e tutto il contenuto se lo andava a prendere
 * il browser DOPO aver scaricato ed eseguito il JavaScript. La catena fino alla
 * prima immagine era: scarica il codice → eseguilo → chiedi i dati → chiedi la
 * foto. Su un telefono in 4G sono secondi di pagina bianca.
 *
 * Il conto misurato il 30/8: `HydrationBoundary`, `dehydrate`, `prefetchQuery`,
 * `initialData` — nessuna di queste quattro parole compariva da nessuna parte
 * nel progetto. Nessun precaricamento lato server, in nessuna pagina.
 *
 * IL PUNTO DELICATO, e il motivo per cui questa prova esiste: perche' il lavoro
 * del server serva a qualcosa, la domanda che fa lui e quella che fa il browser
 * devono essere LA STESSA — stessa chiave di cache, stessa forma della
 * risposta. Se differiscono anche solo di una lettera nella chiave, il browser
 * non riconosce quello che ha in mano e va in rete lo stesso: il precarico
 * diventa un viaggio in piu' invece di uno in meno, e nessuno se ne accorge
 * perche' la pagina funziona uguale.
 *
 * Qui si fa girare il precarico vero e poi si fa la domanda come la farebbe il
 * browser, con un database che ESPLODE se qualcuno lo chiama.
 */

const PRODOTTO = {
  id: 'prod-1',
  name: 'Coppa piacentina DOP',
  description: 'Stagionata sei mesi',
  price: 18.5,
  images: ['coppa.jpg'],
  seller_id: 'negozio-1',
  status: 'available',
  created_at: '2026-08-01T10:00:00Z',
  category_id: 'cat-1',
  stock: 4,
  attributes: {},
  unit: 'pz',
  compare_at_price: null,
  condition: null,
  express_enabled: true,
  has_variants: false,
  external_source_url: null,
  categories: { slug: 'alimentari', name: 'Alimentari' },
  profiles: { id: 'negozio-1', store_name: 'Pane Quotidiano', is_approved: true, offers_express: true, store_hours: null },
};

const CATEGORIE = [
  { id: 'c2', slug: 'casa', name: 'Casa', icon: null, sort_order: 2, featured: false },
  { id: 'c1', slug: 'alimentari', name: 'Alimentari', icon: null, sort_order: 1, featured: true },
];

/** Il client di lettura del server: risponde, e conta quante volte lo chiamano. */
const letture: string[] = [];
let clienteRotto = false;

vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => {
    if (clienteRotto) throw new Error('variabili di configurazione mancanti');
    return {
      from: (tabella: string) => {
        letture.push(tabella);
        const risposta = tabella === 'products'
          ? { data: PRODOTTO, error: null }
          : { data: CATEGORIE, error: null };
        const catena: Record<string, unknown> = {
          select: () => catena,
          eq: () => catena,
          is: async () => risposta,
          maybeSingle: async () => risposta,
        };
        return catena;
      },
    };
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

/** Un database che non deve essere chiamato: se lo chiamano, la prova lo dice. */
const databaseCheEsplode = {
  from: () => {
    throw new Error('il browser e andato in rete: il precarico del server non e servito a niente');
  },
};

/** Un browser come quello vero: stessa cache, stesso mezzo minuto di freschezza. */
function browser() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 30 * 1000, retry: false } } });
}

beforeEach(() => {
  letture.length = 0;
  clienteRotto = false;
});

describe('la scheda prodotto', () => {
  it('arriva al browser gia piena: la pagina non chiede piu niente al database', async () => {
    const { precaricaProdotto } = await import('@/lib/queries/precarico');
    const statoDalServer = await precaricaProdotto('prod-1');

    // Il browser riceve la pagina e ripristina quello che il server gli ha mandato.
    const qc = browser();
    hydrate(qc, statoDalServer);

    // Poi fa la SUA domanda, quella scritta dentro il componente. Se la chiave
    // non coincidesse, qui partirebbe una lettura vera — e il database esplode.
    const prodotto = await qc.fetchQuery(domandaProdotto(databaseCheEsplode, 'prod-1'));

    expect(prodotto, 'la scheda non e arrivata dentro la pagina').not.toBeNull();
    expect(prodotto!.name).toBe('Coppa piacentina DOP');
    expect(prodotto!.profiles?.store_name).toBe('Pane Quotidiano');
  });

  it('la mette sotto la chiave esatta che usa la pagina, non una simile', () => {
    expect(domandaProdotto(databaseCheEsplode, 'prod-1').queryKey)
      .toEqual(queryKeys.products.detail('prod-1'));
  });

  it('il guscio della pagina consegna davvero il precarico', () => {
    // Un precarico che nessuno consegna e' lavoro fatto e buttato: e' esattamente
    // la forma del difetto di partenza.
    const src = readFileSync(join(process.cwd(), 'app/product/[id]/layout.tsx'), 'utf8');
    expect(src).toContain('precaricaProdotto');
    expect(src).toContain('HydrationBoundary');
  });
});

describe('la home', () => {
  it('porta le categorie dentro l HTML, in ordine gia sistemato', async () => {
    const { precaricaHome } = await import('@/lib/queries/precarico');
    const qc = browser();
    hydrate(qc, await precaricaHome());

    const categorie = await qc.fetchQuery(domandaCategorie(databaseCheEsplode));

    expect(
      categorie.map((c) => c.slug),
      'le categorie sono la prima cosa che si vede scorrendo, e arrivavano dopo due viaggi di rete',
    ).toEqual(['alimentari', 'casa']);
  });

  it('la home consegna davvero il precarico', () => {
    const src = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8');
    expect(src).toContain('precaricaHome');
    expect(src).toContain('HydrationBoundary');
  });
});

describe('quando il precarico non riesce', () => {
  it('la pagina si apre lo stesso, e il browser fa quello che faceva prima', async () => {
    // Un precarico e' un'ottimizzazione, non un requisito: una pagina che non si
    // apre perche' il server non ha potuto leggere sarebbe molto peggio del
    // problema che questo risolve.
    clienteRotto = true;
    const { precaricaProdotto } = await import('@/lib/queries/precarico');

    const stato = await precaricaProdotto('prod-1');

    expect(stato, 'il precarico ha lanciato: la pagina non si aprirebbe').toBeTruthy();
    expect(stato.queries, 'senza dati il precarico deve essere vuoto, non inventato').toHaveLength(0);
    expect(letture, 'con la configurazione rotta non si tenta nemmeno la lettura').toEqual([]);
  });
});
