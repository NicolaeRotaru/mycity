import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * ORDINE PAGATO E IN NEGOZIO NON SQUILLA NIENTE (radiografia 27/8/2026).
 *
 * Le comunicazioni dopo un ordine con carta partivano come promessa non attesa:
 * `const avvisi = (async () => { ... })()` seguito da `void avvisi.catch(...)`.
 * Non aspettarle è giusto — Stripe considera fallita una consegna che non
 * riceve risposta in pochi secondi — ma su Vercel la funzione può essere spenta
 * appena ha risposto, e quel lavoro muore a metà.
 *
 * Dentro quel blocco non c'erano solo le email: c'era anche la campanella del
 * venditore, cioè la riga in `notifications` da cui parte pure la notifica push
 * (app/api/cron/send-push la legge da lì). Ordine pagato, soldi incassati,
 * cliente che aspetta, e il negoziante non lo sa: lo scopre solo se apre da
 * solo la sua pagina ordini.
 *
 * QUESTA PROVA GUARDA L'ORDINE DELLE COSE, non il testo del codice: quando la
 * gestione dell'evento Stripe ha finito — cioè quando si risponde — la
 * campanella deve essere già scritta; le email possono restare indietro, ma
 * consegnate a `after()`, che tiene viva la funzione finché non finiscono.
 */

const dopoLaRisposta: Array<() => Promise<void>> = [];
vi.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => { dopoLaRisposta.push(fn); },
  NextResponse: { json: (b: unknown, i?: ResponseInit) => new Response(JSON.stringify(b), i) },
}));

const registro: string[] = [];
const emailSpedite: Array<{ to: string }> = [];

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string }) => { registro.push('email'); emailSpedite.push(m); return { ok: true }; },
}));
vi.mock('@/lib/email/templates', () => ({
  orderConfirmedBuyerTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
  newOrderSellerTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
}));
vi.mock('@/lib/analytics/server', () => ({
  analyticsConsentita: async () => true,
  contaAcquisto: async () => { registro.push('misura'); },
}));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ paymentIntents: { retrieve: async () => ({ latest_charge: 'ch_1' }) } }),
  computeOrderSplit: () => ({ applicationFeeCents: 100, sellerPayoutCents: 900 }),
}));

const PENDING = {
  id: 'pc_1',
  buyer_id: 'buyer-1',
  status: 'PENDING',
  total_cents: 1000,
  stripe_session_id: 'cs_1',
  coupon_code: null,
  pickup_in_store: false,
  delivery: { full_name: 'Maria Rossi', phone: '333', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', notes: null, lat: null, lng: null, slot: null },
  groups: [{ sellerId: 'seller-1', storeName: 'Pane Quotidiano', totalCents: 1000, shippingCents: 0, deliveryFeeCents: 0, riderFeeCents: 100, couponPortionCents: 0, pickupPortionCents: 0, items: [{ productId: 'p1', quantity: 2, unitAmountCents: 500 }] }],
};

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          single: async () => ({ data: PENDING, error: null }),
          maybeSingle: async () => ({ data: PENDING, error: null }),
          then: undefined,
        }),
      }),
      insert: (righe: unknown) => {
        registro.push(tabella === 'notifications' ? 'campanella' : `insert:${tabella}`);
        const esito = { data: { id: 'o1' }, error: null };
        return {
          select: () => ({ single: async () => esito }),
          then: (r: (v: { error: null }) => unknown) => r({ error: null }),
        };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
  }),
}));

import { handleCheckoutCompleted } from '@/lib/stripe/webhook/ordini';

const sessione = {
  id: 'cs_1',
  payment_status: 'paid',
  client_reference_id: 'pc_1',
  amount_total: 1000,
  payment_intent: 'pi_1',
  customer_details: { email: 'cliente@test.it', name: 'Maria Rossi' },
  metadata: {},
} as never;

beforeEach(() => {
  registro.length = 0;
  emailSpedite.length = 0;
  dopoLaRisposta.length = 0;
});

describe('il webhook Stripe risponde solo dopo aver avvisato il negozio', () => {
  it('la campanella del venditore è già scritta quando si risponde a Stripe', async () => {
    await handleCheckoutCompleted(sessione);

    expect(registro, 'il negozio non è stato avvisato prima della risposta').toContain('campanella');
    const campanella = registro.indexOf('campanella');
    const ordine = registro.indexOf('insert:orders');
    expect(campanella).toBeGreaterThan(ordine);
  });

  it('le email non tengono in ostaggio la risposta, ma non partono nel vuoto', async () => {
    await handleCheckoutCompleted(sessione);

    expect(emailSpedite, 'le email hanno fatto aspettare Stripe').toHaveLength(0);
    expect(dopoLaRisposta.length, 'il lavoro rimandato non è affidato ad after(): su Vercel può non girare mai').toBeGreaterThan(0);

    for (const lavoro of dopoLaRisposta) await lavoro();
    expect(emailSpedite.map((e) => e.to)).toEqual(['cliente@test.it', 'negozio@test.it']);
    expect(registro).toContain('misura');
  });
});
