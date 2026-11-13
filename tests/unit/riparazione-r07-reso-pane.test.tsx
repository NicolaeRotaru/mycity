// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R07-002 (12/11/2026) — la pagina del reso offriva «Ho cambiato idea» anche su un
 * ordine di solo pane. Il server lo rifiuta (art. 59 Cod. Cons.): la pagina ora
 * appena si sceglie quel motivo chiede l'esito al server (/api/returns/ripensamento), toglie e spegne la scelta e dice perché.
 * Su un ordine misto la scelta resta; se la domanda cade, decide il server all'invio.
 */
const stato = vi.hoisted(() => ({ risposta: null as null | { status: number; corpo: unknown }, chiamate: [] as string[] }));

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'o1' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'b1' } } }), getSession: async () => ({ data: { session: null } }) },
    from: (t: string) =>
      t === 'orders'
        ? {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'o1', total_price: 8, delivery_status: 'DELIVERED',
                    delivered_at: new Date(Date.now() - 86_400_000).toISOString(), created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
                    payment_method: 'card', stripe_payment_intent: 'pi_1', wallet_applied_cents: 0,
                  },
                  error: null,
                }),
              }),
            }),
          }
        : { select: () => ({ eq: () => ({ in: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) },
  },
}));

import NewReturnPage from '@/app/orders/[id]/return/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let c: HTMLDivElement;
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function monta() {
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  await act(async () => root.render(createElement(NewReturnPage)));
  for (let i = 0; i < 4; i++) await pausa();
}
const ripensamento = () => c.querySelector('input[type=radio][value=CHANGED_MIND]') as HTMLInputElement;
async function scegliRipensamento() {
  await act(async () => { ripensamento().click(); });
  for (let i = 0; i < 4; i++) await pausa();
}
const RIFIUTO = 'Questo prodotto (Pane casereccio) è escluso dal recesso: … (art. 59 del Codice del Consumo).';

beforeEach(() => {
  stato.chiamate = [];
  stato.risposta = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    stato.chiamate.push(url);
    if (!stato.risposta) throw new Error('rete giù');
    return new Response(JSON.stringify(stato.risposta.corpo), { status: stato.risposta.status });
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
  vi.unstubAllGlobals();
});

describe('R07-002 · «Ho cambiato idea» non si offre su un ordine di soli esclusi', () => {
  it('il server dice che il ripensamento è escluso: la scelta è spenta e la pagina dice perché', async () => {
    stato.risposta = { status: 200, corpo: { ok: true, rifiuto: RIFIUTO } };
    await monta();
    await scegliRipensamento();
    expect(ripensamento().checked).toBe(false);
    expect(stato.chiamate.some((u) => u.startsWith('/api/returns/ripensamento?orderId=o1'))).toBe(true);
    expect(ripensamento().disabled).toBe(true);
    expect(c.textContent).toMatch(/art\. 59/);
    expect((c.querySelector('input[type=radio][value=DAMAGED]') as HTMLInputElement).disabled).toBe(false);
  });

  it('ordine misto: nessun rifiuto, la scelta resta', async () => {
    stato.risposta = { status: 200, corpo: { ok: true, rifiuto: null } };
    await monta();
    await scegliRipensamento();
    expect(ripensamento().disabled).toBe(false);
    expect(ripensamento().checked).toBe(true);
    expect(c.textContent).not.toMatch(/art\. 59/);
  });

  it('la domanda cade: la pagina non decide al buio, la scelta resta', async () => {
    await monta();
    await scegliRipensamento();
    expect(ripensamento().disabled).toBe(false);
    expect(ripensamento().checked).toBe(true);
  });
});
