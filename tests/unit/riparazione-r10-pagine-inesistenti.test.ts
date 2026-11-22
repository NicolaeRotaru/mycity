/**
 * R10-001, R10-005 — LE PAGINE CHE NON ESISTONO RISPONDONO «NON TROVATO», NON «TUTTO OK».
 *
 * Due cose servivano insieme, e mancavano tutte e due.
 *
 * ① Chi decide. Prodotto, negozio e categoria sono pagine del browser: il loro «non trovato» lo
 *    disegnava il browser, dopo una risposta già partita con 200. La 404 vera la può dare solo il
 *    server, e il primo pezzo di server che conosce la riga è il guscio (il layout). Qui si esegue il
 *    guscio vero con letture finte e si guarda se chiama `notFound()` — e soprattutto se NON lo
 *    chiama quando la pagina esiste o quando la lettura non riesce (un guasto non è «non trovato»),
 *    e quando il prodotto c'è ma ora non si vende (finito per oggi: la pagina lo spiega).
 *
 * ② Nessuna attesa sopra chi decide. Un `loading.tsx` avvolge in un'attesa tutto quello che sta
 *    sotto la sua cartella: la risposta parte con «tutto ok» per mostrare l'attesa, e un notFound()
 *    che arriva dopo non può più cambiare il codice. Togliere `app/loading.tsx` e
 *    `app/store/loading.tsx` va fatto insieme alle prove comuni che li leggono per nome: resta alla
 *    regista (nel referto, serve_file_altrui). Questa prova guarda solo ①.
 *
 * Non ho potuto avviare il sito: che la risposta sia davvero 404 lo deduco da come Next decide il
 * codice (prima della prima attesa), non l'ho visto in rete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defaultSite } from '@/lib/store-site';

type Riga = Record<string, unknown> | null;

const mondo = vi.hoisted(() => ({
  righe: {} as Record<string, Record<string, unknown> | null>,
  guasto: false,
  /** Cosa risponde la domanda «la riga c'è?», senza le regole di lettura. */
  esiste: true as boolean,
  erroreDellaDomanda: null as null | { code: string; message: string },
  domandeSulProdotto: 0,
}));

vi.mock('@/lib/supabase/lettura-per-metadati', () => ({
  leggiPerMetadati: async (tabella: string) => {
    if (mondo.guasto) throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    return tabella in mondo.righe ? mondo.righe[tabella] : null;
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => {
          if (tabella === 'products') mondo.domandeSulProdotto++;
          return mondo.erroreDellaDomanda
            ? { data: null, error: mondo.erroreDellaDomanda }
            : { data: mondo.esiste ? { id: 'p1' } : null, error: null };
        },
      };
      return q;
    },
  }),
}));

vi.mock('@/lib/queries/precarico', () => ({
  precaricaProdotto: async () => ({ mutations: [], queries: [] }),
  precaricaNegozio: async () => ({ mutations: [], queries: [] }),
}));

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { default: ProductLayout } = await import('@/app/product/[id]/layout');
const { default: StoreLayout } = await import('@/app/store/[id]/layout');
const { default: CategoryLayout } = await import('@/app/category/[slug]/layout');
const { default: StoreSlugLayout } = await import('@/app/store/[id]/[slug]/layout');

/** Vero se il guscio ha chiamato notFound(): Next lo riconosce dal «digest» dell'errore. */
async function rispondeNonTrovato(guscio: () => Promise<unknown>): Promise<boolean> {
  try {
    await guscio();
    return false;
  } catch (e) {
    const digest = (e as { digest?: unknown })?.digest;
    if (typeof digest === 'string' && digest.startsWith('NEXT_HTTP_ERROR_FALLBACK;404')) return true;
    throw e;
  }
}

const figli = 'contenuto della pagina';
const prodotto = (id = '0b4f1c1e-1111-4222-8333-944455556666') =>
  rispondeNonTrovato(() => ProductLayout({ children: figli, params: Promise.resolve({ id }) }));
const negozio = (id = 'n1') => rispondeNonTrovato(() => StoreLayout({ children: figli, params: Promise.resolve({ id }) }));
const categoria = (slug = 'alimentari') =>
  rispondeNonTrovato(() => CategoryLayout({ children: figli, params: Promise.resolve({ slug }) }));
const paginaDelNegozio = (slug: string) =>
  rispondeNonTrovato(() => StoreSlugLayout({ children: figli, params: Promise.resolve({ id: 'n1', slug }) }));

