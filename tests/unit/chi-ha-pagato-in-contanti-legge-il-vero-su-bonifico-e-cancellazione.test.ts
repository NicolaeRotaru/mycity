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
 * Portata nella suite il 17/10 dal collaudo della semplificazione (collaudatore B, Squadra 3, giro 2).
 * Tre cose che chi ha pagato in contanti deve leggere vere: la FAQ e le impostazioni sulla
 * cancellazione dell'account, e la notifica che riceve quando il negozio segna il reso «rimborsato»
 * (il bonifico in quel momento e' solo da fare).
 *
 * Dal collaudo: la FAQ «Come elimino il mio account?» lega la sopravvivenza
 * dell'avviso con l'email a un rimborso «che ti dobbiamo». Ma sul sito non esiste un «fatto»: l'avviso
 * non sa se il bonifico è stato pagato, nessuna potatura lo cancella, e la cancellazione non lo tocca.
 * Resta con l'email anche dopo che il bonifico è stato pagato. La FAQ dice il vero solo finché il
 * bonifico è da fare; dopo, a chi ha già avuto i soldi dice che di lui resta solo la riga dei conti.
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
import { POST as avanza } from '@/app/api/returns/[id]/avanza/route';
import { cancellaAccount } from '@/lib/account/cancellazione';
import { eseguiPotature, type ClientePotature } from '@/lib/privacy/potature-ritenzione';

const ORDINE = 'a1b2c3d4-1111-4111-8111-111111111111';
const EMAIL = 'giulia.bianchi@example.it';
type Rotta = (r: Request, c: unknown) => Promise<Response>;
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

function inContanti(id: string): Riga {
  return {
    id, user_id: 'giulia', seller_id: 'negozio',
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
    orders: [inContanti(ORDINE)],
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
  document.body.innerHTML = '';
});

function rispostaDellaFaq(domanda: string): string {
  const s = accendi(Faq);
  const pulsante = Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).includes(domanda));
  expect(pulsante, `la domanda «${domanda}» non c'è`).toBeTruthy();
  s.agisci(() => clicca(pulsante!));
  const testo = testoVisibile(pulsante!.parentElement!.querySelector('div'));
  s.smonta();
  expect(testo).not.toBe('');
  return testo;
}

describe('collaudo B — la FAQ sulla cancellazione e l avviso che resta', () => {
  it('bonifico già pagato, poi la cliente cancella l account: l avviso con la sua email resta, la FAQ dice di no', async () => {
    // 1. Reso in contanti approvato: parte l'avviso con l'email.
    finto.utente = 'giulia';
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
    expect(deciso.status).toBe(200);
    const avvisi = () => notificheConTitolo(finto.db, 'Bonifico di rimborso da fare');
    expect(avvisi()).toHaveLength(1);

    // 2. L'amministratore fa il bonifico in banca. Sul sito NON esiste un passo che lo registri (D-«Semplifica»):
    //    niente cambia nel database. Il bonifico non è più dovuto.

    // 3. Un mese dopo Giulia, che non è più in credito di niente, cancella l'account.
    expect(await cancellaAccount(clienteDellaCancellazione() as never, 'giulia')).toMatchObject({ ok: true });

    // 4. Dieci anni di potature vere: l'avviso con l'email resta.
    const client = {
      from: finto.db.client.from,
      rpc: finto.db.client.rpc,
      storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    } as unknown as ClientePotature;
    avvisi()[0].created_at = new Date().toISOString();
    await eseguiPotature(client, { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, Date.now() + 10 * 365 * 86_400_000);
    expect(avvisi(), 'l avviso è sparito').toHaveLength(1);
    expect(String(avvisi()[0].body), 'l avviso non porta più l email').toContain(EMAIL);

    // 5. Cosa le aveva detto la FAQ prima di cancellare.
    const faq = rispostaDellaFaq('Come elimino il mio account?');
    expect(
      faq,
      'la FAQ lega l avviso con l email a un rimborso ancora DOVUTO; a bonifico pagato l avviso resta lo stesso, con l email, per sempre',
    ).not.toMatch(/Se ti dobbiamo un rimborso con bonifico[^.]*resta anche l'avviso/u);
  }, 120000);

  it('le impostazioni, dove si cancella, elencano cosa resta e non dicono dell avviso con l email', async () => {
    const g = globalThis as Record<string, unknown>;
    g.__UTENTE__ = { id: 'u1', email: 'giulia@esempio.it' };
    g.__RISPOSTA_SUPABASE__ = { data: [{ notif_order_updates: true, email_marketing: false }], error: null };
    g.fetch = async () => new Response(JSON.stringify({ pending: false }), { status: 200, headers: { 'content-type': 'application/json' } });
    const s = accendi(Impostazioni);
    await attendi();
    await attendi();
    const scheda = Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).trim() === 'Zona pericolosa');
    expect(scheda).toBeTruthy();
    s.agisci(() => clicca(scheda!));
    const testo = testoVisibile(s.radice);
    s.smonta();
    delete g.__UTENTE__;
    delete g.__RISPOSTA_SUPABASE__;
    expect(testo).toContain('Resta la riga dei conti');
    expect(testo, 'le impostazioni dicono cosa resta, ma non l avviso con l email che la FAQ e l informativa dicono').toMatch(/avviso/u);
  }, 60000);

  it('IL CASO CHE ROMPEVA — avanza su contanti non scrive al cliente «✓ Reso rimborsato» mentre il bonifico è ancora da fare', async () => {
    finto.utente = 'giulia';
    const aperto = await (apriReso as unknown as Rotta)(
      new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'CHANGED_MIND' })),
      undefined,
    );
    const id = (await aperto.json()).id as string;
    finto.utente = 'negozio';
    expect((await (decidi as unknown as Rotta)(new Request('http://localhost/x', json({ decision: 'APPROVED' })), { params: Promise.resolve({ id }) })).status).toBe(200);
    for (const stato of ['RECEIVED', 'REFUNDED'] as const) {
      const r = await (avanza as unknown as Rotta)(
        new Request('http://localhost/x', json(stato === 'REFUNDED' ? { stato, refundAmountCents: 4000 } : { stato })),
        { params: Promise.resolve({ id }) },
      );
      expect(r.status).toBe(200);
    }
    expect(String(finto.db.tabelle.orders[0].stripe_refund_id)).toMatch(/^bonifico:4000:/);
    const aGiulia = (finto.db.tabelle.notifications ?? []).filter((n) => n.user_id === 'giulia').map((n) => String(n.title));
    expect(aGiulia, 'il cliente legge «rimborsato» prima che parta il bonifico').not.toContain('✓ Reso rimborsato');
  }, 60000);
});
