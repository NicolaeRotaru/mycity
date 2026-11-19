/**
 * @vitest-environment jsdom
 */
/**
 * R04-007 — Quando la rete tornava, «Nuovo prodotto» e «Modifica prodotto» rimettevano il
 * caricamento al posto del modulo, e le modifiche non salvate si perdevano. Senza rete le letture
 * senza dati (la consegna del negozio) e la rilettura del prodotto in memoria restano «in pausa»
 * e il modulo si apre lo stesso; tornata la rete ripartono, risultano «in lettura», e la pagina
 * smontava il modulo.
 *
 * La cura (aperto una volta, il modulo resta) ha un rovescio, trovato dal controllore C01 sulla
 * prima versione (19b705f7): il modulo prende le taglie solo quando si monta. Se si apre col
 * prodotto in memoria e le taglie non ancora arrivate, resta con 0 taglie per sempre e il «Salva»
 * scrive la scorta come se non ne avesse. Quindi il modulo si apre la prima volta solo con le
 * taglie lette, in «Modifica» come in «Duplica».
 *
 * Il revisore ha trovato la stessa strada con le taglie in memoria ma vecchie (aperto senza rete
 * entro qualche minuto dalla visita di prima, e intanto un altro telefono ne ha aggiunte): il modulo
 * si apriva con quelle e restava cosi'. Ora resta aperto solo finche' le taglie sono le stesse; se
 * ne arrivano altre si riapre con quelle vere, come faceva prima della cura.
 *
 * React Query vero, Supabase finto, il modulo finto: un campo di testo non controllato (se il
 * modulo si rimonta, quello che c'era scritto sparisce) e il numero di taglie che ha avuto
 * all'apertura.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';

const ID = '11111111-1111-4111-8111-111111111111';

const stato = vi.hoisted(() => {
  type Esito = { data: unknown; error: unknown };
  const s = {
    cerca: '',
    /** Le taglie che il modulo aveva a ogni apertura (una voce per montaggio). */
    aperture: [] as number[],
    /** Cosa sapeva il modulo della consegna del negozio a ogni apertura (`undefined`: non la sapeva). */
    consegnaAllApertura: [] as unknown[],
    caricamenti: 0,
    ultimo: {} as Record<string, unknown>,
    ritardoTaglie: 0,
    /** Ogni risposta della banca dati finta arriva dopo questi ms: una rete vera non risponde in un attimo. */
    ritardoRete: 0,
    client: null as unknown,
  };
  const PRODOTTO = {
    id: '11111111-1111-4111-8111-111111111111', seller_id: 'negozio-1', name: 'Quaderno', description: 'A righe.', price: 4,
    compare_at_price: null, unit: 'pezzo', condition: null, stock: 2, category_id: 'cat-1', images: [],
    attributes: {}, tags: [], express_enabled: null, status: 'available',
  };
  const risposta = async (finale: () => Esito) => {
    if (s.ritardoRete > 0) await new Promise((r) => setTimeout(r, s.ritardoRete));
    return finale();
  };
  const catena = (finale: () => Esito) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) c[m] = () => c;
    c.single = () => risposta(finale);
    c.maybeSingle = () => risposta(finale);
    c.then = (ok: (r: Esito) => unknown, ko?: (e: unknown) => unknown) => risposta(finale).then(ok, ko);
    return c;
  };
  s.client = {
    auth: { getUser: async () => ({ data: { user: { id: 'negozio-1' } }, error: null }) },
    from: (tavola: string) => {
      if (tavola === 'categories') return catena(() => ({ data: [{ id: 'cat-1', name: 'Casa', slug: 'casa', parent_id: null }], error: null }));
      if (tavola === 'profiles') return catena(() => ({ data: { offers_express: true }, error: null }));
      return catena(() => ({ data: PRODOTTO, error: null }));
    },
  };
  return s;
});

