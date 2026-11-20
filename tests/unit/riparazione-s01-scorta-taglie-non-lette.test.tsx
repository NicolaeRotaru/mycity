/**
 * @vitest-environment jsdom
 */
/**
 * S01-001 — «Modifica prodotto», «Nuovo prodotto» e «Duplica»: quando torna la rete il modulo resta
 * dov'è, con quello che il negoziante ha scritto. E se le taglie non arrivano, il Salva si blocca con
 * un avviso: la scorta non si scrive mai su una somma di taglie che non è stata letta.
 *
 * Il guaio di partenza: aperta la pagina senza rete (dati in memoria), al ritorno della rete le
 * letture ripartivano e la pagina rimetteva il caricamento al posto del modulo. Il modulo si
 * smontava e le modifiche non salvate sparivano. Le due cure di prima (R03-019, R04-007) tenevano
 * il modulo aperto ma lasciavano salvare con le taglie vecchie in memoria (0 taglie): la scorta
 * del prodotto si staccava dalla somma delle taglie, e una copia nasceva senza taglie.
 *
 * Qui la pagina vera, il modulo vero e React Query vero; finti solo Supabase, le taglie e le
 * porte di scrittura. La rete si spegne e si riaccende con `onlineManager`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queries/keys';

const ID = '11111111-1111-4111-8111-111111111111';
const SORGENTE = 'p-src';

type Esito = { data: unknown; error: unknown };
type Taglia = { id?: string; options: Record<string, string>; label: string; stock: number; position?: number };

const stato = vi.hoisted(() => {
  const s = {
    /** Il prodotto da modificare, com'è in banca dati. */
    prodotto: null as Record<string, unknown> | null,
    /** Il prodotto da duplicare, com'è in banca dati (letto con `*`). */
    sorgente: null as Record<string, unknown> | null,
    /** La lettura «c'è la colonna del recesso?» (una riga qualsiasi con `*`). */
    colonna: { data: null, error: null } as Esito,
    /** Le taglie di ogni prodotto: cosa risponde la lettura (o un errore). */
    taglie: {} as Record<string, () => Promise<unknown[]>>,
    letturePerTaglie: 0,
    /** Le scritture che contano: se ce n'è una, il Salva è partito. */
    salvataggi: [] as Array<Record<string, unknown>>,
    variantiSalvate: [] as Array<{ prodotto: string; varianti: unknown[] }>,
    controlliScorte: 0,
    inserimenti: [] as Array<Record<string, unknown>>,
    cerca: '',
    client: null as unknown,
  };
  const catena = (tavola: string) => {
    let id: string | null = null;
    let conLimite = false;
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.order = () => c;
    c.eq = (_col: string, v: string) => { id = v; return c; };
    c.limit = () => { conLimite = true; return c; };
    const riga = (): Esito => {
      if (tavola === 'profiles') return { data: { offers_express: true }, error: null };
      if (conLimite) return s.colonna;
      if (id === ID) return s.prodotto ? { data: s.prodotto, error: null } : { data: null, error: { code: 'PGRST116', message: 'nessuna riga' } };
      if (id === SORGENTE) return s.sorgente ? { data: s.sorgente, error: null } : { data: null, error: { message: 'TypeError: Failed to fetch' } };
      return { data: null, error: { code: 'PGRST116', message: 'nessuna riga' } };
    };
    // Una lettura vera richiede tempo: la pagina fa in tempo a disegnarsi «in lettura».
    c.single = async () => { await new Promise((r) => setTimeout(r, 20)); return riga(); };
    c.maybeSingle = async () => { await new Promise((r) => setTimeout(r, 20)); return riga(); };
    c.insert = (payload: Record<string, unknown>) => {
      s.inserimenti.push(payload);
      return { select: () => ({ single: async () => ({ data: { id: 'copia-1' }, error: null }) }) };
    };
    c.then = (ok: (r: Esito) => unknown, ko?: (e: unknown) => unknown) => {
      const r: Esito = tavola === 'categories'
        ? { data: [{ id: 'c-casa', name: 'Casa', slug: 'casa', parent_id: null }], error: null }
        : { data: [], error: null };
      return Promise.resolve(r).then(ok, ko);
    };
    return c;
  };
  s.client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'negozio-1' } }, error: null }),
      getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
    },
    from: (tavola: string) => catena(tavola),
  };
  return s;
});

