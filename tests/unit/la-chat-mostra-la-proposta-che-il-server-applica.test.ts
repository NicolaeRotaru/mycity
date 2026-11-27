import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 16/10/2026 (secondo collaudo) — LA CHAT ASSISTENZA MOSTRA LA PROPOSTA COME IL
 * SERVER LA APPLICHEREBBE.
 *
 * Il fornaio scrive «aggiungi il sesamo agli allergeni della focaccia». Il
 * modello propone `category_slug: "pane-e-forno"` (una sottocategoria) insieme
 * agli allergeni. Premendo Applica il server non sposta la focaccia — accetta
 * solo categorie di primo livello — e la focaccia resta fra gli Alimentari, che
 * il campo Allergeni ce l'hanno. Ma la scheda della proposta leggeva
 * «pane-e-forno» per buono: «Categoria → pane-e-forno» e «la scheda di questo
 * prodotto non ha il campo Allergeni». Due cose false.
 *
 * E una voce di un elenco che non si sa scrivere come testo (`{"toString":
 * null}`, un JSON valido) faceva cadere la chat mentre disegnava la scheda.
 *
 * Qui gira la rotta vera, con un modello finto, e la sua risposta passa dalla
 * stessa funzione che disegna la scheda nella chat (`righeDellaProposta`).
 */

const FAKE_USER = { id: 'forno-1', email: 'forno@x.it' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

const FOCACCIA = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'Focaccia', description: 'Focaccia genovese', price: 3.5, compare_at_price: null,
  unit: 'pezzo', condition: null, stock: 5, status: 'available', category_id: 'alim',
  images: [], attributes: { allergeni: 'glutine' }, tags: ['forno'], has_variants: false,
};
const CATEGORIE = [
  { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'pane', name: 'Pane e forno', slug: 'pane-e-forno', parent_id: 'alim' },
  { id: 'casa', name: 'Casa', slug: 'casa', parent_id: null },
  // Una categoria di primo livello che non ha caratteristiche sue.
  { id: 'gioc', name: 'Giocattoli', slug: 'giocattoli', parent_id: null },
];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'products'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [FOCACCIA], error: null }) }) }) }) }
        : { select: () => ({ order: () => Promise.resolve({ data: CATEGORIE, error: null }) }) },
  }),
}));
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, assertSafeText: async () => undefined };
});
const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...(a as [])) };
});

import { POST } from '@/app/api/ai/catalog-chat/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { avvisoSullaPubblicazione, righeDellaProposta } from '@/lib/products/prontoPerLaVendita';
import { productSnapshot } from '@/lib/products/aiSnapshot';

/** La focaccia come la vede la chat (lo snapshot che la rotta manda al browser). */
const snapshotDellaFocaccia = () => productSnapshot(FOCACCIA as never, CATEGORIE);
import { propostaPerLaChat } from '@/lib/products/aiPatch';

/** Chiede alla rotta vera, col modello che propone `patch`; restituisce la scheda della proposta. */
async function schedaDellaProposta(patch: unknown): Promise<{ patch: Record<string, unknown>; righe: string[] }> {
  runMessageMock.mockResolvedValue({ text: '', toolInput: { reply: 'Ecco la proposta', product_id: FOCACCIA.id, patch } });
  const chiamatePrima = runMessageMock.mock.calls.length;
  const res = await POST(
    new Request('http://localhost/api/ai/catalog-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ focusProductId: FOCACCIA.id, history: [{ role: 'user', content: 'sistema la focaccia' }] }),
    }) as never,
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as { patch: Record<string, unknown>; product: { price: number | null; categorySlug: string | null } };
  expect(runMessageMock.mock.calls.length, 'la rotta non ha chiamato il modello: la prova girerebbe a vuoto').toBe(
    chiamatePrima + 1,
  );
  return { patch: json.patch, righe: righeDellaProposta(json.patch, json.product) };
}