vi.mock('react', async (importOriginal) => {
  const vero = await importOriginal<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: stato.client }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(stato.cerca),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children }: { href: unknown; children?: unknown }) => ce('a', { href: String(href) }, children as never) };
});
vi.mock('@/lib/products/persistVariants', () => ({
  // La taglia arriva dopo `ritardoTaglie` ms: la rete lenta appena tornata.
  loadProductVariants: async () => {
    const ms = stato.ritardoTaglie || stato.ritardoRete;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    return [{ id: 'v1', name: 'Taglia M', options: { Taglia: 'M' }, price: null, stock: 2 }];
  },
  saveProductVariants: async () => undefined,
  controllaScorteVariantiDalBrowser: async () => undefined,
}));
vi.mock('@/components/ui/LoadingState', async () => {
  const { createElement: ce } = await import('react');
  return { LoadingState: () => { stato.caricamenti += 1; return ce('p', null, 'CARICAMENTO'); } };
});
vi.mock('@/components/seller/ProductForm', async () => {
  const { createElement: ce, useEffect, useState } = await import('react');
  return {
    default: function ModuloFinto(p: { initialValues?: { name?: string; variants?: unknown[] } } & Record<string, unknown>) {
      // Come il modulo vero: le taglie si prendono all'apertura, poi restano quelle.
      const [taglie] = useState(() => (p.initialValues?.variants ?? []).length);
      const [consegna] = useState(() => p.sellerOffersExpress);
      useEffect(() => { stato.aperture.push(taglie); stato.consegnaAllApertura.push(consegna); }, []); // eslint-disable-line react-hooks/exhaustive-deps
      stato.ultimo = p;
      return ce('div', null,
        ce('input', { 'aria-label': 'Nome', defaultValue: p.initialValues?.name ?? '' }),
        ce('p', null, `MODULO con ${taglie} taglie`));
    },
  };
});

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: NuovoProdotto } = await import('@/app/seller/products/new/page');
const { default: ModificaProdotto } = await import('@/app/seller/products/[id]/edit/page');

const CATEGORIE = [{ id: 'cat-1', name: 'Casa', slug: 'casa', parent_id: null }];
const PRODOTTO_IN_MEMORIA = {
  id: ID, seller_id: 'negozio-1', name: 'Quaderno', description: 'A righe.', price: 4, stock: 2, category_id: 'cat-1',
  images: [], attributes: {}, tags: [], express_enabled: null, status: 'available',
};
const TAGLIE_IN_MEMORIA = [{ id: 'v1', name: 'Taglia M', options: { Taglia: 'M' }, price: null, stock: 2 }];

const accesi: Root[] = [];
let radice: HTMLDivElement | null = null;
let cliente: QueryClient | null = null;
const gira = async (volte = 10) => {
  for (let i = 0; i < volte; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
};

async function monta(pagina: unknown, props: Record<string, unknown>, prepara: (qc: QueryClient) => void) {
  radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  cliente = qc;
  prepara(qc);
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(pagina as never, props))); });
  await gira();
}

const testo = () => radice?.textContent ?? '';
const campoNome = () => radice?.querySelector('input[aria-label="Nome"]') as HTMLInputElement | null;
/** Torna la rete, e si aspetta che tutte le letture ripartite siano finite. */
const tornaLaRete = async () => {
  await act(async () => { onlineManager.setOnline(true); });
  await gira(4);
  for (let i = 0; i < 400 && (cliente?.isFetching() ?? 0) > 0; i += 1) await gira(1);
  expect(cliente?.isFetching(), 'le letture non sono finite').toBe(0);
  await gira(4);
};

beforeEach(() => {
  stato.cerca = '';
  stato.aperture = [];
  stato.consegnaAllApertura = [];
  stato.caricamenti = 0;
  stato.ultimo = {};
  stato.ritardoTaglie = 0;
  stato.ritardoRete = 20;
  onlineManager.setOnline(true);
});

afterEach(async () => {
  for (const r of accesi.splice(0)) await act(async () => { r.unmount(); });
  document.body.innerHTML = '';
  radice = null;
  cliente = null;
  onlineManager.setOnline(true);
});

