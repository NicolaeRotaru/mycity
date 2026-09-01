import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 27/8/2026 (R156) — LA CACHE DEL PROMPT COPRIVA LE ISTRUZIONI, NON IL BLOCCO
 * CHE PESA.
 *
 * `cache_control` compariva in due punti soli di tutto il progetto: l'ultimo
 * blocco delle istruzioni e l'ultimo strumento. Cioe' la parte piccola e
 * stabile. Nessun blocco dentro `messages` era mai cacheato.
 *
 * Ma nelle due chat il pezzo grosso e' proprio li': il primo messaggio utente
 * porta il catalogo (fino a cento prodotti), fino a dieci miniature e le foto
 * del venditore, e viene ricostruito identico a ogni turno. Su una
 * conversazione di dieci messaggi pagavamo dieci volte lo stesso catalogo e le
 * stesse dieci immagini — la voce di costo piu' grossa delle chat, ed era
 * l'unica che il meccanismo di cache non toccava.
 *
 * Il contesto e' stabile per tutta la conversazione: e' esattamente quello che
 * un punto di rottura della cache serve a riusare.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

const PRODOTTO = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'Lampada', description: 'in ottone', price: 20, compare_at_price: null,
  unit: 'pezzo', condition: null, stock: 3, status: 'available', category_id: 'casa',
  images: [], attributes: {}, tags: [], has_variants: false,
};
const CATEGORIE = [{ id: 'casa', name: 'Casa', slug: 'casa', parent_id: null }];

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

import { POST as CATALOG_CHAT } from '@/app/api/ai/catalog-chat/route';
import { POST as PRODUCT_CHAT } from '@/app/api/ai/product-chat/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function richiesta(url: string, corpo: unknown): never {
  return new Request(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
  }) as never;
}

type Blocco = { type: string; cache_control?: { type: string } };

function primoMessaggio(): { role: string; content: Blocco[] } {
  const arg = runMessageMock.mock.calls[0][0] as { messages: { role: string; content: Blocco[] }[] };
  return arg.messages[0];
}

function quantiPuntiDiRottura(): number {
  const arg = runMessageMock.mock.calls[0][0] as { messages: { content: unknown }[] };
  let n = 0;
  for (const m of arg.messages) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content as Blocco[]) if (b.cache_control) n++;
  }
  return n;
}

const CONVERSAZIONE = [
  { role: 'user', content: 'ciao' },
  { role: 'assistant', content: 'dimmi' },
  { role: 'user', content: 'quanto costa la lampada?' },
];

describe('la cache del prompt copre anche il catalogo e le foto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ text: 'ok', toolInput: { reply: 'ok' } });
  });

  it('chat del catalogo: il contesto ha il suo punto di rottura', async () => {
    await CATALOG_CHAT(richiesta('http://localhost/api/ai/catalog-chat', { history: CONVERSAZIONE }));
    const primo = primoMessaggio();
    const ultimo = primo.content[primo.content.length - 1];
    expect(
      ultimo.cache_control,
      'il catalogo e le miniature si rimandano interi a ogni turno: su dieci messaggi li paghiamo dieci volte',
    ).toEqual({ type: 'ephemeral' });
  });

  it('chat del prodotto: idem', async () => {
    await PRODUCT_CHAT(
      richiesta('http://localhost/api/ai/product-chat', { product: PRODOTTO, history: CONVERSAZIONE }),
    );
    const primo = primoMessaggio();
    const ultimo = primo.content[primo.content.length - 1];
    expect(ultimo.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('un punto di rottura solo: quello che viene dopo cambia a ogni turno', async () => {
    await CATALOG_CHAT(richiesta('http://localhost/api/ai/catalog-chat', { history: CONVERSAZIONE }));
    // Anthropic ne ammette quattro in tutto, e due sono gia' spesi su
    // istruzioni e strumenti: dentro i messaggi ne basta uno, in fondo al
    // contesto stabile. Metterlo anche sulla conversazione lo sposterebbe a
    // ogni turno, cioe' la cache non verrebbe mai riusata.
    expect(quantiPuntiDiRottura()).toBe(1);
  });
});