describe('la rotta della chat restituisce la proposta che il server saprebbe applicare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('una sottocategoria come categoria: la focaccia resta fra gli Alimentari, e la scheda rimanda al campo Allergeni', async () => {
    const { patch, righe } = await schedaDellaProposta({
      category_slug: 'pane-e-forno',
      subcategory_name: 'Focacce',
      attributes: { allergeni: 'glutine, sesamo' },
    });
    expect(patch).not.toHaveProperty('category_slug');
    expect(patch).not.toHaveProperty('subcategory_name');
    expect(righe).toEqual(['Allergeni → «glutine, sesamo»: NON si applica, lo scrivi tu nella scheda del prodotto']);
  });

  it('uno slug che non esiste: lo stesso', async () => {
    const { righe } = await schedaDellaProposta({ category_slug: 'forno', attributes: { allergeni: 'sesamo' } });
    expect(righe).toEqual(['Allergeni → «sesamo»: NON si applica, lo scrivi tu nella scheda del prodotto']);
  });

  it('controprova: una categoria vera di primo livello resta, e la scheda legge quella', async () => {
    const casa = await schedaDellaProposta({ category_slug: 'casa', attributes: { allergeni: 'sesamo' } });
    expect(casa.righe).toEqual([
      'Categoria → casa',
      'Allergeni → «sesamo»: NON si applica, e la scheda di questo prodotto non ha il campo Allergeni',
    ]);
    // Anche una di primo livello senza caratteristiche sue: il server la applica.
    const giochi = await schedaDellaProposta({ category_slug: 'giocattoli', attributes: { allergeni: 'sesamo' } });
    expect(giochi.patch).toHaveProperty('category_slug', 'giocattoli');
    expect(giochi.righe[1]).toBe('Allergeni → «sesamo»: NON si applica, e la scheda di questo prodotto non ha il campo Allergeni');
  });

  it('voci scritte male negli elenchi: la scheda si disegna e dice quello che il server leggerebbe', async () => {
    const { patch, righe } = await schedaDellaProposta({
      attributes_remove: [{ toString: null }, ['allergeni']],
      tags: [{ toString: null }, 'focaccia'],
    });
    expect(patch.attributes_remove).toEqual(['allergeni']);
    expect(patch.tags).toEqual(['focaccia']);
    expect(righe).toEqual(['Tag → focaccia', 'Rimuovi Allergeni: NON si applica, lo decidi tu nella scheda del prodotto']);
  });

  it('campi singoli scritti male (terzo collaudo): la scheda si disegna, e quei campi non entrano nella proposta', async () => {
    const ROTTO = { toString: null };
    const { patch, righe } = await schedaDellaProposta({
      name: 'Focaccia genovese',
      unit: ROTTO,
      condition: ROTTO,
      status: ROTTO,
      compare_at_price: ROTTO,
      price: '4',
      stock: ROTTO,
      unlimited_stock: 'sì',
      category_slug: 'alimentari',
      subcategory_name: ROTTO,
    });
    for (const campo of ['unit', 'condition', 'status', 'compare_at_price', 'price', 'stock', 'unlimited_stock', 'subcategory_name']) {
      expect(patch, campo).not.toHaveProperty(campo);
    }
    expect(righe).toEqual(['Nome → "Focaccia genovese"', 'Categoria → alimentari']);
  });

  it('controprova: «togli la condizione» e «togli il prezzo pieno» (null) restano nella proposta', async () => {
    const { patch, righe } = await schedaDellaProposta({ condition: null, compare_at_price: null, unit: 'kg', price: 4 });
    expect(patch).toEqual({ condition: null, compare_at_price: null, unit: 'kg', price: 4 });
    // Il prezzo lo scrive `formatPrice`, con lo spazio che non va a capo prima di «€».
    expect(righe.map((r) => r.replace(/\u00a0/g, ' '))).toEqual(['Prezzo: 3,50 € → 4,00 €', 'Rimuovi prezzo pieno', 'Unità → kg', 'Condizione → non specificata']);
  });

  it('gli attributi senza un testo spariscono: la scheda della proposta li leggerebbe col server, e cadeva', async () => {
    const ROTTO = { toString: null };
    const { patch } = await schedaDellaProposta({
      status: 'available',
      attributes: { allergeni: ROTTO, colore: 42, marca: 'Forno Rossi' },
    });
    expect(patch.attributes).toEqual({ marca: 'Forno Rossi' });
    // La scheda di una proposta «in vendita» rilegge la scheda come il server:
    // con la proposta grezza cadeva («Cannot convert object to primitive value»).
    const inBozza = { ...snapshotDellaFocaccia(), status: 'draft' };
    expect(() => avvisoSullaPubblicazione(inBozza, patch)).not.toThrow();
    // Un oggetto che non e' un oggetto di attributi non diventa una proposta.
    const lista = await schedaDellaProposta({ attributes: ['allergeni', 'glutine'], name: 'Focaccia genovese' });
    expect(lista.patch).toEqual({ name: 'Focaccia genovese' });
  });

  it('una proposta che e un elenco non e una proposta', async () => {
    const { patch, righe } = await schedaDellaProposta(['name', 'Focaccia']);
    expect(patch).toEqual({});
    expect(righe).toEqual([]);
  });

  it('un elenco di tag tutto illeggibile non diventa «togli tutti i tag»', async () => {
    const { patch } = await schedaDellaProposta({ tags: [{ toString: null }], name: 'Focaccia genovese' });
    expect(patch).not.toHaveProperty('tags');
    expect(patch).toHaveProperty('name', 'Focaccia genovese');
  });
});

describe('propostaPerLaChat, da sola', () => {
  it('lascia com e una proposta gia giusta', () => {
    const giusta = { name: 'Focaccia', category_slug: 'alimentari', subcategory_name: 'Pane e forno', tags: ['a'], attributes_remove: ['colore'] };
    expect(propostaPerLaChat(giusta, CATEGORIE)).toEqual(giusta);
  });

  it('una categoria che non e un testo sparisce', () => {
    expect(propostaPerLaChat({ category_slug: ['casa'] } as unknown as object, CATEGORIE)).toEqual({});
    expect(propostaPerLaChat({ category_slug: { a: 1 } } as unknown as object, CATEGORIE)).toEqual({});
  });
});