vi.mock('react', async (importOriginal) => {
  const vero = await importOriginal<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: stato.client }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/seller/products',
  useSearchParams: () => new URLSearchParams(stato.cerca),
}));
vi.mock('@/components/ui/LoadingState', async () => {
  const { createElement: ce } = await import('react');
  return { LoadingState: () => ce('p', null, 'CARICAMENTO') };
});
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: async () => true }));
vi.mock('@/lib/analytics/events', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  trackProductPublished: vi.fn(),
  trackErrorShown: vi.fn(),
}));
vi.mock('@/lib/products/persistVariants', () => ({
  loadProductVariants: async (id: string) => {
    stato.letturePerTaglie += 1;
    await new Promise((r) => setTimeout(r, 20));
    const leggi = stato.taglie[id];
    return leggi ? leggi() : [];
  },
  saveProductVariants: async (prodotto: string, varianti: unknown[]) => { stato.variantiSalvate.push({ prodotto, varianti }); },
  controllaScorteVariantiDalBrowser: async () => { stato.controlliScorte += 1; },
}));
vi.mock('@/lib/products/salva-dal-browser', () => ({
  salvaProdottoDalBrowser: async (o: Record<string, unknown>) => { stato.salvataggi.push(o); },
  nascondiProdottoTracciato: async () => undefined,
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: PaginaModifica } = await import('@/app/seller/products/[id]/edit/page');
const { default: PaginaNuovo } = await import('@/app/seller/products/new/page');

const CATEGORIE = [{ id: 'c-casa', name: 'Casa', slug: 'casa', parent_id: null }];
const ROSSO: Taglia = { id: 'v-rosso', options: { colore: 'Rosso' }, label: 'Rosso', stock: 2, position: 0 };
const BLU: Taglia = { id: 'v-blu', options: { colore: 'Blu' }, label: 'Blu', stock: 3, position: 1 };

const PRODOTTO = {
  id: ID, seller_id: 'negozio-1', name: 'Lampada da comodino', description: 'Lampada in ottone, paralume di lino.',
  price: 40, compare_at_price: null, unit: 'pezzo', condition: null, stock: 5, category_id: 'c-casa',
  images: ['https://x/lampada.jpg'], attributes: {}, tags: [],
  // Eredita la consegna dal negozio: senza la risposta del negozio, il modulo non deve indovinarla.
  express_enabled: null, status: 'available',
};
/** Il prodotto come lo lascia in memoria la lettura della pagina «Modifica». */
const PRODOTTO_IN_MEMORIA = { ...PRODOTTO, non_recedibile: false, __recessoSegnabile: true };

const SORGENTE_RIGA = {
  id: SORGENTE, seller_id: 'negozio-1', name: 'Lampada da tavolo', description: 'Lampada in ottone con paralume di lino, alta quaranta centimetri.',
  price: 55, compare_at_price: null, unit: 'pezzo', condition: null, stock: 5, category_id: 'c-casa',
  images: ['https://x/tavolo.jpg'], attributes: {}, tags: [], express_enabled: true, status: 'available',
  non_recedibile: false,
};

const accesi: Root[] = [];
/**
 * Il tempo passa a piccoli passi, ognuno dentro `act`: così la pagina si disegna anche negli stati di
 * mezzo («in lettura»), come nel telefono, e non solo alla fine di tutte le letture.
 */
async function aspetta(ms = 30) {
  for (let fatto = 0; fatto < ms; fatto += 5) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
}
async function rete(accesa: boolean) {
  await act(async () => { onlineManager.setOnline(accesa); });
  await aspetta(120);
}

function nuovoClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

async function monta(elemento: () => ReturnType<typeof createElement>, prepara?: (qc: QueryClient) => void) {
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const qc = nuovoClient();
  prepara?.(qc);
  const disegna = () => act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, elemento()));
  });
  await disegna();
  await aspetta(60);
  return { radice, qc, disegna };
}

