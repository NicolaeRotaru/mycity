import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 27/11/2026 — NELLA CHAT ASSISTENZA IL NEGOZIANTE APPROVAVA UNA DESCRIZIONE
 * CHE NON AVEVA LETTO, E I TAG ATTUALI SPARIVANO SENZA ESSERE NOMINATI.
 *
 * Il forno ha il Panettone (quattro tag e una descrizione scritta a mano) e
 * chiede «aggiungi il tag senza canditi al panettone e scrivilo anche nella
 * descrizione». La scheda con Applica diceva «Descrizione aggiornata» e
 * «Tag → senza canditi»: il testo nuovo non si vedeva, e i quattro tag che
 * sparivano nessuno li nominava.
 *
 * Gira la rotta vera con un modello finto; la scheda si calcola come la
 * calcola la chat (`righeDellaProposta` sulla proposta e sul prodotto che la
 * rotta restituisce). Rossa se la scheda non mostra il testo nuovo o se i tag
 * esistenti spariscono senza essere nominati. Al primo messaggio (nessun
 * prodotto aperto) tag e descrizione non si propongono affatto.
 */

const FAKE_USER = { id: 'forno-1', email: 'forno@x.it' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

const PANETTONE = {
  id: 'cccccccc-0000-0000-0000-0000000000a1',
  name: 'Panettone',
  description: 'Lievitazione 36 ore, uvetta nel Marsala, canditi fatti in casa.',
  price: 28,
  compare_at_price: null,
  unit: 'pezzo',
  condition: null,
  stock: 5,
  status: 'available',
  category_id: 'alim',
  images: [],
  attributes: {},
  tags: ['dolci', 'natale', 'lievito-madre', 'artigianale-piacenza'],
  has_variants: false,
};
const CATEGORIE = [{ id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null }];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'products'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [PANETTONE], error: null }) }) }) }) }
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
import { righeDellaProposta } from '@/lib/products/prontoPerLaVendita';
import type { AiProductPatch } from '@/lib/products/aiPatch';
import type { ProductSnapshot } from '@/lib/products/aiSnapshot';

type Risposta = { reply: string; productId: string | null; patch: AiProductPatch; product: ProductSnapshot | null };

const DESCRIZIONE_NUOVA = 'Panettone artigianale senza canditi, con uvetta nel Marsala.';
const PROPOSTA = { tags: ['senza canditi'], description: DESCRIZIONE_NUOVA };

async function chiedi(focusProductId: string | undefined): Promise<Risposta> {
  runMessageMock.mockResolvedValue({ text: '', toolInput: { reply: 'Fatto, ecco la proposta.', product_id: PANETTONE.id, patch: PROPOSTA } });
  const res = await POST(
    new Request('http://localhost/api/ai/catalog-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(focusProductId ? { focusProductId } : {}),
        history: [{ role: 'user', content: 'aggiungi il tag senza canditi al panettone e scrivilo anche nella descrizione' }],
      }),
    }) as never,
  );
  expect(res.status).toBe(200);
  expect(runMessageMock, 'la rotta non ha chiamato il modello: la prova girerebbe a vuoto').toHaveBeenCalledTimes(1);
  return (await res.json()) as Risposta;
}

/** La scheda con Applica, calcolata come la calcola la chat. */
const scheda = (j: Risposta) => righeDellaProposta(j.patch, j.product!);

describe('chat Assistenza: la scheda con Applica fa leggere quello che cambia', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('a prodotto aperto: la scheda mostra il testo nuovo della descrizione, non «Descrizione aggiornata»', async () => {
    const j = await chiedi(PANETTONE.id);
    expect(j.patch.description).toBe(DESCRIZIONE_NUOVA);
    const righe = scheda(j);
    expect(righe.join('\n')).not.toContain('Descrizione aggiornata');
    expect(righe.some((r) => r.includes(DESCRIZIONE_NUOVA))).toBe(true);
  });

  it('a prodotto aperto: la scheda nomina i quattro tag che spariscono', async () => {
    const j = await chiedi(PANETTONE.id);
    const righe = scheda(j);
    expect(righe).toContain('Tag → senza canditi');
    expect(righe).toContain('Tag tolti dal prodotto: dolci, natale, lievito-madre, artigianale-piacenza');
  });

  it('i tag che restano (anche scritti in maiuscolo) non risultano tolti', () => {
    const righe = righeDellaProposta(
      { tags: ['Dolci', 'natale', 'senza canditi'] },
      { price: 28, categorySlug: 'alimentari', tags: PANETTONE.tags },
    );
    expect(righe).toContain('Tag tolti dal prodotto: lievito-madre, artigianale-piacenza');
    expect(righeDellaProposta({ tags: [...PANETTONE.tags, 'senza canditi'] }, { price: 28, categorySlug: 'alimentari', tags: PANETTONE.tags })
      .some((r) => r.startsWith('Tag tolti'))).toBe(false);
  });

  it('una descrizione di soli spazi non diventa una riga: il server non la scrive', () => {
    expect(righeDellaProposta({ description: '  \n ' }, { price: 28, categorySlug: 'alimentari' })).toEqual([]);
  });

  it('al primo messaggio (nessun prodotto aperto) tag e descrizione non si propongono', async () => {
    const j = await chiedi(undefined);
    expect(j.productId).toBe(PANETTONE.id);
    expect(j.patch).not.toHaveProperty('description');
    expect(j.patch).not.toHaveProperty('tags');
    expect(scheda(j)).toEqual([]);
  });
});
