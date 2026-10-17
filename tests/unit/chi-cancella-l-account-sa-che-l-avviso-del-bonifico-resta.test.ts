/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * CHI CANCELLA L'ACCOUNT SA CHE L'AVVISO DEL BONIFICO, CON LA SUA EMAIL, RESTA ANCHE A BONIFICO FATTO.
 *
 * Collaudo del 17/10, secondo giro. La FAQ «Come elimino il mio account?» diceva: «Se ti dobbiamo un
 * rimborso con bonifico già approvato, resta anche l'avviso interno con la tua email». Ma sul sito
 * non esiste un «pagato» (decisione di Nicola «Semplifica»: il bonifico si vede solo in banca),
 * nessuna potatura toglie l'avviso, e la cancellazione dell'account non lo tocca, apposta. Giulia,
 * rimborsata col bonifico il mese scorso, cancella l'account: la FAQ le diceva che di lei restava solo
 * la riga dei conti, mentre l'avviso con la sua email e il numero dell'ordine resta fra le notifiche
 * degli amministratori. E le impostazioni, dove si dà il consenso a cancellare, non lo dicevano proprio.
 *
 * La prova fa succedere la cosa vera: la rotta di reso e quella del negozio, `cancellaAccount` e dieci
 * anni di potature notturne, tutte VERE su un database finto. Poi monta la FAQ e le impostazioni vere
 * e pretende in tutte e due la stessa frase, senza la condizione «ti dobbiamo».
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, utente: 'giulia' }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_1' })) },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/api/middleware', () => {
  type Gestore = (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown;
  const conUtente = (chi: () => string) => (handler: Gestore) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: { id: chi() }, req, params: (await ctx?.params) ?? {} });
  return {
    withAuthRateLimit: (_o: unknown, handler: Gestore) => conUtente(() => finto.utente)(handler),
    withAdminAuth: conUtente(() => 'admin-1'),
  };
});

import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { cancellaAccount } from '@/lib/account/cancellazione';
import { eseguiPotature, type ClientePotature } from '@/lib/privacy/potature-ritenzione';

const ORDINE = 'a1b2c3d4-1111-4111-8111-111111111111';
const EMAIL = 'giulia.bianchi@example.it';
type Rotta = (r: Request, c: unknown) => Promise<Response>;
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

/** La frase, uguale nella FAQ e nelle impostazioni. */
const RESTA_L_AVVISO =
  "Se ti è stato approvato un rimborso con bonifico, già pagato o ancora da pagare, resta anche l'avviso interno con la tua email, finché non lo cancelliamo noi: serve a chi fa il bonifico per scriverti e pagarti.";

/** Una frase che lega l'avviso a un rimborso ancora dovuto: vera solo finché il bonifico è da fare. */
const SOLO_SE_ANCORA_DOVUTO = /ti dobbiamo[^.]*avviso|avviso[^.]*(?:ti dobbiamo|finché (?:non )?(?:ti )?(?:paghiamo|abbiamo pagato))/iu;

/** 40 € pagati in contanti al fattorino, consegnato e incassato ieri. */
function inContanti(): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio',
    total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    payment_status: 'PAID', cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(),
    internal_dispute_status: null,
    cash_photo_url: null, delivery_photo_url: null, cash_signature_url: null,
  };
}

/** Il client della cancellazione: chiudere l'account fa le cascate del database vero. */
function clienteDellaCancellazione() {
  return {
    from: finto.db.client.from,
    rpc: finto.db.client.rpc,
    auth: {
      admin: {
        getUserById: finto.db.client.auth.admin.getUserById,
        deleteUser: async (id: string) => {
          const t = finto.db.tabelle;
          t.notifications = (t.notifications ?? []).filter((n) => n.user_id !== id);
          t.profiles = (t.profiles ?? []).filter((p) => p.id !== id);
          for (const o of t.orders ?? []) if (o.user_id === id) o.user_id = null;
          for (const r of t.returns ?? []) if (r.buyer_id === id) r.buyer_id = null;
          finto.db.email[id] = null;
          return { error: null };
        },
      },
    },
    storage: { from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ error: null }) }) },
  };
}

let Faq: ComponentType<Record<string, unknown>>;
let Impostazioni: ComponentType<Record<string, unknown>>;
beforeAll(async () => {
  Faq = (await monta('app/faq/page.tsx')).default as ComponentType<Record<string, unknown>>;
  Impostazioni = (await monta('app/profile/settings/page.tsx')).default as ComponentType<Record<string, unknown>>;
}, 120000);

beforeEach(() => {
  finto.utente = 'giulia';
  finto.db = creaFintoDatabase({
    orders: [inContanti()],
    returns: [],
    order_items: [],
    disputes: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }, { id: 'giulia', role: 'buyer' }],
    notifications: [],
    cod_reconciliations: [],
  });
  finto.db.email.giulia = EMAIL;
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.__UTENTE__;
  delete g.__RISPOSTA_SUPABASE__;
  document.body.innerHTML = '';
});

