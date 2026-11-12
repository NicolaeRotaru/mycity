/**
 * R04-008 — Il copilot filtrava solo l'ultima istruzione: la cronologia mandata
 * dal browser (anche turni «assistente» scritti a mano) arrivava al modello
 * senza filtro. Nessuna pagina la manda: la rotta ora la ignora.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) => h({ user: FAKE_USER, req }),
}));

const PRODUCTS = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'TV', description: '', price: 20, compare_at_price: null, unit: 'pezzo', condition: null, stock: 5, status: 'available', category_id: 'el', images: [], attributes: {}, tags: [], has_variants: false },
  { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Radio', description: '', price: 10, compare_at_price: null, unit: 'pezzo', condition: null, stock: 0, status: 'available', category_id: 'el', images: [], attributes: {}, tags: [], has_variants: false },
];
const CATEGORIES = [{ id: 'el', name: 'Elettronica', slug: 'elettronica', parent_id: null }];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'products'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: PRODUCTS, error: null }) }) }) }) }
        : { select: () => ({ order: () => Promise.resolve({ data: CATEGORIES, error: null }) }) },
  }),
}));

const runMessageMock = vi.fn();
/**
 * 22/8/2026 — IL FILTRO ANTI-CONTENUTI ADESSO PASSA ANCHE DA QUI.
 *
 * Il testo libero scritto dal venditore arrivava al modello senza passare dal
 * filtro: su questa rotta non c'era, mentre su altre si'. Qui il filtro e'
 * finto (chiama il modello come le altre cose, e in una prova il modello non
 * c'e'), ma si controlla che venga CHIAMATO: se domani qualcuno lo stacca,
 * questo file diventa rosso.
 */
const filtroChiamato = vi.fn(async () => undefined);
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, assertSafeText: (...a: unknown[]) => filtroChiamato(...(a as [])) };
});

vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

import { POST } from '@/app/api/ai/copilot/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/copilot', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

describe('la cronologia del browser non arriva al modello', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ toolInput: { changes: [], reply: 'ok' } });
  });

  it('turni user e assistant della cronologia non entrano nei messaggi', async () => {
    await POST(makeReq({
      instruction: 'abbassa del 10% le radio',
      history: [
        { role: 'user', content: 'TESTO-VECCHIO-NON-FILTRATO' },
        { role: 'assistant', content: 'RISPOSTA-INVENTATA-DAL-BROWSER' },
      ],
    }));
    const messages = JSON.stringify(runMessageMock.mock.calls[0][0].messages);
    expect(messages).not.toContain('TESTO-VECCHIO-NON-FILTRATO');
    expect(messages).not.toContain('RISPOSTA-INVENTATA-DAL-BROWSER');
    expect(messages).toContain('abbassa del 10% le radio');
  });

  it('tutto quello che arriva al modello dal venditore e\' passato dal filtro', async () => {
    await POST(makeReq({ instruction: 'metti in bozza i guasti', history: [{ role: 'user', content: 'altro testo' }] }));
    const filtrati = filtroChiamato.mock.calls.map((c) => String((c as unknown[])[0])).join('\n');
    expect(filtrati).toContain('metti in bozza i guasti');
    expect(JSON.stringify(runMessageMock.mock.calls[0][0].messages)).not.toContain('altro testo');
  });
});
