// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Dopo «Aggiorna stato» il riquadro Stripe sceglieva il messaggio di conferma con la regola vecchia
 * (incassi E versamenti), mentre il resto del riquadro usa stripePronto (conto e versamenti). Con
 * gli incassi ancora in verifica e i versamenti attivi il messaggio diceva «mancano verifiche»
 * accanto a «Pagamenti attivi». Adesso il messaggio segue la stessa regola.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const st = vi.hoisted(() => ({
  risposta: {} as Record<string, unknown>,
  successi: [] as string[],
  avvisi: [] as string[],
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } },
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: async () => undefined }),
  useQuery: () => ({
    data: { stripe_account_id: 'acct_forno', stripe_charges_enabled: false, stripe_payouts_enabled: false, approval_status: 'approved' },
    isLoading: false, isError: false, refetch: vi.fn(),
  }),
}));
vi.mock('sonner', () => {
  const toast = Object.assign((m: string) => { st.avvisi.push(m); }, {
    success: (m: string) => { st.successi.push(m); },
    error: (m: string) => { st.avvisi.push(m); },
  });
  return { toast };
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function aggiornaStato(): Promise<void> {
  const { default: Connetti } = await import('@/components/seller/StripeConnectButton');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(Connetti)); });
  const bottone = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Aggiorna stato'));
  expect(bottone).toBeTruthy();
  await act(async () => { bottone!.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  st.successi.length = 0; st.avvisi.length = 0;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(st.risposta), { status: 200 })));
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null; host = null;
  vi.unstubAllGlobals();
});

describe('il messaggio dopo «Aggiorna stato» segue la regola del riquadro', () => {
  it('versamenti attivi, incassi ancora in verifica: «Pagamenti attivati!», non «mancano verifiche»', async () => {
    st.risposta = { connected: true, charges_enabled: false, payouts_enabled: true, currently_due: ['individual.verification.document'] };
    await aggiornaStato();
    expect(st.successi).toEqual(['Pagamenti attivati!']);
    expect(st.avvisi.join(' ')).not.toMatch(/Mancano ancora verifiche/);
  });

  it('controprova: incassi attivi ma versamenti no, con verifiche dovute: «mancano verifiche»', async () => {
    st.risposta = { connected: true, charges_enabled: true, payouts_enabled: false, currently_due: ['external_account'] };
    await aggiornaStato();
    expect(st.successi).toEqual([]);
    expect(st.avvisi.join(' ')).toMatch(/Mancano ancora verifiche/);
  });
});