const apriModifica = (prepara?: (qc: QueryClient) => void) =>
  monta(() => createElement(PaginaModifica as never, { params: { valore: { id: ID } } }), prepara);
const apriNuovo = (prepara?: (qc: QueryClient) => void) => monta(() => createElement(PaginaNuovo), prepara);

const chiaveTaglie = [...queryKeys.seller.product(ID), 'variants'];

function inMemoriaModifica(qc: QueryClient, taglie: Taglia[]) {
  qc.setQueryData(queryKeys.seller.product(ID), PRODOTTO_IN_MEMORIA);
  qc.setQueryData(chiaveTaglie, taglie);
  qc.setQueryData(queryKeys.categories.form, CATEGORIE);
}
function inMemoriaDuplica(qc: QueryClient, taglie: Taglia[]) {
  qc.setQueryData(['duplicate-source', SORGENTE], SORGENTE_RIGA);
  qc.setQueryData(['duplicate-variants', SORGENTE], taglie);
  qc.setQueryData(queryKeys.categories.form, CATEGORIE);
}

const campoNome = (radice: HTMLElement) => radice.querySelector<HTMLInputElement>('input[name="name"]');
const pulsante = (radice: HTMLElement, testo: string) =>
  [...radice.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(testo));

async function scrivi(el: HTMLInputElement | null, valore: string) {
  expect(el, 'controprova: il campo del nome deve essere a video').toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, valore);
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function clic(radice: HTMLElement, testo: string) {
  const b = pulsante(radice, testo);
  expect(b, `controprova: il pulsante «${testo}» deve essere a video`).toBeTruthy();
  await act(async () => { b!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
  await aspetta(60);
}
const nessunaScrittura = () => ({
  prodotto: stato.salvataggi.length,
  taglie: stato.variantiSalvate.length,
  copie: stato.inserimenti.length,
});

beforeEach(() => {
  stato.prodotto = { ...PRODOTTO };
  stato.sorgente = { ...SORGENTE_RIGA };
  stato.colonna = { data: { id: 'qualsiasi', non_recedibile: false }, error: null };
  stato.taglie = {};
  stato.letturePerTaglie = 0;
  stato.salvataggi = [];
  stato.variantiSalvate = [];
  stato.controlliScorte = 0;
  stato.inserimenti = [];
  stato.cerca = '';
  try { localStorage.clear(); } catch { /* niente */ }
});

afterEach(() => {
  onlineManager.setOnline(true);
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

describe('S01-001 · «Modifica prodotto»: torna la rete, il modulo resta', () => {
  it('E1 · aperta senza rete, torna la rete: niente caricamento al posto del modulo, il testo resta e si salva', async () => {
    stato.taglie[ID] = async () => [ROSSO, BLU];
    onlineManager.setOnline(false);
    const { radice } = await apriModifica((qc) => inMemoriaModifica(qc, [ROSSO, BLU]));
    const campo = campoNome(radice);
    await scrivi(campo, 'Lampada con dedica');

    await rete(true);
    expect(radice.textContent, 'tornata la rete il caricamento ha preso il posto del modulo').not.toContain('CARICAMENTO');
    expect(campoNome(radice), 'tornata la rete il modulo si è smontato e rimontato').toBe(campo);
    expect(campoNome(radice)?.value, 'tornata la rete il modulo si è rimontato: il testo scritto è sparito').toBe('Lampada con dedica');

    // Le taglie sono arrivate, e sono quelle del modulo: il Salva parte, con il testo scritto.
    await clic(radice, 'Salva modifiche');
    expect(stato.salvataggi).toHaveLength(1);
    const payload = stato.salvataggi[0].payload as Record<string, unknown>;
    expect(payload.name).toBe('Lampada con dedica');
    // Aperto senza sapere cosa offre il negozio: la consegna non letta non diventa un «no» scritto.
    expect(payload, 'il modulo aperto senza la risposta del negozio ha scritto una consegna indovinata').not.toHaveProperty('express_enabled');
  });

  it('E2 · copia vecchia a 0 taglie, la rilettura delle taglie cade al ritorno della rete: Salva fermo con avviso, testo intatto', async () => {
    stato.taglie[ID] = () => Promise.reject(Object.assign(new Error('TypeError: Failed to fetch'), { code: '' }));
    onlineManager.setOnline(false);
    const { radice } = await apriModifica((qc) => inMemoriaModifica(qc, []));
    await scrivi(campoNome(radice), 'Lampada con dedica');

    await rete(true);
    expect(stato.letturePerTaglie, 'controprova: tornata la rete le taglie si rileggono').toBeGreaterThan(0);
    expect(campoNome(radice)?.value, 'la rilettura caduta ha chiuso il modulo: il testo scritto è sparito').toBe('Lampada con dedica');
    expect(radice.textContent, 'nessun avviso: il modulo resta aperto con 0 taglie come se fossero vere').toMatch(/taglie/i);

    await clic(radice, 'Salva modifiche');
    expect(nessunaScrittura(), 'con le taglie non lette il Salva ha scritto: la scorta si stacca dalla somma delle taglie').toEqual({ prodotto: 0, taglie: 0, copie: 0 });
    expect(stato.controlliScorte).toBe(0);
    expect(campoNome(radice)?.value, 'il Salva fermo ha perso il testo').toBe('Lampada con dedica');
  });

  it('E2b · poi le taglie arrivano ma non sono quelle del modulo (2, non 0): il Salva resta fermo finché il modulo non le prende', async () => {
    let cade = true;
    stato.taglie[ID] = () => (cade ? Promise.reject(new Error('TypeError: Failed to fetch')) : Promise.resolve([ROSSO, BLU]));
    onlineManager.setOnline(false);
    const { radice } = await apriModifica((qc) => inMemoriaModifica(qc, []));
    await scrivi(campoNome(radice), 'Lampada con dedica');
    await rete(true);

    cade = false;
    await clic(radice, 'Riprova');
    expect(campoNome(radice)?.value).toBe('Lampada con dedica');
    await clic(radice, 'Salva modifiche');
    expect(nessunaScrittura(), 'il modulo ha 0 taglie, la banca dati 2: il Salva ha scritto sulla somma sbagliata').toEqual({ prodotto: 0, taglie: 0, copie: 0 });

    // Il negoziante sceglie di riaprire il modulo con le taglie vere: adesso si salva, sulle due taglie.
    await clic(radice, 'Riapri con le taglie aggiornate');
    await clic(radice, 'Salva modifiche');
    expect(stato.salvataggi).toHaveLength(1);
    expect(stato.variantiSalvate.at(-1)?.varianti).toHaveLength(2);
    expect(stato.salvataggi[0].payload as Record<string, unknown>, 'con le taglie la scorta la tiene il trigger').not.toHaveProperty('stock');
  });

  it('E3 · senza rete il Salva aspetta le taglie rilette, e non parte da solo quando la rete torna', async () => {
    stato.taglie[ID] = async () => [ROSSO, BLU];
    onlineManager.setOnline(false);
    const { radice } = await apriModifica((qc) => inMemoriaModifica(qc, [ROSSO, BLU]));
    await scrivi(campoNome(radice), 'Lampada con dedica');
    await clic(radice, 'Salva modifiche');
    expect(nessunaScrittura().prodotto).toBe(0);
    expect(radice.textContent).toMatch(/taglie/i);

    await rete(true);
    expect(nessunaScrittura(), 'il Salva premuto senza rete è partito da solo al ritorno, con le taglie mai rilette').toEqual({ prodotto: 0, taglie: 0, copie: 0 });
    await clic(radice, 'Salva modifiche');
    expect(stato.salvataggi).toHaveLength(1);
  });

  it('E4 · le taglie in memoria cambiano mentre non c\'è rete: il testo non salvato non si perde', async () => {
    onlineManager.setOnline(false);
    const { radice, qc } = await apriModifica((q) => inMemoriaModifica(q, [ROSSO]));
    await scrivi(campoNome(radice), 'Lampada con dedica');
    await act(async () => { qc.setQueryData(chiaveTaglie, [ROSSO, BLU]); });
    await aspetta(60);
    expect(campoNome(radice)?.value, 'le taglie cambiate hanno rimontato il modulo: il testo è sparito').toBe('Lampada con dedica');
  });
});

describe('S01-001 · «Nuovo prodotto» e «Duplica»: torna la rete, il modulo resta', () => {
  it('N1 · Nuovo aperto senza rete: tornata la rete il testo resta, e la consegna non letta non si scrive', async () => {
    localStorage.setItem('mc_new_product_draft', JSON.stringify({
      name: 'Vaso in ceramica', description: 'Vaso in ceramica smaltata a mano, alto venti centimetri.',
      price: 18, stock: 2, category_id: 'c-casa', imageUrls: ['https://x/vaso.jpg'], attributes: {}, tags: [], unit: 'pezzo',
    }));
    onlineManager.setOnline(false);
    const { radice } = await apriNuovo((qc) => qc.setQueryData(queryKeys.categories.form, CATEGORIE));
    const campo = campoNome(radice);
    await scrivi(campo, 'Vaso blu in ceramica');

    await rete(true);
    expect(radice.textContent, 'tornata la rete il caricamento ha preso il posto del modulo').not.toContain('CARICAMENTO');
    // L'autosalvataggio della bozza può rimettere il nome, ma non le taglie né il resto: il modulo non deve smontarsi.
    expect(campoNome(radice), 'tornata la rete il modulo si è smontato e rimontato').toBe(campo);
    expect(campoNome(radice)?.value, 'tornata la rete il modulo si è rimontato: il testo scritto è sparito').toBe('Vaso blu in ceramica');

    await clic(radice, 'Pubblica prodotto');
    expect(stato.inserimenti).toHaveLength(1);
    expect(stato.inserimenti[0].name).toBe('Vaso blu in ceramica');
    expect(stato.inserimenti[0], 'il modulo aperto senza la risposta del negozio ha scritto una consegna indovinata').not.toHaveProperty('express_enabled');
  });

  it('D1 · Duplica aperta senza rete: tornata la rete il testo resta, e la copia nasce con le sue taglie', async () => {
    stato.cerca = `from=${SORGENTE}`;
    stato.taglie[SORGENTE] = async () => [ROSSO, BLU];
    onlineManager.setOnline(false);
    const { radice } = await apriNuovo((qc) => inMemoriaDuplica(qc, [ROSSO, BLU]));
    expect(campoNome(radice)?.value).toBe('Lampada da tavolo (copia)');
    const campo = campoNome(radice);
    await scrivi(campo, 'Lampada da tavolo verde');

    await rete(true);
    expect(radice.textContent).not.toContain('CARICAMENTO');
    expect(campoNome(radice), 'tornata la rete il modulo si è smontato e rimontato').toBe(campo);
    expect(campoNome(radice)?.value, 'tornata la rete il modulo si è rimontato: il testo scritto è sparito').toBe('Lampada da tavolo verde');

    await clic(radice, 'Pubblica prodotto');
    expect(stato.inserimenti).toHaveLength(1);
    expect(stato.inserimenti[0].name).toBe('Lampada da tavolo verde');
    expect(stato.inserimenti[0].stock, 'la scorta della copia è la somma delle sue taglie').toBe(5);
    expect(stato.variantiSalvate.at(-1)?.varianti).toHaveLength(2);
  });

  it('D2 · Duplica con la copia vecchia a 0 taglie, la rilettura delle taglie cade: Salva fermo con avviso, niente copia', async () => {
    stato.cerca = `from=${SORGENTE}`;
    let cade = true;
    stato.taglie[SORGENTE] = () => (cade ? Promise.reject(new Error('TypeError: Failed to fetch')) : Promise.resolve([ROSSO, BLU]));
    onlineManager.setOnline(false);
    const { radice } = await apriNuovo((qc) => inMemoriaDuplica(qc, []));
    await scrivi(campoNome(radice), 'Lampada da tavolo verde');

    await rete(true);
    expect(stato.letturePerTaglie, 'controprova: tornata la rete le taglie della sorgente si rileggono').toBeGreaterThan(0);
    expect(campoNome(radice)?.value, 'la rilettura caduta ha chiuso il modulo: il testo scritto è sparito').toBe('Lampada da tavolo verde');
    expect(radice.textContent).toMatch(/taglie/i);

    await clic(radice, 'Pubblica prodotto');
    expect(nessunaScrittura(), 'la copia è nata senza taglie e con la scorta della vecchia somma').toEqual({ prodotto: 0, taglie: 0, copie: 0 });

    // Le taglie arrivano, ma non sono quelle del modulo (2, non 0): ancora fermo.
    cade = false;
    await clic(radice, 'Riprova');
    await clic(radice, 'Pubblica prodotto');
    expect(nessunaScrittura().copie, 'la copia è nata con 0 taglie mentre la sorgente ne ha 2').toBe(0);

    await clic(radice, 'Riapri con le taglie aggiornate');
    await clic(radice, 'Pubblica prodotto');
    expect(stato.inserimenti).toHaveLength(1);
    expect(stato.inserimenti[0].stock).toBe(5);
    expect(stato.variantiSalvate.at(-1)?.varianti).toHaveLength(2);
  });

  it('D3 · Duplica: le taglie in memoria cambiano mentre non c\'è rete, il testo non si perde', async () => {
    stato.cerca = `from=${SORGENTE}`;
    onlineManager.setOnline(false);
    const { radice, qc } = await apriNuovo((q) => inMemoriaDuplica(q, [ROSSO]));
    await scrivi(campoNome(radice), 'Lampada da tavolo verde');
    await act(async () => { qc.setQueryData(['duplicate-variants', SORGENTE], [ROSSO, BLU]); });
    await aspetta(60);
    expect(campoNome(radice)?.value, 'le taglie cambiate hanno rimontato il modulo: il testo è sparito').toBe('Lampada da tavolo verde');
  });

  it('D4b · da «Nuovo» a «Duplica» senza rimontare la pagina: la copia non si apre vuota', async () => {
    stato.taglie[SORGENTE] = async () => [ROSSO, BLU];
    const { radice, disegna } = await apriNuovo();
    expect(pulsante(radice, 'Pubblica prodotto'), 'controprova: «Nuovo» è aperto').toBeTruthy();
    expect(campoNome(radice)?.value).toBe('');
    await scrivi(campoNome(radice), 'Bozza che non c\'entra');

    stato.cerca = `from=${SORGENTE}`;
    await disegna();
    await aspetta(80);
    expect(campoNome(radice)?.value, 'la copia si è aperta con il modulo di «Nuovo»').toBe('Lampada da tavolo (copia)');
  });

  it('K2 · da «Nuovo» a «Duplica» con la sorgente già in memoria: la copia non si apre vuota', async () => {
    stato.taglie[SORGENTE] = async () => [ROSSO, BLU];
    const { radice, qc, disegna } = await apriNuovo();
    expect(campoNome(radice)?.value).toBe('');
    await act(async () => { inMemoriaDuplica(qc, [ROSSO, BLU]); });

    stato.cerca = `from=${SORGENTE}`;
    await disegna();
    await aspetta(80);
    expect(campoNome(radice)?.value, 'la copia si è aperta con il modulo di «Nuovo»').toBe('Lampada da tavolo (copia)');
  });
});
