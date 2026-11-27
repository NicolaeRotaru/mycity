import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 26/11/2026 — NELLA CHAT ASSISTENZA QUELLO CHE IL NEGOZIANTE APPROVA DEVE
 * ESSERE QUELLO CHE ENTRA.
 *
 * Il forno ha il Panettone aperto nella chat e chiede di sistemare tag e
 * descrizione. Prima di premere Applica deve leggere:
 *  - la descrizione nuova intera (a capo compresi), uguale a quella che il
 *    server salva;
 *  - nella scheda, la lista dei tag che il server salva davvero (quindici, in
 *    minuscolo, senza doppioni), non quella grezza del modello;
 *  - nessuna «Descrizione aggiornata» se la descrizione proposta è vuota;
 *  - i tag che spariscono, senza buchi per un tag NULL della scheda.
 * Gira la rotta vera con un modello finto: nessuna chiamata AI vera.
 */

const FAKE_USER = { id: 'forno-1', email: 'forno@x.it' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

const BASE = {
  id: 'cccccccc-0000-0000-0000-000000000001',
  name: 'Panettone', description: 'Lievito madre, uvetta nel Marsala.', price: 28, compare_at_price: null,
  unit: 'pezzo', condition: null, stock: 5, status: 'available', category_id: 'alim',
  images: [], attributes: {}, tags: ['dolci', 'natale'] as (string | null)[], has_variants: false,
};
let prodotto = { ...BASE };
const CATEGORIE = [{ id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null }];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'products'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [prodotto], error: null }) }) }) }) }
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

type Risposta = { reply: string; productId: string | null; patch: AiProductPatch; product: ProductSnapshot };

async function chiedi(patch: unknown): Promise<Risposta> {
  runMessageMock.mockResolvedValue({ text: '', toolInput: { reply: 'Ecco la proposta.', product_id: prodotto.id, patch } });
  const res = await POST(
    new Request('http://localhost/api/ai/catalog-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        focusProductId: prodotto.id,
        history: [{ role: 'user', content: 'sistema tag e descrizione del panettone' }],
      }),
    }) as never,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Risposta;
}

/** Le righe della scheda con Applica, calcolate come le calcola la chat. */
const scheda = (j: Risposta) => righeDellaProposta(j.patch, j.product);

describe('chat Assistenza: la proposta da approvare porta il testo che entra davvero', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    prodotto = { ...BASE, tags: [...BASE.tags] };
  });

  it('diciassette tag con maiuscole e doppioni: la scheda elenca i quindici che il server salva', async () => {
    const grezzi = ['Dolci', 'dolci', 'NATALE', ...Array.from({ length: 14 }, (_, i) => `Tag${i + 1}`)];
    const j = await chiedi({ tags: grezzi });
    const attesi = ['dolci', 'natale', ...Array.from({ length: 13 }, (_, i) => `tag${i + 1}`)];
    expect(j.patch.tags).toEqual(attesi);
    const rigaTag = scheda(j).find((r) => r.startsWith('Tag'));
    expect(rigaTag).toBe(`Tag → ${attesi.join(', ')}`);
    // Il quattordicesimo grezzo non entra: la scheda non lo promette.
    expect(rigaTag).not.toContain('tag14');
  });

  it('descrizione lunga con a capo: la risposta la porta intera e la proposta è quella che si salva', async () => {
    const corpo = Array.from({ length: 40 }, (_, i) => `Riga ${i + 1}: impasto a lunga lievitazione.`).join('\n');
    const j = await chiedi({ description: `   ${corpo}\n\n  ` });
    expect(j.patch.description).toBe(corpo);
    expect(j.reply).toContain(corpo);
  });

  it('descrizione di soli spazi: la scheda non dice «Descrizione aggiornata»', async () => {
    const j = await chiedi({ description: '   \n  ', price: 30 });
    expect(j.patch).not.toHaveProperty('description');
    expect(scheda(j).join('\n')).not.toMatch(/Descrizione/);
    expect(j.patch).toHaveProperty('price', 30);
  });

  it('un tag NULL nella scheda attuale non lascia un buco nella frase dei tag che spariscono', async () => {
    prodotto = { ...BASE, tags: [null, 'dolci'] };
    const j = await chiedi({ tags: ['natale'] });
    expect(j.reply).toMatch(/spariscono: dolci\./);
    expect(j.reply).not.toMatch(/spariscono: ,/);
  });
});
