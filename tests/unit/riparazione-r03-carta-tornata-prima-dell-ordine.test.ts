import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R03-008 — Se il cliente viene rimborsato (o contesta) prima che il suo ordine nasca,
 * l'ordine non nasce «pagato» e il negozio non viene pagato.
 *
 * L'avviso «pagamento completato» fallisce per due ore; Nicola rimborsa la cliente dal
 * cruscotto; poi l'avviso passa. Prima nasceva un ordine PAID/HELD: il forno preparava e il
 * giro dei bonifici gli versava il netto. Ora la carta riletta da Stripe dice «rimborsata»:
 * l'ordine nasce annullato, col bonifico al negozio non pagabile, senza campanella al negozio,
 * e chi amministra riceve l'avviso.
 */

const stato = vi.hoisted(() => ({
  carica: 'ch_1' as unknown,
  pendingStatus: 'PENDING',
  inseriti: [] as Array<{ tabella: string; valori: Record<string, unknown> }>,
  aggiornati: [] as Array<{ tabella: string; valori: Record<string, unknown> }>,
}));

vi.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => { void fn; },
  NextResponse: { json: (b: unknown, i?: ResponseInit) => new Response(JSON.stringify(b), i) },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true }) }));
vi.mock('@/lib/email/templates', () => ({
  orderConfirmedBuyerTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
  newOrderSellerTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
}));
vi.mock('@/lib/analytics/server', () => ({ analyticsConsentita: async () => true, contaAcquisto: async () => {} }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ paymentIntents: { retrieve: async () => ({ latest_charge: stato.carica }) } }),
  computeOrderSplit: () => ({ applicationFeeCents: 300, sellerPayoutCents: 2700 }),
}));

const pending = () => ({
  id: 'pc_1', buyer_id: 'cliente-1', status: stato.pendingStatus, total_cents: 3000, stripe_session_id: 'cs_1',
  coupon_code: null, pickup_in_store: false, expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  delivery: { full_name: 'Maria Rossi', phone: '333', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', notes: null, lat: null, lng: null, slot: null },
  groups: [{ sellerId: 'pane', storeName: 'Pane Quotidiano', totalCents: 3000, shippingCents: 0, deliveryFeeCents: 0, riderFeeCents: 0, couponPortionCents: 0, pickupPortionCents: 0, items: [{ productId: 'p1', quantity: 3, unitAmountCents: 1000 }] }],
});

vi.mock('@/lib/supabase/server', () => {
  const righe = (t: string): unknown[] =>
    t === 'profiles' ? [{ id: 'admin-1', role: 'admin' }] : t === 'pending_checkouts' ? [pending()] : [];
  const catena = (t: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'lt', 'gt', 'gte', 'order', 'limit', 'neq', 'not']) c[m] = () => c;
    c.single = async () => ({ data: righe(t)[0] ?? null, error: null });
    c.maybeSingle = async () => ({ data: t === 'pending_checkouts' ? pending() : null, error: null });
    c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: righe(t), error: null }).then(r);
    return c;
  };
  return {
    getAdminSupabase: () => ({
      from: (tabella: string) => {
        const c = catena(tabella);
        c.insert = (valori: Record<string, unknown>) => {
          stato.inseriti.push({ tabella, valori });
          const esito = { data: { id: `${tabella}-${stato.inseriti.length}` }, error: null };
          return { select: () => ({ single: async () => esito }), then: (r: (v: { error: null }) => unknown) => r({ error: null }) };
        };
        c.update = (valori: Record<string, unknown>) => {
          stato.aggiornati.push({ tabella, valori });
          return catena(tabella);
        };
        c.upsert = () => catena(tabella);
        c.delete = () => catena(tabella);
        return c;
      },
      rpc: async () => ({ data: null, error: null }),
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
    }),
  };
});

import { handleCheckoutCompleted } from '@/lib/stripe/webhook/ordini';

const sessione = {
  id: 'cs_1', payment_status: 'paid', client_reference_id: 'pc_1', amount_total: 3000, payment_intent: 'pi_1',
  customer_details: { email: 'cliente@test.it', name: 'Maria Rossi' }, metadata: {},
} as never;

const ordini = () => stato.inseriti.filter((s) => s.tabella === 'orders').map((s) => s.valori);
const notifiche = () => stato.inseriti.filter((s) => s.tabella === 'notifications').flatMap((s) => (Array.isArray(s.valori) ? s.valori : [s.valori]) as Array<Record<string, unknown>>);

beforeEach(() => {
  stato.inseriti.length = 0;
  stato.aggiornati.length = 0;
  stato.pendingStatus = 'PENDING';
  stato.carica = { id: 'ch_1', refunded: false, amount_refunded: 0, disputed: false };
});

describe('R03-008 — la carta tornata prima dell ordine', () => {
  it('rimborso dal cruscotto arrivato prima: l ordine nasce annullato, non pagabile al negozio, e Nicola è avvisato', async () => {
    stato.carica = { id: 'ch_1', refunded: true, amount_refunded: 3000, disputed: false };
    await handleCheckoutCompleted(sessione);
    const [o] = ordini();
    expect(o, 'l ordine deve restare come traccia').toBeTruthy();
    expect(o.payout_status, 'il giro dei bonifici pagherebbe il negozio').not.toBe('HELD');
    expect(o.payment_status).not.toBe('PAID');
    expect(o.delivery_status).toBe('CANCELED');
    const testi = notifiche().map((n) => `${n.user_id}: ${n.title}`);
    expect(testi.some((t) => t.startsWith('admin-1') && t.includes('tornato al cliente')), testi.join(' | ')).toBe(true);
    expect(notifiche().some((n) => n.user_id === 'pane'), 'il negozio riceve «nuovo ordine» per un ordine annullato').toBe(false);
  });

  it('pagamento contestato con la banca: stessa cosa', async () => {
    stato.carica = { id: 'ch_1', refunded: false, amount_refunded: 0, disputed: true };
    await handleCheckoutCompleted(sessione);
    expect(ordini()[0].payout_status).not.toBe('HELD');
    expect(ordini()[0].delivery_status).toBe('CANCELED');
  });

  it('carta normale: l ordine nasce pagato come sempre', async () => {
    await handleCheckoutCompleted(sessione);
    expect(ordini()[0].payment_status).toBe('PAID');
    expect(ordini()[0].payout_status).toBe('HELD');
    expect(ordini()[0].delivery_status).toBe('NEW');
  });

  it('carrello già annullato o chiuso per quadratura: nessun ordine nasce', async () => {
    for (const s of ['CANCELED', 'MISMATCH']) {
      stato.inseriti.length = 0;
      stato.pendingStatus = s;
      await handleCheckoutCompleted(sessione);
      expect(ordini(), `carrello ${s}`).toHaveLength(0);
    }
  });
});
