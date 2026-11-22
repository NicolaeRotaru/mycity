/**
 * 22/11/2026 — UNA VISITA DELLA SCHEDA LEGGE IL PRODOTTO UNA VOLTA SOLA.
 *
 * In una richiesta Next esegue `generateMetadata` e il guscio (layout). Tutti e due volevano la
 * riga del prodotto (e del suo negozio): i metadati con la loro lettura, il guscio col precarico,
 * con altre colonne. Il collaudo ha contato, con il precarico vero, `products` 2 volte e
 * `seller_public_profiles` 2 volte sulla scheda, e `seller_public_profiles` 3 volte sulla vetrina.
 *
 * Qui gira il precarico VERO (lib/queries/precarico.ts), con un client Supabase finto che conta le
 * letture per tabella, dentro UNA richiesta: metadati e guscio insieme, come li chiama Next.
 *
 * La memoria per richiesta è `cache()` di React. Nel progetto c'è il React 18, dove `cache` non
 * esiste: lì ogni chiamata leggerebbe da capo e la prova non direbbe niente. Allora qui `react` è
 * il React dei componenti del server che Next usa davvero per queste pagine
 * (`next/dist/compiled/react/react.react-server.js`, il 19, col suo `cache` vero), e la richiesta è
 * un ambito esplicito: lo stesso «dispatcher» che il renderer del server di React installa per
 * ogni richiesta (una mappa per richiesta, `getCacheForType`), scritto qui in sei righe e tolto a
 * fine richiesta. Fuori da quell'ambito `cache` di React non memorizza niente, come nel server vero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react', async () => {
  // Il percorso sta in una variabile perché il pacchetto non ne pubblica i tipi.
  const reactDelServer = 'next/dist/compiled/react/react.react-server.js';
  const modulo = (await import(/* @vite-ignore */ reactDelServer)) as Record<string, unknown>;
  const R = (modulo.default ?? modulo) as Record<string, unknown>;
  return { ...R, default: R };
});

const conta = vi.hoisted(() => ({ letture: {} as Record<string, number>, guastoSuiProdotti: false }));

/** La vista pubblica dei negozi con le colonne di produzione e quelle della 126. */
const COLONNE_DELLA_VISTA = new Set([
  'id', 'store_name', 'store_address', 'store_lat', 'store_lng', 'store_phone', 'store_logo', 'store_hours',
  'store_media', 'store_description', 'store_customization', 'store_site', 'offers_express', 'founded_year',
  'is_approved', 'stripe_charges_enabled', 'stripe_payouts_enabled', 'role', 'created_at',
  'business_legal_name', 'business_form', 'business_vat_number', 'business_address', 'business_city', 'business_zip',
]);

const NEGOZIO: Record<string, unknown> = {
  id: 'n1', store_name: 'Forno Rossi', store_address: 'Via Roma 1, Piacenza', store_lat: 45.05, store_lng: 9.7,
  store_phone: '0523 000000', store_logo: 'logo.png', store_hours: null, store_media: null,
  store_description: 'Forno a legna', store_customization: null, store_site: null, offers_express: false,
  founded_year: 1952, is_approved: true, stripe_charges_enabled: true, stripe_payouts_enabled: true,
  role: 'seller', created_at: '2026-01-01', business_legal_name: 'Forno Rossi S.r.l.', business_form: 'S.r.l.',
  business_vat_number: '01234567890', business_address: 'Via Roma 1', business_city: 'Piacenza', business_zip: '29121',
};

const PRODOTTO: Record<string, unknown> = {
  id: 'p1', name: 'Coppa piacentina', description: 'Stagionata 6 mesi', price: 18.5, images: ['coppa.jpg'],
  seller_id: 'n1', status: 'available', created_at: '2026-11-01', category_id: 'c1', stock: 3, attributes: null,
  tags: [], unit: null, compare_at_price: null, condition: null, express_enabled: false, has_variants: false,
  external_source_url: null, categories: { slug: 'alimentari', name: 'Alimentari' },
};

/** Un client che conta le letture per tabella e risponde come PostgREST (colonne chieste, 42703 se ne manca una). */
function clienteCheConta() {
  return {
    rpc: async () => {
      conta.letture.rpc = (conta.letture.rpc ?? 0) + 1;
      return { data: [], error: null };
    },
    from: (tabella: string) => {
      let colonne = '*';
      const rispondi = async () => {
        conta.letture[tabella] = (conta.letture[tabella] ?? 0) + 1;
        if (tabella === 'products') {
          if (conta.guastoSuiProdotti) return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
          return { data: PRODOTTO, error: null };
        }
        if (tabella === 'seller_public_profiles') {
          const chieste = colonne.split(',').map((c) => c.trim()).filter(Boolean);
          const manca = chieste.find((c) => !COLONNE_DELLA_VISTA.has(c));
          if (manca) return { data: null, error: { code: '42703', message: `column seller_public_profiles.${manca} does not exist` } };
          return { data: Object.fromEntries(chieste.map((c) => [c, NEGOZIO[c]])), error: null };
        }
        return { data: null, error: null };
      };
      const q: Record<string, unknown> = {
        select: (c: string) => {
          colonne = c;
          return q;
        },
        eq: () => q,
        maybeSingle: rispondi,
        single: rispondi,
      };
      return q;
    },
  };
}

