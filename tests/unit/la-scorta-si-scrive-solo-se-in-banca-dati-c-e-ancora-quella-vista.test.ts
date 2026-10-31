/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * 31/10/2026 — IL MODULO MANDA LA SCORTA VISTA ACCANTO A QUELLA NUOVA.
 *
 * La porta di scrittura sa confrontare la scorta in banca dati con quella che
 * il negoziante aveva davanti — ma solo se qualcuno gliela porta. Qui si monta
 * il modulo vero e la pagina vera dell'amministrazione, e si guarda cosa parte
 * al salvataggio: il numero visto all'apertura deve viaggiare con la scorta
 * nuova, e le scorte viste delle varianti devono arrivare alla rotta.
 */

type Opzioni = { mutationFn?: (variabili: unknown) => Promise<unknown> };

vi.mock('@tanstack/react-query', async () => {
  const finto = await import('./aiuti/finti/react-query.mjs');
  return {
    ...finto,
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
const ID = '11111111-1111-4111-8111-111111111111';
const CATEGORIE = [{ id: 'cat-1', name: 'Panetteria', slug: 'panetteria', parent_id: null }];
const VARIANTI_VISTE = [
  { id: 'v-s', options: { Taglia: 'S' }, label: 'S', stock: 2 },
  { id: 'v-m', options: { Taglia: 'M' }, label: 'M', stock: 3 },
];

function valoriIniziali(extra: Record<string, unknown> = {}) {
  return {
    name: 'Focaccia genovese',
    description: 'Focaccia con olio extravergine, cotta nel forno a legna.',
    price: 4,
    compareAtPrice: null,
    unit: 'pezzo',
    condition: null,
    stock: 5,
    category_id: 'cat-1',
    images: ['https://mycity.test/focaccia.jpg'],
    attributes: {},
    tags: [],
    expressEnabled: true,
    status: 'available',
    variants: [],
    ...extra,
  };
}

type Schermo = ReturnType<typeof accendi>;

function scrivi(campo: HTMLInputElement | HTMLTextAreaElement, valore: string): void {
  const proto = campo instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(campo, valore);
  campo.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function campo(s: Schermo, nome: string): HTMLInputElement | HTMLTextAreaElement {
  const el = s.radice.querySelector(`[name="${nome}"]`);
  expect(el, `il campo «${nome}» non è a video: la prova girerebbe a vuoto`).not.toBeNull();
  return el as HTMLInputElement | HTMLTextAreaElement;
}

async function salva(s: Schermo): Promise<void> {
  const b = Array.from(s.radice.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes('Salva modifiche'));
  expect(b, 'il pulsante «Salva modifiche» non è a video').toBeTruthy();
  s.agisci(() => clicca(b as HTMLButtonElement));
  await attendi();
  await attendi();
}

async function apriModulo(iniziali = valoriIniziali()) {
  const salvati: Array<{ payload: Record<string, unknown>; ctx: Record<string, unknown> }> = [];
  const mod = await monta('components/seller/ProductForm.tsx');
  const s = accendi(mod.default, {
    mode: 'edit',
    categories: CATEGORIE,
    initialValues: iniziali,
    onSubmit: (payload: Record<string, unknown>, ctx: Record<string, unknown>) => salvati.push({ payload, ctx }),
    sellerOffersExpress: true,
    consegnaDelNegozioNonLetta: false,
  });
  expect((s.radice.textContent ?? '').replace(/\s+/g, ' '), 'il modulo non è a video').toContain('Salva modifiche');
  return { s, salvati };
}

describe('il modulo porta alla porta la scorta che il negoziante aveva davanti', () => {
  it('IL CASO CHE ROMPEVA — vista 5, scrive 8: accanto all\'8 parte il 5', async () => {
    const { s, salvati } = await apriModulo();
    s.agisci(() => scrivi(campo(s, 'stock'), '8'));
    await salva(s);
    expect(salvati, 'il salvataggio non è partito: la prova girerebbe a vuoto').toHaveLength(1);
    expect(Number(salvati[0].payload.stock)).toBe(8);
    expect(salvati[0].payload.stock_visto, 'la porta non sa cosa aveva davanti il negoziante').toBe(5);
    s.smonta();
  });

  it('con le varianti la scorta del prodotto non parte: la tiene il trigger', async () => {
    const { s, salvati } = await apriModulo(valoriIniziali({ stock: 7, variants: VARIANTI_VISTE }));
    s.agisci(() => scrivi(campo(s, 'price'), '5'));
    await salva(s);
    expect(salvati).toHaveLength(1);
    expect('stock' in salvati[0].payload, 'la somma vista riscrive la scorta del prodotto').toBe(false);
    s.smonta();
  });
});

describe('la pagina dell\'amministrazione passa le scorte viste alla rotta', () => {
  let fetchVera: typeof globalThis.fetch;
  const chiamate: Array<{ indirizzo: string; corpo: Record<string, unknown> }> = [];
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

  beforeEach(() => {
    chiamate.length = 0;
    globali.__CORSE__ = [];
    globali.__UTENTE__ = { id: 'admin-1' };
    globali.__GETTONE__ = 'gettone-della-prova';
    globali.__DATI_QUERY__ = (opzioni: { queryKey?: readonly unknown[] }) => {
      const chiave = (opzioni?.queryKey ?? []) as unknown[];
      if (chiave.includes('variants')) return VARIANTI_VISTE;
      if (chiave.some((p) => p === 'form')) return CATEGORIE;
      return PRODOTTO;
    };
    fetchVera = globalThis.fetch;
    globalThis.fetch = (async (indirizzo: string, init?: { body?: string }) => {
      chiamate.push({ indirizzo: String(indirizzo), corpo: JSON.parse(init?.body ?? '{}') });
      return { ok: true, json: async () => ({ ok: true, data: { ok: true } }) };
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetchVera;
    for (const k of ['__CORSE__', '__UTENTE__', '__GETTONE__', '__DATI_QUERY__']) delete globali[k];
  });

  it('IL CASO CHE ROMPEVA — corregge un refuso: le scorte viste delle taglie arrivano alla rotta', async () => {
    const mod = await monta('app/admin/products/[id]/edit/page.tsx', { veri: ['@tanstack/react-query'] });
    const s = accendi(mod.default, { params: { id: ID } });
    s.agisci(() => scrivi(campo(s, 'name'), 'Focaccia genovese DOP'));
    await salva(s);

    const corse = globali.__CORSE__ as Array<Promise<unknown>>;
    expect(corse, 'il salvataggio non è partito: la prova girerebbe a vuoto').toHaveLength(1);
    expect(await corse[0]).toBeNull();
    const patch = chiamate.find((c) => c.indirizzo === '/api/admin/products');
    expect(patch, 'la pagina non chiama la rotta dell\'amministrazione').toBeTruthy();
    expect(
      patch?.corpo.scorteViste,
      'le scorte viste si perdono: la S venduta mentre la scheda era aperta torna in vetrina',
    ).toEqual({ 'v-s': 2, 'v-m': 3 });
    s.smonta();
  });
});

describe('la modifica veloce dall\'elenco porta la scorta che aveva a video', () => {
  let fetchVera: typeof globalThis.fetch;
  const chiamate: Array<{ indirizzo: string; corpo: Record<string, unknown> }> = [];
  const RIGA = { id: 'prod-focaccia', name: 'Focaccia genovese', price: 4, status: 'available', images: [], stock: 5, categories: { name: 'Panetteria' } };

  beforeEach(() => {
    chiamate.length = 0;
    globali.__CORSE__ = [];
    globali.__UTENTE__ = { id: 'seller-1' };
    globali.__GETTONE__ = 'gettone-della-prova';
    globali.__DATI_QUERY__ = (o: { queryKey?: readonly unknown[] }) => {
      const chiave = (o?.queryKey ?? []) as unknown[];
      if (chiave.some((p) => p === 'venduti')) return {};
      return Object.assign([RIGA], { righe: [RIGA], totale: 1 });
    };
    fetchVera = globalThis.fetch;
    globalThis.fetch = (async (indirizzo: string, init?: { body?: string }) => {
      chiamate.push({ indirizzo: String(indirizzo), corpo: JSON.parse(init?.body ?? '{}') });
      return { ok: true, json: async () => ({ ok: true, data: { campi: ['stock'] } }) };
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetchVera;
    for (const k of ['__CORSE__', '__UTENTE__', '__GETTONE__', '__DATI_QUERY__']) delete globali[k];
  });

  it('IL CASO CHE ROMPEVA — a video 5, scrive 6: accanto al 6 parte il 5', async () => {
    const mod = await monta('app/seller/products/page.tsx', { veri: ['@tanstack/react-query'] });
    const s = accendi(mod.default, {});
    const bottone = (testo: string) =>
      Array.from(s.radice.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(testo));
    expect(bottone('Modifica in blocco'), 'il pulsante «Modifica in blocco» non è a video').toBeTruthy();
    s.agisci(() => clicca(bottone('Modifica in blocco') as HTMLButtonElement));
    const scorta = s.radice.querySelector(`[aria-label="Stock di ${RIGA.name}"]`) as HTMLInputElement | null;
    expect(scorta, 'il campo della scorta non è a video: la prova girerebbe a vuoto').not.toBeNull();
    s.agisci(() => scrivi(scorta as HTMLInputElement, '6'));
    s.agisci(() => clicca(bottone('Salva modifiche') as HTMLButtonElement));
    await attendi();
    await attendi();
    const corse = globali.__CORSE__ as Array<Promise<unknown>>;
    expect(corse, 'il salvataggio non è partito: la prova girerebbe a vuoto').toHaveLength(1);
    expect(await corse[0]).toBeNull();
    const payload = chiamate.find((c) => c.indirizzo === `/api/seller/products/${RIGA.id}`)?.corpo.payload as
      | Record<string, unknown>
      | undefined;
    expect(payload?.stock).toBe(6);
    expect(payload?.stock_visto, 'la porta non sa cosa aveva a video il negoziante').toBe(5);
    s.smonta();
  });
});
