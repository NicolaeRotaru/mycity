/**
 * 22/8/2026 — NELLA CHAT DEL PRODOTTO COMPARIVA IL DIARIO DI BORDO.
 *
 * Il modello produce due testi. Uno e' la prosa che scrive mentre lavora:
 * «cerco sul web», «ho trovato tre schede simili». L'altro e' il campo che
 * riempie quando chiama lo strumento, cioe' la risposta che ha deciso di dare
 * al venditore.
 *
 * La prosa vinceva sempre. Con la ricerca sul web accesa — fino a cinque giri —
 * la prosa c'e' quasi ogni volta, perche' il modello commenta fra una ricerca e
 * l'altra e noi mettiamo insieme tutti i pezzi. Al venditore arrivava quel
 * commento al posto della risposta.
 *
 * La chat del catalogo fa gia' il contrario. Questa prova tiene le due chat
 * allineate: diventa rossa se la prosa torna a vincere.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      handler({ user: FAKE_USER, req }),
}));

const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

vi.mock('@/lib/ai/moderation', () => ({
  assertSafeText: vi.fn(async () => undefined),
  UnsafeContentError: class extends Error {},
}));

import { POST } from '@/app/api/ai/product-chat/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const DIARIO = 'Cerco sul web… ho trovato tre schede simili. Ora confronto i prezzi.';
const RISPOSTA = 'Ho aggiornato il titolo e aggiunto due tag.';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/product-chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

const BASE = {
  product: { name: 'Lampada' },
  history: [{ role: 'user', content: 'migliora il titolo' }],
};

describe('POST /api/ai/product-chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('vince la risposta curata dal modello, non il racconto della ricerca', async () => {
    runMessageMock.mockResolvedValue({ text: DIARIO, toolInput: { reply: RISPOSTA, patch: {} } });
    const json = await (await POST(makeReq(BASE))).json();
    expect(json.reply).toBe(RISPOSTA);
  });

  it('se il modello non ha curato nessuna risposta, si mostra la sua prosa', async () => {
    runMessageMock.mockResolvedValue({ text: DIARIO, toolInput: { patch: {} } });
    const json = await (await POST(makeReq(BASE))).json();
    expect(json.reply).toBe(DIARIO);
  });

  it('se non c\'è né l\'una né l\'altra, si dice «Fatto.» e non stringa vuota', async () => {
    runMessageMock.mockResolvedValue({ text: '', toolInput: { reply: '   ', patch: {} } });
    const json = await (await POST(makeReq(BASE))).json();
    expect(json.reply).toBe('Fatto.');
  });
});