describe('R04-007 · «Modifica prodotto»: quando torna la rete il modulo resta, e si apre solo con le taglie', () => {
  it('(a) modulo aperto senza rete, il negoziante scrive, torna la rete: niente caricamento, quello che ha scritto resta', async () => {
    onlineManager.setOnline(false);
    await monta(ModificaProdotto, { params: { valore: { id: ID } } }, (qc) => {
      qc.setQueryData(queryKeys.categories.form, CATEGORIE);
      qc.setQueryData(queryKeys.seller.product(ID), PRODOTTO_IN_MEMORIA);
      qc.setQueryData([...queryKeys.seller.product(ID), 'variants'], TAGLIE_IN_MEMORIA);
    });
    expect(testo(), 'controprova: senza rete, con prodotto e taglie in memoria, il modulo si apre').toContain('MODULO');
    expect(stato.aperture).toEqual([1]);
    expect(stato.ultimo.consegnaDelNegozioNonLetta, 'controprova: la consegna del negozio e\' in pausa').toBe(true);
    campoNome()!.value = 'Quaderno a quadretti';
    const caricamentiPrima = stato.caricamenti;

    await tornaLaRete();
    expect(stato.caricamenti, 'tornata la rete il caricamento ha preso il posto del modulo').toBe(caricamentiPrima);
    expect(stato.aperture, 'il modulo si e\' rimontato: le modifiche non salvate sono perse').toEqual([1]);
    expect(campoNome()?.value, 'quello che il negoziante aveva scritto e\' sparito').toBe('Quaderno a quadretti');
    // Si e' aperto senza sapere la consegna del negozio: per lui resta «non letta» (non scrive un «no» indovinato).
    expect(stato.ultimo.consegnaDelNegozioNonLetta).toBe(true);
  });

  it('(b) prodotto in memoria, taglie no, senza rete; le taglie arrivano dopo 40 ms: il modulo si apre con la taglia, mai con 0', async () => {
    stato.ritardoTaglie = 40;
    onlineManager.setOnline(false);
    await monta(ModificaProdotto, { params: { valore: { id: ID } } }, (qc) => {
      qc.setQueryData(queryKeys.categories.form, CATEGORIE);
      qc.setQueryData(queryKeys.seller.product(ID), PRODOTTO_IN_MEMORIA);
    });
    expect(stato.aperture, 'senza rete il modulo si e\' aperto senza le taglie').toEqual([]);
    expect(testo()).toMatch(/Non riesco a leggere le taglie/);

    await tornaLaRete();
    expect(testo()).toContain('MODULO');
    expect(stato.aperture[0], 'il modulo si e\' aperto con 0 taglie: il «Salva» scriverebbe la scorta come senza taglie').toBe(1);
    expect(stato.aperture.every((n) => n === 1), `aperture con queste taglie: ${stato.aperture.join(', ')}`).toBe(true);
    expect(((stato.ultimo.initialValues as { variants?: unknown[] } | undefined)?.variants ?? []).length).toBe(1);
  });

  it('(c) taglie vecchie in memoria (nessuna), senza rete; tornata la rete la banca dati ne ha una: il modulo si riapre con la taglia', async () => {
    // Le taglie arrivano prima della consegna del negozio: il modulo si riapre senza saperla.
    stato.ritardoTaglie = 5;
    stato.ritardoRete = 80;
    onlineManager.setOnline(false);
    await monta(ModificaProdotto, { params: { valore: { id: ID } } }, (qc) => {
      qc.setQueryData(queryKeys.categories.form, CATEGORIE);
      qc.setQueryData(queryKeys.seller.product(ID), PRODOTTO_IN_MEMORIA);
      qc.setQueryData([...queryKeys.seller.product(ID), 'variants'], []);
    });
    expect(stato.aperture, 'controprova: senza rete si apre con le taglie in memoria, che sono vecchie').toEqual([0]);

    await tornaLaRete();
    expect(testo()).toContain('MODULO con 1 taglie');
    expect(stato.aperture, 'tornata la rete il modulo e\' rimasto con 0 taglie: il «Salva» scriverebbe la scorta come senza taglie').toEqual([0, 1]);
    expect(((stato.ultimo.initialValues as { variants?: unknown[] } | undefined)?.variants ?? []).length).toBe(1);
    // Riaperto: la consegna del negozio o la sapeva, o per lui resta «non letta».
    expect(stato.consegnaAllApertura.at(-1) !== undefined || stato.ultimo.consegnaDelNegozioNonLetta === true, 'riaperto senza sapere la consegna del negozio: il «Salva» scriverebbe un «no» indovinato').toBe(true);
  });
});