vi.mock('@/lib/supabase/anonimo', () => ({ creaClientAnonimo: () => clienteCheConta() }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => clienteCheConta() }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const React = (await import('react')) as unknown as {
  __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { A: unknown };
};
const { dimenticaLettureDeiMetadati } = await import('@/lib/supabase/lettura-per-metadati');
const { dimenticaLaVistaSenza126 } = await import('@/lib/queries/venduto-da');
const prodotto = await import('@/app/product/[id]/layout');
const negozio = await import('@/app/store/[id]/layout');

/**
 * Una richiesta: la mappa della memoria vive finché dura `lavoro`, come quella che React tiene per
 * ogni richiesta del server (DefaultAsyncDispatcher in react-server-dom-webpack).
 */
async function inUnaRichiesta<T>(lavoro: () => Promise<T>): Promise<T> {
  const interni = React.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const memoria = new Map<unknown, unknown>();
  const prima = interni.A;
  interni.A = {
    getCacheForType: (crea: () => unknown) => {
      if (!memoria.has(crea)) memoria.set(crea, crea());
      return memoria.get(crea);
    },
    cacheSignal: () => null,
    getOwner: () => null,
  };
  try {
    return await lavoro();
  } finally {
    interni.A = prima;
  }
}

/** Metadati e guscio della stessa richiesta, insieme come li chiama Next. */
function visita<M>(
  pagina: { generateMetadata: (p: { params: Promise<{ id: string }> }) => Promise<M>; default: (p: { children: null; params: Promise<{ id: string }> }) => Promise<unknown> },
  id: string,
) {
  const params = Promise.resolve({ id });
  return inUnaRichiesta(() =>
    Promise.allSettled([pagina.generateMetadata({ params }), pagina.default({ children: null, params })]),
  );
}

beforeEach(() => {
  conta.letture = {};
  conta.guastoSuiProdotti = false;
  dimenticaLettureDeiMetadati();
  dimenticaLaVistaSenza126();
});

describe('la memoria per richiesta è quella vera di React', () => {
  it('dentro una richiesta la stessa domanda ha una risposta sola, fuori no', async () => {
    const { cache } = (await import('react')) as unknown as { cache: <F extends (...a: never[]) => unknown>(f: F) => F };
    let volte = 0;
    const leggi = cache((id: string) => ++volte && id);
    leggi('a');
    leggi('a');
    expect(volte, 'fuori da una richiesta cache() non deve memorizzare').toBe(2);
    await inUnaRichiesta(async () => {
      leggi('a');
      leggi('a');
    });
    expect(volte, 'dentro una richiesta cache() deve memorizzare').toBe(3);
  });
});

describe('una visita della scheda prodotto legge la riga una volta', () => {
  it('products una volta, seller_public_profiles una volta, e metadati e guscio giusti', async () => {
    const [meta, guscio] = await visita(prodotto, 'p1');
    expect(conta.letture.products, 'la scheda rilegge il prodotto nella stessa visita').toBe(1);
    expect(conta.letture.seller_public_profiles, 'la scheda rilegge il negozio nella stessa visita').toBe(1);

    expect(meta.status).toBe('fulfilled');
    const m = (meta as PromiseFulfilledResult<{ title: string; robots?: unknown; description?: string }>).value;
    expect(m.title).toBe('Coppa piacentina — Forno Rossi a Piacenza · MyCity');
    expect(m.description).toBe('Stagionata 6 mesi');
    expect(m.robots, 'un prodotto in vendita di un negozio approvato va su Google').toBeUndefined();
    expect(guscio.status, 'il guscio di un prodotto che c’è non deve fermarsi').toBe('fulfilled');
  });

  it('controprova: una visita nuova rilegge davvero (la memoria non è per sempre)', async () => {
    await visita(prodotto, 'p1');
    await visita(prodotto, 'p1');
    expect(conta.letture.products).toBe(2);
  });

  it('un guasto della lettura non diventa «Prodotto non trovato»', async () => {
    conta.guastoSuiProdotti = true;
    const [meta] = await visita(prodotto, 'p1');
    expect(meta.status, 'con il database che non risponde i metadati direbbero «non trovato» (noindex)').toBe('rejected');
  });
});

describe('una visita della vetrina non rilegge la riga del negozio per metadati e guscio', () => {
  it('seller_public_profiles: la vetrina e «Venduto da», nient’altro', async () => {
    const [meta, guscio] = await visita(negozio, 'n1');
    // Due letture: la riga della vetrina (da cui escono anche metadati e 404) e «Venduto da», che
    // chiede le colonne d'impresa della 126 col suo ripiego. Prima erano tre.
    expect(conta.letture.seller_public_profiles, 'metadati o guscio rileggono la riga del negozio').toBe(2);

    expect(meta.status).toBe('fulfilled');
    const m = (meta as PromiseFulfilledResult<{ title: string }>).value;
    expect(m.title).toBe('Forno Rossi a Piacenza — Acquista online · MyCity Piacenza');
    expect(guscio.status, 'il guscio di un negozio che c’è non deve fermarsi').toBe('fulfilled');
  });
});
