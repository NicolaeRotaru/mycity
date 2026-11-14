// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R20-019 — Se la risposta a una recensione non parte, il negozio non deve leggere un errore
 * tecnico («Unexpected token '<'», «Internal Server Error»), e i tasti «Rispondi», «Annulla»
 * e «Pubblica risposta» devono essere alti almeno 44 px (min-h-11 / min-h-[44px]).
 */
const toastFinto = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: toastFinto }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'negozio-1' } } }) },
    rpc: async () => ({ data: [], error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({
            data: [{
              id: 'rev-1', user_id: 'u1', rating: 2, comment: 'Tardi', created_at: '2026-11-10T10:00:00Z',
              order_id: 'ordine-123456', seller_reply: null, seller_reply_at: null,
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
const bottone = (t: RegExp) => Array.from(c.querySelectorAll('button')).find((b) => t.test(b.textContent ?? '')) as HTMLButtonElement;
const alto44 = (el: HTMLElement) => /\bmin-h-11\b|min-h-\[(4[4-9]|[5-9]\d)px\]/.test(el.className);

async function apriERispondi(rispostaFinta: () => Response) {
  vi.stubGlobal('fetch', vi.fn(async () => rispostaFinta()));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(SellerReviewsPage))));
  for (let i = 0; i < 6; i++) await pausa();
  await act(async () => { bottone(/Rispondi/).click(); });
  const campo = c.querySelector('textarea') as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(campo, 'Ci scusiamo');
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { bottone(/Pubblica risposta/).click(); });
  for (let i = 0; i < 4; i++) await pausa();
}

beforeEach(() => { toastFinto.error.mockClear(); toastFinto.success.mockClear(); });
afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
  vi.unstubAllGlobals();
});

describe('R20-019 · la risposta alla recensione che non parte parla italiano', () => {
  it('un 504 con pagina HTML: l avviso non nomina JSON né «Unexpected token»', async () => {
    await apriERispondi(() => new Response('<html>504</html>', { status: 504, headers: { 'content-type': 'text/html' } }));
    expect(toastFinto.error).toHaveBeenCalledTimes(1);
    const testo = String(toastFinto.error.mock.calls[0][0]);
    expect(testo).not.toMatch(/unexpected token|json|<html/i);
    expect(testo).toMatch(/riprova/i);
  });

  it('un 500 col testo grezzo del server: l avviso non ripete «Internal Server Error»', async () => {
    await apriERispondi(() => new Response('Internal Server Error', { status: 500, headers: { 'content-type': 'text/plain' } }));
    const testo = String(toastFinto.error.mock.calls[0][0]);
    expect(testo).not.toMatch(/internal server error/i);
    expect(testo).toMatch(/riprova/i);
  });

  it('i tre tasti sono alti almeno 44 px', async () => {
    await apriERispondi(() => new Response('<html>504</html>', { status: 504 }));
    // dopo l errore il modulo resta aperto: «Annulla» e «Pubblica risposta» ci sono
    expect(alto44(bottone(/Annulla/))).toBe(true);
    expect(alto44(bottone(/Pubblica risposta/))).toBe(true);
    await act(async () => { bottone(/Annulla/).click(); });
    expect(alto44(bottone(/Rispondi/))).toBe(true);
  });
});
