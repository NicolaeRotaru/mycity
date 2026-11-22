/**
 * R10-016 — LA STESSA RIGA SI LEGGE UNA VOLTA PER RICHIESTA.
 *
 * `generateMetadata` e il guscio (o la pagina) chiedono la stessa riga nella stessa richiesta: il
 * profilo pubblico la leggeva due volte a ogni visita, e prodotto, negozio e categoria la
 * rileggevano appena la prima risposta tardava più dei due secondi della memoria.
 *
 * Il `cache()` di React che fa da memoria per richiesta esiste solo nei componenti del server
 * (Next usa lì il suo React); qui, col React 18 del progetto, non c'è. Lo sostituisce un
 * memorizzatore che fa la stessa cosa — una risposta per gli stessi argomenti — e che si svuota a
 * ogni «richiesta nuova». Il database è finto e conta le domande. L'orologio è finto: la «risposta
 * che tarda» è il tempo che passa fra la prima lettura e la seconda.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const stato = vi.hoisted(() => ({
  letture: {} as Record<string, number>,
  memorie: [] as Map<string, unknown>[],
}));

vi.mock('react', async (originale) => {
  const vero = await originale<typeof import('react')>();
  const cache = <F extends (...a: unknown[]) => unknown>(f: F): F => {
    const memoria = new Map<string, unknown>();
    stato.memorie.push(memoria);
    return ((...a: unknown[]) => {
      const k = JSON.stringify(a);
      if (!memoria.has(k)) memoria.set(k, f(...a));
      return memoria.get(k);
    }) as F;
  };
  return { ...vero, default: vero, cache };
});

/** Una richiesta nuova: la memoria di React vale per una richiesta sola. */
function richiestaNuova() {
  for (const m of stato.memorie) m.clear();
}

const RIGHE: Record<string, Record<string, unknown>> = {
  products: { id: 'p1', name: 'Coppa piacentina', description: null, price: 18.5, images: [], status: 'available', stock: 3, seller_id: 'n1' },
  seller_public_profiles: {
    id: 'n1', store_name: 'Forno Rossi', store_description: null, store_logo: null, store_address: null,
    is_approved: true, role: 'seller', store_site: null,
  },
  categories: { id: 'c1', slug: 'alimentari', name: 'Alimentari', parent_id: null },
  profiles: { id: 'u1', public_handle: 'mario', public_bio: null, public_avatar_url: null, full_name: 'Mario Rossi' },
};

/** Un client che conta le letture di UNA riga per tabella (single / maybeSingle) e risponde con la riga. */
function clienteCheConta() {
  return {
    from: (tabella: string) => {
      const riga = async () => {
        stato.letture[tabella] = (stato.letture[tabella] ?? 0) + 1;
        return { data: RIGHE[tabella] ?? null, error: null };
      };
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'ilike', 'order', 'in']) q[m] = () => q;
      q.single = riga;
      q.maybeSingle = riga;
      q.limit = async () => ({ data: [], error: null });
      return q;
    },
  };
}

vi.mock('@/lib/supabase/anonimo', () => ({ creaClientAnonimo: () => clienteCheConta() }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => clienteCheConta() }));
// Il precarico fa le sue domande per la pagina del browser: qui si contano solo quelle dei metadati.
vi.mock('@/lib/queries/precarico', () => ({
  precaricaProdotto: async () => ({ mutations: [], queries: [] }),
  precaricaNegozio: async () => ({ mutations: [], queries: [] }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { dimenticaLettureDeiMetadati } = await import('@/lib/supabase/lettura-per-metadati');
const prodotto = await import('@/app/product/[id]/layout');
const negozio = await import('@/app/store/[id]/layout');
const categoria = await import('@/app/category/[slug]/layout');
const profilo = await import('@/app/u/[handle]/page');

const ADESSO = new Date('2026-11-21T10:00:00Z');

beforeEach(() => {
  stato.letture = {};
  dimenticaLettureDeiMetadati();
  richiestaNuova();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
});

afterEach(() => {
  vi.useRealTimers();
});

/** La prima risposta tarda: fra i metadati e il guscio passano tre secondi. */
function passanoTreSecondi() {
  vi.setSystemTime(new Date(ADESSO.getTime() + 3_000));
}

describe('R10-016 · una visita, una lettura della stessa riga', () => {
  it('profilo pubblico: metadati e pagina leggono il profilo una volta', async () => {
    const params = Promise.resolve({ handle: 'mario' });
    await profilo.generateMetadata({ params });
    await profilo.default({ params });
    expect(stato.letture.profiles, 'il profilo si legge due volte a ogni visita').toBe(1);
  });

  it('scheda prodotto: anche se la prima risposta tarda, il guscio non rilegge il prodotto', async () => {
    const params = Promise.resolve({ id: 'p1' });
    await prodotto.generateMetadata({ params });
    passanoTreSecondi();
    await prodotto.default({ children: null, params });
    expect(stato.letture.products, 'il prodotto si rilegge nella stessa visita').toBe(1);
    expect(stato.letture.seller_public_profiles, 'il negozio del prodotto si rilegge nella stessa visita').toBe(1);
  });

  it('vetrina del negozio: metadati e guscio leggono il negozio una volta', async () => {
    const params = Promise.resolve({ id: 'n1' });
    await negozio.generateMetadata({ params });
    passanoTreSecondi();
    await negozio.default({ children: null, params });
    expect(stato.letture.seller_public_profiles, 'il negozio si rilegge nella stessa visita').toBe(1);
  });

  it('categoria: metadati e guscio leggono la categoria una volta', async () => {
    const params = Promise.resolve({ slug: 'alimentari' });
    await categoria.generateMetadata({ params });
    passanoTreSecondi();
    await categoria.default({ children: null, params });
    expect(stato.letture.categories, 'la categoria si rilegge nella stessa visita').toBe(1);
  });

  it('controprova: una visita nuova, a memoria scaduta, rilegge davvero', async () => {
    const params = Promise.resolve({ handle: 'mario' });
    await profilo.generateMetadata({ params });
    richiestaNuova();
    passanoTreSecondi();
    await profilo.generateMetadata({ params });
    expect(stato.letture.profiles).toBe(2);

    const p = Promise.resolve({ id: 'p1' });
    await prodotto.generateMetadata({ params: p });
    richiestaNuova();
    vi.setSystemTime(new Date(ADESSO.getTime() + 10_000));
    await prodotto.generateMetadata({ params: p });
    expect(stato.letture.products, 'la memoria è diventata per sempre: un prodotto cambiato non si vedrebbe più').toBe(2);
  });
});
