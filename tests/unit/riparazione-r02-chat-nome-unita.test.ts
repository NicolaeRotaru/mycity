import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R02-005 — Nella chat Assistenza la scheda da approvare mostrava nome e unità
 * come li scrive il modello, non come li salva il server.
 *
 * Il server (`resolveAiPatch`) non scrive un nome di soli spazi, di un nome
 * lungo salva 120 caratteri, e un'unità fuori elenco (anche di soli spazi) la
 * ignora. La proposta che torna alla chat, e le righe della scheda con Applica,
 * devono dire lo stesso. Gira la rotta vera con un modello finto.
 */

const FAKE_USER = { id: 'forno-1', email: 'forno@x.it' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

const PRODOTTO = {
  id: 'cccccccc-0000-0000-0000-000000000005',
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
import type { AiProductPatch } from '@/lib/products/aiPatch';

type Risposta = { patch: AiProductPatch };

async function chiedi(patch: unknown): Promise<Risposta> {
  runMessageMock.mockResolvedValue({ text: '', toolInput: { reply: 'Ecco la proposta.', product_id: PRODOTTO.id, patch } });
  const res = await POST(
    new Request('http://localhost/api/ai/catalog-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ focusProductId: PRODOTTO.id, history: [{ role: 'user', content: 'sistema nome e unità' }] }),
    }) as never,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Risposta;
}

const NOME_LUNGO = `  ${'Panettone artigianale '.repeat(10)}  `; // oltre 200 caratteri
const NOME_SALVATO = NOME_LUNGO.trim().slice(0, 120);
const PRODOTTO_SCHEDA = { price: 28, categorySlug: 'alimentari', tags: ['dolci'] };

describe('chat Assistenza: la proposta che torna alla chat ha nome e unità come li salva il server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('nome di soli spazi e unità di soli spazi: la proposta non li porta', async () => {
    const j = await chiedi({ name: '    ', unit: '   ', price: 29 });
    expect(j.patch).not.toHaveProperty('name');
    expect(j.patch).not.toHaveProperty('unit');
    expect(j.patch).toHaveProperty('price', 29);
  });

  it('nome di oltre 200 caratteri: la proposta porta i 120 che il server salva', async () => {
    const j = await chiedi({ name: NOME_LUNGO });
    expect(j.patch.name).toBe(NOME_SALVATO);
  });

  it('unità fuori elenco («Kg»): la proposta non la porta; «kg» invece sì', async () => {
    expect((await chiedi({ unit: 'Kg', price: 29 })).patch).not.toHaveProperty('unit');
    expect((await chiedi({ unit: 'kg' })).patch.unit).toBe('kg');
  });
});

describe('la scheda con Applica legge nome e unità come li salva il server', () => {
  const righe = (patch: AiProductPatch) => righeDellaProposta(patch, PRODOTTO_SCHEDA);

  it('nome di soli spazi: nessuna riga «Nome»', () => {
    expect(righe({ name: '   ', price: 29 }).join('\n')).not.toMatch(/Nome/);
  });

  it('nome lungo: la riga mostra il nome pulito e tagliato a 120', () => {
    expect(righe({ name: NOME_LUNGO })).toContain(`Nome → "${NOME_SALVATO}"`);
  });

  it('unità di soli spazi o fuori elenco: nessuna riga «Unità»; un unità dell elenco sì', () => {
    expect(righe({ unit: '   ', price: 29 }).join('\n')).not.toMatch(/Unità/);
    expect(righe({ unit: 'Kg', price: 29 }).join('\n')).not.toMatch(/Unità/);
    expect(righe({ unit: 'kg' })).toContain('Unità → kg');
  });
});