describe('R04-007 · «Nuovo prodotto» e «Duplica»: quando torna la rete il modulo resta, e la copia si apre solo con le taglie', () => {
  it('(a) «Nuovo prodotto» aperto senza rete, il negoziante scrive, torna la rete: niente caricamento, quello che ha scritto resta', async () => {
    onlineManager.setOnline(false);
    await monta(NuovoProdotto, {}, (qc) => qc.setQueryData(queryKeys.categories.form, CATEGORIE));
    expect(testo(), 'controprova: senza rete, con le categorie in memoria, il modulo si apre').toContain('MODULO');
    expect(stato.aperture).toHaveLength(1);
    expect(stato.ultimo.consegnaDelNegozioNonLetta, 'controprova: la consegna del negozio e\' in pausa').toBe(true);
    campoNome()!.value = 'Tazza smaltata';
    const caricamentiPrima = stato.caricamenti;

    await tornaLaRete();
    expect(stato.caricamenti, 'tornata la rete il caricamento ha preso il posto del modulo').toBe(caricamentiPrima);
    expect(stato.aperture, 'il modulo si e\' rimontato: le modifiche non salvate sono perse').toHaveLength(1);
    expect(campoNome()?.value, 'quello che il negoziante aveva scritto e\' sparito').toBe('Tazza smaltata');
    expect(stato.ultimo.consegnaDelNegozioNonLetta).toBe(true);
  });

  it('(b) «Duplica» col prodotto in memoria, taglie no, senza rete; le taglie arrivano dopo 40 ms: la copia si apre con la taglia, mai con 0', async () => {
    stato.cerca = 'from=p-pane';
    stato.ritardoTaglie = 40;
    onlineManager.setOnline(false);
    await monta(NuovoProdotto, {}, (qc) => {
      qc.setQueryData(queryKeys.categories.form, CATEGORIE);
      qc.setQueryData(['duplicate-source', 'p-pane'], { id: 'p-pane', seller_id: 'negozio-1', name: 'Pane', price: 4, images: [], attributes: {} });
    });
    expect(stato.aperture, 'senza rete la copia si e\' aperta senza le taglie').toEqual([]);
    expect(testo()).toMatch(/Non riesco a leggere le taglie/);

    await tornaLaRete();
    expect(testo()).toContain('MODULO');
    expect(stato.aperture[0], 'la copia si e\' aperta con 0 taglie').toBe(1);
    expect(stato.aperture.every((n) => n === 1), `aperture con queste taglie: ${stato.aperture.join(', ')}`).toBe(true);
    expect(((stato.ultimo.initialValues as { variants?: unknown[] } | undefined)?.variants ?? []).length).toBe(1);
  });

  it('(c) «Duplica» con le taglie d\'origine vecchie in memoria (nessuna), senza rete; tornata la rete ne arriva una: la copia si riapre con la taglia', async () => {
    stato.cerca = 'from=p-pane';
    stato.ritardoTaglie = 5;
    stato.ritardoRete = 80;
    onlineManager.setOnline(false);
    await monta(NuovoProdotto, {}, (qc) => {
      qc.setQueryData(queryKeys.categories.form, CATEGORIE);
      qc.setQueryData(['duplicate-source', 'p-pane'], { id: 'p-pane', seller_id: 'negozio-1', name: 'Pane', price: 4, images: [], attributes: {} });
      qc.setQueryData(['duplicate-variants', 'p-pane'], []);
    });
    expect(stato.aperture, 'controprova: senza rete la copia si apre con le taglie in memoria, che sono vecchie').toEqual([0]);

    await tornaLaRete();
    expect(testo()).toContain('MODULO con 1 taglie');
    expect(stato.aperture, 'tornata la rete la copia e\' rimasta con 0 taglie: nascerebbe senza').toEqual([0, 1]);
    expect(((stato.ultimo.initialValues as { variants?: unknown[] } | undefined)?.variants ?? []).length).toBe(1);
    expect(stato.consegnaAllApertura.at(-1) !== undefined || stato.ultimo.consegnaDelNegozioNonLetta === true, 'riaperta senza sapere la consegna del negozio: il «Salva» scriverebbe un «no» indovinato').toBe(true);
  });

  it('(d) «Duplica» con le stesse taglie in memoria, senza rete, il negoziante scrive; torna la rete: la copia resta, con quello che ha scritto', async () => {
    stato.cerca = 'from=p-pane';
    onlineManager.setOnline(false);
    await monta(NuovoProdotto, {}, (qc) => {
      qc.setQueryData(queryKeys.categories.form, CATEGORIE);
      qc.setQueryData(['duplicate-source', 'p-pane'], { id: 'p-pane', seller_id: 'negozio-1', name: 'Pane', price: 4, images: [], attributes: {} });
      qc.setQueryData(['duplicate-variants', 'p-pane'], TAGLIE_IN_MEMORIA);
    });
    expect(stato.aperture, 'controprova: senza rete la copia si apre con le taglie in memoria').toEqual([1]);
    campoNome()!.value = 'Pane di segale';

    await tornaLaRete();
    expect(stato.aperture, 'la copia si e\' riaperta con le stesse taglie: le modifiche non salvate sono perse').toEqual([1]);
    expect(campoNome()?.value, 'quello che il negoziante aveva scritto e\' sparito').toBe('Pane di segale');
  });
});
