import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R04-015 — I tagli contro i costi contavano le voci degli elenchi ma non la
 * loro lunghezza: una richiesta sotto il megabyte riempiva la finestra del
 * modello, e un elemento null faceva cadere la rotta. Adesso ogni testo ha il
 * suo tetto e si tengono solo gli oggetti, su tutte le rotte che li ricevono.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, assertSafeText: async () => undefined };
});
const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

import { POST as improve } from '@/app/api/ai/improve-product/route';
import { POST as productChat } from '@/app/api/ai/product-chat/route';
import { POST as barcode } from '@/app/api/ai/barcode-lookup/route';
import { buildProductContext } from '@/lib/ai/productContext';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const ENORME = 'x'.repeat(200_000);
const ELENCHI = {
  attributeSchema: [null, { key: `k${ENORME}`, type: 'select', options: Array.from({ length: 5000 }, (_, i) => `opzione-${i}-${'y'.repeat(30)}`) }],
  topCategories: [null, { slug: `s${ENORME}`, name: `n${ENORME}` }],
};
const req = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never;

const lunghezzaPrompt = () => JSON.stringify(runMessageMock.mock.calls[0][0].messages).length;

describe('gli elenchi del browser entrano col loro tetto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ text: 'ok', toolInput: { reply: 'ok', found: false, summary: 'ok', patch: {} } });
  });

  it('migliora prodotto: niente 500 e un prompt di poche migliaia di caratteri', async () => {
    const res = await improve(req('/api/ai/improve-product', { product: { name: 'Maglietta', price: 20 }, ...ELENCHI }));
    expect(res.status).toBeLessThan(500);
    expect(runMessageMock).toHaveBeenCalled();
    expect(lunghezzaPrompt()).toBeLessThan(20_000);
  });

  it('chat del prodotto: niente 500 e prompt contenuto', async () => {
    const res = await productChat(req('/api/ai/product-chat', { product: { name: 'Maglietta' }, history: [{ role: 'user', content: 'ciao' }], ...ELENCHI }));
    expect(res.status).toBeLessThan(500);
    expect(lunghezzaPrompt()).toBeLessThan(20_000);
  });

  it('codice a barre: niente 500 e prompt contenuto', async () => {
    const res = await barcode(req('/api/ai/barcode-lookup', { ean: '8000500310427', ...ELENCHI }));
    expect(res.status).toBeLessThan(500);
    expect(lunghezzaPrompt()).toBeLessThan(20_000);
  });

  it('il costruttore condiviso non cade su un elemento null', () => {
    expect(() => buildProductContext({ product: { name: 'x' }, ...ELENCHI } as never)).not.toThrow();
  });
});
