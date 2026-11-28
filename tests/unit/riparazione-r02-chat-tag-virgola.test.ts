import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R02-009 — Nella chat Assistenza un tag che finisce con spazio e virgola
 * («Dolci ,») compariva come doppione sulla scheda ma il server non lo salvava.
 *
 * `tagDelPatch` non dava lo stesso risultato passata due volte: «Dolci ,»
 * diventava «dolci » e poi «dolci». La chat la passa una volta, il server una
 * seconda premendo Applica. Gira la rotta vera con un modello finto.
 */

const FAKE_USER = { id: 'forno-1', email: 'forno@x.it' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

const PRODOTTO = {
  id: 'cccccccc-0000-0000-0000-000000000009',
  name: 'Panettone', description: 'Lievito madre.', price: 28, compare_at_price: null,
  unit: 'pezzo', condition: null, stock: 5, status: 'available', category_id: 'alim',
  images: [], attributes: {}, tags: ['dolci'], has_variants: false,
};
const CATEGORIE = [{ id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null }];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'products'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [PRODOTTO], error: null }) }) }) }) }
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
import { tagDelPatch, type AiProductPatch } from '@/lib/products/aiPatch';

type Risposta = { patch: AiProductPatch };

async function chiedi(patch: unknown): Promise<Risposta> {
  runMessageMock.mockResolvedValue({ text: '', toolInput: { reply: 'Ecco la proposta.', product_id: PRODOTTO.id, patch } });
  const res = await POST(
    new Request('http://localhost/api/ai/catalog-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ focusProductId: PRODOTTO.id, history: [{ role: 'user', content: 'sistema i tag' }] }),
    }) as never,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Risposta;
}

const PRODOTTO_SCHEDA = { price: 28, categorySlug: 'alimentari', tags: ['dolci'] };

describe('tag con spazio e virgola finali: la scheda mostra quello che il server salva', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('tagDelPatch passata due volte da lo stesso risultato', () => {
    const grezzi = ['Dolci ,', 'dolci', 'Natale , ,', ' Pane,  '];
    const una = tagDelPatch(grezzi);
    expect(una).toEqual(['dolci', 'natale', 'pane']);
    expect(tagDelPatch(una)).toEqual(una);
  });

  it('["Dolci ,", "dolci"]: la proposta e la scheda dicono «dolci» una volta, come salva il server', async () => {
    const j = await chiedi({ tags: ['Dolci ,', 'dolci'] });
    expect(j.patch.tags).toEqual(['dolci']);
    expect(tagDelPatch(j.patch.tags ?? [])).toEqual(j.patch.tags);
    expect(righeDellaProposta(j.patch, PRODOTTO_SCHEDA)).toContain('Tag → dolci');
  });

  it('sedici tag tipo «x ,» e «x»: la scheda elenca gli stessi che il server salva', async () => {
    const lettere = 'abcdefgh'.split('');
    const j = await chiedi({ tags: lettere.flatMap((x) => [`${x.toUpperCase()} ,`, x]) });
    expect(j.patch.tags).toEqual(lettere);
    expect(tagDelPatch(j.patch.tags ?? [])).toEqual(lettere);
    expect(righeDellaProposta(j.patch, PRODOTTO_SCHEDA)).toContain(`Tag → ${lettere.join(', ')}`);
  });
});
