import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * S10 (5/11/2026) — la chat Assistenza del catalogo e il Copilot.
 * 1699: il filtro guarda tutti i messaggi del negoziante.
 * 2644: con una scheda aperta, la proposta su un ALTRO prodotto non passa intera.
 * 610: il prodotto aperto fuori dai 100 si carica; il catalogo tagliato si dice.
 * 250: il Copilot ha token in proporzione al catalogo.
 * 2671: le istruzioni dicono che oltre il 30% il prezzo si cambia dal modulo.
 */

const FAKE_USER = { id: 'forno-1', email: 'forno@x.it' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

const prodotto = (n: number) => ({
  id: `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, '0')}`,
  name: `Prodotto ${n}`, description: `Descrizione ${n}`, price: 3.5, compare_at_price: null,
  unit: 'pezzo', condition: null, stock: 5, status: 'available', category_id: 'alim',
  images: [], attributes: {}, tags: ['forno'], has_variants: false,
});
const CATEGORIE = [{ id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null }];

const db = vi.hoisted(() => ({
  catalogo: [] as Record<string, unknown>[],
  vecchio: null as Record<string, unknown> | null,
  totale: 0,
}));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table !== 'products') {
        return { select: () => ({ order: () => Promise.resolve({ data: CATEGORIE, error: null }) }) };
      }
      return {
        select: (_c: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) return { eq: () => Promise.resolve({ count: db.totale, data: null, error: null }) };
          return {
            eq: () => ({
              order: () => ({ limit: (n: number) => Promise.resolve({ data: db.catalogo.slice(0, n), error: null }) }),
              eq: (_c2: string, id: string) => ({
                limit: () => Promise.resolve({ data: db.vecchio && db.vecchio.id === id ? [db.vecchio] : [], error: null }),
              }),
            }),
          };
        },
      };
    },
  }),
}));
const testiFiltrati: string[] = [];
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return {
    ...actual,
    assertSafeText: async (t: string) => {
      testiFiltrati.push(t);
    },
  };
});
const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...(a as [])) };
});

import { POST as chat } from '@/app/api/ai/catalog-chat/route';
import { POST as copilot } from '@/app/api/ai/copilot/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const richiesta = (url: string, corpo: unknown) =>
  new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  }) as never;

const testoDelContesto = () => JSON.stringify(runMessageMock.mock.calls[0][0].messages[0]);

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitBuckets();
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  testiFiltrati.length = 0;
  db.catalogo = [prodotto(1), prodotto(2)];
  db.vecchio = null;
  db.totale = 2;
  runMessageMock.mockResolvedValue({ text: '', toolInput: { reply: 'Ecco', changes: [] } });
});

describe('la chat del catalogo filtra tutti i messaggi del negoziante (1699)', () => {
  it('un messaggio vecchio passa dal filtro insieme all\'ultimo', async () => {
    await chat(
      richiesta('/api/ai/catalog-chat', {
        history: [
          { role: 'user', content: 'MESSAGGIO-VECCHIO' },
          { role: 'assistant', content: 'Ops, qualcosa è andato storto' },
          { role: 'user', content: 'riprova' },
        ],
      }),
    );
    expect(testiFiltrati.join('\n')).toContain('MESSAGGIO-VECCHIO');
  });
});

describe('scheda aperta, proposta su un altro prodotto (2644)', () => {
  it('descrizione e tag dell\'altro prodotto non passano', async () => {
    const [aperto, altro] = db.catalogo as { id: string }[];
    runMessageMock.mockResolvedValue({
      text: '',
      toolInput: { reply: 'Ecco', product_id: altro.id, patch: { description: 'Scritta alla cieca', tags: ['nuovo'], name: 'Nome nuovo' } },
    });
    const res = await chat(
      richiesta('/api/ai/catalog-chat', { focusProductId: aperto.id, history: [{ role: 'user', content: 'cambia' }] }),
    );
    const json = (await res.json()) as { productId: string; patch: Record<string, unknown> };
    expect(json.productId).toBe(altro.id);
    expect(json.patch).not.toHaveProperty('description');
    expect(json.patch).not.toHaveProperty('tags');
  });
});

describe('oltre i 100 prodotti la chat lo sa (610)', () => {
  it('un prodotto aperto più vecchio dei 100 si carica per id', async () => {
    db.catalogo = Array.from({ length: 100 }, (_, i) => prodotto(i + 1));
    db.vecchio = prodotto(500);
    db.totale = 101;
    await chat(
      richiesta('/api/ai/catalog-chat', { focusProductId: db.vecchio.id, history: [{ role: 'user', content: 'dimmi' }] }),
    );
    expect(testoDelContesto()).toContain('Prodotto 500');
  });
  it('se il catalogo è più lungo, il modello sa che ne vede solo una parte', async () => {
    db.catalogo = Array.from({ length: 100 }, (_, i) => prodotto(i + 1));
    db.totale = 340;
    await chat(richiesta('/api/ai/catalog-chat', { history: [{ role: 'user', content: 'abbassa tutto' }] }));
    expect(testoDelContesto()).toMatch(/solo i 100 prodotti più recenti su 340/);
  });
  it('il Copilot lo dice anche al negoziante', async () => {
    db.catalogo = Array.from({ length: 200 }, (_, i) => prodotto(i + 1));
    db.totale = 260;
    const res = await copilot(richiesta('/api/ai/copilot', { instruction: 'abbassa tutto del 10%' }));
    const json = (await res.json()) as { reply: string };
    expect(json.reply).toMatch(/200 prodotti più recenti su 260/);
  });
});

describe('il Copilot ha token per tutto il catalogo (250)', () => {
  // R21-002 — Il tetto sale con il catalogo, ma non oltre quello che un fornitore lento (40 token al
  // secondo) scrive in un tentativo da 80 s: 3200. I 6000 di prima non stavano in nessun tempo.
  it('con 200 prodotti concede più dei 2048 di una chat, ma non oltre quello che arriva in un tentativo', async () => {
    db.catalogo = Array.from({ length: 200 }, (_, i) => prodotto(i + 1));
    db.totale = 200;
    await copilot(richiesta('/api/ai/copilot', { instruction: 'aggiungi il tag pane a tutto' }));
    const tetto = runMessageMock.mock.calls[0][0].max_tokens;
    expect(tetto).toBeGreaterThan(2048);
    expect(tetto).toBeLessThanOrEqual(3200);
  });
});

describe('le istruzioni dicono la regola del 30% sul prezzo (2671)', () => {
  it('chat e Copilot', async () => {
    await chat(richiesta('/api/ai/catalog-chat', { history: [{ role: 'user', content: 'ciao' }] }));
    await copilot(richiesta('/api/ai/copilot', { instruction: 'alza i prezzi' }));
    for (const c of runMessageMock.mock.calls) {
      expect(String(c[0].system)).toMatch(/al massimo del 30%/);
      expect(String(c[0].system)).toMatch(/modulo del prodotto/);
    }
    expect(runMessageMock.mock.calls).toHaveLength(2);
  });
});
