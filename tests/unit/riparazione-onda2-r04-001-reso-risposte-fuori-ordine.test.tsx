// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R04-001 (onda 2, 28/11/2026) — DUE RISPOSTE FUORI ORDINE NON RIACCENDONO «HO CAMBIATO IDEA».
 *
 * La pagina del reso teneva un solo esito della domanda «il ripensamento si può offrire?». Ordine
 * misto: il cliente sceglie il miele, poi «Ho cambiato idea», poi il pane. Partono due domande; se
 * quella del miele (nessun rifiuto) torna DOPO quella del pane (rifiuto), sovrascrive l'esito: il
 * motivo si riaccende sul pane e la pagina non chiede più. Ora gli esiti stanno per riga.
 */
const stato = vi.hoisted(() => ({ ordine: null as unknown, chiamate: [] as string[], sospese: [] as Array<{ url: string; via: () => void }> }));

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'o1' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock('@/lib/storage/carica-immagine', () => ({ caricaImmagine: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'b1' } } }), getSession: async () => ({ data: { session: null } }) },
    from: (t: string) =>
      t === 'orders'
        ? { select: () => ({ eq: () => ({ single: async () => ({ data: stato.ordine, error: null }) }) }) }
        : { select: () => ({ eq: () => ({ in: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) },
  },
}));

import NewReturnPage from '@/app/orders/[id]/return/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let c: HTMLDivElement;

const RIGA_PANE = '22222222-2222-4222-8222-222222222222';
const RIGA_MIELE = '33333333-3333-4333-8333-333333333333';
const RIFIUTO = 'Questo prodotto (Pane casereccio) è escluso dal recesso: è fresco o fatto su ordinazione, e la legge non permette il reso per «Cambio idea» (art. 59 del Codice del Consumo).';
const riga = (id: string, nome: string) => ({ id, quantity: 1, unit_price: 3, product_name: nome, products: null });
const ordineMisto = () => ({
  id: 'o1', total_price: 8, delivery_status: 'DELIVERED',
  delivered_at: new Date(Date.now() - 86_400_000).toISOString(), created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  payment_method: 'card', stripe_payment_intent: 'pi_1', wallet_applied_cents: 0,
  order_items: [riga(RIGA_MIELE, 'Miele di acacia'), riga(RIGA_PANE, 'Pane casereccio')],
});

const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function monta() {
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  await act(async () => root.render(createElement(NewReturnPage)));
  for (let i = 0; i < 4; i++) await pausa();
}
const radio = (name: string, value: string) => c.querySelector(`input[type=radio][name=${name}][value="${value}"]`) as HTMLInputElement;
const ripensamento = () => radio('reason', 'CHANGED_MIND');
async function clicca(el: HTMLInputElement) {
  await act(async () => { el.click(); });
  for (let i = 0; i < 4; i++) await pausa();
}
/** Lascia andare la risposta sospesa per la riga data. */
async function rispondi(rigaId: string) {
  const i = stato.sospese.findIndex((s) => s.url.includes(`orderItemId=${rigaId}`));
  expect(i, `nessuna domanda in volo per la riga ${rigaId}`).toBeGreaterThanOrEqual(0);
  const [s] = stato.sospese.splice(i, 1);
  s.via();
  for (let k = 0; k < 4; k++) await pausa();
}

beforeEach(() => {
  stato.chiamate = [];
  stato.sospese = [];
  stato.ordine = ordineMisto();
  // Il server risponde come quello vero (pane escluso, miele no), ma ogni risposta resta sospesa
  // finché la prova non la lascia andare: cosi' si sceglie l'ordine d'arrivo.
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    stato.chiamate.push(url);
    const u = new URL(url, 'http://localhost');
    const rifiuto = u.searchParams.get('orderItemId') === RIGA_PANE ? RIFIUTO : null;
    return new Promise<Response>((ok) => {
      stato.sospese.push({ url, via: () => ok(new Response(JSON.stringify({ ok: true, rifiuto }), { status: 200 })) });
    });
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
  vi.unstubAllGlobals();
});

describe('R04-001 onda 2 · la pagina del reso con due risposte fuori ordine', () => {
  it('IL CASO CHE ROMPEVA — miele → «Ho cambiato idea» → pane; la risposta del miele arriva per ultima', async () => {
    await monta();
    await clicca(radio('articolo', RIGA_MIELE));
    await clicca(ripensamento());
    await clicca(radio('articolo', RIGA_PANE));
    expect(stato.sospese).toHaveLength(2);
    await rispondi(RIGA_PANE);
    expect(ripensamento().disabled).toBe(true);
    await rispondi(RIGA_MIELE);
    expect(ripensamento().disabled, 'la risposta del miele ha riacceso il ripensamento sul pane').toBe(true);
    expect(ripensamento().checked).toBe(false);
    expect(c.textContent).toMatch(/art\. 59/);
  });

  it('tornando al miele il motivo si riaccende senza richiedere, e tornando al pane si rispegne', async () => {
    await monta();
    await clicca(radio('articolo', RIGA_MIELE));
    await clicca(ripensamento());
    await clicca(radio('articolo', RIGA_PANE));
    await rispondi(RIGA_PANE);
    await rispondi(RIGA_MIELE);
    await clicca(radio('articolo', RIGA_MIELE));
    expect(ripensamento().disabled).toBe(false);
    await clicca(radio('articolo', RIGA_PANE));
    expect(ripensamento().disabled, 'tornando al pane il ripensamento resta offerto').toBe(true);
    expect(stato.sospese, 'la pagina ha richiesto una riga di cui sapeva già l\'esito').toHaveLength(0);
  });
});