/** La risposta della FAQ come la legge chi apre la domanda. */
function rispostaDellaFaq(domanda: string): string {
  const s = accendi(Faq);
  const pulsante = Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).includes(domanda));
  expect(pulsante, `la domanda «${domanda}» non c'è: la prova non sta guardando niente`).toBeTruthy();
  s.agisci(() => clicca(pulsante!));
  const testo = testoVisibile(pulsante!.parentElement!.querySelector('div'));
  s.smonta();
  expect(testo, `la risposta a «${domanda}» non si è aperta`).not.toBe('');
  return testo;
}

/** Quello che dice la scheda «Zona pericolosa» delle impostazioni, dove si chiede la cancellazione. */
async function zonaPericolosa(): Promise<string> {
  const g = globalThis as Record<string, unknown>;
  g.__UTENTE__ = { id: 'giulia', email: EMAIL };
  g.__RISPOSTA_SUPABASE__ = { data: [{ notif_order_updates: true, email_marketing: false }], error: null };
  vi.stubGlobal('fetch', async () =>
    new Response(JSON.stringify({ pending: false }), { status: 200, headers: { 'content-type': 'application/json' } }));
  try {
    const s = accendi(Impostazioni);
    await attendi();
    await attendi();
    const scheda = Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).trim() === 'Zona pericolosa');
    expect(scheda, 'la scheda «Zona pericolosa» non si trova: la prova non sta guardando niente').toBeTruthy();
    s.agisci(() => clicca(scheda!));
    const testo = testoVisibile(s.radice);
    s.smonta();
    expect(testo, 'la scheda non dice cosa resta: la prova non sta guardando niente').toContain('Resta la riga dei conti');
    return testo;
  } finally {
    vi.unstubAllGlobals();
  }
}

describe('cancellare l account dopo un rimborso col bonifico già pagato', () => {
  it('IL CASO CHE ROMPEVA — l avviso con l email resta: FAQ e impostazioni lo dicono, senza «ti dobbiamo»', async () => {
    // 1. Reso in contanti approvato dal negozio: parte l'avviso a chi paga, con l'email di Giulia.
    const aperto = await (apriReso as unknown as Rotta)(
      new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'CHANGED_MIND' })),
      undefined,
    );
    expect(aperto.status).toBe(201);
    const id = (await aperto.json()).id as string;
    finto.utente = 'negozio';
    const deciso = await (decidi as unknown as Rotta)(
      new Request('http://localhost/x', json({ decision: 'APPROVED', refundAmountCents: 4000 })),
      { params: Promise.resolve({ id }) },
    );
    expect(deciso.status, JSON.stringify(await deciso.clone().json())).toBe(200);
    const avvisi = () => notificheConTitolo(finto.db, 'Bonifico di rimborso da fare');
    expect(avvisi()).toHaveLength(1);

    // 2. L'amministratore fa il bonifico in banca. Sul sito non c'è un passo che lo registri: il
    //    database resta com'era. Il bonifico pagato e quello da pagare, qui, sono lo stesso stato.

    // 3. Un mese dopo Giulia, che non aspetta più niente, cancella l'account.
    expect(await cancellaAccount(clienteDellaCancellazione() as never, 'giulia')).toMatchObject({ ok: true });

    // 4. Dieci anni di potature notturne VERE: l'avviso con l'email c'è ancora.
    const client = {
      from: finto.db.client.from,
      rpc: finto.db.client.rpc,
      storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    } as unknown as ClientePotature;
    avvisi()[0].created_at = new Date().toISOString();
    await eseguiPotature(client, { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, Date.now() + 10 * 365 * 86_400_000);
    expect(avvisi(), 'l avviso è sparito: allora la frase «resta» non è più vera').toHaveLength(1);
    expect(String(avvisi()[0].body), 'l avviso non porta l email: allora la frase «con la tua email» non è più vera').toContain(EMAIL);

    // 5. Cosa le avevano detto, prima di cancellare, la FAQ e la pagina dove si cancella.
    const faq = rispostaDellaFaq('Come elimino il mio account?');
    const impostazioni = await zonaPericolosa();
    for (const [dove, testo] of [['la FAQ', faq], ['le impostazioni', impostazioni]] as const) {
      expect(testo, `${dove} non dice che l avviso con l email resta, anche a bonifico pagato`).toContain(RESTA_L_AVVISO);
      expect(testo, `${dove} lega l avviso a un rimborso ancora dovuto: a bonifico pagato l avviso resta lo stesso`).not.toMatch(
        SOLO_SE_ANCORA_DOVUTO,
      );
    }
  }, 120000);
});