const PRODOTTO: Riga = {
  id: 'p1', name: 'Coppa piacentina', description: null, price: 18.5, images: [], status: 'available', stock: 3, seller_id: 'n1',
};
const NEGOZIO: Riga = {
  id: 'n1', store_name: 'Forno Rossi', store_description: null, store_logo: null, store_address: null,
  is_approved: true, role: 'seller', store_site: null,
};

beforeEach(() => {
  mondo.righe = {};
  mondo.guasto = false;
  mondo.esiste = true;
  mondo.erroreDellaDomanda = null;
  mondo.domandeSulProdotto = 0;
});

describe('① il guscio del prodotto', () => {
  it('un prodotto che non c\'è risponde 404', async () => {
    mondo.esiste = false;
    expect(await prodotto()).toBe(true);
  });

  it('un indirizzo con un id che non è nemmeno un id risponde 404', async () => {
    mondo.erroreDellaDomanda = { code: '22P02', message: 'invalid input syntax for type uuid' };
    expect(await prodotto('non-un-id')).toBe(true);
  });

  it('un prodotto che c\'è ma ora non si vende (finito per oggi) NON è una 404', async () => {
    mondo.esiste = true; // la riga c'è, la lettura pubblica non la vede
    expect(await prodotto()).toBe(false);
  });

  it('se non riesco a chiedere se esiste, niente 404', async () => {
    mondo.erroreDellaDomanda = { code: '57014', message: 'canceling statement due to statement timeout' };
    expect(await prodotto()).toBe(false);
  });

  it('controprova: il prodotto in vendita si apre, e non si chiede niente in più', async () => {
    mondo.righe = { products: PRODOTTO, seller_public_profiles: { store_name: 'Forno Rossi', is_approved: true } };
    expect(await prodotto()).toBe(false);
    expect(mondo.domandeSulProdotto, 'una domanda in più su ogni scheda vera').toBe(0);
  });
});

describe('① il guscio del negozio', () => {
  it('un negozio che non c\'è risponde 404', async () => {
    expect(await negozio('mai-esistito')).toBe(true);
  });

  it('un negozio non approvato, senza nome o che non è un negozio risponde 404, come la pagina dice «non trovato»', async () => {
    for (const diverso of [{ is_approved: false }, { store_name: null }, { role: 'buyer' }]) {
      mondo.righe = { seller_public_profiles: { ...NEGOZIO, ...diverso } };
      expect(await negozio(), JSON.stringify(diverso)).toBe(true);
    }
  });

  it('se la lettura non riesce, niente 404: la pagina resta col suo «Riprova»', async () => {
    mondo.guasto = true;
    expect(await negozio()).toBe(false);
  });

  it('controprova: il negozio vero si apre', async () => {
    mondo.righe = { seller_public_profiles: NEGOZIO };
    expect(await negozio()).toBe(false);
  });
});

describe('① il guscio della categoria', () => {
  it('una categoria che non c\'è risponde 404', async () => {
    expect(await categoria('mai-esistita')).toBe(true);
  });

  it('se la lettura non riesce, niente 404', async () => {
    mondo.guasto = true;
    expect(await categoria()).toBe(false);
  });

  it('controprova: la categoria vera si apre', async () => {
    mondo.righe = { categories: { id: 'c1', slug: 'alimentari', name: 'Alimentari', parent_id: null } };
    expect(await categoria()).toBe(false);
  });
});

describe('① il guscio di una pagina su misura del negozio', () => {
  const casa = defaultSite();
  const sito = {
    ...casa,
    pages: [...casa.pages, { ...casa.pages[0], id: 'feste', slug: 'ordini-per-le-feste', title: 'Ordini per le feste', visibility: 'hidden' }],
  };

  it('una pagina che il negozio non ha risponde 404', async () => {
    mondo.righe = { seller_public_profiles: { ...NEGOZIO, store_site: sito } };
    expect(await paginaDelNegozio('pagina-che-non-esiste')).toBe(true);
  });

  it('la pagina nascosta dal menu si apre col link, come promette l\'editor', async () => {
    mondo.righe = { seller_public_profiles: { ...NEGOZIO, store_site: sito } };
    expect(await paginaDelNegozio('ordini-per-le-feste')).toBe(false);
  });

  it('se la lettura non riesce, niente 404', async () => {
    mondo.guasto = true;
    expect(await paginaDelNegozio('ordini-per-le-feste')).toBe(false);
  });
});
