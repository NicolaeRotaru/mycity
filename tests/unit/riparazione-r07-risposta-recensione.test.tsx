// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R07-020 (12/11/2026) — dopo aver risposto a una recensione, tornando sulla pagina il
 * negozio rivedeva la risposta vecchia: la risposta nuova restava solo nello stato della
 * scheda, e le recensioni in memoria (fresche 30 secondi, come in QueryProvider) erano
 * ancora quelle di prima.
 */
const db = vi.hoisted(() => ({ risposta: 'Grazie!' as string | null }));

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'negozio-1' } } }) },
    rpc: async () => ({ data: [], error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({
            data: [{
              id: 'rev-1', user_id: 'u1', rating: 5, comment: 'Buonissimo', created_at: '2026-11-10T10:00:00Z',
              order_id: 'ordine-123456', seller_reply: db.risposta, seller_reply_at: null,
            }],
            error: null,
          }),
        }),
      }),
    }),
  },
}));

import SellerReviewsPage from '@/app/seller/reviews/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let c: HTMLDivElement;
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function monta(qc: QueryClient) {
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(SellerReviewsPage))));
  for (let i = 0; i < 6; i++) await pausa();
}
async function smonta() {
  await act(async () => root.unmount());
  c.remove();
}
const bottone = (t: RegExp) => Array.from(c.querySelectorAll('button')).find((b) => t.test(b.textContent ?? '')) as HTMLButtonElement;

beforeEach(() => {
  db.risposta = 'Grazie!';
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: { body?: string }) => {
    db.risposta = JSON.parse(init?.body ?? '{}').reply;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('R07-020 · tornando sulla pagina si vede la risposta nuova', () => {
  it('modifica la risposta, esce e rientra entro 30 secondi: c è quella nuova', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    await monta(qc);
    expect(c.textContent).toContain('Grazie!');
    await act(async () => { bottone(/Modifica risposta/).click(); });
    const campo = c.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(campo, 'Grazie mille, a presto!');
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { bottone(/Pubblica|Invia|Salva/).click(); });
    for (let i = 0; i < 4; i++) await pausa();
    expect(c.textContent).toContain('Grazie mille, a presto!');
    await smonta();

    await monta(qc);
    expect(c.textContent).toContain('Grazie mille, a presto!');
    expect(c.textContent).not.toMatch(/La tua risposta\s*Grazie!(?! mille)/);
    await smonta();
  });
});
