// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * IL CLIENTE RITIRA LA SUA RICHIESTA DI RESO, DALLA SUA PAGINA.
 *
 * 31/10/2026 — La scheda del negozio, su un recesso in attesa, dice «se il cliente ci ha
 * ripensato, puo' ritirare lui la richiesta: il bonifico riparte subito». La rotta `avanza`
 * lo permette (CANCELED dal cliente dell'ordine, finche' la merce non e' partita). Ma
 * nessuna pagina del cliente la chiamava: il negozio aspettava un gesto che il cliente non
 * poteva fare, e il bonifico restava fermo.
 *
 * Qui si monta la pagina vera del reso con un recesso aperto: c'e' «Ritira la richiesta»,
 * e premuto chiama avanza con CANCELED. Con la merce gia' in viaggio il pulsante non c'e'.
 */

const stato = vi.hoisted(() => ({
  reso: null as { id: string; status: string } | null,
  push: [] as string[],
  chiamate: [] as Array<{ url: string; corpo: unknown }>,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'o1' }),
  useRouter: () => ({ push: (u: string) => stato.push.push(u) }),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
      getUser: async () => ({ data: { user: { id: 'b1' } } }),
    },
    from: (tabella: string) => {
      if (tabella === 'orders') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'o1', total_price: 30, delivery_status: 'DELIVERED',
                  delivered_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
                  payment_method: 'card', stripe_payment_intent: 'pi_1', wallet_applied_cents: 0,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ in: () => ({ limit: async () => ({ data: stato.reso ? [stato.reso] : [], error: null }) }) }),
        }),
      };
    },
  },
}));

import NewReturnPage from '@/app/orders/[id]/return/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let contenitore: HTMLDivElement;

async function monta() {
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  root = createRoot(contenitore);
  await act(async () => root.render(createElement(NewReturnPage)));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
const pulsanteRitira = () =>
  Array.from(contenitore.querySelectorAll('button')).find((b) => /Ritira la richiesta/.test(b.textContent ?? ''));

beforeEach(() => {
  stato.reso = null;
  stato.push = [];
  stato.chiamate = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      stato.chiamate.push({ url, corpo: init?.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify({ ok: true, status: 'CANCELED' }), { status: 200 });
    }),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  contenitore.remove();
  vi.unstubAllGlobals();
});

describe('il cliente puo ritirare il recesso che ha chiesto', () => {
  it('recesso in attesa: c\'e\' «Ritira la richiesta», e chiama avanza con CANCELED', async () => {
    stato.reso = { id: 'r1', status: 'REQUESTED' };
    await monta();
    const bottone = pulsanteRitira();
    expect(bottone).toBeTruthy();
    await act(async () => {
      bottone!.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(stato.chiamate).toEqual([{ url: '/api/returns/r1/avanza', corpo: { stato: 'CANCELED' } }]);
    expect(stato.push).toEqual(['/orders/o1']);
  });

  it('recesso approvato, merce non ancora spedita: si ritira ancora', async () => {
    stato.reso = { id: 'r1', status: 'APPROVED' };
    await monta();
    expect(pulsanteRitira()).toBeTruthy();
  });

  it('merce gia in viaggio: niente pulsante, e la pagina dice perche', async () => {
    stato.reso = { id: 'r1', status: 'SHIPPED_BACK' };
    await monta();
    expect(pulsanteRitira()).toBeFalsy();
    expect(contenitore.textContent).toMatch(/non si può più ritirare/);
  });

  it('nessun reso aperto: il modulo per chiederlo, senza pulsante di ritiro', async () => {
    await monta();
    expect(pulsanteRitira()).toBeFalsy();
    expect(contenitore.textContent).toMatch(/Richiedi un reso/);
  });
});
