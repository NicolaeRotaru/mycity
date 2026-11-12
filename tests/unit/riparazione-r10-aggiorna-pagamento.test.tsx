/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * R10-022 — Con il pagamento dell'abbonamento non riuscito, «Aggiorna pagamento»
 * chiamava la cassa, che su un abbonamento già esistente risponde 409: il
 * negozio leggeva un errore invece di arrivare al portale dove si cambia la carta.
 */

vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<typeof import('@/lib/funzioni-al-lancio')>()),
  ABBONAMENTO_NEGOZI_ACCESO: true,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const incassi = vi.hoisted(() => ({ righe: [{ id: 'o1' }] as Array<{ id: string }>, filtro: '' }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'negozio-1' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ or: (f: string) => { incassi.filtro = f; return { limit: async () => ({ data: incassi.righe, error: null }) }; } }) }) }),
  },
}));

const { SubscriptionBanner } = await import('@/components/seller/SubscriptionBanner');

const chiamate: string[] = [];
beforeEach(() => {
  chiamate.length = 0;
  incassi.righe = [{ id: 'o1' }];
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    chiamate.push(String(url));
    return new Response(JSON.stringify({ url: 'https://stripe.example/x' }), { status: 200 });
  }));
  Object.defineProperty(window, 'location', { value: { href: '' }, writable: true, configurable: true });
});

async function disegna(status: string) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => root.render(createElement(SubscriptionBanner, { status })));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const testo = div.textContent ?? '';
  root.unmount();
  return testo;
}

async function premi(status: string) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => root.render(createElement(SubscriptionBanner, { status })));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const bottone = div.querySelector('button');
  expect(bottone).toBeTruthy();
  await act(async () => { bottone!.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  root.unmount();
}

describe('R10-022 — «Aggiorna pagamento» apre il portale', () => {
  it('pagamento non riuscito: il tasto chiama il portale, non la cassa', async () => {
    await premi('past_due');
    expect(chiamate).toEqual(['/api/seller/subscription/portal']);
  });
  it('senza abbonamento: il tasto chiama la cassa come prima', async () => {
    await premi('none');
    expect(chiamate).toEqual(['/api/seller/subscription/checkout']);
  });

  it('collaudo K03 (R10-020) — il negozio che non ha ancora incassato non riceve l’invito ad attivare', async () => {
    incassi.righe = [];
    expect(await disegna('none'), 'il banner invita chi la cassa poi rifiuta con 403').toBe('');
    incassi.righe = [{ id: 'o1' }];
    expect(await disegna('none')).toMatch(/Attiva/);
    expect(incassi.filtro).toContain('PAID');
  });
});
